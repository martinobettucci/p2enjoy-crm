# @verifies CRM-058 (docs/BACKLOG.md) — en-têtes d'un message sortant
# @verifies docs/SPEC-mail-subsystem.md §19.1 (le serveur ne vérifie rien), §19.5 (ce que le
#           worker compose), §19.7 (preuves exigées)
# @verifies docs/JOURNAL.md décision 330
#
# LA COMPOSITION EST ÉPROUVÉE SANS SERVEUR : c'est tout l'objet de la séparation. Les trois
# garanties que le transport ne tient pas — identifiant choisi, `Reply-To` de la card, chaîne
# complète — sont mesurées ici, à l'en-tête près.

from __future__ import annotations

from mail_sync.composition import (
    OBJET_PAR_DEFAUT,
    Envoi,
    chaine_references,
    composer,
    destinataires,
    identifiant_message,
)


def envoi(**surcharges: object) -> Envoi:
    base = {
        "outbox_id": "o1",
        "from_address": "systeme@crm.p2enjoy.test",
        "reply_to": "c-abcd1234@crm.p2enjoy.test",
        "to_addrs": ("client@exterieur.test",),
        "subject": "Proposition",
        "body_text": "Bonjour,\n\nVoici notre proposition.",
    }
    base.update(surcharges)
    return Envoi(**base)  # type: ignore[arg-type]


def test_le_reply_to_porte_l_adresse_de_la_card() -> None:
    """C'EST LE MÉCANISME QUI RAMÈNE LES RÉPONSES DANS LE CRM (§5), et le serveur ne le vérifie
    pas : il transmet même une adresse de card inexistante (§19.1)."""

    message = composer(envoi(), "<abc@crm.p2enjoy.test>")
    assert message["Reply-To"] == "c-abcd1234@crm.p2enjoy.test"
    assert message["From"] == "systeme@crm.p2enjoy.test"


def test_l_identifiant_est_celui_du_produit_et_porte_le_domaine_de_l_expediteur() -> None:
    """Un `Message-ID` posé sur un domaine que l'expéditeur ne contrôle pas est usurpé."""

    identifiant = identifiant_message("crm.p2enjoy.test", "jeton")
    assert identifiant == "<jeton@crm.p2enjoy.test>"
    message = composer(envoi(), identifiant)
    assert message["Message-ID"] == identifiant


def test_deux_identifiants_successifs_different() -> None:
    assert identifiant_message("crm.p2enjoy.test") != identifiant_message("crm.p2enjoy.test")


def test_un_message_initial_n_annonce_aucun_fil() -> None:
    """Des en-têtes de fil vides annonceraient une conversation qui n'existe pas."""

    message = composer(envoi(), "<abc@crm.p2enjoy.test>")
    assert message["In-Reply-To"] is None
    assert message["References"] is None


def test_une_reponse_cite_la_chaine_COMPLETE_et_dans_l_ordre() -> None:
    """LE PARENT SEUL COUPERAIT LE FIL AU DEUXIÈME ALLER-RETOUR (§19.3)."""

    message = composer(
        envoi(
            in_reply_to="<parent@client.test>",
            references_ids=("<racine@client.test>", "<milieu@client.test>"),
        ),
        "<abc@crm.p2enjoy.test>",
    )
    assert message["In-Reply-To"] == "<parent@client.test>"
    assert message["References"] == (
        "<racine@client.test> <milieu@client.test> <parent@client.test>"
    )


def test_la_chaine_est_dedoublonnee_sans_perdre_l_ordre() -> None:
    """Un fil qui répète un identifiant fait grossir l'en-tête à chaque aller-retour."""

    chaine = chaine_references(
        envoi(
            in_reply_to="<parent@client.test>",
            references_ids=("<racine@client.test>", "<parent@client.test>"),
        )
    )
    assert chaine == ("<racine@client.test>", "<parent@client.test>")


def test_une_reference_vide_est_ignoree_plutot_que_transmise() -> None:
    chaine = chaine_references(envoi(in_reply_to="", references_ids=("", "<racine@a.test>")))
    assert chaine == ("<racine@a.test>",)


def test_un_objet_absent_prend_un_repli_plutot_qu_une_ligne_vide() -> None:
    message = composer(envoi(subject=None), "<abc@crm.p2enjoy.test>")
    assert message["Subject"] == OBJET_PAR_DEFAUT


def test_les_copies_sont_dans_l_entete_ET_dans_l_enveloppe() -> None:
    """Une copie absente de l'enveloppe ne serait jamais remise : l'en-tête ne fait pas la remise."""

    courrier = envoi(cc_addrs=("collegue@p2enjoy.test",))
    message = composer(courrier, "<abc@crm.p2enjoy.test>")
    assert message["Cc"] == "collegue@p2enjoy.test"
    assert destinataires(courrier) == ("client@exterieur.test", "collegue@p2enjoy.test")


def test_le_corps_est_du_texte_et_conserve_ses_retours_a_la_ligne() -> None:
    message = composer(envoi(), "<abc@crm.p2enjoy.test>")
    assert message.get_content_type() == "text/plain"
    assert "Voici notre proposition." in message.get_content()
