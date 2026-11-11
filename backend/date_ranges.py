"""Civil date ranges worked out where a gravestone carves no civil date.

Two dates are derived (Project Design › Application Data Structure › person):

* a civil date of death, from the Hebrew date of death, for a person whose
  stone carves a Hebrew year of death but no part of a civil date of death;
* a birth date, from the age at death, for a person whose stone carves no part
  of a birth date but an age at death and a date of death, carved or derived.

A derived date is a range of days, from the earliest day the stone allows to
the latest. The earliest fills the date's own columns (`death_day`,
`death_month`, `death_year`) and the latest the `_upper` columns, all three
parts each time, even when both ends are the same day. An upper column holds a
value exactly when the date was worked out; a carved date, however partial,
leaves the upper columns empty.

The rules, decided on 11 November 2026:

• A Hebrew range runs from the first to the last day of its Hebrew year
  (1 Tishrei to 29 Elul) whose day and month agree with the parts on record,
  converted with pyluach. A full date gives one day, a month and year the
  whole month, a year alone the whole year, and a day and year (a plain Adar
  in a leap year) that day of every month. The civil day is the one the
  Hebrew date converts to; no allowance is made for a death after nightfall.
• The age at death counts completed years, so someone who died on 15 March
  1950 aged 60 was born between 16 March 1889 and 15 March 1890:
      earliest birth = earliest death − (age + 1) years + 1 day
      latest birth   = latest death − age years
  A 29 February moved into a common year becomes 28 February.

`import.py` applies these rules to every person it loads. The notebook
`database_revisions/derive_date_ranges.ipynb` applies the same rules to a
database already loaded, and keeps its own copy of them (notebooks import no
repository module), so a change here must be copied there.

    derive_ranges({"death_day_he": 22, "death_month_he": 11, "death_year_he": 5680, …})
    # → {"death_day": 11, "death_month": 2, "death_year": 1920,
    #    "death_day_upper": 11, "death_month_upper": 2, "death_year_upper": 1920, …}
"""
import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from pyluach import hebrewcal

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
PARTS         = ("day", "month", "year")
UPPER_COLUMNS = tuple(f"{kind}_{part}_upper" for kind in ("birth", "death") for part in PARTS)


@dataclass(frozen=True)
class DateRange:
    """The earliest and latest day a date can be; the same day for an exact date."""
    earliest: date
    latest: date


# ═════════════════════════════════════════════════════════════════════════════
# RANGES  —  from the parts on record to the earliest and latest possible day
# ═════════════════════════════════════════════════════════════════════════════
def hebrew_range(day: int | None, month: int | None, year: int | None) -> DateRange | None:
    """Return the civil days a Hebrew date can be, converted with pyluach.

    Args:
        day: the day of the month, or None.
        month: the month as pyluach numbers it (1 Nisan … 7 Tishrei …
            13 Adar II), or None.
        year: the Hebrew year, e.g. 5680.

    Returns:
        The first and last day of the Hebrew year whose day and month agree
        with those given, as civil dates; None when the year is unknown or the
        calendar rules the date out (a 30 Cheshvan in a year whose Cheshvan
        has 29 days, say).
    """
    if year is None:
        return None
    matching = [hebrew_day for hebrew_day in hebrewcal.Year(year).iterdates()
                if (day is None or hebrew_day.day == day)
                and (month is None or hebrew_day.month == month)]
    if not matching:
        return None
    return DateRange(matching[0].to_pydate(), matching[-1].to_pydate())


def civil_range(day: int | None, month: int | None, year: int | None) -> DateRange | None:
    """Return the days a carved civil date can be: its whole month or year if only those are carved.

    Returns:
        The range, or None when the year is unknown or the carved day does not
        exist (a 31 April, say).
    """
    if year is None:
        return None
    if month is None:
        return DateRange(date(year, 1, 1), date(year, 12, 31))
    if day is None:
        last_day = calendar.monthrange(year, month)[1]
        return DateRange(date(year, month, 1), date(year, month, last_day))
    try:
        return DateRange(date(year, month, day), date(year, month, day))
    except ValueError:
        return None


def years_before(day: date, years: int) -> date:
    """Return the same day `years` years earlier; 29 February becomes 28 February if need be."""
    try:
        return day.replace(year=day.year - years)
    except ValueError:
        return day.replace(year=day.year - years, day=28)


def birth_range(death: DateRange, age: int) -> DateRange:
    """Return the days a person who died within `death` aged `age` (completed years) was born on."""
    return DateRange(years_before(death.earliest, age + 1) + timedelta(days=1),
                     years_before(death.latest, age))


# ═════════════════════════════════════════════════════════════════════════════
# COLUMNS  —  from a person's carved parts to the columns a derivation fills
# ═════════════════════════════════════════════════════════════════════════════
def has_civil_date(person: dict, kind: str) -> bool:
    """True if any part of the person's civil `kind` date ("birth" or "death") is carved."""
    return any(person.get(f"{kind}_{part}") is not None for part in PARTS)


def range_columns(kind: str, derived: DateRange) -> dict:
    """Return the six columns of a derived `kind` date: the earliest day's parts and the last's."""
    columns = {}
    for part in PARTS:
        columns[f"{kind}_{part}"] = getattr(derived.earliest, part)
        columns[f"{kind}_{part}_upper"] = getattr(derived.latest, part)
    return columns


def death_range(person: dict) -> tuple[DateRange | None, bool]:
    """Return the days on which a person may have died, and whether that range is derived.

    The carved civil date gives the range when any part of it is carved (its
    whole month or year when only those are); otherwise the Hebrew date does,
    and the range is then derived.
    """
    if has_civil_date(person, "death"):
        return civil_range(person.get("death_day"), person.get("death_month"),
                           person.get("death_year")), False
    derived = hebrew_range(person.get("death_day_he"), person.get("death_month_he"),
                           person.get("death_year_he"))
    return derived, derived is not None


def derive_ranges(person: dict) -> dict:
    """Return the date columns this module works out for one person.

    Args:
        person: the person's carved values: the `birth_*`, `death_*` and
            `death_*_he` parts and `age_of_death`, None where nothing is carved.

    Returns:
        The six columns of each derived date (see `range_columns`): those of
        the date of death when it is worked out from the Hebrew date, and
        those of the birth date when it is estimated from the age at death.
        Empty when nothing can be derived. The upper columns of a date that
        is not derived are not included; the caller leaves them empty.
    """
    columns = {}
    death, death_derived = death_range(person)
    if death_derived:
        columns |= range_columns("death", death)
    age = person.get("age_of_death")
    if death is not None and age is not None and not has_civil_date(person, "birth"):
        columns |= range_columns("birth", birth_range(death, age))
    return columns
