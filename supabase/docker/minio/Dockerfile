# @spec CRM-001 (docs/BACKLOG.md) — le stockage S3 local de la pile de développement (MinIO et son client)
# @spec docs/INCONSISTENCY_REPORT.md INC-290, docs/JOURNAL.md décision 679 — les dépôts MinIO de `quay.io` refusent le
#       tirage anonyme (`401`) : le développement construit ses deux images depuis une base qui porte le même binaire
# @spec docs/DAT.md §3.6 (composants de développement uniquement), §3.7 (versions épinglées)
#
# `bitnamilegacy/minio:2025.4.22` porte la publication MinIO du 2025-04-22, celle que `quay.io` publiait sous
# `RELEASE.2025-04-22T22-12-26Z` : `minio --version` y rend `commit-id=0d7408fc9969caf07de6a8c3a84f9fbb10a6739e`
# (mesuré, INC-290). Elle porte aussi le client `mc`. Épinglée par son empreinte.
#
# Deux cibles, une par service de `docker-compose.dev.yml` : `minio` (le serveur) et `mc` (le client qui crée le
# bucket). Les liens rendent `minio` et `mc` atteignables sous `/usr/bin`, comme dans les images de `quay.io`, dont la
# composition et `scripts/verify-stack.sh` attendent ces noms. L'utilisateur est `root`, comme dans ces images : le
# volume `minio-data` existant leur appartient.
#
# DETTE CONNUE (docs/DAT.md §3.7) : `bitnamilegacy` est un dépôt gelé, sans mises à jour de sécurité. C'est acceptable
# pour un stockage de développement lié à la boucle locale ; la production (`docker-compose.spark.yml`) n'est pas
# concernée par ce fichier.

FROM bitnamilegacy/minio:2025.4.22@sha256:50cec18ac4184af4671a78aedd5554942c8ae105d51a465fa82037949046da01 AS base
USER root
RUN ln -sf /opt/bitnami/minio/bin/minio /usr/bin/minio \
	&& ln -sf /opt/bitnami/minio-client/bin/mc /usr/bin/mc

FROM base AS minio
ENTRYPOINT ["minio"]

FROM base AS mc
ENTRYPOINT ["mc"]
