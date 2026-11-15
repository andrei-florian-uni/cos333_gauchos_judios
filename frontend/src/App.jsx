/**
 * Root application router for the Gauchos Judíos frontend.
 * Connects the public landing page (/), the cemetery explorer route (/explore),
 * and direct record links (/record/:ref), and keeps the interface language in
 * step with the URL's ?lang= parameter (see language.js).
 */

import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useSearchParams, useParams } from 'react-router-dom';
import { Container, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import LandingPage from './LandingPage.jsx';
import ExplorePage from './ExplorePage.jsx';
import { useLanguage } from './useLanguage.js';

/**
 * Makes i18next, the page's `lang` attribute and the browser tab's title
 * follow the language in the URL. It renders nothing.
 *
 * @returns {null} Nothing.
 */
function LanguageSync() {
  const language = useLanguage();
  const { i18n } = useTranslation();

  useEffect(() => {
    i18n.changeLanguage(language);
    // Screen readers and the browser's spelling and hyphenation read this.
    document.documentElement.lang = language;
    document.title = i18n.t('common.siteTitle', { lng: language });
  }, [i18n, language]);

  return null;
}

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
      <LanguageSync />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/record/:ref" element={<ExplorerPlaceholder />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
