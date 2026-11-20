/**
 * The cemetery map (N4): every grave drawn as an outline coloured by its state,
 * with a legend and a zoom control, linked both ways to the list of people.
 *
 * - Graves holding someone in a name search's results, or someone who passes
 *   the filters, are highlighted, and the map moves to show them all when the
 *   list changes.
 * - The grave open in the record pane is drawn as selected, and the map flies
 *   to it.
 * - Clicking a grave opens its record. A shared stone, or an area that several
 *   graves not yet located share, first asks which person to open; a stone
 *   with photos but no legible name opens as a photo-only record. Missing
 *   records (placed, but with no photos) cannot be clicked.
 *
 * The map uses Leaflet's CRS.Simple, in pixels of the drone aerial, which is
 * drawn underneath from its tile pyramid (see aerialTiles in mapLayout.js).
 * Until graves are placed, VITE_MAP_DEMO_LAYOUT=true (set in .env.development)
 * lays them out in a labelled demo grid on a blank canvas instead.
 *
 * The explore page loads the graves (/api/map/graves) once, for its list of
 * people and for the map, and hands them in; the map fetches nothing itself.
 *
 * The search and record panels float over the left of the map, so the map is
 * told which element covers it (`coveredRef`) and keeps what it focuses on in
 * the part still visible.
 *
 * The map is held to the drawing (MapBounds): it cannot be dragged, or zoomed
 * out, far past the aerial into empty grey space, but keeps a small margin
 * around it and room beside it for the panels, so each corner can still be
 * brought into view.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer, Marker, Polygon, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MAX_MAP_ZOOM, MIN_MAP_ZOOM, aerialTiles, boundsOfGraves, legendEntries, mapLabels, panBounds,
  resolveLayout, shapeStyle,
} from './mapLayout.js';
import { personNames } from './labels.js';

const ALLOW_DEMO_LAYOUT = import.meta.env.VITE_MAP_DEMO_LAYOUT === 'true';
// The aerial's tiles ship with the site (cut by stone_mapping/make_tiles.py into public/tiles).
const DEFAULT_TILES_PATH = `${import.meta.env.BASE_URL}tiles`;
const EDGE_PADDING = 40;          // pixels kept free around whatever the map focuses on
const MAX_FOCUS_ZOOM = 1;         // the closest the map zooms in on its own
const MAX_COVERED_SHARE = 0.75;   // never treat more than this share of the map as covered
const CHOOSER_ROOM = 280;         // pixels the chooser needs beside and below a click
const ROW_LABEL_ZOOM = -1;        // row labels appear from this zoom in; farther out they crowd
const PAN_MARGIN = 100;           // screen pixels of margin the map may show around the drawing

/**
 * Writes a person's name for the map: the Latin name, else the Hebrew one, as
 * the results list and record pane write it (see labels.js).
 *
 * @param {object} person A person from /api/map/graves (the four name columns).
 * @returns {string} The name, or "Unidentified" when neither is on record.
 */
function personName(person) {
  return personNames(person).primary;
}

/**
 * Makes the marker icon of one map label: its text, centred on the point.
 *
 * @param {string} text The label's text.
 * @param {string} kind 'section', 'row' or 'area', which sets its style.
 * @returns {L.DivIcon} The icon.
 */
function labelIcon(text, kind) {
  const inner = document.createElement('span');
  inner.textContent = text;            // as text, never as HTML
  return L.divIcon({ className: `map-label map-label-${kind}`, html: inner, iconSize: [0, 0] });
}

/**
 * The map's labels: section names and the block not yet documented always,
 * and row numbers once the visitor zooms in far enough to read them. They
 * cannot be clicked, so clicks reach the graves underneath.
 *
 * @param {object} props
 * @param {{sections: Array<object>, rows: Array<object>, areas: Array<object>}} props.labels
 *   The labels, from mapLabels in mapLayout.js.
 * @returns {JSX.Element} The labels as markers.
 */
function MapLabels({ labels }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  // One icon per label, made again only when the labels change.
  const icons = useMemo(() => {
    const made = new Map();
    for (const [kind, list] of [['section', labels.sections], ['row', labels.rows], ['area', labels.areas]]) {
      for (const label of list) made.set(`${kind}|${label.key}`, labelIcon(label.text, kind));
    }
    return made;
  }, [labels]);

  const marker = (kind) => (label) => (
    <Marker
      key={`${kind}|${label.key}`}
      position={[-label.point[1], label.point[0]]}
      icon={icons.get(`${kind}|${label.key}`)}
      interactive={false}
      keyboard={false}
    />
  );
  return (
    <>
      {labels.areas.map(marker('area'))}
      {labels.sections.map(marker('section'))}
      {zoom >= ROW_LABEL_ZOOM && labels.rows.map(marker('row'))}
    </>
  );
}

