"""Hebrew dates of death, read from the text carved on a gravestone.

The checked transcription keeps each Hebrew date of death as it is carved, for
example `כ"ב לחדש שבט ש' תר"פ` (22 Shevat 5680) or `ב' דראש השנה תרפ"ה`
(2 Tishrei 5685). `parse_hebrew_date` reads the day, month and year out of such
a string, for `import.py` to store in `person.death_day_he`, `death_month_he`
and `death_year_he`.

Months are numbered as the pyluach library numbers them, so that the yahrzeit
calendar can use the parts directly: 1 Nisan, 2 Iyar, 3 Sivan, 4 Tammuz, 5 Av,
6 Elul, 7 Tishrei, 8 Cheshvan, 9 Kislev, 10 Tevet, 11 Shevat, 12 Adar (Adar I
in a leap year) and 13 Adar II.

A part that cannot be read with confidence is left as None: an illegible
stretch (`[...]`), a holiday named in place of a date (`א' של פסח`), or a year
written in Latin digits. The caller keeps the carved text in that case.

    parse_hebrew_date('כ"ב לחדש שבט ש\\' תר"פ')   # → HebrewDate(day=22, month=11, year=5680)
"""
import re
import unicodedata
from dataclasses import dataclass

# ═════════════════════════════════════════════════════════════════════════════
# VOCABULARY  —  letters, numbers, months and the words around them
# ═════════════════════════════════════════════════════════════════════════════
LETTER_VALUES = {"א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
                 "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
                 "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
                 "ק": 100, "ר": 200, "ש": 300, "ת": 400}           # gematria value of each letter
SPELLED_NUMBERS = {"אחד": 1, "אחת": 1, "שני": 2, "שנים": 2, "שתים": 2, "שתי": 2,
                   "שלשה": 3, "שלושה": 3, "שלש": 3, "שלוש": 3, "ארבעה": 4, "ארבע": 4,
                   "חמשה": 5, "חמישה": 5, "חמש": 5, "ששה": 6, "שישה": 6, "שש": 6,
                   "ששי": 6, "שישי": 6, "שבעה": 7, "שבע": 7, "שמנה": 8, "שמונה": 8,
                   "תשעה": 9, "תשע": 9, "עשרה": 10, "עשר": 10, "עשרים": 20,
                   "שלשים": 30, "שלושים": 30}                      # days written out in words
TEENS = {"עשר", "עשרה"}                 # "שבעה עשר": the unit before it adds ten
TENS = {"עשרים": 20, "שלשים": 30, "שלושים": 30}   # "עשרים ואחד": a joined unit adds to them
MONTHS = {"ניסן": 1, "ניסאן": 1, "אייר": 2, "איר": 2, "סיון": 3, "סיוון": 3, "תמוז": 4,
          "אב": 5, "אלול": 6, "תשרי": 7, "חשון": 8, "חשוון": 8, "מרחשון": 8, "מרחשוון": 8,
          "כסלו": 9, "כסליו": 9, "טבת": 10, "שבט": 11, "אדר": 12, "אדאר": 12, "אדרא": 12,
          "מנא": 5,                     # "מנ"א" abbreviates "מנחם אב"
          "ואדר": 13}                   # "ואדר", the traditional name of Adar II
MONTH_PREFIXES = "בלדו"                 # one-letter prepositions joined to a month: "בכסלו"
MONTH_NAME_PARTS = {"מנחם", "מ", "מר"}  # "מנחם אב", "מ' אב", "מר חשון": words of a month's name
ADAR_FIRST = {"א", "ראשון", "הראשון"}   # "אדר א'", "אדר ראשון": Adar I
ADAR_SECOND = {"ב", "שני", "השני"}      # "אדר ב'", "אדר שני": Adar II
ADAR_I_WORDS = {"אדרא"}                 # "אדר א" written as one word
ADAR, ADAR_II = 12, 13
ROSH = {"ראש", "דראש", "בראש"}          # "ראש חודש" (new moon), "ראש השנה" (new year)
NEW_MONTH_WORDS = {"חודש", "חדש"}
ROSH_CHODESH = {"רח", "דרח", "ברח"}     # "ר"ח", the abbreviation of "ראש חודש"
NEW_YEAR = "השנה"
ROSH_HASHANA = {"רה", "דרה", "ברה"}     # "ר"ה", the abbreviation of "ראש השנה"
DAY_FILLERS = {"לחודש", "לחדש", "בחודש", "בחדש", "חודש", "חדש", "לירח", "בירח", "ירח",
               "לח", "לחד", "ימים", "ימי", "יום", "של", "טאג"}   # between the day and the month
