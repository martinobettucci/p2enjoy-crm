#!/usr/bin/env bash
# @spec CRM-158 (docs/BACKLOG.md) — la supervision dit si la file d'envoi vieillit : la requête et le jugement du contrôle 10
#       de `scripts/spark/verifier.sh`, partagés avec leur preuve locale `scripts/verify-file-envoi.sh`
#       (docs/SPEC-mail-subsystem.md §34.6 ; docs/PROD_MIGRATIONS.md §2.63 ; docs/JOURNAL.md décision 954)
#
# LECTURE SEULE : une seule instruction `select`, qui compte et date ; elle ne nomme ni un objet ni un destinataire.
#
# Ce qu'elle mesure, et pourquoi ces seuils :
#   - les envois `queued` DUS depuis plus de cinq minutes. La boucle d'envoi passe toutes les trente secondes, et un envoi
#     au-delà du quota passe aussitôt `failed` : un envoi dû qui vieillit dit que la boucle ne tourne pas, ou ne suit plus ;
#   - les envois `sending` réservés depuis plus de quinze minutes : la reprise des orphelins (§20.4) les rend à la file
#     après dix minutes, à la passe suivante. Au-delà, elle ne tourne pas non plus.

# La requête, sur l'entrée standard de `psql -qtAX` : une ligne « dus|orphelins|âge en secondes du plus ancien dû ».
file_envoi_requete() {
	cat <<'SQL'
select
	(select count(*) from public.mail_outbox where status = 'queued' and next_attempt_at < now() - interval '5 minutes'),
	(select count(*) from public.mail_outbox where status = 'sending' and reserved_at < now() - interval '15 minutes'),
	coalesce((select extract(epoch from now() - min(next_attempt_at))::bigint
	            from public.mail_outbox where status = 'queued' and next_attempt_at < now() - interval '5 minutes'), 0);
SQL
}

# file_envoi_juger <ligne rendue par la requête> : écrit le constat, et rend 0 si la file est à jour, 1 sinon.
file_envoi_juger() {
	local dus orphelins age
	IFS='|' read -r dus orphelins age <<< "$1"
	if ! [[ "$dus" =~ ^[0-9]+$ && "$orphelins" =~ ^[0-9]+$ && "$age" =~ ^[0-9]+$ ]]; then
		printf "file d'envoi illisible : « %s »\n" "$1"
		return 1
	fi
	if [ "$dus" = 0 ] && [ "$orphelins" = 0 ]; then
		printf "file d'envoi à jour : aucun envoi dû depuis plus de cinq minutes, aucun orphelin\n"
		return 0
	fi
	printf "file d'envoi qui vieillit : %s envoi(s) dû(s) depuis plus de cinq minutes (le plus ancien depuis %s min), %s orphelin(s) réservé(s) depuis plus de quinze minutes — la boucle d'envoi de mail-sync tourne-t-elle ?\n" \
		"$dus" "$((age / 60))" "$orphelins"
	return 1
}
