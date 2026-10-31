# @verifies CRM-074 (docs/BACKLOG.md) — tranche T2 : l'extraction du texte des pièces jointes — chaque format (PDF, Word,
#           Excel, OpenDocument texte et classeur), les PDF sans texte et chiffrés, les contenus qui ne sont pas ce qu'ils
#           annoncent, les bornes (entrées, taille décompressée, durée, mémoire), la normalisation, le traitement d'un lot
#           et la boucle
# @verifies docs/SPEC-pieces-jointes.md §4.1, §4.2, §4.3, §13 ; docs/JOURNAL.md décisions 788 et 789
#
# Les fichiers sont fabriqués ici, en mémoire : aucun binaire versionné, et chaque test dit ce que son fichier contient.

from __future__ import annotations

import io
import logging
import threading
import time
import zipfile

import pytest

from mail_sync import extraction
from mail_sync.extraction import (
    BilanExtraction,
    BorneDepassee,
    Extraction,
    PiloteExtraction,
    extraire_borne,
    extraire_texte,
    format_de,
    normaliser,
    traiter_lot,
)
from mail_sync.postgrest import PostgrestError
from mail_sync.structured_logging import JsonFormatter

PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ODT = "application/vnd.oasis.opendocument.text"
ODS = "application/vnd.oasis.opendocument.spreadsheet"


# =================================================================================================
# Les fichiers
# =================================================================================================


