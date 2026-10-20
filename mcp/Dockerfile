# @spec CRM-102 (docs/BACKLOG.md) — tranches T2 et T3 : l'image du connecteur MCP
# @spec docs/SPEC-mcp.md §2 (un service de la pile), §11 (`/sante`) ; docs/DAT.md §3.7 ter ;
#       modèle : le Dockerfile du connecteur Evoliz (p2enjoy-evoliz, révision 80a3e27), sans l'étape d'interface
#
# Aucune variable de l'application n'est déclarée ici (ENV) : elle reçoit sa configuration de l'environnement
# d'exécution (docs/SPEC-mcp.md §10).
#
# Une seule recette, deux cibles :
#   production — l'image qui part sur la cellule ;
#   dev        — la même, plus pytest et les tests.
#
# Aucune étape apt : les dépendances sont des roues Python pures ou précompilées.
#
# Le secret de construction `pip_ca` est **facultatif**, comme pour `mail-sync` (décision 356) : derrière un proxy
# HTTPS à certificat interposé, `pip` ne joint PyPI qu'avec l'autorité du proxy. Le fichier n'entre jamais dans
# l'image ; sans lui, chaque étape se déroule normalement.
#
#   docker build --secret id=pip_ca,src=/chemin/vers/ca.crt --target dev -t crm-mcp:dev mcp

# Même base, épinglée, que `mail-sync` : une version exacte, et des couches partagées dans la cellule.
FROM python:3.13.13-slim-bookworm AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.lock ./
RUN --mount=type=secret,id=pip_ca,required=false \
    sh -eu -c 'if [ -s /run/secrets/pip_ca ]; then echo "pip_ca: actif"; export PIP_CERT=/run/secrets/pip_ca; else echo "pip_ca: inactif"; fi; \
    pip install --root-user-action=ignore --no-deps -r requirements.lock'

COPY pyproject.toml ./
COPY crm_mcp/ ./crm_mcp/
RUN --mount=type=secret,id=pip_ca,required=false \
    sh -eu -c 'if [ -s /run/secrets/pip_ca ]; then export PIP_CERT=/run/secrets/pip_ca; fi; \
    pip install --root-user-action=ignore --no-deps .'

# --------------------------------------------------------------------------
FROM base AS dev

COPY requirements-dev.lock ./
RUN --mount=type=secret,id=pip_ca,required=false \
    sh -eu -c 'if [ -s /run/secrets/pip_ca ]; then export PIP_CERT=/run/secrets/pip_ca; fi; \
    pip install --root-user-action=ignore -r requirements-dev.lock'
COPY tests/ ./tests/
CMD ["python", "-m", "pytest", "-q"]

# --------------------------------------------------------------------------
FROM base AS production

# Le service ne tourne pas en root ; l'état OAuth chiffré vit dans un volume.
RUN useradd --system --create-home --uid 10001 crm \
    && mkdir -p /var/lib/crm-mcp \
    && chown -R crm:crm /var/lib/crm-mcp
USER crm

EXPOSE 8080

# /sante répond tant que le processus vit. /pret dit en plus si le SSO et le CRM répondent ; il ne sert pas ici, car
# un service momentanément injoignable ne doit pas faire redémarrer la pile en boucle.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/sante', timeout=3).status == 200 else 1)"

CMD ["python", "-m", "crm_mcp"]
