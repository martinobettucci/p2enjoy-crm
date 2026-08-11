# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.2 — configuration centralisée
# et refus au démarrage ; ce commentaire de portée couvre toutes les validations de ce fichier.

from __future__ import annotations

from ipaddress import ip_address
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
EnvironmentProfile = Literal["dev", "prod"]


class ConfigurationError(RuntimeError):
    """Refus de configuration nommant la variable et la règle, jamais la valeur."""


class Settings(BaseSettings):
    """Configuration entièrement issue de l'environnement du processus."""

    model_config = SettingsConfigDict(
        case_sensitive=True,
        extra="ignore",
        frozen=True,
    )

    P2ENJOY_ENV_PROFILE: EnvironmentProfile
    MAIL_SYNC_INTERNAL_TOKEN: SecretStr
    MAIL_SYNC_LOG_LEVEL: LogLevel = "INFO"
    MAIL_SYNC_HOST: str = "0.0.0.0"
    MAIL_SYNC_PORT: int = Field(default=8080, ge=1, le=65535)
    MAIL_SYNC_STATE_PATH: Path = Path("/var/lib/p2enjoy-mail-sync/runtime.json")

    # --- CRM-052 : le service consomme enfin une table mail ------------------------------------
    # `CRM-051` avait écrit que la clé de service appartiendrait « à la première unité qui consomme
    # réellement une table mail » (§12.1). C'est celle-ci, et les deux variables sont OBLIGATOIRES :
    # un service qui démarrerait sans elles offrirait une route de test qui ne peut pas aboutir, et
    # rendrait une erreur de configuration en guise de diagnostic de connexion.
    SUPABASE_URL: str
    SERVICE_ROLE_KEY: SecretStr
    #: Borne d'un test de connexion. Un compte injoignable ne doit pas retenir un appelant plus
    #: longtemps qu'il ne faut pour conclure (§13.5).
    MAIL_SYNC_IMAP_TIMEOUT_SECONDS: float = Field(default=10.0, gt=0, le=120)
    #: TRENTE secondes, et une variable DISTINCTE de celle d'IMAP (décision 318). Stalwart applique
    #: un délai de pénalité de dix secondes sur un échec d'authentification SMTP : réglé sur dix,
    #: le test rapporterait un mot de passe faux comme un `timeout`, et le diagnostic mentirait.
    #: Réutiliser la variable d'IMAP reviendrait à régler un protocole par l'autre.
    MAIL_SYNC_SMTP_TIMEOUT_SECONDS: float = Field(default=30.0, gt=0, le=120)

    # --- CRM-054 : l'ingestion -----------------------------------------------------------------
    CLAMAV_HOST: str = "clamav"
    CLAMAV_PORT: int = Field(default=3310, ge=1, le=65535)
    #: Borne d'ingestion d'une pièce jointe. Le dépassement n'efface RIEN : la pièce est
    #: enregistrée `skipped`, donc non téléchargeable, et reste visible (§4.3).
    MAIL_MAX_ATTACHMENT_MB: int = Field(default=25, ge=1, le=200)

    # --- CRM-059 : la veille ------------------------------------------------------------------
    #: Intervalle de la boucle de veille, en secondes. Déclarée depuis `CRM-051` et lue par RIEN
    #: jusqu'ici (§20.1) : une variable documentée que rien ne lit est une promesse tenue par
    #: personne.
    #:
    #: `0` DÉSACTIVE la veille — ce n'est pas « aussi vite que possible » (§20.10.5). Les bornes
    #: sont portées par `normaliser_intervalle` et non par `Field`, parce que le zéro fait
    #: exception aux deux : `ge=5` refuserait la désactivation, `ge=0` laisserait passer une
    #: scrutation à la seconde. La validation ci-dessous délègue donc à la seule fonction qui
    #: connaît les trois cas.
    MAIL_SYNC_POLL_INTERVAL: int = 60

    @field_validator("MAIL_SYNC_INTERNAL_TOKEN")
    @classmethod
    def token_is_long_enough(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("must contain at least 32 characters")
        return value

    @field_validator("SUPABASE_URL")
    @classmethod
    def supabase_url_is_http(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("must start with http:// or https://")
        return value

    @field_validator("SERVICE_ROLE_KEY")
    @classmethod
    def service_role_key_is_not_empty(cls, value: SecretStr) -> SecretStr:
        # La borne est volontairement basse : ce n'est pas au service de juger de la forme d'un
        # JWT signé ailleurs. Refuser le vide suffit à distinguer « absente » de « fournie ».
        if len(value.get_secret_value().strip()) < 16:
            raise ValueError("must contain at least 16 characters")
        return value

    @field_validator("MAIL_SYNC_POLL_INTERVAL")
    @classmethod
    def poll_interval_is_zero_or_within_bounds(cls, value: int) -> int:
        # L'import est local pour que `config` ne dépende pas de `veille`, qui journalise : la
        # configuration doit pouvoir être refusée avant qu'aucun journal ne soit configuré.
        from mail_sync.veille import normaliser_intervalle

        return normaliser_intervalle(value)

    @field_validator("MAIL_SYNC_HOST")
    @classmethod
    def host_is_an_ip_address(cls, value: str) -> str:
        try:
            ip_address(value)
        except ValueError:
            raise ValueError("must be a valid IP address") from None
        return value

    @field_validator("MAIL_SYNC_STATE_PATH")
    @classmethod
    def state_path_is_absolute_json(cls, value: Path) -> Path:
        if not value.is_absolute():
            raise ValueError("must be an absolute path")
        if value.suffix != ".json":
            raise ValueError("must point to a JSON file")
        return value


def _describe(error: ValidationError) -> str:
    """Ne conserve que le nom de la variable et la règle enfreinte."""

    causes = []
    for detail in error.errors():
        variable = ".".join(str(part) for part in detail["loc"]) or "<configuration>"
        rule = detail["msg"].removeprefix("Value error, ")
        causes.append(f"{variable}: {rule}")
    return "; ".join(causes)


def load_settings(**overrides: object) -> Settings:
    """Charge la configuration ou refuse sans jamais révéler la valeur fautive.

    `ValidationError` reproduit l'entrée dans son texte comme dans sa trace : elle ne peut donc
    pas remonter jusqu'au journal de démarrage, où un jeton refusé deviendrait un secret publié.
    """

    try:
        return Settings(**overrides)  # type: ignore[arg-type]
    except ValidationError as error:
        reason = _describe(error)

    # Le refus est levé hors du gestionnaire : `from None` masquerait l'affichage de la cause,
    # mais la laisserait — avec la valeur fautive — sur `__context__`.
    raise ConfigurationError(reason)

