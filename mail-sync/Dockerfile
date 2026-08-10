# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.1 et §12.4,
# docs/DAT.md §3.3 — image épinglée, utilisateur non privilégié et volume opérationnel.

FROM python:3.13.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/src

RUN groupadd --gid 10001 mail-sync \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mail-sync \
    && install -d -o 10001 -g 10001 -m 0700 /var/lib/p2enjoy-mail-sync

WORKDIR /app

COPY mail-sync/requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --requirement /app/requirements.txt

COPY mail-sync/src /app/src

USER 10001:10001

EXPOSE 8080

CMD ["python", "-m", "mail_sync"]
