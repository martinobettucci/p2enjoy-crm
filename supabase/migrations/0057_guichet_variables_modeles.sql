-- @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--       TRANCHE 2, sous-tranche 2b : L'ÉCRAN
-- @spec docs/SPEC-modeles-emails.md §9.3 (la liste fermée proposée au rédacteur, et la MESURE qui
--       impose ce guichet), §9.9 (contrat d'API), §3 (la liste est écrite une seule fois)
-- @spec docs/SCHEMA.md §7 (`mail_templates`) ; docs/PROD_MIGRATIONS.md §3 (migration 57)
-- @spec docs/DESIGN_SYSTEM.md §5.39 (la palette de variables de l'écran)
--
-- CETTE MIGRATION N'AJOUTE AUCUNE TABLE, AUCUNE COLONNE, AUCUNE POLITIQUE ET AUCUNE RÈGLE.
--
-- Elle pose UN GUICHET, et rien d'autre : `public.mail_template_variables()`, qui DÉLÈGUE à
-- `app.mail_template_variables()` posée par la migration `0055`. Aucune liste n'est réécrite ici.
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI CE GUICHET EXISTE — une MESURE, jamais une commodité (§9.3).
-- ---------------------------------------------------------------------------------------------
-- MESURÉ le 2026-08-25 : `PGRST_DB_SCHEMAS` vaut `public,storage,graphql_public`
-- (`docker-compose.yml`, `.env.example`). Le schéma `app` n'est donc PAS exposé, et
-- `app.mail_template_variables()` — source unique du §3 — est hors de portée de l'écran.
-- Mesuré aussi : `to_regprocedure('public.mail_template_variables()')` rendait `NULL`.
--
-- L'AUTRE ISSUE ÉTAIT DE RECOPIER LES DOUZE NOMS EN TYPESCRIPT, ET ELLE EST ÉCARTÉE. Le §3 pose
-- que la liste est écrite une seule fois « parce qu'écrire la liste deux fois serait garantir
-- qu'elles divergent ». Une treizième variable ajoutée au §2.4 laisserait la palette de l'écran
-- muette sur elle, sans qu'aucune preuve ne le voie : la contrainte l'accepterait, le rendu la
-- substituerait, et seule l'interface l'ignorerait.
--
-- UNE ASSERTION pgTAP COMPARE LES DEUX FONCTIONS ET EXIGE LEUR ÉGALITÉ, jamais leurs seuls
-- cardinaux : c'est cette assertion qui rend la délégation vérifiable, et sans elle le guichet
-- pourrait dériver en silence — exactement le défaut que la duplication aurait produit.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage de la pile (`docs/DAT.md` §3.2). Tout est donc écrit pour être
-- rejouable : `create or replace function` et des `revoke` / `grant` nominatifs.

-- =============================================================================================
-- 1. `public.mail_template_variables()` — le guichet, qui ne redéclare rien
-- =============================================================================================
-- docs/SPEC-modeles-emails.md §9.3.
--
-- `immutable` comme la fonction qu'elle appelle : une fonction ne peut pas être déclarée plus
-- stable que ce qu'elle appelle, et l'inverse — la déclarer `stable` — ferait perdre au guichet la
-- propriété que la fonction déléguée porte, sans rien apporter.
--
-- `security invoker` — c'est le défaut, et il est écrit pour qu'on ne le croie pas oublié : la
-- liste est la MÊME pour tout le monde, et un `security definer` ne servirait qu'à masquer un
-- privilège que personne n'a besoin d'emprunter. Le refus de l'anonyme est un refus de PRIVILÈGE,
-- posé au §1.1 ci-dessous.

create or replace function public.mail_template_variables()
returns text[]
language sql
immutable
as $$
	select app.mail_template_variables();
$$;

comment on function public.mail_template_variables() is
	'CRM-063 — docs/SPEC-modeles-emails.md §9.3. Guichet public de la liste fermée des variables '
	'de modèle. DÉLÈGUE à app.mail_template_variables(), qui reste la source unique (§3) : le '
	'schéma app n''est pas exposé par PostgREST, et recopier la liste garantirait sa divergence.';

-- --- 1.1 Privilèges ---------------------------------------------------------------------------
-- `authenticated` et `service_role`, JAMAIS `anon` — les privilèges de
-- `public.rendre_modele_email` (§8.7), repris sans changement : un appelant anonyme n'écrit aucun
-- modèle, et la palette ne sert qu'à en écrire un.
--
-- `revoke all … from public` NE SUFFIT PAS : c'est le point de sûreté des migrations 48 à 56, la
-- distribution posant des `alter default privileges … to anon`. La révocation est donc NOMMÉE.

revoke all on function public.mail_template_variables() from public, anon;
grant execute on function public.mail_template_variables() to authenticated, service_role;
