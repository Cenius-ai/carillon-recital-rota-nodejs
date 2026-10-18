'use strict';

/**
 * Explicit seed entry point.
 *
 * The server seeds itself on boot, so this file is only needed when you want to
 * prepare data/db.json without starting anything. It never binds the HTTP port.
 *
 * Usage: node seed.js
 */

const { createApp } = require('./server.js');

const app = createApp();
const { db } = app.store;

console.log(`[seed] data file: ${app.dbFile}`);
console.log(`[seed] users: ${db.users.length}`);
console.log(`[seed] recitals: ${db.recitals.length}`);
console.log(`[seed] programme pieces: ${db.pieces.length}`);
console.log(`[seed] practice slots: ${db.practiceSlots.length}`);
console.log('[seed] demo sign-in: cenius@cenius.ai / cenius');
console.log('[seed] done — start the app with: node server.js');
