# @spec CRM-069 (docs/BACKLOG.md) — tranche T6 : le CRM n'ingère pas ses propres courriels (docs/SPEC-etiquettes-digest.md §5.3 bis,
#       INC-321, décision 780)
# @spec CRM-069 (docs/BACKLOG.md) — tranche T4 : le digest sans affaire — aucun `Reply-To`, le jeton `{site}` remplacé par `SITE_URL`
#       (docs/SPEC-etiquettes-digest.md §5.3, décision 772)
# @spec CRM-058 (docs/BACKLOG.md) — le worker qui vide la file d'envoi
# @spec CRM-059 (docs/BACKLOG.md) — la reprise d'une panne, et l'envoi orphelin
# @spec docs/SPEC-mail-subsystem.md §5 (envoi), §19.5 (ce que le worker compose), §20.3 (le
#       backoff et sa borne), §20.4 (l'envoi orphelin)
# @spec docs/JOURNAL.md décisions 330 et 331
# @spec CRM-058 (docs/BACKLOG.md) — tranche 2 : les pièces lues dans le stockage, l'antivirus, la copie d'archive déposée
#       AVANT l'envoi, la copie cachée — docs/SPEC-mail-subsystem.md §19 bis.2 points 6 et 7, §19 bis.4 ; décisions 719, 720
# @spec CRM-158 (docs/BACKLOG.md) — la boucle d'envoi : `executer_passe`, partagée par la route et par `PiloteEnvoi`, et la
#       mesure du retard de la file (docs/SPEC-mail-subsystem.md §34.3 à §34.6 ; docs/JOURNAL.md décision 954)
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

import hashlib
import logging
import smtplib
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Callable

from . import antivirus
from .backoff import decider
from .composition import Envoi, PieceEnvoi, chaine_references, composer, destinataires, identifiant_message
from .postgrest import PostgrestClient, PostgrestError
from .smtp_probe import classer_panne_smtp
from .structured_logging import log_event

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


def chemin_archive(card_id: str, outbox_id: str, sha256: str) -> str:
    """Le chemin de la copie d'archive dans `mail-attachments` : `<affaire>/<envoi>/<empreinte>`, jamais le nom du fichier.

    LA FORME EST IMPOSÉE PAR LA BASE : `mail_attachments_chemin_sans_nom` exige deux UUID puis une empreinte (§15.5).
    MESURÉ : un premier chemin `outbound/<envoi>/…` a été refusé par cette contrainte à l'archive, après la remise — d'où
    l'affaire et l'envoi, deux identifiants que `reserver_envois` rend déjà.
    """

    return f"{card_id}/{outbox_id}/{sha256}"


