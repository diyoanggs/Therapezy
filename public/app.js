// Therapezy front end — a dependency-free SPA. All user content is inserted
// as text nodes (never innerHTML) to keep it XSS-safe.

// ---------- tiny DOM + API helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
// replaceChildren() that accepts nested arrays and skips null/false.
const mount = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const state = { token: localStorage.getItem('tz_token'), user: null, options: null, unread: 0, ws: null, listeners: new Set() };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { signOut(false); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

const go = hash => { location.hash = hash; };
const initials = name => name.replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/i, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
function hue(seed) { let x = 0; for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
const gradient = seed => { const b = 16 + (hue(seed) % 26); return `linear-gradient(135deg, hsl(${b + 16} 92% 52%), hsl(${b} 85% 38%))`; };
function avatar(person, size = 48) {
  const style = `width:${size}px;height:${size}px;font-size:${size * 0.38}px;background-image:${person.photoUrl ? `url("${encodeURI(person.photoUrl)}")` : gradient(person.name)}`;
  return h('div', { class: 'avatar', style, 'aria-hidden': 'true' }, person.photoUrl ? '' : initials(person.name));
}
function heroBg(p) { return p.photoUrl ? `background-image:url("${encodeURI(p.photoUrl)}")` : `background-image:${gradient(p.name)}`; }

const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = iso => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const fmtWhen = iso => `${fmtDay(iso)}, ${fmtTime(iso)}`;
function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? fmtTime(iso) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
const distanceLabel = p => (p.distanceKm != null ? `${p.distanceKm < 1 ? '<1' : Math.round(p.distanceKm)} km away` : p.telehealth ? 'Telehealth' : '');

// ---------- realtime ----------
function connectSocket() {
  if (!state.token || state.ws) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${state.token}`);
  state.ws = ws;
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    for (const fn of state.listeners) fn(msg);
    if (msg.type === 'message' && msg.message.sender_id !== state.user?.id) refreshUnread();
  };
  ws.onclose = () => { state.ws = null; if (state.token) setTimeout(connectSocket, 2000); };
}
const sendWs = obj => state.ws?.readyState === 1 && state.ws.send(JSON.stringify(obj));
function listen(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

async function refreshUnread() {
  if (!state.user) return;
  const convs = await api('/api/conversations').catch(() => []);
  state.unread = convs.reduce((n, c) => n + c.unread, 0);
  renderTabs();
}

// ---------- shell ----------
function setTop(title, { back, actions } = {}) {
  mount($('#topbar'), 
    back ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => (history.length > 1 ? history.back() : go(back)) }, '←') : null,
    h('h1', null, title === 'Therapezy' ? h('span', { class: 'logo' }, 'Therapezy') : title),
    actions || null,
  );
}

function renderTabs() {
  const nav = $('#tabs');
  if (!state.user) return nav.replaceChildren();
  const route = location.hash.split('/')[1] || '';
  const tabs = state.user.role === 'client'
    ? [['discover', '🔥', 'Discover'], ['shortlist', '💛', 'Shortlist'], ['messages', '💬', 'Messages'], ['bookings', '📅', 'Bookings'], ['preferences', '⚙️', 'Filters']]
    : [['messages', '💬', 'Messages'], ['bookings', '📅', 'Bookings'], ['my-profile', '🪪', 'My profile'], ['account', '👤', 'Account']];
  nav.replaceChildren(...tabs.map(([r, ic, label]) => h('a', { href: `#/${r}`, class: route === r || (r === 'messages' && route === 'chat') ? 'on' : '' },
    h('span', { class: 'ic' }, ic), label, r === 'messages' && state.unread ? h('span', { class: 'badge' }, state.unread) : null)));
}

function modal(title, content) {
  const root = $('#modal-root');
  const close = () => mount(root, );
  const back = h('div', { class: 'modal-back', onclick: e => e.target === back && close() },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      h('header', null, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      content));
  mount(root, back);
  return close;
}

function chipGroup(options, selected = [], { single = false } = {}) {
  const sel = new Set(selected);
  const el = h('div', { class: 'chips' }, options.map(o => {
    const c = h('span', { class: `chip ${sel.has(o) ? 'on' : ''}`, role: 'checkbox', tabindex: 0, 'aria-checked': String(sel.has(o)) }, o);
    const toggle = () => {
      if (single) { sel.clear(); el.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); }
      sel.has(o) && !single ? sel.delete(o) : sel.add(o);
      c.classList.toggle('on', sel.has(o)); c.setAttribute('aria-checked', String(sel.has(o)));
    };
    c.addEventListener('click', toggle);
    c.addEventListener('keydown', e => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), toggle()));
    return c;
  }));
  el.value = () => [...sel];
  return el;
}

const field = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);
const select = (options, value) => h('select', null, options.map(o => h('option', { value: o, selected: o === value }, o)));

