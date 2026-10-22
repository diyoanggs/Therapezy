import express from 'express';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db, parse } from './db.js';
import { OPTIONS, UNDISCLOSED } from './options.js';
import { hashPassword, verifyPassword, createSession, userForToken, requireAuth, requireRole } from './auth.js';
import { getAvailability, createBooking, validateExternalUrl } from './booking.js';
import { mockClinic } from './mockClinic.js';
import { seedIfEmpty } from './seed.js';

const PORT = Number(process.env.PORT || 3000);
// Public URL of this deployment (Render sets RENDER_EXTERNAL_URL automatically).
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
if (seedIfEmpty(BASE_URL)) console.log('Seeded demo data (password for all demo accounts: demo1234)');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), '..', 'public')));
app.use('/mock-clinic', mockClinic);

// Wrap async handlers so thrown errors become JSON responses.
const h = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  res.status(err.status || 400).json({ error: err.message || 'Something went wrong' });
});
const fail = (status, message) => Object.assign(new Error(message), { status });

// ---------- helpers ----------
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const oneOf = (v, list, fallback = UNDISCLOSED) => (list.includes(v) ? v : fallback);
const subset = (v, list) => (Array.isArray(v) ? [...new Set(v.filter(x => list.includes(x)))] : []);
const num = (v, min, max) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

function distanceKm(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const PSYCH_SELECT = `SELECT p.*, u.name, u.email FROM psychologists p JOIN users u ON u.id = p.user_id`;

// Public view of a profile: never exposes booking credentials or email.
function publicPsych(p, origin) {
  const d = distanceKm(origin, p);
  return {
    id: p.user_id, name: p.name, title: p.title, registrationNo: p.registration_no, photoUrl: p.photo_url,
    gender: p.gender, age: p.age, orientation: p.orientation, religion: p.religion, ethnicity: p.ethnicity,
    languages: parse(p.languages, []), specialties: parse(p.specialties, []), modalities: parse(p.modalities, []),
    bio: p.bio, clinicName: p.clinic_name, address: p.address, fee: p.fee, telehealth: !!p.telehealth,
    accepting: !!p.accepting, bookingType: p.booking_type, hasLocation: p.lat != null,
    distanceKm: d == null ? null : Math.round(d * 10) / 10,
  };
}

const getPrefs = userId => parse(db.prepare('SELECT data FROM preferences WHERE user_id = ?').get(userId)?.data, {});
const getPsychRow = id => db.prepare(`${PSYCH_SELECT} WHERE p.user_id = ?`).get(id);

// ---------- auth ----------
app.post('/api/auth/register', h((req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const name = str(req.body.name, 80);
  const password = String(req.body.password || '');
  const role = req.body.role === 'psychologist' ? 'psychologist' : 'client';
  if (!/^\S+@\S+\.\S+$/.test(email)) throw fail(400, 'Enter a valid email');
  if (!name) throw fail(400, 'Enter your name');
  if (password.length < 8) throw fail(400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw fail(409, 'An account with that email already exists');
  const id = Number(db.prepare('INSERT INTO users (email, pass_hash, role, name) VALUES (?, ?, ?, ?)')
    .run(email, hashPassword(password), role, name).lastInsertRowid);
  if (role === 'psychologist') db.prepare('INSERT INTO psychologists (user_id) VALUES (?)').run(id);
  else db.prepare('INSERT INTO preferences (user_id, data) VALUES (?, ?)').run(id, JSON.stringify({ maxDistanceKm: 25, includeTelehealth: true }));
  res.status(201).json({ token: createSession(id), user: { id, email, name, role } });
}));

app.post('/api/auth/login', h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(str(req.body.email, 120).toLowerCase());
  if (!u || !verifyPassword(String(req.body.password || ''), u.pass_hash)) throw fail(401, 'Incorrect email or password');
  res.json({ token: createSession(u.id), user: { id: u.id, email: u.email, name: u.name, role: u.role } });
}));

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.headers.authorization.replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.get('/api/options', (req, res) => res.json(OPTIONS));

