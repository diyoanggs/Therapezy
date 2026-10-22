import { db } from './db.js';
import { hashPassword } from './auth.js';
import { MOCK_CLINIC_KEY } from './mockClinic.js';

// Demo data centred on Sydney CBD. All people are fictional.
const C = { lat: -33.8688, lng: 151.2093 };
const PSYCHS = [
  ['Dr Mai Nguyen', 'Clinical Psychologist', 'Woman', 41, 'Heterosexual', 'Buddhist', 'Southeast Asian', ['English', 'Vietnamese'], ['Anxiety', 'Depression', 'Cultural identity', 'Perinatal mental health'], ['CBT', 'ACT', 'Mindfulness-based'], 'Harbour Mind Clinic', 'Surry Hills', 0.012, -0.004, 220, 1, 'api'],
  ['Daniel Okafor', 'Counselling Psychologist', 'Man', 36, 'Gay', 'Christian', 'African', ['English'], ['LGBTQIA+ affirming', 'Relationships', 'Self-esteem', 'Depression'], ['Person-centred', 'Narrative therapy', 'ACT'], 'Rainbow Wellbeing', 'Newtown', 0.03, -0.03, 190, 1, 'api'],
  ['Dr Leila Haddad', 'Clinical Psychologist', 'Woman', 48, 'Prefer not to say', 'Muslim', 'Middle Eastern / North African', ['English', 'Arabic', 'French'], ['Trauma & PTSD', 'Anxiety', 'Grief & loss'], ['EMDR', 'CBT', 'Somatic therapy'], 'Parramatta Psychology Centre', 'Parramatta', 0.055, -0.21, 240, 1, 'link'],
  ['Sam Rivera', 'Psychologist', 'Non-binary', 29, 'Queer', 'No religion', 'Hispanic / Latino', ['English', 'Spanish'], ['LGBTQIA+ affirming', 'ADHD', 'Autism', 'Anxiety'], ['DBT', 'ACT', 'Person-centred'], 'Neurodiverse Minds', 'Redfern', 0.02, -0.006, 170, 1, 'api'],
  ['Dr James Whitfield', 'Clinical Neuropsychologist', 'Man', 58, 'Heterosexual', 'Christian', 'White / European', ['English'], ['ADHD', 'Autism', 'Child & adolescent'], ['CBT', 'Solution-focused'], 'North Shore Assessment Clinic', 'Chatswood', -0.07, -0.03, 280, 0, 'embed'],
  ['Priya Sharma', 'Psychologist', 'Woman', 33, 'Bisexual', 'Hindu', 'South Asian', ['English', 'Hindi', 'Punjabi'], ['Relationships', 'Couples therapy', 'Stress & burnout', 'Cultural identity'], ['Gottman method', 'Schema therapy', 'CBT'], 'Harris Park Family Psychology', 'Harris Park', 0.05, -0.19, 180, 1, 'api'],
  ['Dr Wei Chen', 'Clinical Psychologist', 'Man', 44, 'Heterosexual', 'Agnostic', 'East Asian', ['English', 'Mandarin', 'Cantonese'], ['OCD', 'Anxiety', 'Sleep', 'Stress & burnout'], ['CBT', 'ACT'], 'City Psychology Partners', 'Sydney CBD', 0.0, 0.0, 230, 1, 'api'],
  ['Rachel Goldberg', 'Psychologist', 'Woman', 52, 'Lesbian', 'Jewish', 'White / European', ['English'], ['Grief & loss', 'Depression', 'LGBTQIA+ affirming', 'Family therapy'], ['Psychodynamic', 'Narrative therapy'], 'Bondi Junction Counselling', 'Bondi Junction', 0.02, 0.04, 210, 1, 'none'],
  ['Tane Walker', 'Psychologist', 'Man', 39, 'Heterosexual', 'Spiritual', 'Pacific Islander', ['English'], ['Addiction', 'Trauma & PTSD', 'Cultural identity'], ['Narrative therapy', 'Solution-focused', 'Mindfulness-based'], 'Western Sydney Wellbeing', 'Blacktown', -0.02, -0.3, 160, 1, 'api'],
  ['Dr Sofia Rossi', 'Clinical Psychologist', 'Woman', 37, 'Heterosexual', 'Christian', 'White / European', ['English', 'Italian'], ['Eating disorders', 'Self-esteem', 'Anxiety', 'Child & adolescent'], ['CBT', 'DBT', 'Schema therapy'], 'Leichhardt Psychology', 'Leichhardt', 0.0, -0.05, 250, 1, 'api'],
  ['Jordan Taylor', 'Psychologist', 'Transgender man', 31, 'Pansexual', 'No religion', 'Mixed heritage', ['English', 'Sign language'], ['LGBTQIA+ affirming', 'Depression', 'Self-esteem', 'Stress & burnout'], ['ACT', 'Person-centred', 'Somatic therapy'], 'Telehealth only', 'Online', null, null, 150, 1, 'api'],
  ['Dr Hana Kim', 'Clinical Psychologist', 'Woman', 45, 'Heterosexual', 'Christian', 'East Asian', ['English', 'Korean'], ['Perinatal mental health', 'Anxiety', 'Family therapy', 'Child & adolescent'], ['CBT', 'Mindfulness-based', 'Psychodynamic'], 'Strathfield Family Clinic', 'Strathfield', 0.005, -0.12, 235, 1, 'link'],
  ['Arjun Singh', 'Psychologist', 'Man', 34, 'Heterosexual', 'Sikh', 'South Asian', ['English', 'Punjabi', 'Hindi'], ['Stress & burnout', 'Anxiety', 'Chronic pain', 'Sleep'], ['ACT', 'CBT', 'Mindfulness-based'], 'Liverpool Health Psychology', 'Liverpool', 0.05, -0.29, 175, 1, 'api'],
  ['Marisol Santos', 'Counselling Psychologist', 'Woman', 42, 'Heterosexual', 'Christian', 'Southeast Asian', ['English', 'Tagalog'], ['Grief & loss', 'Relationships', 'Couples therapy'], ['Gottman method', 'Person-centred'], 'Telehealth only', 'Online', null, null, 165, 1, 'api'],
  ['Dr Aisha Bello', 'Clinical Psychologist', 'Woman', 39, 'Heterosexual', 'Muslim', 'Black', ['English', 'French'], ['Trauma & PTSD', 'Depression', 'Cultural identity', 'Self-esteem'], ['EMDR', 'Schema therapy', 'Somatic therapy'], 'Inner West Trauma Clinic', 'Marrickville', 0.04, -0.05, 245, 1, 'api'],
  ['Alex Papadopoulos', 'Psychologist', 'Genderqueer', 27, 'Asexual', 'No religion', 'White / European', ['English', 'Greek'], ['Autism', 'ADHD', 'OCD', 'LGBTQIA+ affirming'], ['DBT', 'CBT', 'Solution-focused'], 'Spectrum Psychology', 'Marrickville', 0.042, -0.048, 155, 1, 'api'],
];