// ---------- views ----------
function authView(root) {
  setTop('Therapezy');
  let mode = 'login', role = 'client';
  const err = h('p', { class: 'error' });
  const name = h('input', { type: 'text', autocomplete: 'name', placeholder: 'Your name' });
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'At least 8 characters', required: true });
  const roleSeg = h('div', { class: 'seg' },
    h('button', { type: 'button', class: 'on', onclick: e => setRole('client', e) }, "I'm looking for support"),
    h('button', { type: 'button', onclick: e => setRole('psychologist', e) }, "I'm a psychologist"));
  function setRole(r, e) { role = r; roleSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); }
  const regOnly = h('div', null, roleSeg, field('Name', name));
  const submit = h('button', { class: 'btn block', type: 'submit' }, 'Sign in');
  const modeSeg = h('div', { class: 'seg' },
    h('button', { type: 'button', class: 'on', onclick: e => setMode('login', e) }, 'Sign in'),
    h('button', { type: 'button', onclick: e => setMode('register', e) }, 'Create account'));
  function setMode(m, e) {
    mode = m; modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target));
    regOnly.hidden = m === 'login'; submit.textContent = m === 'login' ? 'Sign in' : 'Create account';
    pw.autocomplete = m === 'login' ? 'current-password' : 'new-password';
  }
  regOnly.hidden = true;

  async function onSubmit(e) {
    e.preventDefault(); err.textContent = ''; submit.disabled = true;
    try {
      const body = mode === 'login' ? { email: email.value, password: pw.value } : { email: email.value, password: pw.value, name: name.value, role };
      signIn(await api(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', body }), mode === 'register');
    } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
  }
  const demo = (em) => async () => { signIn(await api('/api/auth/login', { method: 'POST', body: { email: em, password: 'demo1234' } })); };

  mount(root, h('div', { class: 'auth' },
    h('p', { class: 'hero-t' }, 'Find a psychologist who ', h('span', null, 'gets you'), '.'),
    h('p', { class: 'muted' }, 'Swipe through psychologists that fit your preferences, chat before you commit, and book straight into their clinic.'),
    h('form', { class: 'card-box', onsubmit: onSubmit }, modeSeg, regOnly, field('Email', email), field('Password', pw), err, submit),
    h('div', { class: 'card-box' }, h('h2', null, 'Try the demo'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn secondary small', onclick: demo('client@demo.com') }, 'Demo client'),
        h('button', { class: 'btn secondary small', onclick: demo('psych@demo.com') }, 'Demo psychologist'))),
    crisisNote()));
}

const crisisNote = () => h('p', { class: 'crisis' }, 'Not for emergencies. If you are in crisis or at risk of harm, call your local emergency number or a crisis line (e.g. Lifeline 13 11 14 in Australia, 988 in the US).');

async function discoverView(root) {
  setTop('Therapezy', { actions: h('a', { class: 'icon-btn', href: '#/preferences', 'aria-label': 'Filters', style: 'display:grid;place-items:center;text-decoration:none' }, '⚙️') });
  const deck = h('div', { class: 'deck' });
  const controls = h('div', { class: 'deck-controls' });
  mount(root, deck, controls);
  let { results: list, passed } = await api('/api/discover');

  function render() {
    deck.replaceChildren(); controls.replaceChildren();
    if (!list.length) {
      deck.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🌱'),
        h('h2', null, "You've seen everyone who matches"),
        h('p', { class: 'muted' }, 'Try widening your filters', passed ? ' or take another look at people you passed on.' : '.'),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('a', { class: 'btn', href: '#/preferences' }, 'Adjust filters'),
          passed ? h('button', { class: 'btn secondary', onclick: async () => { await api('/api/swipes/passes', { method: 'DELETE' }); discoverView(root); } }, 'Review passes') : null)));
      return;
    }
    const visible = list.slice(0, 3);
    visible.slice().reverse().forEach((p, i, arr) => {
      const top = i === arr.length - 1;
      const card = profileCard(p);
      if (!top) card.classList.add('behind');
      else attachSwipe(card, dir => decide(p, dir, card), () => go(`#/psychologist/${p.id}`));
      deck.append(card);
    });
    const top = list[0], topCard = deck.lastChild;
    controls.append(
      h('button', { class: 'round pass', 'aria-label': `Pass on ${top.name}`, onclick: () => fling(topCard, -1, () => decide(top, 'pass')) }, '✕'),
      h('button', { class: 'round info', 'aria-label': `View ${top.name}'s profile`, onclick: () => go(`#/psychologist/${top.id}`) }, 'ℹ'),
      h('button', { class: 'round like', 'aria-label': `Shortlist ${top.name}`, onclick: () => fling(topCard, 1, () => decide(top, 'like')) }, '♥'));
  }

  async function decide(p, dir) {
    list = list.filter(x => x.id !== p.id);
    if (dir === 'pass') passed++;
    render();
    await api('/api/swipes', { method: 'POST', body: { psychId: p.id, dir } }).catch(e => toast(e.message));
    if (dir === 'like') toast(`${p.name} added to your shortlist`);
  }
  render();
}

