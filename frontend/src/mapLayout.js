/**
 * Helpers for the cemetery map: where each grave is drawn and how it looks.
 *
 * Graves are placed in pixels of the aerial image, x to the right and y down.
 * Leaflet's CRS.Simple has its y axis pointing up, so a point [x, y] is drawn
 * at the map position [-y, x]; the image then fills [[-height, 0], [0, width]].
 *
 * Until the team has placed the graves (placements.json, loaded by
 * import.py --placements), no grave has an outline. During development
 * `demoLayout` can lay the graves out in a grid instead, by section, row and
 * stone, so the map and its link to the search can be tried. Those positions
 * are not the graves' real positions, and the map says so.
 *
 * Nothing here touches React or Leaflet, so every function can be tested alone.
 */

import { sectionName } from './labels.js';

// ── Looks ───────────────────────────────────────────────────────────────────
// One style per map state (N4). A search match and the selected grave are
// drawn over their state's style. The fills are see-through, so the stones on
// the aerial show inside their outlines. A match and the selected grave also
// get thicker borders, so they stand out for visitors who cannot tell the
// colours apart.
export const STATE_STYLES = {
  missing: {
    key: 'missing', label: 'No record yet', color: '#8f8a80', fillColor: '#dcd7cc', fillOpacity: 0.25, weight: 1.5, dashArray: '3 3',
  },
  incomplete: {
    key: 'incomplete', label: 'Photos only', color: '#a8853a', fillColor: '#ead39b', fillOpacity: 0.4, weight: 1.5,
  },
  documented: {
    key: 'documented', label: 'Documented', color: '#2f4a3e', fillColor: '#93b4a2', fillOpacity: 0.35, weight: 1.5,
  },
};
export const MATCH_STYLE = {
  key: 'match', label: 'In your search', color: '#1d4f91', fillColor: '#4c8ad6', fillOpacity: 0.6, weight: 2.5,
};
export const SELECTED_STYLE = {
  key: 'selected', label: 'Selected', color: '#7a1611', fillColor: '#e2493f', fillOpacity: 0.7, weight: 4,
};

// A shape that several graves share (an area for graves whose exact place is
// not known yet) is filled this much more faintly, so the aerial shows through.
const SHARED_FILL_SHARE = 0.35;

// The legend's entries, in the order the design lists the states.
export const LEGEND = [
  STATE_STYLES.missing, STATE_STYLES.incomplete, STATE_STYLES.documented, MATCH_STYLE, SELECTED_STYLE,
];

/**
 * Returns the legend's entries worth showing: the states some shape on the
 * map is in (no grave is "Photos only" until photos are loaded, say), then the
 * search match and the selection, which the visitor brings about.
 *
 * @param {Array<object>} shapes The shapes on the map (see groupShapes).
 * @returns {Array<object>} The entries, in the legend's order.
 */
export function legendEntries(shapes) {
  const present = new Set(shapes.map((shape) => shape.state));
  return LEGEND.filter((entry) => !STATE_STYLES[entry.key] || present.has(entry.key));
}

/**
 * Returns the Leaflet path options for one grave.
 *
 * @param {string} state The grave's state: "missing", "incomplete" or "documented".
 * @param {boolean} isMatch Whether the grave holds someone in the search results.
 * @param {boolean} isSelected Whether the grave is the one open in the record pane.
 * @returns {object} Leaflet path options (colour, fill, weight, dashes).
 */
export function graveStyle(state, isMatch, isSelected) {
  // Every style lists the same keys except dashArray, so it is reset here:
  // otherwise a selected missing grave would keep its dashes.
  const base = { dashArray: null, ...(STATE_STYLES[state] || STATE_STYLES.missing) };
  if (isSelected) return { ...base, ...SELECTED_STYLE, dashArray: null };
  if (isMatch) return { ...base, ...MATCH_STYLE, dashArray: null };
  return base;
}

/**
 * Returns the Leaflet path options for one shape on the map.
 *
 * @param {object} shape A shape from `groupShapes`.
 * @param {boolean} isMatch Whether any of its graves holds someone in the list.
 * @param {boolean} isSelected Whether one of its graves is open in the record pane.
 * @returns {object} Leaflet path options; a shared area is filled more faintly.
 */
export function shapeStyle(shape, isMatch, isSelected) {
  const style = graveStyle(shape.state, isMatch, isSelected);
  if (shape.graves.length > 1) return { ...style, fillOpacity: style.fillOpacity * SHARED_FILL_SHARE };
  return style;
}

// ── Coordinates ─────────────────────────────────────────────────────────────