YEAR_FILLERS = {"שנת", "ש", "בשנת", "לשנת", "שנה"}               # before the year
DAY_PREFIXES = "בל"                     # one letter joined to a day numeral: "בכ"ב"
EVE = "ערב"                             # "ערב ר"ח": the eve of, a day the words do not name
GAP = "…"                               # stands for an illegible stretch, "[...]"
FIRST_YEAR, LAST_YEAR = 5600, 5799      # 1839–2039: every year the cemetery can hold

# Months that always have 30 days. A month that follows one of them begins with
# a two-day Rosh Chodesh, whose first day is the 30th of the month before.
THIRTY_DAY_MONTHS = {1, 3, 5, 7, 11}    # Nisan, Sivan, Av, Tishrei, Shevat
VARIABLE_MONTHS = {8, 9}                # Cheshvan and Kislev have 29 or 30 days
ALWAYS_29_DAYS = {2, 4, 6, 10, 13}      # Iyar, Tammuz, Elul, Tevet, Adar II: never a 30th

QUOTE_MARKS = re.compile("['\"`׳״‘’“”.]")  # geresh, gershayim, dots
SEPARATORS = re.compile(r"[-,;:/()]")
BRACKETED = re.compile(r"\[[^\]]*\]")


@dataclass(frozen=True)
class HebrewDate:
    """The parts of a Hebrew date; a part that could not be read is None."""
    day: int | None
    month: int | None
    year: int | None

    @property
    def complete(self) -> bool:
        """True when the day, the month and the year were all read."""
        return None not in (self.day, self.month, self.year)


@dataclass(frozen=True)
class MonthMatch:
    """Where the month sits in a date's words.

    `start` is the first word that belongs to the month phrase (a Rosh Chodesh
    marker, say) and `end` the first word after it; the day is read before
    `start` and the year after `end`.
    """
    start: int
    end: int
    month: int
    rosh_chodesh: bool = False
    rosh_hashana: bool = False
    plain_adar: bool = False            # "אדר" with no "first" or "second" after it


# ═════════════════════════════════════════════════════════════════════════════
# WORDS  —  from carved text to plain words
# ═════════════════════════════════════════════════════════════════════════════
def words_of(text: str) -> list[str]:
    """Split a carved date into plain words.

    Vowel points are removed, an illegible stretch such as `[...]` becomes the
    word GAP, and quote marks and dots are dropped so that `כ"ב` reads as `כב`
    and `ת.ר.פ.ו.` as `תרפו`.
    """
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = BRACKETED.sub(f" {GAP} ", text)
    text = QUOTE_MARKS.sub("", text)
    return SEPARATORS.sub(" ", text).split()


def letters_value(word: str) -> int | None:
    """Return the gematria value of a word of Hebrew letters, or None if it holds others."""
    if not word or any(letter not in LETTER_VALUES for letter in word):
        return None
    return sum(LETTER_VALUES[letter] for letter in word)


def is_numeral(letters: str) -> bool:
    """True if the letters' values never rise from left to right, as in a Hebrew numeral.

    `כב` (20, 2) and `תרפה` (400, 200, 80, 5) are numerals; `בכב` and
    `תרפהלבע` are not, which is how a joined prefix or a following word is
    told apart from a number.
    """
    values = [LETTER_VALUES[letter] for letter in letters]
    return all(left >= right for left, right in zip(values, values[1:]))


def day_numeral(word: str) -> int | None:
    """Return the value of a day written in letters (`כב` → 22), allowing a joined ב or ל."""
    candidates = [word]
    if len(word) > 1 and word[0] in DAY_PREFIXES:
        candidates.append(word[1:])                 # "בכב": on the 22nd
    for letters in candidates:
        value = letters_value(letters)
        if value is not None and is_numeral(letters):
            return value
    return None


