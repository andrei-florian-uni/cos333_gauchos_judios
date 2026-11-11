/**
 * Explore page (/explore): a name search box with filters, and the list of
 * matching people.
 */

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Table, Spinner, Alert, Form, Button, Row, Col } from 'react-bootstrap';
import { searchArchive, getRecord } from './api.js';
import FiltersMenu from './FiltersMenu.jsx';
import RecordPane from './RecordPane.jsx';
import {
  NO_FILTERS, clearFilters, describeFilters, hasFilters, readFilters, searchParamsFor,
} from './searchFilters.js';

function joinName(...parts) {
  return parts.filter(Boolean).join(' ');
}

function describeGrave(person) {
  const section = person.section.charAt(0).toUpperCase() + person.section.slice(1);
  return `${section} · Row ${person.row} · Stone ${person.stone}`;
}

function describeYears(person) {
  if (person.birth_year && person.death_year) return `${person.birth_year}–${person.death_year}`;
  if (person.death_year) return `d. ${person.death_year}`;
  if (person.birth_year) return `b. ${person.birth_year}`;
  return '—';
}

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

function SearchForm({ initialQuery, filters, onSearch }) {
  const [text, setText] = useState(initialQuery);

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

function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const urlParams = searchParams.toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(urlParams)), [urlParams]);
  const filtersSet = hasFilters(filters);
  const searchString = searchParamsFor(urlQuery, filters).toString();

  const [attempt, setAttempt] = useState(0);
  const [finished, setFinished] = useState({ key: '', results: [], error: null });

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordLoading, setRecordLoading] = useState(false);

  const searchKey = urlQuery ? `${attempt}:${searchString}` : '';
  const isLoading = searchKey !== '' && finished.key !== searchKey;
  const shown = !isLoading && searchKey !== '' ? finished : { results: [], error: null };

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

  const handleSearch = (query, newFilters) => {
    const next = searchParamsFor(query, newFilters);
    if (next.toString() === searchString) {
      setAttempt((count) => count + 1);
    } else {
      setSearchParams(next);
    }
    setSelectedRecord(null);
  };

  const handleRowClick = (person) => {
    if (selectedRecord?.person_id === person.person_id) return;
    setRecordLoading(true);
    getRecord(person.ref).then(graveData => {
      // Find the specific person clicked from the grave's occupants
      const fullPersonData = graveData.persons.find(p => p.id === person.person_id) || {};
      setSelectedRecord({ ...graveData, ...fullPersonData, person_id: person.person_id });
      setRecordLoading(false);
    }).catch(err => {
      console.error(err);
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

      {!urlQuery && filtersSet && (
        <Alert variant="info" role="status">
          Type a name to search. The filters narrow a name search; they cannot list records on their own yet.
        </Alert>
      )}

      {isLoading && (
        <div className="text-center py-5" role="status">
          <Spinner animation="border" variant="success" />
          <p className="mt-2 text-muted">Searching archive...</p>
        </div>
      )}

      {shown.error && (
        <Alert variant="danger">
          {shown.error}
        </Alert>
      )}

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

      <div className="d-flex align-items-start gap-4 position-relative">
        <div className="flex-grow-1" style={{ maxWidth: (selectedRecord || recordLoading) ? '55%' : '100%', transition: 'max-width 0.3s ease' }}>
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

        {(recordLoading || selectedRecord) && (
          <div 
            className="record-pane-wrapper" 
            style={{ 
              width: '45%', 
              position: 'sticky', 
              top: '100px',
              animation: 'slideIn 0.3s ease-out'
            }}
          >
            {recordLoading ? (
              <div className="text-center py-5 bg-white shadow-sm rounded border">
                <Spinner animation="border" variant="success" />
                <p className="mt-2 text-muted">Loading record...</p>
              </div>
            ) : (
              <RecordPane record={selectedRecord} onClose={() => setSelectedRecord(null)} />
            )}
          </div>
        )}
      </div>
    </Container>
  );
}

export default ExplorePage;