function profileCard(p) {
  const tags = p.specialties.slice(0, 4).map(s => h('span', { class: `tag ${p.matchedSpecialties?.includes(s) ? 'hit' : ''}` }, s));
  return h('article', { class: 'pcard' },
    h('div', { class: 'stamp like' }, 'SHORTLIST'), h('div', { class: 'stamp nope' }, 'PASS'),
    h('div', { class: 'hero', style: heroBg(p) }, p.photoUrl ? '' : initials(p.name),
      h('div', { class: 'fade' }),
      h('div', { class: 'over' }, h('h2', null, p.name, p.age ? `, ${p.age}` : ''), h('p', null, `${p.title} · ${p.clinicName || ''}`))),
    h('div', { class: 'body' },
      h('div', { class: 'facts' },
        distanceLabel(p) ? h('span', null, '📍 ', distanceLabel(p)) : null,
        p.telehealth && p.distanceKm != null ? h('span', null, '💻 Telehealth') : null,
        p.fee != null ? h('span', null, `💲${p.fee}/session`) : null,
        h('span', null, '🗣 ', p.languages.join(', ')),
        !p.accepting ? h('span', null, '⏸ Waitlist') : null),
      h('div', null, tags)));
}

// Drag to swipe: right = shortlist, left = pass, tap = open profile.
function attachSwipe(card, onDecide, onTap) {
  let sx = 0, sy = 0, dx = 0, dragging = false;
  const like = $('.stamp.like', card), nope = $('.stamp.nope', card);
  card.addEventListener('pointerdown', e => { dragging = true; sx = e.clientX; sy = e.clientY; dx = 0; card.setPointerCapture(e.pointerId); card.classList.add('dragging'); });
  card.addEventListener('pointermove', e => {
    if (!dragging) return;
    dx = e.clientX - sx; const dy = e.clientY - sy;
    card.style.transform = `translate(${dx}px, ${dy * 0.3}px) rotate(${dx / 18}deg)`;
    like.style.opacity = Math.max(0, Math.min(1, dx / 100)); nope.style.opacity = Math.max(0, Math.min(1, -dx / 100));
  });
  const end = e => {
    if (!dragging) return;
    dragging = false; card.classList.remove('dragging');
    if (Math.abs(dx) > 110) return fling(card, Math.sign(dx), () => onDecide(dx > 0 ? 'like' : 'pass'));
    card.style.transform = ''; like.style.opacity = nope.style.opacity = 0;
    if (Math.abs(dx) < 5 && Math.abs(e.clientY - sy) < 5 && e.type === 'pointerup') onTap();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  card.addEventListener('keydown', e => { if (e.key === 'ArrowRight') onDecide('like'); if (e.key === 'ArrowLeft') onDecide('pass'); });
  card.tabIndex = 0;
}
function fling(card, dir, then) {
  $(`.stamp.${dir > 0 ? 'like' : 'nope'}`, card).style.opacity = 1;
  card.style.transition = 'transform .3s ease-out';
  card.style.transform = `translate(${dir * 600}px, 40px) rotate(${dir * 30}deg)`;
  setTimeout(then, 220);
}

async function psychologistView(root, id) {
  setTop('Profile', { back: '#/discover' });
  const p = await api(`/api/psychologists/${id}`);
  const isClient = state.user.role === 'client';
  const dl = (rows) => h('dl', { class: 'kv' }, rows.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  const saveBtn = h('button', { class: 'btn secondary' }, p.liked ? '💛 Shortlisted' : '♡ Shortlist');
  saveBtn.onclick = async () => {
    p.liked = !p.liked;
    await api(p.liked ? '/api/swipes' : `/api/swipes/${p.id}`, p.liked ? { method: 'POST', body: { psychId: p.id, dir: 'like' } } : { method: 'DELETE' });
    saveBtn.textContent = p.liked ? '💛 Shortlisted' : '♡ Shortlist';
  };
  mount(root, 
    h('div', { class: 'profile-hero', style: heroBg(p) }, p.photoUrl ? '' : initials(p.name)),
    h('div', { class: 'card-box' },
      h('h2', { style: 'font-size:22px;margin:0' }, p.name, p.age ? `, ${p.age}` : ''),
      h('p', { class: 'muted', style: 'margin:2px 0 10px' }, p.title, p.registrationNo ? ` · Reg. ${p.registrationNo}` : ''),
      h('p', { style: 'white-space:pre-wrap;margin:0' }, p.bio || 'No bio yet.')),
    h('div', { class: 'card-box' }, h('h3', null, 'Focus areas'), p.specialties.map(s => h('span', { class: `tag ${p.matchedSpecialties?.includes(s) ? 'hit' : ''}` }, s)),
      p.modalities.length ? [h('h3', null, 'Approaches'), p.modalities.map(s => h('span', { class: 'tag' }, s))] : null),
    h('div', { class: 'card-box' }, h('h3', null, 'Practice'), dl([
      ['Clinic', p.clinicName], ['Location', p.address], ['Distance', distanceLabel(p)], ['Fee', p.fee != null ? `$${p.fee} per session` : ''],
      ['Telehealth', p.telehealth ? 'Available' : 'In person only'], ['New clients', p.accepting ? 'Accepting' : 'Waitlist'], ['Languages', p.languages.join(', ')]])),
    h('div', { class: 'card-box' }, h('h3', null, 'About them'), dl([
      ['Gender', p.gender], ['Sexuality', p.orientation], ['Religion', p.religion], ['Cultural background', p.ethnicity]]),
      h('p', { class: 'muted small', style: 'margin:10px 0 0' }, 'Self-disclosed by the psychologist.')),
    isClient ? h('div', { class: 'sticky-actions' },
      saveBtn,
      h('button', { class: 'btn secondary', onclick: () => startChat(p.id) }, '💬 Message'),
      h('button', { class: 'btn', onclick: () => bookingFlow(p) }, '📅 Book')) : null,
  );
}

async function startChat(psychId) {
  const conv = await api('/api/conversations', { method: 'POST', body: { psychId } });
  go(`#/chat/${conv.id}`);
}

async function bookingFlow(p) {
  const body = h('div', null, h('p', { class: 'muted' }, 'Checking availability…'));
  const close = modal(`Book with ${p.name}`, body);
  const a = await api(`/api/psychologists/${p.id}/availability`).catch(e => ({ mode: 'error', error: e.message }));
  const msgInstead = h('button', { class: 'btn secondary block', onclick: () => { close(); startChat(p.id); } }, '💬 Message instead');

  if (a.mode === 'link') {
    return mount(body, h('p', null, `${p.name} takes bookings through ${p.clinicName || 'their clinic'}'s own booking system.`),
      h('a', { class: 'btn block', href: a.url, target: '_blank', rel: 'noopener noreferrer', style: 'margin-bottom:10px' }, 'Open clinic booking page ↗'), msgInstead);
  }
  if (a.mode === 'embed') {
    return mount(body, h('iframe', { class: 'booking', src: a.url, title: 'Clinic booking', sandbox: 'allow-scripts allow-forms allow-same-origin allow-popups' }),
      h('p', { class: 'muted small' }, 'Booking powered by the clinic. ', h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open in new tab ↗')));
  }
  if (a.mode !== 'slots' || !a.slots.length) {
    return mount(body, h('p', null, a.mode === 'error' ? a.error : a.mode === 'slots' ? 'No times available in the next three weeks.' : `${p.name} doesn't take online bookings yet — send them a message to arrange a time.`), msgInstead);
  }

  let chosen = null;
  const byDay = Object.groupBy ? Object.groupBy(a.slots, s => new Date(s.start).toDateString()) : a.slots.reduce((m, s) => ((m[new Date(s.start).toDateString()] ||= []).push(s), m), {});
  const notes = h('textarea', { placeholder: 'Anything you’d like them to know before the first session? (optional)' });
  const confirm = h('button', { class: 'btn block', disabled: true }, 'Select a time');
  const err = h('p', { class: 'error' });
  const slotsEl = h('div', null, Object.values(byDay).slice(0, 10).map(slots => h('div', { class: 'day' },
    h('h4', null, fmtDay(slots[0].start)),
    h('div', { class: 'chips' }, slots.map(s => h('button', { class: 'slot', onclick: e => {
      slotsEl.querySelectorAll('.slot').forEach(x => x.classList.remove('on')); e.target.classList.add('on');
      chosen = s; confirm.disabled = false; confirm.textContent = `Book ${fmtWhen(s.start)}`;
    } }, fmtTime(s.start)))))));
  confirm.onclick = async () => {
    confirm.disabled = true; err.textContent = '';
    try {
      await api(`/api/psychologists/${p.id}/book`, { method: 'POST', body: { start: chosen.start, notes: notes.value } });
      close(); toast('Booked! Confirmation added to your messages.'); go('#/bookings');
    } catch (e) { err.textContent = e.message; confirm.disabled = false; }
  };
  mount(body, h('p', { class: 'muted small' }, `Live availability from ${p.clinicName || 'the clinic'}. ${a.slots[0].type || ''}`),
    slotsEl, field('Note for your psychologist', notes), err, confirm);
}

async function shortlistView(root) {
  setTop('Shortlist');
  const list = await api('/api/shortlist');
  mount(root, list.length ? list.map(p => h('a', { class: 'list-item', href: `#/psychologist/${p.id}` }, avatar(p, 52),
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, `${p.title} · ${distanceLabel(p)}`), h('div', { class: 's' }, p.specialties.slice(0, 3).join(' · '))),
    h('div', { class: 'meta' }, h('button', { class: 'btn small secondary', onclick: e => { e.preventDefault(); startChat(p.id); } }, 'Message')))) :
    h('div', { class: 'empty' }, h('div', { class: 'big' }, '💛'), h('h2', null, 'No one shortlisted yet'), h('p', { class: 'muted' }, 'Swipe right on psychologists you like to keep them here.'), h('a', { class: 'btn', href: '#/discover' }, 'Start discovering')));
}

async function messagesView(root) {
  setTop('Messages');
  const convs = await api('/api/conversations');
  state.unread = convs.reduce((n, c) => n + c.unread, 0); renderTabs();
  const preview = c => { if (!c.lastBody) return 'Say hello 👋'; try { const b = JSON.parse(c.lastBody); if (b.bookingId) return '📅 Session booked'; } catch {} return c.lastBody; };
  mount(root, convs.length ? convs.map(c => h('a', { class: 'list-item', href: `#/chat/${c.id}` }, avatar(c.other, 52),
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, c.other.name), h('div', { class: 's' }, preview(c))),
    h('div', { class: 'meta' }, fmtRelative(c.lastAt), h('br'), c.unread ? h('span', { class: 'dot' }, c.unread) : null))) :
    h('div', { class: 'empty' }, h('div', { class: 'big' }, '💬'), h('h2', null, 'No conversations yet'),
      h('p', { class: 'muted' }, state.user.role === 'client' ? 'Message a psychologist from their profile to ask questions before booking.' : 'When clients reach out, their messages will appear here.')));
  const off = listen(m => { if (m.type === 'message' && location.hash === '#/messages') messagesView(root); });
  return off;
}

