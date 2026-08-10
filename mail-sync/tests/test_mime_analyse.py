# @verifies CRM-054 (docs/BACKLOG.md) — analyse MIME, empreinte de repli, assainissement
# @verifies docs/SPEC-mail-subsystem.md §4.2, §4.3, §15.3 (canonisation), §15.5 (nom et chemin)
# @verifies docs/JOURNAL.md décision 320

from __future__ import annotations

from datetime import datetime, timezone
from email.message import EmailMessage

import pytest

from mail_sync.mime_analyse import (
    FALLBACK_PREFIX,
    NOM_DE_REPLI,
    analyser,
    assainir_nom,
    empreinte_de_repli,
    type_par_contenu,
)


def message_brut(*, message_id: str | None = "<abc@exemple.test>", piece: bool = False) -> bytes:
    message = EmailMessage()
    message["From"] = "Jeanne Dupont <Jeanne.Dupont@Exemple.TEST>"
    message["To"] = "c-abcd1234@crm.p2enjoy.test, autre@exemple.test"
    message["Subject"] = "Devis demandé"
    message["Date"] = "Mon, 10 Aug 2026 12:00:00 +0000"
    if message_id is not None:
        message["Message-ID"] = message_id
    message.set_content("Bonjour,\nvoici ma demande.")
    if piece:
        message.add_attachment(
            b"%PDF-1.7 contenu",
            maintype="application",
            subtype="octet-stream",
            filename="../../etc/Devis — été 2026.pdf",
        )
    return message.as_bytes()


def test_les_entetes_sont_lus_et_les_adresses_normalisees() -> None:
    analyse = analyser(message_brut())

    assert analyse.rfc822_message_id == "<abc@exemple.test>"
    # L'adresse est ramenée en minuscules : deux graphies d'une même adresse sont la même adresse.
    assert analyse.from_address == "jeanne.dupont@exemple.test"
    assert analyse.from_name == "Jeanne Dupont"
    assert analyse.to_addresses == ["c-abcd1234@crm.p2enjoy.test", "autre@exemple.test"]
    assert analyse.subject == "Devis demandé"
    assert analyse.body_text is not None and "ma demande" in analyse.body_text
    assert analyse.identifiant_derive is False


def test_une_piece_jointe_est_extraite_assainie_et_typée_par_son_contenu() -> None:
    analyse = analyser(message_brut(piece=True))

    assert len(analyse.pieces) == 1
    piece = analyse.pieces[0]
    # Le chemin est retiré, le nom reste LISIBLE — accents compris.
    assert piece.filename == "Devis — été 2026.pdf"
    assert piece.original_name is not None and ".." in piece.original_name
    # Le message déclarait `application/octet-stream` ; le contenu dit PDF.
    assert piece.mime_type == "application/pdf"
    assert piece.size_bytes == len(b"%PDF-1.7 contenu")
    assert len(piece.sha256) == 64


# =================================================================================================
# L'empreinte de repli — §15.3
# =================================================================================================


def test_un_message_sans_message_id_recoit_une_empreinte_prefixee() -> None:
    analyse = analyser(message_brut(message_id=None))

    assert analyse.identifiant_derive is True
    assert analyse.rfc822_message_id.startswith(FALLBACK_PREFIX)
    assert len(analyse.rfc822_message_id) == len(FALLBACK_PREFIX) + 64


def test_l_empreinte_est_stable_pour_un_message_identique() -> None:
    premiere = analyser(message_brut(message_id=None)).rfc822_message_id
    seconde = analyser(message_brut(message_id=None)).rfc822_message_id
    assert premiere == seconde


def test_le_prefixe_interdit_la_collision_avec_un_message_id_forge() -> None:
    """Le §15.3 en une assertion : un expéditeur ne peut pas fabriquer un `Message-ID` qui
    entrerait en collision avec l'empreinte d'un autre message, puisque l'empreinte est reconnue à
    son préfixe et qu'un `Message-ID` conservé garde ses chevrons."""

    empreinte = empreinte_de_repli(
        from_address="a@b.test", sent_at=None, subject="x", taille_corps=1
    )
    forge = analyser(message_brut(message_id=empreinte)).rfc822_message_id
    # Le message porteur du faux identifiant n'est PAS marqué comme dérivé : la distinction reste
    # lisible en base, où `identifiant_derive` n'est pas écrit mais où le préfixe l'est.
    assert analyser(message_brut(message_id=empreinte)).identifiant_derive is False
    assert forge == empreinte


