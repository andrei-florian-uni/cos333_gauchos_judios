/**
 * Explore page (/explore): a name search box with filters, the list of
 * matching people, and the record pane (N8) of the person selected in it.
 *
 * The search lives in the URL (?q=…, plus any filters, such as
 * &death_from=1920&section=women), so a search from the landing page, a shared
 * link and the browser's Back button all show the right results. The filters
 * narrow a name search: the API finds no one for a search without a name.
 * Clicking a result loads its grave from /api/graves/<ref> and opens the
 * record pane beside the list. The cemetery map is not part of this page yet.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Table, Spinner, Alert, Form, Button, Row, Col } from 'react-bootstrap';
import { searchArchive, getRecord } from './api.js';
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
  // The person whose record was asked for last. A response for anyone else
  // arrived late (the visitor clicked again, or closed the pane) and is dropped.
  const requestedPerson = useRef(null);
  const paneOpen = Boolean(selectedRecord || recordLoading || recordError);

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

  const count = shown.results.length;

  return (
    <Container className="py-5 mt-5">
      <Row className="mb-4">
        <Col md={8} lg={6}>
          <h2>Archive Search</h2>
          <SearchForm key={urlQuery} initialQuery={urlQuery} filters={filters} onSearch={handleSearch} />
        </Col>
      </Row>

      {/* Filters but no name */}
      {!urlQuery && filtersSet && (
        <Alert variant="info" role="status">
          Type a name to search. The filters narrow a name search; they cannot list records on their own yet.
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-5" role="status">
          <Spinner animation="border" variant="success" />
          <p className="mt-2 text-muted">Searching archive...</p>
        </div>
      )}

      {/* Error State */}
      {shown.error && (
        <Alert variant="danger">
          {shown.error}
        </Alert>
      )}

      {/* Results State */}
      {!isLoading && !shown.error && urlQuery && shown.results.length === 0 && (
        <Alert variant="info" role="status">
          No people found matching "{urlQuery}"{filtersSet ? ' with these filters' : ''}.
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
          {count > 0 && (
            <p className="text-muted small mb-2" role="status">
              {count} {count === 1 ? 'result' : 'results'} · best match first
            </p>
          )}

          {count > 0 && (
            <div className="table-responsive shadow-sm rounded">
              <Table hover className="align-middle mb-0 bg-white">
                <thead className="bg-light">
                  <tr>
                    <th>Name</th>
                    <th>Hebrew Name</th>
                    <th>Grave</th>
                    <th>Years</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.results.map((person) => {
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
                        <td><span className="badge bg-secondary">{person.score.toFixed(2)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
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
