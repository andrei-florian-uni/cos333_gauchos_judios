/**
 * Landing page (/): the public introduction to the archive, regions H1–H5 of
 * the Project Design. A hero over the background video with the map and
 * "Learn more" buttons and a name search (H1, H2), the community's history
 * and a carousel of fieldwork photos (H3), a two-sided timeline (H4), and a
 * footer with sources, credits, contact and privacy links (H5).
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Carousel } from 'react-bootstrap';

// Import local assets for the carousel
import img1 from './assets/carousel_01_entrance.jpg';
import img2 from './assets/carousel_02_aerial.jpg';
import img3 from './assets/carousel_03_stones.jpg';
import img4 from './assets/carousel_04_cleaning.jpg';
import img5 from './assets/carousel_05_row_by_row.jpg';
import img6 from './assets/carousel_06_interview.jpg';
import img7 from './assets/carousel_07_station.jpg';
import img8 from './assets/carousel_08_team.jpg';

// Carousel slides (H3): each photo with a title and the caption shown under it.
const HISTORY_SLIDES = [
  { id: '1', img: img1, title: 'Arriving at the cemetery', caption: 'The team at the entrance building, whose sign reads "Cementerio Israelita fundado en 1895."' },
  { id: '2', img: img2, title: 'The cemetery from above', caption: 'A brick wall encloses about 2,500 headstones in the open farmland outside Basavilbaso.' },
  { id: '3', img: img3, title: 'Faces and stars', caption: 'Many stones carry a Star of David and an enamel portrait of the person buried there.' },
  { id: '4', img: img4, title: 'Cleaning the stones', caption: 'Before photographing, the team scrubbed away lichen and dirt so every inscription could be read.' },
  { id: '5', img: img5, title: 'Row by row', caption: 'Cleaning a stone in the children\'s section. Small pebbles on a nearby grave mark a visitor\'s remembrance.' },
  { id: '6', img: img6, title: 'Sharing the story', caption: 'Uriel Lin, team leader, speaks with FM Riel about the project.' },
  { id: '7', img: img7, title: 'The town the colony grew around', caption: 'The team at Basavilbaso\'s railway station. Colonia Lucienville was settled around it in 1894.' },
  { id: '8', img: img8, title: 'The team', caption: 'Princeton students with local caretakers and community members who made the work possible.' }
];

// Timeline entries (H4), in order. `era` picks the card's style: the colonies,
// the project, or the future.
const TIMELINE_EVENTS = [
  { era: 'colonies', date: '1880s-1900s', title: 'Pogroms in the Russian Empire', desc: 'Violence and new restrictions push Jewish families to look for a life elsewhere.' },
  { era: 'colonies', date: '1887', title: 'The railway reaches Basavilbaso', desc: 'A new station on the Entre Ríos line, around which the colony will grow.' },
  { era: 'colonies', date: '1891', title: 'The Jewish Colonization Association is founded', desc: 'Baron Maurice de Hirsch, mourning his son Lucien, founds it to resettle Jews as farmers in Argentina.' },
  { era: 'colonies', date: '1894', title: 'Colonia Lucienville is founded', desc: 'Families from Kherson and Bessarabia arrive at Basavilbaso.' },
  { era: 'colonies', date: '1895', title: 'The cemetery is founded', desc: 'Cementerio Israelita, Colonia N.º 1, also known as Novibuco.' },
  { era: 'colonies', date: '1900', title: 'Argentina\'s first agricultural cooperative', desc: 'The colonists found it on August 12 in Basavilbaso.' },
  { era: 'project', date: 'January 2026', title: 'Fieldwork', desc: 'A Princeton team photographs 794 graves in the women\'s and children\'s sections.' },
  { era: 'project', date: 'March 2026 - December 2026', title: 'Building the archive', desc: 'The records are processed and the website is developed.' },
  { era: 'project', date: 'December 2026', title: 'The archive goes online', desc: 'Anyone can search for a name and find the grave on the map.' },
  { era: 'future', date: 'Next', title: 'The men\'s section', desc: 'A future trip will document the rest of the cemetery.' }
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
  useEffect(() => {
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

  return (
    <main>
      <section className="hero-section">
        <div className="hero-wordmark">Los Gauchos Judíos</div>
        <video ref={videoRef} className="hero-video" autoPlay loop muted playsInline>
          <source src="/video_header_3.mp4" type="video/mp4" />
        </video>
        <div className="hero-overlay"></div>
        
        <Container className="hero-content">
          <Row>
            <Col lg={9}>
              <div className="hero-eyebrow">Cementerio Judío de Novibuco &middot; Colonia Lucienville, Entre Ríos, Argentina</div>
              <h1 className="hero-title">Cementerio Israelita</h1>
              <h2 className="hero-subtitle-line">Basavilbaso Colonia N.º 1</h2>
              <p className="lead mb-4" style={{ maxWidth: '800px', fontSize: '1.25rem' }}>
                Resting place of the Jewish families who farmed Colonia Lucienville from 1894. 
                794 of its graves are now photographed and searchable by name.
              </p>

              <div className="d-flex flex-wrap gap-3 mb-4">
                <Button variant="success" size="lg" style={{ backgroundColor: '#3e5a4d', borderColor: '#3e5a4d' }} onClick={() => navigate('/explore')}>
                  Explore the cemetery map
                </Button>
                <Button variant="outline-light" size="lg" onClick={() => document.getElementById('info-section').scrollIntoView({ behavior: 'smooth' })}>
                  Learn more
                </Button>
              </div>

              <div className="hero-search-wrapper">
                <Form onSubmit={handleSearchSubmit}>
                  <Form.Control 
                    type="search" 
                    className="hero-search-input" 
                    placeholder="Search for a name..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)} 
                  />
                </Form>
              </div>
            </Col>
          </Row>
        </Container>

        <button type="button" className="video-pause-btn" onClick={handleToggleVideo} aria-label={isVideoPlaying ? 'Pause' : 'Play'}>
          {isVideoPlaying ? (
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/></svg>
          ) : (
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/></svg>
          )}
        </button>
      </section>

      <section id="info-section" className="info-section bg-white">
        <Container>
          <Row className="justify-content-center">
            <Col lg={10}>
              <div className="info-block" ref={addFadeIn}>
                <Row>
                  <Col md={4}><div className="info-date">1894</div><div className="info-heading">Jewish Farmers in the Pampas of Argentina</div></Col>
                  <Col md={8}>
                    <p className="info-body">
                      In the late 19th century, a wave of pogroms swept the Russian Empire, targeting the Jewish population that had lived there for centuries. Baron Maurice de Hirsch, a Jewish-German philanthropist, sought to help persecuted Jews by resettling them as farmers in Argentina's vast countryside. He founded the Jewish Colonization Association in 1891, which set out to buy land and establish agricultural colonies for the Eastern European Jews.
                    </p>
                    <p className="info-body">
                      Colonia Lucienville, named after the Baron's only son who predeceased his parents, was founded in 1894, near the railway station of Basavilbaso, Entre Ríos. The first families came from Kherson and Bessarabia in today's southern regions of Ukraine and Moldova. They raised cattle and grew crops, founded Jewish communal institutions, and even established the first agricultural cooperative in Argentina. Alberto Gerchunoff, a prominent Argentine writer who grew up in the Jewish colonies, coined the term "los Gauchos Judíos", or "the Jewish Cowboys", to describe the Eastern European Jews who had adapted to the harsh agricultural conditions of the Argentine plains. Over the 20th century, most of the community's descendants have moved away from the colonies, and scattered throughout Argentina and the rest of the world.
                    </p>
                  </Col>
                </Row>
              </div>

              <div className="info-block" ref={addFadeIn}>
                <Row>
                  <Col md={4}><div className="info-date">1895</div><div className="info-heading">Cementerio Israelita, Colonia N.º 1</div></Col>
                  <Col md={8}>
                    <p className="info-body">
                      One of the first institutions the community established was the Jewish cemetery, founded in 1895, a year after the first families arrived. The cemetery and the community are also known as Novibuco, named after Novyi Buh, the Ukrainian town many of the first settlers came from. With approximately 2,500 headstones, this is the largest Jewish cemetery in Colonia Lucienville.
                    </p>
                    <p className="info-body">
                      The cemetery consists of a men's section, a women's section, and a children's section. The newer parts of the cemetery mix somewhat, but the layout largely follows this traditional separation. The headstones are inscribed in Spanish, Hebrew and Yiddish, and include valuable records that shed light on a community in transition, from its Eastern European shtetl roots, to its modernization and secularization which followed. Today, the cemetery is cared for by the Jewish community of Basavilbaso (Asociación Israelita Basavilbaso).
                    </p>
                  </Col>
                </Row>
              </div>

              <div className="info-block" ref={addFadeIn}>
                <Row>
                  <Col md={4}><div className="info-date">2026</div><div className="info-heading">Los Gauchos Judíos</div></Col>
                  <Col md={8}>
                    <p className="info-body">
                      In January 2026, a team of Princeton students traveled to Basavilbaso, with support from the Princeton Institute for International and Regional Studies (PIIRS), the Effron Center, and the Department of Spanish and Portuguese. In collaboration with local caretakers and stakeholders in the Jewish community of Argentina, they cleaned and photographed 794 graves, covering the women's and children's sections of the cemetery.
                    </p>
                    <p className="info-body">
                      The photos were then sorted and transcribed using AI tools and checked by hand. A student team was formed to transform the records into a publicly accessible archive, where anyone can search for a name in Spanish or Hebrew, or explore the aerial map of the cemetery. The men's section will be documented and added to the archive in the future.
                    </p>
                    <a href="#sources" className="text-muted small mt-2 d-inline-block">Sources are listed at the bottom of the page</a>
                  </Col>
                </Row>
              </div>
            </Col>
          </Row>
        </Container>
      </section>

      <section className="history-section">
        <Container>
          <div className="carousel-container">
            <h3 className="fw-bold mb-4">From the fieldwork</h3>
            <div className="archive-carousel shadow-sm">
              <Carousel 
                indicators={false} 
                interval={null} 
                onSelect={(idx) => setCarouselIndex(idx)}
                nextIcon={<span aria-hidden="true" className="carousel-control-next-icon" style={{filter: 'invert(1)'}} />}
                prevIcon={<span aria-hidden="true" className="carousel-control-prev-icon" style={{filter: 'invert(1)'}} />}
              >
                {HISTORY_SLIDES.map((slide, i) => (
                  <Carousel.Item key={slide.id}>
                    <img className="d-block w-100" src={slide.img} alt={slide.title} loading={i === 0 ? "eager" : "lazy"} />
                    <div className="carousel-caption-below">
                      <div className="fw-bold mb-1">{slide.title}</div>
                      <div className="text-muted small mb-0">{slide.caption}</div>
                    </div>
                  </Carousel.Item>
                ))}
              </Carousel>
            </div>
            <div className="carousel-counter-row">
              <div className="text-muted small">Photos: Los Gauchos Judíos team, January 2026</div>
              <div className="fw-bold">{carouselIndex + 1} / {HISTORY_SLIDES.length}</div>
            </div>
          </div>
        </Container>
      </section>

      <section className="timeline-section">
        <Container>
          <Row className="justify-content-center">
            <Col lg={8}>
              <h2 className="fw-bold text-center mb-5">From the colonies to the archive</h2>
              <div className="timeline-wrapper">
                <div className="timeline-era-label era-colonies">The colonies</div>
                <div className="timeline-era-label era-project">The project</div>
                
                {TIMELINE_EVENTS.map((item, index) => {
                  const isLeft = index % 2 === 0;
                  const cardClass = `timeline-card shadow-sm ${item.era === 'project' ? 'project-card' : ''} ${item.era === 'future' ? 'future-card' : ''}`;
                  
                  return (
                    <Row key={index} className="mb-4 align-items-center">
                      <Col md={6} className={isLeft ? 'pe-md-4 position-relative' : 'order-md-2 ps-md-4 position-relative'}>
                        <div className={cardClass} ref={addFadeIn}>
                          <div className="fw-bold mb-1" style={{color: item.era === 'project' ? '#3e5a4d' : '#2b2b2b'}}>{item.date}</div>
                          <div className="fw-bold mb-1">{item.title}</div>
                          <div className="text-muted small">{item.desc}</div>
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
              <h5 className="mb-3 text-white">Sources</h5>
              <Row>
                <Col sm={6}>
                  <ul className="list-unstyled mb-0">
                    <li className="mb-2"><a href="https://vaadhakehilot.amia.org.ar/kehilot/asociacion-israelita-basavilbaso/" target="_blank" rel="noreferrer">AMIA Vaad Hakehilot, "Asociación Israelita de Basavilbaso" (in Spanish)</a></li>
                    <li className="mb-2"><a href="https://vaadhakehilot.amia.org.ar/novibuco-muestra/" target="_blank" rel="noreferrer">AMIA Vaad Hakehilot, "Novibuco" (in Spanish)</a></li>
                    <li className="mb-2"><a href="https://icufargentina.org/la-primera-cooperativa-agricola-del-pais-lucienville/" target="_blank" rel="noreferrer">ICUF Argentina, "La primera cooperativa agrícola del país: Lucienville" (in Spanish)</a></li>
                  </ul>
                </Col>
                <Col sm={6}>
                  <ul className="list-unstyled mb-0">
                    <li className="mb-2"><a href="https://kehilalinks.jewishgen.org/basavilbaso/" target="_blank" rel="noreferrer">JewishGen KehilaLinks, "Basavilbaso - Lucienville, Argentina," compiled by Yehuda Mathov</a></li>
                    <li className="mb-2"><a href="https://en.wikipedia.org/wiki/Maurice_de_Hirsch" target="_blank" rel="noreferrer">Wikipedia, "Maurice de Hirsch"</a></li>
                    <li className="mb-2 text-muted">Los Gauchos Judíos fieldwork, Basavilbaso, January 2026</li>
                  </ul>
                </Col>
              </Row>
            </Col>
            <Col lg={5}>
              <h5 className="mb-3 text-white">Credits</h5>
              <p className="mb-2 text-muted"><strong>In partnership with:</strong> the Jewish community of Basavilbaso (Asociación Israelita Basavilbaso) and the cemetery's local caretakers</p>
              <p className="mb-2 text-muted"><strong>With support from:</strong> the Princeton Institute for International and Regional Studies (PIIRS), the Effron Center, and the Department of Spanish and Portuguese</p>
              <p className="mb-2 text-muted"><strong>Fieldwork:</strong> Los Gauchos Judíos team, led by Uriel Lin: Andrei Florian, Emily Mitnick, Daniel Levey, Marissa Hirschfield, Eve Shapiro, Florencia Chiaramonte.</p>
              <p className="mb-0 text-muted"><strong>Archive and website:</strong> Andrei Florian, Ray Kong, Ranajoy Gupta, Uriel Lin</p>
            </Col>
          </Row>
          
          <hr className="footer-divider" />
          
          <div className="d-flex justify-content-between text-muted">
            <div>
              <a href="mailto:gauchosjudios@princeton.edu" className="me-3">Contact us</a>
              <a href="#privacy">Privacy</a>
            </div>
            <div>&copy; 2026 Los Gauchos Judíos</div>
          </div>
        </Container>
      </footer>
    </main>
  );
}

export default LandingPage;
