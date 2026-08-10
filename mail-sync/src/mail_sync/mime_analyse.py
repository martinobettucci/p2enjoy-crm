# @spec CRM-054 (docs/BACKLOG.md) — analyse MIME, empreinte de repli, assainissement des noms
# @spec docs/SPEC-mail-subsystem.md §4.2 (dédoublonnage), §4.3 (pièces jointes), §15.3 (empreinte
#       de repli et sa canonisation), §15.5 (nom assaini, chemin sans nom de fichier)
# @spec docs/JOURNAL.md décision 320 ; décision 297 (l'empreinte de repli, tranchée)
#
# CE MODULE NE PARLE NI IMAP, NI HTTP, NI SQL : il reçoit des octets et rend des faits. C'est ce
# qui le rend éprouvable sans serveur, et c'est là que vivent les trois règles qui coûtent — la
# canonisation de l'empreinte, l'assainissement d'un nom, et le type déterminé par le CONTENU.

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parsedate_to_datetime


#: Préfixe de l'empreinte de repli. IL N'EST PAS DÉCORATIF : il distingue une empreinte d'un
#: identifiant véritable, et interdit qu'un expéditeur forge un `Message-ID` entrant en collision
#: avec l'empreinte d'un autre message (§15.3).
FALLBACK_PREFIX = "fallback-sha256:"

#: Nom de repli d'une pièce jointe sans nom exploitable.
NOM_DE_REPLI = "piece-jointe"

#: Bornes du §15.5. 255 octets est la limite de nom de fichier des systèmes de fichiers usuels ;
#: elle n'a pas d'importance pour Storage — le chemin ne contient pas le nom — mais le nom est
#: affiché, et un nom sans borne est une promesse qu'aucune couche ne tient.
NOM_MAX_OCTETS = 255

_CARACTERES_INTERDITS = re.compile(r"[\x00-\x1f\x7f/\\]")
_ESPACES = re.compile(r"\s+")


@dataclass(frozen=True)
class PieceJointe:
    """Une pièce jointe extraite, avant tout dépôt."""

    filename: str
    original_name: str | None
    mime_type: str
    contenu: bytes

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.contenu).hexdigest()

    @property
    def size_bytes(self) -> int:
        return len(self.contenu)


@dataclass(frozen=True)
class MessageAnalyse:
    """Ce qu'un message apporte, une fois lu."""

    rfc822_message_id: str
    from_address: str
    from_name: str | None
    to_addresses: list[str]
    cc_addresses: list[str]
    subject: str | None
    body_text: str | None
    body_html: str | None
    sent_at: datetime | None
    #: `In-Reply-To` et `References` — la filiation qu'emploie la règle 2 du §4.4. Ils sont lus ici
    #: parce que c'est le seul endroit qui ouvre le message ; la RÈGLE, elle, vit en base.
    in_reply_to: str | None = None
    references: list[str] = field(default_factory=list)
    pieces: list[PieceJointe] = field(default_factory=list)
    #: Vrai lorsque l'identifiant a dû être DÉRIVÉ, faute de `Message-ID` (§15.3).
    identifiant_derive: bool = False


def assainir_nom(nom: str | None) -> str:
    """Rend un nom de pièce jointe affichable, et rien de plus.

    TROIS GESTES, ET AUCUN N'EST COSMÉTIQUE : le chemin est retiré — `../../etc/passwd` ne doit pas
    subsister, même si le chemin de stockage ne l'emploie pas —, les caractères de contrôle sont
    retirés parce qu'ils rendent un nom illisible ou trompeur dans un terminal, et la longueur est
    bornée.

    Le nom n'est PAS translittéré : « Devis — été 2026.pdf » reste lisible. Réduire un nom à l'ASCII
    priverait l'utilisateur de ce que l'expéditeur a voulu transmettre, sans rien protéger de plus.
    """

    if nom is None:
        return NOM_DE_REPLI
    # Le nom de base d'abord : un séparateur de chemin n'a rien à faire dans un nom de fichier.
    sans_chemin = nom.replace("\\", "/").split("/")[-1]
    nettoye = _CARACTERES_INTERDITS.sub("", sans_chemin)
    nettoye = _ESPACES.sub(" ", nettoye).strip(" .")
    if not nettoye:
        return NOM_DE_REPLI
    # La borne porte sur les OCTETS, non sur les caractères : un nom de 255 caractères accentués
    # dépasse 255 octets, et c'est la limite réelle des systèmes de fichiers.
    encode = nettoye.encode("utf-8")[:NOM_MAX_OCTETS]
    return encode.decode("utf-8", errors="ignore") or NOM_DE_REPLI