async function chatView(root, id) {
  const { other, messages } = await api(`/api/conversations/${id}/messages`);
  setTop(other.name, { back: '#/messages', actions: other.role === 'psychologist' ? h('a', { class: 'btn small secondary', href: `#/psychologist/${other.id}` }, 'Profile') : null });
  const msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
  const typing = h('div', { class: 'typing' });
  const input = h('textarea', { placeholder: 'Message…', rows: 1, 'aria-label': 'Message' });
  const send = h('button', { class: 'btn', type: 'submit' }, 'Send');
  const form = h('form', { class: 'composer', onsubmit: async e => {
    e.preventDefault();
    const body = input.value.trim(); if (!body) return;
    input.value = ''; send.disabled = true;
    try { await api(`/api/conversations/${id}/messages`, { method: 'POST', body: { body } }); } catch (ex) { toast(ex.message); input.value = body; }
    send.disabled = false; input.focus();
  } }, input, send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  let lastTyping = 0;
  input.addEventListener('input', () => { if (Date.now() - lastTyping > 2000) { lastTyping = Date.now(); sendWs({ type: 'typing', convId: id }); } });

  const seen = new Set();
  function add(m) {
    if (seen.has(m.id)) return; seen.add(m.id);
    if (m.kind === 'booking') {
      const b = JSON.parse(m.body);
      msgs.append(h('div', { class: 'sys' }, h('strong', null, '📅 Session booked'), h('br'), fmtWhen(b.start), b.ref ? ` · Ref ${b.ref}` : ''));
    } else {
      const mine = m.sender_id === state.user.id;
      msgs.append(h('div', { class: `bubble ${mine ? 'me' : 'them'}` }, m.body, h('span', { class: 'time' }, fmtTime(m.created_at))));
    }
    msgs.scrollTop = msgs.scrollHeight;
  }
  mount(root, h('div', { class: 'chat' }, msgs, typing, form));
  if (!messages.length) msgs.append(h('div', { class: 'sys' }, state.user.role === 'client'
    ? 'Introduce yourself and what you’d like support with. Please don’t share anything urgent here — psychologists may not reply immediately.'
    : 'Start of conversation'));
  messages.forEach(add);
  const markRead = () => api(`/api/conversations/${id}/read`, { method: 'POST' }).then(refreshUnread).catch(() => {});
  markRead();
  let typingT;
  return listen(m => {
    if (m.type === 'message' && m.message.conv_id === id) { add(m.message); typing.textContent = ''; if (m.message.sender_id !== state.user.id) markRead(); }
    if (m.type === 'typing' && m.convId === id) { typing.textContent = `${other.name} is typing…`; clearTimeout(typingT); typingT = setTimeout(() => (typing.textContent = ''), 3000); }
  });
}

async function bookingsView(root) {
  setTop('Bookings');
  const list = await api('/api/bookings');
  const now = new Date().toISOString();
  const upcoming = list.filter(b => b.start >= now), past = list.filter(b => b.start < now).reverse();
  const item = b => h('div', { class: 'list-item' }, h('div', { class: 'avatar', style: `width:48px;height:48px;background:${gradient(b.psych_name)};font-size:20px` }, '📅'),
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, fmtWhen(b.start)),
      h('div', { class: 's' }, state.user.role === 'client' ? `${b.psych_name} · ${b.clinic_name}` : b.client_name),
      h('div', { class: 's' }, b.address, b.external_ref ? ` · Ref ${b.external_ref}` : '')),
    h('div', { class: 'meta' }, h('span', { class: 'tag' }, b.status)));
  mount(root, 
    list.length ? null : h('div', { class: 'empty' }, h('div', { class: 'big' }, '📅'), h('h2', null, 'No bookings yet'),
      h('p', { class: 'muted' }, state.user.role === 'client' ? 'Book from any psychologist’s profile.' : 'In-app bookings from clients appear here and are sent straight to your clinic system.')),
    upcoming.length ? [h('h3', { class: 'muted small' }, 'UPCOMING'), upcoming.map(item)] : null,
    past.length ? [h('h3', { class: 'muted small' }, 'PAST'), past.map(item)] : null,
    state.user.role === 'client' && list.length ? h('p', { class: 'muted small' }, 'Bookings made via a clinic’s own page or widget are managed by that clinic.') : null);
}