/**
 * Converts points in image pixels to Leaflet positions (see the module comment).
 *
 * @param {Array<Array<number>>} points Points as [x, y] in pixels.
 * @returns {Array<Array<number>>} The same points as [lat, lng] for CRS.Simple.
 */
export function toLatLngs(points) {
  return points.map(([x, y]) => [-y, x]);
}

/**
 * Returns the smallest box around the outlines of some graves.
 *
 * @param {Array<object>} graves Graves with an `outline` of [x, y] points.
 * @returns {?Array<Array<number>>} The box as Leaflet bounds,
 *   [[south, west], [north, east]], or null when no grave has an outline.
 */
export function boundsOfGraves(graves) {
  const points = graves.flatMap((grave) => grave.outline || []);
  if (points.length === 0) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [[-Math.max(...ys), Math.min(...xs)], [-Math.min(...ys), Math.max(...xs)]];
}

// ── The demo grid ───────────────────────────────────────────────────────────
const SECTION_ORDER = ['women', 'children', 'men'];   // left to right
const DEMO = {
  stoneWidth: 16,      // pixels of one stone, across the row
  stoneHeight: 24,     // pixels of one stone, along the path between rows
  stoneGap: 6,         // between two stones of a row
  rowGap: 14,          // between two rows
  sectionGap: 90,      // between two sections
  margin: 40,          // around the whole grid
};

/**
 * Orders row labels as a visitor would read them: by their leading number,
 * then by the rest ("2" < "2B" < "5.5C" < "10"), and rows without a number
 * ("MISC2") after the numbered ones.
 *
 * @param {string} a A row label.
 * @param {string} b Another row label.
 * @returns {number} Negative when `a` comes first, positive when `b` does, 0 if equal.
 */
export function compareRowLabels(a, b) {
  const numberA = a.match(/^[0-9]+(\.[0-9]+)?/);
  const numberB = b.match(/^[0-9]+(\.[0-9]+)?/);
  if (numberA && !numberB) return -1;
  if (!numberA && numberB) return 1;
  if (numberA && numberB) {
    const difference = parseFloat(numberA[0]) - parseFloat(numberB[0]);
    if (difference !== 0) return difference;
  }
  return a.localeCompare(b);
}

/**
 * Lays the graves out in a grid: sections side by side (women, children, men),
 * each section's rows one under another, and each row's stones from left to
 * right by stone number. For development only: these are not real positions.
 *
 * @param {Array<object>} graves Graves from /api/map/graves (section, row, stone, …).
 * @returns {{graves: Array<object>, width: number, height: number}} Every grave
 *   given an outline (a rectangle) and a centroid, and the grid's size in pixels.
 */
export function demoLayout(graves) {
  const placed = [];
  let sectionLeft = DEMO.margin;
  let height = 0;

  for (const section of SECTION_ORDER) {
    const inSection = graves.filter((grave) => grave.section === section);
    if (inSection.length === 0) continue;
    const rows = [...new Set(inSection.map((grave) => grave.row))].sort(compareRowLabels);
    let sectionWidth = 0;

    rows.forEach((row, rowIndex) => {
      const top = DEMO.margin + rowIndex * (DEMO.stoneHeight + DEMO.rowGap);
      for (const grave of inSection.filter((g) => g.row === row)) {
        const left = sectionLeft + (grave.stone - 1) * (DEMO.stoneWidth + DEMO.stoneGap);
        const right = left + DEMO.stoneWidth;
        const bottom = top + DEMO.stoneHeight;
        placed.push({
          ...grave,
          outline: [[left, top], [right, top], [right, bottom], [left, bottom]],
          centroid: [(left + right) / 2, (top + bottom) / 2],
        });
        sectionWidth = Math.max(sectionWidth, right - sectionLeft);
        height = Math.max(height, bottom + DEMO.margin);
      }
    });
    sectionLeft += sectionWidth + DEMO.sectionGap;
  }
  const width = sectionLeft - DEMO.sectionGap + DEMO.margin;
  return { graves: placed, width: Math.max(width, 2 * DEMO.margin), height: Math.max(height, 2 * DEMO.margin) };
}

/**
 * Decides what the map draws from the answer of /api/map/graves.
 *
 * Placed graves are drawn where they are, on an image of the size the
 * cemetery row records (or, without one, just big enough for the outlines).
 * When no grave is placed and the demo grid is allowed, the grid is used.
 *
 * @param {{image: ?object, graves: Array<object>}} data The API's answer.
 * @param {boolean} allowDemo Whether the demo grid may be used.
 * @returns {{graves: Array<object>, shapes: Array<object>, width: number, height: number, demo: boolean}}
 *   The graves drawn (those with an outline), the shapes that draw them (see
 *   `groupShapes`), the drawing's size in pixels, and whether it is the demo grid.
 */