def empreinte_de_repli(
    *,
    from_address: str,
    sent_at: datetime | None,
    subject: str | None,
    taille_corps: int,
) -> str:
    """Dérive un identifiant pour un message sans `Message-ID` — §15.3.

    LE SÉPARATEUR EST UN OCTET NUL, et c'est la seule partie de cette fonction qui mérite d'être
    défendue : il ne peut apparaître dans aucune des quatre composantes. Sans séparateur non
    ambigu, deux messages différents produiraient la même empreinte par simple décalage des champs
    — « a@b » + « c » et « a@bc » + « » se concaténeraient identiquement.
    """

    date = "" if sent_at is None else sent_at.astimezone(timezone.utc).isoformat()
    composantes = [
        from_address.strip().lower(),
        date,
        (subject or "").strip(),
        str(taille_corps),
    ]
    brut = "\x00".join(composantes).encode("utf-8")
    return FALLBACK_PREFIX + hashlib.sha256(brut).hexdigest()


def _adresses(message: EmailMessage, entete: str) -> list[str]:
    valeurs = message.get_all(entete, [])
    adresses: list[str] = []
    for valeur in valeurs:
        for morceau in str(valeur).split(","):
            adresse = morceau.strip()
            if "@" in adresse:
                # `Nom <adresse>` : seule l'adresse est conservée.
                if "<" in adresse and ">" in adresse:
                    adresse = adresse[adresse.index("<") + 1 : adresse.index(">")]
                adresses.append(adresse.strip().lower())
    return adresses


def analyser(brut: bytes) -> MessageAnalyse:
    """Lit un message RFC 822 complet et en extrait ce que l'ingestion écrit.

    Le type d'une pièce jointe vient de ce que le message DÉCLARE, puis d'une inspection du
    contenu lorsque la déclaration est le type générique `application/octet-stream` : c'est la
    règle du §4.3, « déterminé par inspection du contenu et non seulement par l'extension ».
    """

    message = BytesParser(policy=policy.default).parsebytes(brut)

    corps_texte: str | None = None
    corps_html: str | None = None
    pieces: list[PieceJointe] = []

    for partie in message.walk():
        if partie.is_multipart():
            continue
        nom = partie.get_filename()
        disposition = (partie.get_content_disposition() or "").lower()
        contenu = partie.get_payload(decode=True) or b""
        if nom or disposition == "attachment":
            pieces.append(
                PieceJointe(
                    filename=assainir_nom(nom),
                    original_name=nom,
                    mime_type=type_par_contenu(contenu, partie.get_content_type()),
                    contenu=contenu,
                )
            )
        elif partie.get_content_type() == "text/plain" and corps_texte is None:
            corps_texte = contenu.decode(partie.get_content_charset() or "utf-8", errors="replace")
        elif partie.get_content_type() == "text/html" and corps_html is None:
            corps_html = contenu.decode(partie.get_content_charset() or "utf-8", errors="replace")

    expediteurs = _adresses(message, "From")
    from_address = expediteurs[0] if expediteurs else ""

    sent_at: datetime | None = None
    if message["Date"]:
        try:
            sent_at = parsedate_to_datetime(message["Date"])
        except (TypeError, ValueError):
            # Une date illisible n'est pas une raison de perdre le message : elle est ignorée, et
            # `received_at` fera foi. Le taire serait pire que le dire.
            sent_at = None

    identifiant = (message["Message-ID"] or "").strip()
    derive = False
    if not identifiant:
        derive = True
        identifiant = empreinte_de_repli(
            from_address=from_address,
            sent_at=sent_at,
            subject=message["Subject"],
            taille_corps=len((corps_texte or corps_html or "").encode("utf-8")),
        )

    nom_expediteur = None
    entete_from = message["From"]
    if entete_from and "<" in str(entete_from):
        nom_expediteur = str(entete_from).split("<")[0].strip().strip('"') or None

    references = [
        morceau.strip()
        for morceau in str(message["References"] or "").split()
        if morceau.strip().startswith("<")
    ]

    return MessageAnalyse(
        rfc822_message_id=identifiant,
        from_address=from_address,
        from_name=nom_expediteur,
        to_addresses=_adresses(message, "To"),
        cc_addresses=_adresses(message, "Cc"),
        subject=str(message["Subject"]) if message["Subject"] else None,
        body_text=corps_texte,
        body_html=corps_html,
        sent_at=sent_at,
        in_reply_to=(str(message["In-Reply-To"]).strip() if message["In-Reply-To"] else None),
        references=references,
        pieces=pieces,
        identifiant_derive=derive,
    )


#: Signatures reconnues par inspection. La liste est courte et le restera : elle ne sert qu'à
#: corriger une déclaration générique, pas à remplacer une bibliothèque de détection.
_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"%PDF-", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"PK\x03\x04", "application/zip"),
)


def type_par_contenu(contenu: bytes, declare: str) -> str:
    """Corrige un type DÉCLARÉ générique par ce que le contenu montre — §4.3.

    Le type déclaré est conservé lorsqu'il est spécifique : un expéditeur qui annonce
    `text/calendar` en sait plus que quatre octets d'en-tête. Seul `application/octet-stream` —
    « je ne sais pas » — est corrigé, et seulement si une signature est reconnue.
    """

    if declare and declare != "application/octet-stream":
        return declare
    for signature, type_reel in _SIGNATURES:
        if contenu.startswith(signature):
            return type_reel
    return declare or "application/octet-stream"
