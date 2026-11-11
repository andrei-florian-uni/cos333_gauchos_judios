/**
 * Gravestone Record View (N8): a detail panel showing a person's names, dates,
 * age at death, relatives, and epitaph in Spanish and Hebrew, alongside photos.
 *
 * Every grave uses the same layout, and a field with no value on record is
 * shown as "not on record" (Project Design › Application Interface). A date
 * worked out rather than carved is shown as a range, with a note saying where
 * it comes from. The photo tiles and the Share button are placeholders until
 * Cloudinary and shared links (N5) are in place.
 */

import { useState } from 'react';
import { Button, Collapse } from 'react-bootstrap';
import { formatHebrewDate, formatPersonDate, hasValue, isDerivedDate } from './recordDates.js';

/** The note under a derived date, saying where it comes from. */
const DERIVED_NOTES = {
  death: 'worked out from the Hebrew date',
  birth: 'estimated from the age at death',
};

/**
 * Joins the non-empty parts of a name with spaces.
 *
 * @param {...?string} parts Name parts, any of which may be null.
 * @returns {string} The joined name, or an empty string.
 */
function joinName(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * One labelled field of the Additional details section. A missing value is
 * shown as redacted ("not on record"); zero is a value and is shown.
 *
 * @param {object} props
 * @param {string} props.label The field's name.
 * @param {?(string|number)} props.value The field's value, or null.
 * @param {boolean} [props.isHebrew] Whether the value is Hebrew, set right to left.
 * @param {?string} [props.note] A remark shown in small type under the value,
 *   e.g. where a derived date comes from.
 * @returns {JSX.Element} The label and its value.
 */
function DetailField({ label, value, isHebrew = false, note = null }) {
  return (
    <div className="mb-2">
      <div className="fw-semibold small text-muted mb-1">{label}</div>
      {hasValue(value) ? (
        <>
          <div dir={isHebrew ? 'rtl' : 'ltr'} lang={isHebrew ? 'he' : 'es'}>
            {value}
          </div>
          {note && <div className="small text-muted">{note}</div>}
        </>
      ) : (
        <span className="badge bg-light text-secondary border border-secondary-subtle">
          not on record
        </span>
      )}
    </div>
  );
}

/**
 * The record pane beside the results list.
 *
 * @param {object} props
 * @param {object} props.record The grave from /api/graves/<ref> (ref, section,
 *   row, stone, photos), merged with the columns of the person selected on it.
 * @param {function(): void} props.onClose Closes the pane and clears the selection.
 * @returns {JSX.Element} The record pane.
 */
function RecordPane({ record, onClose }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const latinName = joinName(record.name_es, record.surname_es);
  const hebrewName = joinName(record.name_he, record.surname_he);
  const sectionLabel = record.section.charAt(0).toUpperCase() + record.section.slice(1);
  const birthDate = formatPersonDate(record, 'birth');
  const deathDate = formatPersonDate(record, 'death');
  const birthNote = isDerivedDate(record, 'birth') ? DERIVED_NOTES.birth : null;
  const deathNote = isDerivedDate(record, 'death') ? DERIVED_NOTES.death : null;
  const hebrewDeathDate = formatHebrewDate(
    record.death_day_he, record.death_month_he, record.death_year_he,
  );

  return (
    <div className="record-pane shadow rounded bg-white p-3 d-flex flex-column h-100">
      {/* Header Controls */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <Button variant="link" className="p-0 text-decoration-none text-secondary fw-semibold" onClick={onClose}>
          &larr; Results
        </Button>
        <div>
          <Button variant="outline-secondary" size="sm" className="me-2">
            Share
          </Button>
          <Button variant="light" size="sm" onClick={onClose} aria-label="Close">
            &times;
          </Button>
        </div>
      </div>

      {/* Top Section: Names & Location */}
      <div className="d-flex justify-content-between align-items-start mb-3">
        {/* Placeholder for portrait */}
        <div className="bg-light border rounded" style={{ width: '60px', height: '80px', flexShrink: 0 }}></div>

        <div className="ms-3 flex-grow-1">
          <div className="d-flex justify-content-between w-100">
            <h3 className="h5 fw-bold mb-1">{latinName || 'Unidentified'}</h3>
            <h3 className="h5 mb-1" dir="rtl" lang="he">{hebrewName}</h3>
          </div>
          <hr className="my-2" style={{ borderColor: '#d4cbb8' }} />
          <div className="text-muted small">
            {sectionLabel} &middot; Row {record.row} &middot; Stone {record.stone}
          </div>
        </div>
      </div>

      {/* Photos Placeholder: one empty tile per photo until Cloudinary is set up */}
      <div className="d-flex gap-2 mb-4 overflow-auto pb-2">
        {record.photos.map((photo) => (
          <div
            key={photo.cloudinary_public_id}
            className="bg-light border rounded flex-shrink-0"
            style={{ width: '120px', height: '120px', cursor: 'pointer' }}
            title="Click to open lightbox (Mock)"
          ></div>
        ))}
      </div>

      {/* Additional Details Accordion */}
      <div className="mt-auto">
        <Button
          variant="link"
          className="p-0 text-decoration-none text-dark fw-semibold mb-3 d-flex align-items-center gap-2"
          onClick={() => setDetailsOpen(!detailsOpen)}
          aria-controls="additional-details-collapse"
          aria-expanded={detailsOpen}
        >
          Additional details
          <span style={{ transform: detailsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>
            &#9662;
          </span>
        </Button>

        <Collapse in={detailsOpen}>
          <div id="additional-details-collapse" className="pt-2 border-top">
            <div className="d-flex gap-4 mb-3">
              <div className="flex-grow-1">
                <DetailField label="Birth date" value={birthDate} note={birthNote} />
                <DetailField label="Age at death" value={record.age_of_death} />
              </div>
              <div className="flex-grow-1">
                <DetailField label="Date of death" value={deathDate} note={deathNote} />
                <DetailField label="Location (fixed)" value={`Row ${record.row} · Position ${record.stone}`} />
              </div>
              <div className="flex-grow-1">
                <DetailField label="Hebrew date of death" value={hebrewDeathDate} />
              </div>
            </div>

            <div className="d-flex gap-4 mb-3">
              <div className="flex-grow-1">
                <DetailField label="Father's name" value={record.father_name_es} />
                <DetailField label="Husband's name" value={record.husband_name_es} />
                <DetailField label="Maiden name" value={record.maiden_name_es} />
              </div>
              <div className="flex-grow-1">
                <DetailField label="Father's name (Hebrew)" value={record.father_name_he} isHebrew={true} />
                <DetailField label="Husband's name (Hebrew)" value={record.husband_name_he} isHebrew={true} />
                <DetailField label="Maiden name (Hebrew)" value={record.maiden_name_he} isHebrew={true} />
              </div>
            </div>

            <DetailField label="Epitaph (as on the stone, Spanish and Hebrew)" value={record.epitaph} />
          </div>
        </Collapse>
      </div>
    </div>
  );
}

export default RecordPane;