export function resolveLayout(data, allowDemo) {
  const placed = data.graves.filter((grave) => grave.outline && grave.outline.length >= 3);
  let layout;
  if (placed.length > 0) {
    const box = boundsOfGraves(placed);
    // box is [[-maxY, minX], [-minY, maxX]]: the outlines reach maxX across and maxY down.
    layout = {
      graves: placed,
      width: data.image?.width || Math.ceil(box[1][1]) + DEMO.margin,
      height: data.image?.height || Math.ceil(-box[0][0]) + DEMO.margin,
      demo: false,
    };
  } else if (allowDemo && data.graves.length > 0) {
    layout = { ...demoLayout(data.graves), demo: true };
  } else {
    layout = { graves: [], width: data.image?.width || 1000, height: data.image?.height || 750, demo: false };
  }
  layout.shapes = groupShapes(layout.graves);
  return layout;
}

// How the states rank when graves share a shape: the shape shows the best one.
const STATE_RANK = { missing: 0, incomplete: 1, documented: 2 };

/**
 * Groups graves into the shapes the map draws: one per distinct outline.
 *
 * Most graves have an outline of their own. The stone mapping gives graves not
 * yet located one shared area instead, and drawing that area once per grave
 * would stack identical shapes, of which a click could reach only the top one.
 *
 * @param {Array<object>} graves Graves with an `outline`.
 * @returns {Array<object>} The shapes, largest first. Each holds `key` (its
 *   outline as text), `outline`, `positions` for Leaflet, `graves` (in the
 *   order given), `refs`, `state` (the best of its graves': documented, then
 *   incomplete, then missing) and `entries`, what a click can open: one per
 *   person, `{ref, person}`, plus `{ref, person: null}` for each photo-only
 *   grave. Missing records add none, so a shape with no entries cannot be clicked.
 */
export function groupShapes(graves) {
  const byOutline = new Map();
  for (const grave of graves) {
    const key = JSON.stringify(grave.outline);
    if (!byOutline.has(key)) byOutline.set(key, []);
    byOutline.get(key).push(grave);
  }
  const shapes = [...byOutline].map(([key, members]) => ({
    key,
    outline: members[0].outline,
    positions: toLatLngs(members[0].outline),
    graves: members,
    refs: members.map((grave) => grave.ref),
    state: members.map((grave) => grave.state)
      .reduce((best, state) => ((STATE_RANK[state] ?? 0) > (STATE_RANK[best] ?? 0) ? state : best)),
    entries: members.flatMap((grave) => {
      if (grave.persons.length > 0) return grave.persons.map((person) => ({ ref: grave.ref, person }));
      return grave.state === 'incomplete' ? [{ ref: grave.ref, person: null }] : [];
    }),
  }));
  // Leaflet draws later shapes over earlier ones. Drawing the largest first
  // keeps a wide area underneath the single graves inside it, where it cannot
  // hide them or take their clicks.
  return shapes.sort((a, b) => boxArea(b.outline) - boxArea(a.outline));
}

// ── The aerial ──────────────────────────────────────────────────────────────
const TILE_SIZE = 256;   // pixels per tile side, as stone_mapping/make_tiles.py cuts them
export const MIN_MAP_ZOOM = -5;   // the farthest the map zooms out (1 map unit = 2^zoom screen px)
export const MAX_MAP_ZOOM = 3;    // the closest it zooms in; past 0 it enlarges the full-size tiles

/**
 * Returns how many levels the aerial's tile pyramid has: enough halvings for
 * the whole aerial to fit in one tile. It must agree with `level_count` in
 * stone_mapping/make_tiles.py, which cut the tiles.
 *
 * @param {number} width The aerial's width in pixels.
 * @param {number} height The aerial's height in pixels.
 * @returns {number} The number of levels; 5 (0 to 4) for 4096 × 3072.
 */
export function tileLevels(width, height) {
  return Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE))) + 1;
}

/**
 * Works out the Leaflet tile layer that draws the aerial under the graves.
 *
 * The tiles are numbered from level 0 (the whole aerial in one tile) to the
 * top level (full size), but the map counts zoom from 0 at full size, one map
 * unit per aerial pixel. So the layer adds the top level to the map's zoom
 * (`zoomOffset`), and the levels it has (`minNativeZoom` to `maxNativeZoom`)
 * run from minus the top level to 0; zooming closer enlarges the full-size tiles.
 *
 * @param {?object} image The aerial's width, height and tiles_path from the API.
 * @param {boolean} isDemo Whether the map shows the demo grid, which the aerial
 *   would not match.
 * @param {string} defaultPath Where the tiles are when the cemetery row names
 *   no tiles_path: the static site's own /tiles.
 * @returns {?object} The layer's url template, tileSize, zoomOffset,
 *   minNativeZoom, maxNativeZoom, minZoom and bounds; null when there is no
 *   aerial to draw.
 */
