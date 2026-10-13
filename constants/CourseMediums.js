/**
 * Course medium (language of instruction) options.
 * Indian schools see the Indian languages; international schools see the
 * major world languages. English is first and is the default everywhere.
 */
export const MEDIUMS_INDIA = [
  'English', 'Hindi', 'Urdu', 'Arabic',
  'Assamese', 'Bengali', 'Dogri', 'Gujarati', 'Kannada', 'Kashmiri',
  'Maithili', 'Malayalam', 'Marathi', 'Nepali', 'Odia', 'Pali',
  'Prakrit', 'Punjabi', 'Sanskrit', 'Sindhi', 'Tamil', 'Telugu',
  'Others',
];

export const MEDIUMS_INTL = [
  'English', 'Arabic', 'French', 'Spanish', 'Portuguese', 'German', 'Italian',
  'Dutch', 'Russian', 'Turkish', 'Persian', 'Urdu', 'Hindi', 'Bengali',
  'Chinese (Mandarin)', 'Japanese', 'Korean', 'Indonesian', 'Malay', 'Thai',
  'Vietnamese', 'Filipino', 'Swahili', 'Amharic', 'Hausa', 'Yoruba', 'Zulu',
  'Hebrew', 'Greek', 'Polish', 'Ukrainian', 'Swedish', 'Bilingual', 'Others',
];

export const DEFAULT_MEDIUM = 'English';

/** Indian school (country IN, or old Indian billing with no country) → Indian list. */
export function isIndianSchool(user) {
  const cc = String(user?.schoolCountry || '').toUpperCase();
  if (cc) return cc === 'IN';
  return user?.billingModel !== 'subscription';
}

export function mediumList(user) {
  return isIndianSchool(user) ? MEDIUMS_INDIA : MEDIUMS_INTL;
}

/** Use the student's saved medium when it is set, otherwise English. */
export function initialMedium(saved) {
  const s = String(saved ?? '').trim();
  return s || DEFAULT_MEDIUM;
}
