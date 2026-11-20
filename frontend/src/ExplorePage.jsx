/**
 * Explore page (/explore): the cemetery map (N4) filling the page under the
 * site's navigation bar (SiteNav.jsx), with the search panel (N2, N3) and the
 * record pane (N8) floating over its left side, so the map stays visible on
 * the right.
 *
 * On arrival the page loads every grave once from /api/map/graves, which
 * draws the map and holds everyone the filters can list. Until a name or a
 * filter is entered, the search panel stays collapsed: the search box, the
 * Filters button and a short note on how to search. Filters alone list
 * everyone who passes them, in cemetery order (sections women, children,
 * men; rows in natural order; stones by number), here in the browser. A name
 * search asks /api/search for every match, best first, filtered by the API.
 * Either list shows PAGE_SIZE people at first, and "Show more" adds PAGE_SIZE
 * at a time.
 *
 * The search lives in the URL (?q=…, plus any filters, such as
 * &death_from=1920&section=women), so a search from the landing page, a shared
 * link and the browser's Back button all show the right list; clearing the
 * name and the filters collapses the panel again.
 *
 * The map and the panels share one selection. Clicking a row, or a grave on
 * the map, loads the grave from /api/graves/<ref> and opens the record pane;
 * the map highlights the graves of a name search's results (or of everyone
 * who passes the filters) and flies to the grave that is open.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spinner, Alert, Form, Button } from 'react-bootstrap';
import { getMapGraves, getRecord, searchArchive } from './api.js';
import CemeteryMap from './CemeteryMap.jsx';
import FiltersMenu from './FiltersMenu.jsx';
import RecordPane from './RecordPane.jsx';
import SiteNav from './SiteNav.jsx';
import { describeYears } from './recordDates.js';
import { matchQuality, personNames } from './labels.js';
import {
  NO_FILTERS, clearFilters, describeFilters, hasFilters, passesFilters, readFilters,
  searchParamsFor,
} from './searchFilters.js';

/** How many people a list shows at first, and how many more each "Show more" adds. */
const PAGE_SIZE = 50;

/** No graves to highlight; one Set for good, so the map is not told of a change. */
const NO_MATCHES = new Set();

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
 * Lists the people of every grave, in the graves' order, each as a row of the
 * results list: the person's names and years with the grave's reference,
 * section, row, stone and photo. Photo-only stones hold no people, so they
 * add no rows.
 *
 * @param {Array<object>} graves The graves from /api/map/graves.
 * @returns {Array<object>} One row per person, in cemetery order.
 */
