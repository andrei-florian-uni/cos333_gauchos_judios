/**
 * Landing page (/): the public introduction to the archive, regions H1–H5 of
 * the Project Design, under the site's navigation bar (SiteNav.jsx).
 *
 * The page has a hero over the background video (or, until the video is
 * hosted, a still aerial photo) with the map and "Learn more" buttons and a
 * name search (H1, H2), then three parts (H3, H4), each one a place the
 * navigation bar leads to:
 * - #history: the historical background, two passages, each under its own
 *   title;
 * - #princeton: Princeton's student-led project, under its title and
 *   subtitle, its account and the carousel of fieldwork photos together,
 *   since every photo comes from the project;
 * - #timeline: the two-sided timeline.
 * The hero itself is #home. A footer with sources, credits, contact and
 * privacy links (H5) closes the page.
 *
 * Every text comes from the locale files under `landing.` (see i18n.js), in
 * the language of the URL; the language toggle sits in the navigation bar.
 * Proper names (the cemetery's Spanish name, people's names) are the same in
 * both languages and stay in this file.
 *
 * Only this page is translated for now: the other pages stay in English until
 * their features are complete (team decision, 2026-11-15), so the links to
 * the explore page do not pass the language on.
 */

import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Carousel, InputGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import SiteNav from './SiteNav.jsx';

// Import local assets for the carousel
import img1 from './assets/carousel_01_entrance.jpg';
import img2 from './assets/carousel_02_aerial.jpg';
import img3 from './assets/carousel_03_stones.jpg';
import img4 from './assets/carousel_04_cleaning.jpg';
import img5 from './assets/carousel_05_row_by_row.jpg';
import img6 from './assets/carousel_06_interview.jpg';
import img7 from './assets/carousel_07_station.jpg';
import img8 from './assets/carousel_08_team.jpg';
// The hero's still: shown while the video loads, and in its place while the
// video is not hosted (it is kept out of git until it moves to Cloudinary).
import heroStill from './assets/hero_still.jpg';

// Carousel slides (H3): each photo and the key of its title and caption in
// the locale files (landing.carousel.slides.<key>).
const HISTORY_SLIDES = [
  { key: 'entrance', img: img1 },
  { key: 'aerial', img: img2 },
  { key: 'stones', img: img3 },
  { key: 'cleaning', img: img4 },
  { key: 'rowByRow', img: img5 },
  { key: 'interview', img: img6 },
  { key: 'station', img: img7 },
  { key: 'team', img: img8 },
];

// Timeline entries (H4), in order, with the key of each entry's date, title
// and description in the locale files (landing.timeline.events.<key>).
// `era` picks the card's style: the colonies, the project, or the future.
const TIMELINE_EVENTS = [
  { era: 'colonies', key: 'pogroms' },
  { era: 'colonies', key: 'railway' },
  { era: 'colonies', key: 'jca' },
  { era: 'colonies', key: 'lucienville' },
  { era: 'colonies', key: 'cemetery' },
  { era: 'colonies', key: 'cooperative' },
  { era: 'project', key: 'fieldwork' },
  { era: 'project', key: 'building' },
  { era: 'project', key: 'online' },
  { era: 'future', key: 'mensSection' },
];

// The sources listed in the footer (H5), in two columns: each link and the
// key of its label in the locale files (landing.footer.sourceList.<key>).
const SOURCE_COLUMNS = [
  [
    { key: 'amiaBasavilbaso', href: 'https://vaadhakehilot.amia.org.ar/kehilot/asociacion-israelita-basavilbaso/' },
    { key: 'amiaNovibuco', href: 'https://vaadhakehilot.amia.org.ar/novibuco-muestra/' },
    { key: 'icufCooperative', href: 'https://icufargentina.org/la-primera-cooperativa-agricola-del-pais-lucienville/' },
  ],
  [
    { key: 'jewishGen', href: 'https://kehilalinks.jewishgen.org/basavilbaso/' },
    { key: 'wikipediaHirsch', href: 'https://en.wikipedia.org/wiki/Maurice_de_Hirsch' },
    { key: 'fieldwork', href: null },
  ],
];

