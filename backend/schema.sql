-- The archive's five MVP tables (Project Design › Application Data Structure).
--
-- import.py runs this file before every load. Every statement is safe to run
-- again: tables and types are created only when missing. A database filled to
-- the earlier schema is cleared first with `python backend/import.py --rebuild`.

CREATE EXTENSION IF NOT EXISTS vector;          -- pgvector, for name_vectors.embedding

DO $$
BEGIN
    CREATE TYPE photo_kind AS ENUM ('main', 'other');
EXCEPTION WHEN duplicate_object THEN
    NULL;                                       -- the type exists already
END $$;

-- One cemetery: its name, where it is, and the aerial image the map draws on.
CREATE TABLE IF NOT EXISTS cemetery (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL UNIQUE,
    town             text,
    province         text,
    aerial_width_px  integer CHECK (aerial_width_px > 0),
    aerial_height_px integer CHECK (aerial_height_px > 0),
    tiles_path       text
);

-- One grave per stone or placed plot, identified by section, row and stone.
-- Row labels are text (2B, 5.5C, Misc2); only letters, digits and dots, so
-- that a reference such as W-12-4 splits cleanly on its hyphens.
CREATE TABLE IF NOT EXISTS grave (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cemetery_id  uuid NOT NULL REFERENCES cemetery (id) ON DELETE CASCADE,
    section      text NOT NULL CHECK (section IN ('women', 'children', 'men')),
    row_label    text NOT NULL CHECK (row_label ~ '^[0-9A-Za-z.]+$'),
    stone_number integer NOT NULL CHECK (stone_number > 0),
    centroid_x   real,                          -- in pixels of the aerial image
    centroid_y   real,
    outline_px   polygon,
    UNIQUE (cemetery_id, section, row_label, stone_number)
);

-- One person commemorated on a stone. Dates are stored in parts, so that a
-- partial date leaves the missing parts empty. Hebrew months are numbered as
-- pyluach numbers them: 1 Nisan … 7 Tishrei … 12 Adar (Adar I), 13 Adar II.
CREATE TABLE IF NOT EXISTS person (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grave_id        uuid NOT NULL REFERENCES grave (id) ON DELETE CASCADE,
    name_es         text,
    surname_es      text,
    name_he         text,
    surname_he      text,
    maiden_name_es  text,
    maiden_name_he  text,
    father_name_es  text,
    father_name_he  text,
    husband_name_es text,
    husband_name_he text,
    birth_day       smallint CHECK (birth_day BETWEEN 1 AND 31),
    birth_month     smallint CHECK (birth_month BETWEEN 1 AND 12),
    birth_year      smallint CHECK (birth_year BETWEEN 1800 AND 2100),
    death_day       smallint CHECK (death_day BETWEEN 1 AND 31),
    death_month     smallint CHECK (death_month BETWEEN 1 AND 12),
    death_year      smallint CHECK (death_year BETWEEN 1850 AND 2100),
    death_day_he    smallint CHECK (death_day_he BETWEEN 1 AND 30),
    death_month_he  smallint CHECK (death_month_he BETWEEN 1 AND 13),
    death_year_he   smallint CHECK (death_year_he BETWEEN 5600 AND 5799),
    age_of_death    smallint CHECK (age_of_death BETWEEN 0 AND 130),
    epitaph         text,                       -- the inscription, in both languages
    notes           text,
    confidence      smallint CHECK (confidence BETWEEN 0 AND 100)   -- OCR confidence, %
);
CREATE INDEX IF NOT EXISTS person_grave_id ON person (grave_id);

-- The photographs of a grave, stored on Cloudinary and referenced by public ID.
CREATE TABLE IF NOT EXISTS photo (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grave_id             uuid NOT NULL REFERENCES grave (id) ON DELETE CASCADE,
    kind                 photo_kind NOT NULL,
    cloudinary_public_id text NOT NULL UNIQUE,
    width                integer CHECK (width > 0),
    height               integer CHECK (height > 0),
    sort_order           integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS photo_grave_id ON photo (grave_id);

-- Each spelling of a first name or surname, with its E1 vector for search.
-- No foreign key: one spelling is shared by many people.
CREATE TABLE IF NOT EXISTS name_vectors (
    spelling  text PRIMARY KEY,
    embedding vector(256) NOT NULL
);
