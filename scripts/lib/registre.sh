# shellcheck shell=bash
# @spec CRM-096 (docs/BACKLOG.md) — tranche T3 : les harnais qui restaurent la base par le runner complet
# @spec docs/DAT.md §3.2 bis (le registre, l'adoption) ; docs/SPEC-test-harness.md §3.5 (restauration par
#       le runner complet) ; docs/JOURNAL.md décision 616
#
# Depuis `CRM-096`, un passage du runner n'applique que les fichiers absents du registre
# `app.migrations_appliquees`. Les harnais qui DÉGRADENT la base de développement puis la RESTAURENT en
# relançant le runner (`docs/SPEC-test-harness.md` §3.5) attendent, eux, un rejeu COMPLET : sans ceci,
# leur restauration n'appliquerait rien et laisserait la base dégradée, sans un mot. Vider le registre
# fait du passage suivant une ADOPTION : le répertoire entier est rejoué, puis réinscrit.
#
# RÉSERVÉ AU DÉVELOPPEMENT : refusé si le fichier d'environnement ne porte pas le profil `dev`. En
# production, le registre est la mémoire de ce que la base porte ; rien ne l'y vide.
rejeu_complet_au_prochain_passage() {
	local fichier=${ENV_FILE:-.env} conteneur=${DB_CONTAINER:-p2enjoy-db} profil
	profil=$(sed -n 's/^P2ENJOY_ENV_PROFILE=//p' "$fichier" 2>/dev/null | tr -d "\"'\r")
	if [ "$profil" != dev ]; then
		echo "rejeu_complet_au_prochain_passage : profil « ${profil:-<vide>} » dans $fichier, « dev » exigé — refus." >&2
		return 1
	fi
	# Une base antérieure à la migration 82 n'a pas de registre : son passage est déjà une adoption.
	docker exec -i "$conteneur" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 -c "
		do \$\$
		begin
			if to_regclass('app.migrations_appliquees') is not null then
				delete from app.migrations_appliquees;
			end if;
		end;
		\$\$;" >/dev/null
}
