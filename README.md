# Therapezy

A swipe-style app for finding a psychologist. Clients swipe through profiles filtered by their preferences, message psychologists in real time and book sessions directly into the clinic's booking system. Psychologists create and manage their own profiles.

## Quick start

```bash
npm install
npm start            # http://localhost:3000
```

Requires Node 22.13 or later, which includes the `node:sqlite` module. The app has two other dependencies: `express` and `ws`.

The first time it starts, it fills the database with 16 fictional psychologists around Sydney. These demo accounts use the password `demo1234`:

| Role | Email |
|---|---|
| Client | `client@demo.com` |
| Psychologist | `psych@demo.com` (Dr Mai Nguyen) |
| More psychologists | `psych1@demo.com` … `psych15@demo.com` |

`npm run reset` deletes the database so the demo data is created again on the next start.

## Features

**Clients**
- **Discover:** a swipeable card deck. Drag right or tap ♥ to shortlist, drag left or tap ✕ to pass, and tap a card for the full profile. Arrow keys also work.
- **Preferences:** gender, age range, sexual orientation, religion, cultural background, languages, specialties, maximum fee, distance (from GPS or a chosen city) and telehealth options.
- Results are ranked by how many of the client's focus areas and languages match, then by distance. Matching specialties are highlighted in green.
- People the client passed on can be reviewed again once the deck runs out.
- **Shortlist, Messages, Bookings** tabs.

**Psychologists**
- A profile editor covering bio, title, registration number, photo, specialties, approaches, languages, clinic, location, fee, telehealth, and whether they're accepting new clients.
- Identity fields (gender, orientation, religion, ethnicity, age) are optional. "Prefer not to say" is always available.
- A "Show my profile to clients" toggle. Profiles are hidden until it's switched on.
- A choice of booking integration, with a **Test connection** button.

**Messaging**
- Real-time chat over WebSockets, with typing indicators, unread badges and read receipts.
- Booking confirmations appear in the chat thread for both sides.

## Clinic booking integration

Each psychologist picks one booking mode:

| Mode | What the client sees |
|---|---|
| `none` | A prompt to message the psychologist instead |
| `link` | A button that opens the clinic's booking page in a new tab |
| `embed` | The clinic's booking widget in an in-app iframe (the clinic must allow framing) |
| `api` | Live availability and one-tap booking inside the app |

### Booking API (mode `api`)

The server calls the clinic's system on the client's behalf. The API key is stored only on the server and is never sent to the browser. The clinic's practice-management system, or a small adapter in front of it, needs to implement two endpoints:

```
GET  {base}/availability?practitioner={id}&from={ISO}&to={ISO}
     Authorization: Bearer {apiKey}
  -> 200 { "slots": [ { "start": ISO, "end": ISO, "type": "Standard consultation" } ] }

POST {base}/bookings
     Authorization: Bearer {apiKey}
     { "practitioner": id, "start": ISO, "client": { "name", "email" }, "notes": "..." }
  -> 201 { "id": "external-ref", "status": "confirmed", "end": ISO }
  -> 409 { "error": "That time was just taken" }
```

`src/mockClinic.js` is a reference implementation, mounted at `/mock-clinic`. The seeded demo profiles use it, so the full booking flow works locally.

To support a commercial booking system (Cliniko, Halaxy, Jane, Power Diary, Calendly and so on), write an adapter that translates their API into these two endpoints. Another option is to add a new `case` to `getAvailability` and `createBooking` in `src/booking.js`.

## Project layout

```
src/server.js      REST API, WebSocket chat, matching/ranking
src/db.js          SQLite schema (node:sqlite)
src/auth.js        scrypt password hashing, bearer-token sessions
src/booking.js     booking integration adapters + URL validation
src/mockClinic.js  reference clinic booking API
src/seed.js        demo data
src/options.js     enumerations (genders, specialties, …)
public/            dependency-free single-page front end
```

## Before production

This is a working MVP. Health-related apps carry extra obligations, so do the following before real users touch it:

- **Privacy and compliance.** Messages and preferences are sensitive health data, so assess HIPAA, GDPR or the Australian Privacy Act as relevant. Encrypt data at rest, sign data-processing agreements with clinics, and publish a privacy policy and terms.
- **Verify practitioners.** Check registration numbers against the regulator (e.g. AHPRA) before allowing `published`.
- **Security.** Serve over HTTPS and set `NODE_ENV=production`, which enforces https booking URLs and blocks internal hosts. Add rate limiting, session expiry and CSRF/CORS policy. Add a DNS-resolution check against SSRF, and store clinic API keys in a secrets manager or encrypted.
- **Safety.** Add a crisis banner (already in the footer), message reporting and blocking, and a moderation workflow.
- **Scale.** Move to Postgres, and use Redis pub/sub for WebSockets across several instances. Store photos in object storage instead of using photo URLs.
- **Mobile.** The front end is mobile-first and can be wrapped as a PWA or ported to React Native with the same API.
