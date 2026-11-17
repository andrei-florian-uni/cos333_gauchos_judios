/**
 * How people, places and search matches are written on screen, so that the
 * results list, the record pane and the map all say them the same way.
 *
 * Names come from the stones as the transcription read them, some in capitals
 * ("ELISA Y. DE HARIASCH") and some not ("Pola Lea de Iturman"). Words carved
 * in capitals are shown in title case, with Spanish particles in lower case
 * ("Elisa Y. de Hariasch"); a word already in mixed case is left as carved.
 *
 * Nothing here touches React, so every function can be tested alone.
 */

// Words that stay in lower case inside a name, as Spanish writes them.
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von']);

// A word written wholly in capitals: two or more capital letters, allowing
// accents and the joins of compound names ("GOLDENBERG-KATZ", "D'ANGELO").
const ALL_CAPITALS = /^(?=(?:.*\p{Lu}){2})[\p{Lu}'’.-]+$/u;

// The sections, as the record pane and the map name them.
const SECTION_NAMES = { women: "Women's section", children: "Children's section", men: "Men's section" };

/**
 * Joins the non-empty parts of a name with spaces.
 *
 * @param {...?string} parts Name parts, any of which may be null.
 * @returns {string} The joined name, or an empty string.
 */
export function joinName(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Writes one word carved in capitals in title case; any other word is kept.
 * Each part of a compound word is capitalised ("GOLDENBERG-KATZ" →
 * "Goldenberg-Katz", "D'ANGELO" → "D'Angelo").
 *
 * @param {string} word One word of a name.
 * @param {boolean} isFirst Whether it starts the name; a particle there keeps its capital.
 * @returns {string} The word as shown.
 */
export function displayWord(word, isFirst) {
  if (!ALL_CAPITALS.test(word)) return word;
  const lower = word.toLocaleLowerCase('es');
  if (!isFirst && PARTICLES.has(lower)) return lower;
  return lower.replace(/(^|[-'’])(\p{L})/gu, (_, join, letter) => join + letter.toLocaleUpperCase('es'));
}

/**
 * Writes a name in Latin script for display: its parts joined, with words
 * carved in capitals put in title case.
 *
 * @param {...?string} parts Name parts, any of which may be null.
 * @returns {string} The name as shown, or an empty string.
 */
export function displayLatinName(...parts) {
  return joinName(...parts)
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => displayWord(word, index === 0))
    .join(' ');
}

/**
 * Works out how to show a person's names: the Latin name first, with the
 * Hebrew one beside it; or, when the stone gives only Hebrew, the Hebrew name
 * as the main one, set right to left.
 *
 * @param {object} person A person with name_es, surname_es, name_he and surname_he.
 * @returns {{primary: string, primaryIsHebrew: boolean, secondary: string}} The
 *   main name ("Unidentified" when neither script has one), whether it is
 *   Hebrew, and the Hebrew name to show beside a Latin one (else empty).
 */
export function personNames(person) {
  const latin = displayLatinName(person.name_es, person.surname_es);
  const hebrew = joinName(person.name_he, person.surname_he);
  if (latin) return { primary: latin, primaryIsHebrew: false, secondary: hebrew };
  if (hebrew) return { primary: hebrew, primaryIsHebrew: true, secondary: '' };
  return { primary: 'Unidentified', primaryIsHebrew: false, secondary: '' };
}

/**
 * Names a section of the cemetery, e.g. "Women's section".
 *
 * @param {string} section 'women', 'children' or 'men'.
 * @returns {string} The section's name.
 */
export function sectionName(section) {
  return SECTION_NAMES[section] || section;
}

/**
 * Describes where a grave is, the one way the record pane writes it:
 * "Women's section · Row 43 · Stone 12".
 *
 * @param {object} grave Anything with section, row and stone.
 * @returns {string} The grave's location in words.
 */
export function describeLocation(grave) {
  return `${sectionName(grave.section)} · Row ${grave.row} · Stone ${grave.stone}`;
}

/**
 * The best score a search can give for a query: the search adds the best match
 * of one query word to a first name and of another to a surname, each at most
 * 1, so a one-word query scores up to 1 and a longer one up to 2.
 *
 * @param {string} query The name searched for.
 * @returns {number} 1 or 2.
 */
export function bestPossibleScore(query) {
  const words = query.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(Math.max(words, 1), 2);
}

/**
 * Says how well a person's name matched a search, in words rather than as the
 * search's score, which is kept for a tooltip. The score is judged against
 * the best the query could reach, so "Kaplan" scoring 1 and "Mendel Kaplan"
 * scoring 2 are both exact.
 *
 * @param {number} score The search's score for the person.
 * @param {string} query The name searched for.
 * @returns {{label: string, tone: string}} "Exact match", "Close match" or
 *   "Possible match", and the tone its badge is drawn in ('exact', 'close' or
 *   'possible').
 */
export function matchQuality(score, query) {
  const share = score / bestPossibleScore(query);
  if (share >= 0.97) return { label: 'Exact match', tone: 'exact' };
  if (share >= 0.85) return { label: 'Close match', tone: 'close' };
  return { label: 'Possible match', tone: 'possible' };
}