export function aerialTiles(image, isDemo, defaultPath) {
  if (isDemo || !image?.width || !image?.height) return null;
  const topLevel = tileLevels(image.width, image.height) - 1;
  const path = (image.tiles_path || defaultPath).replace(/\/+$/, '');
  return {
    url: `${path}/{z}/{x}/{y}.jpg`,
    tileSize: TILE_SIZE,
    zoomOffset: topLevel,
    minNativeZoom: -topLevel,
    maxNativeZoom: 0,
    // Leaflet hides a tile layer below its minZoom, 0 unless set; this map's
    // overview sits below 0, so the layer must reach as far out as the map does.
    minZoom: MIN_MAP_ZOOM,
    // Only tiles inside the aerial are asked for.
    bounds: [[-image.height, 0], [0, image.width]],
  };
}

/**
 * Returns the area of the smallest box around an outline, to compare sizes.
 *
 * @param {Array<Array<number>>} outline Points as [x, y] in pixels.
 * @returns {number} The box's width times its height, in square pixels.
 */
export function boxArea(outline) {
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

// ── Labels ──────────────────────────────────────────────────────────────────
// The large block of graves the team has not documented yet, as a share of the
// aerial's width and height (stone_mapping/annotated_aerial.png shows its rows).
const UNDOCUMENTED_AREA = { x: 0.49, y: 0.57 };
const SECTION_LABEL_GAP = 45;   // pixels above a section's first graves
const ROW_LABEL_GAP = 18;       // pixels past the end of a row

/**
 * Works out where the map writes its labels, in pixels of the aerial:
 * • each section's name, centred above its numbered rows;
 * • each numbered row's label, just past the far end of the row (the rows
 *   run down the aerial, so below its lowest grave);
 * • "Not yet documented" over the block of graves not documented yet.
 * Rows without a number (MISC, MISC2) and children's row 0 are graves
 * scattered on the outskirts (see CLAUDE.md › Stone mapping), and a grave on
 * a shared area is not located yet, so these get no row label and are left
 * out of the sections' extents.
 *
 * @param {Array<object>} graves The placed graves (section, row and outline).
 * @param {?object} image The aerial's width and height, or null.
 * @returns {{sections: Array<object>, rows: Array<object>, areas: Array<object>}}
 *   Labels, each `{key, text, point}` with `point` as [x, y].
 */
export function mapLabels(graves, image) {
  // A grave on a shared area (one outline for several graves not yet located)
  // is not where its row is, so it must not stretch a section or a row either.
  const outlineUses = new Map();
  for (const grave of graves) {
    const key = JSON.stringify(grave.outline);
    outlineUses.set(key, (outlineUses.get(key) || 0) + 1);
  }
  const numbered = graves.filter((grave) => /^[1-9]/.test(grave.row) && grave.outline
    && outlineUses.get(JSON.stringify(grave.outline)) === 1);
  const bySection = new Map();
  const byRow = new Map();
  for (const grave of numbered) {
    if (!bySection.has(grave.section)) bySection.set(grave.section, []);
    bySection.get(grave.section).push(grave);
    const rowKey = `${grave.section}|${grave.row}`;
    if (!byRow.has(rowKey)) byRow.set(rowKey, []);
    byRow.get(rowKey).push(grave);
  }
  // The box of some graves, as {minX, maxX, minY, maxY} in pixels.
  const box = (members) => {
    const points = members.flatMap((grave) => grave.outline);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const sections = [...bySection].map(([section, members]) => {
    const b = box(members);
    return {
      key: section,
      text: sectionName(section),
      point: [(b.minX + b.maxX) / 2, b.minY - SECTION_LABEL_GAP],
    };
  });
  const rows = [...byRow].map(([rowKey, members]) => {
    const b = box(members);
    return { key: rowKey, text: members[0].row, point: [(b.minX + b.maxX) / 2, b.maxY + ROW_LABEL_GAP] };
  });
  const areas = image?.width && image?.height
    ? [{
      key: 'undocumented',
      text: 'Not yet documented',
      point: [image.width * UNDOCUMENTED_AREA.x, image.height * UNDOCUMENTED_AREA.y],
    }]
    : [];
  return { sections, rows, areas };
}
