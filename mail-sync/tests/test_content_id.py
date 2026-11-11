# @verifies CRM-140 (docs/BACKLOG.md) — tranche T1 : le `Content-ID` d'une partie relevé sans chevrons, l'image intégrée sans
#           nom gardée comme pièce, une partie sans `Content-ID` inchangée, un corps HTML porteur d'un `Content-ID` qui reste
#           un corps, la borne ; et la colonne n'est envoyée que lorsqu'elle a une valeur
# @verifies docs/SPEC-mail-subsystem.md §30.6, §30.11 (ligne « pytest mail-sync ») ; docs/SCHEMA.md « Migration de
#           `CRM-140` » ; décision 918

from __future__ import annotations

from email.message import EmailMessage

import pytest

from mail_sync.ingestion import _content_id
from mail_sync.mime_analyse import CONTENT_ID_MAX, NOM_DE_REPLI, PieceJointe, analyser, normaliser_content_id

#: Un PNG d'un pixel : l'inspection du contenu le reconnaît (§4.3).
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


def message_html(*, nom: str | None, content_id: str | None, disposition: str | None = "inline") -> bytes:
    """Un courrier `multipart/related` comme les clients l'écrivent : texte, HTML, puis l'image que le HTML cite."""

    message = EmailMessage()
    message["From"] = "Inès Martin <ines.martin@partenaire-demo.test>"
    message["To"] = "contact@p2enjoy.test"
    message["Subject"] = "Proposition de partenariat"
    message["Message-ID"] = "<cid-test@partenaire-demo.test>"
    message.set_content("Bonjour, voici notre proposition.")
    message.add_alternative('<p>Bonjour</p><img src="cid:logo@partenaire-demo.test">', subtype="html")
    html = message.get_payload()[1]
    html.add_related(PNG, maintype="image", subtype="png", cid=content_id or "<inutile>", filename=nom)
    image = html.get_payload()[1]
    if content_id is None:
        del image["Content-ID"]
    if disposition is None:
        del image["Content-Disposition"]
    elif nom is None:
        image.replace_header("Content-Disposition", disposition)
    return message.as_bytes()


def test_le_content_id_d_une_image_nommee_est_releve_sans_chevrons() -> None:
    analyse = analyser(message_html(nom="logo.png", content_id="<logo@partenaire-demo.test>"))

    assert analyse.body_html is not None and "cid:logo@partenaire-demo.test" in analyse.body_html
    assert [(p.filename, p.content_id, p.mime_type) for p in analyse.pieces] == [("logo.png", "logo@partenaire-demo.test", "image/png")]


@pytest.mark.parametrize("disposition", ["inline", None])
def test_une_image_integree_SANS_NOM_est_gardee_comme_piece(disposition: str | None) -> None:
    analyse = analyser(message_html(nom=None, content_id="<logo@partenaire-demo.test>", disposition=disposition))

    assert len(analyse.pieces) == 1
    piece = analyse.pieces[0]
    assert piece.filename == NOM_DE_REPLI
    assert piece.original_name is None
    assert piece.content_id == "logo@partenaire-demo.test"
    assert piece.contenu == PNG


def test_une_image_sans_nom_ni_content_id_reste_ignoree_comme_avant() -> None:
    analyse = analyser(message_html(nom=None, content_id=None, disposition=None))

    assert analyse.pieces == []


def test_une_piece_jointe_ordinaire_n_a_pas_de_content_id() -> None:
    message = EmailMessage()
    message["From"] = "a@exemple.test"
    message["Message-ID"] = "<p@exemple.test>"
    message.set_content("corps")
    message.add_attachment(b"%PDF-1.7", maintype="application", subtype="pdf", filename="devis.pdf")

    assert [p.content_id for p in analyser(message.as_bytes()).pieces] == [None]


def test_un_corps_html_porteur_d_un_content_id_reste_un_corps() -> None:
    message = EmailMessage()
    message["From"] = "a@exemple.test"
    message["Message-ID"] = "<h@exemple.test>"
    message.set_content("<p>corps</p>", subtype="html")
    message["Content-ID"] = "<corps@exemple.test>"

    analyse = analyser(message.as_bytes())
    assert analyse.pieces == []
    assert analyse.body_html is not None and "corps" in analyse.body_html


@pytest.mark.parametrize(
    ("brut", "attendu"),
    [
        ("<Logo@P2enjoy>", "Logo@P2enjoy"),
        ("  < logo@p2enjoy >  ", "logo@p2enjoy"),
        ("logo@p2enjoy", "logo@p2enjoy"),
        ("<>", None),
        ("", None),
        (None, None),
        ("<a\x00b>", None),
        ("<" + "x" * CONTENT_ID_MAX + ">", "x" * CONTENT_ID_MAX),
        ("<" + "x" * (CONTENT_ID_MAX + 1) + ">", None),
    ],
)
def test_la_normalisation_et_la_borne(brut: str | None, attendu: str | None) -> None:
    assert normaliser_content_id(brut) == attendu


def test_la_colonne_n_est_envoyee_que_lorsqu_elle_a_une_valeur() -> None:
    avec = PieceJointe(filename="logo.png", original_name=None, mime_type="image/png", contenu=PNG, content_id="logo@p")
    sans = PieceJointe(filename="devis.pdf", original_name="devis.pdf", mime_type="application/pdf", contenu=b"%PDF")

    assert _content_id(avec) == {"content_id": "logo@p"}
    assert _content_id(sans) == {}
