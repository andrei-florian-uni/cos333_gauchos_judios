/**
 * Explore page (/explore): the cemetery map (N4) filling the page, with the
 * search panel (N2, N3) and the record pane (N8) floating over its left side,
 * so the map stays visible on the right.
 *
 * The search lives in the URL (?q=…, plus any filters, such as
 * &death_from=1920&section=women), so a search from the landing page, a shared
 * link and the browser's Back button all show the right results. The filters
 * narrow a name search: the API finds no one for a search without a name.
 *
 * The map and the panels share one selection. Clicking a result, or a grave
 * on the map, loads the grave from /api/graves/<ref> and opens the record
 * pane; the map highlights the graves of the search results and flies to the
 * grave that is open.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Spinner, Alert, Form, Button } from 'react-bootstrap';
import { searchArchive, getRecord } from './api.js';
import CemeteryMap from './CemeteryMap.jsx';
import FiltersMenu from './FiltersMenu.jsx';
import RecordPane from './RecordPane.jsx';
import {
  NO_FILTERS, clearFilters, describeFilters, hasFilters, readFilters, searchParamsFor,
} from './searchFilters.js';

/**
 * Joins the non-empty parts of a name with spaces.
 *
 * @param {...?string} parts Name parts, any of which may be null.
 * @returns {string} The joined name, or an empty string.
 */
