/**
 * Gravestone Record View (N8): a detail panel showing a person's names, dates,
 * age at death, relatives, and epitaph in Spanish and Hebrew, alongside photos.
 *
 * A band at the top holds the pane's controls (back to the results, Share,
 * close) and the name (the Hebrew one first when the stone carries no Latin
 * name); it stays in view as the record scrolls, so it is always clear whose
 * record is open. Under it come the portrait, the years and the Hebrew date
 * of death, and where the grave is. Every grave uses the same layout, and a
 * field with no value on record reads "Not on record" on a quiet coloured
 * bar. A date worked out rather than carved is shown as a range, with a note
 * saying where it comes from. The additional details are shown at first;
 * "Show less" folds them away and "Show more" brings them back. The grave's
 * photos, from Cloudinary, show as a strip of thumbnails, with the portrait
 * (if any) beside the dates; clicking one opens PhotoLightbox, a full-screen
 * carousel with zoom. A grave with no photos shows a note in their place. The
 * Share button is a placeholder until shared links (N5).
 */

import { useState } from 'react';
import { Button, Collapse } from 'react-bootstrap';
import { describeYears, formatHebrewDate, formatPersonDate, hasValue, isDerivedDate } from './recordDates.js';
import { describeLocation, displayLatinName, personNames } from './labels.js';
import { thumbnailUrl } from './cloudinary.js';
import PhotoLightbox from './PhotoLightbox.jsx';

/** The note under a derived date, saying where it comes from. */
const DERIVED_NOTES = {
  death: 'worked out from the Hebrew date',
  birth: 'estimated from the age at death',
};

/**
 * One labelled field of the Additional details section. A missing value
 * reads "Not on record" on a coloured bar; zero is a value and is shown.
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
        <span className="redacted">Not on record</span>
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
 * @param {boolean} props.detailsOpen Whether the additional details are shown.
 *   The explore page keeps this, so that the choice carries over from one
 *   record to the next.
 * @param {function(): void} props.onToggleDetails Shows or folds away the details.
 * @returns {JSX.Element} The record pane.
 */
function RecordPane({ record, onClose, detailsOpen, onToggleDetails }) {
  // The photo open in the lightbox, as an index into lightboxPhotos, or null when it is shut.
  const [lightboxIndex, setLightboxIndex] = useState(null);

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

  // A photo whose public ID names it a portrait (photo names describe the
  // view: front, text, portrait, ...) fills the portrait slot in the header.
  const portraitPhoto = record.photos.find(
    (photo) => photo.cloudinary_public_id.toLowerCase().includes('portrait'),
  ) ?? null;

  // The strip leaves the portrait out, as it is already in the header; the
  // lightbox shows every photo, the portrait first.
  const stripPhotos = record.photos.filter((photo) => photo !== portraitPhoto);
  const lightboxPhotos = portraitPhoto ? [portraitPhoto, ...stripPhotos] : stripPhotos;

  return (
    <div className="record-pane shadow rounded bg-white p-3 d-flex flex-column">
      {/* The band that stays at the top as the record scrolls (N8): the
          controls, then the name and the Hebrew name */}
      <div className="record-sticky-head">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Button variant="link" className="p-0 text-decoration-none text-secondary fw-semibold" onClick={onClose}>
            ← Results
          </Button>
          <div>
            <Button variant="outline-secondary" size="sm" className="me-2">
              Share
            </Button>
            <Button variant="light" size="sm" onClick={onClose} aria-label="Close">
              ×
            </Button>
          </div>
        </div>
        <div className="d-flex justify-content-between align-items-baseline gap-3 flex-wrap">
          <h3
            className="record-name h4 mb-0"
            dir={names.primaryIsHebrew ? 'rtl' : undefined}
            lang={names.primaryIsHebrew ? 'he' : undefined}
          >
            {names.primary}
          </h3>
          {names.secondary && (
            <div className="record-name-hebrew h5 mb-0" dir="rtl" lang="he">{names.secondary}</div>
          )}
        </div>
      </div>

      {/* Under the band: portrait, dates and location */}
      <div className="d-flex align-items-start gap-3 mt-3 mb-3">
        {portraitPhoto ? (
          <button
            type="button"
            className="record-portrait p-0 border rounded flex-shrink-0"
            onClick={() => setLightboxIndex(0)}
            aria-label="Open the portrait"
          >
            <img src={thumbnailUrl(portraitPhoto.cloudinary_public_id, 80)} alt="" />
          </button>
        ) : (
          <div className="record-portrait bg-light border rounded flex-shrink-0" aria-hidden="true"></div>
        )}
        <div className="flex-grow-1 min-w-0">
          <div className="record-dates">
            {years !== '—' && <span>{years}</span>}
            {years !== '—' && hebrewDeathDate && <span className="mx-2 text-muted">&middot;</span>}
            {hebrewDeathDate && <span>{hebrewDeathDate}</span>}
          </div>
          <hr className="my-2" style={{ borderColor: '#d4cbb8' }} />
          <div className="text-muted small">{location}</div>
        </div>
      </div>

      {/* Photos: a strip of thumbnails; clicking one opens it in the lightbox */}
      {stripPhotos.length > 0 ? (
        <div className="record-photo-strip d-flex gap-2 mb-4 overflow-auto pb-2">
          {stripPhotos.map((photo) => {
            // The lightbox shows the portrait first, so a photo's place there
            // can be one ahead of its place in the strip.
            const lightboxPosition = lightboxPhotos.indexOf(photo);
            return (
              <button
                type="button"
                key={photo.cloudinary_public_id}
                className="record-photo-tile p-0 border rounded flex-shrink-0"
                onClick={() => setLightboxIndex(lightboxPosition)}
                aria-label={`Open photograph ${lightboxPosition + 1} of ${lightboxPhotos.length}`}
              >
                <img src={thumbnailUrl(photo.cloudinary_public_id, 120)} alt="" loading="lazy" />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="record-photos-note small text-muted mb-4">
          {portraitPhoto
            ? 'This stone has no photographs besides the portrait.'
            : 'Photographs of this stone will appear here soon.'}
        </p>
      )}

      <PhotoLightbox
        photos={lightboxPhotos}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
        title={names.primary}
      />

      {/* Additional details: shown at first, folded away by "Show less" */}
      <div className="mt-auto">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h4 className="h6 fw-semibold mb-0">Additional details</h4>
          <Button
            variant="link"
            size="sm"
            className="record-details-toggle p-0 text-decoration-none fw-semibold"
            onClick={onToggleDetails}
            aria-controls="additional-details-collapse"
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? 'Show less' : 'Show more'} <span aria-hidden="true">{detailsOpen ? '▴' : '▾'}</span>
          </Button>
        </div>

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
