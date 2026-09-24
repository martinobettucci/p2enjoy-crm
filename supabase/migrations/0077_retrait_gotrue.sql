-- @spec CRM-092 (docs/BACKLOG.md) — tranche T6 : GoTrue quitte la pile, son trigger avec lui
-- @spec docs/SPEC-session-sso.md §2 (ce qui est retiré), §7.5 (cette migration), §15 (tables inertes)
-- @spec docs/SCHEMA.md §1 (socle d'identité : un profil naît d'un `sub` LeLabs)
-- @spec docs/JOURNAL.md décision 589 (faits mesurés avant le retrait, et sa correction)
--
-- Plus rien n'écrit dans `auth.users` : le CRM ne crée plus aucun compte, et GoTrue ne tourne plus.
-- Le trigger `on_auth_user_created`, posé par `0001`, ne se déclencherait donc plus jamais ; le garder
-- laisserait croire qu'un compte GoTrue crée encore un profil. Un profil naît désormais de la
-- première connexion LeLabs admise, par `public.ouvrir_session_sso` (`0075`).
--
-- MIGRATION ORDINAIRE, NON ÉLEVÉE — MESURÉ (décision 589, correction). `auth.users` appartient à
-- `supabase_auth_admin`, dont `postgres` n'est pas membre ; `postgres` retire pourtant ce trigger, et
-- `0001` le fait déjà à chaque passage du runner. Aucun motif d'élévation n'existe (décision 363).
--
-- IDEMPOTENTE. Le runner rejoue tout le répertoire : à chaque passage, `0001` repose le trigger et la
-- fonction, et ce fichier les retire. L'état final est constant ; `0001`, appliquée en production,
-- n'est pas réécrite.
--
-- ELLE NE SUPPRIME RIEN D'AUTRE. Les tables du schéma `auth` restent, inertes : les supprimer est une
-- opération destructive distincte, hors de `CRM-092` (docs/SPEC-session-sso.md §15).

drop trigger if exists on_auth_user_created on auth.users;

drop function if exists app.handle_new_user();
