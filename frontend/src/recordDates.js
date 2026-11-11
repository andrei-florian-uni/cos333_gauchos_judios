/**
 * Dates on a gravestone record, written out for the record pane (N8) and the
 * Years column of the results list.
 *
 * The archive stores every date in parts (day, month, year), so that a
 * partial date leaves the missing parts empty (Project Design › Application
 * Data Structure). These helpers join whatever parts are known, e.g.
 * "24 September 1904", "September 1904" or "1904", and do the same for the
 * Hebrew date of death, e.g. "28 Elul 5756".
 *
 * Where the stone carves no civil date, the archive may hold one worked out
 * from the Hebrew date of death or estimated from the age at death. Such a
 * date is a range: its earliest day sits in the date's own parts and its
 * latest in the `_upper` parts (birth_day_upper, …), which are set only for a
 * derived date. A range is written with the parts its two ends share written
 * once: "10–11 February 1920", "23 August – 20 September 1933".
 */

/** Civil month names, January first. */
const CIVIL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Hebrew month names, numbered as pyluach and the loader number them:
 * 1 Nisan … 7 Tishrei … 12 Adar (Adar I in a leap year), 13 Adar II.
 */
const HEBREW_MONTHS = {
  1: 'Nisan', 2: 'Iyar', 3: 'Sivan', 4: 'Tammuz', 5: 'Av', 6: 'Elul',
  7: 'Tishrei', 8: 'Cheshvan', 9: 'Kislev', 10: 'Tevet', 11: 'Shevat',
  12: 'Adar', 13: 'Adar II',
};

/**
 * Whether a field holds a value. Zero counts as a value, because an age at
 * death of 0 (an infant in the children's section) is on record.
 *
 * @param {*} value A field from the record.
 * @returns {boolean} False only for null, undefined and the empty string.
 */
export function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Whether a Hebrew year is a leap year: 7 years in every 19 have Adar I and
 * Adar II instead of a single Adar.
 *
 * @param {number} year A year of the Hebrew calendar, e.g. 5756.
 * @returns {boolean} True for a leap year.
 */
export function isHebrewLeapYear(year) {
  return ((7 * year + 1) % 19) < 7;
}

/**
 * Joins the known parts of a date with spaces, skipping the missing ones.
 *
 * @param {?number} day The day, or null.
 * @param {?string} monthName The month's name, or null.
 * @param {?number} year The year, or null.
 * @returns {?string} The date, or null when no part is known.
 */
function joinDate(day, monthName, year) {
  const parts = [day, monthName, year].filter(hasValue);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Writes out a civil date from its parts, e.g. "24 September 1904".
 *
 * @param {?number} day The day of the month, or null.
 * @param {?number} month The month, 1 to 12, or null.
 * @param {?number} year The year, or null.
 * @returns {?string} The date, or null when no part is known.
 */
export function formatCivilDate(day, month, year) {
  const monthName = hasValue(month) ? CIVIL_MONTHS[month - 1] : null;
  return joinDate(day, monthName, year);
}

/**
 * Writes out a Hebrew date from its parts, e.g. "28 Elul 5756". Month 12 is
 * "Adar I" in a leap year and "Adar" otherwise (or when the year is unknown).
 *
 * @param {?number} day The day of the month, or null.
 * @param {?number} month The month, numbered 1 (Nisan) to 13 (Adar II), or null.
 * @param {?number} year The Hebrew year, or null.
 * @returns {?string} The date, or null when no part is known.
 */
export function formatHebrewDate(day, month, year) {
  let monthName = hasValue(month) ? HEBREW_MONTHS[month] : null;
  if (month === 12 && hasValue(year) && isHebrewLeapYear(year)) monthName = 'Adar I';
  return joinDate(day, monthName, year);
}

/**
 * Whether a person's birth or death date was worked out rather than carved:
 * only a derived date has an upper year.
 *
 * @param {object} record The person's columns.
 * @param {string} kind 'birth' or 'death'.
 * @returns {boolean} True for a derived date.
 */
export function isDerivedDate(record, kind) {
  return hasValue(record[`${kind}_year_upper`]);
}

/**
 * Writes out a person's birth or death date: the carved parts as
 * formatCivilDate writes them, or a derived date as a range whose shared
 * parts are written once, e.g. "11 February 1920" (both ends the same day),
 * "10–11 February 1920", "23 August – 20 September 1933" or
 * "16 March 1889 – 15 March 1890".
 *
 * @param {object} record The person's columns (birth_day, …, death_year_upper).
 * @param {string} kind 'birth' or 'death'.
 * @returns {?string} The date or range, or null when no part is on record.
 */
export function formatPersonDate(record, kind) {
  const day = record[`${kind}_day`];
  const month = record[`${kind}_month`];
  const year = record[`${kind}_year`];
  if (!isDerivedDate(record, kind)) return formatCivilDate(day, month, year);

  const lastDay = record[`${kind}_day_upper`];
  const lastMonth = record[`${kind}_month_upper`];
  const lastYear = record[`${kind}_year_upper`];
  const last = formatCivilDate(lastDay, lastMonth, lastYear);
  if (year !== lastYear) return `${formatCivilDate(day, month, year)} – ${last}`;
  if (month !== lastMonth) return `${formatCivilDate(day, month, null)} – ${last}`;
  if (day !== lastDay) return `${day}–${last}`;
  return last;
}

/**
 * Writes the years of a date for the narrow Years column: "1950" for a carved
 * year, both years of a derived range over two civil years with a slash
 * ("1889/90", "1899/1900"), and the middle year with "c." for a range over
 * three or more ("c. 1914").
 *
 * @param {?number} year The date's year (the earliest, for a derived date).
 * @param {?number} upperYear The latest year of a derived date, else null.
 * @returns {?string} The years, or null when the year is not on record.
 */
export function formatYearSpan(year, upperYear) {
  if (!hasValue(year)) return null;
  if (!hasValue(upperYear) || upperYear === year) return String(year);
  if (upperYear - year === 1) {
    const sameCentury = Math.floor(year / 100) === Math.floor(upperYear / 100);
    return `${year}/${sameCentury ? String(upperYear).slice(-2) : upperYear}`;
  }
  return `c. ${Math.round((year + upperYear) / 2)}`;
}

/**
 * Formats the years of birth and death of a results row, e.g. "1890–1959",
 * "1889/90–1950", "d. 1914/15" or "b. 1890".
 *
 * @param {object} person A row with birth_year, birth_year_upper, death_year
 *   and death_year_upper.
 * @returns {string} The years, or a dash when neither is known.
 */
export function describeYears(person) {
  const birth = formatYearSpan(person.birth_year, person.birth_year_upper);
  const death = formatYearSpan(person.death_year, person.death_year_upper);
  if (birth && death) return `${birth}–${death}`;
  if (death) return `d. ${death}`;
  if (birth) return `b. ${birth}`;
  return '—';
}