function listPeople(graves) {
  return graves.flatMap((grave) => grave.persons.map((person) => ({
    ...person,
    ref: grave.ref,
    section: grave.section,
    row: grave.row,
    stone: grave.stone,
    photo: grave.photo,
  })));
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
 * Renders the search box, the list (the results of the name in the URL, or
 * everyone who passes its filters; none before either is entered) and, once
 * a row or a grave is clicked, the record pane beside it.
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

  // Everyone in the archive, loaded once from /api/map/graves, as the list's
  // people and as the map's data. `archiveAttempt` counts the loads asked for,
  // so "Try again" after a failure loads again; `archive.attempt` is the load
  // whose outcome it holds.
  const [archiveAttempt, setArchiveAttempt] = useState(0);
  const [archive, setArchive] = useState({ attempt: -1, people: [], mapData: null, error: null });
  const archiveLoading = archive.attempt !== archiveAttempt;

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
  // Whether the record pane shows its additional details (N8). They are shown
  // at first; a visitor who folds them away with "Show less" keeps them folded
  // on the next record they open, until they leave the page.
  const [detailsOpen, setDetailsOpen] = useState(true);
  // The panels floating over the map, so the map can keep clear of them.
  const panelsRef = useRef(null);

  // Only a search with a name runs: the API finds no one without one.
  const searchKey = urlQuery ? `${attempt}:${searchString}` : '';
  const isLoading = searchKey !== '' && finished.key !== searchKey;
  const shown = !isLoading && searchKey !== '' ? finished : { results: [], error: null };

  // Load everyone when the page opens, and again on "Try again". A load still
  // running when the page closes is cancelled.
  useEffect(() => {
    const controller = new AbortController();
    getMapGraves(controller.signal)
      .then((mapData) => setArchive({
        attempt: archiveAttempt, people: listPeople(mapData.graves), mapData, error: null,
      }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setArchive({ attempt: archiveAttempt, people: [], mapData: null, error: err.message });
        }
      });
    return () => controller.abort();
  }, [archiveAttempt]);

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
   * Opens the record pane for a grave, from a click on a row or on the map:
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

  // The list: the name search's results, best first, or everyone who passes
  // the filters, in cemetery order. It opens only once a name or a filter is
  // entered (N2, N3); until then the panel is collapsed to the search box,
  // the Filters button and a note on how to search. The archive still loads
  // at once, for the map. If it fails, the error shows in the collapsed panel
  // too, with "Try again", since the map has no way to load it again.
  const isNameSearch = urlQuery !== '';
  const listOpen = isNameSearch || filtersSet;
  const everyoneFiltered = useMemo(
    () => archive.people.filter((person) => passesFilters(person, filters)),
    [archive.people, filters],
  );
  let rows = [];
  if (isNameSearch) rows = shown.results;
  else if (filtersSet) rows = everyoneFiltered;
  const listLoading = listOpen && (isNameSearch ? isLoading : archiveLoading);
  const listError = isNameSearch ? shown.error : archive.error;
  const count = rows.length;

  // How many rows are shown: PAGE_SIZE for each new list, PAGE_SIZE more after
  // each "Show more". The count belongs to the list it was raised for, so a
  // new search or a change of filters starts again from PAGE_SIZE.
  const listKey = isNameSearch ? searchKey : `everyone:${searchString}`;
  const [visible, setVisible] = useState({ key: '', count: PAGE_SIZE });
  const visibleCount = visible.key === listKey ? visible.count : PAGE_SIZE;

  // The graves the map highlights, once a name or a filter narrows the list:
  // • a name search: the rows shown so far, best first. It returns every
  //   match, weak ones too, and lighting them all would cover most of the
  //   cemetery; "Show more" lights up the next rows with the list.
  // • filters alone: everyone who passes, to show where they lie.
  // With neither, the panel is collapsed and no grave is highlighted.
  const highlight = (isNameSearch || filtersSet) && !listLoading && !listError;
  const highlightedRows = isNameSearch ? rows.slice(0, visibleCount) : rows;
  const highlightKey = highlightedRows.map((person) => person.ref).join(',');
  const matchRefs = useMemo(
    () => (highlight && highlightKey ? new Set(highlightKey.split(',')) : NO_MATCHES),
    [highlight, highlightKey],
  );

  return (
    <div className="explore-page">
      <SiteNav page="explore" />

      <div className="explore-body">
        <CemeteryMap
          mapData={archive.mapData}
          loadError={archive.error}
          matchRefs={matchRefs}
          selectedRef={selectedRef}
          onOpenRecord={openRecord}
          coveredRef={panelsRef}
        />

        {/* `record-open` lets a phone show the record in place of the search */}
        <div className={`explore-panels${paneOpen ? ' record-open' : ''}`} ref={panelsRef}>
          {/* Search panel (N2, N3) */}
          <section className="explore-panel" aria-label="Search">
            <h2 className="h5 mb-0">Archive search</h2>
            <SearchForm key={urlQuery} initialQuery={urlQuery} filters={filters} onSearch={handleSearch} />

            <div className="explore-panel-scroll mt-3">
              {/* The collapsed panel's note on how to search (N2) */}
              {!listOpen && (
                <p className="explore-help mb-0">
                  Type your relative&apos;s name (first name, surname or both, in Spanish or
                  Hebrew letters) and press Search. Use Filters to narrow the list by year of
                  birth, year of death, or where the grave lies in the cemetery (section and row).
                </p>
              )}

              {listLoading && (
                <div className="text-center py-4" role="status">
                  <Spinner animation="border" variant="success" />
                  <p className="mt-2 text-muted">{isNameSearch ? 'Searching archive...' : 'Loading the archive...'}</p>
                </div>
              )}

              {/* Error; the full list can be loaded again */}
              {!listLoading && listError && (
                <Alert variant="danger" className={listOpen ? undefined : 'mt-3 mb-0'}>
                  {listError}
                  {!isNameSearch && (
                    <Button variant="link" className="p-0 ms-2 align-baseline" onClick={() => setArchiveAttempt((n) => n + 1)}>
                      Try again
                    </Button>
                  )}
                </Alert>
              )}

              {/* Nobody to list */}
              {!listLoading && !listError && count === 0 && (isNameSearch || filtersSet) && (
                <Alert variant="info" role="status">
                  {isNameSearch
                    ? `No people found matching "${urlQuery}"${filtersSet ? ' with these filters' : ''}.`
                    : 'No people match these filters.'}
                  {filtersSet && (
                    <Button variant="link" className="p-0 ms-2 align-baseline" onClick={() => handleSearch(urlQuery, NO_FILTERS)}>
                      Clear filters
                    </Button>
                  )}
                </Alert>
              )}

              {!listLoading && count > 0 && (
                <>
                  <p className="text-muted small mb-2" role="status">
                    {isNameSearch
                      ? `${count} ${count === 1 ? 'result' : 'results'} · best match first · highlighted on the map`
                      : `${count} ${count === 1 ? 'person' : 'people'} · in cemetery order${filtersSet ? ' · highlighted on the map' : ''}`}
                  </p>
                  <ul className="result-list">
                    {rows.slice(0, visibleCount).map((person) => {
                      const names = personNames(person);
                      const quality = isNameSearch ? matchQuality(person.score, urlQuery) : null;
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
                              {/* A stone with only a Hebrew name shows it as the name, right to left */}
                              <span
                                className="fw-bold"
                                dir={names.primaryIsHebrew ? 'rtl' : undefined}
                                lang={names.primaryIsHebrew ? 'he' : undefined}
                              >
                                {names.primary}
                              </span>
                              {names.secondary && <span dir="rtl" lang="he">{names.secondary}</span>}
                            </span>
                            <span className="d-flex justify-content-between gap-2 small text-muted">
                              <span>{describeGrave(person)} · {describeYears(person)}</span>
                              {quality && (
                                <span
                                  className={`match-badge match-${quality.tone} align-self-center`}
                                  title={`Search score ${person.score.toFixed(2)}`}
                                >
                                  {quality.label}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Show more: the next PAGE_SIZE rows of the same list */}
                  {count > visibleCount && (
                    <div className="d-flex justify-content-between align-items-center mt-2 mb-1">
                      <span className="text-muted small">Showing {visibleCount} of {count}</span>
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => setVisible({ key: listKey, count: visibleCount + PAGE_SIZE })}
                      >
                        Show more
                      </Button>
                    </div>
                  )}
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
                  <RecordPane
                    record={selectedRecord}
                    onClose={closeRecord}
                    detailsOpen={detailsOpen}
                    onToggleDetails={() => setDetailsOpen((open) => !open)}
                  />
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
