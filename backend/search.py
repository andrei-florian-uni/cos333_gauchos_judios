"""Name search for the Gauchos Judíos archive.

This module runs the search chosen by the name-search experiments
(`search_algorithm/experiments/`, steps 5–8): P3 + E1 + D3. For each word of a query
it finds the archive spellings that the byte-level name encoder E1 places
close to the word, adds the spellings that the name dictionary D3 lists as
the same name, and ranks people by the given name of one word plus the
surname of another.

Use it in two steps: build the index once, when the service starts, then
call `search` for each query.

    index = SearchIndex(persons, read_dictionary(), load_encoder(), vectors)
    index.search("Eva Bendersky")      # → a list of person rows, best first

The module holds no database code: `app.py` reads the person rows and the
`name_vectors` table through `db.py` and passes them in. The two files the
search needs ship with the service in `data/`: the name dictionary D3 and
E1's weights, which `python backend/search.py --download-weights` restores.
"""
import argparse
import csv
import hashlib
import re
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS  —  chosen by the experiments (step_7_selected_configuration.json)
# ═════════════════════════════════════════════════════════════════════════════
CUTOFF            = 0.6     # lowest E1 cosine for a direct match
MATCH_CAP         = 50      # direct matches kept per query word
TAU_LINK          = 0.95    # lowest cosine linking an archive spelling to a dictionary one
DICTIONARY_WEIGHT = 0.9     # weight of a match found through the dictionary
DEFAULT_LIMIT     = 10      # results returned per query

MODULE_DIR    = Path(__file__).resolve().parent      # backend/
DATA_DIR      = MODULE_DIR / "data"
DICTIONARY    = DATA_DIR / "name_dictionary.csv"     # D3, frozen from the experiments' step 3
E1_WEIGHTS    = DATA_DIR / "e1_model.safetensors"    # E1's weights, committed with the service
E1_URL        = ("https://raw.githubusercontent.com/vedant-jumle/cross-language-phonetic-text-"
                 "alignment/08ae1d4e5193d8b324e8313b8f3abbd9fb4f907f/checkpoints/best_v2/"
                 "model.safetensors")                # the checkpoint the experiments used (MIT)
E1_SHA256     = "670eabacf117f145794628fac65e0eedc3d072f14df4bdf9d1eeefe5813d138b"

NAME_COLUMNS = {"name_es": "given", "name_he": "given",
                "surname_es": "surname", "surname_he": "surname"}   # the person columns searched
PARTICLES         = {"de", "דע"}                          # married-name particle, dropped
FINAL_TO_MEDIAL   = str.maketrans("ךםןףץ", "כמנפצ")       # Hebrew final letters → medial
MAQAF             = "\N{HEBREW PUNCTUATION MAQAF}"       # the Hebrew hyphen
HEBREW_MARKS      = re.compile("[\N{HEBREW ACCENT ETNAHTA}-\N{HEBREW POINT QAMATS QATAN}]")
HEBREW_NON_LETTER = re.compile("[^\N{HEBREW LETTER ALEF}-\N{HEBREW LETTER TAV}]")
WORD_SPLIT        = re.compile(rf"[\s\-{MAQAF}]+")         # spaces, hyphens, maqaf
YIDDISH_LIGATURES = {"\N{HEBREW LIGATURE YIDDISH DOUBLE VAV}": "וו",
                     "\N{HEBREW LIGATURE YIDDISH VAV YOD}": "וי",
                     "\N{HEBREW LIGATURE YIDDISH DOUBLE YOD}": "יי"}


# ═════════════════════════════════════════════════════════════════════════════
# NAMES  —  the normalisation of the experiments, shared with import.py
# ═════════════════════════════════════════════════════════════════════════════
def word_script(word: str) -> str:
    """Return "hebrew" if `word` holds any Hebrew character, else "latin"."""
    return "hebrew" if any("֐" <= char <= "׿" for char in word) else "latin"