/**
 * Measures how much of the map the floating panels cover: its left on a wide
 * screen, its bottom on a narrow one, where they stack along the bottom.
 *
 * @param {L.Map} map The Leaflet map.
 * @param {{current: ?HTMLElement}} coveredRef The panels floating over the map.
 * @returns {{left: number, bottom: number}} The pixels covered along the
 *   map's left and bottom edges (one of them is 0).
 */
function coveredSides(map, coveredRef) {
  const mapBox = map.getContainer().getBoundingClientRect();
  const panelsBox = coveredRef.current?.getBoundingClientRect();
  let left = 0;
  let bottom = 0;
  if (panelsBox) {
    // Panels that start below the map's top third are stacked along its bottom.
    if (panelsBox.top > mapBox.top + mapBox.height / 3) {
      bottom = Math.min(Math.max(0, mapBox.bottom - panelsBox.top), mapBox.height * MAX_COVERED_SHARE);
    } else {
      left = Math.min(Math.max(0, panelsBox.right - mapBox.left), mapBox.width * MAX_COVERED_SHARE);
    }
  }
  return { left, bottom };
}

/**
 * Works out how much the map should keep free on each side when it moves, so
 * that what it shows does not end up under the floating panels.
 *
 * @param {L.Map} map The Leaflet map.
 * @param {{current: ?HTMLElement}} coveredRef The panels floating over the map.
 * @returns {object} Leaflet's paddingTopLeft and paddingBottomRight options.
 */
function focusPadding(map, coveredRef) {
  const { left, bottom } = coveredSides(map, coveredRef);
  return {
    paddingTopLeft: [left + EDGE_PADDING, EDGE_PADDING],
    paddingBottomRight: [EDGE_PADDING, bottom + EDGE_PADDING],
  };
}

/**
 * Holds the map to the drawing, so it cannot be dragged or zoomed out into
 * endless grey space. It draws nothing.
 *
 * • Panning stops at the drawing plus a margin of PAN_MARGIN screen pixels,
 *   with room on the side the panels cover, so every corner can be brought
 *   out from under them (panBounds in mapLayout.js).
 * • Zooming out stops once the whole drawing fits in the part of the map the
 *   panels leave visible.
 * Both depend on the zoom and on the panels' size, so they are worked out
 * again after every zoom, when the window is resized, and when the panels
 * change size (a record opening or closing, the list opening).
 *
 * @param {object} props
 * @param {number} props.width The drawing's width in map units.
 * @param {number} props.height The drawing's height in map units.
 * @param {{current: ?HTMLElement}} props.coveredRef The panels floating over the map.
 * @returns {null} Nothing.
 */
function MapBounds({ width, height, coveredRef }) {
  const map = useMap();

  useEffect(() => {
    /** Sets the farthest zoom and the pan limits for the map as it is now. */
    const update = () => {
      const covered = coveredSides(map, coveredRef);
      // getBoundsZoom takes the padding as the pixels to leave free in all,
      // across (both sides) and down (top and bottom).
      const freePixels = [covered.left + 2 * EDGE_PADDING, covered.bottom + 2 * EDGE_PADDING];
      const fitZoom = map.getBoundsZoom([[-height, 0], [0, width]], false, freePixels);
      map.setMinZoom(Math.max(MIN_MAP_ZOOM, fitZoom));
      // Set only when they change: setting them makes Leaflet pull the view
      // back inside at once, which would cut short a move under way (such as
      // the flight to a grave just opened) for no reason.
      const limits = L.latLngBounds(panBounds(width, height, PAN_MARGIN, covered, map.getZoom()));
      if (!map.options.maxBounds || !limits.equals(map.options.maxBounds, 0.5)) {
        map.setMaxBounds(limits);
      }
    };

    update();
    map.on('zoomend resize', update);
    // The panels' size changes without the map's, so they are watched apart.
    const panels = coveredRef.current;
    const observer = panels && 'ResizeObserver' in window ? new ResizeObserver(update) : null;
    if (observer) observer.observe(panels);
    return () => {
      map.off('zoomend resize', update);
      if (observer) observer.disconnect();
    };
  }, [map, width, height, coveredRef]);

  return null;
}

