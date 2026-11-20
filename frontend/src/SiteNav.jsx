/**
 * The site's navigation bar: a solid dark bar at the top of both pages, which
 * stays in view as the landing page scrolls (Bootstrap's `sticky-top`).
 *
 * It holds the site name and five buttons. "Home", "History", "Princeton
 * Delegation" and "Timeline" lead to the landing page's hero (#home) and its
 * three parts (#history, #princeton, #timeline); the landing page scrolls to
 * the part named after the # (see LandingPage.jsx), whether the visitor is on
 * it already or comes from the explore page. "Explore the archive" opens the
 * explore page, where it is shown as the current page. On a phone the buttons
 * fold into a menu behind a button at the right of the bar.
 *
 * The texts come from the locale files under `nav.`. Links to the landing
 * page keep the language of the URL (?lang=es). The explore page is still in
 * English (team decision, 2026-11-15), so the link to it carries no language
 * and the explore page shows no language toggle.
 */

import { Link } from 'react-router-dom';
import { Container, Nav, Navbar } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import LanguageToggle from './LanguageToggle.jsx';
import { landingLink } from './language.js';
import { useLanguage } from './useLanguage.js';

/**
 * The buttons that lead to the landing page, in the order shown: each one's
 * key in the locale files (nav.<key>) and the id of the part it leads to.
 */
const LANDING_LINKS = [
  { key: 'home', id: 'home' },
  { key: 'history', id: 'history' },
  { key: 'princeton', id: 'princeton' },
  { key: 'timeline', id: 'timeline' },
];

/**
 * Renders the navigation bar.
 *
 * @param {object} props
 * @param {'landing'|'explore'} props.page The page the bar heads: the
 *   landing page shows the language toggle, and the explore page marks
 *   "Explore the archive" as the current page.
 * @returns {JSX.Element} The bar.
 */
function SiteNav({ page }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const onExplore = page === 'explore';

  return (
    // collapseOnSelect closes the phone menu once a button is chosen.
    <Navbar expand="md" sticky="top" data-bs-theme="dark" collapseOnSelect className="site-nav">
      <Container fluid className="px-3 px-md-4">
        {/* The site's own name, the same in every language */}
        <Navbar.Brand as={Link} to={landingLink('home', language)} className="site-nav-brand" lang="es">
          Los Gauchos Judíos
        </Navbar.Brand>
        {/* The phone menu's button; react-bootstrap reads its spoken name from `label` */}
        <Navbar.Toggle aria-controls="site-nav-links" label={t('nav.menu')} />
        <Navbar.Collapse id="site-nav-links">
          {/* activeKey is set, because Nav would otherwise mark the last
              button clicked as current, and keep it marked after scrolling */}
          <Nav className="ms-auto align-items-md-center" activeKey={onExplore ? 'explore' : null}>
            {LANDING_LINKS.map((link) => (
              <Nav.Link key={link.key} as={Link} to={landingLink(link.id, language)} eventKey={link.key}>
                {t(`nav.${link.key}`)}
              </Nav.Link>
            ))}
            <Nav.Link
              as={Link}
              to="/explore"
              eventKey="explore"
              aria-current={onExplore ? 'page' : undefined}
              className="site-nav-explore"
            >
              {t('nav.explore')}
            </Nav.Link>
          </Nav>
          {!onExplore && (
            <div className="site-nav-language">
              <LanguageToggle onDark />
            </div>
          )}
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}

export default SiteNav;
