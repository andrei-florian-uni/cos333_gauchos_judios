/**
 * Photo lightbox: a full-screen carousel of a grave's photographs.
 *
 * Arrows, the arrow keys, a swipe or the filmstrip move between photos.
 * Clicking the photo zooms in on the point clicked (clicking again zooms
 * out); the mouse wheel and the + / − buttons or keys zoom too, and a zoomed
 * photo is moved by dragging it. Escape or the close button shut it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { fullUrl, thumbnailUrl } from './cloudinary.js';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const CLICK_SCALE = 2.5;
const BUTTON_STEP = 1.5;
/** How far the pointer may move (px) and still count as a click. */
const CLICK_SLOP = 5;
/** How far an unzoomed photo must be dragged sideways (px) to change photo. */
const SWIPE_DISTANCE = 50;

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/**
 * @param {object} props
 * @param {Array<{cloudinary_public_id: string}>} props.photos The photos to show.
 * @param {?number} props.index The photo shown, or null when the lightbox is shut.
 * @param {function(number): void} props.onIndexChange Shows another photo.
 * @param {function(): void} props.onClose Shuts the lightbox.
 * @param {string} props.title Whose stone it is, for the alt text and heading.
 * @returns {JSX.Element} The lightbox.
 */
function PhotoLightbox({ photos, index, onIndexChange, onClose, title }) {
  const show = index !== null && photos.length > 0;
  const count = photos.length;
  const current = show ? photos[index] : null;

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The photo shown last render, to notice when another one is chosen.
  const [shownIndex, setShownIndex] = useState(index);
  const imageRef = useRef(null);
  // The stage is kept in state, not a ref, so the wheel listener is attached
  // once the Modal has actually mounted it.
  const [stage, setStage] = useState(null);
  const drag = useRef(null);
  const filmstripRef = useRef(null);

  // Every new photo starts unzoomed. This is reset during render rather than
  // in an effect, so the old zoom is never drawn on the new photo.
  if (index !== shownIndex) {
    setShownIndex(index);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setLoaded(false);
  }

  // Load the neighbours ahead so moving through the carousel is instant.
  useEffect(() => {
    if (!show || count < 2) return;
    [index - 1, index + 1].forEach((i) => {
      const img = new Image();
      img.src = fullUrl(photos[(i + count) % count].cloudinary_public_id);
    });
  }, [show, index, count, photos]);

  // Keep the current thumbnail in view in the filmstrip.
  useEffect(() => {
    const strip = filmstripRef.current;
    if (!strip) return;
    strip.children[index]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [index]);

  /** Keeps the photo from being dragged past its edges at the given scale. */
  const clampOffset = useCallback((x, y, s) => {
    const img = imageRef.current;
    if (!img) return { x, y };
    const maxX = (img.offsetWidth * (s - 1)) / 2;
    const maxY = (img.offsetHeight * (s - 1)) / 2;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  /**
   * Zooms to a new scale, keeping the given point (relative to the photo's
   * centre, in screen pixels) where it is on screen.
   */
  const zoomTo = useCallback((nextScale, point = { x: 0, y: 0 }) => {
    const s = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (s === 1) {
      setOffset({ x: 0, y: 0 });
    } else {
      // The point sits at (point - offset) / scale on the unscaled photo;
      // choose the new offset that puts it back under the pointer.
      const ratio = s / scale;
      setOffset(clampOffset(
        point.x - (point.x - offset.x) * ratio,
        point.y - (point.y - offset.y) * ratio,
        s,
      ));
    }
    setScale(s);
  }, [scale, offset, clampOffset]);

  const go = useCallback((step) => {
    if (count < 2) return;
    onIndexChange((index + step + count) % count);
  }, [count, index, onIndexChange]);

  // Arrow keys move between photos; + / − / 0 zoom.
  useEffect(() => {
    if (!show) return undefined;
    const onKey = (event) => {
      if (event.key === 'ArrowLeft') go(-1);
      else if (event.key === 'ArrowRight') go(1);
      else if (event.key === '+' || event.key === '=') zoomTo(scale * BUTTON_STEP);
      else if (event.key === '-') zoomTo(scale / BUTTON_STEP);
      else if (event.key === '0') zoomTo(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, go, zoomTo, scale]);

  /** A point relative to the stage's centre, where the photo's centre rests. */
  const fromCentre = (event) => {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  };

  // The wheel is registered by hand so it can be non-passive and stop the page scrolling.
  useEffect(() => {
    if (!stage) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const point = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      zoomTo(scale * Math.exp(-event.deltaY * 0.002), point);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [stage, scale, zoomTo]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startY: event.clientY, origin: offset, moved: false };
    setDragging(true);
  };

  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (Math.hypot(dx, dy) > CLICK_SLOP) d.moved = true;
    if (scale > 1) setOffset(clampOffset(d.origin.x + dx, d.origin.y + dy, scale));
  };

  const onPointerUp = (event) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const dx = event.clientX - d.startX;
    if (!d.moved) {
      // A click: zoom in on the point clicked, or back out.
      if (scale > 1) zoomTo(1);
      else zoomTo(CLICK_SCALE, fromCentre(event));
    } else if (scale === 1 && Math.abs(dx) > SWIPE_DISTANCE) {
      go(dx < 0 ? 1 : -1);
    }
  };

  const onPointerCancel = () => {
    drag.current = null;
    setDragging(false);
  };

  let cursor = 'zoom-in';
  if (scale > 1) cursor = dragging ? 'grabbing' : 'grab';

  return (
    <Modal
      show={show}
      onHide={onClose}
      fullscreen
      className="photo-lightbox"
      contentClassName="photo-lightbox-content"
      aria-label={`Photographs of the stone of ${title}`}
    >
      {current && (
        <>
          <div className="photo-lightbox-bar">
            <span className="photo-lightbox-title text-truncate">{title}</span>
            <span className="photo-lightbox-count" aria-live="polite">
              {index + 1} / {count}
            </span>
            <div className="photo-lightbox-tools">
              <button type="button" onClick={() => zoomTo(scale / BUTTON_STEP)} disabled={scale <= MIN_SCALE} aria-label="Zoom out">−</button>
              <button type="button" onClick={() => zoomTo(1)} disabled={scale === 1} aria-label="Reset zoom" className="photo-lightbox-scale">
                {Math.round(scale * 100)}%
              </button>
              <button type="button" onClick={() => zoomTo(scale * BUTTON_STEP)} disabled={scale >= MAX_SCALE} aria-label="Zoom in">+</button>
              <button type="button" onClick={onClose} aria-label="Close" className="ms-2">×</button>
            </div>
          </div>

          <div className="photo-lightbox-stage" ref={setStage}>
            {!loaded && <div className="spinner-border text-light photo-lightbox-spinner" role="status"><span className="visually-hidden">Loading</span></div>}
            <img
              key={current.cloudinary_public_id}
              ref={imageRef}
              src={fullUrl(current.cloudinary_public_id)}
              alt={`Photograph ${index + 1} of ${count} of the stone of ${title}`}
              className="photo-lightbox-image"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transition: dragging ? 'none' : 'transform 0.2s ease',
                cursor,
                opacity: loaded ? 1 : 0,
              }}
            />

            {count > 1 && (
              <>
                <button type="button" className="photo-lightbox-nav prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
                <button type="button" className="photo-lightbox-nav next" onClick={() => go(1)} aria-label="Next photo">›</button>
              </>
            )}
          </div>

          {count > 1 && (
            <div className="photo-lightbox-filmstrip" ref={filmstripRef}>
              {photos.map((photo, i) => (
                <button
                  type="button"
                  key={photo.cloudinary_public_id}
                  className={i === index ? 'active' : ''}
                  onClick={() => onIndexChange(i)}
                  aria-label={`Show photograph ${i + 1}`}
                  aria-current={i === index ? 'true' : undefined}
                >
                  <img src={thumbnailUrl(photo.cloudinary_public_id, 56)} alt="" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export default PhotoLightbox;