/**
 * Lists who a shape holds, for its tooltip: everyone on it, or a note for a
 * photo-only grave, cut short when an area holds many.
 *
 * @param {object} shape A shape from groupShapes in mapLayout.js.
 * @returns {Array<string>} The lines to show.
 */
function tooltipLines(shape) {
  const MAX_LINES = 6;
  const lines = shape.entries.map((entry) => (entry.person ? personName(entry.person) : `Photos only (${entry.ref})`));
  if (lines.length <= MAX_LINES) return lines;
  return [...lines.slice(0, MAX_LINES - 1), `and ${lines.length - MAX_LINES + 1} more`];
}

/**
 * One shape on the map: a grave's outline, or an area several graves share.
 * Memoised, so that a change of selection or of the list redraws only the
 * shapes whose look changes.
 *
 * @param {object} props
 * @param {object} props.shape The shape, from groupShapes in mapLayout.js.
 * @param {boolean} props.isMatch Whether any of its graves holds someone in the list.
 * @param {boolean} props.isSelected Whether one of its graves is open in the record pane.
 * @param {function(object, object): void} props.onClick Called with the shape
 *   and Leaflet's click event.
 * @returns {JSX.Element} The outline, with a tooltip naming its people.
 */
const ShapeOutline = memo(function ShapeOutline({ shape, isMatch, isSelected, onClick }) {
  const polygonRef = useRef(null);
  const clickable = shape.entries.length > 0;
  const eventHandlers = useMemo(
    () => (clickable ? { click: (event) => onClick(shape, event) } : {}),
    [clickable, shape, onClick],
  );

  // Leaflet draws later outlines over earlier ones, so a highlighted grave is
  // brought to the front, where its thicker border is not hidden by neighbours.
  useEffect(() => {
    if ((isMatch || isSelected) && polygonRef.current) polygonRef.current.bringToFront();
  }, [isMatch, isSelected]);

  const shared = shape.graves.length > 1;
  return (
    <Polygon
      ref={polygonRef}
      positions={shape.positions}
      pathOptions={shapeStyle(shape, isMatch, isSelected)}
      interactive={clickable}
      eventHandlers={eventHandlers}
    >
      {clickable && (
        <Tooltip sticky>
          {tooltipLines(shape).map((line) => <div key={line}>{line}</div>)}
          <div className="text-muted small">
            {shared ? `${shape.graves.length} graves not yet located exactly` : shape.refs[0]}
          </div>
        </Tooltip>
      )}
    </Polygon>
  );
});

/**
 * Moves the map: at first to show the whole drawing (the full aerial), then
 * to the selected grave when one is opened, and to all the search matches
 * when a new search finishes (unless a grave is open). Each time it keeps
 * clear of the panels. It draws nothing.
 *
 * @param {object} props
 * @param {Array<Array<number>>} props.fullBounds The whole drawing, as Leaflet bounds.
 * @param {Array<object>} props.graves The graves on the map.
 * @param {?string} props.selectedRef The reference of the grave open in the record pane.
 * @param {Set<string>} props.matchRefs The references of the graves in the search results.
 * @param {{current: ?HTMLElement}} props.coveredRef The panels floating over the map.
 * @returns {null} Nothing.
 */
function MapFocus({ fullBounds, graves, selectedRef, matchRefs, coveredRef }) {
  const map = useMap();
  // The selection, readable from the matches' effect without making it run
  // again whenever the selection changes.
  const selectedNow = useRef(selectedRef);
  useEffect(() => {
    selectedNow.current = selectedRef;
  }, [selectedRef]);

  // At first, show the whole aerial beside the panels rather than under them.
  // The move is made at once, not animated: there is nothing to animate from,
  // and a move still under way would be cut short when MapBounds sets the
  // pan limits.
  useEffect(() => {
    map.fitBounds(fullBounds, { ...focusPadding(map, coveredRef), animate: false });
  }, [map, fullBounds, coveredRef]);

  useEffect(() => {
    const grave = selectedRef && graves.find((g) => g.ref === selectedRef);
    if (!grave) return;
    map.flyToBounds(boundsOfGraves([grave]), {
      ...focusPadding(map, coveredRef), maxZoom: MAX_FOCUS_ZOOM, duration: 0.6,
    });
  }, [map, graves, selectedRef, coveredRef]);

  useEffect(() => {
    if (selectedNow.current || matchRefs.size === 0) return;
    const box = boundsOfGraves(graves.filter((grave) => matchRefs.has(grave.ref)));
    if (!box) return;
    map.flyToBounds(box, { ...focusPadding(map, coveredRef), maxZoom: MAX_FOCUS_ZOOM, duration: 0.6 });
  }, [map, graves, matchRefs, coveredRef]);

  return null;
}