# LE SÉPARATEUR NUL, ET CE QU'IL ÉVITE. Sans lui, « a@b » + « c » et « a@bc » + « » se
# concaténeraient identiquement, et deux messages différents auraient la même empreinte.
def test_le_separateur_empeche_le_decalage_des_champs() -> None:
    premiere = empreinte_de_repli(
        from_address="a@b.test", sent_at=None, subject="c", taille_corps=0
    )
    seconde = empreinte_de_repli(
        from_address="a@b.testc", sent_at=None, subject="", taille_corps=0
    )
    assert premiere != seconde


@pytest.mark.parametrize(
    ("champ", "valeurs"),
    [
        ("from_address", ("a@b.test", "z@b.test")),
        ("subject", ("Devis", "Facture")),
        ("taille_corps", (10, 11)),
    ],
)
def test_chaque_composante_change_l_empreinte(champ: str, valeurs: tuple[object, object]) -> None:
    base: dict[str, object] = {
        "from_address": "a@b.test",
        "sent_at": datetime(2026, 8, 10, tzinfo=timezone.utc),
        "subject": "Devis",
        "taille_corps": 10,
    }
    premiere = empreinte_de_repli(**{**base, champ: valeurs[0]})  # type: ignore[arg-type]
    seconde = empreinte_de_repli(**{**base, champ: valeurs[1]})  # type: ignore[arg-type]
    assert premiere != seconde


def test_la_date_est_canonisee_en_utc() -> None:
    """Deux écritures du MÊME instant doivent donner la même empreinte : sans canonisation, un
    fuseau différent créerait un doublon."""

    from datetime import timedelta

    utc = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)
    ailleurs = utc.astimezone(timezone(timedelta(hours=2)))
    assert empreinte_de_repli(
        from_address="a@b.test", sent_at=utc, subject="x", taille_corps=1
    ) == empreinte_de_repli(from_address="a@b.test", sent_at=ailleurs, subject="x", taille_corps=1)


# =================================================================================================
# L'assainissement des noms — §15.5
# =================================================================================================


@pytest.mark.parametrize(
    ("entree", "attendu"),
    [
        ("rapport.pdf", "rapport.pdf"),
        ("../../etc/passwd", "passwd"),
        ("C:\\Windows\\notes.txt", "notes.txt"),
        ("avec\x00nul.txt", "avecnul.txt"),
        ("  espaces  .pdf  ", "espaces .pdf"),
        ("Devis — été 2026.pdf", "Devis — été 2026.pdf"),
        (None, NOM_DE_REPLI),
        ("", NOM_DE_REPLI),
        ("...", NOM_DE_REPLI),
        ("/", NOM_DE_REPLI),
    ],
)
def test_assainissement(entree: str | None, attendu: str) -> None:
    assert assainir_nom(entree) == attendu


def test_le_nom_est_borne_en_OCTETS_et_non_en_caracteres() -> None:
    """Un nom de 255 caractères accentués dépasse 255 octets, et c'est la limite réelle des
    systèmes de fichiers."""

    long = "é" * 300 + ".pdf"
    assaini = assainir_nom(long)
    assert len(assaini.encode("utf-8")) <= 255


@pytest.mark.parametrize(
    ("contenu", "declare", "attendu"),
    [
        (b"%PDF-1.7", "application/octet-stream", "application/pdf"),
        (b"\x89PNG\r\n\x1a\n", "application/octet-stream", "image/png"),
        (b"\xff\xd8\xff\xe0", "application/octet-stream", "image/jpeg"),
        (b"PK\x03\x04", "application/octet-stream", "application/zip"),
        # Une déclaration SPÉCIFIQUE est conservée : l'expéditeur en sait plus que quatre octets.
        (b"%PDF-1.7", "text/calendar", "text/calendar"),
        # Rien de reconnu, et « je ne sais pas » reste « je ne sais pas ».
        (b"quelconque", "application/octet-stream", "application/octet-stream"),
    ],
)
def test_le_type_vient_du_contenu_quand_la_declaration_est_generique(
    contenu: bytes, declare: str, attendu: str
) -> None:
    assert type_par_contenu(contenu, declare) == attendu