// ---------- psychologist: own profile ----------
function ownProfile(id) {
  const p = getPsychRow(id);
  return {
    ...publicPsych(p), published: !!p.published, lat: p.lat, lng: p.lng,
    booking: { type: p.booking_type, url: p.booking_url, apiBase: p.booking_api_base,
      practitionerId: p.booking_practitioner_id, hasApiKey: !!p.booking_api_key },
  };
}

app.get('/api/psychologist/profile', requireAuth, requireRole('psychologist'), (req, res) => res.json(ownProfile(req.user.id)));

app.put('/api/psychologist/profile', requireAuth, requireRole('psychologist'), h((req, res) => {
  const b = req.body || {};
  const booking = b.booking || {};
  const type = OPTIONS.bookingTypes.some(t => t.id === booking.type) ? booking.type : 'none';
  const current = getPsychRow(req.user.id);
  const url = type === 'link' || type === 'embed' ? validateExternalUrl(str(booking.url, 500)) : '';
  const apiBase = type === 'api' ? validateExternalUrl(str(booking.apiBase, 500)) : '';
  if ((type === 'link' || type === 'embed') && !url) throw fail(400, 'Enter your clinic booking URL');
  if (type === 'api' && !apiBase) throw fail(400, 'Enter your clinic booking API base URL');
  // Blank key field means "keep the existing key".
  const apiKey = type !== 'api' ? '' : booking.apiKey ? str(booking.apiKey, 500) : current.booking_api_key;
  const photo = str(b.photoUrl, 500);

  const name = str(b.name, 80);
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  db.prepare(`UPDATE psychologists SET title=?, registration_no=?, photo_url=?, gender=?, age=?, orientation=?, religion=?, ethnicity=?,
    languages=?, specialties=?, modalities=?, bio=?, clinic_name=?, address=?, lat=?, lng=?, fee=?, telehealth=?, accepting=?, published=?,
    booking_type=?, booking_url=?, booking_api_base=?, booking_api_key=?, booking_practitioner_id=? WHERE user_id=?`).run(
    str(b.title, 80) || 'Psychologist', str(b.registrationNo, 40), photo ? validateExternalUrl(photo) : '',
    oneOf(b.gender, OPTIONS.genders), num(b.age, 18, 100), oneOf(b.orientation, OPTIONS.orientations),
    oneOf(b.religion, OPTIONS.religions), oneOf(b.ethnicity, OPTIONS.ethnicities),
    JSON.stringify(subset(b.languages, OPTIONS.languages)), JSON.stringify(subset(b.specialties, OPTIONS.specialties)),
    JSON.stringify(subset(b.modalities, OPTIONS.modalities)), str(b.bio, 2000), str(b.clinicName, 120), str(b.address, 200),
    num(b.lat, -90, 90), num(b.lng, -180, 180), num(b.fee, 0, 5000), b.telehealth ? 1 : 0, b.accepting === false ? 0 : 1,
    b.published ? 1 : 0, type, url, apiBase, apiKey, str(booking.practitionerId, 120), req.user.id);
  res.json(ownProfile(req.user.id));
}));

// Lets a psychologist verify their clinic integration before publishing.
app.post('/api/psychologist/booking/test', requireAuth, requireRole('psychologist'), h(async (req, res) => {
  const p = getPsychRow(req.user.id);
  const from = new Date().toISOString(), to = new Date(Date.now() + 14 * 864e5).toISOString();
  const r = await getAvailability(p, { from, to });
  res.json({ ok: true, mode: r.mode, slotCount: r.slots?.length ?? null, sample: r.slots?.slice(0, 3) });
}));

// ---------- client: preferences & discovery ----------
app.get('/api/preferences', requireAuth, requireRole('client'), (req, res) => res.json(getPrefs(req.user.id)));

