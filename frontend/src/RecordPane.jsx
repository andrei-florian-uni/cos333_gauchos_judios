/**
 * Gravestone Record View (N8): A detail panel showing a person's names, dates,
 * age at death, relatives, and epitaph in Spanish and Hebrew, alongside photos.
 */

import { useState } from 'react';
import { Button, Collapse } from 'react-bootstrap';

/**
 * Joins the non-empty parts of a name with spaces.
 */
function joinName(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Renders a data field row for the Additional Details section.
 * If the value is missing, it displays as redacted.
 */
function DetailField({ label, value, isHebrew = false }) {
  return (
    <div className="mb-2">
      <div className="fw-semibold small text-muted mb-1">{label}</div>
      {value ? (
        <div dir={isHebrew ? 'rtl' : 'ltr'} lang={isHebrew ? 'he' : 'es'}>
          {value}
        </div>
      ) : (
        <span className="badge bg-light text-secondary border border-secondary-subtle">
          not on record
        </span>
      )}
    </div>
  );
}

/**
 * The floating record pane.
 * 
 * @param {object} props
 * @param {object} props.record The full grave record from the API.
 * @param {function(): void} props.onClose Closes the pane and clears selection.
 */
function RecordPane({ record, onClose }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const latinName = joinName(record.name_es, record.surname_es);
  const hebrewName = joinName(record.name_he, record.surname_he);
  const sectionLabel = record.section.charAt(0).toUpperCase() + record.section.slice(1);

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

      {/* Photos Placeholder */}
      <div className="d-flex gap-2 mb-4 overflow-auto pb-2">
        {record.photos.map((photo, i) => (
          <div 
            key={i} 
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
                <DetailField label="Birth date" value={record.birth_year ? record.birth_year : null} />
                <DetailField label="Age at death" value={record.age_of_death} />
              </div>
              <div className="flex-grow-1">
                <DetailField label="Date of death" value={record.death_year} />
                <DetailField label="Location (fixed)" value={`Row ${record.row} · Position ${record.stone}`} />
              </div>
              <div className="flex-grow-1">
                <DetailField label="Hebrew date of death" value={record.death_year_he} />
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
