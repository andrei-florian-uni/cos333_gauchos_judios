/**
 * Dates on a gravestone record, written out for the record pane (N8).
 *
 * The archive stores every date in parts (day, month, year), so that a
 * partial date leaves the missing parts empty (Project Design › Application
 * Data Structure). These helpers join whatever parts are known, e.g.
 * "24 September 1904", "September 1904" or "1904", and do the same for the
 * Hebrew date of death, e.g. "28 Elul 5756".
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
