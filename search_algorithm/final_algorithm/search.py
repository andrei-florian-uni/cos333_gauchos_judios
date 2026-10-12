"""Name search for the Gauchos Judíos archive.

This module runs the search chosen by the name-search experiments
(`search_algorithm/experiments/`, steps 5–8): P3 + E1 + D3. For each word of a query
it finds the archive spellings that the byte-level name encoder E1 places
close to the word, adds the spellings that the name dictionary D3 lists as
the same name, and ranks people by the given name of one word plus the
surname of another.

Use it in two steps: build the index once, when the service starts, then
call `search` for each query.

    index = load_proxy_index()
    index.search("Eva Bendersky")      # → a list of person rows, best first

From the command line:

    python search_algorithm/final_algorithm/search.py --download-weights --build-vectors
    python search_algorithm/final_algorithm/search.py "חוה בענדערסקי"

Until the database exists, the archive comes from a proxy: each row of
`ocr_pipeline/extracted_text.csv` stands in for a `person` row, and
`data/name_vectors.npz` (next to this file) for a table of E1 vectors. `SearchIndex`
itself takes plain rows, so moving to PostgreSQL only changes the loader.
"""
import argparse
import csv
import hashlib
import re
import unicodedata
import urllib.request
from collections import Counter, defaultdict
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

MODULE_DIR    = Path(__file__).resolve().parent      # search_algorithm/final_algorithm
REPO_DIR      = MODULE_DIR.parents[1]                 # the repository root
DATA_DIR      = MODULE_DIR / "data"
TRANSCRIPTION = REPO_DIR / "ocr_pipeline" / "extracted_text.csv"   # proxy person rows
DICTIONARY    = DATA_DIR / "name_dictionary.csv"     # D3, frozen from the experiments' step 3
E1_WEIGHTS    = DATA_DIR / "e1_model.safetensors"    # downloaded; not in git
VECTOR_CACHE  = DATA_DIR / "name_vectors.npz"        # E1 vector of every spelling; not in git
E1_URL        = ("https://raw.githubusercontent.com/vedant-jumle/cross-language-phonetic-text-"
                 "alignment/08ae1d4e5193d8b324e8313b8f3abbd9fb4f907f/checkpoints/best_v2/"
                 "model.safetensors")                # the checkpoint the experiments used (MIT)
E1_SHA256     = "670eabacf117f145794628fac65e0eedc3d072f14df4bdf9d1eeefe5813d138b"