class PieceRefusee(Exception):
    """Une pièce qui empêche l'envoi : son code est celui que la file retiendra."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def preparer_pieces(
    client: Any,
    ligne: dict[str, Any],
    *,
    clamav_hote: str | None,
    clamav_port: int,
    delai: float,
) -> tuple[tuple[PieceEnvoi, ...], list[dict[str, Any]]]:
    """Lit, analyse et archive les pièces d'un envoi, AVANT toute ouverture SMTP (§19 bis.4).

    L'ARCHIVE EST DÉPOSÉE AVANT L'ENVOI, ET C'EST L'ORDRE QUI COMPTE : un dépôt qui échouerait après la remise laisserait un
    message parti que la file ne pourrait pas marquer, et que la reprise renverrait. Une pièce introuvable lève
    `attachment_missing`, une pièce infectée `attachment_infected` — deux refus, jamais rejoués. Sans antivirus, la pièce
    part et son archive est `skipped`, la règle de la réception (§4.3).
    """

    pieces: list[PieceEnvoi] = []
    archive: list[dict[str, Any]] = []
    for declaree in ligne.get("attachments") or []:
        contenu = client.lire_objet_envoi(declaree["path"])
        if contenu is None:
            raise PieceRefusee("attachment_missing")
        statut = antivirus.SKIPPED
        if clamav_hote:
            verdict = antivirus.analyser_contenu(contenu, hote=clamav_hote, port=clamav_port, timeout=delai)
            if verdict.statut == antivirus.INFECTED:
                raise PieceRefusee("attachment_infected")
            statut = verdict.statut
        empreinte = hashlib.sha256(contenu).hexdigest()
        mime = declaree.get("mime_type") or "application/octet-stream"
        chemin = chemin_archive(ligne["card_id"], ligne["outbox_id"], empreinte)
        client.deposer_objet(chemin, contenu, mime)
        pieces.append(PieceEnvoi(filename=declaree["filename"], mime_type=mime, contenu=contenu))
        archive.append(
            {
                "filename": declaree["filename"],
                "mime_type": mime,
                "size_bytes": len(contenu),
                "storage_path": chemin,
                "sha256": empreinte,
                "av_status": statut,
            }
        )
    return tuple(pieces), archive


JETON_SITE = "{site}"


def corps_avec_liens(ligne: dict[str, Any], site_url: str) -> str:
    """Le corps d'un envoi. Un envoi SANS AFFAIRE — le digest de `CRM-069`, seul de son espèce — porte des liens qui
    commencent par le jeton `{site}` : la base ne connaît pas l'adresse publique (décision 772). Il est remplacé par
    `SITE_URL` ; un envoi d'affaire n'est jamais réécrit."""
    corps = ligne.get("body_text") or ""
    if ligne.get("card_id") is not None:
        return corps
    return corps.replace(JETON_SITE, site_url.rstrip("/"))


def vider_la_file(
    client: Any,
    *,
    limite: int = 10,
    delai: float = 30.0,
    journal: Journal | None = None,
    clamav_hote: str | None = None,
    clamav_port: int = 3310,
    site_url: str = "",
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

        try:
            pieces, archive = preparer_pieces(
                client, ligne, clamav_hote=clamav_hote, clamav_port=clamav_port, delai=delai
            )
        except PieceRefusee as refus:
            client.marquer_envoi_echoue(outbox_id, refus.code)
            echoues += 1
            dire("envoi_refuse", {"outbox_id": outbox_id, "code": refus.code})
            continue
        except PostgrestError:
            # LE STOCKAGE INJOIGNABLE EST UNE PANNE, PAS UN REFUS : rien n'est parti, l'envoi se rejoue. Il emprunte le
            # délai et la borne d'un serveur injoignable (`timeout`), sous son propre code : le vocabulaire de `backoff`
            # reste celui de la sonde SMTP (§13.7), et l'exploitant lit pourtant la vraie cause.
            decision = decider("timeout", int(ligne.get("attempts") or 0) + 1)
            if decision.rejouer:
                client.reprogrammer_envoi(outbox_id, "storage_unavailable", decision.delai_secondes)
                reprogrammes += 1
            else:
                client.marquer_envoi_echoue(outbox_id, "storage_unavailable")
                echoues += 1
            dire("envoi_stockage_injoignable", {"outbox_id": outbox_id})
            continue

        envoi = Envoi(
            outbox_id=outbox_id,
            from_address=ligne["from_address"],
            reply_to=ligne["reply_to"],
            to_addrs=tuple(ligne.get("to_addrs") or ()),
            cc_addrs=tuple(ligne.get("cc_addrs") or ()),
            subject=ligne.get("subject"),
            body_text=corps_avec_liens(ligne, site_url),
            in_reply_to=ligne.get("in_reply_to"),
            references_ids=tuple(ligne.get("references_ids") or ()),
            bcc_addrs=tuple(ligne.get("bcc_addrs") or ()),
            pieces=pieces,
            # Un envoi SANS AFFAIRE est le digest, seul de son espèce (§5.3) : le CRM l'écrit seul (§5.3 bis).
            automatique=ligne.get("card_id") is None,
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

        client.marquer_envoi_reussi(outbox_id, identifiant, list(chaine_references(envoi)), archive)
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


# --- La boucle d'envoi — `CRM-158` (docs/SPEC-mail-subsystem.md §34) --------------------------------------------------

#: §34.3 : trente secondes depuis la FIN de la passe précédente — un envoi part « dans la minute » même quand la passe dure.
INTERVALLE_SECONDES = 30
#: Le lot d'une passe, celui de la route par défaut. Une passe qui le remplit est suivie d'une autre sans attendre.
LOT = 10
#: §34.6 : un envoi dû depuis plus longtemps dit que la boucle ne tourne pas, ou ne suit plus.
SEUIL_RETARD = timedelta(minutes=5)


def executer_passe(settings: Any, logger: logging.Logger, limite: int = LOT) -> ResultatEnvoi:
    """Une passe complète : orphelins, réservation, envois, purge des dépôts abandonnés, ligne `outbox_flushed` (§34.4).

    LA ROUTE ET LA BOUCLE L'APPELLENT TOUTES DEUX : un défaut corrigé d'un côté l'est des deux. Une base injoignable
    pendant la passe remonte en `PostgrestError` — la route la traduit en `502`, la boucle la journalise et rejoue.
    """

    client = PostgrestClient(settings.SUPABASE_URL, settings.SERVICE_ROLE_KEY.get_secret_value(), timeout=60.0)
    resultat = vider_la_file(
        client,
        limite=max(1, min(limite, 100)),
        delai=settings.MAIL_SYNC_SMTP_TIMEOUT_SECONDS,
        journal=lambda evenement, details: log_event(logger, logging.INFO, evenement, **details),
        # `CRM-058` tranche 2 §19 bis.2 point 6 : l'antivirus des pièces envoyées, le même que celui de la relève.
        # Injoignable, il rend `skipped` et l'envoi part.
        clamav_hote=settings.CLAMAV_HOST,
        clamav_port=settings.CLAMAV_PORT,
        # `CRM-069` T4 : l'adresse publique, pour les liens d'un digest (décision 772).
        site_url=settings.SITE_URL,
    )

    # LES DÉPÔTS ABANDONNÉS — `CRM-058` tranche 2 §19 bis.2 point 8 —, effacés à chaque passe par l'API de stockage. Une
    # purge qui échoue n'empêche pas l'envoi d'avoir eu lieu : elle est journalisée et se refera à la passe suivante.
    try:
        abandonnes = client.depots_envoi_abandonnes()
        client.effacer_objets_envoi(abandonnes)
        if abandonnes:
            log_event(logger, logging.INFO, "outbound_attachments_purged", count=len(abandonnes))
    except PostgrestError as erreur:
        log_event(logger, logging.WARNING, "outbound_attachments_purge_failed", postgrest_status=erreur.status_code)

    log_event(
        logger,
        logging.INFO,
        "outbox_flushed",
        reserved=resultat.reserves,
        sent=resultat.envoyes,
        failed=resultat.echoues,
        rescheduled=resultat.reprogrammes,
        orphans=resultat.orphelins,
    )
    return resultat


def mesurer_retard(echeances: list[datetime], maintenant: datetime) -> tuple[int, int | None]:
    """Combien d'envois dus en retard, et de combien de secondes pour le plus ancien (§34.6). Pure : sans base ni horloge."""

    if not echeances:
        return 0, None
    return len(echeances), max(0, int((maintenant - min(echeances)).total_seconds()))


