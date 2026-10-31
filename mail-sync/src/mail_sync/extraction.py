# @spec CRM-074 (docs/BACKLOG.md) — tranche T2 : l'extraction du texte des pièces jointes — les formats, la normalisation,
#       les bornes du processus enfant, le traitement d'un lot et la boucle qui le répète ; la portée couvre tout le module
# @spec docs/SPEC-pieces-jointes.md §4.1 (où et quand), §4.2 (les formats), §4.3 (les bornes), §13 (`retry`) ; docs/DAT.md
#       §3.3 ; docs/JOURNAL.md décisions 788 et 789
#
# UN FICHIER REÇU EST HOSTILE PAR PRINCIPE (§4.3). L'analyse tourne donc dans un processus ENFANT, lancé par `spawn` — le
# service a des fils (Uvicorn, la veille), et un `fork` copierait des verrous tenus par d'autres fils —, limité en calcul et
# en mémoire, et abattu au-delà de sa durée. Une archive Office est mesurée avant d'être lue : nombre d'entrées et taille
# décompressée déclarée, que `zipfile` fait respecter à la lecture.
#
# LE JOURNAL NE PORTE JAMAIS NI LE TEXTE NI LE NOM DU FICHIER : l'identifiant de la pièce et son statut suffisent au
# diagnostic, et un nom de pièce jointe est une donnée personnelle comme une autre.

from __future__ import annotations

import io
import logging
import multiprocessing
import re
import resource
import threading
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from xml.etree import ElementTree

from mail_sync.postgrest import PostgrestError
from mail_sync.structured_logging import log_event

#: Bornes du §3 et du §4.3.
TEXTE_MAX = 200_000
ENTREES_MAX = 1_000
DECOMPRESSE_MAX = 50 * 1024 * 1024
CPU_MAX_SECONDES = 20
MEMOIRE_MAX_OCTETS = 512 * 1024 * 1024
DUREE_MAX_SECONDES = 30
#: Cadence de la boucle (§4.1) : dix pièces toutes les trente secondes, et sans attendre tant qu'un lot revient plein.
INTERVALLE_SECONDES = 30
LOT = 10

_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.oasis.opendocument.text": "odt",
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
}
_GENERIQUES = {"application/zip", "application/x-zip-compressed", "application/octet-stream"}
_EXTENSIONS = {".pdf": "pdf", ".docx": "docx", ".xlsx": "xlsx", ".odt": "odt", ".ods": "ods"}

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_TEXT = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
_TABLE = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"


@dataclass(frozen=True)
class Extraction:
    """Le résultat d'une extraction, dans le vocabulaire de `record_attachment_text`."""

    statut: str  # extracted | empty | unsupported | failed
    texte: str | None = None
    tronque: bool = False


class BorneDepassee(Exception):
    """Le fichier dépasse une borne du §4.3 : `failed`, sans nouvel essai."""


def format_de(mime_type: str | None, nom: str | None) -> str | None:
    """Le format à lire, selon la règle de `app.attachment_text_eligible` (migration `0141`)."""

    type_ = (mime_type or "").split(";", 1)[0].strip().lower()
    if type_ in _TYPES:
        return _TYPES[type_]
    if type_ in _GENERIQUES:
        nom_ = (nom or "").lower()
        for extension, format_ in _EXTENSIONS.items():
            if nom_.endswith(extension):
                return format_
    return None


