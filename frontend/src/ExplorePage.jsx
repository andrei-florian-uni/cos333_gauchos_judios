/**
 * Explore page (/explore): a name search box with filters, the list of
 * people, and the record pane (N8) of the person selected in it.
 *
 * On arrival the page loads every grave once from /api/map/graves, the
 * request the cemetery map will use too, and lists everyone in cemetery order
 * (sections women, children, men; rows in natural order; stones by number).
 * The filters alone narrow that list, here in the browser. A name search asks
 * /api/search for every match, best first, filtered by the API. Either list
 * shows PAGE_SIZE people at first, and "Show more" adds PAGE_SIZE at a time.
 *
 * The search lives in the URL (?q=…, plus any filters, such as
 * &death_from=1920&section=women), so a search from the landing page, a shared
 * link and the browser's Back button all show the right list; clearing the
 * name returns to everyone. Clicking a row loads its grave from
 * /api/graves/<ref> and opens the record pane beside the list. The cemetery
 * map is not part of this page yet.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Table, Spinner, Alert, Form, Button, Row, Col } from 'react-bootstrap';
import { getMapGraves, getRecord, searchArchive } from './api.js';
import FiltersMenu from './FiltersMenu.jsx';
import RecordPane from './RecordPane.jsx';
import { describeYears } from './recordDates.js';
import {
  NO_FILTERS, clearFilters, describeFilters, hasFilters, passesFilters, readFilters,
  searchParamsFor,
} from './searchFilters.js';

/** How many people a list shows at first, and how many more each "Show more" adds. */
const PAGE_SIZE = 50;

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
    <div className="mt-3">
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
 * Renders the search box, the list (everyone, or the results of the name in
 * the URL) and, once a row is clicked, the record pane beside it.
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

  // Everyone in the archive, loaded once from /api/map/graves. `archiveAttempt`
  // counts the loads asked for, so "Try again" after a failure loads again;
  // `archive.attempt` is the load whose outcome it holds.
  const [archiveAttempt, setArchiveAttempt] = useState(0);
  const [archive, setArchive] = useState({ attempt: -1, people: [], error: null });
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
  // The person whose record was asked for last. A response for anyone else
  // arrived late (the visitor clicked again, or closed the pane) and is dropped.
  const requestedPerson = useRef(null);
  const paneOpen = Boolean(selectedRecord || recordLoading || recordError);

  // Only a search with a name runs: the API finds no one without one.
  const searchKey = urlQuery ? `${attempt}:${searchString}` : '';
  const isLoading = searchKey !== '' && finished.key !== searchKey;
  const shown = !isLoading && searchKey !== '' ? finished : { results: [], error: null };

  // Load everyone when the page opens, and again on "Try again". A load still
  // running when the page closes is cancelled.
  useEffect(() => {
    const controller = new AbortController();
    getMapGraves(controller.signal)
      .then((graves) => setArchive({ attempt: archiveAttempt, people: listPeople(graves), error: null }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setArchive({ attempt: archiveAttempt, people: [], error: err.message });
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
    requestedPerson.current = null;
    setSelectedRecord(null);
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
   * Opens the record pane for a clicked result: loads the person's grave and
   * picks the person out of it, since a shared stone holds several people.
   *
   * @param {object} person The search result clicked.
   */
  const handleRowClick = (person) => {
    if (requestedPerson.current === person.person_id) return;
    requestedPerson.current = person.person_id;
    setRecordLoading(true);
    setRecordError(null);
    getRecord(person.ref)
      .then((graveData) => {
        if (requestedPerson.current !== person.person_id) return;
        const fullPersonData = graveData.persons.find((p) => p.id === person.person_id) || {};
        setSelectedRecord({ ...graveData, ...fullPersonData, person_id: person.person_id });
        setRecordLoading(false);
      })
      .catch((err) => {
        if (requestedPerson.current !== person.person_id) return;
        // Clear the request too, so that clicking the same row again retries.
        requestedPerson.current = null;
        setSelectedRecord(null);
        setRecordError(err.message);
        setRecordLoading(false);
      });
  };

  // The list: the name search's results, best first, or everyone who passes
  // the filters, in cemetery order.
  const isNameSearch = urlQuery !== '';
  const everyoneFiltered = useMemo(
    () => archive.people.filter((person) => passesFilters(person, filters)),
    [archive.people, filters],
  );
  const rows = isNameSearch ? shown.results : everyoneFiltered;
  const listLoading = isNameSearch ? isLoading : archiveLoading;
  const listError = isNameSearch ? shown.error : archive.error;
  const count = rows.length;

  // How many rows are shown: PAGE_SIZE for each new list, PAGE_SIZE more after
  // each "Show more". The count belongs to the list it was raised for, so a
  // new search or a change of filters starts again from PAGE_SIZE.
  const listKey = isNameSearch ? searchKey : `everyone:${searchString}`;
  const [visible, setVisible] = useState({ key: '', count: PAGE_SIZE });
  const visibleCount = visible.key === listKey ? visible.count : PAGE_SIZE;

  return (
    <Container className="py-5 mt-5">
      <Row className="mb-4">
        <Col md={8} lg={6}>
          <h2>Archive Search</h2>
          <SearchForm key={urlQuery} initialQuery={urlQuery} filters={filters} onSearch={handleSearch} />
        </Col>
      </Row>

      {/* Loading State */}
      {listLoading && (
        <div className="text-center py-5" role="status">
          <Spinner animation="border" variant="success" />
          <p className="mt-2 text-muted">{isNameSearch ? 'Searching archive...' : 'Loading the archive...'}</p>
        </div>
      )}

      {/* Error State; the full list can be loaded again */}
      {!listLoading && listError && (
        <Alert variant="danger">
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

      {/* Results list, narrowed to make room for the record pane when one is open */}
      <div className="d-flex align-items-start gap-4 position-relative">
        <div className="flex-grow-1" style={{ maxWidth: paneOpen ? '55%' : '100%', transition: 'max-width 0.3s ease' }}>
          {!listLoading && count > 0 && (
            <p className="text-muted small mb-2" role="status">
              {isNameSearch
                ? `${count} ${count === 1 ? 'result' : 'results'} · best match first`
                : `${count} ${count === 1 ? 'person' : 'people'} · in cemetery order`}
            </p>
          )}

          {!listLoading && count > 0 && (
            <div className="table-responsive shadow-sm rounded">
              <Table hover className="align-middle mb-0 bg-white">
                <thead className="bg-light">
                  <tr>
                    <th>Name</th>
                    <th>Hebrew Name</th>
                    <th>Grave</th>
                    <th>Years</th>
                    {isNameSearch && <th>Score</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, visibleCount).map((person) => {
                    const latin = joinName(person.name_es, person.surname_es);
                    const hebrew = joinName(person.name_he, person.surname_he);
                    const isSelected = selectedRecord?.person_id === person.person_id;

                    return (
                      <tr
                        key={person.person_id}
                        onClick={() => handleRowClick(person)}
                        className={isSelected ? 'table-active' : ''}
                        style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                      >
                        <td className="fw-bold">{latin || '—'}</td>
                        <td className="fs-5" dir="rtl" lang="he">{hebrew || '—'}</td>
                        <td>
                          {describeGrave(person)}
                          <div className="text-muted small">{person.ref}</div>
                        </td>
                        <td>{describeYears(person)}</td>
                        {isNameSearch && (
                          <td><span className="badge bg-secondary">{person.score.toFixed(2)}</span></td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}

          {/* Show more: the next PAGE_SIZE rows of the same list */}
          {!listLoading && count > visibleCount && (
            <div className="d-flex justify-content-between align-items-center mt-3">
              <span className="text-muted small">Showing {visibleCount} of {count}</span>
              <Button
                variant="outline-secondary"
                onClick={() => setVisible({ key: listKey, count: visibleCount + PAGE_SIZE })}
              >
                Show more
              </Button>
            </div>
          )}
        </div>

        {/* Record pane (N8): loading, an error, or the selected record */}
        {paneOpen && (
          <div
            className="record-pane-wrapper"
            style={{
              width: '45%',
              position: 'sticky',
              top: '100px',
              animation: 'slideIn 0.3s ease-out'
            }}
          >
            {recordLoading && (
              <div className="text-center py-5 bg-white shadow-sm rounded border" role="status">
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
              <RecordPane record={selectedRecord} onClose={closeRecord} />
            )}
          </div>
        )}
      </div>
    </Container>
  );
}

export default ExplorePage;
