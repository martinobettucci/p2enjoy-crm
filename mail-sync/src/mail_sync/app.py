# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.3 et §12.5 — santé, API
# interne, autorisation backend, corrélation et bornes ; la portée couvre toutes les routes.

from __future__ import annotations

import hmac
import logging
import re
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from mail_sync import __version__
from mail_sync.config import Settings
from mail_sync.envoi import vider_la_file
from mail_sync.imap_probe import probe_inbound_account
from mail_sync.postgrest import PostgrestClient, PostgrestError
from mail_sync.ingestion import relever_compte
from mail_sync.smtp_probe import probe_outbound_identity
from mail_sync.state import RuntimeState, StateStore
from mail_sync.structured_logging import log_event


MAX_BODY_BYTES = 1_024
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
WORKER_WAITING = "waiting_for_configuration"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(StrictModel):
    status: str


class WorkerResponse(StrictModel):
    state: str


class StatusResponse(StrictModel):
    service: str
    version: str
    profile: str
    schema_version: int
    boot_count: int
    boot_id: UUID
    workers: dict[str, WorkerResponse]


class CheckpointRequest(StrictModel):
    checkpoint: UUID


class ConnectionTestResponse(StrictModel):
    """Verdict rendu à l'appelant — le MÊME que celui écrit en base.

    `error` porte l'un des six codes du §13.7, jamais la phrase du serveur distant. `folders` dit
    combien de dossiers `LIST` a rendus : une session qui s'ouvre puis ne sait rien lister n'est
    pas une session utilisable, et le nombre est ce qui distingue les deux.
    """

    account_id: UUID
    status: str
    error: str | None
    folders: int
    checked_at: str


class EnvoiResponse(StrictModel):
    """Ce qu'une passe du worker d'envoi a produit — des faits comptables, jamais un destinataire.

    `reserved` peut dépasser `sent + failed` : un envoi réservé dont le worker meurt reste
    `sending`, et c'est ce que `CRM-059` devra reprendre. Le compte le dit plutôt que de l'arrondir.
    """

    reserved: int
    sent: int
    failed: int
    #: Reprogrammés après une PANNE — ni partis, ni perdus (`CRM-059` §20.3).
    rescheduled: int = 0
    #: Orphelins repris d'un worker mort (§20.4).
    orphans: int = 0


class ReleveResponse(StrictModel):
    """Ce qu'une relève a produit, en faits comptables — jamais un contenu de message."""

    account_id: UUID
    folders: int
    messages_seen: int
    messages_new: int
    messages_classified: int
    occurrences: int
    attachments: int
    attachments_infected: int
    filed: int
    filed_retried: int
    renamed: int


class CheckpointResponse(StrictModel):
    checkpoint: UUID | None


def _request_id(request: Request) -> str:
    candidate = request.headers.get("x-request-id", "")
    if REQUEST_ID_PATTERN.fullmatch(candidate):
        return candidate
    return str(uuid4())


def _bearer_is_valid(request: Request) -> bool:
    authorization = request.headers.get("authorization", "")
    scheme, separator, credentials = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not credentials or " " in credentials:
        return False
    expected = request.app.state.settings.MAIL_SYNC_INTERNAL_TOKEN.get_secret_value()
    return hmac.compare_digest(credentials, expected)