/**
 * Renders the landing page.
 *
 * @returns {JSX.Element} The page's sections, from the hero to the footer.
 */
function LandingPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const videoRef = useRef(null);
  // Elements that fade in when scrolled into view. A Set, because React calls
  // a ref callback again on every render; a Set keeps each element once.
  const observerRefs = useRef(new Set());
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  /**
   * Ref callback that registers an element to fade in.
   *
   * @param {?HTMLElement} element The element, or null when React detaches it.
   */
  function addFadeIn(element) {
    if (element) observerRefs.current.add(element);
  }

  /**
   * Opens the explore page with the typed name as its query, or with none.
   *
   * @param {Event} event The search form's submit event.
   */
  function handleSearchSubmit(event) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length > 0) {
      navigate(`/explore?q=${encodeURIComponent(query)}`);
    } else {
      navigate('/explore');
    }
  }

  /** Pauses the background video if it is playing, and plays it if it is paused. */
  function handleToggleVideo() {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsVideoPlaying(true);
      } else {
        videoRef.current.pause();
        setIsVideoPlaying(false);
      }
    }
  }

  // Fade each history block and timeline card in once 15% of it is on screen.
  // A browser without IntersectionObserver, or a visitor who asks for reduced
  // motion, sees them at once instead: content must never stay hidden.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      observerRefs.current.forEach((node) => node.classList.add('is-visible'));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      });
    }, { threshold: 0.15 });

    observerRefs.current.forEach(node => {
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, []);

  // Scroll to the part of the page the address names (#history, #timeline,
  // ...) whenever the navigation bar, a link from the explore page, or the
  // browser's Back and Forward buttons lead to one. React Router does not do
  // this itself, and the parts only exist once the page is drawn, so it runs
  // after rendering. `location.key` is new on every navigation, so clicking
  // the same button again scrolls back there. The scroll is smooth unless the
  // visitor asks for reduced motion (see `scroll-behavior` in index.css), and
  // each part's `scroll-margin-top` keeps its top clear of the bar.
  useEffect(() => {
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
  }, [location.hash, location.key]);

  return (
    <>
      <SiteNav page="landing" />
      <main>
        <section id="home" className="hero-section landing-anchor" style={{ backgroundImage: `url(${heroStill})` }}>
          <video ref={videoRef} className="hero-video" poster={heroStill} autoPlay loop muted playsInline>
            <source src="/video_header_3.mp4" type="video/mp4" />
          </video>
          <div className="hero-overlay"></div>
          
          <Container className="hero-content">
            <Row>
              <Col lg={9}>
                {/* The cemetery's own Spanish names, the same in every language */}
                <div className="hero-eyebrow" lang="es">Cementerio Judío de Novibuco &middot; Colonia Lucienville, Entre Ríos, Argentina</div>
                <h1 className="hero-title" lang="es">Cementerio Israelita</h1>
                <h2 className="hero-subtitle-line" lang="es">Basavilbaso Colonia N.º 1</h2>
                <p className="lead mb-4" style={{ maxWidth: '800px', fontSize: '1.25rem' }}>
                  {t('landing.hero.lead')}
                </p>

                <div className="d-flex flex-wrap gap-3 mb-4">
                  <Button variant="success" size="lg" style={{ backgroundColor: '#3e5a4d', borderColor: '#3e5a4d' }} onClick={() => navigate('/explore')}>
                    {t('landing.hero.exploreMap')}
                  </Button>
                  <Button variant="outline-light" size="lg" onClick={() => document.getElementById('history').scrollIntoView()}>
                    {t('landing.hero.learnMore')}
                  </Button>
                </div>

                <div className="hero-search-wrapper">
                  <Form onSubmit={handleSearchSubmit} role="search">
                    <InputGroup>
                      <Form.Control
                        type="search"
                        className="hero-search-input"
                        placeholder={t('common.searchPlaceholder')}
                        aria-label={t('common.searchPlaceholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      <Button type="submit" className="hero-search-button" aria-label={t('common.searchButton')}>
                        <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
                        </svg>
                        <span className="ms-2 d-none d-sm-inline">{t('common.searchButton')}</span>
                      </Button>
                    </InputGroup>
                  </Form>
                </div>
              </Col>
            </Row>
          </Container>

          <button type="button" className="video-pause-btn" onClick={handleToggleVideo} aria-label={isVideoPlaying ? t('landing.hero.pauseVideo') : t('landing.hero.playVideo')}>
            {isVideoPlaying ? (
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/></svg>
            ) : (
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/></svg>
            )}
          </button>
        </section>

        {/* H3, first part: the historical background, two passages, each
            under its own title, in one centred column of text. */}
        <section id="history" className="info-section landing-anchor bg-white">
          <Container>
            <Row className="justify-content-center">
              <Col lg={8}>
                <header className="landing-section-header">
                  <h2 className="landing-section-title">{t('landing.history.heading')}</h2>
                </header>

                <div className="info-block" ref={addFadeIn}>
                  <h3 className="info-heading">{t('landing.history.colonies.heading')}</h3>
                  <p className="info-body">
                    {t('landing.history.colonies.p1')}
                  </p>
                  <p className="info-body">
                    {t('landing.history.colonies.p2')}
                  </p>
                </div>

                <div className="info-block" ref={addFadeIn}>
                  <h3 className="info-heading">{t('landing.history.cemetery.heading')}</h3>
                  <p className="info-body">
                    {t('landing.history.cemetery.p1')}
                  </p>
                  <p className="info-body">
                    {t('landing.history.cemetery.p2')}
                  </p>
                  {/* The sources listed in the footer are those of this history */}
                  <a href="#sources" className="text-muted small mt-2 d-inline-block">{t('landing.history.sourcesLink')}</a>
                </div>
              </Col>
            </Row>
          </Container>
        </section>

        {/* H3, second part: Princeton's student-led project, under its title
            and subtitle. Its account and the fieldwork carousel share one
            tinted section, since every photo comes from the project; the
            carousel keeps its full width. */}
        <section id="princeton" className="project-section landing-anchor">
          <Container>
            <Row className="justify-content-center">
              <Col lg={8}>
                <header className="landing-section-header">
                  <h2 className="landing-section-title">{t('landing.project.heading')}</h2>
                  <p className="landing-section-subtitle">{t('landing.project.subheading')}</p>
                </header>

                <div className="info-block" ref={addFadeIn}>
                  <p className="info-body">
                    {t('landing.project.p1')}
                  </p>
                  <p className="info-body">
                    {t('landing.project.p2')}
                  </p>
                </div>
              </Col>
            </Row>

            <div className="carousel-container">
              <div className="archive-carousel shadow-sm">
                <Carousel 
                  indicators={false} 
                  interval={null} 
                  onSelect={(idx) => setCarouselIndex(idx)}
                  prevLabel={t('landing.carousel.previous')}
                  nextLabel={t('landing.carousel.next')}
                  nextIcon={<span aria-hidden="true" className="carousel-control-next-icon" style={{filter: 'invert(1)'}} />}
                  prevIcon={<span aria-hidden="true" className="carousel-control-prev-icon" style={{filter: 'invert(1)'}} />}
                >
                  {HISTORY_SLIDES.map((slide, i) => (
                    <Carousel.Item key={slide.key}>
                      <img className="d-block w-100" src={slide.img} alt={t(`landing.carousel.slides.${slide.key}.title`)} loading={i === 0 ? "eager" : "lazy"} />
                      <div className="carousel-caption-below">
                        <div className="fw-bold mb-1">{t(`landing.carousel.slides.${slide.key}.title`)}</div>
                        <div className="text-muted small mb-0">{t(`landing.carousel.slides.${slide.key}.caption`)}</div>
                      </div>
                    </Carousel.Item>
                  ))}
                </Carousel>
              </div>
              <div className="carousel-counter-row">
                <div className="text-muted small">{t('landing.carousel.credit')}</div>
                <div className="fw-bold">{carouselIndex + 1} / {HISTORY_SLIDES.length}</div>
              </div>
            </div>
          </Container>
        </section>

        {/* H4: the timeline; the navigation bar scrolls to its title */}
        <section id="timeline" className="timeline-section landing-anchor">
          <Container>
            <Row className="justify-content-center">
              <Col lg={8}>
                <h2 className="fw-bold text-center mb-5">{t('landing.timeline.heading')}</h2>
                <div className="timeline-wrapper">
                  <div className="timeline-era-label era-colonies">{t('landing.timeline.eraColonies')}</div>
                  <div className="timeline-era-label era-project">{t('landing.timeline.eraProject')}</div>
                  
                  {TIMELINE_EVENTS.map((item, index) => {
                    const isLeft = index % 2 === 0;
                    const cardClass = `timeline-card shadow-sm ${item.era === 'project' ? 'project-card' : ''} ${item.era === 'future' ? 'future-card' : ''}`;
                    
                    return (
                      <Row key={item.key} className="mb-4 align-items-center">
                        <Col md={6} className={isLeft ? 'pe-md-4 position-relative' : 'order-md-2 ps-md-4 position-relative'}>
                          <div className={cardClass} ref={addFadeIn}>
                            <div className="fw-bold mb-1" style={{color: item.era === 'project' ? '#3e5a4d' : '#2b2b2b'}}>{t(`landing.timeline.events.${item.key}.date`)}</div>
                            <div className="fw-bold mb-1">{t(`landing.timeline.events.${item.key}.title`)}</div>
                            <div className="text-muted small">{t(`landing.timeline.events.${item.key}.desc`)}</div>
                            <div className={`timeline-dot ${isLeft ? 'dot-left' : 'dot-right'}`} 
                                 style={{backgroundColor: item.era === 'project' ? '#3e5a4d' : '#a39b8b', display: window.innerWidth > 768 ? 'block' : 'none'}}></div>
                          </div>
                        </Col>
                        <Col md={6} className={isLeft ? 'order-md-2' : 'order-md-1'} />
                      </Row>
                    );
                  })}
                </div>
              </Col>
            </Row>
          </Container>
        </section>

        <footer id="sources" className="archive-footer">
          <Container>
            <Row className="mb-5">
              <Col lg={7} className="mb-4 mb-lg-0">
                <h5 className="mb-3 text-white">{t('landing.footer.sources')}</h5>
                <Row>
                  {SOURCE_COLUMNS.map((column) => (
                    <Col sm={6} key={column[0].key}>
                      <ul className="list-unstyled mb-0">
                        {column.map((source) => (
                          source.href ? (
                            <li key={source.key} className="mb-2">
                              <a href={source.href} target="_blank" rel="noreferrer">{t(`landing.footer.sourceList.${source.key}`)}</a>
                            </li>
                          ) : (
                            <li key={source.key} className="mb-2 text-muted">{t(`landing.footer.sourceList.${source.key}`)}</li>
                          )
                        ))}
                      </ul>
                    </Col>
                  ))}
                </Row>
              </Col>
              <Col lg={5}>
                <h5 className="mb-3 text-white">{t('landing.footer.credits')}</h5>
                <p className="mb-2 text-muted"><strong>{t('landing.footer.partnershipLabel')}</strong> {t('landing.footer.partnership')}</p>
                <p className="mb-2 text-muted"><strong>{t('landing.footer.supportLabel')}</strong> {t('landing.footer.support')}</p>
                <p className="mb-2 text-muted"><strong>{t('landing.footer.fieldworkLabel')}</strong> {t('landing.footer.fieldwork')}</p>
                <p className="mb-0 text-muted"><strong>{t('landing.footer.archiveLabel')}</strong> Andrei Florian, Ray Kong, Ranajoy Gupta, Uriel Lin</p>
              </Col>
            </Row>
            
            <hr className="footer-divider" />
            
            <div className="d-flex justify-content-between text-muted">
              <div>
                <a href="mailto:gauchosjudios@princeton.edu" className="me-3">{t('landing.footer.contact')}</a>
                <a href="#privacy">{t('landing.footer.privacy')}</a>
              </div>
              <div>&copy; 2026 Los Gauchos Judíos</div>
            </div>
          </Container>
        </footer>
      </main>
    </>
  );
}

export default LandingPage;
