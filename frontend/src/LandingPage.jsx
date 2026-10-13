/**
 * Landing page component for the Gauchos Judíos web archive.
 * Implements regions H1 through H5 of the Application Interface specification
 * and Wireframes 1.1 (Landing Page) and 2.1 (Search on the Landing Page):
 * - H1: Hero section with title, one-sentence introduction, and background video.
 * - H2: Map navigation, smooth-scroll "Learn more" button, live typeahead name search
 *       (showing matches after 2 letters with arrow-key navigation), and video pause button.
 * - H3: "The colonies and their cemetery" photo carousel with slide title, caption,
 *       arrows, and position dots.
 * - H4: "From the colonies to the archive" two-sided timeline with scroll fade-in cards.
 * - H5: Footer with Privacy and Contact us links and credits to community, collaborators, and funders.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Carousel } from 'react-bootstrap';

/**
 * Fallback sample records used by the H2 typeahead search when the Flask API
 * (/api/search) is offline during local frontend development.
 */
const SAMPLE_RECORDS = [
  {
    id: 'B-14',
    fullName: 'Gluzman, Mari',
    hebrewName: 'מירל גלוזמאן',
    location: 'Row B · Pos. 14'
  },
  {
    id: 'B-15',
    fullName: 'Gluzman, Abraham',
    hebrewName: 'אברהם גלוזמאן',
    location: 'Row B · Pos. 15'
  },
  {
    id: 'D-3',
    fullName: 'Glusman, Rebeca',
    hebrewName: 'רבקה גלוסמאן',
    location: 'Row D · Pos. 3'
  }
];

/**
 * Slides for the H3 "The colonies and their cemetery" carousel.
 */
const HISTORY_SLIDES = [
  {
    id: 'colony-life',
    imageUrl: 'https://placehold.co/960x480/3b4a47/f4f1ea?text=Life+in+the+Entre+Rios+Colonies',
    altText: 'Historical photograph of life in the Entre Ríos colonies',
    title: 'Life in the Entre Ríos colonies',
    caption: 'Jewish immigrant families settled agricultural colonies across Entre Ríos, building synagogues, schools, and communal institutions.'
  },
  {
    id: 'cemetery-grounds',
    imageUrl: 'https://placehold.co/960x480/4a5854/f4f1ea?text=The+Community+Cemetery',
    altText: 'View of the cemetery grounds and gravestones',
    title: 'The community cemetery',
    caption: 'The cemetery preserves generations of inscriptions in Spanish and Hebrew across 1,047 gravestones.'
  },
  {
    id: 'fieldwork-survey',
    imageUrl: 'https://placehold.co/960x480/2f3e3b/f4f1ea?text=Fieldwork+and+Preservation',
    altText: 'Fieldwork documentation of gravestones',
    title: 'Fieldwork and documentation',
    caption: 'Every gravestone was photographed and transcribed in partnership with the Effron Center and PIIRS.'
  }
];

/**
 * Six milestone cards for the H4 "From the colonies to the archive" two-sided timeline.
 */
const TIMELINE_EVENTS = [
  { id: 't1', dateLabel: '1890s', title: 'The first colonies' },
  { id: 't2', dateLabel: '[year]', title: 'The cemetery is founded' },
  { id: 't3', dateLabel: '[years]', title: 'Life in the colonies' },
  { id: 't4', dateLabel: '[years]', title: 'Families move to the cities' },
  { id: 't5', dateLabel: '[year]', title: 'Fieldwork: every stone photographed' },
  { id: 't6', dateLabel: '2026', title: 'The archive goes online' }
];

/**
 * Renders the public landing page (regions H1–H5).
 *
 * @returns {JSX.Element} The rendered landing page component.
 */
function LandingPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const videoRef = useRef(null);
  const timelineRefs = useRef([]);
  const navigate = useNavigate();

  const trimmedQuery = searchQuery.trim();
  const showDropdown = trimmedQuery.length >= 2;

  /**
   * Updates typeahead suggestions when the visitor types 2 or more letters.
   * Queries /api/search first and falls back to local sample records if offline.
   */
  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setSuggestions([]);
      setActiveIndex(0);
      return undefined;
    }

    let isCancelled = false;
    const lowered = trimmedQuery.toLowerCase();

    fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Search API unavailable');
        }
        return response.json();
      })
      .then((data) => {
        if (!isCancelled && Array.isArray(data)) {
          setSuggestions(data);
          setActiveIndex(0);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          const filtered = SAMPLE_RECORDS.filter(
            (item) =>
              item.fullName.toLowerCase().includes(lowered) ||
              item.hebrewName.includes(trimmedQuery)
          );
          setSuggestions(filtered);
          setActiveIndex(0);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [trimmedQuery]);

  /**
   * Observes timeline cards and fades each card in as the visitor scrolls.
   */
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      timelineRefs.current.forEach((node) => {
        if (node) {
          node.classList.add('is-visible');
        }
      });
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      { threshold: 0.15 }
    );

    timelineRefs.current.forEach((node) => {
      if (node) {
        observer.observe(node);
      }
    });

    return () => observer.disconnect();
  }, []);

  /**
   * Handles keyboard navigation (ArrowDown, ArrowUp, Enter) inside the H2 search box.
   *
   * @param {React.KeyboardEvent<HTMLInputElement>} event - The keyboard event.
   */
  function handleSearchKeyDown(event) {
    if (!showDropdown || suggestions.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' && suggestions[activeIndex]) {
      event.preventDefault();
      navigate(`/record/${suggestions[activeIndex].id}`);
    }
  }

  /**
   * Handles form submission when the user presses Enter without selecting a specific row.
   *
   * @param {React.FormEvent<HTMLFormElement>} event - The form submission event.
   */
  function handleSearchSubmit(event) {
    event.preventDefault();
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
                Every gravestone in the Jewish colony cemetery of Entre Ríos, Argentina,
                photographed and transcribed: 1,047 stones, about 4,000 photographs.
              </p>

              {/* H2: Main Actions */}
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

              {/* H2: Live Name Search Box with Suggestions Dropdown */}
              <div className="hero-search-wrapper">
                <Form onSubmit={handleSearchSubmit} role="search" autoComplete="off">
                  <Form.Group controlId="heroNameSearch">
                    <Form.Label className="visually-hidden">
                      Search for a name
                    </Form.Label>
                    <Form.Control
                      type="search"
                      className="hero-search-input"
                      placeholder="Search for a name..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={handleSearchKeyDown}
                    />
                  </Form.Group>
                </Form>

                {showDropdown && (
                  <div className="search-dropdown" role="listbox" aria-label="Name suggestions">
                    {suggestions.length > 0 ? (
                      <>
                        {suggestions.slice(0, 3).map((person, index) => (
                          <div
                            key={person.id}
                            role="option"
                            aria-selected={index === activeIndex}
                            className={`search-suggestion-item ${index === activeIndex ? 'active' : ''}`}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => navigate(`/record/${person.id}`)}
                          >
                            <div className="d-flex align-items-center">
                              <div className="search-thumb-placeholder" aria-hidden="true" />
                              <div>
                                <div className="fw-bold">{person.fullName}</div>
                                <div className="text-muted small">{person.location}</div>
                              </div>
                            </div>
                            <div dir="rtl" className="text-secondary">
                              {person.hebrewName}
                            </div>
                          </div>
                        ))}
                        <div
                          className="search-dropdown-footer"
                          onClick={() =>
                            navigate(`/explore?q=${encodeURIComponent(trimmedQuery)}`)
                          }
                        >
                          <span>
                            See all {suggestions.length} results on the map
                          </span>
                          <span aria-hidden="true">&rarr;</span>
                        </div>
                      </>
                    ) : (
                      <div className="search-no-results">
                        <div className="fw-bold mb-1">
                          No names match &ldquo;{trimmedQuery}&rdquo;
                        </div>
                        <p className="text-muted small mb-2">
                          Check the spelling or try the name in Hebrew. Many stones are
                          only partly readable, so you can also look for them on the map.
                        </p>
                        <div
                          className="search-dropdown-footer px-0 pb-0 bg-transparent"
                          onClick={() => navigate('/explore')}
                        >
                          <span>Explore the cemetery map &rarr;</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
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

      {/* H3: The Colonies and Their Cemetery (Photo Carousel) */}
      <section id="community-history" className="history-section" aria-label="The colonies and their cemetery">
        <Container>
          <Row className="justify-content-center">
            <Col lg={9}>
              <h2 className="fw-bold mb-4">The colonies and their cemetery</h2>
              <Carousel interval={null} indicators={true} className="archive-carousel shadow-sm">
                {HISTORY_SLIDES.map((slide) => (
                  <Carousel.Item key={slide.id}>
                    <img
                      className="d-block w-100"
                      src={slide.imageUrl}
                      alt={slide.altText}
                    />
                    <div className="carousel-caption-below">
                      <div className="fw-bold mb-1">{slide.title}</div>
                      <div className="text-muted small">{slide.caption}</div>
                    </div>
                  </Carousel.Item>
                ))}
              </Carousel>
            </Col>
          </Row>
        </Container>
      </section>

      {/* H4: Two-Sided Timeline */}
      <section className="timeline-section" aria-label="From the colonies to the archive">
        <Container>
          <Row className="justify-content-center">
            <Col lg={9}>
              <h2 className="fw-bold mb-4">From the colonies to the archive</h2>
              <div className="timeline-wrapper">
                {TIMELINE_EVENTS.map((item, index) => {
                  const isLeft = index % 2 === 0;
                  return (
                    <Row key={item.id} className="mb-3 align-items-center">
                      <Col md={6} className={isLeft ? 'pe-md-4' : 'order-md-2 ps-md-4'}>
                        <div
                          ref={(el) => {
                            timelineRefs.current[index] = el;
                          }}
                          className="timeline-card shadow-sm"
                        >
                          <div className="fw-bold text-secondary small mb-1">
                            {item.dateLabel}
                          </div>
                          <div className="fw-bold">{item.title}</div>
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

      {/* H5: Footer */}
      <footer className="archive-footer">
        <Container>
          <div className="mb-2">
            <a href="#privacy">Privacy</a>
            <span className="mx-2">&middot;</span>
            <a href="mailto:gauchosjudios@princeton.edu">Contact us</a>
          </div>
          <div className="small">
            Credits: community, collaborators, funders
          </div>
        </Container>
      </footer>
    </main>
  );
}

export default LandingPage;
