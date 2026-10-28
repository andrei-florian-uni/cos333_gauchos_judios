import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Table, Spinner, Alert, Form, Button, Row, Col } from 'react-bootstrap';

function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  
  const [localQuery, setLocalQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSearchResults = async () => {
      // Moving the empty check inside the async function satisfies the linter 
      // by deferring the state update, and keeps all fetch logic together.
      if (!initialQuery) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`http://localhost:5001/api/search?q=${encodeURIComponent(initialQuery)}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch search results from the server.');
        }
        
        const data = await response.json();
        setResults(data.results || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSearchResults();
  }, [initialQuery]);

  const handleNewSearch = (e) => {
    e.preventDefault();
    const trimmed = localQuery.trim();
    if (trimmed) {
      setSearchParams({ q: trimmed });
    } else {
      setSearchParams({});
    }
  };

  return (
    <Container className="py-5 mt-5">
      <Row className="mb-4">
        <Col md={8} lg={6}>
          <h2>Archive Search</h2>
          <Form onSubmit={handleNewSearch} className="d-flex gap-2 mt-3">
            <Form.Control 
              type="search" 
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              placeholder="Search for a name..." 
            />
            <Button variant="success" type="submit" style={{ backgroundColor: '#3e5a4d', borderColor: '#3e5a4d' }}>
              Search
            </Button>
          </Form>
        </Col>
      </Row>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-5">
          <Spinner animation="border" variant="success" />
          <p className="mt-2 text-muted">Searching archive...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <Alert variant="danger">
          {error}
        </Alert>
      )}

      {/* Results State */}
      {!isLoading && !error && initialQuery && results.length === 0 && (
        <Alert variant="info">
          No graves found matching "{initialQuery}".
        </Alert>
      )}

      {!isLoading && !error && results.length > 0 && (
        <div className="table-responsive shadow-sm rounded">
          <Table hover className="align-middle mb-0 bg-white">
            <thead className="bg-light">
              <tr>
                <th>Latin Names</th>
                <th>Hebrew Names</th>
                <th>Location</th>
                <th>Died</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {results.map((person) => {
                const latin = `${person.given_name_es || ''} ${person.surname_es || ''}`.trim();
                const hebrew = `${person.given_name_he || ''} ${person.surname_he || ''}`.trim();
                
                return (
                  <tr key={person.person_id}>
                    <td className="fw-bold">{latin || '—'}</td>
                    <td className="fs-5" dir="rtl">{hebrew || '—'}</td>
                    <td>{person.section} &middot; Row {person.row} &middot; Stone {person.stone}</td>
                    <td>{person.death_year || '?'}</td>
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