def expand_hebrew(word: str) -> str:
    """Remove Hebrew points and accents, and expand Yiddish ligatures (װ → וו)."""
    word = HEBREW_MARKS.sub("", word)
    for ligature, letters in YIDDISH_LIGATURES.items():
        word = word.replace(ligature, letters)
    return word


def normalise(word: str, script: str) -> str:
    """Return the form a word is matched by: José → jose, שָׁלוֹם → שלומ.

    Latin words keep letters only, without accents, in lower case. Hebrew
    words keep letters only, without points, with final letters made medial.
    NFKD first splits presentation forms such as `וּ` into a letter and a
    point, so that removing the point keeps the letter.
    """
    text = unicodedata.normalize("NFKD", word)
    if script == "latin":
        return "".join(char for char in text
                       if char.isalpha() and not unicodedata.combining(char)).lower()
    return HEBREW_NON_LETTER.sub("", expand_hebrew(text).translate(FINAL_TO_MEDIAL))


def display_spelling(word: str, script: str) -> str:
    """Return the spelling E1 reads: letters only, Latin words capitalised.

    E1 reads raw bytes and is case-sensitive (cosine of "rebeca" and
    "Rebeca" 0.86), so the archive and the queries share one capitalisation.
    """
    word = unicodedata.normalize("NFC", word)
    if script == "hebrew":
        return HEBREW_NON_LETTER.sub("", expand_hebrew(word))
    return "".join(char for char in word if char.isalpha() or char == "'").capitalize()


def name_words(text: str) -> list[dict]:
    """Split a name field or a query into words.

    Initials (one letter) and the married-name particle "de" are dropped,
    as the archive's names were in the experiments, and so are symbols that
    only look like letters (`Ⅻ`, `㎏`), which leave E1 nothing to read.

    Returns:
        One dictionary per word: its script, normalised form and display spelling.
    """
    words = []
    for piece in WORD_SPLIT.split(text.strip()):
        script = word_script(piece)
        norm, display = normalise(piece, script), display_spelling(piece, script)
        if len(norm) >= 2 and norm not in PARTICLES and display:
            words.append({"script": script, "norm": norm, "display": display})
    return words


# ═════════════════════════════════════════════════════════════════════════════
# E1  —  the byte-level name encoder, in NumPy
# ═════════════════════════════════════════════════════════════════════════════
def layer_norm(x: np.ndarray, gain: np.ndarray, bias: np.ndarray) -> np.ndarray:
    """Normalise the last axis of `x` to mean 0 and variance 1, then scale and shift it."""
    mean = x.mean(-1, keepdims=True)
    return (x - mean) / np.sqrt(((x - mean) ** 2).mean(-1, keepdims=True) + 1e-5) * gain + bias


