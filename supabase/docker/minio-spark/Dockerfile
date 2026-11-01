# @spec CRM-090 (docs/BACKLOG.md) — INC-329 : image MinIO dérivée pour la cellule Spark
# @spec docs/SPEC-deploiement-spark.md §3.5 (identifiants subordonnés de la cellule)
# @spec docs/JOURNAL.md décisions 571, 681 et 794 ; docs/INCONSISTENCY_REPORT.md INC-329
#
# La cellule ne représente aucun identifiant supérieur à 64534 (voir l'image Realtime dérivée, décision 571). L'image de
# Chainguard qu'épingle le développement (décision 681) attribue `/home/nonroot` et son contenu à `nonroot` (65532) :
# MESURÉ le 2026-11-01, son tirage dans la cellule échoue en « failed to Lchown … for UID 65532 » (INC-329).
#
# L'image est sans `find` ni `sed` : la renumérotation se fait donc sur une COPIE de sa racine, dans une étape utilitaire
# Alpine épinglée. `nonroot` y passe de 65532 en NONROOT_ID, dans la plage, et rien d'autre ne change : même contenu, même
# configuration d'exécution, recopiés dans UNE couche, la seule forme qu'un `docker load` dans la cellule accepte. Les deux
# services de la cellule tournent de toute façon en `0:0` (`docker-compose.spark.yml`) ; `USER` suit la renumérotation.
#
# Construite sur le poste qui livre, jamais dans la cellule : `scripts/spark/livrer.sh` la construit et la transfère.

FROM cgr.dev/chainguard/minio@sha256:73297936408b731668ca0e835ac9add1a35cb6026a125c2f0cd476d9ef48222c AS source

FROM alpine:3.21@sha256:ce64758a109eb420d874a118f87920e625e12d3634e03b4a5573fd9f6e5d3507 AS renumerotation
ARG NONROOT_ID=64532
COPY --from=source / /racine/
RUN sed -i -e "s/^\([^:]*:[^:]*:\)65532:/\1${NONROOT_ID}:/" \
           -e "s/^\([^:]*:[^:]*:[0-9]*:\)65532:/\1${NONROOT_ID}:/" /racine/etc/passwd \
 && sed -i -e "s/^\([^:]*:[^:]*:\)65532:/\1${NONROOT_ID}:/" /racine/etc/group \
 && find /racine -user 65532 -exec chown -h "${NONROOT_ID}" {} + \
 && find /racine -group 65532 -exec chgrp -h "${NONROOT_ID}" {} +

FROM scratch
COPY --from=renumerotation /racine/ /

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/bin \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
USER 64532
ENTRYPOINT ["/usr/bin/minio"]
