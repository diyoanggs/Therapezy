// A stand-in for a clinic's practice-management system that implements the
// Therapezy Booking API. Used by the seeded demo profiles so the live
// integration path can be exercised end to end. Mounted at /mock-clinic.
import express from 'express';

export const MOCK_CLINIC_KEY = 'demo-clinic-key';
const booked = new Map(); // practitioner -> Set(startIso)

// Deterministic "already taken" pattern so availability looks realistic.
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export const mockClinic = express.Router();
mockClinic.use(express.json());
mockClinic.use((req, res, next) =>
  req.headers.authorization === `Bearer ${MOCK_CLINIC_KEY}` ? next() : res.status(401).json({ error: 'Invalid clinic API key' }));

mockClinic.get('/availability', (req, res) => {
  const practitioner = String(req.query.practitioner || '');
  const from = new Date(req.query.from || Date.now());
  const to = new Date(req.query.to || Date.now() + 14 * 864e5);
  const taken = booked.get(practitioner) || new Set();
  const slots = [];
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    for (let hour = 9; hour < 17; hour++) {
      const s = new Date(d); s.setHours(hour, 0, 0, 0);
      const iso = s.toISOString();
      if (s <= from || hash(practitioner + iso) % 3 === 0 || taken.has(iso)) continue;
      slots.push({ start: iso, end: new Date(s.getTime() + 50 * 60e3).toISOString(), type: 'Standard consultation (50 min)' });
    }
  }
  res.json({ slots });
});

mockClinic.post('/bookings', (req, res) => {
  const { practitioner = '', start } = req.body || {};
  const taken = booked.get(practitioner) || new Set();
  if (taken.has(start)) return res.status(409).json({ error: 'That time was just taken — please pick another' });
  taken.add(start); booked.set(practitioner, taken);
  res.status(201).json({ id: `MC-${Date.now().toString(36).toUpperCase()}`, status: 'confirmed', end: new Date(Date.parse(start) + 50 * 60e3).toISOString() });
});
