# @spec CRM-052 (docs/BACKLOG.md) — accès du service aux comptes entrants
# @spec CRM-053 (docs/BACKLOG.md) — et aux identités sortantes, par le même chemin
# @spec docs/SPEC-mail-subsystem.md §13.5 et §14.4 (la seule voie de sortie d'un secret)
# @spec docs/DAT.md §3.3 (le chemin d'accès aux secrets, en toutes lettres)
# @spec docs/JOURNAL.md décision 316
#
# POURQUOI `urllib` ET NON UN CLIENT HTTP DE PLUS.
#
# Le service n'a besoin que de deux appels `POST /rest/v1/rpc/…`, sans flux, sans redirection, sans
# authentification négociée. `urllib.request` de la bibliothèque standard les couvre, et
# `CLAUDE.md` §19 demande de vérifier qu'une dépendance est nécessaire avant de l'ajouter :
# `httpx` ne l'est pas ici. IMAPClient, lui, l'est — aucune bibliothèque standard ne parle IMAP
# avec l'API orientée UID que `CRM-054` emploiera.
#
# LES APPELS SONT BLOQUANTS, ET LA ROUTE QUI LES UTILISE EST DÉCLARÉE `def` ET NON `async def` :
# FastAPI l'exécute alors dans un fil d'exécution séparé. Une entrée/sortie bloquante dans une
# coroutine gèlerait la boucle d'événements, donc les sondes de santé.

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


class PostgrestError(RuntimeError):
    """Échec d'un appel à PostgREST, sans jamais reproduire le corps de la réponse.

    Un corps d'erreur PostgREST peut contenir la valeur fautive d'une requête. Le service n'en
    conserve que le code HTTP, comme le §8 du sous-système l'exige pour les journaux.
    """

    def __init__(self, status_code: int) -> None:
        super().__init__(f"postgrest_status_{status_code}")
        self.status_code = status_code


@dataclass(frozen=True)
class OutboundCredentials:
    """Ce que la base rend pour ouvrir une session SMTP — CRM-053, §14.4."""

    identity_id: str
    workspace_id: str
    host: str
    port: int
    security: str
    username: str
    from_address: str
    password: str | None


@dataclass(frozen=True)
class InboundCredentials:
    """Ce que la base rend pour ouvrir une session : les paramètres, et le secret déchiffré."""

    account_id: str
    workspace_id: str
    host: str
    port: int
    security: str
    username: str
    password: str | None