const BIOS = {
  default: n => `Hi, I'm ${n.split(' ').slice(-2).join(' ')}. I believe therapy works best when you feel genuinely understood. I offer a warm, collaborative and evidence-based space where we set goals together and move at your pace.`,
};

export function seedIfEmpty(baseUrl) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;
  const pw = hashPassword('demo1234');
  const addUser = db.prepare('INSERT INTO users (email, pass_hash, role, name) VALUES (?, ?, ?, ?)');
  const addPsych = db.prepare(`INSERT INTO psychologists (user_id, title, registration_no, gender, age, orientation, religion, ethnicity,
    languages, specialties, modalities, bio, clinic_name, address, lat, lng, fee, telehealth, published,
    booking_type, booking_url, booking_api_base, booking_api_key, booking_practitioner_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`);

  db.exec('BEGIN');
  PSYCHS.forEach(([name, title, gender, age, orient, rel, eth, langs, specs, mods, clinic, suburb, dLat, dLng, fee, tele, booking], i) => {
    const email = i === 0 ? 'psych@demo.com' : `psych${i}@demo.com`;
    const id = Number(addUser.run(email, pw, 'psychologist', name).lastInsertRowid);
    const online = dLat == null;
    addPsych.run(id, title, `PSY000${1000 + i}`, gender, age, orient, rel, eth, JSON.stringify(langs), JSON.stringify(specs),
      JSON.stringify(mods), BIOS.default(name), clinic, online ? 'Telehealth (Australia-wide)' : `${suburb} NSW`,
      online ? null : C.lat + dLat, online ? null : C.lng + dLng, fee, tele, booking,
      booking === 'link' ? 'https://example.com/book' : booking === 'embed' ? 'https://example.com/' : '',
      booking === 'api' ? `${baseUrl}/mock-clinic` : '', booking === 'api' ? MOCK_CLINIC_KEY : '', `prac-${id}`);
  });
  const clientId = Number(addUser.run('client@demo.com', pw, 'client', 'Alex Client').lastInsertRowid);
  db.prepare('INSERT INTO preferences (user_id, data) VALUES (?, ?)').run(clientId,
    JSON.stringify({ lat: C.lat, lng: C.lng, locationLabel: 'Sydney CBD', maxDistanceKm: 50, includeTelehealth: true }));
  // A starter conversation so the inbox isn't empty.
  db.prepare("INSERT INTO swipes (client_id, psych_id, dir) VALUES (?, 1, 'like')").run(clientId);
  const conv = Number(db.prepare('INSERT INTO conversations (client_id, psych_id) VALUES (?, 1)').run(clientId).lastInsertRowid);
  const msg = db.prepare('INSERT INTO messages (conv_id, sender_id, body) VALUES (?, ?, ?)');
  msg.run(conv, clientId, "Hi Dr Nguyen, I've been dealing with a lot of anxiety at work lately. Do you have availability for new clients?");
  msg.run(conv, 1, "Hi Alex, thanks for reaching out — that sounds really tough. Yes, I'm taking new clients. You can pick a time with the Book button, or we can chat a little here first.");
  db.exec('COMMIT');
  return true;
}
