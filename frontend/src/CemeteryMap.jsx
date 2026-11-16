/**
 * The cemetery map (N4): every grave drawn as an outline coloured by its state,
 * with a legend and a zoom control, linked both ways to the list of people.
 *
 * - Graves holding someone in a name search's results, or someone who passes
 *   the filters, are highlighted, and the map moves to show them all when the
 *   list changes.
 * - The grave open in the record pane is drawn as selected, and the map flies
 *   to it.
 * - Clicking a grave opens its record. A shared stone first asks which person
 *   to open; a stone with photos but no legible name opens as a photo-only
 *   record. Missing records (placed, but with no photos) cannot be clicked.
 *
 * The map uses Leaflet's CRS.Simple, in pixels of the aerial image. There is no
 * aerial image yet, so the graves are drawn on a blank canvas. Until graves are
 * placed, VITE_MAP_DEMO_LAYOUT=true (set in .env.development) lays them out in a
 * labelled demo grid (see mapLayout.js).
 *
 * The explore page loads the graves (/api/map/graves) once, for its list of
 * people and for the map, and hands them in; the map fetches nothing itself.
 *
 * The search and record panels float over the left of the map, so the map is
 * told which element covers it (`coveredRef`) and keeps what it focuses on in
 * the part still visible.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Polygon, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LEGEND, boundsOfGraves, graveStyle, resolveLayout } from './mapLayout.js';

const ALLOW_DEMO_LAYOUT = import.meta.env.VITE_MAP_DEMO_LAYOUT === 'true';
const EDGE_PADDING = 40;          // pixels kept free around whatever the map focuses on
const MAX_FOCUS_ZOOM = 1;         // the closest the map zooms in on its own
const MAX_COVERED_SHARE = 0.75;   // never treat more than this share of the map as covered

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
 * One grave's outline. Memoised, so that a change of selection or of the
 * search results redraws only the graves whose look changes.
 *
 * @param {object} props
 * @param {object} props.grave The grave, with `positions` for Leaflet.
 * @param {boolean} props.isMatch Whether it holds someone in the search results.
 * @param {boolean} props.isSelected Whether it is open in the record pane.
 * @param {function(object, object): void} props.onClick Called with the grave
 *   and Leaflet's click event.
 * @returns {JSX.Element} The outline, with a tooltip naming its people.
 */
const GraveOutline = memo(function GraveOutline({ grave, isMatch, isSelected, onClick }) {
  const polygonRef = useRef(null);
  const clickable = grave.state !== 'missing';
  const eventHandlers = useMemo(
    () => (clickable ? { click: (event) => onClick(grave, event) } : {}),
    [clickable, grave, onClick],
  );

  // Leaflet draws later outlines over earlier ones, so a highlighted grave is
  // brought to the front, where its thicker border is not hidden by neighbours.
  useEffect(() => {
    if ((isMatch || isSelected) && polygonRef.current) polygonRef.current.bringToFront();
  }, [isMatch, isSelected]);

  return (
    <Polygon
      ref={polygonRef}
      positions={grave.positions}
      pathOptions={graveStyle(grave.state, isMatch, isSelected)}
      interactive={clickable}
      eventHandlers={eventHandlers}
    >
      {clickable && (
        <Tooltip sticky>
          {grave.persons.length > 0
            ? grave.persons.map((person) => <div key={person.person_id}>{personName(person)}</div>)
            : <div className="fst-italic">Photos only: no name could be read</div>}
          <div className="text-muted small">{grave.ref}</div>
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
 * The list of people on a shared stone, shown where the stone was clicked.
 *
 * @param {object} props
 * @param {{grave: object, point: {x: number, y: number}}} props.chooser The
 *   stone, and the click's position in pixels from the map's top left.
 * @param {function(string, string): void} props.onPick Called with the
 *   grave's reference and the chosen person's id.
 * @param {function(): void} props.onClose Closes the chooser.
 * @returns {JSX.Element} The chooser.
 */
function SharedStoneChooser({ chooser, onPick, onClose }) {
  const { grave, point } = chooser;
  return (
    <div className="map-chooser shadow" style={{ left: point.x, top: point.y }} role="dialog" aria-label="Choose a person">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <span className="small text-muted">Shared stone · {grave.ref}</span>
        <button type="button" className="btn-close btn-sm" aria-label="Close" onClick={onClose} />
      </div>
      {grave.persons.map((person) => (
        <button
          key={person.person_id}
          type="button"
          className="map-chooser-person"
          onClick={() => onPick(grave.ref, person.person_id)}
        >
          {personName(person)}
        </button>
      ))}
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

  const layout = useMemo(
    () => (mapData ? resolveLayout(mapData, ALLOW_DEMO_LAYOUT) : null),
    [mapData],
  );
  // The whole drawing, as Leaflet bounds; the same array while the layout is.
  const fullBounds = useMemo(
    () => (layout ? [[-layout.height, 0], [0, layout.width]] : null),
    [layout],
  );

  /**
   * Opens the clicked grave's record, or asks which person when it is shared.
   *
   * @param {object} grave The grave clicked.
   * @param {object} event Leaflet's click event.
   */
  const handleGraveClick = useCallback((grave, event) => {
    // Stop the click reaching the map, which would close the chooser just opened.
    L.DomEvent.stopPropagation(event);
    if (grave.persons.length > 1) {
      // The chooser lists the same names, so the hover tooltip would only cover it.
      event.target.closeTooltip();
      setChooser({ grave, point: event.containerPoint });
      return;
    }
    setChooser(null);
    onOpenRecord(grave.ref, grave.persons[0]?.person_id ?? null);
  }, [onOpenRecord]);

  const closeChooser = useCallback(() => setChooser(null), []);

  return (
    <div className="cemetery-map">
      {layout && (
        <MapContainer
          crs={L.CRS.Simple}
          bounds={fullBounds}
          minZoom={-4}
          maxZoom={4}
          zoomSnap={0.25}
          zoomControl={false}
          attributionControl={false}
          className="cemetery-map-canvas"
        >
          <ZoomControl position="topright" />
          {layout.graves.map((grave) => (
            <GraveOutline
              key={grave.ref}
              grave={grave}
              isMatch={matchRefs.has(grave.ref)}
              isSelected={grave.ref === selectedRef}
              onClick={handleGraveClick}
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