def lire_retard(settings: Any, seuil: timedelta = SEUIL_RETARD) -> Callable[[], tuple[int, int | None]]:
    """La mesure du retard contre la vraie base, avec un client neuf à chaque lecture."""

    def lire() -> tuple[int, int | None]:
        client = PostgrestClient(settings.SUPABASE_URL, settings.SERVICE_ROLE_KEY.get_secret_value(), timeout=30.0)
        maintenant = datetime.now(UTC)
        return mesurer_retard(client.echeances_en_retard(maintenant - seuil), maintenant)

    return lire


#: §34.7 bis : une retenue ne dure jamais plus de dix minutes.
RETENUE_MAX_SECONDES = 600


class RetenueEnvoi:
    """La retenue de la boucle, en développement seulement (§34.7 bis) : une échéance en mémoire, qui expire seule.

    L'horloge est `time.monotonic`, injectable : une preuve vérifie l'expiration sans dormir.
    """

    def __init__(self, horloge: Callable[[], float] | None = None) -> None:
        self._horloge = horloge or time.monotonic
        self._jusqua: float | None = None
        self._verrou = threading.Lock()

    def retenir(self, secondes: float) -> float:
        """Retient la boucle `secondes` secondes, bornées à dix minutes ; rend la durée réellement retenue."""

        duree = max(1.0, min(float(secondes), RETENUE_MAX_SECONDES))
        with self._verrou:
            self._jusqua = self._horloge() + duree
        return duree

    def liberer(self) -> None:
        with self._verrou:
            self._jusqua = None

    def restante(self) -> float:
        """Les secondes de retenue qui restent ; zéro quand la boucle est libre."""

        with self._verrou:
            if self._jusqua is None:
                return 0.0
            reste = self._jusqua - self._horloge()
            if reste <= 0:
                self._jusqua = None
                return 0.0
            return reste


