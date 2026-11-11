/**
 * The Filters button of the explore page and the pop-up it opens (wireframe
 * 2.4): sliders for the year of birth and the year of death, a section choice
 * and a row field (Project Design › Application Interface › N2).
 *
 * The pop-up edits a draft copy of the filters. Nothing changes in the search
 * until "Show results" hands the draft to the page; closing the pop-up any
 * other way (the ×, Esc or a click outside it) throws the draft away.
 *
 * The pop-up is a react-bootstrap Dropdown, which already positions the menu
 * under its button, closes it on Esc or on a click outside, and handles
 * clicks on the button itself while the menu is open.
 */

import { useState } from 'react';
import { Button, CloseButton, Dropdown, Form } from 'react-bootstrap';
import {
  BIRTH_SLIDER, DEATH_SLIDER, NO_FILTERS, SECTIONS, describeFilters, describeYearRange,
} from './searchFilters.js';

/**
 * Turns a year into its position along a slider, as a percentage of its length.
 *
 * @param {number} year The year.
 * @param {{min: number, max: number}} range The slider's two ends.
 * @returns {number} 0 at the left end, 100 at the right end; years outside
 *   the slider are placed at its nearest end.
 */
function percentAlong(year, range) {
  const clamped = Math.min(Math.max(year, range.min), range.max);
  return ((clamped - range.min) / (range.max - range.min)) * 100;
}

/**
 * A slider with two handles that picks a range of years. Each handle left at
 * its end of the slider sets no bound, and while both are at their ends the
 * slider reads "Any" and stays grey; once a handle moves it turns green.
 *
 * It is built from two ordinary range inputs laid on top of each other (see
 * `.year-range` in index.css), so that keyboards and screen readers can work
 * each handle as a normal slider.
 *
 * @param {object} props
 * @param {string} props.label The slider's name, e.g. "Year of death".
 * @param {{min: number, max: number}} props.range The slider's two ends.
 * @param {string} props.from The earliest year chosen, or '' for none.
 * @param {string} props.to The latest year chosen, or '' for none.
 * @param {function(string, string): void} props.onChange Called with the new
 *   earliest and latest years ('' for an end left open) whenever a handle moves.
 * @returns {JSX.Element} The labelled slider.
 */
function YearRangeSlider({ label, range, from, to, onChange }) {
  // Where each handle sits: an unset bound sits at its end of the slider.
  const low = from === '' ? range.min : Number(from);
  const high = to === '' ? range.max : Number(to);
  const isSet = from !== '' || to !== '';
  const labelId = `${label.toLowerCase().replaceAll(' ', '-')}-label`;

  /**
   * Moves the left handle, never past the right one.
   *
   * @param {Event} e The input's change event.
   */
  const handleLowChange = (e) => {
    const year = Math.min(Number(e.target.value), high);
    onChange(year === range.min ? '' : String(year), to);
  };

  /**
   * Moves the right handle, never past the left one.
   *
   * @param {Event} e The input's change event.
   */
  const handleHighChange = (e) => {
    const year = Math.max(Number(e.target.value), low);
    onChange(from, year === range.max ? '' : String(year));
  };

  // When both handles meet, the one on top is the one that can be dragged.
  // Keep the left handle on top in the right half of the slider, so that two
  // handles pushed together at the right end can still be pulled apart.
  const lowOnTop = percentAlong(low, range) > 50;

  return (
    <div className="mb-3" role="group" aria-labelledby={labelId}>
      <div className="d-flex justify-content-between align-items-baseline">
        <span id={labelId} className="fw-semibold">{label}</span>
        <span className={isSet ? 'year-range-value is-set' : 'year-range-value'}>
          {describeYearRange(from, to)}
        </span>
      </div>
      <div className={isSet ? 'year-range is-set' : 'year-range'}>
        <div className="year-range-rail">
          <div
            className="year-range-fill"
            style={{
              left: `${percentAlong(low, range)}%`,
              width: `${percentAlong(high, range) - percentAlong(low, range)}%`,
            }}
          />
        </div>
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={1}
          value={Math.min(Math.max(low, range.min), range.max)}
          onChange={handleLowChange}
          aria-label={`${label}, earliest`}
          style={{ zIndex: lowOnTop ? 3 : 2 }}
        />
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={1}
          value={Math.min(Math.max(high, range.min), range.max)}
          onChange={handleHighChange}
          aria-label={`${label}, latest`}
          style={{ zIndex: lowOnTop ? 2 : 3 }}
        />
      </div>
      <div className="d-flex justify-content-between small text-muted">
        <span>{range.min}</span>
        <span>{range.max}</span>
      </div>
    </div>
  );
}

