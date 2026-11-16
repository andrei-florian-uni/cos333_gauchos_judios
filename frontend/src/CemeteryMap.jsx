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
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Polygon, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  LEGEND, MAX_MAP_ZOOM, MIN_MAP_ZOOM, aerialTiles, boundsOfGraves, resolveLayout, shapeStyle,
} from './mapLayout.js';

const ALLOW_DEMO_LAYOUT = import.meta.env.VITE_MAP_DEMO_LAYOUT === 'true';
// The aerial's tiles ship with the site (cut by stone_mapping/make_tiles.py into public/tiles).
const DEFAULT_TILES_PATH = `${import.meta.env.BASE_URL}tiles`;
const EDGE_PADDING = 40;          // pixels kept free around whatever the map focuses on
const MAX_FOCUS_ZOOM = 1;         // the closest the map zooms in on its own
const MAX_COVERED_SHARE = 0.75;   // never treat more than this share of the map as covered
const CHOOSER_ROOM = 280;         // pixels the chooser needs beside and below a click

/**
 * Writes a person's name for the map: the Latin name, else the Hebrew one.
 *
 * @param {object} person A person from /api/map/graves (the four name columns).
 * @returns {string} The name, or "Unidentified" when neither is on record.
 */
function personName(person) {
  const latin = [person.name_es, person.surname_es].filter(Boolean).join(' ');
  const hebrew = [person.name_he, person.surname_he].filter(Boolean).join(' ');
  return latin || hebrew || 'Unidentified';
}

/**
 * Works out how much the map should keep free on each side when it moves, so
 * that what it shows does not end up under the floating panels. The panels
 * cover the map's left on a wide screen and its bottom on a narrow one.
 *
 * @param {L.Map} map The Leaflet map.
 * @param {{current: ?HTMLElement}} coveredRef The panels floating over the map.
 * @returns {object} Leaflet's paddingTopLeft and paddingBottomRight options.
 */
function focusPadding(map, coveredRef) {
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
  return {
    paddingTopLeft: [left + EDGE_PADDING, EDGE_PADDING],
    paddingBottomRight: [EDGE_PADDING, bottom + EDGE_PADDING],
  };
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
 * Moves the map: at first to show every grave, then to the selected grave
 * when one is opened, and to all the search matches when a new search
 * finishes (unless a grave is open). Each time it keeps clear of the panels.
 * It draws nothing.
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

  // At first, show the whole cemetery beside the panels rather than under them.
  useEffect(() => {
    map.fitBounds(boundsOfGraves(graves) || fullBounds, focusPadding(map, coveredRef));
  }, [map, graves, fullBounds, coveredRef]);

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
 * The legend of the map's colours (N4).
 *
 * @returns {JSX.Element} One swatch and label per state.
 */
function MapLegend() {
  return (
    <div className="map-legend shadow-sm" aria-label="Map legend">
      {LEGEND.map((entry) => (
        <div key={entry.label} className="d-flex align-items-center gap-2">
          <span
            className="map-legend-swatch"
            style={{
              backgroundColor: entry.fillColor,
              borderColor: entry.color,
              borderStyle: entry.dashArray ? 'dashed' : 'solid',
            }}
          />
          {entry.label}
        </div>
      ))}
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
          <MapFocus fullBounds={fullBounds} graves={layout.graves} selectedRef={selectedRef} matchRefs={matchRefs} coveredRef={coveredRef} />
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

      {layout && <MapLegend />}
    </div>
  );
}

export default CemeteryMap;
