// Enumerations shared by the API and the UI. Sensitive attributes are always
// self-disclosed by psychologists and may be left as "Prefer not to say".
export const UNDISCLOSED = 'Prefer not to say';

export const OPTIONS = {
  genders: ['Woman', 'Man', 'Non-binary', 'Genderqueer', 'Transgender woman', 'Transgender man', UNDISCLOSED],
  orientations: ['Heterosexual', 'Gay', 'Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer', UNDISCLOSED],
  religions: ['No religion', 'Agnostic', 'Buddhist', 'Christian', 'Hindu', 'Jewish', 'Muslim', 'Sikh', 'Spiritual', 'Other', UNDISCLOSED],
  ethnicities: ['African', 'Black', 'East Asian', 'South Asian', 'Southeast Asian', 'Middle Eastern / North African',
    'Hispanic / Latino', 'Indigenous', 'Pacific Islander', 'White / European', 'Mixed heritage', 'Other', UNDISCLOSED],
  specialties: ['Anxiety', 'Depression', 'Trauma & PTSD', 'Relationships', 'LGBTQIA+ affirming', 'Grief & loss', 'ADHD',
    'Autism', 'Eating disorders', 'Addiction', 'OCD', 'Child & adolescent', 'Couples therapy', 'Family therapy',
    'Stress & burnout', 'Perinatal mental health', 'Chronic pain', 'Sleep', 'Cultural identity', 'Self-esteem'],
  modalities: ['CBT', 'DBT', 'ACT', 'EMDR', 'Psychodynamic', 'Schema therapy', 'Mindfulness-based', 'Person-centred',
    'Narrative therapy', 'Gottman method', 'Somatic therapy', 'Solution-focused'],
  languages: ['English', 'Mandarin', 'Cantonese', 'Spanish', 'Arabic', 'Hindi', 'Vietnamese', 'Greek', 'Italian',
    'Korean', 'Tagalog', 'Punjabi', 'French', 'Sign language'],
  bookingTypes: [
    { id: 'none', label: 'No online booking (clients message me)' },
    { id: 'link', label: 'Link to my clinic booking page' },
    { id: 'embed', label: 'Embed my clinic booking widget' },
    { id: 'api', label: 'Live integration via clinic booking API' },
  ],
};