app.put('/api/preferences', requireAuth, requireRole('client'), (req, res) => {
  const b = req.body || {};
  const prefs = {
    genders: subset(b.genders, OPTIONS.genders), orientations: subset(b.orientations, OPTIONS.orientations),
    religions: subset(b.religions, OPTIONS.religions), ethnicities: subset(b.ethnicities, OPTIONS.ethnicities),
    specialties: subset(b.specialties, OPTIONS.specialties), languages: subset(b.languages, OPTIONS.languages),
    ageMin: num(b.ageMin, 18, 100), ageMax: num(b.ageMax, 18, 100), maxFee: num(b.maxFee, 0, 5000),
    maxDistanceKm: num(b.maxDistanceKm, 1, 20000), includeTelehealth: !!b.includeTelehealth, telehealthOnly: !!b.telehealthOnly,
    lat: num(b.lat, -90, 90), lng: num(b.lng, -180, 180), locationLabel: str(b.locationLabel, 80),
  };
  db.prepare('INSERT INTO preferences (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data')
    .run(req.user.id, JSON.stringify(prefs));
  res.json(prefs);
});

// Hard filters on every preference that is set, then rank by how many of the
// client's focus areas / languages match and by proximity.
function matches(p, prefs) {
  const has = arr => Array.isArray(arr) && arr.length > 0;
  if (has(prefs.genders) && !prefs.genders.includes(p.gender)) return false;
  if (has(prefs.orientations) && !prefs.orientations.includes(p.orientation)) return false;
  if (has(prefs.religions) && !prefs.religions.includes(p.religion)) return false;
  if (has(prefs.ethnicities) && !prefs.ethnicities.includes(p.ethnicity)) return false;
  if (prefs.ageMin != null && (p.age == null || p.age < prefs.ageMin)) return false;
  if (prefs.ageMax != null && (p.age == null || p.age > prefs.ageMax)) return false;
  if (prefs.maxFee != null && p.fee != null && p.fee > prefs.maxFee) return false;
  if (has(prefs.specialties) && !prefs.specialties.some(s => p.specialties.includes(s))) return false;
  if (has(prefs.languages) && !prefs.languages.some(l => p.languages.includes(l))) return false;
  if (prefs.telehealthOnly) return p.telehealth;
  const inRange = p.distanceKm != null && (prefs.maxDistanceKm == null || p.distanceKm <= prefs.maxDistanceKm);
  if (prefs.lat == null) return true; // no location set: don't filter by distance
  return inRange || (prefs.includeTelehealth && p.telehealth);
}

function score(p, prefs) {
  const overlap = (a = [], b = []) => a.filter(x => b.includes(x));
  const specs = overlap(prefs.specialties, p.specialties);
  const langs = overlap(prefs.languages, p.languages);
  return { specs, langs, value: specs.length * 10 + langs.length * 4 + (p.accepting ? 5 : 0) - (p.distanceKm ?? 30) / 5 };
}

app.get('/api/discover', requireAuth, requireRole('client'), (req, res) => {
  const prefs = getPrefs(req.user.id);
  const rows = db.prepare(`${PSYCH_SELECT} WHERE p.published = 1 AND p.user_id NOT IN (SELECT psych_id FROM swipes WHERE client_id = ?)`).all(req.user.id);
  const list = rows.map(r => publicPsych(r, prefs)).filter(p => matches(p, prefs))
    .map(p => { const s = score(p, prefs); return { ...p, matchedSpecialties: s.specs, matchedLanguages: s.langs, _s: s.value }; })
    .sort((a, b) => b._s - a._s)
    .map(({ _s, ...p }) => p);
  const passed = db.prepare("SELECT COUNT(*) AS n FROM swipes WHERE client_id = ? AND dir = 'pass'").get(req.user.id).n;
  res.json({ results: list, passed });
});

app.post('/api/swipes', requireAuth, requireRole('client'), h((req, res) => {
  const psychId = Number(req.body.psychId);
  const dir = req.body.dir === 'like' ? 'like' : 'pass';
  if (!getPsychRow(psychId)) throw fail(404, 'Psychologist not found');
  db.prepare('INSERT INTO swipes (client_id, psych_id, dir) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET dir = excluded.dir, created_at = datetime(\'now\')')
    .run(req.user.id, psychId, dir);
  res.json({ ok: true });
}));