const CITIES = { 'Sydney CBD': [-33.8688, 151.2093], Melbourne: [-37.8136, 144.9631], Brisbane: [-27.4698, 153.0251], Perth: [-31.9523, 115.8613], London: [51.5074, -0.1278], 'New York': [40.7128, -74.006] };

async function preferencesView(root) {
  setTop('Your preferences');
  const [o, p] = [state.options, await api('/api/preferences')];
  const g = { genders: chipGroup(o.genders.filter(x => x !== 'Prefer not to say'), p.genders), orientations: chipGroup(o.orientations.filter(x => x !== 'Prefer not to say'), p.orientations),
    religions: chipGroup(o.religions.filter(x => x !== 'Prefer not to say'), p.religions), ethnicities: chipGroup(o.ethnicities.filter(x => x !== 'Prefer not to say'), p.ethnicities),
    specialties: chipGroup(o.specialties, p.specialties), languages: chipGroup(o.languages, p.languages) };
  const ageMin = h('input', { type: 'number', min: 18, max: 100, value: p.ageMin ?? '', placeholder: 'Any' });
  const ageMax = h('input', { type: 'number', min: 18, max: 100, value: p.ageMax ?? '', placeholder: 'Any' });
  const maxFee = h('input', { type: 'number', min: 0, value: p.maxFee ?? '', placeholder: 'Any' });
  const dist = h('input', { type: 'range', min: 1, max: 100, value: p.maxDistanceKm ?? 25, style: 'width:100%' });
  const distLabel = h('strong', null, `${dist.value} km`);
  dist.oninput = () => (distLabel.textContent = `${dist.value} km`);
  const tele = h('input', { type: 'checkbox', checked: p.includeTelehealth ?? true });
  const teleOnly = h('input', { type: 'checkbox', checked: !!p.telehealthOnly });
  let loc = { lat: p.lat, lng: p.lng, label: p.locationLabel };
  const locLabel = h('span', null, loc.lat != null ? loc.label || `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}` : 'Not set — distance won’t be used');
  const city = h('select', { onchange: () => { const c = CITIES[city.value]; if (c) { loc = { lat: c[0], lng: c[1], label: city.value }; locLabel.textContent = city.value; } } },
    h('option', { value: '' }, 'Choose a city…'), Object.keys(CITIES).map(c => h('option', { value: c }, c)));
  const useGps = h('button', { type: 'button', class: 'btn secondary small', onclick: () => {
    if (!navigator.geolocation) return toast('Location not available on this device');
    navigator.geolocation.getCurrentPosition(pos => { loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'My current location' }; locLabel.textContent = loc.label; },
      () => toast('Couldn’t get your location'));
  } }, '📍 Use my location');

  const save = h('button', { class: 'btn block' }, 'Save & show matches');
  save.onclick = async () => {
    const body = Object.fromEntries(Object.entries(g).map(([k, el]) => [k, el.value()]));
    Object.assign(body, { ageMin: ageMin.value, ageMax: ageMax.value, maxFee: maxFee.value, maxDistanceKm: Number(dist.value), includeTelehealth: tele.checked,
      telehealthOnly: teleOnly.checked, lat: loc.lat, lng: loc.lng, locationLabel: loc.label });
    await api('/api/preferences', { method: 'PUT', body });
    toast('Preferences saved'); go('#/discover');
  };
  const section = (title, hint, el) => [h('h3', null, title), hint ? h('p', { class: 'muted small', style: 'margin:-4px 0 8px' }, hint) : null, el];
  mount(root, 
    h('p', { class: 'muted small' }, 'Leave any section empty to see everyone. Psychologists choose what they disclose — if you filter on a trait, only people who’ve shared it will show.'),
    h('div', { class: 'card-box' }, section('What would you like help with?', 'Shows psychologists with at least one of these.', g.specialties)),
    h('div', { class: 'card-box' },
      h('h3', null, 'Location'), h('p', { style: 'margin:0 0 8px' }, locLabel), h('div', { class: 'row wrap', style: 'margin-bottom:10px' }, useGps, city),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Within'), distLabel), dist,
      h('label', { class: 'check' }, tele, 'Also show telehealth psychologists further away'),
      h('label', { class: 'check' }, teleOnly, 'Telehealth only')),
    h('div', { class: 'card-box' },
      section('Gender', null, g.genders),
      h('h3', null, 'Age'), h('div', { class: 'row' }, ageMin, h('span', { class: 'muted' }, 'to'), ageMax),
      section('Sexual orientation', null, g.orientations), section('Religion / spirituality', null, g.religions),
      section('Cultural background', null, g.ethnicities), section('Languages', null, g.languages)),
    h('div', { class: 'card-box' }, field('Max fee per session ($)', maxFee)),
    h('div', { class: 'sticky-actions' }, save));
}