def spelled_number(word: str) -> int | None:
    """Return the value of a number written out (`שבעה` → 7), allowing a joined ב, ה or ו."""
    if word in SPELLED_NUMBERS:
        return SPELLED_NUMBERS[word]
    if len(word) > 2 and word[0] in "בהו" and word[1:] in SPELLED_NUMBERS:
        return SPELLED_NUMBERS[word[1:]]
    return None


def day_value(word: str) -> int | None:
    """Return the number a single word gives a day: words, Latin digits or letters."""
    value = spelled_number(word)
    if value is None:
        value = int(word) if word.isascii() and word.isdigit() else day_numeral(word)
    return value


def is_leap_year(year: int) -> bool:
    """True for a Hebrew leap year (7 in every 19), the years that have Adar I and Adar II."""
    return (7 * year + 1) % 19 < 7


def month_number(word: str) -> int | None:
    """Return the month a word names, allowing one joined preposition (`בכסלו`)."""
    if word in MONTHS:
        return MONTHS[word]
    if len(word) > 2 and word[0] in MONTH_PREFIXES and word[1:] in MONTHS:
        return MONTHS[word[1:]]
    return None


# ═════════════════════════════════════════════════════════════════════════════
# PARTS  —  the month first, then the day before it and the year after it
# ═════════════════════════════════════════════════════════════════════════════
def find_month(words: list[str]) -> MonthMatch | None:
    """Find the month phrase of a date, or None if the date names no month.

    Rosh Hashana (`ראש השנה`, `ר"ה`) counts as Tishrei. For any other month
    the words just before it are checked for the rest of its name (`מנחם`
    before `אב`) and for a Rosh Chodesh marker (`ר"ח`, `ראש חודש`), and for
    Adar the word after it for "first" or "second".
    """
    for index, word in enumerate(words):
        following = words[index + 1] if index + 1 < len(words) else None
        if word in ROSH and following == NEW_YEAR:
            return MonthMatch(index, index + 2, month=7, rosh_hashana=True)
        if word in ROSH_HASHANA:
            return MonthMatch(index, index + 1, month=7, rosh_hashana=True)
        month = month_number(word)
        if month is None:
            continue
        end = index + 1
        qualified = word in ADAR_I_WORDS
        if month == ADAR and following in ADAR_FIRST:
            end, qualified = end + 1, True
        elif month == ADAR and following in ADAR_SECOND:
            month, end = ADAR_II, end + 1
        start = index
        while start > 0 and words[start - 1] in MONTH_NAME_PARTS:
            start -= 1
        rosh_chodesh = False
        if start > 0 and words[start - 1] in ROSH_CHODESH:
            rosh_chodesh, start = True, start - 1
        elif start > 1 and words[start - 2] in ROSH and words[start - 1] in NEW_MONTH_WORDS:
            rosh_chodesh, start = True, start - 2
        return MonthMatch(start, end, month, rosh_chodesh=rosh_chodesh,
                          plain_adar=month == ADAR and not qualified)
    return None


def read_day(words: list[str], before: int) -> int | None:
    """Read the day from the words before position `before`, or None.

    Filler words such as `לחודש` or `ימים` are skipped. The day is the nearest
    number: letters (`כב`), Latin digits (`11`) or words (`שבעה עשר`,
    `עשרים ואחד`).
    """
    position = before - 1
    while position >= 0 and words[position] in DAY_FILLERS:
        position -= 1
    # In "כב ל' סיון" the ל abbreviates לחודש; only a ל with no day before it is the 30th
    if position > 0 and words[position] == "ל" and day_value(words[position - 1]):
        position -= 1
    if position < 0 or words[position] == GAP:
        return None
    word, previous = words[position], words[position - 1] if position > 0 else None
    if word in TEENS and previous is not None:
        unit = spelled_number(previous)
        if unit is not None and unit < 10:
            return 10 + unit
    unit = spelled_number(word)
    if word.startswith("ו") and previous in TENS and unit is not None and unit < 10:
        return TENS[previous] + unit
    value = day_value(word)
    return value if value is not None and 1 <= value <= 30 else None