class PostgrestClient:
    """Client minimal, réservé aux quatre fonctions que `CRM-052` et `CRM-053` livrent."""

    def __init__(self, base_url: str, service_role_key: str, timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._key = service_role_key
        self._timeout = timeout

    def _rpc(self, name: str, payload: dict[str, Any]) -> Any:
        requete = urllib.request.Request(
            f"{self._base_url}/rest/v1/rpc/{name}",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "apikey": self._key,
                "Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(requete, timeout=self._timeout) as reponse:
                corps = reponse.read()
        except urllib.error.HTTPError as erreur:
            raise PostgrestError(erreur.code) from None
        except urllib.error.URLError:
            # Ni code, ni corps : la passerelle n'a pas répondu. `0` distingue ce cas d'un refus.
            raise PostgrestError(0) from None
        return json.loads(corps) if corps else None

    def read_credentials(self, account_id: str) -> InboundCredentials | None:
        """Lit les paramètres et le mot de passe déchiffré d'un compte.

        C'est l'unique voie par laquelle un secret sort de la base, et elle n'est ouverte qu'au
        rôle `service_role` (§13.5). Un compte inconnu rend `None` — pas une exception : « ce
        compte n'existe pas » est une réponse, pas une panne.
        """

        lignes = self._rpc("mail_inbound_account_credentials", {"p_account_id": account_id})
        if not lignes:
            return None
        ligne = lignes[0]
        return InboundCredentials(
            account_id=ligne["account_id"],
            workspace_id=ligne["workspace_id"],
            host=ligne["imap_host"],
            port=int(ligne["imap_port"]),
            security=ligne["imap_security"],
            username=ligne["imap_username"],
            password=ligne["password"],
        )

    def read_outbound_credentials(self, identity_id: str) -> OutboundCredentials | None:
        """Même contrat que `read_credentials`, pour les identités sortantes (§14.4)."""

        lignes = self._rpc("mail_outbound_identity_credentials", {"p_identity_id": identity_id})
        if not lignes:
            return None
        ligne = lignes[0]
        return OutboundCredentials(
            identity_id=ligne["identity_id"],
            workspace_id=ligne["workspace_id"],
            host=ligne["smtp_host"],
            port=int(ligne["smtp_port"]),
            security=ligne["smtp_security"],
            username=ligne["smtp_username"],
            from_address=ligne["from_address"],
            password=ligne["password"],
        )

    def record_outbound_check(self, identity_id: str, status: str, error: str | None) -> str:
        return self._rpc(
            "mail_outbound_identity_record_check",
            {"p_identity_id": identity_id, "p_status": status, "p_error": error},
        )

    # ---------------------------------------------------------------------------------------
    # CRM-054 — écriture des messages, occurrences et pièces jointes, et dépôt dans Storage
    # ---------------------------------------------------------------------------------------
    #
    # LES ÉCRITURES PASSENT PAR POSTGREST EN `upsert`, ET LE DÉDOUBLONNAGE EST TENU PAR LA BASE :
    # la contrainte `(workspace_id, rfc822_message_id)` décide, pas le service. Un service qui
    # déciderait lui-même de l'unicité la perdrait au premier redémarrage concurrent.

    def _rest(
        self, methode: str, chemin: str, corps: Any = None, entetes: dict[str, str] | None = None
    ) -> tuple[int, bytes]:
        en_tetes = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
        }
        en_tetes.update(entetes or {})
        donnees = None if corps is None else json.dumps(corps).encode("utf-8")
        requete = urllib.request.Request(
            f"{self._base_url}{chemin}", data=donnees, method=methode, headers=en_tetes
        )
        try:
            with urllib.request.urlopen(requete, timeout=self._timeout) as reponse:
                return reponse.status, reponse.read()
        except urllib.error.HTTPError as erreur:
            raise PostgrestError(erreur.code) from None
        except urllib.error.URLError:
            raise PostgrestError(0) from None

    def lire_dossiers_surveilles(self, account_id: str) -> list[str]:
        """Les dossiers que l'exploitant a déclarés pour ce compte (§15.4).

        La valeur vient de la BASE, jamais d'un défaut du service : `watch_folders` existe
        précisément pour porter la question « faut-il relever les indésirables », et y répondre
        dans le code la retirerait à l'exploitant.
        """

        _, corps = self._rest(
            "GET", f"/rest/v1/mail_inbound_accounts?id=eq.{account_id}&select=watch_folders"
        )
        lignes = json.loads(corps) if corps else []
        return list(lignes[0]["watch_folders"]) if lignes else ["INBOX"]

    def enregistrer_message(self, *, workspace_id: str, analyse: Any) -> tuple[str, bool]:
        """Insère un message, ou retrouve celui que la base connaît déjà.

        Rend `(identifiant, cree)`. `cree` distingue un message NEUF d'une seconde vue du même
        message : c'est ce qui décide si des occurrences suffisent (§4.2).
        """

        charge = {
            "workspace_id": workspace_id,
            "rfc822_message_id": analyse.rfc822_message_id,
            "from_address": analyse.from_address,
            "from_name": analyse.from_name,
            "to_addresses": analyse.to_addresses,
            "cc_addresses": analyse.cc_addresses,
            "subject": analyse.subject,
            "body_text": analyse.body_text,
            "body_html": analyse.body_html,
            "sent_at": None if analyse.sent_at is None else analyse.sent_at.isoformat(),
        }
        # `on_conflict` N'EST PAS FACULTATIF, ET C'EST MESURÉ : sans lui, `resolution=
        # ignore-duplicates` ne s'applique pas et PostgREST rend un `409 / 23505`. Le paramètre
        # nomme la contrainte sur laquelle l'`upsert` doit se résoudre — la clé de dédoublonnage
        # du §4.2, qui n'est pas la clé primaire. Le corps rendu est vide quand la ligne existait.
        statut, corps = self._rest(
            "POST",
            "/rest/v1/mail_messages?on_conflict=workspace_id,rfc822_message_id",
            charge,
            {"Prefer": "return=representation,resolution=ignore-duplicates"},
        )
        lignes = json.loads(corps) if corps else []
        if lignes:
            return lignes[0]["id"], True

        filtre = urllib.parse.quote(analyse.rfc822_message_id, safe="")
        _, existant = self._rest(
            "GET",
            f"/rest/v1/mail_messages?workspace_id=eq.{workspace_id}"
            f"&rfc822_message_id=eq.{filtre}&select=id",
        )
        connues = json.loads(existant) if existant else []
        if not connues:
            raise PostgrestError(statut)
        return connues[0]["id"], False

    def enregistrer_occurrence(
        self, *, message_id: str, account_id: str, folder: str, uid: int
    ) -> bool:
        """Ajoute une occurrence, ou constate qu'elle existe. Rend `True` si elle est neuve."""

        _, corps = self._rest(
            "POST",
            "/rest/v1/mail_message_occurrences?on_conflict=message_id,account_id,folder",
            {"message_id": message_id, "account_id": account_id, "folder": folder, "uid": uid},
            {"Prefer": "return=representation,resolution=ignore-duplicates"},
        )
        return bool(json.loads(corps) if corps else [])

    def classer_automatiquement(
        self, message_id: str, in_reply_to: str | None, references: list[str]
    ) -> str | None:
        """Applique les règles 1, 2 et 4 du §4.4. Rend la card retenue, ou `None`.

        LA RÈGLE VIT EN BASE, PAS ICI : le service transmet la filiation qu'il a lue et laisse
        PostgreSQL trancher. Décider côté service dupliquerait une règle métier hors de l'endroit
        où vivent toutes les autres.
        """

        resultat = self._rpc(
            "classer_message_automatiquement",
            {
                "p_message_id": message_id,
                "p_in_reply_to": in_reply_to,
                "p_references": references or None,
            },
        )
        return resultat if isinstance(resultat, str) else None

    def parents_de_card(self, card_id: str) -> list[dict[str, str]]:
        """Le track et le channel d'une card, avec leurs chemins souhaités.

        Les TROIS niveaux sont mémorisés, et pas seulement la card : sans les deux parents, un
        renommage de track n'aurait rien à renommer et déplacerait les cards une à une en laissant
        un dossier vide derrière (§4.5).

        DEUX LECTURES PLATES PLUTÔT QU'UNE RELATION EMBARQUÉE, et c'est mesuré : `cards` porte DEUX
        clés étrangères vers `channels` — une par workflow, une par workspace —, et PostgREST refuse
        l'ambiguïté par un `PGRST201`. Nommer l'une des deux contraintes marcherait, mais lierait ce
        service à un nom d'index ; deux requêtes sans jointure ne dépendent de rien.
        """

        _, corps = self._rest("GET", f"/rest/v1/cards?id=eq.{card_id}&select=channel_id")
        cartes = json.loads(corps) if corps else []
        if not cartes or not cartes[0].get("channel_id"):
            return []
        channel_id = cartes[0]["channel_id"]

        _, corps = self._rest("GET", f"/rest/v1/channels?id=eq.{channel_id}&select=track_id")
        channels = json.loads(corps) if corps else []
        track_id = channels[0]["track_id"] if channels else None

        parents: list[dict[str, str]] = []
        for type_entite, identifiant in (("track", track_id), ("channel", channel_id)):
            if not identifiant:
                continue
            chemin = self._rpc(
                "chemin_dossier_entite", {"p_type": type_entite, "p_id": identifiant}
            )
            if isinstance(chemin, str):
                parents.append(
                    {"entity_type": type_entite, "entity_id": identifiant, "chemin": chemin}
                )
        return parents

    def reparenter_dossiers(self, account_id: str, ancien: str, nouveau: str) -> int:
        """Fait suivre en base les descendants que le serveur a déjà déplacés (§4.5)."""

        resultat = self._rpc(
            "mail_folder_map_reparenter",
            {
                "p_account_id": account_id,
                "p_ancien_prefixe": ancien,
                "p_nouveau_prefixe": nouveau,
            },
        )
        return int(resultat) if isinstance(resultat, int) else 0

    def chemin_dossier_card(self, card_id: str) -> str | None:
        """Le chemin SOUHAITÉ du dossier d'une card — `CRM/<Track>/<Channel>/<Card>` (§4.5).

        La dérivation vit en base, avec les noms qu'elle assemble : un track se renomme par une
        mise à jour, et la règle doit être au même endroit que la donnée.
        """

        resultat = self._rpc("chemin_dossier_card", {"p_card_id": card_id})
        return resultat if isinstance(resultat, str) else None

    def dossiers_a_renommer(self, account_id: str) -> list[dict[str, Any]]:
        """Les dossiers dont le chemin souhaité a divergé depuis leur création (§4.5)."""

        resultat = self._rpc("dossiers_a_renommer", {"p_account_id": account_id})
        return list(resultat) if isinstance(resultat, list) else []

    def enregistrer_dossier(
        self, *, account_id: str, entity_type: str, entity_id: str,
        requested_path: str, actual_path: str,
    ) -> None:
        """Écrit la correspondance, ou la met à jour si le serveur a changé d'avis.

        `merge-duplicates` et non `ignore` : un dossier renommé côté serveur doit faire suivre la
        correspondance, sans quoi le produit chercherait indéfiniment un chemin qui n'existe plus.
        """

        self._rest(
            "POST",
            "/rest/v1/mail_folder_map?on_conflict=account_id,entity_type,entity_id",
            {
                "account_id": account_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "requested_path": requested_path,
                "actual_path": actual_path,
            },
            {"Prefer": "return=minimal,resolution=merge-duplicates"},
        )

    def enregistrer_piece(self, **champs: Any) -> None:
        self._rest(
            "POST",
            "/rest/v1/mail_attachments?on_conflict=id",
            champs,
            {"Prefer": "return=minimal,resolution=ignore-duplicates"},
        )

    def deposer_objet(self, chemin: str, contenu: bytes, mime_type: str) -> None:
        """Dépose une pièce jointe dans le bucket privé.

        `x-upsert` : deux messages peuvent porter la même pièce, et le chemin est dérivé de son
        empreinte. Refuser le second dépôt ferait échouer une relève pour une raison qui n'en est
        pas une.
        """

        requete = urllib.request.Request(
            f"{self._base_url}/storage/v1/object/mail-attachments/{chemin}",
            data=contenu,
            method="POST",
            headers={
                "apikey": self._key,
                "Authorization": f"Bearer {self._key}",
                "Content-Type": mime_type or "application/octet-stream",
                "x-upsert": "true",
            },
        )
        try:
            with urllib.request.urlopen(requete, timeout=self._timeout):
                return
        except urllib.error.HTTPError as erreur:
            raise PostgrestError(erreur.code) from None
        except urllib.error.URLError:
            raise PostgrestError(0) from None

    def record_check(self, account_id: str, status: str, error: str | None) -> str:
        """Écrit le verdict du test. Rend l'horodatage que la base a posé, jamais celui du service.

        La distinction n'est pas cosmétique : l'heure d'un conteneur et celle de la base peuvent
        diverger, et c'est la seconde qui fait foi pour tout ce qui est relu ensuite.
        """

        return self._rpc(
            "mail_inbound_account_record_check",
            {"p_account_id": account_id, "p_status": status, "p_error": error},
        )
