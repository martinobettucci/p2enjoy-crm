-- @spec CRM-161 (docs/BACKLOG.md) — tranche T3.d : le plafond journalier de la saisie du temps compte TOUS les espaces de la
--       personne, pour la grille de Temps ▸ Saisie qui couvre tous les espaces lus
-- @spec docs/SPEC-espace-courant.md §16.9.3, §16.6 (Q2) ; docs/SPEC-temps.md §2 (plafond de 420 minutes par personne et par
--       date) ; docs/SCHEMA.md « Migration `0203` » ; docs/SPEC-permissions-rls.md §7 ; décisions 981 et 989
--
-- POURQUOI : jusqu'à la `0197`, le déclencheur sérialisait et sommait PAR ESPACE (clé `workspace_id:profile_id:jour`) : une
-- personne de deux espaces pouvait saisir 420 minutes dans chacun le même jour. La décision 981 fait de la grille de saisie
-- une grille de tous les espaces, dont les totaux par jour sont ceux de la personne, tous espaces confondus ; le plafond
-- doit donc compter de même, sans quoi la grille annoncerait une journée trop longue que la base laisserait passer.
--
-- CE QUI CHANGE : le verrou consultatif ne porte plus l'espace (deux écritures d'une même personne, un même jour, dans deux
-- espaces, se sérialisent) ; la somme compte les saisies de la personne ce jour-là dans tous les espaces. La fonction reste
-- `SECURITY DEFINER` : elle voit les saisies d'un espace que l'auteur de l'écriture ne lit pas — un administrateur qui saisit
-- pour un collègue. Le refus garde son message, `plafond journalier` (le contrat de la webapp et du connecteur) ; **son
-- détail ne dit plus les minutes déjà saisies**, qui compteraient des espaces que l'auteur ne lit pas peut-être (décision
-- 989 : le refus ne dit ni la quantité ni l'espace).
--
-- CE QUI NE CHANGE PAS : la signature, le déclencheur (`saisies_temps_plafond`, avant insertion et avant la mise à jour des
-- minutes), la forme des minutes laissée à `saisies_temps_minutes_check`, le drapeau du déplacement d'un track
-- (`app.track_move`, décision 969), les droits.
--
-- Retour arrière : rejouer la définition de la `0197` (`create or replace function app.saisies_temps_plafond()`).

create or replace function app.saisies_temps_plafond()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	deja integer;
begin
	-- `CRM-162` (décision 969) : sous le drapeau du déplacement d'un track, que seule `public.move_track` pose pour sa
	-- transaction, cette garde laisse passer ; le déplacement écrit son propre événement.
	if pg_catalog.current_setting('app.track_move', true) = 'on' then
		return case when tg_op = 'DELETE' then old else new end;
	end if;
	-- Une valeur hors de la forme du §2 est laissée à la contrainte `saisies_temps_minutes_check`, plus précise.
	if new.minutes is null or new.minutes <= 0 or new.minutes > 420 or new.minutes % 15 <> 0 then
		return new;
	end if;
	-- `CRM-161` T3.d (décisions 981 et 989) : une personne et un jour, TOUS ESPACES CONFONDUS.
	perform pg_advisory_xact_lock(
		hashtextextended('saisies_temps:' || new.profile_id::text || ':' || new.jour::text, 0));
	select coalesce(sum(s.minutes), 0) into deja
	  from public.saisies_temps s
	 where s.profile_id = new.profile_id
	   and s.jour = new.jour
	   and s.id <> new.id;
	if deja + new.minutes > 420 then
		raise exception 'plafond journalier' using errcode = 'P0001',
			detail = 'la journée de cette personne dépasserait 420 minutes';
	end if;
	return new;
end;
$function$;

comment on function app.saisies_temps_plafond() is
	'CRM-098 — docs/SPEC-temps.md §2 ; CRM-161 T3.d — docs/SPEC-espace-courant.md §16.9.3. Le plafond de 420 minutes par '
	'personne et par date, TOUS ESPACES CONFONDUS : le verrou et la somme portent la personne et le jour, sans l''espace. '
	'SECURITY DEFINER : la somme voit les saisies d''un espace que l''auteur ne lit pas. Le refus dit `plafond journalier`, '
	'sans minutes ni espace.';