/**
 * Closes the shared-stone chooser when the map is clicked, panned or zoomed,
 * since the chooser would otherwise point at the wrong place. It draws nothing.
 *
 * @param {object} props
 * @param {function(): void} props.onClose Closes the chooser.
 * @returns {null} Nothing.
 */
function ChooserCloser({ onClose }) {
  useMapEvents({ click: onClose, movestart: onClose, zoomstart: onClose });
  return null;
}

/**
 * Places the chooser at a click, opening towards the inside of the map near an
 * edge, so that it never runs off the map.
 *
 * @param {{x: number, y: number}} point The click, in pixels from the map's top left.
 * @param {{width: number, height: number}} size The map's size in pixels.
 * @returns {object} CSS positions: left or right, and top or bottom.
 */
function chooserPosition(point, size) {
  const horizontal = point.x + CHOOSER_ROOM > size.width
    ? { right: size.width - point.x } : { left: point.x };
  const vertical = point.y + CHOOSER_ROOM > size.height
    ? { bottom: size.height - point.y } : { top: point.y };
  return { ...horizontal, ...vertical };
}

/**
 * The list of people in a shape that holds more than one, shown where it was
 * clicked: a shared stone, or an area several graves share.
 *
 * @param {object} props
 * @param {{shape: object, position: object}} props.chooser The shape, and
 *   where to show the chooser (see chooserPosition).
 * @param {function(string, ?string): void} props.onPick Called with the chosen
 *   grave's reference and person id (null for a photo-only grave).
 * @param {function(): void} props.onClose Closes the chooser.
 * @returns {JSX.Element} The chooser.
 */