NAME_COLUMNS = {"given_name_es": "given", "given_name_he": "given",
                "surname_es": "surname", "surname_he": "surname"}   # the columns searched
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
# NAMES  —  the normalisation of the experiments (and of the future import.py)
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
    as the archive's names were in the experiments.

    Returns:
        One dictionary per word: its script, normalised form and display spelling.
    """
    words = []
    for piece in WORD_SPLIT.split(text.strip()):
        script = word_script(piece)
        norm = normalise(piece, script)
        if len(norm) >= 2 and norm not in PARTICLES:
            words.append({"script": script, "norm": norm,
                          "display": display_spelling(piece, script)})
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
        if missing:                       # e.g. no cache yet, or a new name in the archive
            known.update(zip(missing, encoder.encode(missing)))
        self.spellings = Spellings({key: i for i, key in enumerate(displays)},
                                   list(displays.values()),
                                   np.array([known[d] for d in displays.values()]), n_archive)
        self.tokens = NameTokens(
            person=np.array([person for person, _, _ in words], dtype=int),
            is_surname=np.array([is_surname for _, is_surname, _ in words], dtype=bool),
            spelling=np.array([self.spellings.position[key] for _, _, key in words], dtype=int))
        self.links = link_spellings(self.spellings, dictionary)

    def search(self, query: str, limit: int = DEFAULT_LIMIT) -> list[dict]:
        """Return the person rows that best match `query`, best first, each with its score."""
        return [self.persons[person] | {"score": round(score, 3)}
                for person, score in self.rank(name_words(query), limit)]

    def rank(self, words: list[dict], limit: int = DEFAULT_LIMIT) -> list[tuple[int, float]]:
        """Score every person for the query `words`; return the best `limit` as
        (position, score), ties in row order. Persons scoring 0 are left out."""
        if not words or limit < 1:
            return []
        query_vectors = self.encoder.encode([word["display"] for word in words])
        similarity = np.array([self.word_similarity(word, vector)
                               for word, vector in zip(words, query_vectors)])
        scores = self.person_scores(similarity[:, self.tokens.spelling])
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

    def spelling_vectors(self) -> dict[str, np.ndarray]:
        """Return the E1 vector of every spelling, by display spelling (for the cache)."""
        return dict(zip(self.spellings.displays, self.spellings.vectors))


# ═════════════════════════════════════════════════════════════════════════════
# PROXY DATA  —  stands in for PostgreSQL until the backend exists
# ═════════════════════════════════════════════════════════════════════════════
def read_csv(path: Path) -> list[dict]:
    """Read the CSV file `path` into a list of dictionaries."""
    with path.open(encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))


def person_row(number: int, row: dict) -> dict:
    """Return one transcription row as the person row the database will hold.

    The row's position in the file stands in for the database's person id.
    Rows are labels, not numbers ("2B", "Misc"), so they stay text.
    """
    return {"person_id": number, "section": row["section"], "row": row["row"],
            "stone": int(row["stone"]), **{column: row[column] for column in NAME_COLUMNS},
            "death_year": int(row["death_year"]) if row["death_year"].isdigit() else None}


def load_vectors(path: Path) -> dict[str, np.ndarray]:
    """Read cached E1 vectors (an empty map if there is no cache yet)."""
    if not path.exists():
        return {}
    stored = np.load(path)
    return dict(zip(map(str, stored["texts"]), stored["vectors"]))


def save_vectors(path: Path, vectors: dict[str, np.ndarray]) -> None:
    """Write E1 vectors, by display spelling, to the cache `path`."""
    np.savez_compressed(path, texts=np.array(list(vectors)),
                        vectors=np.array(list(vectors.values())))


def download_e1_weights(path: Path = E1_WEIGHTS) -> None:
    """Download E1's weights to `path`, checking them against the experiments' copy."""
    with urllib.request.urlopen(E1_URL, timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != E1_SHA256:
        raise ValueError("the downloaded E1 weights differ from those the experiments used")
    path.write_bytes(data)


def load_proxy_index(transcription: Path = TRANSCRIPTION, dictionary: Path = DICTIONARY,
                     weights: Path = E1_WEIGHTS, vector_cache: Path = VECTOR_CACHE) -> SearchIndex:
    """Build the index from the proxy files.

    Without a vector cache, every spelling is encoded first, which takes a
    minute or so; `--build-vectors` writes the cache.
    """
    if not weights.exists():
        raise FileNotFoundError(f"{weights} is missing: run `python search_algorithm/"
                                "final_algorithm/search.py --download-weights` first")
    persons = [person_row(number, row)
               for number, row in enumerate(read_csv(transcription), start=1)]
    return SearchIndex(persons, read_csv(dictionary), E1Encoder.from_file(weights),
                       load_vectors(vector_cache))


def main() -> None:
    """Search from the command line, and prepare the data files."""
    parser = argparse.ArgumentParser(description="Search the archive by name.")
    parser.add_argument("query", nargs="*", help="the name to search for, e.g. Eva Bendersky")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="results to show")
    parser.add_argument("--download-weights", action="store_true", help="download E1's weights")
    parser.add_argument("--build-vectors", action="store_true", help="write the vector cache")
    args = parser.parse_args()
    if args.download_weights:
        download_e1_weights()
    index = load_proxy_index()
    if args.build_vectors:
        save_vectors(VECTOR_CACHE, index.spelling_vectors())
    for result in index.search(" ".join(args.query), args.limit):
        names = " ".join(filter(None, (result["given_name_es"], result["surname_es"])))
        hebrew = " ".join(filter(None, (result["given_name_he"], result["surname_he"])))
        print(f"{result['score']:5.2f}  {names or '—'} · {hebrew or '—'} · {result['section']}, "
              f"row {result['row']}, stone {result['stone']}, died {result['death_year'] or '?'}")


if __name__ == "__main__":
    main()
