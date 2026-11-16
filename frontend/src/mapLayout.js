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

// ── Looks ───────────────────────────────────────────────────────────────────
// One style per map state (N4). A search match and the selected grave are
// drawn over their state's style.
export const STATE_STYLES = {
  missing: {
    label: 'Missing record', color: '#8f8a80', fillColor: '#dcd7cc', fillOpacity: 0.5, weight: 1, dashArray: '3 3',
  },
  incomplete: {
    label: 'Incomplete record', color: '#a8853a', fillColor: '#ead39b', fillOpacity: 0.7, weight: 1,
  },
  documented: {
    label: 'Documented', color: '#3e5a4d', fillColor: '#93b4a2', fillOpacity: 0.7, weight: 1,
  },
};
export const MATCH_STYLE = {
  label: 'Search match', color: '#1d4f91', fillColor: '#4c8ad6', fillOpacity: 0.9, weight: 2,
};
export const SELECTED_STYLE = {
  label: 'Selected', color: '#9c1f1a', fillColor: '#e2493f', fillOpacity: 0.95, weight: 3,
};

// The legend's entries, in the order the design lists the states.
export const LEGEND = [
  STATE_STYLES.missing, STATE_STYLES.incomplete, STATE_STYLES.documented, MATCH_STYLE, SELECTED_STYLE,
];

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
 * @returns {{graves: Array<object>, width: number, height: number, demo: boolean}}
 *   The graves to draw, each with `positions` for Leaflet, the drawing's size
 *   in pixels, and whether it is the demo grid.
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
  // Leaflet draws later shapes over earlier ones. Drawing the largest first
  // keeps a wide outline (such as an area given to stones whose exact place is
  // unknown) underneath the single graves inside it, where it cannot hide them.
  layout.graves = layout.graves
    .map((grave) => ({ ...grave, positions: toLatLngs(grave.outline) }))
    .sort((a, b) => boxArea(b.outline) - boxArea(a.outline));
  return layout;
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
