/**
 * Gravestone Record View (N8): a detail panel showing a person's names, dates,
 * age at death, relatives, and epitaph in Spanish and Hebrew, alongside photos.
 *
 * The header gives the name (the Hebrew one first when the stone carries no
 * Latin name), the years and the Hebrew date of death, and where the grave
 * is. Every grave uses the same layout, and a field with no value on record is
 * shown redacted, as a quiet grey bar (Project Design › Application
 * Interface). A date worked out rather than carved is shown as a range, with a
 * note saying where it comes from. Until photos are on Cloudinary a note says
 * so in their place; the Share button is a placeholder until shared links (N5).
 */

import { useState } from 'react';
import { Button, Collapse } from 'react-bootstrap';
import { describeYears, formatHebrewDate, formatPersonDate, hasValue, isDerivedDate } from './recordDates.js';
import { describeLocation, displayLatinName, personNames } from './labels.js';

/** The note under a derived date, saying where it comes from. */
const DERIVED_NOTES = {
  death: 'worked out from the Hebrew date',
  birth: 'estimated from the age at death',
};

/**
 * One labelled field of the Additional details section. A missing value is
 * shown redacted: a grey bar, read out as "Not on record" by screen readers;
 * zero is a value and is shown.
 *
 * @param {object} props
 * @param {string} props.label The field's name.
 * @param {?(string|number)} props.value The field's value, or null.
 * @param {boolean} [props.isHebrew] Whether the value is Hebrew, set right to left.
 * @param {?string} [props.note] A remark shown in small type under the value,
 *   e.g. where a derived date comes from.
 * @param {boolean} [props.wide] Whether it takes a whole row of the grid.
 * @returns {JSX.Element} The label and its value.
 */
function DetailField({ label, value, isHebrew = false, note = null, wide = false }) {
  return (
    <div className={wide ? 'detail-field detail-wide' : 'detail-field'}>
      <div className="fw-semibold small text-muted mb-1">{label}</div>
      {hasValue(value) ? (
        <>
          <div dir={isHebrew ? 'rtl' : 'ltr'} lang={isHebrew ? 'he' : 'es'}>
            {value}
          </div>
          {note && <div className="small text-muted">{note}</div>}
        </>
      ) : (
        <span className="redacted" title="Not on record">
          <span className="visually-hidden">Not on record</span>
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

  const names = personNames(record);
  const location = describeLocation(record);
  const years = describeYears(record);
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

      {/* Header (N8): name, Hebrew name, dates and location */}
      <div className="mb-3">
        <div className="d-flex justify-content-between align-items-baseline gap-3 flex-wrap">
          <h3
            className="record-name h4 mb-1"
            dir={names.primaryIsHebrew ? 'rtl' : undefined}
            lang={names.primaryIsHebrew ? 'he' : undefined}
          >
            {names.primary}
          </h3>
          {names.secondary && (
            <div className="record-name-hebrew h5 mb-1" dir="rtl" lang="he">{names.secondary}</div>
          )}
        </div>
        <div className="record-dates">
          {years !== '—' && <span>{years}</span>}
          {years !== '—' && hebrewDeathDate && <span className="mx-2 text-muted">&middot;</span>}
          {hebrewDeathDate && <span>{hebrewDeathDate}</span>}
        </div>
        <hr className="my-2" style={{ borderColor: '#d4cbb8' }} />
        <div className="text-muted small">{location}</div>
      </div>

      {/* Photos: one tile per photo once they are on Cloudinary; a note until then */}
      {record.photos.length > 0 ? (
        <div className="d-flex gap-2 mb-4 overflow-auto pb-2">
          {record.photos.map((photo) => (
            <div
              key={photo.cloudinary_public_id}
              className="bg-light border rounded flex-shrink-0"
              style={{ width: '120px', height: '120px' }}
            ></div>
          ))}
        </div>
      ) : (
        <p className="record-photos-note small text-muted mb-4">
          Photographs of this stone will appear here soon.
        </p>
      )}

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
          <div id="additional-details-collapse" className="pt-3 border-top">
            {/* Dates and place, then relatives (Latin beside Hebrew), then the epitaph */}
            <div className="detail-grid mb-3">
              <DetailField label="Birth date" value={birthDate} note={birthNote} />
              <DetailField label="Date of death" value={deathDate} note={deathNote} />
              <DetailField label="Hebrew date of death" value={hebrewDeathDate} />
              <DetailField label="Age at death" value={record.age_of_death} />
              <DetailField label="Location" value={location} wide />
            </div>

            <div className="detail-grid detail-grid-pairs mb-3">
              <DetailField label="Father's name" value={displayLatinName(record.father_name_es)} />
              <DetailField label="Father's name (Hebrew)" value={record.father_name_he} isHebrew={true} />
              <DetailField label="Husband's name" value={displayLatinName(record.husband_name_es)} />
              <DetailField label="Husband's name (Hebrew)" value={record.husband_name_he} isHebrew={true} />
              <DetailField label="Maiden name" value={displayLatinName(record.maiden_name_es)} />
              <DetailField label="Maiden name (Hebrew)" value={record.maiden_name_he} isHebrew={true} />
            </div>

            <DetailField label="Epitaph (as on the stone, Spanish and Hebrew)" value={record.epitaph} />
          </div>
        </Collapse>
      </div>
    </div>
  );
}

export default RecordPane;