def normaliser(brut: str) -> tuple[str, bool]:
    """Resserre les blancs d'une ligne, garde les paragraphes (une ligne vide au plus), coupe à `TEXTE_MAX`."""

    lignes = [re.sub(r"[ \t \f\v]+", " ", ligne).strip() for ligne in brut.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    texte = re.sub(r"\n{3,}", "\n\n", "\n".join(lignes)).strip()
    if len(texte) > TEXTE_MAX:
        return texte[:TEXTE_MAX], True
    return texte, False


def _resultat(brut: str) -> Extraction:
    texte, tronque = normaliser(brut)
    if not texte:
        return Extraction("empty")
    return Extraction("extracted", texte, tronque)


def extraire_texte(contenu: bytes, mime_type: str | None, nom: str | None) -> Extraction:
    """Extrait le texte d'une pièce, dans le processus courant. Lève `BorneDepassee` au-delà des bornes du §4.3.

    Appelée par `extraire_borne`, dans l'enfant ; directement par les tests.
    """

    format_ = format_de(mime_type, nom)
    if format_ is None:
        return Extraction("unsupported")
    if format_ == "pdf":
        return _pdf(contenu)
    return _archive(contenu, format_)


def _pdf(contenu: bytes) -> Extraction:
    # Importée ici : le processus principal n'a pas à charger `pypdf`, seul l'enfant le fait.
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    if not contenu.lstrip()[:5] == b"%PDF-":
        return Extraction("unsupported")
    try:
        lecteur = PdfReader(io.BytesIO(contenu))
        if lecteur.is_encrypted:
            # Un PDF chiffré sans mot de passe d'ouverture se lit ; les autres n'ont pas de texte lisible (§4.2). Le
            # chiffrement AES demanderait `cryptography`, que l'image n'embarque pas : même conclusion.
            try:
                if not lecteur.decrypt(""):
                    return Extraction("empty")
            except Exception:
                return Extraction("empty")
        morceaux: list[str] = []
        longueur = 0
        for page in lecteur.pages:
            texte = page.extract_text() or ""
            morceaux.append(texte)
            longueur += len(texte)
            # Au-delà du double de la borne, la suite serait coupée de toute façon.
            if longueur > 2 * TEXTE_MAX:
                break
    except PdfReadError:
        return Extraction("unsupported")
    return _resultat("\n\n".join(morceaux))


def _archive(contenu: bytes, format_: str) -> Extraction:
    try:
        archive = zipfile.ZipFile(io.BytesIO(contenu))
    except zipfile.BadZipFile:
        return Extraction("unsupported")
    with archive:
        entrees = archive.infolist()
        if len(entrees) > ENTREES_MAX:
            raise BorneDepassee("entrees")
        # La taille DÉCLARÉE : `zipfile` refuse de lire au-delà d'elle (`ZipExtFile` borne sa lecture), si bien que la
        # somme déclarée borne aussi ce que la lecture décompresse réellement.
        if sum(entree.file_size for entree in entrees) > DECOMPRESSE_MAX:
            raise BorneDepassee("decompresse")
        noms = {entree.filename for entree in entrees}
        try:
            if format_ == "docx":
                return _docx(archive, noms)
            if format_ == "xlsx":
                return _xlsx(archive, noms)
            return _opendocument(archive, noms, tableur=format_ == "ods")
        except (ElementTree.ParseError, zipfile.BadZipFile, KeyError, ValueError):
            return Extraction("unsupported")


def _xml(archive: zipfile.ZipFile, nom: str) -> ElementTree.Element:
    return ElementTree.fromstring(archive.read(nom))


def _docx(archive: zipfile.ZipFile, noms: set[str]) -> Extraction:
    if "word/document.xml" not in noms:
        return Extraction("unsupported")
    paragraphes: list[str] = []
    for paragraphe in _xml(archive, "word/document.xml").iter(f"{_W}p"):
        morceaux: list[str] = []
        for element in paragraphe.iter():
            if element.tag == f"{_W}t" and element.text:
                morceaux.append(element.text)
            elif element.tag == f"{_W}tab":
                morceaux.append("\t")
            elif element.tag in (f"{_W}br", f"{_W}cr"):
                morceaux.append("\n")
        paragraphes.append("".join(morceaux))
    return _resultat("\n".join(paragraphes))


def _xlsx(archive: zipfile.ZipFile, noms: set[str]) -> Extraction:
    if "xl/workbook.xml" not in noms:
        return Extraction("unsupported")
    partagees: list[str] = []
    if "xl/sharedStrings.xml" in noms:
        for chaine in _xml(archive, "xl/sharedStrings.xml").iter(f"{_S}si"):
            partagees.append("".join(t.text or "" for t in chaine.iter(f"{_S}t")))
    feuilles = sorted(
        (n for n in noms if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
        key=lambda n: int(re.search(r"\d+", n.rsplit("/", 1)[1]).group()),  # type: ignore[union-attr]
    )
    blocs: list[str] = []
    for feuille in feuilles:
        lignes: list[str] = []
        for ligne in _xml(archive, feuille).iter(f"{_S}row"):
            cellules: list[str] = []
            for cellule in ligne.iter(f"{_S}c"):
                genre = cellule.get("t")
                if genre == "inlineStr":
                    valeur = "".join(t.text or "" for t in cellule.iter(f"{_S}t"))
                else:
                    v = cellule.find(f"{_S}v")
                    valeur = v.text or "" if v is not None else ""
                    if genre == "s" and valeur:
                        indice = int(valeur)
                        valeur = partagees[indice] if 0 <= indice < len(partagees) else ""
                if valeur:
                    cellules.append(valeur)
            if cellules:
                lignes.append("\t".join(cellules))
        blocs.append("\n".join(lignes))
    return _resultat("\n\n".join(blocs))


def _opendocument(archive: zipfile.ZipFile, noms: set[str], *, tableur: bool) -> Extraction:
    if "content.xml" not in noms:
        return Extraction("unsupported")
    racine = _xml(archive, "content.xml")
    if not tableur:
        paragraphes = [
            "".join(element.itertext())
            for element in racine.iter()
            if element.tag in (f"{_TEXT}p", f"{_TEXT}h")
        ]
        return _resultat("\n".join(paragraphes))
    lignes: list[str] = []
    for ligne in racine.iter(f"{_TABLE}table-row"):
        # Les cellules répétées (`number-columns-repeated`) ne sont PAS dépliées : une ligne vide répétée un million de
        # fois est le cas ordinaire d'un classeur, et ne porte aucun texte.
        cellules = ["\n".join("".join(p.itertext()) for p in cellule.iter(f"{_TEXT}p")) for cellule in ligne]
        cellules = [c for c in cellules if c.strip()]
        if cellules:
            lignes.append("\t".join(cellules))
    return _resultat("\n".join(lignes))


# =================================================================================================
# Le processus enfant — §4.3
# =================================================================================================


def _enfant(
    canal: Any,
    cible: Callable[[bytes, str | None, str | None], Extraction],
    contenu: bytes,
    mime_type: str | None,
    nom: str | None,
    cpu: int,
    memoire: int,
) -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    resource.setrlimit(resource.RLIMIT_AS, (memoire, memoire))
    try:
        resultat = cible(contenu, mime_type, nom)
    except (BorneDepassee, MemoryError, RecursionError):
        resultat = Extraction("failed")
    except Exception:
        # Un fichier malformé fait lever des erreurs imprévisibles aux analyseurs : son contenu n'est pas ce qu'il annonce.
        resultat = Extraction("unsupported")
    canal.send((resultat.statut, resultat.texte, resultat.tronque))
    canal.close()


def extraire_borne(
    contenu: bytes,
    mime_type: str | None,
    nom: str | None,
    *,
    cible: Callable[[bytes, str | None, str | None], Extraction] = extraire_texte,
    cpu: int = CPU_MAX_SECONDES,
    memoire: int = MEMOIRE_MAX_OCTETS,
    duree: float = DUREE_MAX_SECONDES,
) -> Extraction:
    """Extrait dans un processus enfant borné ; un enfant abattu, tué par une limite ou muet rend `failed` (§4.3)."""

    contexte = multiprocessing.get_context("spawn")
    recepteur, emetteur = contexte.Pipe(duplex=False)
    enfant = contexte.Process(
        target=_enfant, args=(emetteur, cible, contenu, mime_type, nom, cpu, memoire), daemon=True
    )
    enfant.start()
    emetteur.close()
    try:
        if recepteur.poll(duree):
            try:
                statut, texte, tronque = recepteur.recv()
                return Extraction(statut, texte, tronque)
            except (EOFError, OSError):
                return Extraction("failed")
        return Extraction("failed")
    finally:
        recepteur.close()
        enfant.join(timeout=1)
        if enfant.is_alive():
            enfant.kill()
            enfant.join(timeout=5)


# =================================================================================================
# Un lot, et la boucle qui le répète — §4.1
# =================================================================================================


@dataclass(frozen=True)
class BilanExtraction:
    """Ce qu'un lot a produit, en faits comptables — jamais un texte ni un nom de fichier."""

    prises: int = 0
    extraites: int = 0
    vides: int = 0
    non_reconnues: int = 0
    echouees: int = 0
    reprises: int = 0


def traiter_lot(
    client: Any,
    *,
    journal: Callable[..., None],
    limite: int = LOT,
    extraire: Callable[[bytes, str | None, str | None], Extraction] = extraire_borne,
) -> BilanExtraction:
    """Prend au plus `limite` pièces, lit chacune au stockage, extrait, rend le résultat à la base.

    Une panne de lecture se rend `retry` (la base clôt au troisième essai) ; un objet absent est définitif (`failed`). Une
    panne en rendant le résultat est journalisée : le bail échu, la pièce sera reprise.
    """

    comptes = {"extracted": 0, "empty": 0, "unsupported": 0, "failed": 0, "pending": 0}
    prises = client.prendre_extractions(limite)
    for prise in prises:
        identifiant = prise["attachment_id"]
        try:
            contenu = client.lire_piece(prise["storage_path"])
        except PostgrestError as erreur:
            journal("attachment_text_read_failed", attachment_id=identifiant, storage_status=erreur.status_code)
            resultat = Extraction("retry")
        else:
            if contenu is None:
                journal("attachment_text_object_missing", attachment_id=identifiant)
                resultat = Extraction("failed")
            else:
                resultat = extraire(contenu, prise.get("mime_type"), prise.get("filename"))
        try:
            etat = client.rendre_extraction(identifiant, resultat.statut, resultat.texte, resultat.tronque)
        except PostgrestError as erreur:
            journal("attachment_text_record_failed", attachment_id=identifiant, postgrest_status=erreur.status_code)
            continue
        comptes[etat if etat in comptes else "failed"] += 1
        journal("attachment_text_recorded", attachment_id=identifiant, text_status=etat)
    return BilanExtraction(
        prises=len(prises),
        extraites=comptes["extracted"],
        vides=comptes["empty"],
        non_reconnues=comptes["unsupported"],
        echouees=comptes["failed"],
        reprises=comptes["pending"],
    )


class PiloteExtraction:
    """La boucle du §4.1, sur le modèle de `PiloteVeille` : un `threading.Event`, jamais `time.sleep`.

    Un lot revenu plein est suivi d'un autre sans attendre : la reprise de l'existant (§3) s'écoule ainsi au rythme de
    l'extraction, puis la boucle retombe à son intervalle.
    """

    def __init__(
        self,
        *,
        executer: Callable[[], BilanExtraction],
        logger: logging.Logger,
        intervalle: float = INTERVALLE_SECONDES,
        limite: int = LOT,
    ) -> None:
        self._executer = executer
        self._logger = logger
        self._intervalle = intervalle
        self._limite = limite
        self._arret = threading.Event()
        self._fil: threading.Thread | None = None

    def demarrer(self) -> None:
        log_event(self._logger, logging.INFO, "extraction_demarree", intervalle_secondes=self._intervalle)
        self._fil = threading.Thread(target=self._boucler, name="extraction", daemon=True)
        self._fil.start()

    def _boucler(self) -> None:
        while not self._arret.is_set():
            plein = False
            try:
                bilan = self._executer()
                plein = bilan.prises >= self._limite
                if bilan.prises:
                    log_event(
                        self._logger,
                        logging.INFO,
                        "extraction_lot_termine",
                        prises=bilan.prises,
                        extraites=bilan.extraites,
                        vides=bilan.vides,
                        non_reconnues=bilan.non_reconnues,
                        echouees=bilan.echouees,
                        reprises=bilan.reprises,
                    )
            except PostgrestError as erreur:
                log_event(self._logger, logging.WARNING, "extraction_lot_echoue", postgrest_status=erreur.status_code)
            except Exception as erreur:  # la boucle survit à tout : un lot raté se rejoue au suivant
                log_event(self._logger, logging.ERROR, "extraction_lot_echoue", erreur=type(erreur).__name__)
            if self._arret.wait(0 if plein else self._intervalle):
                return

    def arreter(self, timeout: float = 5.0) -> None:
        self._arret.set()
        if self._fil is not None:
            self._fil.join(timeout=timeout)
            self._fil = None
