# @spec CRM-058 (docs/BACKLOG.md) — le worker qui vide la file d'envoi
# @spec CRM-059 (docs/BACKLOG.md) — la reprise d'une panne, et l'envoi orphelin
# @spec docs/SPEC-mail-subsystem.md §5 (envoi), §19.5 (ce que le worker compose), §20.3 (le
#       backoff et sa borne), §20.4 (l'envoi orphelin)
# @spec docs/JOURNAL.md décisions 330 et 331
#
# CE MODULE ORCHESTRE, IL NE DÉCIDE PAS. La garde est en base (`queue_outbound_email`), la
# composition est dans `composition.py`, la traduction des pannes est dans `smtp_probe.py` : ici,
# on réserve, on envoie, on rapporte.
#
# UNE PANNE SE REJOUE, UN REFUS NON — révisé par `CRM-059`, qui livre ce que `CRM-058` avait
# nommément laissé de côté. Un serveur injoignable reviendra ; un mot de passe faux ne deviendra pas
# juste en attendant. Un échec définitif passe `failed` et le DIT ; il ne reste pas `queued` en
# silence — une file qui ne bouge plus sans rien dire est pire qu'un refus.

from __future__ import annotations

import smtplib
from dataclasses import dataclass
from typing import Any, Callable

from .backoff import decider
from .composition import Envoi, chaine_references, composer, destinataires, identifiant_message
from .smtp_probe import classer_panne_smtp

Journal = Callable[[str, dict[str, Any]], None]


@dataclass(frozen=True)
class ResultatEnvoi:
    """Ce qu'une passe du worker a réellement fait."""

    reserves: int = 0
    envoyes: int = 0
    echoues: int = 0
    #: Envois reprogrammés après une PANNE — ils ne sont ni partis, ni perdus (`CRM-059` §20.3).
    reprogrammes: int = 0
    #: Envois orphelins repris d'un worker mort (§20.4).
    orphelins: int = 0


def _domaine(adresse: str) -> str:
    """Le domaine d'une adresse, pour y poser le `Message-ID`."""

    _, _, domaine = adresse.rpartition("@")
    return domaine or "localhost"


def _ouvrir(hote: str, port: int, securite: str, delai: float) -> smtplib.SMTP:
    """Ouvre la session selon le mode déclaré — même contrat que la sonde de `CRM-053`."""

    if securite == "ssl":
        return smtplib.SMTP_SSL(hote, port, timeout=delai)
    session = smtplib.SMTP(hote, port, timeout=delai)
    session.ehlo()
    if securite == "starttls":
        session.starttls()
        session.ehlo()
    return session


def vider_la_file(
    client: Any,
    *,
    limite: int = 10,
    delai: float = 30.0,
    journal: Journal | None = None,
) -> ResultatEnvoi:
    """Réserve les envois dus, les soumet, et rapporte ce qui s'est passé.

    LE MOT DE PASSE EST LU PAR ENVOI, depuis Vault, comme pour la relève : le garder en mémoire
    entre deux passes ferait vivre un secret plus longtemps que son usage.

    UN ENVOI SANS IDENTIFIANTS N'EST PAS UN ENVOI RATÉ POUR UNE RAISON MYSTÉRIEUSE : il est marqué
    `credentials_missing`, un code que l'exploitant peut relier à une identité mal configurée.
    """

    dire: Journal = journal if journal is not None else (lambda _evenement, _details: None)
    # LES ORPHELINS D'ABORD : une ligne `sending` abandonnée par un worker mort ne se reprend
    # jamais toute seule, et la réserver après coup la ferait passer dans la même passe.
    orphelins = client.reprendre_envois_orphelins()
    if orphelins:
        dire("envois_orphelins_repris", {"count": orphelins})
    lignes = client.reserver_envois(limite)
    resultat = ResultatEnvoi(reserves=len(lignes))
    envoyes = 0
    echoues = 0
    reprogrammes = 0

    for ligne in lignes:
        outbox_id = ligne["outbox_id"]
        identifiants = client.read_outbound_credentials(ligne["identity_id"])
        if identifiants is None or identifiants.password is None:
            client.marquer_envoi_echoue(outbox_id, "credentials_missing")
            echoues += 1
            dire("envoi_refuse", {"outbox_id": outbox_id, "code": "credentials_missing"})
            continue

        envoi = Envoi(
            outbox_id=outbox_id,
            from_address=ligne["from_address"],
            reply_to=ligne["reply_to"],
            to_addrs=tuple(ligne.get("to_addrs") or ()),
            cc_addrs=tuple(ligne.get("cc_addrs") or ()),
            subject=ligne.get("subject"),
            body_text=ligne.get("body_text") or "",
            in_reply_to=ligne.get("in_reply_to"),
            references_ids=tuple(ligne.get("references_ids") or ()),
        )
        identifiant = identifiant_message(_domaine(envoi.from_address))
        message = composer(envoi, identifiant)

        try:
            session = _ouvrir(
                identifiants.host, identifiants.port, identifiants.security, delai
            )
            try:
                session.login(identifiants.username, identifiants.password)
                # LES DESTINATAIRES DE L'ENVELOPPE SONT DONNÉS EXPLICITEMENT : `send_message` les
                # déduit des en-têtes, et une copie absente de l'enveloppe ne serait jamais remise.
                session.send_message(message, to_addrs=list(destinataires(envoi)))
            finally:
                try:
                    session.quit()
                except Exception:  # noqa: BLE001
                    # Un `QUIT` refusé après une remise acceptée ne change rien au fait : le
                    # message est parti. S'en plaindre ferait passer un succès pour un échec.
                    pass
        except Exception as panne:  # noqa: BLE001
            code = classer_panne_smtp(panne)
            # UNE PANNE SE REJOUE, UN REFUS NON (décision 331). La règle vit dans `backoff`, où
            # elle s'éprouve sans serveur ; ici, on l'applique.
            decision = decider(code, int(ligne.get("attempts") or 0) + 1)
            if decision.rejouer:
                client.reprogrammer_envoi(outbox_id, decision.code, decision.delai_secondes)
                reprogrammes += 1
                dire(
                    "envoi_reprogramme",
                    {"outbox_id": outbox_id, "code": code, "delai": decision.delai_secondes},
                )
                continue
            client.marquer_envoi_echoue(outbox_id, code)
            echoues += 1
            # LE CODE, JAMAIS LE TEXTE : un message d'erreur brut expose la version du serveur,
            # son hôte, parfois l'adresse (§13.7 et §8).
            dire("envoi_echoue", {"outbox_id": outbox_id, "code": code})
            continue

        client.marquer_envoi_reussi(outbox_id, identifiant, list(chaine_references(envoi)))
        envoyes += 1
        # NI CORPS, NI DESTINATAIRE DANS LE JOURNAL (§8) : l'identifiant interne et le
        # `Message-ID` suffisent à retrouver un envoi.
        dire("envoi_reussi", {"outbox_id": outbox_id, "message_id": identifiant})

    return ResultatEnvoi(
        reserves=resultat.reserves,
        envoyes=envoyes,
        echoues=echoues,
        reprogrammes=reprogrammes,
        orphelins=orphelins,
    )