def without_thousands(text: str) -> str:
    """Drop a leading `ה` (the 5,000) from a year: `התשח` → `תשח`."""
    return text[1:] if len(text) > 1 and text[0] == "ה" and text[1] == "ת" else text


def year_value(text: str) -> int | None:
    """Return the year a run of letters spells, or None.

    Years are written without their thousands (`תרפ` is 680, so 5680), at
    most with a leading `ה` for the 5,000. Every year the cemetery can hold
    starts with `ת` (400) once that `ה` is set aside.
    """
    text = without_thousands(text)
    value = letters_value(text) if text.startswith("ת") else None
    if value is None or not FIRST_YEAR <= 5000 + value <= LAST_YEAR:
        return None
    return 5000 + value


def read_year(words: list[str], after: int) -> int | None:
    """Read the year from the words from position `after` on, or None.

    A year may be split over up to three words (`התר צה`, `ה תשלב`), so runs
    of three, two and one word are tried at each position; a run of several
    words must read as one numeral, so that a word after the year (`לב"ע`,
    `יום ב'`) is not added to it. A year followed by an illegible stretch
    (`תרצ[...]`) is incomplete and is not read.
    """
    for start in range(after, len(words)):
        if words[start] in YEAR_FILLERS:
            continue
        for length in (3, 2, 1):
            run = words[start:start + length]
            if len(run) < length or GAP in run:
                continue
            text = "".join(run)
            if length > 1 and (letters_value(text) is None
                               or not is_numeral(without_thousands(text))):
                continue
            year = year_value(text)
            following = words[start + length] if start + length < len(words) else None
            if year is not None and following != GAP:
                return year
    return None


def previous_month(month: int) -> int:
    """Return the month before `month` (Tishrei follows Elul; Nisan follows Adar)."""
    return {1: ADAR, 7: 6, ADAR_II: ADAR}.get(month, month - 1)


def rosh_chodesh_date(day: int | None, month: int) -> tuple[int, int]:
    """Return the (day, month) meant by "day `day` of Rosh Chodesh `month`".

    After a 30-day month, Rosh Chodesh lasts two days: its first day is the
    30th of the month before and its second the 1st of the new month. After
    a 29-day month it is the 1st alone, so a "first day" there means the 1st.
    """
    before = previous_month(month)
    # Adar I, the month before Adar II, always has 30 days
    can_have_thirty = (before in THIRTY_DAY_MONTHS or before in VARIABLE_MONTHS
                       or month == ADAR_II)
    if day == 1 and can_have_thirty:
        return 30, before
    return 1, month


def checked_date(day: int | None, month: int | None, year: int | None,
                 plain_adar: bool) -> HebrewDate:
    """Return the date with any part the calendar rules out, or leaves ambiguous, removed.

    In a leap year a plain "Adar" could be Adar I or Adar II, so the month is
    dropped; Adar II exists only in leap years; and no 30th falls in a month
    that always has 29 days, or in Adar of a common year.
    """
    if year is not None and month in (ADAR, ADAR_II):
        leap = is_leap_year(year)
        if (month == ADAR and plain_adar and leap) or (month == ADAR_II and not leap):
            month = None
    common_adar = month == ADAR and year is not None and not is_leap_year(year)
    if day == 30 and (month in ALWAYS_29_DAYS or common_adar):
        day = None
    return HebrewDate(day, month, year)


def parse_hebrew_date(text: str | None) -> HebrewDate:
    """Read the day, month and year of a carved Hebrew date.

    Args:
        text: the date as transcribed, e.g. `ט"ו סיון ה'תרפ"ד`; may be empty.

    Returns:
        A HebrewDate whose unreadable or impossible parts are None. A date
        that names no month, or only "the eve of" one, keeps just its year.
    """
    words = words_of(text or "")
    match = find_month(words)
    if match is None:
        return HebrewDate(None, None, read_year(words, 0))
    year = read_year(words, match.end)
    if match.start > 0 and words[match.start - 1] == EVE:
        return HebrewDate(None, None, year)
    day, month = read_day(words, match.start), match.month
    if match.rosh_hashana:
        day = day if day in (1, 2) else 1
    elif match.rosh_chodesh:
        day, month = rosh_chodesh_date(day, month)
    return checked_date(day, month, year, match.plain_adar)
