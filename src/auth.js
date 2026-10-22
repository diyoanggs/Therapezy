import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'), b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

export function userForToken(token) {
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.email, u.role, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token) || null;
}

export function requireAuth(req, res, next) {
  const user = userForToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!user) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  next();
}

export const requireRole = role => (req, res, next) =>
  req.user.role === role ? next() : res.status(403).json({ error: `Only ${role}s can do that` });