function SharedStoneChooser({ chooser, onPick, onClose }) {
  const { shape, position } = chooser;
  const shared = shape.graves.length > 1;
  return (
    <div className="map-chooser shadow" style={position} role="dialog" aria-label="Choose a person">
      <div className="d-flex justify-content-between align-items-center mb-1 gap-2">
        <span className="small text-muted">
          {shared ? `${shape.graves.length} graves not yet located exactly` : `Shared stone · ${shape.refs[0]}`}
        </span>
        <button type="button" className="btn-close btn-sm" aria-label="Close" onClick={onClose} />
      </div>
      <div className="map-chooser-list">
        {shape.entries.map((entry) => (
          <button
            key={`${entry.ref}|${entry.person?.person_id ?? ''}`}
            type="button"
            className="map-chooser-person"
            onClick={() => onPick(entry.ref, entry.person?.person_id ?? null)}
          >
            {entry.person ? personName(entry.person) : 'Photos only'}
            {shared && <span className="d-block text-muted small">{entry.ref}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The legend of the map's colours (N4), listing only the states on the map.
 * It folds away to a small button, so it can be moved out of the way, and
 * starts folded on a phone.
 *
 * @param {object} props
 * @param {Array<object>} props.shapes The shapes on the map.
 * @returns {JSX.Element} The legend.
 */
function MapLegend({ shapes }) {
  // Open on a wide screen; folded on a phone, where the map has little room.
  const [open, setOpen] = useState(() => !window.matchMedia?.('(max-width: 767.98px)').matches);
  const entries = useMemo(() => legendEntries(shapes), [shapes]);
  return (
    <div className="map-legend shadow-sm">
      <button
        type="button"
        className="map-legend-toggle"
        aria-expanded={open}
        aria-controls="map-legend-entries"
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        Legend <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div id="map-legend-entries" className="mt-1">
          {entries.map((entry) => (
            <div key={entry.key} className="d-flex align-items-center gap-2">
              <span
                className="map-legend-swatch"
                style={{
                  backgroundColor: entry.fillColor,
                  borderColor: entry.color,
                  borderStyle: entry.dashArray ? 'dashed' : 'solid',
                  borderWidth: entry.weight >= 4 ? '3px' : '2px',
                }}
              />
              {entry.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The cemetery map.
 *
 * @param {object} props
 * @param {?{image: ?object, graves: Array<object>}} props.mapData The answer of
 *   /api/map/graves, or null while it loads.
 * @param {?string} props.loadError Why the graves could not be loaded, or null.
 * @param {Set<string>} props.matchRefs The references of the graves in the
 *   search results; keep the same Set while the results do not change.
 * @param {?string} props.selectedRef The reference of the grave open in the record pane.
 * @param {function(string, ?string): void} props.onOpenRecord Called with a
 *   grave's reference and the id of the person to open (null for a stone with
 *   no one named on it). Keep it the same function between renders.
 * @param {{current: ?HTMLElement}} props.coveredRef The panels floating over the map.
 * @returns {JSX.Element} The map, with its legend and any message.
 */
function CemeteryMap({ mapData, loadError, matchRefs, selectedRef, onOpenRecord, coveredRef }) {
  const [chooser, setChooser] = useState(null);
  // The map's frame, measured to keep the chooser inside it.
  const frameRef = useRef(null);

  const layout = useMemo(
    () => (mapData ? resolveLayout(mapData, ALLOW_DEMO_LAYOUT) : null),
    [mapData],
  );
  // The labels, on the aerial only: the demo grid's rows are not where the real ones are.
  const labels = useMemo(
    () => (layout && !layout.demo ? mapLabels(layout.graves, mapData.image) : null),
    [layout, mapData],
  );
  // The whole drawing, as Leaflet bounds; the same array while the layout is.
  // The aerial's tile layer, or null when there is none to draw (demo grid, no size).
  const tiles = useMemo(
    () => (layout ? aerialTiles(mapData.image, layout.demo, DEFAULT_TILES_PATH) : null),
    [layout, mapData],
  );
  const fullBounds = useMemo(
    () => (layout ? [[-layout.height, 0], [0, layout.width]] : null),
    [layout],
  );

  /**
   * Opens the record the clicked shape holds, or asks which one when it holds several.
   *
   * @param {object} shape The shape clicked.
   * @param {object} event Leaflet's click event.
   */
  const handleShapeClick = useCallback((shape, event) => {
    // Stop the click reaching the map, which would close the chooser just opened.
    L.DomEvent.stopPropagation(event);
    if (shape.entries.length > 1) {
      // The chooser lists the same names, so the hover tooltip would only cover it.
      event.target.closeTooltip();
      const frame = frameRef.current;
      const size = { width: frame.clientWidth, height: frame.clientHeight };
      setChooser({ shape, position: chooserPosition(event.containerPoint, size) });
      return;
    }
    setChooser(null);
    const [entry] = shape.entries;
    onOpenRecord(entry.ref, entry.person?.person_id ?? null);
  }, [onOpenRecord]);

  const closeChooser = useCallback(() => setChooser(null), []);

  return (
    <div className="cemetery-map" ref={frameRef}>
      {layout && (
        <MapContainer
          crs={L.CRS.Simple}
          bounds={fullBounds}
          minZoom={MIN_MAP_ZOOM}
          maxZoom={MAX_MAP_ZOOM}
          zoomSnap={0.25}
          maxBoundsViscosity={1}
          zoomControl={false}
          attributionControl={false}
          className="cemetery-map-canvas"
        >
          <ZoomControl position="topright" />
          {tiles && <TileLayer {...tiles} />}
          {layout.shapes.map((shape) => (
            <ShapeOutline
              key={shape.key}
              shape={shape}
              isMatch={shape.refs.some((ref) => matchRefs.has(ref))}
              isSelected={shape.refs.includes(selectedRef)}
              onClick={handleShapeClick}
            />
          ))}
          {labels && <MapLabels labels={labels} />}
          <MapFocus fullBounds={fullBounds} graves={layout.graves} selectedRef={selectedRef} matchRefs={matchRefs} coveredRef={coveredRef} />
          {/* After MapFocus, so the first view is in place before any pan
              limits exist; the limits, worked out for its zoom, then fit it */}
          <MapBounds width={layout.width} height={layout.height} coveredRef={coveredRef} />
          <ChooserCloser onClose={closeChooser} />
        </MapContainer>
      )}

      {chooser && (
        <SharedStoneChooser
          chooser={chooser}
          onPick={(ref, personId) => {
            setChooser(null);
            onOpenRecord(ref, personId);
          }}
          onClose={closeChooser}
        />
      )}

      {layout?.demo && (
        <div className="map-notice" role="note">
          Demo layout: graves are set out in a grid by section, row and stone, not where they really lie.
        </div>
      )}
      {layout && !layout.demo && layout.graves.length === 0 && (
        <div className="map-notice" role="note">No graves have been placed on the map yet.</div>
      )}
      {!layout && !loadError && <div className="map-notice" role="status">Loading the cemetery map…</div>}
      {loadError && <div className="map-notice map-notice-error" role="alert">{loadError}</div>}

      {layout && <MapLegend shapes={layout.shapes} />}
    </div>
  );
}

export default CemeteryMap;
