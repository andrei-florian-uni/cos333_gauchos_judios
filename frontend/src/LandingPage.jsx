/**
 * Landing page component for the Gauchos Judíos web archive.
 * Implements regions H1 through H5 of the Application Interface specification:
 * - H1: Hero section with background video.
 * - H2: Map navigation, smooth-scroll "Learn more" button, name search box, and video pause button.
 * - H3: Community history section with a photo carousel and captions underneath each photo.
 * - H4: Two-sided historical and project timeline.
 * - H5: Footer with privacy/contact links and credits to community, collaborators, and funders.
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Carousel } from 'react-bootstrap';

/**
 * Placeholder slides for the H3 community history carousel.
 * Replace image URLs with final Cloudinary public IDs once uploaded by media.py.
 */
const HISTORY_SLIDES = [
  {
    id: 'colony-origins',
    imageUrl: 'https://placehold.co/800x520/3b4a47/f4f1ea?text=Entre+Rios+Colony+Archive',
    altText: 'Historical photograph of the Jewish agricultural colony in Entre Ríos',
    caption: 'Settlers of the Jewish agricultural colonies in Entre Ríos, Argentina.'
  },
  {
    id: 'cemetery-grounds',
    imageUrl: 'https://placehold.co/800x520/4a5854/f4f1ea?text=Cemetery+Grounds',
    altText: 'View of the cemetery grounds and gravestones',
    caption: 'The historic cemetery preserving inscriptions in both Spanish and Hebrew.'
  },
  {
    id: 'fieldwork-team',
    imageUrl: 'https://placehold.co/800x520/2f3e3b/f4f1ea?text=Fieldwork+Documentation',
    altText: 'Fieldwork documentation of gravestones',
    caption: 'Photographic survey documenting 1,047 gravestones across the cemetery.'
  }
];

/**
 * Milestone entries for the H4 two-sided timeline.
 */
const TIMELINE_EVENTS = [
  {
    year: '1889',
    title: 'Founding of the Agricultural Colonies',
    description: 'Jewish immigrants fleeing Eastern Europe establish agricultural settlements across Entre Ríos, Argentina, becoming known as the Gauchos Judíos.'
  },
  {
    year: 'Early 1900s',
    title: 'Establishment of the Community Cemetery',
    description: 'The colony consecrates its cemetery, recording family lineages, epitaphs, and dates across generations in Hebrew and Spanish.'
  },
  {
    year: 'Field Survey',
    title: 'Photographic Preservation with Effron Center & PIIRS',
    description: 'Researchers and students capture roughly 4,000 field photographs covering all 1,047 gravestones alongside aerial drone imagery.'
  },
  {
    year: '2026',
    title: 'Public Digital Archive Launch',
    description: 'Inscriptions are transcribed and indexed with cross-script name search so descendants worldwide can locate relatives on the interactive map.'
  }
];

/**
 * Renders the public landing page (regions H1–H5).
 *
 * @returns {JSX.Element} The rendered landing page component.
 */
function LandingPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const videoRef = useRef(null);
  const navigate = useNavigate();

  /**
   * Handles submission of the H2 name search form.
   * Redirects the visitor to the cemetery explorer with the query in the URL.
   *
   * @param {React.FormEvent<HTMLFormElement>} event - The form submission event.
   */
  function handleSearchSubmit(event) {
    event.preventDefault();
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length > 0) {
      navigate(`/explore?q=${encodeURIComponent(trimmedQuery)}`);
    } else {
      navigate('/explore');
    }
  }

  /**
   * Toggles playback of the H1 background hero video and updates button state.
   */
  function handleToggleVideo() {
    const videoElement = videoRef.current;
    if (!videoElement) {
      setIsVideoPlaying((prev) => !prev);
      return;
    }

    if (videoElement.paused) {
      videoElement.play();
      setIsVideoPlaying(true);
    } else {
      videoElement.pause();
      setIsVideoPlaying(false);
    }
  }

  /**
   * Smoothly scrolls the viewport down to the H3 history section.
   */
  function handleLearnMoreClick() {
    const historyElement = document.getElementById('community-history');
    if (historyElement) {
      historyElement.scrollIntoView({ behavior: 'smooth' });
    }
  }

  return (
    <main>
      {/* H1 & H2: Hero Section */}
      <section className="hero-section" aria-label="Introduction">
        <video
          ref={videoRef}
          className="hero-video"
          autoPlay
          loop
          muted
          playsInline
          poster="https://placehold.co/1920x1080/263331/263331"
        >
          {/* Cloudinary hero drone video source goes here */}
        </video>

        <Container className="hero-content">
          <Row>
            <Col lg={8} md={10}>
              <h1 className="display-4 fw-bold mb-3">Gauchos Judíos</h1>
              <p className="lead mb-4">
                A public digital archive of the Jewish agricultural-colony cemetery in
                Entre Ríos, Argentina, preserving 1,047 gravestones through complete
                photographic coverage and cross-language name search.
              </p>

              {/* H2: Action Buttons */}
              <div className="d-flex flex-wrap gap-3 mb-4">
                <Button
                  variant="success"
                  size="lg"
                  style={{ backgroundColor: '#1f5c4b', borderColor: '#1f5c4b' }}
                  onClick={() => navigate('/explore')}
                >
                  Explore the cemetery map
                </Button>
                <Button
                  variant="outline-light"
                  size="lg"
                  onClick={handleLearnMoreClick}
                >
                  Learn more
                </Button>
              </div>

              {/* H2: Name Search Box */}
              <Form onSubmit={handleSearchSubmit} role="search">
                <Form.Group controlId="heroNameSearch">
                  <Form.Label className="visually-hidden">
                    Search for a person by name
                  </Form.Label>
                  <Form.Control
                    type="search"
                    className="hero-search-input"
                    placeholder="Search a name (Spanish or Hebrew)..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </Form.Group>
              </Form>
            </Col>
          </Row>
        </Container>

        {/* H2: Background Video Pause/Play Control */}
        <button
          type="button"
          className="video-pause-btn"
          onClick={handleToggleVideo}
          aria-label={isVideoPlaying ? 'Pause background video' : 'Play background video'}
          title={isVideoPlaying ? 'Pause background video' : 'Play background video'}
        >
          {isVideoPlaying ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="#6e5a36" aria-hidden="true">
              <rect x="3" y="2" width="3.5" height="12" rx="1" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="#6e5a36" aria-hidden="true">
              <path d="M4 2.5v11l9-5.5-9-5.5z" />
            </svg>
          )}
        </button>
      </section>

      {/* H3: Community History & Photo Carousel */}
      <section id="community-history" className="history-section" aria-label="Community History">
        <Container>
          <Row className="align-items-center g-5">
            <Col lg={6}>
              <Carousel interval={null} indicators={false}>
                {HISTORY_SLIDES.map((slide) => (
                  <Carousel.Item key={slide.id}>
                    <img
                      className="d-block w-100 rounded-top"
                      src={slide.imageUrl}
                      alt={slide.altText}
                    />
                    <div className="carousel-caption-below">
                      {slide.caption}
                    </div>
                  </Carousel.Item>
                ))}
              </Carousel>
            </Col>

            <Col lg={6}>
              <h2 className="fw-bold mb-3">The Community and the Fieldwork</h2>
              <p>
                In the late nineteenth century, Jewish families fleeing persecution in the
                Russian Empire settled in the agricultural colonies of Entre Ríos, Argentina.
                Known as the <em>Gauchos Judíos</em>, these pioneers built vibrant rural
                institutions, synagogues, libraries, and communal cemeteries that bridged
                Eastern European Jewish traditions and Argentine life.
              </p>
              <p className="mb-0">
                Built in partnership with the Effron Center for the Study of America and the
                Princeton Institute for International and Regional Studies (PIIRS), this archive
                combines approximately 4,000 field photographs with an interactive aerial map so
                visitors and descendants can locate relatives even where Spanish and Hebrew
                spellings diverge.
              </p>
            </Col>
          </Row>
        </Container>
      </section>

      {/* H4: Two-Sided Timeline */}
      <section className="timeline-section" aria-label="Historical Timeline">
        <Container>
          <h2 className="text-center fw-bold mb-5">History &amp; Archive Timeline</h2>
          <div className="timeline-wrapper">
            {TIMELINE_EVENTS.map((item, index) => {
              const isLeft = index % 2 === 0;
              return (
                <Row key={item.year} className="mb-3 align-items-center">
                  <Col md={6} className={isLeft ? 'pe-md-5' : 'order-md-2 ps-md-5'}>
                    <div className="timeline-card shadow-sm">
                      <div className="fw-bold text-secondary small mb-1">{item.year}</div>
                      <h3 className="h5 fw-bold mb-2">{item.title}</h3>
                      <p className="mb-0">{item.description}</p>
                    </div>
                  </Col>
                  <Col md={6} className={isLeft ? 'order-md-2' : 'order-md-1'} />
                </Row>
              );
            })}
          </div>
        </Container>
      </section>

      {/* H5: Footer */}
      <footer className="archive-footer">
        <Container>
          <div className="mb-2">
            <a href="#cite">Cite</a>
            <span className="mx-2">&middot;</span>
            <a href="mailto:gauchosjudios@princeton.edu">Contact</a>
            <span className="mx-2">&middot;</span>
            <a href="mailto:gauchosjudios@princeton.edu?subject=Archive%20Correction">
              Corrections
            </a>
            <span className="mx-2">&middot;</span>
            <a href="#privacy">Privacy</a>
          </div>
          <div className="small">
            Credits: Jewish community of Entre Ríos, project collaborators, the Effron Center
            for the Study of America, and the Princeton Institute for International and
            Regional Studies (PIIRS).
          </div>
        </Container>
      </footer>
    </main>
  );
}

export default LandingPage;