class E1Encoder:
    """The byte-level name encoder E1 (Jumle et al., 2026).

    A word's UTF-8 bytes pass through six transformer layers, and the mean of
    the outputs, scaled to length 1, is its vector: the dot product of two
    vectors is then their cosine similarity. The weights are passed in, so
    that tests can use small random ones.
    """

    LAYERS, HEADS, MAX_BYTES = 6, 8, 256

    def __init__(self, weights: dict[str, np.ndarray]):
        """Keep the network's weights: a map from layer name to array."""
        self.weights = weights

    @classmethod
    def from_file(cls, path: Path) -> "E1Encoder":
        """Return the encoder with the weights stored in the safetensors file `path`."""
        return cls(load_file(str(path)))

    def encode(self, texts: list[str]) -> np.ndarray:
        """Return one unit vector per text, as the rows of an array.

        Texts with the same number of bytes are encoded together, as one
        batch, so that no padding is needed.
        """
        rows_of_length = defaultdict(list)
        for row, text in enumerate(texts):
            rows_of_length[len(text.encode("utf-8")[:self.MAX_BYTES])].append(row)
        vectors = np.zeros((len(texts), self.weights["embedding.weight"].shape[1]), np.float32)
        for length, rows in rows_of_length.items():
            byte_ids = np.array([list(texts[row].encode("utf-8")[:self.MAX_BYTES]) for row in rows])
            x = (self.weights["embedding.weight"][byte_ids]
                 + self.weights["pos_embedding.weight"][:length])
            for layer in range(self.LAYERS):
                x = self._layer(x, f"transformer.layers.{layer}.")
            pooled = x.mean(axis=1)
            vectors[rows] = pooled / np.linalg.norm(pooled, axis=1, keepdims=True)
        return vectors

    def _layer(self, x: np.ndarray, prefix: str) -> np.ndarray:
        """Apply one pre-norm transformer layer to `x` (texts × bytes × 256)."""
        w = self.weights
        x = x + self._attention(layer_norm(x, w[prefix + "norm1.weight"], w[prefix + "norm1.bias"]),
                                prefix)
        h = layer_norm(x, w[prefix + "norm2.weight"], w[prefix + "norm2.bias"])
        hidden = np.maximum(0, h @ w[prefix + "linear1.weight"].T + w[prefix + "linear1.bias"])
        return x + hidden @ w[prefix + "linear2.weight"].T + w[prefix + "linear2.bias"]

    def _attention(self, h: np.ndarray, prefix: str) -> np.ndarray:
        """Multi-head self-attention: every byte of a text attends to every other byte."""
        w = self.weights
        texts, length, width = h.shape
        qkv = h @ w[prefix + "self_attn.in_proj_weight"].T + w[prefix + "self_attn.in_proj_bias"]
        query, key, value = (part.reshape(texts, length, self.HEADS, -1).transpose(0, 2, 1, 3)
                             for part in np.split(qkv, 3, axis=-1))
        # softmax over the bytes attended to, written as in the experiments' step 4
        scores = np.exp(query @ key.transpose(0, 1, 3, 2) / np.sqrt(width // self.HEADS))
        attended = (scores / scores.sum(-1, keepdims=True)) @ value
        attended = attended.transpose(0, 2, 1, 3).reshape(texts, length, width)
        return (attended @ w[prefix + "self_attn.out_proj.weight"].T
                + w[prefix + "self_attn.out_proj.bias"])


# ═════════════════════════════════════════════════════════════════════════════
# INDEX  —  everything a search needs, built once from plain rows
# ═════════════════════════════════════════════════════════════════════════════
@dataclass
class Spellings:
    """Every distinct spelling the search knows, archive spellings first."""
    position: dict          # (script, norm) → position
    displays: list          # the spelling E1 reads, per position
    vectors: np.ndarray     # E1 vector, per position
    n_archive: int          # positions below this occur in the archive


@dataclass
class NameTokens:
    """Every name word of every person, as three parallel arrays."""
    person: np.ndarray      # position of the person in the index's rows
    is_surname: np.ndarray  # True for a surname word
    spelling: np.ndarray    # position of the word's spelling


@dataclass
class DictionaryLinks:
    """How archive spellings reach the dictionary's groups."""
    groups_of: dict         # spelling position → the D3 groups that list it
    links: list             # archive spelling → the groups it is linked to
    members: dict           # group → the archive spellings linked to it


def most_frequent(counts: Counter) -> str:
    """Return the most frequent spelling in `counts`, the alphabetically first on a tie."""
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def collect_names(persons: list[dict], dictionary: list[dict]) -> tuple[list, dict, int]:
    """Return every name word of the persons, and the display of every spelling.

    Archive spellings come first, sorted, each displayed as its most frequent
    recorded spelling; dictionary-only spellings follow in dictionary order.

    Returns:
        The words as (person position, is surname, (script, norm)), a
        (script, norm) → display map, and the number of archive spellings.
    """
    words, recorded = [], defaultdict(Counter)
    for position, person in enumerate(persons):
        for column, field in NAME_COLUMNS.items():
            for word in name_words(person.get(column) or ""):
                key = (word["script"], word["norm"])
                recorded[key][word["display"]] += 1
                words.append((position, field == "surname", key))
    displays = {key: most_frequent(counts) for key, counts in sorted(recorded.items())}
    n_archive = len(displays)
    for row in dictionary:
        displays.setdefault((row["script"], row["norm"]),
                            display_spelling(row["display"], row["script"]))
    return words, displays, n_archive


def link_spellings(spellings: Spellings, dictionary: list[dict]) -> DictionaryLinks:
    """Link every archive spelling to the D3 groups of its own spelling or, failing
    that, to those of the dictionary spelling closest to it by E1, if their cosine
    reaches TAU_LINK."""
    groups_of = defaultdict(set)
    for row in dictionary:
        groups_of[spellings.position[(row["script"], row["norm"])]].add(row["group_id"])
    in_dictionary = np.array(sorted(groups_of))
    closeness = spellings.vectors[:spellings.n_archive] @ spellings.vectors[in_dictionary].T
    links, members = [], defaultdict(list)
    for spelling in range(spellings.n_archive):
        groups = groups_of.get(spelling, set())
        if not groups and closeness[spelling].max() >= TAU_LINK:
            groups = groups_of[int(in_dictionary[np.argmax(closeness[spelling])])]
        links.append(groups)
        for group in groups:
            members[group].append(spelling)
    return DictionaryLinks(dict(groups_of), links, dict(members))


class SearchIndex:
    """The archive's names, ready to search. Build it once; then call `search`."""

    def __init__(self, persons: list[dict], dictionary: list[dict], encoder: E1Encoder,
                 vectors: dict[str, np.ndarray] | None = None):
        """Build the index.

        Args:
            persons: person rows, each with the four columns of NAME_COLUMNS; a
                search returns these rows, best first.
            dictionary: the rows of D3: group_id, script, norm and display.
            encoder: E1, which encodes the queries and any spelling missing
                from `vectors`.
            vectors: precomputed E1 vectors, by display spelling.
        """
        self.persons, self.encoder = persons, encoder
        words, displays, n_archive = collect_names(persons, dictionary)
        known = dict(vectors or {})
        missing = [display for display in displays.values() if display not in known]
        if missing:                       # e.g. a spelling the loader has not encoded yet
            known.update(zip(missing, encoder.encode(missing)))
        self.spellings = Spellings({key: i for i, key in enumerate(displays)},
                                   list(displays.values()),
                                   np.array([known[d] for d in displays.values()]), n_archive)
        self.tokens = NameTokens(
            person=np.array([person for person, _, _ in words], dtype=int),
            is_surname=np.array([is_surname for _, is_surname, _ in words], dtype=bool),
            spelling=np.array([self.spellings.position[key] for _, _, key in words], dtype=int))
        self.links = link_spellings(self.spellings, dictionary)

    def search(self, query: str, limit: int = DEFAULT_LIMIT,
               keep: Callable[[dict], bool] | None = None) -> list[dict]:
        """Return the person rows that best match `query`, best first, each with its score.

        Args:
            query: the name typed, in either script and with its words in any order.
            limit: the largest number of results to return.
            keep: the search's filters, as a function that is True for each
                person row the search may return; None lets every row through.
        """
        allowed = None
        if keep is not None:
            allowed = np.array([keep(person) for person in self.persons], dtype=bool)
        return [self.persons[person] | {"score": round(score, 3)}
                for person, score in self.rank(name_words(query), limit, allowed)]

    def rank(self, words: list[dict], limit: int = DEFAULT_LIMIT,
             allowed: np.ndarray | None = None) -> list[tuple[int, float]]:
        """Score every person for the query `words`; return the best `limit` as
        (position, score), ties in row order. Persons scoring 0, and persons
        that `allowed` (one boolean per person) marks False, are left out."""
        if not words or limit < 1:
            return []
        query_vectors = self.encoder.encode([word["display"] for word in words])
        similarity = np.array([self.word_similarity(word, vector)
                               for word, vector in zip(words, query_vectors)])
        scores = self.person_scores(similarity[:, self.tokens.spelling])
        if allowed is not None:
            scores = np.where(allowed, scores, 0.0)      # the filters apply before the limit
        found = np.flatnonzero(scores > 0)
        best = found[np.lexsort((found, -scores[found]))][:limit]
        return [(int(person), float(scores[person])) for person in best]

    def word_similarity(self, word: dict, vector: np.ndarray) -> np.ndarray:
        """Return one query word's similarity to every archive spelling.

        A spelling within CUTOFF of the word's E1 vector (one of the MATCH_CAP
        nearest) is a direct match, at its cosine. The D3 groups of the word
        and of each direct match bring in the archive spellings linked to them,
        at DICTIONARY_WEIGHT × the similarity that led to them. A spelling
        keeps the higher of the two.
        """
        n_archive = self.spellings.n_archive
        cosines = np.clip(self.spellings.vectors[:n_archive] @ vector, 0, None)
        order = np.argsort(-cosines, kind="stable")
        nearest = order[cosines[order] >= CUTOFF][:MATCH_CAP]
        direct = np.zeros(n_archive)
        direct[nearest] = cosines[nearest]
        own = self.spellings.position.get((word["script"], word["norm"]))
        seeds = [(1.0, self.links.groups_of.get(own, set()))]
        seeds += [(cosines[spelling], self.links.links[spelling]) for spelling in nearest]
        derived = np.zeros(n_archive)
        for seed_similarity, groups in seeds:
            for group in groups:
                linked = self.links.members.get(group, [])
                derived[linked] = np.maximum(derived[linked], seed_similarity)
        return np.maximum(direct, DICTIONARY_WEIGHT * derived)

    def person_scores(self, token_similarity: np.ndarray) -> np.ndarray:
        """Turn word × name-token similarities into one score per person.

        For each query word a person gets their best given-name and best
        surname similarity. A one-word query scores the better of the two; a
        longer one the best given name of one word plus the surname of another,
        so that a full name ranks a person high only when both parts match.
        """
        n_words, n_persons = len(token_similarity), len(self.persons)
        given, surname = np.zeros((n_words, n_persons)), np.zeros((n_words, n_persons))
        is_surname = self.tokens.is_surname
        for word in range(n_words):
            np.maximum.at(given[word], self.tokens.person[~is_surname],
                          token_similarity[word, ~is_surname])
            np.maximum.at(surname[word], self.tokens.person[is_surname],
                          token_similarity[word, is_surname])
        if n_words == 1:
            return np.maximum(given[0], surname[0])
        best = np.zeros(n_persons)
        for first in range(n_words):
            for second in range(n_words):
                if first != second:
                    best = np.maximum(best, given[first] + surname[second])
        return best


# ═════════════════════════════════════════════════════════════════════════════
# FILES  —  the name dictionary and E1's weights, which ship with the service
# ═════════════════════════════════════════════════════════════════════════════
def read_dictionary(path: Path = DICTIONARY) -> list[dict]:
    """Read the name dictionary D3 into a list of rows (group_id, script, norm, display)."""
    with path.open(encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))


def load_encoder(path: Path = E1_WEIGHTS) -> E1Encoder:
    """Return E1 with the weights stored at `path`, explaining how to restore them if missing."""
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing: run `python backend/search.py "
                                "--download-weights` to restore it")
    return E1Encoder.from_file(path)


def download_e1_weights(path: Path = E1_WEIGHTS) -> None:
    """Download E1's weights to `path`, checking them against the experiments' copy."""
    with urllib.request.urlopen(E1_URL, timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != E1_SHA256:
        raise ValueError("the downloaded E1 weights differ from those the experiments used")
    path.write_bytes(data)


def main() -> None:
    """Restore E1's weights from the command line: `python backend/search.py --download-weights`."""
    parser = argparse.ArgumentParser(description="Prepare the files the name search needs.")
    parser.add_argument("--download-weights", action="store_true",
                        help="download E1's weights into backend/data/ and check them")
    args = parser.parse_args()
    if args.download_weights:
        download_e1_weights()
        print(f"E1's weights saved to {E1_WEIGHTS}")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
