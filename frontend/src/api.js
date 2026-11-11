/**
 * Requests to the Gauchos Judíos API.
 *
 * Every component fetches through this module, so the API's address is set in
 * one place: the VITE_API_URL build variable. `.env.development` points it at
 * the local Flask server; the deployed site gets the Render web service's
 * HTTPS address from Render's environment settings.
 */

import { searchParamsFor } from './searchFilters.js';

// The API's address without a trailing slash; empty means the site's own origin.
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const SEARCH_FAILED = 'The search could not be completed. Please try again.';
const ARCHIVE_FAILED = 'The archive could not be loaded. Please try again.';
const RECORD_FAILED = 'The record could not be loaded. Please try again.';
const RECORD_NOT_FOUND = 'This grave record was not found.';

// The most results a search asks for: the API's largest limit, more than the
// archive's people, so that every match comes back and the page shows them
// a few at a time.
const SEARCH_LIMIT = 1000;

/**
 * Searches the archive by name, keeping only the people who pass the filters.
 *
 * @param {string} query The name typed, in either script and in any order.
 * @param {object} filters The filters (see searchFilters.js); those set to ''
 *   are not sent. The API applies them before it picks the best matches.
 * @param {AbortSignal} [signal] Cancels the request, e.g. when a newer search starts.
 * @returns {Promise<Array<object>>} Every matching person, best first. Each
 *   holds person_id, ref, section, row, stone, name_es, surname_es, name_he,
 *   surname_he, birth_year, birth_year_upper, death_year, death_year_upper,
 *   photo and score.
 * @throws {Error} When the API cannot be reached, answers with an error or
 *   does not answer with JSON; an AbortError when `signal` cancels the request.
 */
export async function searchArchive(query, filters, signal) {
  // e.g. /api/search?q=Eva&death_from=1920&section=women&limit=1000;
  // URLSearchParams encodes each value.
  const params = searchParamsFor(query, filters);
  params.set('limit', String(SEARCH_LIMIT));
  let response;
  try {
    response = await fetch(`${API_URL}/api/search?${params}`, { signal });
  } catch (err) {
    // A cancelled request is passed on as it is; a network failure gets a plain message.
    if (err.name === 'AbortError') throw err;
    throw new Error(SEARCH_FAILED, { cause: err });
  }
  if (!response.ok) {
    throw new Error(SEARCH_FAILED);
  }
  // A missing VITE_API_URL sends the request to the website itself, which
  // answers with its HTML page rather than JSON; report that plainly too.
  try {
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    throw new Error(SEARCH_FAILED, { cause: err });
  }
}

/**
 * Fetches every grave of the cemetery, in cemetery order (sections women,
 * children, men; rows in natural order; stones by number), with its people.
 * The one request will also serve the map: it carries each grave's outline
 * and state, which the explore page does not show yet.
 *
 * @param {AbortSignal} [signal] Cancels the request, e.g. when the page closes.
 * @returns {Promise<Array<object>>} The graves. Each holds ref, section, row,
 *   stone, state ('documented', 'incomplete' or 'missing'), centroid and
 *   outline (null until the grave is placed on the map), photo, and persons:
 *   the people on the stone, ordered by name, each with person_id, the four
 *   name columns, birth_year, birth_year_upper, death_year and death_year_upper.
 * @throws {Error} When the API cannot be reached, answers with an error or
 *   does not answer with JSON; an AbortError when `signal` cancels the request.
 */
export async function getMapGraves(signal) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/map/graves`, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(ARCHIVE_FAILED, { cause: err });
  }
  if (!response.ok) throw new Error(ARCHIVE_FAILED);
  try {
    const data = await response.json();
    return data.graves || [];
  } catch (err) {
    throw new Error(ARCHIVE_FAILED, { cause: err });
  }
}

/**
 * Fetches one grave, with its people and photos, by its reference.
 *
 * @param {string} ref The grave's reference, e.g. "W-12-4".
 * @returns {Promise<object>} The grave: ref, section, row, stone, persons
 *   (every column of each person on the stone) and photos (main photo first).
 * @throws {Error} When the API cannot be reached, knows no such grave or does
 *   not answer with JSON.
 */
export async function getRecord(ref) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/graves/${encodeURIComponent(ref)}`);
  } catch (err) {
    throw new Error(RECORD_FAILED, { cause: err });
  }
  if (response.status === 404) throw new Error(RECORD_NOT_FOUND);
  if (!response.ok) throw new Error(RECORD_FAILED);
  try {
    return await response.json();
  } catch (err) {
    throw new Error(RECORD_FAILED, { cause: err });
  }
}
