-- @spec CRM-156 (docs/BACKLOG.md) — tranche T4 : la préférence « Recevoir les transferts de mails » s'écrit par l'unique
--       chemin d'écriture d'une préférence
-- @spec docs/SCHEMA.md « Migration `0191` » ; docs/SPEC-notifications.md §52 (le type `mail_transfer`), §46.3 (la RPC,
--       unique chemin d'écriture, et ses refus nommés) ; docs/DESIGN_SYSTEM.md §5.109 bis, §5.45
--
-- LE DÉFAUT : `0190` a ouvert `mail_transfer` dans les deux `check` fermés (`notifications`, `notification_preferences`),
-- mais `definir_preference_notification` (`0067`) tient sa propre liste, écrite en dur : `p_type not in ('mention')`. La
-- case de l'écran des préférences aurait reçu `preference_type_inconnu`. Trouvé en branchant cette case (T4), prouvé par la
-- pgTAP `0178`, assertions 39 et 40, rouges avant cette migration.
--
-- CE QUI CHANGE : la liste du refus nommé seulement — ('mention', 'mail_transfer'), le miroir des deux `check`. Le reste
-- du corps de `0067` est repris à l'identique. `create or replace` conserve l'ACL ; elle est redite pour qu'une base où la
-- fonction manquerait la reçoive (la leçon du §34.4).
--
-- IDEMPOTENCE : `create or replace`. RETOUR ARRIÈRE : rejouer le corps de `0067` (la liste à « mention » seul) ; les
-- lignes `mail_transfer` déjà écrites restent valides au regard du `check`.

create or replace function public.definir_preference_notification(
	p_type   text,
	p_in_app boolean
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_ligne    public.notification_preferences;
begin
	if v_appelant is null then
		raise exception 'preference_sans_session'
			using errcode = 'P0001',
			      hint    = 'Cette RPC écrit la préférence de l''appelant : elle exige une session.';
	end if;

	-- LA LISTE FERMÉE, MIROIR DES DEUX `check` (§13.3, `0190`) ; la contrainte reste le second refus.
	if p_type is null or p_type not in ('mention', 'mail_transfer') then
		raise exception 'preference_type_inconnu'
			using errcode = 'P0001',
			      hint    = 'Les types de notification produits sont « mention » et « mail_transfer ».';
	end if;

	if p_in_app is null then
		raise exception 'preference_valeur_absente'
			using errcode = 'P0001',
			      hint    = 'Une préférence vaut vrai ou faux ; l''absence de ligne vaut vrai (§43.4).';
	end if;

	insert into public.notification_preferences (profile_id, type, in_app)
	values (v_appelant, p_type, p_in_app)
	on conflict on constraint notification_preferences_pkey
		do update set in_app = excluded.in_app
	returning * into v_ligne;

	return v_ligne;
end;
$$;

alter function public.definir_preference_notification(text, boolean) owner to postgres;

comment on function public.definir_preference_notification(text, boolean) is
	'CRM-064 — docs/SPEC-notifications.md §46.3 ; CRM-156 T4 (migration 0191) : la liste fermée porte « mention » et '
	'« mail_transfer ». UNIQUE chemin d''écriture d''une préférence. SECURITY DEFINER par NÉCESSITÉ. Le DESTINATAIRE '
	'N''EST PAS UN PARAMÈTRE : la fonction lit `auth.uid()`. Idempotente, elle rend la LIGNE RETENUE.';

revoke all on function public.definir_preference_notification(text, boolean) from public, anon;
grant execute on function public.definir_preference_notification(text, boolean) to authenticated, service_role;