app.delete('/api/swipes/passes', requireAuth, requireRole('client'), (req, res) => {
  db.prepare("DELETE FROM swipes WHERE client_id = ? AND dir = 'pass'").run(req.user.id);
  res.json({ ok: true });
});

app.delete('/api/swipes/:psychId', requireAuth, requireRole('client'), (req, res) => {
  db.prepare('DELETE FROM swipes WHERE client_id = ? AND psych_id = ?').run(req.user.id, Number(req.params.psychId));
  res.json({ ok: true });
});

app.get('/api/shortlist', requireAuth, requireRole('client'), (req, res) => {
  const prefs = getPrefs(req.user.id);
  const rows = db.prepare(`${PSYCH_SELECT} JOIN swipes s ON s.psych_id = p.user_id WHERE s.client_id = ? AND s.dir = 'like' ORDER BY s.created_at DESC`).all(req.user.id);
  res.json(rows.map(r => publicPsych(r, prefs)));
});

app.get('/api/psychologists/:id', requireAuth, h((req, res) => {
  const p = getPsychRow(Number(req.params.id));
  if (!p || (!p.published && p.user_id !== req.user.id)) throw fail(404, 'Profile not found');
  const out = publicPsych(p, req.user.role === 'client' ? getPrefs(req.user.id) : null);
  if (req.user.role === 'client') out.liked = !!db.prepare("SELECT 1 FROM swipes WHERE client_id = ? AND psych_id = ? AND dir = 'like'").get(req.user.id, p.user_id);
  res.json(out);
}));

// ---------- messaging ----------
const sockets = new Map(); // userId -> Set<WebSocket>
function push(userId, payload) {
  for (const ws of sockets.get(userId) || []) if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function convFor(id, user) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!c || (c.client_id !== user.id && c.psych_id !== user.id)) throw fail(404, 'Conversation not found');
  return c;
}
const otherParty = (c, userId) => (c.client_id === userId ? c.psych_id : c.client_id);

function addMessage(conv, senderId, body, kind = 'text') {
  const id = Number(db.prepare('INSERT INTO messages (conv_id, sender_id, kind, body) VALUES (?, ?, ?, ?)').run(conv.id, senderId, kind, body).lastInsertRowid);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  for (const uid of [conv.client_id, conv.psych_id]) push(uid, { type: 'message', message: msg });
  return msg;
}

