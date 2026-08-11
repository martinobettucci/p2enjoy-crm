# @spec CRM-051 (docs/BACKLOG.md), docs/SPEC-mail-subsystem.md §12.1 et §12.4,
# docs/DAT.md §3.3 — image épinglée, utilisateur non privilégié et volume opérationnel.
# @spec CRM-015 (docs/BACKLOG.md), docs/JOURNAL.md décision 280 — même contournement que
#       `webapp/Dockerfile` pour `pip`, derrière un proxy TLS qui interpose son propre certificat.

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

# Le secret `pip_ca` est **facultatif**, même contournement que `npm_ca` dans `webapp/Dockerfile`
# (décision 280) : derrière un proxy HTTPS à certificat interposé, `pip install` échoue en
# `SELF_SIGNED_CERT_IN_CHAIN` tant que l'autorité n'est pas connue du conteneur. Le fichier
# n'entre jamais dans l'image ni dans le dépôt ; sans lui, la construction se déroule normalement.
#
#   docker build --secret id=pip_ca,src=/chemin/vers/ca.crt -f mail-sync/Dockerfile .
RUN --mount=type=secret,id=pip_ca,required=false \
	sh -eu -c 'if [ -s /run/secrets/pip_ca ]; then echo "pip_ca: actif"; export PIP_CERT=/run/secrets/pip_ca; else echo "pip_ca: inactif"; fi; \
	python -m pip install --no-cache-dir --requirement /app/requirements.txt'

COPY mail-sync/src /app/src

USER 10001:10001

EXPOSE 8080

CMD ["python", "-m", "mail_sync"]