async function myProfileView(root) {
  setTop('My profile', { actions: h('a', { class: 'btn small secondary', href: `#/psychologist/${state.user.id}` }, 'Preview') });
  const [o, p] = [state.options, await api('/api/psychologist/profile')];
  const inp = (type, value, attrs = {}) => h('input', { type, value: value ?? '', ...attrs });
  const f = {
    name: inp('text', p.name), title: inp('text', p.title), registrationNo: inp('text', p.registrationNo, { placeholder: 'e.g. PSY0001234567' }),
    photoUrl: inp('url', p.photoUrl, { placeholder: 'https://…' }), age: inp('number', p.age, { min: 18, max: 100 }),
    gender: select(o.genders, p.gender), orientation: select(o.orientations, p.orientation), religion: select(o.religions, p.religion), ethnicity: select(o.ethnicities, p.ethnicity),
    bio: h('textarea', { rows: 6, placeholder: 'How you work, who you work best with, what a first session looks like…' }, p.bio || ''),
    specialties: chipGroup(o.specialties, p.specialties), modalities: chipGroup(o.modalities, p.modalities), languages: chipGroup(o.languages, p.languages),
    clinicName: inp('text', p.clinicName), address: inp('text', p.address), fee: inp('number', p.fee, { min: 0 }),
    lat: inp('number', p.lat, { step: 'any', placeholder: 'Latitude' }), lng: inp('number', p.lng, { step: 'any', placeholder: 'Longitude' }),
    telehealth: h('input', { type: 'checkbox', checked: p.telehealth }), accepting: h('input', { type: 'checkbox', checked: p.accepting }),
    published: h('input', { type: 'checkbox', checked: p.published }),
  };
  const bt = h('select', null, o.bookingTypes.map(t => h('option', { value: t.id, selected: t.id === p.booking.type }, t.label)));
  const bUrl = inp('url', p.booking.url, { placeholder: 'https://yourclinic.example/book' });
  const bApi = inp('url', p.booking.apiBase, { placeholder: 'https://api.yourclinic.example/therapezy' });
  const bKey = inp('password', '', { placeholder: p.booking.hasApiKey ? '•••••••• (saved — leave blank to keep)' : 'API key from your clinic system', autocomplete: 'off' });
  const bPrac = inp('text', p.booking.practitionerId, { placeholder: 'Your practitioner ID in the clinic system' });
  const testOut = h('p', { class: 'small muted' });
  const linkFields = h('div', null, field('Booking page / widget URL', bUrl));
  const apiFields = h('div', null, field('Booking API base URL', bApi), field('API key', bKey), field('Practitioner ID', bPrac),
    h('button', { type: 'button', class: 'btn secondary small', onclick: async () => {
      testOut.textContent = 'Saving and testing…';
      try { await saveProfile(true); const r = await api('/api/psychologist/booking/test', { method: 'POST' }); testOut.textContent = `✅ Connected — ${r.slotCount} open slots in the next 2 weeks.`; }
      catch (e) { testOut.textContent = `❌ ${e.message}`; }
    } }, 'Test connection'), testOut,
    h('p', { class: 'small muted' }, 'Your clinic system (or an integration partner) exposes two endpoints: GET /availability and POST /bookings. Keys are stored server-side and never shown to clients.'));
  const syncBooking = () => { linkFields.hidden = !['link', 'embed'].includes(bt.value); apiFields.hidden = bt.value !== 'api'; };
  bt.onchange = syncBooking; syncBooking();

  async function saveProfile(quiet) {
    const v = el => el.value;
    const body = { name: v(f.name), title: v(f.title), registrationNo: v(f.registrationNo), photoUrl: v(f.photoUrl), age: v(f.age), gender: v(f.gender),
      orientation: v(f.orientation), religion: v(f.religion), ethnicity: v(f.ethnicity), bio: v(f.bio), specialties: f.specialties.value(), modalities: f.modalities.value(),
      languages: f.languages.value(), clinicName: v(f.clinicName), address: v(f.address), fee: v(f.fee), lat: v(f.lat), lng: v(f.lng),
      telehealth: f.telehealth.checked, accepting: f.accepting.checked, published: f.published.checked,
      booking: { type: bt.value, url: bUrl.value, apiBase: bApi.value, apiKey: bKey.value, practitionerId: bPrac.value } };
    await api('/api/psychologist/profile', { method: 'PUT', body });
    bKey.value = '';
    if (!quiet) toast(f.published.checked ? 'Profile saved and visible to clients' : 'Profile saved (hidden from clients)');
  }
  const err = h('p', { class: 'error' });
  const save = h('button', { class: 'btn block', onclick: async () => { err.textContent = ''; try { await saveProfile(); } catch (e) { err.textContent = e.message; } } }, 'Save profile');
  const pin = h('button', { type: 'button', class: 'btn secondary small', onclick: () => navigator.geolocation?.getCurrentPosition(pos => { f.lat.value = pos.coords.latitude.toFixed(5); f.lng.value = pos.coords.longitude.toFixed(5); }) }, '📍 Use current location');

  mount(root, 
    !p.published ? h('div', { class: 'notice' }, 'Your profile is hidden. Fill it in, then tick “Show my profile to clients”.') : null,
    h('div', { class: 'card-box' }, h('h2', null, 'Basics'),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, avatar({ name: p.name, photoUrl: p.photoUrl }, 64), h('div', { class: 'grow' }, field('Photo URL', f.photoUrl))),
      field('Full name', f.name), field('Professional title', f.title), field('Registration number', f.registrationNo), field('About you', f.bio)),
    h('div', { class: 'card-box' }, h('h2', null, 'Your practice'), h('h3', null, 'Focus areas'), f.specialties, h('h3', null, 'Approaches'), f.modalities,
      h('h3', null, 'Languages'), f.languages, h('div', { style: 'height:14px' }),
      field('Clinic name', f.clinicName), field('Address / suburb', f.address), h('div', { class: 'row' }, f.lat, f.lng), h('div', { style: 'margin:8px 0 12px' }, pin),
      field('Standard fee ($ per session)', f.fee),
      h('label', { class: 'check' }, f.telehealth, 'I offer telehealth'), h('label', { class: 'check' }, f.accepting, 'Accepting new clients')),
    h('div', { class: 'card-box' }, h('h2', null, 'About you (optional)'),
      h('p', { class: 'muted small', style: 'margin-top:0' }, 'Many clients look for a psychologist who shares their identity or lived experience. Share only what you’re comfortable with — “Prefer not to say” is always fine.'),
      field('Age', f.age), field('Gender', f.gender), field('Sexual orientation', f.orientation), field('Religion / spirituality', f.religion), field('Cultural background', f.ethnicity)),
    h('div', { class: 'card-box' }, h('h2', null, 'Clinic booking'), field('How should clients book?', bt), linkFields, apiFields),
    h('div', { class: 'card-box' }, h('label', { class: 'check' }, f.published, h('strong', null, 'Show my profile to clients'))),
    err, h('div', { class: 'sticky-actions' }, save));
}

