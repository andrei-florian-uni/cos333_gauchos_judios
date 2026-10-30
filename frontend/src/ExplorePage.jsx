/**
 * Explore page (/explore): a name search box and the list of matching people.
 *
 * The query lives in the URL (?q=…), so a search from the landing page, a
 * shared link and the browser's Back button all show the right results. The
 * cemetery map is not part of this page yet.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Table, Spinner, Alert, Form, Button, Row, Col } from 'react-bootstrap';
import { searchArchive } from './api.js';

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
 * The search box. It starts from the URL's query; the page gives it a new
 * `key` whenever that query changes (Back, Forward, a new search), so the box
 * always shows the query whose results are listed.
 *
 * @param {object} props
 * @param {string} props.initialQuery The query in the URL.
 * @param {function(string): void} props.onSearch Called with the trimmed query on submit.
 * @returns {JSX.Element} The search form.
 */
function SearchForm({ initialQuery, onSearch }) {
  const [text, setText] = useState(initialQuery);

  /**
   * Hands the typed query to the page.
   *
   * @param {Event} e The form's submit event.
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(text.trim());
  };

  return (
    <Form onSubmit={handleSubmit} className="d-flex gap-2 mt-3" role="search">
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
  );
}

/**
 * Renders the search box and the results of the query in the URL.
 *
 * @returns {JSX.Element} The explore page.
 */
function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';

  // `attempt` counts submissions, so that submitting the same query again
  // (after an error, say) runs the search again.
  const [attempt, setAttempt] = useState(0);
  // The outcome of the last search that finished, and which search it was.
  const [finished, setFinished] = useState({ key: '', results: [], error: null });

  const searchKey = urlQuery ? `${attempt}:${urlQuery}` : '';
  const isLoading = searchKey !== '' && finished.key !== searchKey;
  const shown = !isLoading && searchKey !== '' ? finished : { results: [], error: null };

  // Run the search whenever the query or the attempt changes. A search that a
  // newer one overtakes is cancelled, so stale results never show.
  useEffect(() => {
    if (!urlQuery) return undefined;
    const controller = new AbortController();
    searchArchive(urlQuery, controller.signal)
      .then((results) => setFinished({ key: searchKey, results, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') setFinished({ key: searchKey, results: [], error: err.message });
      });
    return () => controller.abort();
  }, [urlQuery, searchKey]);

  /**
   * Puts the query into the URL, which starts the search; a repeat of the
   * same query replaces the history entry instead of adding one.
   *
   * @param {string} query The trimmed query; empty clears the results.
   */
  const handleSearch = (query) => {
    setSearchParams(query ? { q: query } : {}, { replace: query === urlQuery });
    setAttempt((count) => count + 1);
  };

  return (
    <Container className="py-5 mt-5">
      <Row className="mb-4">
        <Col md={8} lg={6}>
          <h2>Archive Search</h2>
          <SearchForm key={urlQuery} initialQuery={urlQuery} onSearch={handleSearch} />
        </Col>
      </Row>

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
          No people found matching "{urlQuery}".
        </Alert>
      )}

      {shown.results.length > 0 && (
        <div className="table-responsive shadow-sm rounded">
          <p className="visually-hidden" role="status">{shown.results.length} people found</p>
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

                return (
                  <tr key={person.person_id}>
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
    </Container>
  );
}

export default ExplorePage;
