/**
 * The search filters of the explore page: which filters exist, how they are
 * kept in the URL, and how they are described to the visitor.
 *
 * The filters sit in the page's URL next to the name, for example
 * /explore?q=Eva&death_from=1920&death_to=1940&section=women, so that a
 * shared link or the browser's Back button shows the same search. The API
 * takes exactly the same parameters (backend/app.py › read_filters), so one
 * function, `searchParamsFor`, builds both the URL and the API request.
 *
 * In this module the filters are one object with a string for each key of
 * FILTER_KEYS. An empty string means the filter is not set.
 *
 * A name search is filtered by the API. The full list, shown before a name is
 * searched, is filtered here by `passesFilters`, which follows the API's rule:
 * a date worked out from a Hebrew date or an age at death passes when its
 * range of years touches the years chosen.
 */

/** The filter parameters, in the order they are written to the URL and the API. */
export const FILTER_KEYS = ['birth_from', 'birth_to', 'death_from', 'death_to', 'section', 'row'];

/** The year filters: the two bounds of each range, in years, inclusive. */
const YEAR_KEYS = ['birth_from', 'birth_to', 'death_from', 'death_to'];

/** A year as the API accepts it: one to four digits. */
const YEAR = /^[0-9]{1,4}$/;

/** Filters with nothing set. */
export const NO_FILTERS = Object.freeze(Object.fromEntries(FILTER_KEYS.map((key) => [key, ''])));

/**
 * The two ends of the year-of-birth slider. Carved births run from 1845 to
 * 1972 and births estimated from the age at death from 1830 to 1955
 * (November 2026); the slider reaches a little beyond both, so that every
 * record can be picked. A handle left at its end sets no bound.
 */
export const BIRTH_SLIDER = { min: 1820, max: 1980 };

/**
 * The two ends of the year-of-death slider. They reach a little beyond the
 * archive's earliest and latest years of death (1889–2023 in November 2026,
 * the dates worked out from Hebrew dates included), so that every record can
 * be picked. A handle left at its end sets no bound.
 */
export const DEATH_SLIDER = { min: 1880, max: 2030 };

/** The sections a visitor can choose. The men's section is not documented yet. */
export const SECTIONS = [
  { value: 'women', label: 'Women' },
  { value: 'children', label: 'Children' },
];

/**
 * Reads the filters from the page's URL. A value the API would refuse (a year
 * that is not a number, an unknown section) is ignored, so a mistyped link
 * still opens a working search.
 *
 * @param {URLSearchParams} searchParams The URL's query parameters.
 * @returns {object} One string per key of FILTER_KEYS; '' for a filter not set.
 */
export function readFilters(searchParams) {
  const filters = {};
  for (const key of FILTER_KEYS) {
    filters[key] = (searchParams.get(key) || '').trim();
  }
  for (const key of YEAR_KEYS) {
    if (!YEAR.test(filters[key])) filters[key] = '';
  }
  if (!SECTIONS.some((section) => section.value === filters.section)) {
    filters.section = '';
  }
  return filters;
}

/**
 * Builds the query parameters of a search: the name first, then each filter
 * that is set, always in the same order. Two identical searches therefore give
 * identical strings, which lets the page tell a repeated search from a new one.
 *
 * @param {string} query The name searched for; may be empty.
 * @param {object} filters The filters, as returned by readFilters.
 * @returns {URLSearchParams} The parameters, for the page's URL or the API.
 */
export function searchParamsFor(query, filters) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  for (const key of FILTER_KEYS) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return params;
}

/**
 * Tells whether any filter is set.
 *
 * @param {object} filters The filters, as returned by readFilters.
 * @returns {boolean} True if at least one filter has a value.
 */
export function hasFilters(filters) {
  return FILTER_KEYS.some((key) => filters[key] !== '');
}

