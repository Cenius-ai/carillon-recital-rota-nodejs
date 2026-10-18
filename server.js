'use strict';

/**
 * Carillon Recital Rota
 * ----------------------
 * A single-process, zero-dependency Node 20 HTTP server. It serves the vanilla
 * client from public/ and exposes a JSON API over a JSON-file store.
 *
 * Run:  node server.js        (binds 0.0.0.0, honors $PORT, default 3000)
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PROJECT_ROOT = __dirname;
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, 'data');

const SESSION_COOKIE = 'crr_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_STRING = 1000;

const TOWER_ROOMS = [
  'North tower clavier',
  'Belfry console',
  'Chapter house clavier',
  'Transept gallery'
];

// Optional .env support (no dependency): values already in the environment win.
function loadDotEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'"
  ].join('; ')
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || null;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function todayIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysIso(iso, days) {
  const base = new Date(`${iso}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSunday(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay() === 0;
}

function nextSundayIso(fromIso) {
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDaysIso(fromIso, offset);
    if (isSunday(candidate)) return candidate;
  }
  return fromIso;
}

function isClockTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return true;
}

function minutesOfDay(clock) {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt, per-user salt) — same code path for seed + login
// ---------------------------------------------------------------------------

function hashPassword(password, salt) {
  const passwordSalt = salt || crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(password, passwordSalt, 64).toString('hex');
  return { passwordHash, passwordSalt };
}

function verifyPassword(password, user) {
  if (typeof password !== 'string' || !user.passwordSalt || !user.passwordHash) return false;
  const candidate = crypto.scryptSync(password, user.passwordSalt, 64);
  const stored = Buffer.from(user.passwordHash, 'hex');
  if (stored.length !== candidate.length) return false;
  return crypto.timingSafeEqual(stored, candidate);
}

// ---------------------------------------------------------------------------
// Store: data/db.json with atomic temp-file rename
// ---------------------------------------------------------------------------

function emptyDatabase() {
  return { version: 1, users: [], sessions: [], recitals: [], pieces: [], practiceSlots: [] };
}

function createStore(dbFile) {
  let writeChain = Promise.resolve();

  const store = {
    dbFile,
    db: emptyDatabase(),

    exists() {
      return fs.existsSync(dbFile);
    },

    load() {
      if (!fs.existsSync(dbFile)) {
        store.db = emptyDatabase();
        return store.db;
      }
      const raw = fs.readFileSync(dbFile, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        console.error(`[store] ${dbFile} is not valid JSON — starting from an empty store.`, error.message);
        parsed = null;
      }
      const base = emptyDatabase();
      if (isPlainObject(parsed)) {
        for (const key of Object.keys(base)) {
          if (Array.isArray(parsed[key])) base[key] = parsed[key];
        }
      }
      store.db = base;
      store.pruneSessions();
      return store.db;
    },

    pruneSessions() {
      const cutoff = Date.now();
      const before = store.db.sessions.length;
      store.db.sessions = store.db.sessions.filter((session) => {
        const expires = Date.parse(session.expiresAt);
        return Number.isFinite(expires) && expires > cutoff;
      });
      return before - store.db.sessions.length;
    },

    persist() {
      const snapshot = JSON.stringify(store.db, null, 2);
      const target = store.dbFile;
      const attempt = writeChain.then(async () => {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const temp = `${target}.${process.pid}.tmp`;
        await fsp.writeFile(temp, snapshot, 'utf8');
        await fsp.rename(temp, target);
      });
      writeChain = attempt.catch(() => undefined);
      return attempt;
    },

    persistSync() {
      fs.mkdirSync(path.dirname(store.dbFile), { recursive: true });
      const temp = `${store.dbFile}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(store.db, null, 2), 'utf8');
      fs.renameSync(temp, store.dbFile);
    }
  };

  return store;
}

// ---------------------------------------------------------------------------
// Seed data (idempotent; runs on the normal boot path)
// ---------------------------------------------------------------------------

// Preview seed identities. The addresses and passwords are read from the
// environment first; the built-in fallbacks are explicitly non-production dev
// values so a fresh clone with no .env still seeds a working demo login.
const DEMO_EMAIL = String(process.env.CARILLON_DEMO_EMAIL || 'cenius@cenius.ai').toLowerCase();
const PREVIEW_CREDENTIALS = {
  coordinator: process.env.CARILLON_DEMO_PASSWORD || 'cenius',
  member: process.env.CARILLON_SEED_PASSWORD || 'bells123'
};

const SEED_USERS = [
  {
    displayName: 'Cenius Baert',
    email: DEMO_EMAIL,
    username: 'cenius',
    secret: PREVIEW_CREDENTIALS.coordinator,
    role: 'Tower coordinator'
  },
  {
    displayName: 'Théo Lannoy',
    email: 'demo@carillon.test',
    username: 'demo',
    secret: PREVIEW_CREDENTIALS.member,
    role: 'Carillonneur'
  },
  {
    displayName: 'Willem Dekkers',
    email: 'willem@carillon.test',
    username: 'willem',
    secret: PREVIEW_CREDENTIALS.member,
    role: 'Carillonneur'
  },
  {
    displayName: 'Saskia Vermeer',
    email: 'saskia@carillon.test',
    username: 'saskia',
    secret: PREVIEW_CREDENTIALS.member,
    role: 'Carillonneur'
  },
  {
    displayName: 'Jonas Leemans',
    email: 'jonas@carillon.test',
    username: 'jonas',
    secret: PREVIEW_CREDENTIALS.member,
    role: 'Carillonneur'
  }
];

const SEED_RECITALS = [
  {
    key: 'flemish-masters',
    title: 'Midday Recital: Flemish Masters',
    notes: 'A tour of the Antwerp and Brussels carillon schools. Meet at the tower door ten minutes before the hour.',
    claimedBy: 'willem@carillon.test',
    pieces: [
      { title: 'Preludium in G', composer: 'Matthias van den Gheyn', arranger: 'Jonas Leemans', durationMinutes: 4, notes: 'Opens on the bourdon, ends on the triplet bells.' },
      { title: "Aria and Variations on 'La Bergère'", composer: 'Pieter Bustijn', arranger: 'Saskia Vermeer', durationMinutes: 6, notes: '' },
      { title: 'Sonata in D', composer: 'Willem de Fesch', arranger: 'Willem Dekkers', durationMinutes: 5, notes: 'Second movement only.' },
      { title: "Rondeau 'Les Cloches'", composer: 'Staf Nees', arranger: 'Original for carillon', durationMinutes: 3, notes: '' }
    ]
  },
  {
    key: 'bells-at-noon',
    title: 'Sunday Recital: Bells at Noon',
    notes: 'Baroque transcriptions for the clavier, played from the belfry console.',
    claimedBy: DEMO_EMAIL,
    pieces: [
      { title: 'Jesu, Joy of Man’s Desiring', composer: 'Johann Sebastian Bach', arranger: 'Cenius Baert', durationMinutes: 4, notes: 'Arranged for four-octave carillon.' },
      { title: 'Solfeggietto in C minor', composer: 'Carl Philipp Emanuel Bach', arranger: 'Théo Lannoy', durationMinutes: 3, notes: '' },
      { title: 'Adagio for Glass Harmonica, K. 356', composer: 'Wolfgang Amadeus Mozart', arranger: 'Saskia Vermeer', durationMinutes: 4, notes: '' },
      { title: 'Trumpet Tune in D', composer: 'Henry Purcell', arranger: 'Jonas Leemans', durationMinutes: 3, notes: 'Closes the recital.' }
    ]
  },
  {
    key: 'romantic-transcriptions',
    title: 'Evening Recital: Romantic Transcriptions',
    notes: 'Nineteenth-century piano and song repertoire transferred to bronze. Candles in the tower chamber afterwards.',
    claimedBy: null,
    pieces: [
      { title: 'Clair de lune', composer: '[redacted] Debussy', arranger: 'Théo Lannoy', durationMinutes: 5, notes: '' },
      { title: 'Pavane, Op. 50', composer: 'Gabriel Fauré', arranger: 'Willem Dekkers', durationMinutes: 5, notes: '' },
      { title: 'Ave Maria (Ellens Gesang III)', composer: 'Franz Schubert', arranger: 'Saskia Vermeer', durationMinutes: 4, notes: '' },
      { title: 'Hymn to the Bells', composer: 'Staf Nees', arranger: 'Original for carillon', durationMinutes: 6, notes: '' }
    ]
  },
  {
    key: 'songs-of-the-low-countries',
    title: 'Sunday Recital: Songs of the Low Countries',
    notes: 'Sixteenth-century songbook settings, ending with a sing-along from the square.',
    claimedBy: 'saskia@carillon.test',
    pieces: [
      { title: 'Mijn Hert heeft altijd verlanghen', composer: 'Anonymous, 16th century', arranger: 'Cenius Baert', durationMinutes: 3, notes: '' },
      { title: 'Est-ce Mars', composer: 'Jan Pieterszoon Sweelinck', arranger: 'Jonas Leemans', durationMinutes: 4, notes: '' },
      { title: "Pavane 'La Bataille'", composer: 'Tielman Susato', arranger: 'Willem Dekkers', durationMinutes: 4, notes: '' },
      { title: 'Andante for Carillon', composer: 'Jef Denyn', arranger: 'Original for carillon', durationMinutes: 4, notes: '' }
    ]
  },
  {
    key: 'new-carillon-works',
    title: 'Sunday Recital: New Carillon Works',
    notes: 'First performance of a work written for this tower. Composer present.',
    claimedBy: null,
    pieces: [
      { title: 'Prelude for Bronze', composer: "Geert D'hollander", arranger: 'Original for carillon', durationMinutes: 7, notes: 'Commissioned for the 2025 season.' }
    ]
  },
  {
    key: 'bach-and-sons',
    title: 'Sunday Recital: Bach & Sons',
    notes: 'Three generations of the Bach family on the carillon.',
    claimedBy: DEMO_EMAIL,
    pieces: []
  },
  {
    key: 'hymn-festival',
    title: 'Sunday Recital: Hymn Festival',
    notes: 'Congregational hymns with the tower bells doubling the melody.',
    claimedBy: null,
    pieces: []
  },
  {
    key: 'student-showcase',
    title: 'Sunday Recital: Student Showcase',
    notes: 'Six students of the tower school play their examination programmes.',
    claimedBy: 'jonas@carillon.test',
    pieces: []
  }
];

const SEED_PRACTICE_SLOTS = [
  { dayOffset: 1, startTime: '09:00', endTime: '10:30', towerRoom: 'North tower clavier', claimedBy: DEMO_EMAIL, notes: 'Sweelinck variations — chromatic passagework.' },
  { dayOffset: 1, startTime: '17:00', endTime: '18:00', towerRoom: 'Belfry console', claimedBy: null, notes: 'Open to anyone preparing a Sunday programme.' },
  { dayOffset: 2, startTime: '08:00', endTime: '09:00', towerRoom: 'Chapter house clavier', claimedBy: 'willem@carillon.test', notes: 'Bass bell tuning check with the bell founder.' },
  { dayOffset: 3, startTime: '16:00', endTime: '17:30', towerRoom: 'North tower clavier', claimedBy: null, notes: '' },
  { dayOffset: 4, startTime: '10:00', endTime: '11:00', towerRoom: 'Transept gallery', claimedBy: 'saskia@carillon.test', notes: 'Silent clavier only — no bells.' },
  { dayOffset: 5, startTime: '09:30', endTime: '11:00', towerRoom: 'Belfry console', claimedBy: null, notes: '' },
  { dayOffset: 6, startTime: '18:00', endTime: '19:00', towerRoom: 'North tower clavier', claimedBy: DEMO_EMAIL, notes: 'Run-through before the Bach recital.' },
  { dayOffset: 8, startTime: '11:00', endTime: '12:00', towerRoom: 'Chapter house clavier', claimedBy: null, notes: 'Beginners welcome.' }
];

function seedDemoData(store) {
  const db = store.db;
  let changed = false;

  for (const spec of SEED_USERS) {
    const exists = db.users.some((user) => user.email.toLowerCase() === spec.email.toLowerCase());
    if (exists) continue;
    const { passwordHash, passwordSalt } = hashPassword(spec.secret);
    db.users.push({
      id: uid('usr'),
      displayName: spec.displayName,
      email: spec.email.toLowerCase(),
      username: spec.username,
      role: spec.role,
      passwordHash,
      passwordSalt,
      createdAt: nowIso()
    });
    changed = true;
  }

  if (db.recitals.length === 0) {
    const today = todayIso();
    const firstSunday = nextSundayIso(today);
    SEED_RECITALS.forEach((spec, index) => {
      const owner = spec.claimedBy
        ? db.users.find((user) => user.email.toLowerCase() === spec.claimedBy.toLowerCase())
        : null;
      const recital = {
        id: uid('rec'),
        date: addDaysIso(firstSunday, index * 7),
        title: spec.title,
        notes: spec.notes,
        claimedById: owner ? owner.id : null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.recitals.push(recital);
      changed = true;

      spec.pieces.forEach((piece, pieceIndex) => {
        db.pieces.push({
          id: uid('pce'),
          recitalId: recital.id,
          title: piece.title,
          composer: piece.composer,
          arranger: piece.arranger || '',
          order: pieceIndex + 1,
          durationMinutes: piece.durationMinutes || null,
          notes: piece.notes || '',
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
      });
    });
  }

  if (db.practiceSlots.length === 0) {
    const today = todayIso();
    for (const spec of SEED_PRACTICE_SLOTS) {
      const owner = spec.claimedBy
        ? db.users.find((user) => user.email.toLowerCase() === spec.claimedBy.toLowerCase())
        : null;
      db.practiceSlots.push({
        id: uid('prc'),
        date: addDaysIso(today, spec.dayOffset),
        startTime: spec.startTime,
        endTime: spec.endTime,
        towerRoom: spec.towerRoom,
        claimedById: owner ? owner.id : null,
        notes: spec.notes,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
      changed = true;
    }
  }

  if (changed) store.persistSync();
  return changed;
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt
  };
}

function findUserById(db, id) {
  return db.users.find((user) => user.id === id) || null;
}

function findUserByEmail(db, email) {
  const needle = String(email || '').toLowerCase();
  if (!needle) return null;
  return (
    db.users.find((user) => user.email.toLowerCase() === needle) ||
    db.users.find((user) => String(user.username || '').toLowerCase() === needle) ||
    null
  );
}

function serializeRecital(db, recital) {
  const owner = recital.claimedById ? findUserById(db, recital.claimedById) : null;
  return {
    id: recital.id,
    date: recital.date,
    title: recital.title,
    notes: recital.notes || '',
    claimedById: owner ? owner.id : null,
    claimedBy: owner ? { id: owner.id, displayName: owner.displayName } : null,
    pieceCount: db.pieces.filter((piece) => piece.recitalId === recital.id).length,
    createdAt: recital.createdAt,
    updatedAt: recital.updatedAt
  };
}

function serializeSlot(db, slot) {
  const owner = slot.claimedById ? findUserById(db, slot.claimedById) : null;
  return {
    id: slot.id,
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    towerRoom: slot.towerRoom,
    claimedById: owner ? owner.id : null,
    claimedBy: owner ? { id: owner.id, displayName: owner.displayName } : null,
    notes: slot.notes || '',
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt
  };
}

function serializePiece(piece) {
  return {
    id: piece.id,
    recitalId: piece.recitalId,
    title: piece.title,
    composer: piece.composer,
    arranger: piece.arranger || '',
    order: piece.order,
    durationMinutes: piece.durationMinutes,
    notes: piece.notes || '',
    createdAt: piece.createdAt,
    updatedAt: piece.updatedAt
  };
}

function sortPieces(pieces) {
  return pieces.slice().sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return String(left.createdAt).localeCompare(String(right.createdAt));
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function textField(fields, body, key, label, options = {}) {
  const { min = 1, max = 200, required = true, fallback = '' } = options;
  const raw = body[key];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (required) {
      fields[key] = `${label} is required.`;
      return fallback;
    }
    return fallback;
  }
  if (typeof raw !== 'string') {
    fields[key] = `${label} must be text.`;
    return fallback;
  }
  const value = raw.trim();
  if (value.length < min) {
    fields[key] = `${label} must be at least ${min} characters.`;
    return fallback;
  }
  if (value.length > max) {
    fields[key] = `${label} must be ${max} characters or fewer.`;
    return fallback;
  }
  return value;
}

function emailField(fields, body, key = 'email') {
  const raw = body[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    fields[key] = 'Email is required.';
    return '';
  }
  const value = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) || value.length > 254) {
    fields[key] = 'Enter a valid email address.';
    return '';
  }
  return value;
}

function passwordField(fields, body, options = {}) {
  const { min = 8, key = 'password' } = options;
  const raw = body[key];
  if (typeof raw !== 'string' || raw === '') {
    fields[key] = 'Password is required.';
    return '';
  }
  if (raw.length < min) {
    fields[key] = `Password must be at least ${min} characters.`;
    return '';
  }
  if (raw.length > 200) {
    fields[key] = 'Password must be 200 characters or fewer.';
    return '';
  }
  return raw;
}

function dateField(fields, body, key, label, options = {}) {
  const { requireSunday = false, min = null } = options;
  const raw = body[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    fields[key] = `${label} is required.`;
    return '';
  }
  const value = raw.trim();
  if (!isIsoDate(value)) {
    fields[key] = `${label} must be a real calendar date (YYYY-MM-DD).`;
    return '';
  }
  if (requireSunday && !isSunday(value)) {
    fields[key] = 'Sunday recitals must fall on a Sunday.';
    return '';
  }
  if (min && value < min) {
    fields[key] = `${label} cannot be in the past.`;
    return '';
  }
  return value;
}

function intField(fields, body, key, label, options = {}) {
  const { min = 0, max = 1000, required = false, fallback = null } = options;
  const raw = body[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      fields[key] = `${label} is required.`;
    }
    return fallback;
  }
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    fields[key] = `${label} must be a whole number between ${min} and ${max}.`;
    return fallback;
  }
  return value;
}

function assertNoFieldErrors(fields) {
  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, 'Please fix the highlighted fields.', fields);
  }
}

function rejectDangerousKeys(body) {
  for (const key of Object.keys(body)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new HttpError(400, 'Request body contains a disallowed key.');
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(sessionId, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  if (payload) res.end(payload);
  else res.end();
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) {
    console.error('[api] unhandled error:', error);
  }
  const message =
    error instanceof HttpError ? error.message : 'Something went wrong on our side. Please try again.';
  send(res, status, error.fields ? { error: message, fields: error.fields } : { error: message });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new HttpError(415, 'Send request bodies as JSON with Content-Type: application/json.');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
  if (!isPlainObject(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  rejectDangerousKeys(parsed);
  return parsed;
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Request rejected: unrecognised origin.');
  }
  const host = req.headers.host;
  if (host && originHost !== host) {
    throw new HttpError(403, 'Request rejected: cross-site requests are not allowed.');
  }
}

// ---------------------------------------------------------------------------
// Login rate limiting (in-process, windowed)
// ---------------------------------------------------------------------------

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function rateEntry(key) {
  const now = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(key, entry);
  }
  if (loginAttempts.size > 5000) {
    for (const [existingKey, existing] of loginAttempts) {
      if (existing.resetAt <= now) loginAttempts.delete(existingKey);
    }
  }
  return entry;
}

function assertNotThrottled(keys) {
  for (const key of keys) {
    const entry = rateEntry(key);
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
      const error = new HttpError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.');
      error.retryAfter = retryAfter;
      throw error;
    }
  }
}

function recordFailedLogin(keys) {
  for (const key of keys) rateEntry(key).count += 1;
}

function clearLoginAttempts(keys) {
  for (const key of keys) loginAttempts.delete(key);
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function createSession(store, userId) {
  store.pruneSessions();
  const session = {
    id: crypto.randomBytes(32).toString('hex'),
    userId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  store.db.sessions.push(session);
  return session;
}

async function handleRegister(ctx) {
  const { body, store } = ctx;
  const fields = {};
  const displayName = textField(fields, body, 'displayName', 'Display name', { min: 2, max: 60 });
  const email = emailField(fields, body);
  const password = passwordField(fields, body, { min: 8 });
  assertNoFieldErrors(fields);

  if (findUserByEmail(store.db, email)) {
    throw new HttpError(409, 'An account with that email already exists.', {
      email: 'An account with that email already exists.'
    });
  }

  const { passwordHash, passwordSalt } = hashPassword(password);
  let username = slugify(email.split('@')[0]) || 'carillonneur';
  if (store.db.users.some((user) => user.username === username)) {
    username = `${username}-${crypto.randomBytes(2).toString('hex')}`;
  }

  const user = {
    id: uid('usr'),
    displayName,
    email,
    username,
    role: 'Carillonneur',
    passwordHash,
    passwordSalt,
    createdAt: nowIso()
  };
  store.db.users.push(user);
  const session = createSession(store, user.id);
  await store.persist();
  return {
    status: 201,
    body: { user: publicUser(user) },
    headers: { 'Set-Cookie': sessionCookie(session.id, Math.floor(SESSION_TTL_MS / 1000)) }
  };
}

async function handleLogin(ctx) {
  const { body, store, ip } = ctx;
  const identifierRaw = typeof body.email === 'string' ? body.email : body.username;
  const identifier = typeof identifierRaw === 'string' ? identifierRaw.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const fields = {};
  if (!identifier) fields.email = 'Email or username is required.';
  if (!password) fields.password = 'Password is required.';
  assertNoFieldErrors(fields);

  const throttleKeys = [`ip:${ip}`, `who:${identifier.toLowerCase()}`];
  assertNotThrottled(throttleKeys);

  const user = findUserByEmail(store.db, identifier);
  if (!user || !verifyPassword(password, user)) {
    recordFailedLogin(throttleKeys);
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  clearLoginAttempts(throttleKeys);

  const previousSessionId = ctx.session ? ctx.session.id : null;
  if (previousSessionId) {
    store.db.sessions = store.db.sessions.filter((session) => session.id !== previousSessionId);
  }
  const session = createSession(store, user.id);
  await store.persist();
  return {
    status: 200,
    body: { user: publicUser(user) },
    headers: { 'Set-Cookie': sessionCookie(session.id, Math.floor(SESSION_TTL_MS / 1000)) }
  };
}

async function handleLogout(ctx) {
  const { store, session } = ctx;
  if (session) {
    store.db.sessions = store.db.sessions.filter((entry) => entry.id !== session.id);
    await store.persist();
  }
  return {
    status: 200,
    body: { ok: true },
    headers: { 'Set-Cookie': sessionCookie('', 0) }
  };
}

async function handleMe(ctx) {
  return { status: 200, body: { user: publicUser(ctx.user) } };
}

async function handleListRecitals(ctx) {
  const scope = ctx.url.searchParams.get('scope') || 'upcoming';
  const today = todayIso();
  let recitals = ctx.store.db.recitals.slice();
  if (scope === 'upcoming') recitals = recitals.filter((recital) => recital.date >= today);
  if (scope === 'past') recitals = recitals.filter((recital) => recital.date < today);
  if (scope === 'mine') recitals = recitals.filter((recital) => recital.claimedById === ctx.user.id);
  recitals.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return left.title.localeCompare(right.title);
  });
  return { status: 200, body: { recitals: recitals.map((recital) => serializeRecital(ctx.store.db, recital)) } };
}

async function handleCreateRecital(ctx) {
  const { body, store } = ctx;
  const fields = {};
  const date = dateField(fields, body, 'date', 'Recital date', { requireSunday: true });
  const title = textField(fields, body, 'title', 'Recital title', { min: 3, max: 120 });
  const notes = textField(fields, body, 'notes', 'Notes', { required: false, max: MAX_STRING });
  assertNoFieldErrors(fields);

  const recital = {
    id: uid('rec'),
    date,
    title,
    notes,
    claimedById: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  store.db.recitals.push(recital);
  await store.persist();
  return { status: 201, body: { recital: serializeRecital(store.db, recital) } };
}

function requireRecital(store, id) {
  const recital = store.db.recitals.find((entry) => entry.id === id);
  if (!recital) throw new HttpError(404, 'That recital could not be found.');
  return recital;
}

async function handleGetRecital(ctx) {
  const recital = requireRecital(ctx.store, ctx.params.id);
  return { status: 200, body: { recital: serializeRecital(ctx.store.db, recital) } };
}

async function handleUpdateRecital(ctx) {
  const { body, store } = ctx;
  const recital = requireRecital(store, ctx.params.id);
  const fields = {};

  if (body.date !== undefined) {
    recital.date = dateField(fields, body, 'date', 'Recital date', { requireSunday: true });
  }
  if (body.title !== undefined) {
    recital.title = textField(fields, body, 'title', 'Recital title', { min: 3, max: 120 });
  }
  if (body.notes !== undefined) {
    recital.notes = textField(fields, body, 'notes', 'Notes', { required: false, max: MAX_STRING });
  }
  assertNoFieldErrors(fields);

  recital.updatedAt = nowIso();
  await store.persist();
  return { status: 200, body: { recital: serializeRecital(store.db, recital) } };
}

async function handleDeleteRecital(ctx) {
  const { store } = ctx;
  const recital = requireRecital(store, ctx.params.id);
  store.db.recitals = store.db.recitals.filter((entry) => entry.id !== recital.id);
  store.db.pieces = store.db.pieces.filter((piece) => piece.recitalId !== recital.id);
  await store.persist();
  return { status: 200, body: { ok: true, deletedId: recital.id } };
}

async function handleClaimRecital(ctx) {
  const { store, user } = ctx;
  const recital = requireRecital(store, ctx.params.id);
  if (recital.claimedById === user.id) {
    throw new HttpError(409, 'You have already claimed this recital.');
  }
  if (recital.claimedById) {
    const owner = findUserById(store.db, recital.claimedById);
    throw new HttpError(
      409,
      `${owner ? owner.displayName : 'Another carillonneur'} has already claimed this recital.`
    );
  }
  recital.claimedById = user.id;
  recital.updatedAt = nowIso();
  await store.persist();
  return { status: 200, body: { recital: serializeRecital(store.db, recital) } };
}

async function handleReleaseRecital(ctx) {
  const { store, user } = ctx;
  const recital = requireRecital(store, ctx.params.id);
  if (!recital.claimedById) {
    throw new HttpError(409, 'This recital is not currently claimed.');
  }
  if (recital.claimedById !== user.id) {
    throw new HttpError(403, 'Only the carillonneur who claimed this recital can cancel it.');
  }
  recital.claimedById = null;
  recital.updatedAt = nowIso();
  await store.persist();
  return { status: 200, body: { recital: serializeRecital(store.db, recital) } };
}

async function handleListPieces(ctx) {
  const { store } = ctx;
  const recital = requireRecital(store, ctx.params.id);
  const pieces = store.db.pieces.filter((piece) => piece.recitalId === recital.id);
  return { status: 200, body: { pieces: sortPieces(pieces).map(serializePiece) } };
}

async function handleCreatePiece(ctx) {
  const { body, store } = ctx;
  const recital = requireRecital(store, ctx.params.id);
  const fields = {};
  const title = textField(fields, body, 'title', 'Piece title', { min: 1, max: 140 });
  const composer = textField(fields, body, 'composer', 'Composer', { min: 1, max: 140 });
  const arranger = textField(fields, body, 'arranger', 'Arrangement credit', {
    required: false,
    max: 140,
    fallback: 'Original for carillon'
  });
  const notes = textField(fields, body, 'notes', 'Notes', { required: false, max: MAX_STRING });
  const durationMinutes = intField(fields, body, 'durationMinutes', 'Duration', { min: 1, max: 60 });
  const requestedOrder = intField(fields, body, 'order', 'Programme position', { min: 1, max: 999 });
  assertNoFieldErrors(fields);

  const siblings = store.db.pieces.filter((piece) => piece.recitalId === recital.id);
  const nextOrder = siblings.reduce((max, piece) => Math.max(max, piece.order || 0), 0) + 1;

  const piece = {
    id: uid('pce'),
    recitalId: recital.id,
    title,
    composer,
    arranger: arranger || 'Original for carillon',
    order: requestedOrder || nextOrder,
    durationMinutes,
    notes,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  store.db.pieces.push(piece);
  await store.persist();
  return { status: 201, body: { piece: serializePiece(piece) } };
}

function requirePiece(store, id) {
  const piece = store.db.pieces.find((entry) => entry.id === id);
  if (!piece) throw new HttpError(404, 'That programme piece could not be found.');
  return piece;
}

async function handleUpdatePiece(ctx) {
  const { body, store } = ctx;
  const piece = requirePiece(store, ctx.params.id);
  const fields = {};

  if (body.title !== undefined) {
    piece.title = textField(fields, body, 'title', 'Piece title', { min: 1, max: 140 });
  }
  if (body.composer !== undefined) {
    piece.composer = textField(fields, body, 'composer', 'Composer', { min: 1, max: 140 });
  }
  if (body.arranger !== undefined) {
    piece.arranger = textField(fields, body, 'arranger', 'Arrangement credit', {
      required: false,
      max: 140,
      fallback: 'Original for carillon'
    });
  }
  if (body.notes !== undefined) {
    piece.notes = textField(fields, body, 'notes', 'Notes', { required: false, max: MAX_STRING });
  }
  if (body.durationMinutes !== undefined) {
    piece.durationMinutes = intField(fields, body, 'durationMinutes', 'Duration', { min: 1, max: 60 });
  }
  if (body.order !== undefined) {
    piece.order = intField(fields, body, 'order', 'Programme position', { min: 1, max: 999, required: true });
  }
  assertNoFieldErrors(fields);

  piece.updatedAt = nowIso();
  await store.persist();
  return { status: 200, body: { piece: serializePiece(piece) } };
}

async function handleDeletePiece(ctx) {
  const { store } = ctx;
  const piece = requirePiece(store, ctx.params.id);
  store.db.pieces = store.db.pieces.filter((entry) => entry.id !== piece.id);
  await store.persist();
  return { status: 200, body: { ok: true, deletedId: piece.id } };
}

async function handleListSlots(ctx) {
  const scope = ctx.url.searchParams.get('scope') || 'upcoming';
  const today = todayIso();
  let slots = ctx.store.db.practiceSlots.slice();
  if (scope === 'upcoming') slots = slots.filter((slot) => slot.date >= today);
  if (scope === 'past') slots = slots.filter((slot) => slot.date < today);
  if (scope === 'mine') slots = slots.filter((slot) => slot.claimedById === ctx.user.id);
  slots.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return left.startTime.localeCompare(right.startTime);
  });
  return { status: 200, body: { slots: slots.map((slot) => serializeSlot(ctx.store.db, slot)) } };
}

async function handleCreateSlot(ctx) {
  const { body, store } = ctx;
  const fields = {};
  const date = dateField(fields, body, 'date', 'Practice date');
  const startTime = body.startTime;
  const endTime = body.endTime;

  if (!isClockTime(startTime)) fields.startTime = 'Start time must be a valid time (HH:MM).';
  if (!isClockTime(endTime)) fields.endTime = 'End time must be a valid time (HH:MM).';
  if (!fields.startTime && !fields.endTime && minutesOfDay(endTime) <= minutesOfDay(startTime)) {
    fields.endTime = 'End time must be after the start time.';
  }

  const towerRoom = textField(fields, body, 'towerRoom', 'Tower room', { min: 2, max: 60 });
  const notes = textField(fields, body, 'notes', 'Notes', { required: false, max: MAX_STRING });
  assertNoFieldErrors(fields);

  const slot = {
    id: uid('prc'),
    date,
    startTime,
    endTime,
    towerRoom,
    claimedById: null,
    notes,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  store.db.practiceSlots.push(slot);
  await store.persist();
  return { status: 201, body: { slot: serializeSlot(store.db, slot) } };
}

function requireSlot(store, id) {
  const slot = store.db.practiceSlots.find((entry) => entry.id === id);
  if (!slot) throw new HttpError(404, 'That practice slot could not be found.');
  return slot;
}

async function handleClaimSlot(ctx) {
  const { store, user } = ctx;
  const slot = requireSlot(store, ctx.params.id);
  if (slot.claimedById === user.id) {
    throw new HttpError(409, 'You have already claimed this practice slot.');
  }
  if (slot.claimedById) {
    const owner = findUserById(store.db, slot.claimedById);
    throw new HttpError(
      409,
      `${owner ? owner.displayName : 'Another carillonneur'} has already claimed this practice slot.`
    );
  }
  slot.claimedById = user.id;
  slot.updatedAt = nowIso();
  await store.persist();
  return { status: 200, body: { slot: serializeSlot(store.db, slot) } };
}

async function handleReleaseSlot(ctx) {
  const { store, user } = ctx;
  const slot = requireSlot(store, ctx.params.id);
  if (!slot.claimedById) {
    throw new HttpError(409, 'This practice slot is not currently claimed.');
  }
  if (slot.claimedById !== user.id) {
    throw new HttpError(403, 'Only the carillonneur who claimed this slot can cancel it.');
  }
  slot.claimedById = null;
  slot.updatedAt = nowIso();
  await store.persist();
  return { status: 200, body: { slot: serializeSlot(store.db, slot) } };
}

async function handleDeleteSlot(ctx) {
  const { store } = ctx;
  const slot = requireSlot(store, ctx.params.id);
  store.db.practiceSlots = store.db.practiceSlots.filter((entry) => entry.id !== slot.id);
  await store.persist();
  return { status: 200, body: { ok: true, deletedId: slot.id } };
}

async function handleMeta(ctx) {
  return {
    status: 200,
    body: {
      towerRooms: TOWER_ROOMS,
      today: todayIso(),
      nextSunday: nextSundayIso(todayIso())
    }
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ROUTES = [
  { method: 'POST', pattern: /^\/api\/auth\/register$/, handler: handleRegister, auth: false },
  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: handleLogin, auth: false },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: handleLogout, auth: true },
  { method: 'GET', pattern: /^\/api\/auth\/me$/, handler: handleMe, auth: true },

  { method: 'GET', pattern: /^\/api\/meta$/, handler: handleMeta, auth: false },

  { method: 'GET', pattern: /^\/api\/recitals$/, handler: handleListRecitals, auth: true },
  { method: 'POST', pattern: /^\/api\/recitals$/, handler: handleCreateRecital, auth: true },
  { method: 'GET', pattern: /^\/api\/recitals\/([^/]+)$/, handler: handleGetRecital, auth: true, params: ['id'] },
  { method: 'PATCH', pattern: /^\/api\/recitals\/([^/]+)$/, handler: handleUpdateRecital, auth: true, params: ['id'] },
  { method: 'DELETE', pattern: /^\/api\/recitals\/([^/]+)$/, handler: handleDeleteRecital, auth: true, params: ['id'] },
  { method: 'POST', pattern: /^\/api\/recitals\/([^/]+)\/claim$/, handler: handleClaimRecital, auth: true, params: ['id'] },
  { method: 'POST', pattern: /^\/api\/recitals\/([^/]+)\/release$/, handler: handleReleaseRecital, auth: true, params: ['id'] },
  { method: 'GET', pattern: /^\/api\/recitals\/([^/]+)\/pieces$/, handler: handleListPieces, auth: true, params: ['id'] },
  { method: 'POST', pattern: /^\/api\/recitals\/([^/]+)\/pieces$/, handler: handleCreatePiece, auth: true, params: ['id'] },

  { method: 'PATCH', pattern: /^\/api\/pieces\/([^/]+)$/, handler: handleUpdatePiece, auth: true, params: ['id'] },
  { method: 'DELETE', pattern: /^\/api\/pieces\/([^/]+)$/, handler: handleDeletePiece, auth: true, params: ['id'] },

  { method: 'GET', pattern: /^\/api\/practice-slots$/, handler: handleListSlots, auth: true },
  { method: 'POST', pattern: /^\/api\/practice-slots$/, handler: handleCreateSlot, auth: true },
  { method: 'POST', pattern: /^\/api\/practice-slots\/([^/]+)\/claim$/, handler: handleClaimSlot, auth: true, params: ['id'] },
  { method: 'POST', pattern: /^\/api\/practice-slots\/([^/]+)\/release$/, handler: handleReleaseSlot, auth: true, params: ['id'] },
  { method: 'DELETE', pattern: /^\/api\/practice-slots\/([^/]+)$/, handler: handleDeleteSlot, auth: true, params: ['id'] }
];

function findSession(store, sessionId) {
  if (!sessionId) return null;
  const session = store.db.sessions.find((entry) => entry.id === sessionId);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) return null;
  return session;
}

async function handleApi(req, res, store, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  let route = null;
  let match = null;
  for (const candidate of ROUTES) {
    if (candidate.method !== method) continue;
    const result = pathname.match(candidate.pattern);
    if (result) {
      route = candidate;
      match = result;
      break;
    }
  }

  if (!route) {
    throw new HttpError(404, 'That API endpoint does not exist.');
  }

  const params = {};
  if (route.params) {
    route.params.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = findSession(store, cookies[SESSION_COOKIE]);
  const user = session ? findUserById(store.db, session.userId) : null;

  if (route.auth && !user) {
    throw new HttpError(401, 'Please sign in to continue.');
  }

  let body = {};
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    assertSameOrigin(req);
    body = await readJsonBody(req);
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';

  const ctx = { req, res, store, url, params, body, session, user, ip };
  const result = await route.handler(ctx);

  if (result && result.status) {
    send(res, result.status, result.body, result.headers || {});
    return;
  }
  send(res, 200, result ? result.body : {});
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function resolvePublicFile(relativePath) {
  const decoded = decodeURIComponent(relativePath);
  if (decoded.includes('\0')) return null;
  const resolved = path.resolve(PUBLIC_DIR, `.${path.posix.normalize(`/${decoded}`)}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(`${PUBLIC_DIR}${path.sep}`)) return null;
  return resolved;
}

function sendFile(res, filePath, status = 200) {
  const extension = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[extension] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=0, must-revalidate'
  });
  res.end(data);
}

function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const filePath = resolvePublicFile(pathname);
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  const hasExtension = path.posix.extname(pathname) !== '';
  if (hasExtension) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexFile)) {
    res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Client not built: public/index.html is missing.');
    return;
  }
  sendFile(res, indexFile);
}

// ---------------------------------------------------------------------------
// Server assembly
// ---------------------------------------------------------------------------

function createApp(options = {}) {
  const dataDir = path.resolve(PROJECT_ROOT, options.dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR);
  const dbFile = options.dbFile ? path.resolve(PROJECT_ROOT, options.dbFile) : path.join(dataDir, 'db.json');
  const store = createStore(dbFile);
  store.load();

  if (options.seed !== false) {
    const seeded = seedDemoData(store);
    if (seeded) console.log(`[seed] demo rota written to ${dbFile}`);
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      send(res, 400, { error: 'Bad request.' });
      return;
    }

    if (url.pathname === '/health') {
      send(res, 200, { status: 'ok', service: 'carillon-recital-rota' });
      return;
    }

    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (!isApi) {
      try {
        handleStatic(req, res, url.pathname);
      } catch (error) {
        console.error('[static] failed to serve', url.pathname, error);
        if (!res.headersSent) send(res, 500, { error: 'Could not load that file.' });
      }
      return;
    }

    handleApi(req, res, store, url).catch((error) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error && error.retryAfter) {
        res.setHeader('Retry-After', String(error.retryAfter));
      }
      sendError(res, error);
    });
  });

  return { server, store, dbFile };
}

function start(port = Number(process.env.PORT) || 3000) {
  const { server, dbFile } = createApp();
  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    console.log(`[carillon-rota] data file: ${dbFile}`);
    console.log(`[carillon-rota] listening on 0.0.0.0:${address.port}`);
  });
  server.on('error', (error) => {
    console.error('[carillon-rota] server error:', error);
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start, TOWER_ROOMS };
