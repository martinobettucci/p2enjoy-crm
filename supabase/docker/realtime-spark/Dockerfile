# @spec CRM-090 (docs/BACKLOG.md) — image Realtime dérivée pour la cellule Spark
# @spec docs/SPEC-deploiement-spark.md §3.5 (identifiants subordonnés de la cellule)
# @spec docs/JOURNAL.md décisions 571 et 575
#
# La cellule est elle-même un conteneur non privilégié : elle ne dispose que de 65 536 UID, et le
# compte `spark-docker` n'en reçoit que 64 534 comme identifiants subordonnés (1002 à 65535). Un
# identifiant supérieur à 64534 n'y a aucune représentation — MESURÉ, deux fois :
#   - `supabase/realtime:v2.102.3` attribue 3 772 fichiers de `/app` à `nobody` (65534), et son
#     tirage échoue en « failed to Lchown … for UID 65534 » (décision 571) ;
#   - son `run.sh` lance les migrations par `sudo -E -u nobody` : même extraite, l'image redémarre
#     en boucle sur « sudo: unable to change to runas gid: Invalid argument » (décision 575).
#
# Cette image renumérote donc `nobody` et `nogroup` de 65534 en NOBODY_ID, dans la plage, puis
# rend à `nobody` ce qu'il possédait — `/app`, où la release écrit à l'exécution. Rien d'autre ne
# change : même contenu, même configuration d'exécution, recopiés dans UNE couche, la seule forme
# qu'un `docker load` dans la cellule accepte. Les points de montage du conteneur de construction
# (`/proc`, `/sys`, `/dev`) sont écartés : ils n'appartiennent pas à l'image, et le noyau refuse
# d'en changer le propriétaire.
#
# Construite sur le poste qui livre, jamais dans la cellule, où l'extraction de l'image source
# échouerait : `scripts/spark/livrer.sh` la construit et la transfère.

FROM supabase/realtime:v2.102.3 AS source
ARG NOBODY_ID=64000
RUN sed -i -e "s/^\([^:]*:[^:]*:\)65534:/\1${NOBODY_ID}:/" \
           -e "s/^\([^:]*:[^:]*:[0-9]*:\)65534:/\1${NOBODY_ID}:/" /etc/passwd \
 && sed -i -e "s/^\([^:]*:[^:]*:\)65534:/\1${NOBODY_ID}:/" /etc/group \
 && find / -xdev \( -path /proc -o -path /sys -o -path /dev \) -prune \
         -o -uid 65534 -exec chown -h "${NOBODY_ID}" {} + \
 && find / -xdev \( -path /proc -o -path /sys -o -path /dev \) -prune \
         -o -gid 65534 -exec chgrp -h "${NOBODY_ID}" {} +

FROM scratch
COPY --from=source / /

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    SLOT_NAME_SUFFIX= \
    LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    MIX_ENV=prod \
    ECTO_IPV6=true \
    ERL_AFLAGS="-proto_dist inet6_tcp"
WORKDIR /app
ENTRYPOINT ["/usr/bin/tini", "-s", "-g", "--", "/app/run.sh"]
CMD ["/app/bin/server"]