def pdf_texte(*lignes: str) -> bytes:
    """Un PDF d'une page, en Helvetica, dont chaque ligne est un texte ASCII."""

    flux = "BT /F1 12 Tf 72 720 Td " + " 0 -14 Td ".join(f"({ligne}) Tj" for ligne in lignes) + " ET"
    objets = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(flux)} >>\nstream\n{flux}\nendstream",
    ]
    sortie = io.BytesIO()
    sortie.write(b"%PDF-1.4\n")
    positions = []
    for numero, corps in enumerate(objets, start=1):
        positions.append(sortie.tell())
        sortie.write(f"{numero} 0 obj\n{corps}\nendobj\n".encode("latin-1"))
    xref = sortie.tell()
    sortie.write(f"xref\n0 {len(objets) + 1}\n0000000000 65535 f \n".encode())
    for position in positions:
        sortie.write(f"{position:010d} 00000 n \n".encode())
    sortie.write(f"trailer\n<< /Size {len(objets) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return sortie.getvalue()


def pdf_vide() -> bytes:
    """Un PDF d'une page blanche : le cas d'un document numérisé, sans calque de texte."""

    from pypdf import PdfWriter

    ecrivain = PdfWriter()
    ecrivain.add_blank_page(width=612, height=792)
    sortie = io.BytesIO()
    ecrivain.write(sortie)
    return sortie.getvalue()


def pdf_chiffre(source: bytes, mot_de_passe: str) -> bytes:
    from pypdf import PdfReader, PdfWriter

    ecrivain = PdfWriter(clone_from=PdfReader(io.BytesIO(source)))
    ecrivain.encrypt(user_password=mot_de_passe, owner_password="proprietaire", algorithm="RC4-128")
    sortie = io.BytesIO()
    ecrivain.write(sortie)
    return sortie.getvalue()


def archive(fichiers: dict[str, str | bytes]) -> bytes:
    sortie = io.BytesIO()
    with zipfile.ZipFile(sortie, "w", zipfile.ZIP_DEFLATED) as zf:
        for nom, contenu in fichiers.items():
            zf.writestr(nom, contenu)
    return sortie.getvalue()


W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
ODF = (
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
)


def docx(*paragraphes: str) -> bytes:
    corps = "".join(
        f"<w:p><w:r><w:t>{p.split(chr(9))[0]}</w:t></w:r>"
        + "".join(f"<w:r><w:tab/><w:t>{morceau}</w:t></w:r>" for morceau in p.split(chr(9))[1:])
        + "</w:p>"
        for p in paragraphes
    )
    return archive({"[Content_Types].xml": "<Types/>", "word/document.xml": f"<w:document {W}><w:body>{corps}</w:body></w:document>"})


def xlsx() -> bytes:
    return archive({
        "xl/workbook.xml": f"<workbook {S}/>",
        "xl/sharedStrings.xml": f"<sst {S}><si><t>Client</t></si><si><t>Montant</t></si><si><r><t>Ver</t></r><r><t>tuo</t></r></si></sst>",
        "xl/worksheets/sheet1.xml": (
            f"<worksheet {S}><sheetData>"
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12500</v></c></row>'
            '<row r="3"><c r="A3" t="inlineStr"><is><t>Total</t></is></c></row>'
            "</sheetData></worksheet>"
        ),
        "xl/worksheets/sheet2.xml": f'<worksheet {S}><sheetData><row r="1"><c t="inlineStr"><is><t>Feuille deux</t></is></c></row></sheetData></worksheet>',
    })


def odt(*paragraphes: str) -> bytes:
    corps = "".join(f"<text:p>{p}</text:p>" for p in paragraphes)
    return archive({
        "mimetype": ODT,
        "content.xml": f'<office:document-content {ODF}><office:body><office:text><text:h>Titre</text:h>{corps}</office:text></office:body></office:document-content>',
    })


def ods() -> bytes:
    lignes = (
        "<table:table-row><table:table-cell><text:p>Étape</text:p></table:table-cell>"
        "<table:table-cell><text:p>Prospection</text:p></table:table-cell></table:table-row>"
        '<table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>'
    )
    return archive({
        "mimetype": ODS,
        "content.xml": f"<office:document-content {ODF}><office:body><office:spreadsheet><table:table>{lignes}</table:table></office:spreadsheet></office:body></office:document-content>",
    })


# =================================================================================================
# Les formats — §4.2
# =================================================================================================


def test_format_suit_le_type_puis_l_extension_d_un_type_generique():
    assert format_de(PDF, "x") == "pdf"
    assert format_de("Application/PDF; name=x", None) == "pdf"
    assert format_de(DOCX, None) == "docx"
    assert format_de("application/zip", "Bilan.XLSX") == "xlsx"
    assert format_de("application/octet-stream", "note.odt") == "odt"
    assert format_de("application/zip", "archive.zip") is None
    assert format_de("text/plain", "faux.pdf") is None
    assert format_de("application/msword", "ancien.doc") is None
    assert format_de(None, None) is None


def test_pdf_avec_texte():
    resultat = extraire_texte(pdf_texte("Devis 42", "Refonte du monitoring"), PDF, "devis.pdf")
    assert resultat.statut == "extracted"
    assert "Devis 42" in resultat.texte
    assert "Refonte du monitoring" in resultat.texte
    assert resultat.tronque is False


def test_pdf_sans_calque_de_texte_rend_empty():
    assert extraire_texte(pdf_vide(), PDF, "scan.pdf") == Extraction("empty")


def test_pdf_chiffre_sans_mot_de_passe_d_ouverture_se_lit_et_avec_mot_de_passe_rend_empty():
    ouvert = extraire_texte(pdf_chiffre(pdf_texte("Confidentiel 7"), ""), PDF, "a.pdf")
    assert ouvert.statut == "extracted" and "Confidentiel 7" in ouvert.texte
    assert extraire_texte(pdf_chiffre(pdf_texte("Secret"), "motdepasse"), PDF, "b.pdf") == Extraction("empty")


def test_un_faux_pdf_rend_unsupported():
    assert extraire_texte(b"PK\x03\x04 pas un pdf", PDF, "faux.pdf") == Extraction("unsupported")
    assert extraire_texte(b"%PDF-1.4\n tronque", PDF, "casse.pdf").statut in ("unsupported", "empty")


def test_word_garde_les_paragraphes_et_les_tabulations():
    resultat = extraire_texte(docx("Proposition commerciale", "Prix\t12 500 €", ""), DOCX, "p.docx")
    assert resultat == Extraction("extracted", "Proposition commerciale\nPrix 12 500 €", False)


def test_excel_lit_les_chaines_partagees_les_chaines_en_ligne_et_les_valeurs_feuille_par_feuille():
    resultat = extraire_texte(xlsx(), XLSX, "t.xlsx")
    assert resultat.statut == "extracted"
    assert resultat.texte == "Client Montant\nVertuo 12500\nTotal\n\nFeuille deux"


def test_opendocument_texte_et_classeur_sans_deplier_les_cellules_repetees():
    assert extraire_texte(odt("Premier paragraphe.", "Second."), ODT, "n.odt") == Extraction(
        "extracted", "Titre\nPremier paragraphe.\nSecond.", False
    )
    assert extraire_texte(ods(), ODS, "c.ods") == Extraction("extracted", "Étape Prospection", False)


def test_une_archive_sans_la_structure_attendue_rend_unsupported():
    assert extraire_texte(archive({"autre.xml": "<a/>"}), DOCX, "x.docx") == Extraction("unsupported")
    assert extraire_texte(archive({"word/document.xml": "<pas du xml"}), DOCX, "x.docx") == Extraction("unsupported")
    assert extraire_texte(b"pas une archive", XLSX, "x.xlsx") == Extraction("unsupported")
    assert extraire_texte(b"%PDF", "image/png", "x.png") == Extraction("unsupported")


# =================================================================================================
# Les bornes et la normalisation — §3, §4.3
# =================================================================================================


def test_une_archive_de_plus_de_mille_entrees_depasse_la_borne():
    trop = archive({f"word/f{i}.xml": "" for i in range(extraction.ENTREES_MAX + 1)})
    with pytest.raises(BorneDepassee):
        extraire_texte(trop, DOCX, "x.docx")


def test_une_bombe_de_decompression_depasse_la_borne_avant_toute_lecture():
    bombe = archive({"word/document.xml": b"\0" * (extraction.DECOMPRESSE_MAX + 1)})
    assert len(bombe) < 1_000_000, "la bombe tient en moins d'un mégaoctet compressé"
    with pytest.raises(BorneDepassee):
        extraire_texte(bombe, DOCX, "x.docx")


def test_normaliser_resserre_garde_un_paragraphe_et_coupe_a_la_borne():
    assert normaliser("  a \t b \n\n\n\n c\r\nd  ") == ("a b\n\nc\nd", False)
    texte, tronque = normaliser("x" * (extraction.TEXTE_MAX + 5))
    assert len(texte) == extraction.TEXTE_MAX and tronque is True
    assert normaliser(" \n\t ") == ("", False)


# =================================================================================================
# Le processus enfant — §4.3 (cibles au niveau du module : l'enfant `spawn` les importe)
# =================================================================================================


def cible_lente(contenu, mime_type, nom):
    time.sleep(30)
    return Extraction("extracted", "trop tard", False)


def cible_gourmande(contenu, mime_type, nom):
    blocs = [bytearray(64 * 1024 * 1024) for _ in range(64)]
    return Extraction("extracted", str(len(blocs)), False)


def cible_qui_casse(contenu, mime_type, nom):
    raise KeyError("/Root")


def cible_bornee(contenu, mime_type, nom):
    raise BorneDepassee("decompresse")


def test_l_enfant_extrait_un_vrai_fichier():
    assert extraire_borne(docx("Dans l'enfant"), DOCX, "e.docx") == Extraction("extracted", "Dans l'enfant", False)


def test_un_enfant_trop_long_est_abattu_et_rend_failed():
    debut = time.monotonic()
    assert extraire_borne(b"", PDF, "x", cible=cible_lente, duree=1) == Extraction("failed")
    assert time.monotonic() - debut < 10


def test_un_enfant_qui_depasse_sa_memoire_rend_failed():
    assert extraire_borne(b"", PDF, "x", cible=cible_gourmande, memoire=256 * 1024 * 1024) == Extraction("failed")


def test_une_erreur_d_analyse_rend_unsupported_et_une_borne_rend_failed():
    assert extraire_borne(b"", PDF, "x", cible=cible_qui_casse) == Extraction("unsupported")
    assert extraire_borne(b"", PDF, "x", cible=cible_bornee) == Extraction("failed")


# =================================================================================================
# Un lot — §4.1, §13
# =================================================================================================


class ClientFactice:
    def __init__(self, prises, objets, *, panne_rendu=frozenset()):
        self.prises = prises
        self.objets = objets
        self.panne_rendu = panne_rendu
        self.rendus: list[tuple] = []

    def prendre_extractions(self, limite):
        return self.prises[:limite]

    def lire_piece(self, chemin):
        objet = self.objets.get(chemin)
        if isinstance(objet, Exception):
            raise objet
        return objet

    def rendre_extraction(self, identifiant, statut, texte, tronque):
        if identifiant in self.panne_rendu:
            raise PostgrestError(503)
        self.rendus.append((identifiant, statut, texte, tronque))
        return "pending" if statut == "retry" else statut


def prise(identifiant, chemin, mime=DOCX, nom="f.docx"):
    return {"attachment_id": identifiant, "storage_path": chemin, "mime_type": mime, "filename": nom}


def test_un_lot_lit_extrait_rend_et_compte_sans_journaliser_ni_texte_ni_nom():
    client = ClientFactice(
        [prise("a", "p/a"), prise("b", "p/b"), prise("c", "p/c"), prise("d", "p/d"), prise("e", "p/e")],
        {"p/a": docx("Bonjour"), "p/b": PostgrestError(502), "p/c": None, "p/d": b"pas une archive", "p/e": docx("")},
    )
    journal: list[tuple[str, dict]] = []
    bilan = traiter_lot(client, journal=lambda e, **d: journal.append((e, d)), extraire=extraire_texte)
    assert bilan == BilanExtraction(prises=5, extraites=1, vides=1, non_reconnues=1, echouees=1, reprises=1)
    assert client.rendus == [
        ("a", "extracted", "Bonjour", False),
        ("b", "retry", None, False),
        ("c", "failed", None, False),
        ("d", "unsupported", None, False),
        ("e", "empty", None, False),
    ]
    assert all("Bonjour" not in str(d) and "f.docx" not in str(d) for _, d in journal)


def test_une_panne_en_rendant_le_resultat_est_journalisee_et_le_lot_continue():
    client = ClientFactice([prise("a", "p/a"), prise("b", "p/b")], {"p/a": docx("x"), "p/b": docx("y")}, panne_rendu={"a"})
    journal: list[str] = []
    bilan = traiter_lot(client, journal=lambda e, **d: journal.append(e), extraire=extraire_texte)
    assert bilan.prises == 2 and bilan.extraites == 1
    assert "attachment_text_record_failed" in journal


# =================================================================================================
# La boucle — §4.1
# =================================================================================================


def test_la_boucle_enchaine_un_lot_plein_attend_apres_un_lot_partiel_et_s_arrete():
    appels: list[float] = []
    deux = threading.Event()

    def executer():
        appels.append(time.monotonic())
        if len(appels) >= 2:
            deux.set()
        return BilanExtraction(prises=10 if len(appels) == 1 else 3)

    pilote = PiloteExtraction(executer=executer, logger=logging.getLogger("test"), intervalle=60, limite=10)
    pilote.demarrer()
    assert deux.wait(5), "un lot plein est suivi d'un autre sans attendre l'intervalle"
    time.sleep(0.2)
    pilote.arreter()
    assert len(appels) == 2, "après un lot partiel, la boucle attend son intervalle"


def test_la_boucle_survit_a_une_panne():
    appels: list[int] = []
    deux = threading.Event()

    def executer():
        appels.append(1)
        if len(appels) == 1:
            raise PostgrestError(0)
        deux.set()
        return BilanExtraction()

    pilote = PiloteExtraction(executer=executer, logger=logging.getLogger("test"), intervalle=0.05)
    pilote.demarrer()
    assert deux.wait(5)
    pilote.arreter()


def test_le_journal_nomme_la_piece_par_son_identifiant_et_son_statut_et_rien_d_autre():
    record = logging.LogRecord("mail-sync", logging.INFO, __file__, 1, "", None, None)
    record.event = "attachment_text_recorded"
    record.attachment_id = "a-1"
    record.text_status = "extracted"
    record.filename = "secret.pdf"
    ligne = JsonFormatter().format(record)
    assert '"attachment_id":"a-1"' in ligne and '"text_status":"extracted"' in ligne
    assert "secret.pdf" not in ligne