/**
 * Returns a copy of the filters with some of them cleared.
 *
 * @param {object} filters The filters, as returned by readFilters.
 * @param {string[]} keys The filter keys to clear.
 * @returns {object} The new filters; the object passed in is left unchanged.
 */
export function clearFilters(filters, keys) {
  const cleared = { ...filters };
  for (const key of keys) cleared[key] = '';
  return cleared;
}

/**
 * Describes a year range in words: "1920–1940", "1920 or later",
 * "1940 or earlier", or "Any" when neither end is set.
 *
 * @param {string} from The earliest year, or '' for no lower bound.
 * @param {string} to The latest year, or '' for no upper bound.
 * @returns {string} The range in words.
 */
export function describeYearRange(from, to) {
  if (from && to) return `${from}–${to}`;
  if (from) return `${from} or later`;
  if (to) return `${to} or earlier`;
  return 'Any';
}

/**
 * Lists the chips shown under the search box, one per filter that is set. A
 * year range is one chip, whichever of its ends are set.
 *
 * @param {object} filters The filters, as returned by readFilters.
 * @returns {Array<{label: string, keys: string[]}>} Each chip's text, and the
 *   filter keys that removing the chip clears.
 */
export function describeFilters(filters) {
  const chips = [];
  if (filters.birth_from || filters.birth_to) {
    chips.push({ label: `Born ${describeYearRange(filters.birth_from, filters.birth_to)}`,
                 keys: ['birth_from', 'birth_to'] });
  }
  if (filters.death_from || filters.death_to) {
    chips.push({ label: `Died ${describeYearRange(filters.death_from, filters.death_to)}`,
                 keys: ['death_from', 'death_to'] });
  }
  if (filters.section) {
    const section = SECTIONS.find((option) => option.value === filters.section);
    chips.push({ label: `Section: ${section ? section.label : filters.section}`, keys: ['section'] });
  }
  if (filters.row) {
    chips.push({ label: `Row: ${filters.row}`, keys: ['row'] });
  }
  return chips;
}

/**
 * Writes a row label as the archive stores it, as the API does
 * (backend/db.py › normalise_row_label): the word "row" and all spaces are
 * dropped and letters are upper-cased, so "Misc row 2" becomes "MISC2".
 *
 * @param {string} label A row label as typed.
 * @returns {string} The stored form of the label.
 */
export function normaliseRowLabel(label) {
  return label.replace(/\brow\b/gi, ' ').replace(/\s+/g, '').toUpperCase();
}

/**
 * Tells whether a date's years touch a chosen range of years. A carved year
 * is a span of one year; a date worked out from a Hebrew date or an age at
 * death runs from its year to its upper year. This is the API's rule
 * (backend/app.py › overlaps).
 *
 * @param {?number} year The date's year, or null when it is not on record.
 * @param {?number} upperYear The latest year of a derived date, else null.
 * @param {string} from The earliest year chosen, or '' for no lower bound.
 * @param {string} to The latest year chosen, or '' for no upper bound.
 * @returns {boolean} True if any year of the date lies within the range. A
 *   date not on record passes only when neither bound is set.
 */
export function yearsOverlap(year, upperYear, from, to) {
  if (!from && !to) return true;
  if (year === null || year === undefined) return false;
  const last = upperYear ?? year;
  return (!from || last >= Number(from)) && (!to || year <= Number(to));
}

/**
 * Tells whether a person of the full list passes every filter that is set.
 *
 * @param {object} person A person with birth_year, birth_year_upper,
 *   death_year, death_year_upper, section and row.
 * @param {object} filters The filters, as returned by readFilters.
 * @returns {boolean} True if the person passes them all.
 */
export function passesFilters(person, filters) {
  return yearsOverlap(person.birth_year, person.birth_year_upper, filters.birth_from, filters.birth_to)
    && yearsOverlap(person.death_year, person.death_year_upper, filters.death_from, filters.death_to)
    && (!filters.section || person.section === filters.section)
    && (!filters.row || person.row === normaliseRowLabel(filters.row));
}
