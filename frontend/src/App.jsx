/**
 * Root application router for the Gauchos Judíos frontend.
 * Connects the public landing page (/), the cemetery explorer route (/explore),
 * and direct record links (/record/:ref).
 */

import { BrowserRouter, Routes, Route, Link, useSearchParams, useParams } from 'react-router-dom';
import { Container, Button } from 'react-bootstrap';
import LandingPage from './LandingPage.jsx';

/**
 * Placeholder component for the Cemetery Explorer view until the Leaflet map is merged.
 *
 * @returns {JSX.Element} A temporary placeholder view showing the active search query or record.
 */
function ExplorerPlaceholder() {
  const [searchParams] = useSearchParams();
  const { ref } = useParams();
  const query = searchParams.get('q') || '';

  return (
    <Container className="py-5">
      <div className="mb-4">
        <Button as={Link} to="/" variant="outline-secondary" size="sm">
          &larr; Home
        </Button>
      </div>
      <h1 className="h3">Cemetery Explorer</h1>
      <p className="text-muted">
        Interactive aerial map route.
        {ref ? ` Selected grave record: "${ref}".` : ''}
        {query ? ` Initial search query: "${query}".` : ''}
        {!ref && !query ? ' Showing full cemetery view.' : ''}
      </p>
    </Container>
  );
}

/**
 * Renders the top-level Single Page Application router.
 *
 * @returns {JSX.Element} The router hierarchy.
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/explore" element={<ExplorerPlaceholder />} />
        <Route path="/record/:ref" element={<ExplorerPlaceholder />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
