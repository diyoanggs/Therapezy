// Clinic booking integration. Each psychologist chooses how their clinic's
// booking system is connected:
//   none  – no online booking
//   link  – deep link to the clinic's own booking page (opens in a new tab)
//   embed – the clinic's booking widget, shown in an iframe inside the app
//   api   – live integration: the server proxies the clinic's booking API so
//           clients can see real availability and book without leaving the app.
//           The API key never leaves the server. See README "Booking API".

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i;

export function validateExternalUrl(value, { forServerFetch = false } = {}) {
  if (!value) return '';
  let u;
  try { u = new URL(value); } catch { throw new Error('Invalid URL'); }
  const prod = process.env.NODE_ENV === 'production';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !prod)) throw new Error('URL must use https');
  // Basic SSRF guard: the server must not be pointed at internal hosts in production.
  if (forServerFetch && prod && PRIVATE_HOST.test(u.hostname)) throw new Error('Internal hosts are not allowed');
  return u.toString();
}

async function clinicFetch(p, path, init = {}) {
  const base = validateExternalUrl(p.booking_api_base, { forServerFetch: true }).replace(/\/$/, '');
  const res = await fetch(base + path, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(p.booking_api_key ? { Authorization: `Bearer ${p.booking_api_key}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Clinic booking system responded ${res.status}`);
  return data;
}

const isIso = s => typeof s === 'string' && !Number.isNaN(Date.parse(s));

export async function getAvailability(p, { from, to }) {
  switch (p.booking_type) {
    case 'link': return { mode: 'link', url: p.booking_url };
    case 'embed': return { mode: 'embed', url: p.booking_url };
    case 'api': {
      const q = new URLSearchParams({ practitioner: p.booking_practitioner_id || '', from, to });
      const data = await clinicFetch(p, `/availability?${q}`);
      const slots = (Array.isArray(data.slots) ? data.slots : [])
        .filter(s => isIso(s.start) && Date.parse(s.start) > Date.now())
        .map(s => ({ start: new Date(s.start).toISOString(), end: isIso(s.end) ? new Date(s.end).toISOString() : null, type: String(s.type || '').slice(0, 60) }))
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, 300);
      return { mode: 'slots', slots };
    }
    default: return { mode: 'none' };
  }
}

export async function createBooking(p, { start, client, notes }) {
  if (p.booking_type !== 'api') throw new Error('This psychologist does not take in-app bookings');
  if (!isIso(start)) throw new Error('Invalid start time');
  const data = await clinicFetch(p, '/bookings', {
    method: 'POST',
    body: JSON.stringify({ practitioner: p.booking_practitioner_id || '', start, client, notes }),
  });
  return { externalRef: String(data.id ?? ''), status: data.status || 'confirmed', end: isIso(data.end) ? data.end : null };
}