function accountView(root) {
  setTop('Account');
  mount(root, h('div', { class: 'card-box' }, h('h2', null, state.user.name), h('p', { class: 'muted' }, state.user.email, ' · ', state.user.role),
    h('button', { class: 'btn secondary', onclick: () => signOut() }, 'Sign out')), crisisNote());
}

// ---------- session + router ----------
function signIn({ token, user }, isNew) {
  state.token = token; state.user = user; localStorage.setItem('tz_token', token);
  connectSocket(); refreshUnread();
  go(user.role === 'client' ? (isNew ? '#/preferences' : '#/discover') : (isNew ? '#/my-profile' : '#/messages'));
}
async function signOut(callApi = true) {
  if (callApi) await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  state.token = null; state.user = null; localStorage.removeItem('tz_token'); state.ws?.close();
  go('#/login'); render();
}

let cleanup = null;
async function render() {
  cleanup?.(); cleanup = null; $('#modal-root').replaceChildren();
  const root = $('#view');
  const [, route, arg] = location.hash.split('/');
  if (!state.user) { renderTabs(); return authView(root); }
  const client = state.user.role === 'client';
  const routes = {
    discover: client && discoverView, shortlist: client && shortlistView, preferences: client && preferencesView,
    psychologist: r => psychologistView(r, Number(arg)), messages: messagesView, chat: r => chatView(r, Number(arg)),
    bookings: bookingsView, 'my-profile': !client && myProfileView, account: accountView,
  };
  const view = routes[route];
  if (!view) return go(client ? '#/discover' : '#/messages');
  renderTabs(); window.scrollTo(0, 0);
  try { cleanup = (await view(root)) || null; }
  catch (e) { mount(root, h('div', { class: 'empty' }, h('h2', null, 'Something went wrong'), h('p', { class: 'muted' }, e.message))); }
}

(async function boot() {
  state.options = await api('/api/options');
  if (state.token) {
    try { state.user = (await api('/api/me')).user; connectSocket(); refreshUnread(); } catch { state.token = null; }
  }
  addEventListener('hashchange', render);
  render();
})();