function joinName(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Describes where a grave is, e.g. "Women · Row 12 · Stone 4".
 *
 * @param {object} person A search result with section, row and stone.
 * @returns {string} The grave's location in words.
 */
function describeGrave(person) {
  const section = person.section.charAt(0).toUpperCase() + person.section.slice(1);
  return `${section} · Row ${person.row} · Stone ${person.stone}`;
}

/**
 * Formats the years of birth and death, e.g. "1890–1959" or "d. 1959".
 *
 * @param {object} person A search result with birth_year and death_year.
 * @returns {string} The years, or a dash when neither is known.
 */
function describeYears(person) {
  if (person.birth_year && person.death_year) return `${person.birth_year}–${person.death_year}`;
  if (person.death_year) return `d. ${person.death_year}`;
  if (person.birth_year) return `b. ${person.birth_year}`;
  return '—';
}

/**
 * The filters in use, as chips, each with a × that removes it.
 *
 * @param {object} props
 * @param {object} props.filters The filters in the URL.
 * @param {function(string[]): void} props.onRemove Called with the filter keys
 *   that a chip's × clears.
 * @returns {JSX.Element[]} One chip per filter in use; none when no filter is set.
 */
function FilterChips({ filters, onRemove }) {
  return describeFilters(filters).map((chip) => (
    <span key={chip.keys.join()} className="filter-chip">
      {chip.label}
      <button
        type="button"
        className="filter-chip-remove"
        aria-label={`Remove filter: ${chip.label}`}
        onClick={() => onRemove(chip.keys)}
      >
        ×
      </button>
    </span>
  ));
}

/**
 * The search box, with the Filters button and the chips of the filters in use
 * underneath. It starts from the URL's query; the page gives it a new `key`
 * whenever that query changes (Back, Forward, a new search), so the box always
 * shows the query whose results are listed.
 *
 * Every action here searches for the name currently in the box: pressing
 * Search, applying filters or removing a chip.
 *
 * @param {object} props
 * @param {string} props.initialQuery The query in the URL.
 * @param {object} props.filters The filters in the URL.
 * @param {function(string, object): void} props.onSearch Called with the
 *   trimmed query and the filters to search with.
 * @returns {JSX.Element} The search form and its filters.
 */
function SearchForm({ initialQuery, filters, onSearch }) {
  const [text, setText] = useState(initialQuery);

  /**
   * Hands the typed query to the page, with the filters unchanged.
   *
   * @param {Event} e The form's submit event.
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(text.trim(), filters);
  };

  return (
    <div className="mt-2">
      <Form onSubmit={handleSubmit} className="d-flex gap-2" role="search">
        <Form.Control
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search for a name..."
          aria-label="Name to search for"
        />
        <Button variant="success" type="submit" style={{ backgroundColor: '#3e5a4d', borderColor: '#3e5a4d' }}>
          Search
        </Button>
      </Form>
      <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
        <FiltersMenu filters={filters} onApply={(chosen) => onSearch(text.trim(), chosen)} />
        <FilterChips filters={filters} onRemove={(keys) => onSearch(text.trim(), clearFilters(filters, keys))} />
      </div>
    </div>
  );
}

/**
 * Renders the search box, the results of the query in the URL and, once a
 * result is clicked, the record pane beside them.
 *
 * @returns {JSX.Element} The explore page.
 */
function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  // A new filters object only when the URL's query string changes, so the
  // search effect below does not run again on every render.
  const urlParams = searchParams.toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(urlParams)), [urlParams]);
  const filtersSet = hasFilters(filters);
  // The whole search (name and filters) as one string, e.g. "q=Eva&section=women".
  const searchString = searchParamsFor(urlQuery, filters).toString();

  // `attempt` counts submissions, so that submitting the same search again
  // (after an error, say) runs the search again.
  const [attempt, setAttempt] = useState(0);
  // The outcome of the last search that finished, and which search it was.
  const [finished, setFinished] = useState({ key: '', results: [], error: null });

  // The record pane: the selected person merged with their grave, whether it
  // is loading, and why it could not be loaded.
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState(null);
  // The grave selected on the map; set at once on a click, before its record loads.
  const [selectedRef, setSelectedRef] = useState(null);
  // The record asked for last, as "<ref>|<person id>". A response for any
  // other record arrived late (the visitor clicked again, or closed the pane)
  // and is dropped.
  const requestedRecord = useRef(null);
  const paneOpen = Boolean(selectedRecord || recordLoading || recordError);
  // The panels floating over the map, so the map can keep clear of them.
  const panelsRef = useRef(null);

  // Only a search with a name runs: the API finds no one without one.
  const searchKey = urlQuery ? `${attempt}:${searchString}` : '';
  const isLoading = searchKey !== '' && finished.key !== searchKey;
  const shown = !isLoading && searchKey !== '' ? finished : { results: [], error: null };

  // Run the search whenever the query, the filters or the attempt change. A
  // search that a newer one overtakes is cancelled, so stale results never show.
  useEffect(() => {
    if (!urlQuery) return undefined;
    const controller = new AbortController();
    searchArchive(urlQuery, filters, controller.signal)
      .then((results) => setFinished({ key: searchKey, results, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') setFinished({ key: searchKey, results: [], error: err.message });
      });
    return () => controller.abort();
  }, [urlQuery, filters, searchKey]);

  /**
   * Closes the record pane and forgets any record still loading.
   */
  const closeRecord = () => {
    requestedRecord.current = null;
    setSelectedRecord(null);
    setSelectedRef(null);
    setRecordLoading(false);
    setRecordError(null);
  };

  /**
   * Starts a search. A new search goes into the URL, which runs it; the same
   * search again leaves the URL alone and counts a new attempt instead.
   * (Doing both for a new search would run the old one once more first.)
   * Either way the record pane closes, since its person may not be listed.
   *
   * @param {string} query The trimmed query; empty clears the results.
   * @param {object} newFilters The filters to search with.
   */
  const handleSearch = (query, newFilters) => {
    const next = searchParamsFor(query, newFilters);
    if (next.toString() === searchString) {
      setAttempt((count) => count + 1);
    } else {
      setSearchParams(next);
    }
    closeRecord();
  };

  /**
   * Opens the record pane for a grave, from a click on a result or on the map:
   * loads the grave and picks the person out of it, since a shared stone holds
   * several people. It only uses state setters and a ref, so it can stay the
   * same function between renders, which lets the map skip redrawing graves.
   *
   * @param {string} ref The grave's reference, e.g. "W-12-4".
   * @param {?string} personId The person to show, or null for a grave with no
   *   one named on it (a photo-only record).
   */
  const openRecord = useCallback((ref, personId) => {
    const key = `${ref}|${personId ?? ''}`;
    if (requestedRecord.current === key) return;
    requestedRecord.current = key;
    setSelectedRef(ref);
    setRecordLoading(true);
    setRecordError(null);
    getRecord(ref)
      .then((graveData) => {
        if (requestedRecord.current !== key) return;
        const fullPersonData = graveData.persons.find((p) => p.id === personId) || {};
        setSelectedRecord({ ...graveData, ...fullPersonData, person_id: personId });
        setRecordLoading(false);
      })
      .catch((err) => {
        if (requestedRecord.current !== key) return;
        // Clear the request too, so that clicking the same grave again retries.
        requestedRecord.current = null;
        setSelectedRecord(null);
        setRecordError(err.message);
        setRecordLoading(false);
      });
  }, []);

  // The graves of the search results, for the map to highlight. A new Set only
  // when the results change, so the map moves to them once per search.
  const matchRefs = useMemo(() => new Set(shown.results.map((person) => person.ref)), [shown.results]);

  const count = shown.results.length;

  return (
    <div className="explore-page">
      <header className="explore-header">
        <Link to="/" className="explore-home">&larr; Home</Link>
        <span className="explore-title">Gauchos Judíos · Cemetery explorer</span>
      </header>

      <div className="explore-body">
        <CemeteryMap
          matchRefs={matchRefs}
          selectedRef={selectedRef}
          onOpenRecord={openRecord}
          coveredRef={panelsRef}
        />

        <div className="explore-panels" ref={panelsRef}>
          {/* Search panel (N2, N3) */}
          <section className="explore-panel" aria-label="Search">
            <h2 className="h5 mb-0">Archive search</h2>
            <SearchForm key={urlQuery} initialQuery={urlQuery} filters={filters} onSearch={handleSearch} />

            <div className="explore-panel-scroll mt-3">
              {!urlQuery && !filtersSet && (
                <p className="text-muted small">
                  Search for a name, or click a grave on the map to open its record.
                </p>
              )}

              {/* Filters but no name */}
              {!urlQuery && filtersSet && (
                <Alert variant="info" role="status">
                  Type a name to search. The filters narrow a name search; they cannot list records on their own yet.
                </Alert>
              )}

              {isLoading && (
                <div className="text-center py-4" role="status">
                  <Spinner animation="border" variant="success" />
                  <p className="mt-2 text-muted">Searching archive...</p>
                </div>
              )}

              {shown.error && <Alert variant="danger">{shown.error}</Alert>}

              {!isLoading && !shown.error && urlQuery && count === 0 && (
                <Alert variant="info" role="status">
                  No people found matching "{urlQuery}"{filtersSet ? ' with these filters' : ''}.
                  {filtersSet && (
                    <Button variant="link" className="p-0 ms-2 align-baseline" onClick={() => handleSearch(urlQuery, NO_FILTERS)}>
                      Clear filters
                    </Button>
                  )}
                </Alert>
              )}

              {count > 0 && (
                <>
                  <p className="text-muted small mb-2" role="status">
                    {count} {count === 1 ? 'result' : 'results'} · best match first · highlighted on the map
                  </p>
                  <ul className="result-list">
                    {shown.results.map((person) => {
                      const latin = joinName(person.name_es, person.surname_es);
                      const hebrew = joinName(person.name_he, person.surname_he);
                      const isSelected = selectedRecord?.person_id === person.person_id;
                      return (
                        <li key={person.person_id}>
                          <button
                            type="button"
                            className={`result-item${isSelected ? ' result-item-selected' : ''}`}
                            aria-current={isSelected ? 'true' : undefined}
                            onClick={() => openRecord(person.ref, person.person_id)}
                          >
                            <span className="d-flex justify-content-between gap-2">
                              <span className="fw-bold">{latin || '—'}</span>
                              <span dir="rtl" lang="he">{hebrew}</span>
                            </span>
                            <span className="d-flex justify-content-between gap-2 small text-muted">
                              <span>{describeGrave(person)} · {describeYears(person)}</span>
                              <span className="badge bg-secondary align-self-center">{person.score.toFixed(2)}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </section>

          {/* Record pane (N8): loading, an error, or the selected record */}
          {paneOpen && (
            <section className="explore-panel explore-record" aria-label="Record">
              {recordLoading && (
                <div className="text-center py-5" role="status">
                  <Spinner animation="border" variant="success" />
                  <p className="mt-2 text-muted">Loading record...</p>
                </div>
              )}
              {!recordLoading && recordError && (
                <Alert variant="danger" dismissible onClose={closeRecord}>
                  {recordError}
                </Alert>
              )}
              {!recordLoading && selectedRecord && (
                <div className="explore-panel-scroll">
                  <RecordPane record={selectedRecord} onClose={closeRecord} />
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default ExplorePage;
