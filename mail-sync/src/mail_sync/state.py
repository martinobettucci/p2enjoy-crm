# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.4 — état opérationnel
# versionné, écriture atomique et refus de corruption ; la portée couvre tout le stockage local.

from __future__ import annotations

import os
import tempfile
import threading
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class StateError(RuntimeError):
    """Signale un état durable absent du contrat sans en révéler le contenu."""


class RuntimeState(BaseModel):
    """Seul schéma autorisé dans le volume opérationnel."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    boot_count: int = Field(ge=1)
    boot_id: UUID
    dev_checkpoint: UUID | None = None


class StateStore:
    """Accès synchronisé à l'état, avec remplacement durable dans le même répertoire."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._state: RuntimeState | None = None
        self._lock = threading.RLock()

    @property
    def path(self) -> Path:
        return self._path

    def start(self) -> RuntimeState:
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            previous = self._read_existing()
            state = RuntimeState(
                boot_count=1 if previous is None else previous.boot_count + 1,
                boot_id=uuid4(),
                dev_checkpoint=None if previous is None else previous.dev_checkpoint,
            )
            self._write_atomic(state)
            self._state = state
            return state.model_copy(deep=True)

    def read(self) -> RuntimeState:
        with self._lock:
            if self._state is None:
                raise StateError("runtime state is not initialized")
            return self._state.model_copy(deep=True)

    def set_dev_checkpoint(self, checkpoint: UUID) -> RuntimeState:
        with self._lock:
            current = self.read()
            updated = current.model_copy(update={"dev_checkpoint": checkpoint})
            self._write_atomic(updated)
            self._state = updated
            return updated.model_copy(deep=True)

    def _read_existing(self) -> RuntimeState | None:
        if not self._path.exists():
            return None
        try:
            raw = self._path.read_text(encoding="utf-8")
            return RuntimeState.model_validate_json(raw, strict=True)
        except (OSError, UnicodeError, ValidationError, ValueError) as error:
            raise StateError("runtime state is invalid") from error

    def _write_atomic(self, state: RuntimeState) -> None:
        data = (state.model_dump_json() + "\n").encode("utf-8")
        descriptor = -1
        temporary_path: str | None = None
        try:
            descriptor, temporary_path = tempfile.mkstemp(
                prefix=".runtime-",
                suffix=".tmp",
                dir=self._path.parent,
            )
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as handle:
                descriptor = -1
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self._path)
            temporary_path = None

            directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
            directory_descriptor = os.open(self._path.parent, directory_flags)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
        except OSError as error:
            raise StateError("runtime state could not be persisted") from error
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            if temporary_path is not None:
                try:
                    os.unlink(temporary_path)
                except FileNotFoundError:
                    pass