def require_internal_token(request: Request) -> None:
    if not _bearer_is_valid(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentification requise",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_dev_internal_token(request: Request) -> None:
    if request.app.state.settings.P2ENJOY_ENV_PROFILE != "dev":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    require_internal_token(request)


def _status_response(state: RuntimeState, settings: Settings) -> StatusResponse:
    return StatusResponse(
        service="mail-sync",
        version=__version__,
        profile=settings.P2ENJOY_ENV_PROFILE,
        schema_version=state.schema_version,
        boot_count=state.boot_count,
        boot_id=state.boot_id,
        workers={
            "imap": WorkerResponse(state=WORKER_WAITING),
            "smtp": WorkerResponse(state=WORKER_WAITING),
        },
    )


def create_app(
    settings: Settings,
    store: StateStore | None = None,
    logger: logging.Logger | None = None,
) -> FastAPI:
    state_store = store or StateStore(settings.MAIL_SYNC_STATE_PATH)
    app_logger = logger or logging.getLogger("mail-sync")

    # §12.3 : le service n'ouvre aucune ressource asynchrone, donc aucun lifespan applicatif
    # artificiel. L'état est ouvert ici, synchroniquement, avant que Uvicorn n'écoute : soit la
    # readiness est vraie, soit l'application n'a jamais été construite.
    state = state_store.start()
    log_event(
        app_logger,
        logging.INFO,
        "service_started",
        boot_id=str(state.boot_id),
        boot_count=state.boot_count,
    )

    application = FastAPI(
        title="P2Enjoy mail-sync internal API",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    application.state.settings = settings
    application.state.store = state_store

    @application.middleware("http")
    async def security_and_observability(request: Request, call_next):  # type: ignore[no-untyped-def]
        correlation_id = _request_id(request)
        raw_length = request.headers.get("content-length")
        if raw_length is not None:
            try:
                content_length = int(raw_length)
            except ValueError:
                response = JSONResponse(status_code=400, content={"detail": "Requête invalide"})
            else:
                if content_length < 0:
                    response = JSONResponse(status_code=400, content={"detail": "Requête invalide"})
                elif content_length > MAX_BODY_BYTES:
                    response = JSONResponse(status_code=413, content={"detail": "Corps trop volumineux"})
                else:
                    response = await call_next(request)
        else:
            response = await call_next(request)

        response.headers["X-Request-ID"] = correlation_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        log_event(
            app_logger,
            logging.INFO,
            "request_completed",
            correlation_id=correlation_id,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
        )
        return response

    @application.get("/health/live", response_model=HealthResponse)
    async def live() -> HealthResponse:
        return HealthResponse(status="alive")

    @application.get("/health/ready", response_model=HealthResponse)
    async def ready() -> HealthResponse:
        return HealthResponse(status="ready")

    @application.get(
        "/internal/v1/status",
        response_model=StatusResponse,
        dependencies=[Depends(require_internal_token)],
    )
    async def internal_status(request: Request) -> StatusResponse:
        return _status_response(request.app.state.store.read(), request.app.state.settings)

    # =========================================================================================
    # CRM-052 — le test de connexion d'un compte entrant
    # =========================================================================================
    #
    # LA ROUTE EST `def` ET NON `async def`, DÉLIBÉRÉMENT. Elle enchaîne trois entrées/sorties
    # bloquantes — lecture PostgREST, session IMAP, écriture PostgREST — et FastAPI exécute une
    # route synchrone dans un fil séparé. Écrite `async`, elle gèlerait la boucle d'événements
    # pendant tout le test, donc les sondes de santé du §12.3.
    #
    # AUCUN IDENTIFIANT NE SORT DANS LES JOURNAUX (§8) : le service journalise l'identifiant du
    # compte et le code, jamais le nom d'utilisateur, jamais l'hôte, jamais le texte du serveur.
    @application.post(
        "/internal/v1/inbound-accounts/{account_id}/test",
        response_model=ConnectionTestResponse,
        dependencies=[Depends(require_internal_token)],
    )
    def test_inbound_account(request: Request, account_id: UUID) -> ConnectionTestResponse:
        settings_courants: Settings = request.app.state.settings
        client = PostgrestClient(
            settings_courants.SUPABASE_URL,
            settings_courants.SERVICE_ROLE_KEY.get_secret_value(),
        )

        try:
            identifiants = client.read_credentials(str(account_id))
        except PostgrestError as erreur:
            log_event(
                app_logger,
                logging.ERROR,
                "inbound_account_lookup_failed",
                account_id=str(account_id),
                postgrest_status=erreur.status_code,
            )
            raise HTTPException(status_code=502, detail="Base indisponible") from None

        # « Ce compte n'existe pas » est une réponse, pas une panne — et un 404 la dit sans
        # révéler si l'identifiant a jamais existé.
        if identifiants is None:
            raise HTTPException(status_code=404, detail="Not Found")

        # Un compte sans secret ne peut pas être éprouvé. Le cas ne devrait pas exister — la
        # fonction d'écriture refuse un compte neuf sans mot de passe —, et le taire ferait
        # rendre `auth_failed` pour une cause qui n'est pas celle-là.
        if identifiants.password is None:
            raise HTTPException(status_code=409, detail="Secret absent")

        verdict = probe_inbound_account(
            host=identifiants.host,
            port=identifiants.port,
            security=identifiants.security,
            username=identifiants.username,
            password=identifiants.password,
            timeout=settings_courants.MAIL_SYNC_IMAP_TIMEOUT_SECONDS,
        )
        etat = "ok" if verdict.ok else "error"

        try:
            horodatage = client.record_check(str(account_id), etat, verdict.error)
        except PostgrestError as erreur:
            log_event(
                app_logger,
                logging.ERROR,
                "inbound_account_record_failed",
                account_id=str(account_id),
                postgrest_status=erreur.status_code,
            )
            raise HTTPException(status_code=502, detail="Base indisponible") from None

        log_event(
            app_logger,
            logging.INFO,
            "inbound_account_checked",
            account_id=str(account_id),
            status=etat,
            error=verdict.error,
        )
        return ConnectionTestResponse(
            account_id=account_id,
            status=etat,
            error=verdict.error,
            folders=verdict.folders,
            checked_at=str(horodatage),
        )

    # =========================================================================================
    # CRM-053 — le test de connexion d'une identité sortante
    # =========================================================================================
    #
    # Même forme que la route entrante, et même motif pour le `def` : trois entrées/sorties
    # bloquantes. Le DÉLAI, lui, est propre au SMTP — trente secondes, parce que le serveur
    # applique un délai de pénalité de dix secondes sur un échec d'authentification, et qu'un
    # réglage plus court rapporterait un mot de passe faux comme un `timeout` (décision 318).
    @application.post(
        "/internal/v1/outbound-identities/{identity_id}/test",
        response_model=ConnectionTestResponse,
        dependencies=[Depends(require_internal_token)],
    )
    def test_outbound_identity(request: Request, identity_id: UUID) -> ConnectionTestResponse:
        settings_courants: Settings = request.app.state.settings
        client = PostgrestClient(
            settings_courants.SUPABASE_URL,
            settings_courants.SERVICE_ROLE_KEY.get_secret_value(),
        )

        try:
            identifiants = client.read_outbound_credentials(str(identity_id))
        except PostgrestError as erreur:
            log_event(
                app_logger,
                logging.ERROR,
                "outbound_identity_lookup_failed",
                identity_id=str(identity_id),
                postgrest_status=erreur.status_code,
            )
            raise HTTPException(status_code=502, detail="Base indisponible") from None

        if identifiants is None:
            raise HTTPException(status_code=404, detail="Not Found")
        if identifiants.password is None:
            raise HTTPException(status_code=409, detail="Secret absent")

        verdict = probe_outbound_identity(
            host=identifiants.host,
            port=identifiants.port,
            security=identifiants.security,
            username=identifiants.username,
            password=identifiants.password,
            timeout=settings_courants.MAIL_SYNC_SMTP_TIMEOUT_SECONDS,
        )
        etat = "ok" if verdict.ok else "error"

        try:
            horodatage = client.record_outbound_check(str(identity_id), etat, verdict.error)
        except PostgrestError as erreur:
            log_event(
                app_logger,
                logging.ERROR,
                "outbound_identity_record_failed",
                identity_id=str(identity_id),
                postgrest_status=erreur.status_code,
            )
            raise HTTPException(status_code=502, detail="Base indisponible") from None

        log_event(
            app_logger,
            logging.INFO,
            "outbound_identity_checked",
            identity_id=str(identity_id),
            status=etat,
            error=verdict.error,
        )
        return ConnectionTestResponse(
            account_id=identity_id,
            status=etat,
            error=verdict.error,
            folders=verdict.folders,
            checked_at=str(horodatage),
        )

    # =========================================================================================
    # CRM-054 — la relève d'un compte
    # =========================================================================================
    #
    # LA RELÈVE EST EXPLICITE, ET C'EST UN CHOIX ASSUMÉ pour cette unité : elle est déclenchée par
    # l'API interne, ce qui la rend observable et rejouable. La veille permanente — IDLE, mesuré
    # disponible APRÈS authentification (§15.1) — et la reprise appartiennent à `CRM-059`, qui
    # porte la résilience et la supervision.
    #
    # ELLE EST IDEMPOTENTE : le dédoublonnage est tenu par la base, et rejouer une relève n'ajoute
    # aucun message. C'est ce qui permet à la preuve de tourner deux fois sans nettoyage.
    @application.post(
        "/internal/v1/inbound-accounts/{account_id}/poll",
        response_model=ReleveResponse,
        dependencies=[Depends(require_internal_token)],
    )
    def poll_inbound_account(request: Request, account_id: UUID) -> ReleveResponse:
        settings_courants: Settings = request.app.state.settings
        client = PostgrestClient(
            settings_courants.SUPABASE_URL,
            settings_courants.SERVICE_ROLE_KEY.get_secret_value(),
            timeout=60.0,
        )

        try:
            compte = client.read_credentials(str(account_id))
        except PostgrestError as erreur:
            log_event(
                app_logger,
                logging.ERROR,
                "inbound_poll_lookup_failed",
                account_id=str(account_id),
                postgrest_status=erreur.status_code,
            )
            raise HTTPException(status_code=502, detail="Base indisponible") from None

        if compte is None:
            raise HTTPException(status_code=404, detail="Not Found")
        if compte.password is None:
            raise HTTPException(status_code=409, detail="Secret absent")

        dossiers = client.lire_dossiers_surveilles(str(account_id))

        try:
            resultat = relever_compte(
                journal=lambda evenement, **details: log_event(
                    app_logger, logging.WARNING, evenement, **details
                ),
                client_base=client,
                compte=compte,
                workspace_id=compte.workspace_id,
                dossiers=dossiers,
                clamav_hote=settings_courants.CLAMAV_HOST,
                clamav_port=settings_courants.CLAMAV_PORT,
                taille_max_octets=settings_courants.MAIL_MAX_ATTACHMENT_MB * 1024 * 1024,
                timeout=settings_courants.MAIL_SYNC_IMAP_TIMEOUT_SECONDS,
            )
        except PostgrestError as erreur:
            log_event(
                app_logger,
                logging.ERROR,
                "inbound_poll_write_failed",
                account_id=str(account_id),
                postgrest_status=erreur.status_code,
            )
            raise HTTPException(status_code=502, detail="Base indisponible") from None
        except Exception:  # noqa: BLE001
            # UNE RELÈVE QUI ÉCHOUE NE MENT PAS : elle rend 502, et le journal porte le type de la
            # panne sans son texte — celui-ci peut contenir un identifiant de connexion.
            log_event(
                app_logger,
                logging.ERROR,
                "inbound_poll_failed",
                account_id=str(account_id),
            )
            raise HTTPException(status_code=502, detail="Relève impossible") from None

        log_event(
            app_logger,
            logging.INFO,
            "inbound_account_polled",
            account_id=str(account_id),
            messages_new=resultat.messages_nouveaux,
            attachments_infected=resultat.pieces_infectees,
            filed=resultat.dossiers_crees,
            filed_retried=resultat.rangements_repris,
            renamed=resultat.dossiers_renommes,
        )
        return ReleveResponse(
            account_id=account_id,
            folders=resultat.dossiers,
            messages_seen=resultat.messages_vus,
            messages_new=resultat.messages_nouveaux,
            messages_classified=resultat.messages_classes,
            occurrences=resultat.occurrences,
            attachments=resultat.pieces,
            attachments_infected=resultat.pieces_infectees,
            filed=resultat.dossiers_crees,
            filed_retried=resultat.rangements_repris,
            renamed=resultat.dossiers_renommes,
        )

    # --- Envoi sortant — `CRM-058` ------------------------------------------------------------
    #
    # ELLE EST DÉCLENCHÉE, COMME LA RELÈVE, et pour la même raison : une boucle permanente demande
    # une supervision, un état visible et une reprise, que `CRM-059` revendique. Déclenchée, elle
    # est observable et rejouable — ce qu'une preuve peut mesurer.
    #
    # ELLE EST IDEMPOTENTE PAR CONSTRUCTION : la réservation `sending` est faite par la BASE dans
    # la même instruction que la lecture, si bien qu'une seconde passe ne reprend pas un envoi en
    # cours. Un envoi déjà `sent` n'est pas archivé deux fois.
    @application.post(
        "/internal/v1/outbox/flush",
        response_model=EnvoiResponse,
        dependencies=[Depends(require_internal_token)],
    )
    def flush_outbox(request: Request, limit: int = 10) -> EnvoiResponse:
        settings_courants: Settings = request.app.state.settings
        client = PostgrestClient(
            settings_courants.SUPABASE_URL,
            settings_courants.SERVICE_ROLE_KEY.get_secret_value(),
            timeout=60.0,
        )

        try:
            resultat = vider_la_file(
                client,
                limite=max(1, min(limit, 100)),
                delai=settings_courants.MAIL_SYNC_SMTP_TIMEOUT_SECONDS,
                journal=lambda evenement, details: log_event(
                    app_logger, logging.INFO, evenement, **details
                ),
            )
        except PostgrestError as erreur:
            log_event(
                app_logger,
                logging.ERROR,
                "outbox_flush_failed",
                postgrest_status=erreur.status_code,
            )
            raise HTTPException(status_code=502, detail="Base indisponible") from None

        log_event(
            app_logger,
            logging.INFO,
            "outbox_flushed",
            reserved=resultat.reserves,
            sent=resultat.envoyes,
            failed=resultat.echoues,
            rescheduled=resultat.reprogrammes,
        )
        return EnvoiResponse(
            reserved=resultat.reserves,
            sent=resultat.envoyes,
            failed=resultat.echoues,
            rescheduled=resultat.reprogrammes,
            orphans=resultat.orphelins,
        )

    @application.get(
        "/internal/v1/dev/checkpoint",
        response_model=CheckpointResponse,
        dependencies=[Depends(require_dev_internal_token)],
    )
    async def get_checkpoint(request: Request) -> CheckpointResponse:
        state = request.app.state.store.read()
        return CheckpointResponse(checkpoint=state.dev_checkpoint)

    @application.put(
        "/internal/v1/dev/checkpoint",
        response_model=CheckpointResponse,
        dependencies=[Depends(require_dev_internal_token)],
    )
    async def put_checkpoint(request: Request, body: CheckpointRequest) -> CheckpointResponse:
        state = request.app.state.store.set_dev_checkpoint(body.checkpoint)
        return CheckpointResponse(checkpoint=state.dev_checkpoint)

    return application