app.get('/api/conversations', requireAuth, (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT c.*, cu.name AS client_name, pu.name AS psych_name, p.photo_url, p.title,
      (SELECT body FROM messages m WHERE m.conv_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM messages m WHERE m.conv_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conv_id = c.id AND m.read_at IS NULL AND (m.sender_id IS NULL OR m.sender_id != ?)) AS unread
    FROM conversations c JOIN users cu ON cu.id = c.client_id JOIN users pu ON pu.id = c.psych_id
    JOIN psychologists p ON p.user_id = c.psych_id
    WHERE c.client_id = ? OR c.psych_id = ? ORDER BY COALESCE(last_at, c.created_at) DESC`).all(me, me, me);
  res.json(rows.map(r => ({
    id: r.id, psychId: r.psych_id, clientId: r.client_id, lastBody: r.last_body, lastAt: r.last_at, unread: r.unread,
    other: r.client_id === me
      ? { id: r.psych_id, name: r.psych_name, subtitle: r.title, photoUrl: r.photo_url, isPsych: true }
      : { id: r.client_id, name: r.client_name, subtitle: 'Client', isPsych: false },
  })));
});

app.post('/api/conversations', requireAuth, requireRole('client'), h((req, res) => {
  const psychId = Number(req.body.psychId);
  const p = getPsychRow(psychId);
  if (!p || !p.published) throw fail(404, 'Psychologist not found');
  db.prepare('INSERT INTO conversations (client_id, psych_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.user.id, psychId);
  db.prepare("INSERT INTO swipes (client_id, psych_id, dir) VALUES (?, ?, 'like') ON CONFLICT DO UPDATE SET dir = 'like'").run(req.user.id, psychId);
  res.json(db.prepare('SELECT * FROM conversations WHERE client_id = ? AND psych_id = ?').get(req.user.id, psychId));
}));

app.get('/api/conversations/:id/messages', requireAuth, h((req, res) => {
  const c = convFor(Number(req.params.id), req.user);
  const msgs = db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY id').all(c.id);
  const otherId = otherParty(c, req.user.id);
  const other = db.prepare('SELECT u.id, u.name, u.role, p.title, p.photo_url FROM users u LEFT JOIN psychologists p ON p.user_id = u.id WHERE u.id = ?').get(otherId);
  res.json({ conversation: c, other, messages: msgs });
}));

app.post('/api/conversations/:id/messages', requireAuth, h((req, res) => {
  const c = convFor(Number(req.params.id), req.user);
  const body = str(req.body.body, 4000);
  if (!body) throw fail(400, 'Message is empty');
  res.status(201).json(addMessage(c, req.user.id, body));
}));

app.post('/api/conversations/:id/read', requireAuth, h((req, res) => {
  const c = convFor(Number(req.params.id), req.user);
  db.prepare("UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE conv_id = ? AND read_at IS NULL AND (sender_id IS NULL OR sender_id != ?)").run(c.id, req.user.id);
  push(otherParty(c, req.user.id), { type: 'read', convId: c.id });
  res.json({ ok: true });
}));

// ---------- booking ----------
app.get('/api/psychologists/:id/availability', requireAuth, h(async (req, res) => {
  const p = getPsychRow(Number(req.params.id));
  if (!p || !p.published) throw fail(404, 'Profile not found');
  const from = new Date().toISOString(), to = new Date(Date.now() + 21 * 864e5).toISOString();
  try {
    res.json(await getAvailability(p, { from, to }));
  } catch (err) {
    res.json({ mode: 'error', error: `Couldn't reach the clinic's booking system (${err.message}). Try messaging instead.` });
  }
}));

app.post('/api/psychologists/:id/book', requireAuth, requireRole('client'), h(async (req, res) => {
  const p = getPsychRow(Number(req.params.id));
  if (!p || !p.published) throw fail(404, 'Profile not found');
  const start = str(req.body.start, 40), notes = str(req.body.notes, 1000);
  const r = await createBooking(p, { start, notes, client: { name: req.user.name, email: req.user.email } });
  const id = Number(db.prepare('INSERT INTO bookings (client_id, psych_id, start, end, external_ref, status, notes) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, p.user_id, start, r.end, r.externalRef, r.status, notes).lastInsertRowid);
  // Drop a booking card into the chat thread so both sides see it.
  db.prepare('INSERT INTO conversations (client_id, psych_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.user.id, p.user_id);
  const conv = db.prepare('SELECT * FROM conversations WHERE client_id = ? AND psych_id = ?').get(req.user.id, p.user_id);
  addMessage(conv, null, JSON.stringify({ bookingId: id, start, status: r.status, ref: r.externalRef }), 'booking');
  res.status(201).json(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id));
}));

app.get('/api/bookings', requireAuth, (req, res) => {
  const col = req.user.role === 'client' ? 'b.client_id' : 'b.psych_id';
  res.json(db.prepare(`SELECT b.*, cu.name AS client_name, pu.name AS psych_name, p.clinic_name, p.address
    FROM bookings b JOIN users cu ON cu.id = b.client_id JOIN users pu ON pu.id = b.psych_id JOIN psychologists p ON p.user_id = b.psych_id
    WHERE ${col} = ? ORDER BY b.start`).all(req.user.id));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- realtime ----------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const user = userForToken(new URL(req.url, 'http://x').searchParams.get('token'));
  if (!user) return ws.close(4401, 'unauthorised');
  if (!sockets.has(user.id)) sockets.set(user.id, new Set());
  sockets.get(user.id).add(ws);
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'typing') {
      try { const c = convFor(Number(msg.convId), user); push(otherParty(c, user.id), { type: 'typing', convId: c.id }); } catch { /* ignore */ }
    }
  });
  ws.on('close', () => sockets.get(user.id)?.delete(ws));
});

server.listen(PORT, () => console.log(`Therapezy running at ${BASE_URL}`));