class PiloteEnvoi:
    """La boucle du §34, sur le modèle de `PiloteExtraction` : un `threading.Event`, jamais `time.sleep`.

    Une passe dès le démarrage, puis toutes les trente secondes depuis la fin de la précédente ; une passe pleine est
    suivie d'une autre sans attendre. Elle survit à tout (§34.5) : une passe ratée se rejoue à la suivante.
    """

    def __init__(
        self,
        *,
        executer: Callable[[], ResultatEnvoi],
        mesurer: Callable[[], tuple[int, int | None]],
        logger: logging.Logger,
        intervalle: float = INTERVALLE_SECONDES,
        limite: int = LOT,
        retenue: RetenueEnvoi | None = None,
    ) -> None:
        self._executer = executer
        self._mesurer = mesurer
        self._retenue = retenue or RetenueEnvoi()
        self._logger = logger
        self._intervalle = intervalle
        self._limite = limite
        self._arret = threading.Event()
        self._fil: threading.Thread | None = None

    def demarrer(self) -> None:
        log_event(self._logger, logging.INFO, "outbox_loop_started", intervalle_secondes=self._intervalle)
        self._fil = threading.Thread(target=self._boucler, name="envoi", daemon=True)
        self._fil.start()

    def _boucler(self) -> None:
        while not self._arret.is_set():
            # §34.7 bis : retenue (en développement seulement), la boucle ne passe pas et ne mesure rien ; elle se
            # réveille à la fin de la retenue, ou à son intervalle si celle-ci dure davantage.
            reste = self._retenue.restante()
            if reste > 0:
                if self._arret.wait(min(reste, self._intervalle)):
                    return
                continue
            plein = False
            try:
                plein = self._executer().reserves >= self._limite
            except PostgrestError as erreur:
                log_event(self._logger, logging.WARNING, "outbox_loop_failed", postgrest_status=erreur.status_code)
            except Exception as erreur:  # noqa: BLE001 — la boucle survit à tout, et le dit (§34.5, §20.10.3)
                log_event(self._logger, logging.ERROR, "outbox_loop_failed", error=type(erreur).__name__)
            if not plein:
                self._surveiller()
            if self._arret.wait(0 if plein else self._intervalle):
                return

    def _surveiller(self) -> None:
        """§34.6 : la file vieillit-elle ? Une lecture ratée n'arrête pas la boucle ; elle se refera au tour suivant."""

        try:
            nombre, retard = self._mesurer()
        except PostgrestError as erreur:
            log_event(self._logger, logging.WARNING, "outbox_loop_failed", postgrest_status=erreur.status_code)
            return
        except Exception as erreur:  # noqa: BLE001
            log_event(self._logger, logging.ERROR, "outbox_loop_failed", error=type(erreur).__name__)
            return
        if nombre:
            log_event(self._logger, logging.WARNING, "outbox_stale", count=nombre, overdue_seconds=retard)

    def arreter(self, timeout: float = 5.0) -> None:
        self._arret.set()
        if self._fil is not None:
            self._fil.join(timeout=timeout)
            self._fil = None
