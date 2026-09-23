# @spec CRM-090 (docs/BACKLOG.md) — image Realtime dérivée pour la cellule Spark
# @spec docs/SPEC-deploiement-spark.md §3.5 (identifiants subordonnés de la cellule)
# @spec docs/JOURNAL.md décision 571
#
# La cellule est elle-même un conteneur non privilégié : elle ne dispose que de 65 536 UID, et le
# compte `spark-docker` n'en reçoit que 64 534 comme identifiants subordonnés (1002 à 65535). Un
# fichier d'image possédé par un UID supérieur à 64534 ne peut donc pas y être extrait — MESURÉ :
# `supabase/realtime:v2.102.3` porte 3 774 fichiers de `/app` possédés par `nobody` (65534), et son
# tirage échoue en « failed to Lchown … for UID 65534 ».
#
# Le processus de Realtime s'exécute en `root` (l'image ne déclare aucun `USER`) : la propriété de
# `nobody` ne lui sert à rien. Cette image recopie le système de fichiers d'origine dans UNE couche,
# possédée par `root`, et redéclare la configuration d'exécution à l'identique. Aucune couche de
# l'image d'origine n'y subsiste : c'est la seule forme qu'un `docker load` dans la cellule accepte.
#
# Construite sur le poste qui livre, jamais dans la cellule, où l'extraction de l'image source
# échouerait de la même façon : `scripts/spark/livrer.sh` la construit et la transfère.

FROM supabase/realtime:v2.102.3 AS source

FROM scratch
COPY --from=source --chown=0:0 / /

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
