# Spécification — les refus « introuvable » rendent HTTP 404, et non 500 (`CRM-120`)

*Écrite le 2026-11-01 par `CRM-120` T1, sur les décisions 762 (le principe) et 797 (le statut de
`outbox_not_reschedulable`). Inventaire et forme **mesurés** sur la pile de développement, PostgREST 14.12, le même jour.*

## 1. Le problème

PostgREST rend **HTTP 500** pour tout SQLSTATE de la famille `P0` hors `P0001`. La base lève `P0002` pour ses refus
« introuvable » : la supervision les lit comme des pannes. Le connecteur MCP, lui, ne traduit un refus du CRM que si le
statut est **inférieur à 500** (`mcp/crm_mcp/politique.py`, `reponse.statut < 500`), si bien qu'un « introuvable » y
devient une erreur générique. La webapp n'en souffre pas : elle classe par code et par message.

## 2. La forme retenue, mesurée

Trois sondes ont été appelées par l'API de la pile, à la clé de service, puis retirées :

| Forme levée | Corps rendu | Statut |
|---|---|---|
| `raise exception 'message_not_found' using errcode = 'P0002'` (aujourd'hui) | `{"code":"P0002","details":null,"hint":null,"message":"message_not_found"}` | **500** |
| `raise exception 'message_not_found' using errcode = 'PT404'` | `{"code":"PT404",…,"message":"message_not_found"}` | 404 |
| `raise sqlstate 'PGRST' using message = '{"code":"P0002","message":"message_not_found"}', detail = '{"status":404,"headers":{}}'` | `{"code":"P0002","details":null,"hint":null,"message":"message_not_found"}` | **404** |

**Retenue : la forme `PGRST`**, celle que visait la décision 762. C'est la seule qui laisse le **corps inchangé**, code
`P0002` et message compris, et ne change que le statut. Les clients qui lisent le code ou le message n'ont rien à
modifier pour continuer de classer : `webapp/src/lib/creer-affaire.ts`, `rgpd.ts`, `webhooks.ts`, `export-csv.ts`. La
forme `PT404`, déjà employée par `accepter_suggestion_ia` et `app.suggestions_ia_revisions_avant_creation` (2026-10-02),
change le code rendu : elle reste en place pour ces deux-là, qui rendent déjà 404, et n'est pas étendue.

**Une seule fonction lève**, pour que la forme ne soit écrite qu'une fois :

```sql
app.raise_http_error(p_status integer, p_message text)  -- returns void, search_path vide
```

Sept des fonctions de l'inventaire s'exécutent avec les droits de l'appelant (`creer_affaire`, les imports et exports CSV,
`save_card_as_template`, `set_default_workflow`) : `app.raise_http_error` est donc exécutable par `authenticated` et
`service_role`, et par eux seuls (retirée de `public`, donc d'`anon`). Le schéma `app` n'est pas exposé par l'API : elle ne
se joint qu'à travers les fonctions qui l'appellent. Elle lève `sqlstate 'PGRST'` avec le message `jsonb_build_object('code', 'P0002', 'message', p_message)::text` et le
détail `jsonb_build_object('status', p_status, 'headers', '{}'::jsonb)::text`. Le code reste `P0002` pour chaque statut,
409 compris : seul le statut change, jamais ce que les clients lisent. Dans une fonction SQL, le refus se lit désormais
`SQLSTATE = 'PGRST'`, avec pour `SQLERRM` le texte JSON. **Aucune fonction ne capture `P0002`** (mesuré : ni
`no_data_found`, ni `when sqlstate 'P0002'`) : rien ne dépendait de l'ancien SQLSTATE en base.

## 3. L'inventaire, mesuré en base

Les fonctions des schémas `public` et `app` dont le corps lève `P0002`, relevées dans `pg_proc` (définitions en
vigueur, et non dans les migrations, qui en portent d'anciennes) :

| Fonction | Message levé | Statut cible |
|---|---|---|
| `app.audit_export`, `app.audit_import` | `workspace_not_found` | 404 |
| `app.contact_rgpd_guard` | `contact_not_found` | 404 |
| `app.plateforme_espace_existe` | `espace_introuvable` | 404 |
| `app.trash_track_guard` | `track_not_found` | 404 |
| `public.classer_message_automatiquement`, `classify_message`, `unclassify_message` | `message_not_found` | 404 |
| `public.creer_affaire` | `channel introuvable`, `template_not_found` | 404 |
| `public.export_cards`, `public.import_cards` | `channel_not_found` | 404 |
| `public.export_contacts`, `public.import_contacts` | `workspace_not_found` | 404 |
| `public.mail_inbound_account_record_check` | `account_not_found` | 404 |
| `public.mail_outbound_identity_record_check` | `identity_not_found` | 404 |
| `public.marquer_envoi_reussi` | `outbox_not_found` | 404 |
| `public.mcp_compte`, `mcp_poser_droits`, `plateforme_poser_membre`, `plateforme_poser_superadmin` | `profil_introuvable` | 404 |
| `public.reassign_trashed_track_cost` | `cost_not_found`, `budget_not_found` | 404 |
| `public.record_attachment_text` | `attachment_not_found` | 404 |
| `public.record_webhook_attempt`, `public.redeliver_webhook` | `delivery_not_found` | 404 |
| `public.rotate_webhook_secret` | `webhook_not_found` | 404 |
| `public.save_card_as_template` | `placement_not_found` | 404 |
| `public.set_default_workflow` | `workflow introuvable` | 404 |
| `public.reprogrammer_envoi` | `outbox_not_reschedulable` | **409** (décision 797) |

Vingt-huit fonctions et trente levées, toutes de la même forme
(`raise exception '<message>' using errcode = 'P0002';`). Trois autres mentionnent `P0002` en commentaire seulement (`accepter_suggestion_ia`,
`app.suggestions_ia_revisions_avant_creation`, `snooze_thread`) et ne changent pas. **Les messages ne changent pas**, pas
même ceux de `set_default_workflow` et le premier de `creer_affaire`, qui contiennent une espace : le connecteur ne le traduit donc pas, comme aujourd'hui.

**`outbox_not_reschedulable` rend 409** (décision 797). L'envoi existe, mais son état, ni `queued` ni `sending`,
interdit de le reprogrammer : c'est un conflit d'état, pas une absence. Seul `mail-sync` l'appelle, et toute erreur
l'arrête de la même façon.

## 4. Ce qui change, et où

- **Base (T2)** : une migration crée `app.raise_http_error` et réécrit les vingt-huit fonctions, en remplaçant chaque
  `raise exception '<message>' using errcode = 'P0002'` par `perform app.raise_http_error(404, '<message>')`, ou 409 pour
  `reprogrammer_envoi`. Rien d'autre ne change dans leur corps. Les pgTAP qui attendent `P0002` attendent `PGRST`, avec
  le message JSON (16 fichiers relevés) ; un pgTAP nouveau prouve la fonction et l'absence de tout `P0002` levé.
- **Clients (T3)** : les preuves API qui affirment 500 pour ces refus (`STATUT_P0002` de
  `e2e/api/connecteur-administration.spec.ts`, `envoi.spec.ts`, `import-affaires.spec.ts`,
  `defaut-archivage-workflow.spec.ts`) affirment 404, ou 409, aux vrais jetons. Le connecteur traduit désormais ces refus
  (pytest : un `404` à message symbolique devient un refus nommé). La webapp garde ses lectures du code `P0002`, que le
  corps porte toujours ; ses tests unitaires le prouvent. `docs/SPEC-plateforme.md` §6.1 et les dictionnaires de refus
  nomment le statut.
- **Les autres spécifications** : là où elles nomment un refus `P0002` (webhooks, import et export, connecteur), le code
  est celui que le corps porte, et le statut est 404 ; les dictionnaires de `docs/SPEC-plateforme.md` §6.1 et de
  `docs/SPEC-workflow-engine.md` le disent dans leur colonne.
- **Livraison (T4)** : une migration, sans image ni webapp obligatoire ; contrat de déploiement.

## 5. Connecteur MCP

Ce n'est pas une fonctionnalité nouvelle (décision 762). Le connecteur gagne seulement la traduction des refus
« introuvable » qu'il reçoit déjà ; aucune famille, aucune case et aucun outil ne change.
