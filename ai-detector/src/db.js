'use strict';
// Accounts and credits in SQLite (Node's built-in driver, no native deps).
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    credits INTEGER NOT NULL DEFAULT 0,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS free_grants (
    ip TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ip, day)
  );
  CREATE TABLE IF NOT EXISTS payments (
    session_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    amount_cents INTEGER,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    cost INTEGER NOT NULL,
    score REAL,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const FREE_CREDITS = Number(process.env.FREE_CREDITS ?? 5);
const FREE_ACCOUNTS_PER_IP_PER_DAY = Number(process.env.FREE_ACCOUNTS_PER_IP_PER_DAY ?? 2);

function getAccount(id) {
  if (!id || typeof id !== 'string') return null;
  return db.prepare('SELECT id, credits, email FROM accounts WHERE id = ?').get(id) || null;
}

/** New account; free credits only while this IP is under its daily allowance. */
function createAccount(ip) {
  const id = 'acct_' + crypto.randomBytes(18).toString('base64url');
  const day = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT count FROM free_grants WHERE ip = ? AND day = ?').get(ip, day);
  const free = (row?.count || 0) < FREE_ACCOUNTS_PER_IP_PER_DAY ? FREE_CREDITS : 0;
  db.prepare('INSERT INTO accounts (id, credits) VALUES (?, ?)').run(id, free);
  if (free) {
    db.prepare(`INSERT INTO free_grants (ip, day, count) VALUES (?, ?, 1)
      ON CONFLICT(ip, day) DO UPDATE SET count = count + 1`).run(ip, day);
  }
  return getAccount(id);
}

/** Atomically take `n` credits; returns false if the balance is too low. */
function spend(id, n) {
  return db.prepare('UPDATE accounts SET credits = credits - ? WHERE id = ? AND credits >= ?').run(n, id, n).changes === 1;
}

function refund(id, n) {
  db.prepare('UPDATE accounts SET credits = credits + ? WHERE id = ?').run(n, id);
}

/** Credit a paid Checkout session exactly once (webhook and redirect may both call this). */
function recordPayment({ sessionId, accountId, credits, amountCents, email }) {
  db.exec('BEGIN');
  try {
    const r = db.prepare(`INSERT OR IGNORE INTO payments (session_id, account_id, credits, amount_cents, email)
      VALUES (?, ?, ?, ?, ?)`).run(sessionId, accountId, credits, amountCents ?? null, email ?? null);
    if (r.changes === 1) {
      db.prepare('UPDATE accounts SET credits = credits + ?, email = COALESCE(?, email) WHERE id = ?')
        .run(credits, email ?? null, accountId);
    }
    db.exec('COMMIT');
    return r.changes === 1;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function logScan(accountId, kind, cost, score, label) {
  db.prepare('INSERT INTO scans (account_id, kind, cost, score, label) VALUES (?, ?, ?, ?, ?)')
    .run(accountId, kind, cost, score, label);
}

module.exports = { db, getAccount, createAccount, spend, refund, recordPayment, logScan };
