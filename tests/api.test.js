'use strict';

/**
 * End-to-end API tests for the Carillon Recital Rota server.
 * Runs a real HTTP server against a throwaway data directory — no network,
 * no external services.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server.js');

let server;
let baseUrl;
let dataDir;
let app;

function makeClient(base) {
  const root = base || baseUrl;
  let cookie = '';

  async function call(method, route, body) {
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${root}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const setCookie = response.headers.getSetCookie
      ? response.headers.getSetCookie()[0]
      : response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body: payload, headers: response.headers };
  }

  return {
    call,
    get: (route) => call('GET', route),
    post: (route, body) => call('POST', route, body === undefined ? {} : body),
    patch: (route, body) => call('PATCH', route, body),
    del: (route) => call('DELETE', route, {}),
    forget: () => {
      cookie = '';
    }
  };
}

function futureSunday(weeksAhead) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + weeksAhead * 7);
  while (date.getUTCDay() !== 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nextWeekday(iso) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function startApp(directory) {
  const instance = createApp({ dataDir: directory });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  return { instance, url: `http://127.0.0.1:${instance.server.address().port}` };
}

async function closeApp(instance) {
  await new Promise((resolve) => instance.server.close(resolve));
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carillon-rota-'));
  const started = await startApp(dataDir);
  app = started.instance;
  server = started.instance.server;
  baseUrl = started.url;
});

test.after(async () => {
  await closeApp(app);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('serves the app shell at / and the client assets at their exact paths', async () => {
  const root = await fetch(`${baseUrl}/`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /text\/html/);
  const html = await root.text();
  assert.match(html, /Carillon Recital Rota/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /src="\/app\.js"/);
  assert.ok(root.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(root.headers.get('x-frame-options'), 'DENY');

  for (const asset of ['/styles.css', '/app.js', '/views/dashboard.js', '/favicon.svg']) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should be served`);
    await response.arrayBuffer();
  }

  const deepLink = await fetch(`${baseUrl}/practice`);
  assert.equal(deepLink.status, 200, 'client routes fall back to the app shell');
  assert.match(deepLink.headers.get('content-type'), /text\/html/);
});

test('unknown API routes answer with a JSON 404', async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.match(payload.error, /does not exist/i);
});

test('health endpoint answers ok', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('the seeded demo carillonneur signs in and sees a populated rota', async () => {
  const client = makeClient();
  const login = await client.post('/api/auth/login', {
    email: 'cenius@cenius.ai',
    password: 'cenius'
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email, 'cenius@cenius.ai');
  assert.equal(login.body.user.username, 'cenius');
  assert.ok(!('passwordHash' in login.body.user), 'the password hash never leaves the server');

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'cenius@cenius.ai');

  const recitals = await client.get('/api/recitals?scope=upcoming');
  assert.equal(recitals.status, 200);
  assert.ok(recitals.body.recitals.length >= 5, 'seeded recitals are present');

  const dates = recitals.body.recitals.map((recital) => recital.date);
  assert.deepEqual(dates, [...dates].sort(), 'recitals are sorted by date');
  assert.ok(
    recitals.body.recitals.some((recital) => recital.claimedById && recital.claimedBy.displayName),
    'claimed recitals expose the carillonneur display name'
  );
  assert.ok(
    recitals.body.recitals.some((recital) => recital.claimedById === null),
    'the seed leaves open dates on the rota'
  );
  assert.ok(
    recitals.body.recitals.some((recital) => recital.pieceCount > 0),
    'programmes are seeded with pieces'
  );

  const slots = await client.get('/api/practice-slots?scope=upcoming');
  assert.equal(slots.status, 200);
  assert.ok(slots.body.slots.length >= 5, 'seeded practice slots are present');
  assert.ok(slots.body.slots.some((slot) => slot.claimedById === null));
});

test('wrong credentials answer with one non-enumerating message', async () => {
  const client = makeClient();
  const wrongPassword = await client.post('/api/auth/login', {
    email: 'cenius@cenius.ai',
    password: '***REDACTED-SECRET***'
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.error, 'Email or password is incorrect.');

  const unknownEmail = await client.post('/api/auth/login', {
    email: 'nobody@carillon.test',
    password: 'whatever'
  });
  assert.equal(unknownEmail.status, 401);
  assert.equal(unknownEmail.body.error, 'Email or password is incorrect.');
});

test('registration starts a session, validates input, and rejects duplicate emails', async () => {
  const client = makeClient();

  const invalid = await client.post('/api/auth/register', {
    displayName: 'A',
    email: 'not-an-email',
    password: 'short'
  });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.fields.email);
  assert.ok(invalid.body.fields.password);
  assert.ok(invalid.body.fields.displayName);

  const created = await client.post('/api/auth/register', {
    displayName: 'Liesbeth Maes',
    email: 'liesbeth@carillon.test',
    password: 'bronze-bells'
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.displayName, 'Liesbeth Maes');

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'liesbeth@carillon.test');

  const duplicate = makeClient().post('/api/auth/register', {
    displayName: 'Liesbeth Again',
    email: 'liesbeth@carillon.test',
    password: 'bronze-bells'
  });
  assert.equal((await duplicate).status, 409);
});

test('sign-out invalidates the session cookie', async () => {
  const client = makeClient();
  const login = await client.post('/api/auth/login', { email: 'jonas@carillon.test', password: 'bells123' });
  assert.equal(login.status, 200);
  assert.equal((await client.get('/api/auth/me')).status, 200);

  const logout = await client.post('/api/auth/logout');
  assert.equal(logout.status, 200);

  const afterLogout = await client.get('/api/auth/me');
  assert.equal(afterLogout.status, 401);
});

test('unauthenticated reads and mutations are refused', async () => {
  const client = makeClient();
  assert.equal((await client.get('/api/recitals')).status, 401);
  assert.equal((await client.get('/api/practice-slots')).status, 401);
  const create = await client.post('/api/recitals', { date: futureSunday(12), title: 'Hidden recital' });
  assert.equal(create.status, 401);
});

test('a recital claim is exclusive: the second carillonneur gets 409, a non-owner cannot release', async () => {
  const owner = makeClient();
  const other = makeClient();
  await owner.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });
  await other.post('/api/auth/login', { email: 'saskia@carillon.test', password: 'bells123' });

  const created = await owner.post('/api/recitals', {
    date: futureSunday(30),
    title: 'Test Recital: Claim Conflict'
  });
  assert.equal(created.status, 201);
  const recitalId = created.body.recital.id;
  assert.equal(created.body.recital.claimedById, null);

  const firstClaim = await owner.post(`/api/recitals/${recitalId}/claim`);
  assert.equal(firstClaim.status, 200);
  assert.equal(firstClaim.body.recital.claimedBy.displayName, 'Cenius Baert');

  const secondClaim = await other.post(`/api/recitals/${recitalId}/claim`);
  assert.equal(secondClaim.status, 409);
  assert.match(secondClaim.body.error, /already claimed/i);

  const foreignRelease = await other.post(`/api/recitals/${recitalId}/release`);
  assert.equal(foreignRelease.status, 403);

  const ownerRelease = await owner.post(`/api/recitals/${recitalId}/release`);
  assert.equal(ownerRelease.status, 200);
  assert.equal(ownerRelease.body.recital.claimedById, null);

  const cleanup = await owner.del(`/api/recitals/${recitalId}`);
  assert.equal(cleanup.status, 200);
});

test('recitals are created, edited, listed and deleted through the API', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });

  const sunday = futureSunday(24);
  const created = await client.post('/api/recitals', {
    date: sunday,
    title: 'Harvest Recital',
    notes: 'Programme to be confirmed.'
  });
  assert.equal(created.status, 201);
  const recitalId = created.body.recital.id;

  const updated = await client.patch(`/api/recitals/${recitalId}`, {
    title: 'Harvest Recital: Bells at Dusk',
    notes: 'Candle-lit tower chamber afterwards.'
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.recital.title, 'Harvest Recital: Bells at Dusk');

  const listed = await client.get('/api/recitals?scope=upcoming');
  assert.ok(listed.body.recitals.some((recital) => recital.id === recitalId));

  const fetched = await client.get(`/api/recitals/${recitalId}`);
  assert.equal(fetched.body.recital.notes, 'Candle-lit tower chamber afterwards.');

  const deleted = await client.del(`/api/recitals/${recitalId}`);
  assert.equal(deleted.status, 200);
  const afterDelete = await client.get(`/api/recitals/${recitalId}`);
  assert.equal(afterDelete.status, 404);
});

test('recital dates must be real and must fall on a Sunday', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });

  const sunday = futureSunday(16);
  const weekday = nextWeekday(sunday);

  const notSunday = await client.post('/api/recitals', { date: weekday, title: 'Wrong weekday recital' });
  assert.equal(notSunday.status, 400);
  assert.match(notSunday.body.fields.date, /Sunday/i);

  const notADate = await client.post('/api/recitals', { date: '2026-02-31', title: 'Impossible date' });
  assert.equal(notADate.status, 400);
  assert.ok(notADate.body.fields.date);

  const missingTitle = await client.post('/api/recitals', { date: sunday, title: '' });
  assert.equal(missingTitle.status, 400);
  assert.ok(missingTitle.body.fields.title);
});

test('programme pieces keep their order and support arrangement credits, edits and removal', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });

  const created = await client.post('/api/recitals', {
    date: futureSunday(20),
    title: 'Test Recital: Programme Order'
  });
  const recitalId = created.body.recital.id;

  const first = await client.post(`/api/recitals/${recitalId}/pieces`, {
    title: 'Preludium in G',
    composer: 'Matthias van den Gheyn',
    arranger: 'Jonas Leemans',
    durationMinutes: 4
  });
  const second = await client.post(`/api/recitals/${recitalId}/pieces`, {
    title: 'Est-ce Mars',
    composer: 'Jan Pieterszoon Sweelinck',
    arranger: 'Cenius Baert',
    durationMinutes: 5
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.piece.order, 1);
  assert.equal(second.body.piece.order, 2);

  const listed = await client.get(`/api/recitals/${recitalId}/pieces`);
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.body.pieces.map((piece) => piece.title),
    ['Preludium in G', 'Est-ce Mars']
  );
  assert.equal(listed.body.pieces[0].arranger, 'Jonas Leemans', 'the arrangement credit is stored');

  const edited = await client.patch(`/api/pieces/${first.body.piece.id}`, {
    arranger: 'Saskia Vermeer'
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.piece.arranger, 'Saskia Vermeer');

  const removed = await client.del(`/api/pieces/${second.body.piece.id}`);
  assert.equal(removed.status, 200);

  const afterRemoval = await client.get(`/api/recitals/${recitalId}/pieces`);
  assert.deepEqual(
    afterRemoval.body.pieces.map((piece) => piece.title),
    ['Preludium in G']
  );

  const missingRecital = await client.get('/api/recitals/rec_missing/pieces');
  assert.equal(missingRecital.status, 404);
  assert.match(missingRecital.body.error, /could not be found/i);

  const cleaned = await client.del(`/api/recitals/${recitalId}`);
  assert.equal(cleaned.status, 200);
});

test('deleting a recital removes its programme pieces', async () => {
  const client = makeClient();
  await client.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });

  const created = await client.post('/api/recitals', {
    date: futureSunday(22),
    title: 'Test Recital: Cascade Delete'
  });
  const recitalId = created.body.recital.id;
  const piece = await client.post(`/api/recitals/${recitalId}/pieces`, {
    title: 'Adagio',
    composer: 'Wolfgang Amadeus Mozart'
  });
  assert.equal(piece.status, 201);

  assert.equal((await client.del(`/api/recitals/${recitalId}`)).status, 200);
  const orphan = await client.del(`/api/pieces/${piece.body.piece.id}`);
  assert.equal(orphan.status, 404, 'the piece is gone with its recital');
});

test('practice slots validate their time window and enforce claim ownership', async () => {
  const owner = makeClient();
  const other = makeClient();
  await owner.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });
  await other.post('/api/auth/login', { email: 'willem@carillon.test', password: 'bells123' });

  const backwards = await owner.post('/api/practice-slots', {
    date: futureSunday(1),
    startTime: '11:00',
    endTime: '10:00',
    towerRoom: 'Belfry console'
  });
  assert.equal(backwards.status, 400);
  assert.match(backwards.body.fields.endTime, /after the start time/i);

  const badTime = await owner.post('/api/practice-slots', {
    date: futureSunday(1),
    startTime: '25:99',
    endTime: '10:00',
    towerRoom: 'Belfry console'
  });
  assert.equal(badTime.status, 400);
  assert.ok(badTime.body.fields.startTime);

  const created = await owner.post('/api/practice-slots', {
    date: futureSunday(1),
    startTime: '08:00',
    endTime: '09:15',
    towerRoom: 'North tower clavier',
    notes: 'Silent clavier'
  });
  assert.equal(created.status, 201);
  const slotId = created.body.slot.id;

  const firstClaim = await owner.post(`/api/practice-slots/${slotId}/claim`);
  assert.equal(firstClaim.status, 200);
  assert.equal(firstClaim.body.slot.claimedBy.displayName, 'Cenius Baert');

  assert.equal((await other.post(`/api/practice-slots/${slotId}/claim`)).status, 409);
  assert.equal((await other.post(`/api/practice-slots/${slotId}/release`)).status, 403);
  assert.equal((await owner.post(`/api/practice-slots/${slotId}/release`)).status, 200);

  const listed = await owner.get('/api/practice-slots?scope=upcoming');
  assert.ok(listed.body.slots.some((slot) => slot.id === slotId));

  assert.equal((await owner.del(`/api/practice-slots/${slotId}`)).status, 200);
  const afterDelete = await owner.get('/api/practice-slots?scope=upcoming');
  assert.ok(!afterDelete.body.slots.some((slot) => slot.id === slotId));
});

test('mutations require a JSON body and reject cross-site origins', async () => {
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cenius@cenius.ai', password: 'cenius' })
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.getSetCookie()[0].split(';')[0];

  const formPost = await fetch(`${baseUrl}/api/recitals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: 'title=form'
  });
  assert.equal(formPost.status, 415, 'form posts are not accepted for JSON endpoints');

  const crossSite = await fetch(`${baseUrl}/api/recitals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: cookie },
    body: JSON.stringify({ date: futureSunday(18), title: 'Cross site recital' })
  });
  assert.equal(crossSite.status, 403);

  const sameOrigin = await fetch(`${baseUrl}/api/recitals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie },
    body: JSON.stringify({ date: futureSunday(18), title: undefined, notes: '' })
  });
  assert.equal(sameOrigin.status, 400, 'same-origin requests are allowed through to validation');
  await sameOrigin.arrayBuffer();
});

test('written records survive a server restart without re-seeding twice', async () => {
  const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carillon-restart-'));
  const firstRun = await startApp(restartDir);

  const writer = makeClient(firstRun.url);
  const login = await writer.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });
  assert.equal(login.status, 200);

  const created = await writer.post('/api/recitals', { date: futureSunday(26), title: 'Persisted Recital' });
  assert.equal(created.status, 201);

  const stored = JSON.parse(fs.readFileSync(path.join(restartDir, 'db.json'), 'utf8'));
  assert.ok(stored.recitals.some((recital) => recital.title === 'Persisted Recital'));
  assert.ok(stored.users.length >= 5, 'the demo accounts were written to disk');

  await closeApp(firstRun.instance);

  const secondRun = await startApp(restartDir);
  const reader = makeClient(secondRun.url);
  const relogin = await reader.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });
  assert.equal(relogin.status, 200, 'users persisted, so the same password still works');

  const listed = await reader.get('/api/recitals?scope=all');
  assert.equal(
    listed.body.recitals.filter((recital) => recital.title === 'Persisted Recital').length,
    1,
    'the record survived the restart and was seeded only once'
  );

  const usersOnDisk = JSON.parse(fs.readFileSync(path.join(restartDir, 'db.json'), 'utf8')).users;
  assert.equal(
    usersOnDisk.filter((user) => user.email === 'cenius@cenius.ai').length,
    1,
    'the demo account is idempotent'
  );

  await closeApp(secondRun.instance);
  fs.rmSync(restartDir, { recursive: true, force: true });
});

test('seeding a fresh boot fills every screen with demo data', async () => {
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carillon-seed-'));
  const boot = await startApp(seedDir);
  const client = makeClient(boot.url);

  await client.post('/api/auth/login', { email: 'cenius@cenius.ai', password: 'cenius' });
  const recitals = await client.get('/api/recitals?scope=upcoming');
  const slots = await client.get('/api/practice-slots?scope=upcoming');

  assert.ok(recitals.body.recitals.length >= 5, 'upcoming recitals are seeded');
  assert.ok(slots.body.slots.length >= 5, 'practice slots are seeded');
  assert.ok(
    recitals.body.recitals.some((recital) => recital.pieceCount >= 3),
    'at least one recital carries a full programme'
  );
  assert.equal(
    slots.body.slots.filter((slot) => slot.claimedById === recitals.body.recitals[0].claimedById).length >= 0,
    true
  );

  const demo = await client.get('/api/auth/me');
  assert.equal(demo.body.user.email, 'cenius@cenius.ai');

  await closeApp(boot.instance);
  fs.rmSync(seedDir, { recursive: true, force: true });
});