/**
 * The form inside the pop-up. It starts from the filters in use and keeps its
 * own draft of them, which only "Show results" passes on.
 *
 * @param {object} props
 * @param {object} props.filters The filters in use when the pop-up opened.
 * @param {function(object): void} props.onApply Called with the chosen filters.
 * @param {function(): void} props.onClose Closes the pop-up without applying.
 * @returns {JSX.Element} The filters form.
 */
function FiltersForm({ filters, onApply, onClose }) {
  const [draft, setDraft] = useState(filters);

  /**
   * Changes some fields of the draft, keeping the others.
   *
   * @param {object} changes The new values, by filter key.
   */
  const update = (changes) => setDraft((current) => ({ ...current, ...changes }));

  /**
   * Applies the draft; the Enter key in the row field submits the form too.
   *
   * @param {Event} e The form's submit event.
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    onApply({ ...draft, row: draft.row.trim() });
  };

  return (
    <Form onSubmit={handleSubmit}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="h5 mb-0">Filters</h2>
        <CloseButton aria-label="Close filters" onClick={onClose} />
      </div>

      <YearRangeSlider
        label="Year of birth"
        range={BIRTH_SLIDER}
        from={draft.birth_from}
        to={draft.birth_to}
        onChange={(from, to) => update({ birth_from: from, birth_to: to })}
      />

      <YearRangeSlider
        label="Year of death"
        range={DEATH_SLIDER}
        from={draft.death_from}
        to={draft.death_to}
        onChange={(from, to) => update({ death_from: from, death_to: to })}
      />

      <fieldset className="mb-3">
        <legend className="fs-6 fw-semibold mb-1">Section</legend>
        {[{ value: '', label: 'Any' }, ...SECTIONS].map((option) => (
          <Form.Check
            inline
            type="radio"
            key={option.value || 'any'}
            id={`filter-section-${option.value || 'any'}`}
            name="filter-section"
            label={option.label}
            checked={draft.section === option.value}
            onChange={() => update({ section: option.value })}
          />
        ))}
      </fieldset>

      <Form.Group className="mb-3" controlId="filter-row">
        <Form.Label className="fw-semibold mb-1">Row</Form.Label>
        <Form.Control
          type="text"
          value={draft.row}
          onChange={(e) => update({ row: e.target.value })}
          placeholder="Any, e.g. 12"
          maxLength={20}
        />
      </Form.Group>

      <p className="small text-muted">
        Left at its full range, a slider means any year. Dates worked out from
        a Hebrew date or an age at death count when their range touches the
        years chosen. People with no date on record drop out once a slider moves.
      </p>

      <div className="d-flex justify-content-between align-items-center border-top pt-3">
        <Button variant="link" className="p-0 filters-clear" onClick={() => setDraft({ ...NO_FILTERS })}>
          Clear all
        </Button>
        <Button type="submit" className="filters-apply">
          Show results
        </Button>
      </div>
    </Form>
  );
}

/**
 * The Filters button, showing how many filters are in use, and its pop-up.
 *
 * @param {object} props
 * @param {object} props.filters The filters in use (from the page's URL).
 * @param {function(object): void} props.onApply Called with the filters
 *   chosen when the visitor presses "Show results".
 * @returns {JSX.Element} The button and its pop-up.
 */
function FiltersMenu({ filters, onApply }) {
  const [open, setOpen] = useState(false);
  const count = describeFilters(filters).length;

  /**
   * Closes the pop-up and passes the chosen filters to the page.
   *
   * @param {object} chosen The filters chosen in the pop-up.
   */
  const handleApply = (chosen) => {
    setOpen(false);
    onApply(chosen);
  };

  // autoClose="outside": clicks inside the pop-up (on a slider, say) keep it open.
  return (
    <Dropdown show={open} onToggle={(nextShow) => setOpen(nextShow)} autoClose="outside">
      <Dropdown.Toggle variant="" className="filters-toggle" id="search-filters-toggle">
        Filters
        {count > 0 && (
          <span className="filters-count">
            {count}
            <span className="visually-hidden"> in use</span>
          </span>
        )}
      </Dropdown.Toggle>
      <Dropdown.Menu className="filters-menu">
        {/* Mounted only while open, so each opening starts from the filters in use. */}
        {open && <FiltersForm filters={filters} onApply={handleApply} onClose={() => setOpen(false)} />}
      </Dropdown.Menu>
    </Dropdown>
  );
}

export default FiltersMenu;
