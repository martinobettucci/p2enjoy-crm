#!/usr/bin/env bash
# @verifies CRM-008 (docs/BACKLOG.md) — Definition of Done du harnais de tests
# @verifies docs/SPEC-test-harness.md §3 (exécuteur pgTAP), §4 (projets Playwright),
#           §5 (rapport), §7 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 11)
# @verifies docs/JOURNAL.md décisions 48 à 51, décision 79 (faux vert du plan pgTAP),
#           décision 278 (chaîne Node Linux prouvée avant toute dégradation), décision 308
#           (mutation structurelle et restauration de l'état reçu)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-008` :
#
#   1. les prérequis sont réunis, et le script le dit plutôt que de mesurer autre chose ;
#   2. `npm run test:sql` exécute toutes les suites pgTAP et rend les deux comptes attendus ;
#   3. `npm run e2e:api` est vert sur tous ses scénarios attendus, hors interface ;
#   4. `npm run e2e:api` ne construit **ni ne sert** la webapp — mesuré en supprimant le build
#      avant l'exécution et en constatant qu'il n'a pas été recréé ;
#   5. `npm run e2e:ui` reste vert : le projet et la console stricte n'ont rien cassé ;
#   6. `npm run test:unit` reste vert sur tous ses tests attendus ;
#   7. `npm run typecheck` reste vert, les fichiers `e2e/` étant couverts par tsconfig.tools.json ;
#   8. `npm run e2e:report` sert réellement le dernier rapport — interrogé en HTTP, pas supposé ;
#   9. le harnais est **non complaisant** : six dégradations réelles doivent le faire échouer,
#      dont la régression d'un faux vert **réel** de l'exécuteur (décision 79) ;
#  10. tout ce qui a été altéré est restauré, et l'état final est **constaté**.
#
# Le script ne démarre ni n'arrête la pile : elle doit tourner (`./runDev.sh`), et le seed doit
# être appliqué (`supabase/seed/apply-seed.sh`). Tout ce qu'il altère est restauré par un `trap`,
# y compris en cas d'interruption.
#
# Usage :
#   scripts/verify-harness.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh

DB_CONTAINER=p2enjoy-db
SUITE_MUTABLE=supabase/tests/0003_seed_socle.test.sql
TEST_FAUX=webapp/src/lib/non-complaisance.tmp.test.ts
# Suite jetable de la dégradation 9.6 : un plan tenu ligne pour ligne, mais des dernières
# assertions prises dans un savepoint annulé (docs/JOURNAL.md, décision 79).
SUITE_FAUX_VERT=supabase/tests/9999_non_complaisance_plan.tmp.test.sql
POLITIQUE=preuve_non_complaisance_crm_008
PORT_RAPPORT=9323

# Comptes attendus, révisés à chaque unité qui ajoute des preuves. Ils sont **figés** et non
# déduits : un exécuteur qui se contenterait de « le vert est vert » resterait vert si une suite
# entière cessait d'être découverte (docs/SPEC-test-harness.md §3). Le prix est cette révision
# explicite ; c'est exactement ce qu'on lui demande.
#
# Historique : 227 / 13 / 13 à `CRM-008` ; 306 / 30 / 22 puis 23 à `CRM-020` ; 374 / 50 / 37 à
# `CRM-021` ; 454 / 75 / 37 à `CRM-030` ; 559 / 96 / 37 à `CRM-031` ; 622 / 110 / 37 à `CRM-032` ;
# 653 / 125 / 37 à `CRM-033` ; 717 / 150 / 37 à `CRM-035` ; 1051 / 242 / 37 à `CRM-036` ;
# 1093 / 254 / 37 à `CRM-013` ; 1139 / 291 / 37 à `CRM-014` ;
# **1164 / 291 / 37 depuis la reprise de `CRM-010`**.
#
# LES COMPTEURS ÉTAIENT RESTÉS À LEUR VALEUR DE `CRM-035`, ET LE FAIT EST NOMMÉ PLUTÔT QUE CORRIGÉ
# EN SILENCE. Trois unités livrées entre-temps — `CRM-012`, `CRM-040` et `CRM-034` — ont ajouté des
# assertions et des scénarios sans réviser ces deux valeurs : ce harnais rendait donc « vert mais N
# au lieu de 717 » à chaque exécution depuis. C'est exactement le comportement voulu — le contrôle
# a bien dénoncé l'écart — mais la révision, elle, avait été omise. `CRM-036` la fait, et pour les
# quatre unités à la fois : les valeurs ci-dessous sont MESURÉES le 2026-08-05, non déduites.
#
# Les compteurs ont **réellement échoué** à chaque livraison qui les dépassait, comme prévu, et
# sont révisés dans le même changement que les preuves qu'ils comptent. C'est le seul mode de
# fonctionnement acceptable : les déduire de l'exécution reviendrait à supprimer le contrôle.
# RÉVISÉS À `CRM-013`, DANS LE MÊME CHANGEMENT QUE LES PREUVES QU'ILS COMPTENT — et cette fois
# sans retard, à la différence de `CRM-036` qui rattrapait quatre unités. L'unité ajoute
# `supabase/tests/0015_colonnes_protegees.test.sql` (41 assertions), une assertion à
# `supabase/tests/0007_workflows.test.sql` (INC-056) et `e2e/api/colonnes-protegees.spec.ts`
# (12 scénarios) : 1051 + 42 = 1093, et 242 + 12 = 254. Les deux valeurs sont MESURÉES.
#
# RÉVISÉS DE NOUVEAU À `CRM-014`, dans le même changement, et sans retard non plus. L'unité ajoute
# `supabase/tests/0016_preuves_refus.test.sql` (46 assertions) et
# `e2e/api/preuves-refus.spec.ts` (37 scénarios) : 1093 + 46 = 1139, et 254 + 37 = 291. Les deux
# valeurs sont MESURÉES le 2026-08-05, non déduites.
#
# RÉVISÉS UNE TROISIÈME FOIS, LE 2026-08-05, PAR LA REPRISE DE `CRM-010` — et le contrôle a bien
# échoué avant d'être révisé, « vert mais 1164 au lieu de 1139 ». L'unité n'ajoute aucun fichier :
# elle **étend** `supabase/tests/0002_fonctions_autorisation.test.sql` de 128 à 153 assertions, ses
# quatre fonctions `can_*` n'ayant jamais eu de preuve portée par leur propre unité (INC-013, close).
# 1139 + 25 = 1164. Ni le projet `api` ni le projet `ui` ne changent : l'unité ne livre ni route ni
# écran. Valeur MESURÉE, non déduite.
# RÉVISÉS UNE QUATRIÈME FOIS, LE 2026-08-05, PAR `CRM-037` — et les deux compteurs de scénarios ont
# bien échoué avant d'être révisés. L'unité livre le rendu du formulaire conditionnel et son écran
# hôte : **15 scénarios d'API** (`e2e/api/rendu-formulaire.spec.ts`, le tableau de cas partagé du
# §4.3 jugé par la base) et **10 scénarios d'interface** (`e2e/ui/formulaire.spec.ts`).
# 291 + 15 = 306 ; 37 + 10 = 47. `ASSERTIONS_ATTENDUES` est inchangée : l'unité n'ajoute aucune
# assertion pgTAP, ses preuves de base passant par la vraie route et non par une suite SQL.
# Valeurs MESURÉES, non déduites.
#
# RÉVISÉS UNE CINQUIÈME FOIS, LE 2026-08-05, PAR LA REPRISE DE `CRM-037` — le §4.6 bis de
# `docs/SPEC-form-composer.md`, qui donne enfin ses onglets à la route d'une card. L'unité ajoute
# **3 scénarios d'interface** à `e2e/ui/formulaire.spec.ts` : le track de l'adresse réellement
# demandé par un anonyme, la requête de channels filtrée sur `track_id`, et l'onglet courant seul à
# porter `aria-current="page"`. 47 + 3 = 50. Valeur MESURÉE, non déduite.
#
# **ET `SCENARIOS_API` ÉTAIT RESTÉ EN ARRIÈRE, D'UNE RÉVISION QUI N'AVAIT PAS ÉTÉ FAITE.** MESURÉ le
# 2026-08-05 : `npm run e2e:api` rend **308** scénarios, pas 306. La correction du prédicat
# « renseigné » (décision 165) avait ajouté **deux cas** au tableau de cas partagé du §4.3 —
# `"\t"` et `"\n"` —, donc deux scénarios à `e2e/api/rendu-formulaire.spec.ts`, qui passe de 15 à
# **17**, sans que ce compteur ne soit révisé dans le même changement. Le contrôle a fait
# exactement ce qu'on lui demande — il aurait rendu « vert mais 308 au lieu de 306 » — mais la
# révision, elle, avait été omise, comme à `CRM-036` pour quatre unités à la fois. Elle est faite
# ici. `ASSERTIONS_ATTENDUES` reste à 1164 : aucune assertion pgTAP n'est ajoutée par l'une ni par
# l'autre de ces deux reprises.
#
# RÉVISÉS UNE SIXIÈME FOIS, LE 2026-08-05, PAR `CRM-041` — le board kanban. L'unité livre
# **24 scénarios d'API** (`e2e/api/board.spec.ts`, les quatre lectures du §7.2 confrontées à la
# pile réelle avec le jeton de l'administratrice, et le refus opposé à l'anonyme) et
# **21 scénarios d'interface** (`e2e/ui/board.spec.ts`, dont la vidéo du glisser-déposer et les
# quatre paliers). 308 + 24 = 332 ; 50 + 21 = 71. `ASSERTIONS_ATTENDUES` est inchangée : l'unité ne
# livre ni table, ni fonction, ni politique — son objet est un écran, et la garde qu'il exerce est
# déjà couverte par la suite pgTAP de `CRM-034`. Valeurs MESURÉES, non déduites.
#
# RÉVISÉS UNE SEPTIÈME FOIS, LE 2026-08-05, PAR `CRM-042` — la vue liste. L'unité livre
# **26 scénarios d'API** (`e2e/api/liste-cards.spec.ts` : les deux lectures du §12.3, les quatre
# tris, `nullslast` et sa contre-épreuve, la marche paginée sans doublon, les deux filtres, la
# frontière du `416` à un rang près, le `count=planned` faux, et le refus opposé à l'anonyme) et
# **27 scénarios d'interface** (`e2e/ui/liste-cards.spec.ts` : tableau, tri, filtres, pagination,
# `416`, bascule board ↔ liste, données longues et quatre paliers). 332 + 26 = 358 ;
# 72 + 27 = 99. `ASSERTIONS_ATTENDUES` est de nouveau inchangée : l'unité ne livre ni table, ni
# fonction, ni politique. Valeurs MESURÉES, non déduites.
# RÉVISÉS UNE HUITIÈME FOIS, LE 2026-08-05, PAR `CRM-043` — les commentaires. L'unité livre une
# TABLE, ce que les deux précédentes ne faisaient pas : `ASSERTIONS_ATTENDUES` bouge donc enfin.
# `supabase/tests/0017_commentaires.test.sql` compte **84 assertions** (forme, unicité ajoutée à
# `cards`, dérivation du workspace, `CHECK` conditionnel, pierre tombale, `edited_at`, colonnes
# gelées, trois politiques, privilèges de colonne, publication de temps réel, conformité du seed).
# DEUX assertions antérieures ont en outre été RÉVISÉES sans changer le total — celles qui
# constataient l'absence de `card_comments` dans `0012_cards` et `0013_move_card` —, et deux
# assertions s'y sont ajoutées : 1164 + 84 + 2 = 1250. `e2e/api/commentaires.spec.ts` livre
# **17 scénarios** (les seize lignes du contrat du §13.8, plus le temps réel avec son témoin) :
# 358 + 17 = 375, et `SCENARIOS_UI` passe de 99 à **113** avec le panneau. Valeurs MESURÉES, non
# déduites.
# RÉVISÉS UNE NEUVIÈME FOIS, LE 2026-08-05, PAR `CRM-044` — la timeline unifiée. L'unité livre une
# TABLE, `card_events`, et `supabase/tests/0018_timeline.test.sql` compte **87 assertions** (forme,
# `clock_timestamp()`, les huit types éprouvés EN ÉCRIVANT, l'absence de tout privilège d'écriture
# pour les TROIS rôles, l'unique politique, les cinq triggers, l'immuabilité opposable au
# propriétaire, ce que chaque trigger écrit réellement, la conformité du seed, et ce qui reste dû).
# **SIX assertions antérieures ont été RÉVISÉES sans changer le total** — celles qui constataient
# l'absence de la table dans `0012_cards`, `0013_move_card`, `0014_valeurs_champs`,
# `0015_colonnes_protegees`, `0016_preuves_refus` et `0017_commentaires` : 1250 + 87 = 1337.
# `e2e/api/timeline.spec.ts` livre **16 scénarios** (les douze lignes du contrat du §14.9, plus le
# seed, l'immuabilité et le vocabulaire) : 375 + 16 = **391**. `e2e/api/preuves-refus.spec.ts`, lui,
# ne bouge PAS — et l'écrire est utile, parce que son contenu a changé : la preuve n° 8 cesse
# d'assérer une absence pour **mesurer un refus**, ce qui retire un cas de la liste des tables
# absentes et en ajoute un nouveau. **Cette valeur a d'abord été posée à 392 par déduction, et
# l'exécution l'a démentie** : la révision d'un compteur se MESURE, comme la décision 141 l'avait
# déjà établi.
# RÉVISÉS UNE DIXIÈME FOIS, LE 2026-08-06, PAR `CRM-045` — le déplacement d'une card entre
# channels. L'unité ne livre AUCUNE table : elle livre une fonction, une neuvième valeur au
# vocabulaire de `card_events`, et une cinquième garde au trigger de `cards`.
# `supabase/tests/0019_move_card_to_channel.test.sql` compte **64 assertions** (forme et privilèges
# de la fonction, le vocabulaire à neuf valeurs, les huit vérifications dans les DEUX SENS, les
# effets du succès, `entered_step_at` conditionnelle, l'événement et son payload à six clés,
# l'ABSENCE de `moved` à côté, les réponses de formulaire dans les trois cas, les colonnes fermées
# d'avance par `CRM-013`, et ce que l'unité ne livre pas) : 1337 + 64 = **1401**.
# `e2e/api/move-card-to-channel.spec.ts` livre **18 scénarios** (les seize lignes du contrat du
# §6.9, plus le refus sur `workflow_id` et l'état laissé par le seed) : 391 + 18 = **409**.
# `SCENARIOS_UI` est INCHANGÉ : `CRM-045` ne livre aucun écran, et sa Definition of Done est la
# seule du chunk 3 à ne pas demander de captures (docs/SPEC-workflow-engine.md §6.10).
#
# AUCUNE ASSERTION ANTÉRIEURE N'A ÉTÉ RÉVISÉE, ET C'EST LA PREMIÈRE FOIS DEPUIS SIX UNITÉS — le
# mécanisme de la décision 51 n'a PAS joué sur le vocabulaire, et une vérification l'a établi :
# `0018_timeline.test.sql` éprouve ses huit types EN ÉCRIVANT, un à un, sans jamais compter
# l'énumération. Rien ne pouvait donc devenir rouge. Le recensement manquait, et il est désormais
# porté par `0019`.
#
# UN GARDE-FOU A TOUTEFOIS JOUÉ, AILLEURS : `webapp/src/lib/database.types.test-d.ts` annonçait
# « une troisième fonction la rendra rouge à son tour », et `move_card_to_channel` l'a rendue
# rouge. Elle est RÉVISÉE, non retirée, et resserrée sur les trois fonctions livrées.
#
# --- `CRM-046` ---------------------------------------------------------------------------------
#
# L'unité ne livre AUCUNE nouvelle suite : elle étend le seed. Les compteurs bougent donc par
# RÉVISION d'assertions existantes, ce qui est une première dans ce fichier.
#
# `ASSERTIONS_ATTENDUES` passe de 1401 à **1405** : quatre assertions ajoutées en révisant, jamais
# une de retirée (décision 51). `0012_cards.test.sql` en gagne deux — les cards de `prospection`
# suivent le workflow dérivé, et l'état préalable de l'étape « Livré » est asserté avant que le
# nœud ne soit archivé ; `0019_move_card_to_channel.test.sql` en gagne deux — les cards suivent le
# workflow de leur channel, et la portée d'arrivée n'était pas vide.
#
# `SCENARIOS_API` passe de 409 à **410** : un seul scénario ajouté, la contre-épreuve « ligne a bis »
# de `e2e/api/coherence-workflow.spec.ts`, qui mesure le refus `409` opposé au déplacement du
# workflow d'un channel PEUPLÉ. Sans elle, le passage de trois scénarios à un channel jetable
# aurait l'air d'un contournement.
#
# `SCENARIOS_UI` est INCHANGÉ : `CRM-046` ne livre aucun écran.
#
# ONZE ASSERTIONS FIGÉES PAR DES UNITÉS ANTÉRIEURES SONT DEVENUES ROUGES, ET LE MÉCANISME DE LA
# DÉCISION 51 A JOUÉ COMME ANNONCÉ. Deux d'entre elles figeaient explicitement une conséquence
# d'INC-046 — « aucune card seedée dans `prospection` » — et ce sont celles-là qui tournent : elles
# prouvent désormais que les cards de ce channel suivent son workflow dérivé, et le REFUS qui fonde
# INC-046 est éprouvé à côté. Deux autres comptaient un CUMUL d'événements (décision 226).
#
# Valeurs MESURÉES, non déduites.
#
# --- `CRM-016` ---------------------------------------------------------------------------------
#
# L'unité livre **6 scénarios d'API** dans `e2e/api/functions.spec.ts` : clés absente et fausse
# refusées par Kong, POST réel de la fonction d'exemple, méthode refusée, fonction inconnue et
# CORS. `SCENARIOS_API` passe donc de 410 à **416**, valeur MESURÉE le 2026-08-08 par la suite API
# complète. Elle ne livre ni migration ni écran : les compteurs pgTAP et UI restent inchangés.
#
# --- `CRM-017` ---------------------------------------------------------------------------------
#
# L'unité ajoute `0020_pg_cron.test.sql`, **48 assertions** mesurées : passage réel du heartbeat,
# contrat du job et fermeture exhaustive des ACL du schéma, des relations et des fonctions
# `cron`. Le total passe donc de 19 / 1405 à **20 fichiers / 1453 assertions**. Elle ne livre ni
# route API ni écran : les deux compteurs Playwright restent inchangés.
#
# --- `CRM-018` ---------------------------------------------------------------------------------
#
# L'unité ajoute `0021_transition_required_fields.test.sql` (**88 assertions**) et étend la preuve
# exhaustive de refus de `0016_preuves_refus.test.sql` aux trois tables métier peuplées qui lui
# manquaient (**6 assertions** : politique nommée + non-vacuité pour chacune). Le total passe donc
# à **21 fichiers / 1553 assertions** après les reprises des suites historiques. Côté HTTP,
# cinq scénarios dédiés, les trois lectures anonymes manquantes et la suppression source portent
# la suite de 416 à **425 scénarios**. Aucun écran n'est livré : le compteur UI reste inchangé.
#
# --- `CRM-019` ---------------------------------------------------------------------------------
#
# L'unité ajoute `0022_change_channel_workflow.test.sql` (**59 assertions**) et
# `e2e/api/change-channel-workflow.spec.ts` (**14 scénarios**) : mapping exhaustif, refus
# atomiques, cards archivées/corbeille, perte explicite et vrais JWT. Le total mesuré devient
# **22 fichiers / 1612 assertions** et **439 scénarios API**. Le libellé d'un scénario UI existant
# ferme INC-077 sans ajouter de parcours : le compteur UI reste 144.
# --- `CRM-022` ---------------------------------------------------------------------------------
# Une suite pgTAP de 84 assertions, cinq scénarios API et un parcours UI réel ferment INC-014.
# Les compteurs sont ceux mesurés après retour de tous les contrats historiques concernés ; les
# deux assertions de régression CRM-045 déjà présentes portent le total SQL à 1698.
# --- `CRM-052` ---------------------------------------------------------------------------------
# `supabase/tests/0024_comptes_entrants_imap.test.sql` ajoute **60 assertions**, et DEUX suites
# antérieures sont RÉVISÉES plutôt que retirées : `0015_colonnes_protegees.test.sql` retourne sa
# cible 1/6, `0016_preuves_refus.test.sql` retourne ses preuves n° 6 et n° 7 et gagne une
# assertion. 1698 + 60 + 1 = **1759**, mesuré. `e2e/api/comptes-entrants.spec.ts` ajoute
# **11 scénarios** et `preuves-refus.spec.ts` en gagne **1** : 444 + 12 = **456**.
# `e2e/mail/comptes-entrants.spec.ts` ajoute **6 scénarios** ouvrant de vraies sessions IMAP.
# --- `CRM-053` ---------------------------------------------------------------------------------
# `supabase/tests/0025_identites_sortantes_smtp.test.sql` ajoute **38 assertions** ; les suites
# 0015 et 0016 sont de nouveau RÉVISÉES plutôt que retirées, sans changer leur compte.
# 1759 + 38 = **1797**. `e2e/api/identites-sortantes.spec.ts` ajoute **7 scénarios** et
# `preuves-refus.spec.ts` en gagne **1** : 456 + 8 = **463**.
# `e2e/mail/identites-sortantes.spec.ts` ajoute **5 scénarios** SMTP réels : 27 + 5 = **32**.
# --- `CRM-054` ---------------------------------------------------------------------------------
# `supabase/tests/0026_ingestion_messages.test.sql` ajoute **26 assertions** ;
# `0016_preuves_refus.test.sql` retourne ses deux assertions de la preuve n° 9 sans changer son
# compte. 1797 + 26 = **1823**. `e2e/api/ingestion.spec.ts` ajoute **4 scénarios**, et
# `preuves-refus.spec.ts` en PERD **1** — la table `attachments` sort de la liste des absences :
# 463 + 4 - 1 = **466**. `e2e/mail/ingestion.spec.ts` ajoute **2 scénarios** : 32 + 2 = **34**.
# --- `CRM-055` ---------------------------------------------------------------------------------
# `supabase/tests/0027_classement_messages.test.sql` ajoute **20 assertions**, et TROIS suites
# antérieures sont révisées : 0018, 0019 et 0022 figeaient le refus de `mail_received`, que le
# classement écrit désormais. Le mécanisme de la décision 51 pour la dixième fois.
# 1823 + 20 = **1843**. `e2e/api/classement.spec.ts` ajoute **3 scénarios** : 466 + 3 = **469**.
# `e2e/mail/ingestion.spec.ts` en gagne **1** : 34 + 1 = **35**.
# --- `CRM-056` ---------------------------------------------------------------------------------
# `supabase/tests/0028_dossiers_imap.test.sql` ajoute **18 assertions** : 1843 + 18 = **1861**.
# `e2e/mail/dossiers.spec.ts` ajoute **2 scénarios** — l'arborescence lue par un client IMAP tiers
# — et `e2e/mail/roundcube-dossiers.spec.ts` **1**, l'observation visuelle que la Definition of
# Done exige. 35 + 3 = **38**. `SCENARIOS_API` est inchangé : l'unité n'ajoute aucune route.
# --- `CRM-057` ---------------------------------------------------------------------------------
# `supabase/tests/0029_inbox_globale.test.sql` ajoute **22 assertions**, et DEUX suites antérieures
# sont révisées sans changer de compte : 0016 gagne une assertion — la preuve de refus n° 9 porte
# désormais sur le NOMBRE de politiques de stockage **et** sur leur portée —, tandis que 0026 voit
# deux des siennes retournées. 1861 + 22 + 1 = **1884**, valeur MESURÉE.
# `e2e/api/inbox.spec.ts` ajoute **9 scénarios** : 469 + 9 = **478**.
# `e2e/ui/inbox.spec.ts` ajoute **6 scénarios** : 157 + 6 = **163**.
# `SCENARIOS_MAIL` est inchangé : l'unité livre un écran, pas un protocole.
# --- `CRM-058` ---------------------------------------------------------------------------------
# `supabase/tests/0030_envoi_sortant.test.sql` ajoute **21 assertions**, et QUATRE suites
# antérieures sont révisées : 0016 gagne une assertion — la preuve de refus n° 12 devient ACQUISE
# et se dédouble —, 0018 et 0022 retournent leur témoin, 0019 en gagne une aussi. 1884 + 21 + 2 =
# **1907**, valeur MESURÉE. `e2e/api/envoi.spec.ts` ajoute **8 scénarios** : 478 + 8 = **486**.
# `e2e/mail/envoi.spec.ts` ajoute l'aller-retour complet : 38 + 1 = **39**.
# --- `CRM-059` ---------------------------------------------------------------------------------
# `supabase/tests/0031_resilience_envoi.test.sql` ajoute **14 assertions** : le report réel d'une
# reprogrammation, le refus d'un délai nul, le refus de reprogrammer un envoi déjà parti,
# l'assainissement du code d'erreur PAR LA BASE, le seuil de l'orphelin dans les deux sens, et
# l'état exécuté avec les droits de l'appelant. 1907 + 14 = **1921**, valeur MESURÉE.
# --- INC-101, le 2026-08-14 : DEUX COMPTEURS QUI N'AVAIENT PLUS RIEN GARDÉ DEPUIS QUATRE
# --- LIVRAISONS ---------------------------------------------------------------------------------
# Le harnais rendait « vert mais 33 fichiers / 1971 assertions au lieu de 31 / 1921 » — c'est-à-dire
# exactement ce qu'on lui demande — sans que la révision soit faite dans le même changement que les
# preuves comptées. Le mécanisme de la décision 51 pour la onzième fois, et le précédent exact
# d'INC-080. Les valeurs ci-dessous sont MESURÉES sur base seedée AVANT toute modification du dépôt
# (`npm run test:sql` : 33 fichiers, 1971 assertions, aucune anomalie), et l'écart est ATTRIBUÉ
# fichier par fichier plutôt que constaté en bloc :
#
#   `0032_reprise_rangement.test.sql`  +1 fichier, +12 assertions  `CRM-059`, dette de `CRM-056`
#   `0033_quota_par_defaut.test.sql`   +1 fichier,  +4 assertions  `CRM-053` / `CRM-058`
#   `0011_droits_fins.test.sql`         71 → 78,    +7 assertions  INC-085 / INC-075 (`CRM-012`)
#   `0013_move_card.test.sql`           74 → 82,    +8 assertions  lot G (`CRM-034`)
#   `0014_valeurs_champs.test.sql`      98 → 103,   +5 assertions  lot G (`CRM-036`)
#   `0017_commentaires.test.sql`        84 → 98,   +14 assertions  lot G puis `CRM-043`
#
# 31 + 2 = **33** ; 1921 + 12 + 4 + 7 + 8 + 5 + 14 = **1971**. Le compte se reconstitue à l'unité :
# aucune suite n'a été perdue en route, seul le compteur était resté en arrière. À NOTER, et c'est
# une mesure et non une lecture du journal : `0032` existait DÉJÀ au commit qui a écrit 1921, dont
# l'arbre porte 32 fichiers et 1933 assertions. Ce compteur-là était donc faux DÈS SON ÉCRITURE.
#
# --- `CRM-076`, sixième tranche, le 2026-08-15 -----------------------------------------------------
# `0034_previsualisation_exigence.test.sql` ajoute UNE suite et DIX assertions : la forme de
# `public.previsualiser_exigence`, ses deux refus de cible, ses deux comptes mesurés sur le seed,
# l'union de ses arêtes, ses deux `0, 0` — champ archivé et cible inconnue —, et surtout sa parenté
# avec `move_card`. 33 + 1 = **34** ; 1971 + 10 = **1981**. MESURÉ par `npm run test:sql`, non déduit.
#
# --- `CRM-077`, première tranche, le 2026-08-15 ----------------------------------------------------
# `0035_corbeille.test.sql` ajoute UNE suite et DOUZE assertions : la forme des trois colonnes,
# l'audit fermé au client PAR LE PRIVILÈGE sur les trois tables — plus fort qu'un trigger, le refus
# tombant avant toute politique —, l'audit renseigné par le trigger, figé sous une écriture tierce,
# effacé à la restauration, et la corbeille qui RESTE lisible, propriété voulue que l'assertion fige.
# 34 + 1 = **35** ; 1981 + 12 + 2 = **1995**. Les DEUX assertions supplémentaires viennent de la
# révision de `0004_tracks` et `0005_channels` : leur contrôle de privilèges de table est devenu
# un contrôle de privilège de COLONNE — `deleted_by` exclue —, plus précis et non plus permissif.
# MESURÉ par `npm run test:sql`, non déduit.
#
# --- `CRM-077`, deuxième tranche, le 2026-08-15 ----------------------------------------------------
# `0036_corbeille_restauration.test.sql` ajoute UNE suite et HUIT assertions : les deux refus de
# restauration sous parent en corbeille, le SECOND niveau — une affaire sous un channel vivant dont
# le track est supprimé —, et surtout trois assertions qui prouvent que la garde NE refuse PAS ce
# qu'elle ne doit pas. Une garde qui refuserait trop serait aussi fautive qu'une garde absente, et
# c'est l'erreur la plus facile à commettre sur un trigger `before update`.
# 35 + 1 = **36** ; 1995 + 8 = **2003**. MESURÉ par `npm run test:sql`, non déduit.
# --- RÉVISION MESURÉE DU 2026-08-14 ---------------------------------------------------------
# Les cinq compteurs étaient en retard, et `CRM-046` le nommait comme un écart ouvert. Ils sont
# repris ici sur MESURE, non sur estimation : `npm run test:sql` rend 42 fichiers et 2191
# assertions, et `playwright --list` rend 678 scénarios `api`, 366 `ui`, 42 `mail`.
#
# Un compteur en retard ne protège plus de rien : il rend « vert mais N au lieu de M » à chaque
# exécution, et l'œil finit par lire le vert sans lire le nombre. C'est le contraire de ce qu'on lui
# demande — dénoncer une suite qui cesse d'être découverte.
# --- CRM-060 tranche 1, le 2026-08-18 -----------------------------------------------------------
# +1 fichier, +38 assertions : `supabase/tests/0043_contacts_et_organisations.test.sql` livre la
# suite pgTAP des trois nouvelles tables — forme, contraintes de valeur, unicités partielles
# insensibles à la casse, FK composites dans les deux sens, RLS, quatre politiques par table,
# privilèges par rôle, cascades et détachement. **DEUX ASSERTIONS ANTÉRIEURES ONT ÉTÉ RETOURNÉES
# SANS CHANGER LE TOTAL** — celles qui figeaient l'absence de `contacts` et de `card_contacts`
# dans `0014_valeurs_champs.test.sql` et `0027_classement_messages.test.sql`. Le compte d'une
# TROISIÈME assertion — la somme des politiques dans `public` de `0016_preuves_refus.test.sql` —
# passe de 66 à 78 (+12 : quatre par table sur trois tables).
# 42 + 1 = **43** ; 2191 + 38 = **2229**. MESURÉ par `npm run test:sql`.
# --- CRM-060 tranches 2 ET 3, le 2026-08-18 — ET LA TRANCHE 2 N'AVAIT PAS RÉVISÉ CES COMPTEURS ---
# La tranche 2 a livré `supabase/tests/0044_regle3_suggestion.test.sql` (+1 fichier, +21 assertions)
# sans toucher ces trois valeurs : elles sont restées à celles de la tranche 1, et le contrôle
# aurait dû rougir. Il n'a pas été exécuté, ce qui est la leçon d'INC-101 reprise à l'identique —
# un compteur figé ne dit rien tant que personne ne le confronte. L'omission est NOMMÉE ici plutôt
# que lissée dans un total qui semblerait n'avoir jamais dérivé.
# La tranche 3 livre `supabase/tests/0045_resolution_contact_user.test.sql` (+1 fichier,
# +19 assertions). **CINQ ASSERTIONS ANTÉRIEURES ONT ÉTÉ RETOURNÉES SANS CHANGER LE TOTAL** — les
# deux qui figeaient l'acceptation d'un uuid mort par `user` et `contact`, l'assertion
# `has_table('contacts')` retournée une SECONDE fois, et les deux de la tranche 2 déjà comptées.
# 43 + 1 + 1 = **45** ; 2229 + 21 + 19 = **2269**. MESURÉ par `npm run test:sql` le 2026-08-18.

# =================================================================================================
# RÉVISION DU 2026-08-20 — `CRM-060` sous-tranche 2 bis, ET UNE DÉRIVE ANTÉRIEURE QUI EST NOMMÉE
# =================================================================================================
#
# TROIS COMPTEURS SUR CINQ ÉTAIENT DÉJÀ FAUX AVANT CETTE SESSION, et il faut le dire plutôt que
# de laisser la révision les absorber en silence. MESURÉ le 2026-08-20, `playwright test --list` et
# `npm run test:sql` :
#
#   | Compteur              | Figé | Mesuré | Dont cette session |
#   |-----------------------|------|--------|--------------------|
#   | FICHIERS_SQL_ATTENDUS |   45 |     50 |                  0 |
#   | ASSERTIONS_ATTENDUES  | 2269 |   2480 |                  0 |
#   | SCENARIOS_API         |  774 |    818 |                 +2 |
#   | SCENARIOS_UI          |  437 |    549 |                 +4 |
#
#   Ces deux lignes ont été REVUES le 2026-08-20 par `CRM-088`, qui ajoute ses propres preuves :
#   821 pour l'API (+3) et 557 pour l'interface (+8). La dérive décrite ci-dessous reste entière —
#   ces deux révisions-là sont, elles, celles de la session qui les a produites.
#   | SCENARIOS_MAIL        |   42 |     42 |                  0 |
#
# LA DÉRIVE N'EST PAS DE CETTE SESSION, et la preuve est écrite ailleurs : `docs/JOURNAL.md`
# décision 480, rédigée la veille, rapporte « `test:sql` 50 fichiers / 2480 assertions », « `e2e:api`
# 816 passés » et « `e2e:ui` 544 passés ». Retranchés les 2 scénarios d'API et les 4 d'interface que
# la sous-tranche 2 bis ajoute, les valeurs d'avant elle sont donc 816 et 545 — c'est-à-dire déjà
# très loin de 774 et 437. Les unités `CRM-082` à `CRM-086`, qui ont livré les objectifs et les
# coûts, ont ajouté leurs preuves sans réviser ces cinq lignes.
#
# CE QUE CELA A COÛTÉ : `scripts/verify-harness.sh` rendait **cinq anomalies** à chaque exécution,
# toutes de comptage, sur un dépôt dont les suites étaient vertes. Un harnais qui rougit toujours
# cesse d'être lu, et c'est exactement ce que le mécanisme des compteurs figés existe pour éviter.
#
# CE QUE LA RÉVISION FAIT, ET CE QU'ELLE NE FAIT PAS : elle remet les cinq valeurs à ce que la pile
# mesure aujourd'hui, elle NOMME la part qui revient à cette session, et elle ne supprime aucun
# contrôle. Les compteurs redeviennent ce qu'ils doivent être — un piège qui se déclenche à la
# prochaine preuve ajoutée sans révision.
# --- CRM-062 tranche 1, le 2026-08-24 : **51 fichiers / 2504 assertions** ------------------------
# `supabase/tests/0051_cards_figees.test.sql` ajoute **24** assertions : la forme de
# `public.cards_figees` dans le catalogue, son ACL rôle par rôle, ses trois exclusions dans les deux
# sens, les deux côtés de sa borne, la surcharge de seuil, la conséquence écrite du §2.3 et son
# ordre total. Valeurs COMPTÉES par `npm run test:sql`, jamais déduites.
# --- CRM-062 tranche 2, le 2026-08-24 : **52 fichiers / 2529 assertions** ------------------------
# `supabase/tests/0052_relances_automatiques.test.sql` ajoute **25** assertions : la quinzième
# valeur du vocabulaire et son écriture réelle, la forme et l'ACL de `app.relancer_cards_figees`,
# le contrat du job et son passage `succeeded`, l'état du seed, l'idempotence, le réarmement après
# une entrée d'étape postérieure, l'acteur et le payload de l'événement que le passage COURANT
# écrit, et les trois exclusions héritées dans les deux sens. `0019_move_card_to_channel.test.sql`
# n'en gagne aucune : son garde-fou du vocabulaire est RÉVISÉ de quatorze à quinze valeurs, sixième
# fois qu'il évolue. 2504 + 25 = **2529**, valeur COMPTÉE par `npm run test:sql`.
# RÉVISÉES PAR `CRM-062` TRANCHE 3a, LE 2026-08-24, ET LE FICHIER NE BOUGE PAS.
#
# La tranche ne livre AUCUNE suite pgTAP neuve : `FICHIERS_SQL_ATTENDUS` reste à 52. Elle RÉVISE en
# revanche la conformité du seed de `0051_cards_figees.test.sql`, qui passe de 24 à 26 assertions —
# le jeu porte désormais QUATRE affaires figées (`docs/SPEC-relances.md` §10.2), et la conformité y
# assère la SUITE ENTIÈRE des retards dans son ordre ainsi que les deux dimensions du regroupement,
# là où elle comptait une ligne unique. 2529 + 2 = **2531**.
#
# `SCENARIOS_API` est INCHANGÉ à 858 : la tranche révise huit scénarios de `relances.spec.ts` et un
# de `board.spec.ts`, elle n'en ajoute aucun. Une révision qui renforce une assertion ne change pas
# un compte, et c'est précisément ce que ce témoin doit laisser passer. Valeurs COMPTÉES.
FICHIERS_SQL_ATTENDUS=52
ASSERTIONS_ATTENDUES=2531
# **504 depuis `CRM-075` et la nuit du 2026-08-12** : l'administration de l'arborescence ajoute ses
# preuves d'API des huit écritures, et `CRM-059` les siennes. Le contrôle a joué comme prévu — « vert
# mais 504 au lieu de 486 » — et la révision est faite APRÈS avoir compté les scénarios DÉCLARÉS
# (`--list`), non déduite d'une exécution : déduire reviendrait à supprimer le contrôle.
# --- INC-101, le 2026-08-14 : **507**, ET CE COMPTEUR-CI N'A JAMAIS ÉTÉ JUSTE ----------------------
# Les trois autres compteurs révisés ici avaient DÉRIVÉ — des preuves ont été ajoutées après eux.
# Celui-ci non, et c'est un fait d'une autre nature, mesuré et non déduit : depuis le commit qui a
# écrit `504`, **aucun scénario d'API n'a été ajouté ni retiré**. Le seul fichier d'`e2e/api/`
# modifié depuis est `move-card.spec.ts`, et son unique changement est le RENOMMAGE d'un scénario
# (« le motif est TOUJOURS perdu » → « le motif reste hors du `payload` », lot G). Le compte
# DÉCLARÉ était donc déjà de **507** à l'instant où `504` a été écrit : ce n'est pas une révision
# omise, c'est un comptage faux. La leçon d'INC-101 s'en trouve élargie — un compteur figé peut
# mentir sans qu'aucune livraison ne l'ait dépassé.
# Valeur COMPTÉE par `--list` (507 tests dans 31 fichiers) puis CONFRONTÉE au nombre de scénarios
# verts : les deux coïncident.
# --- `CRM-076`, sixième tranche, le 2026-08-15 -----------------------------------------------------
# **514** : `e2e/api/previsualisation-exigence.spec.ts` ajoute **sept** scénarios, seul endroit du
# harnais où `security invoker` cesse d'être une déclaration d'intention. MESURÉ : sur le couple
# `date-signature-prevue` × `Perdu`, l'administratrice reçoit `1, 8` et le `viewer` `1, 4` — deux
# jetons réels, deux comptes différents. Un `security definer` rendrait ces deux nombres égaux, et
# c'est l'assertion d'inégalité qui tomberait alors, avant que le produit n'annonce à quiconque des
# affaires qu'il n'a pas le droit d'ouvrir. S'y ajoutent le refus de l'anonyme par le PRIVILÈGE
# (`401`/`42501`, avant toute politique), les deux refus de cible et les deux cas sans effet.
# 507 + 7 = **514**.
# --- CRM-060 tranche 1, le 2026-08-18 -----------------------------------------------------------
# +18 scénarios : `e2e/api/contacts.spec.ts` livre les seize lignes du contrat d'API du §4 de
# `docs/SPEC-contacts.md` — les quatre profils sur `organizations`, l'unicité partielle du
# domaine et la contrainte de casse, les cas nominaux et de forme sur `contacts`, le
# cloisonnement structurel par FK composite, la lecture par les membres et le refus par zéro
# ligne pour l'anonyme, `card_contacts` composant `can_read_card` / `can_write_card`, et la
# cascade sur suppression d'un contact — plus deux scénarios de gestion : le refus par
# CONTRAINTE d'un domaine avec majuscules (`e bis`), et un inventaire sanity des trois profils
# seedés. 678 + 18 = **696**. MESURÉ par `npm run e2e:api` et par `playwright test --list`.
# --- CRM-060 tranches 2 et 3, le 2026-08-18 -------------------------------------------------------
# La tranche 2 a porté `e2e/api/classement.spec.ts` de 3 à 5 scénarios sans réviser ce compteur —
# même omission que ci-dessus. La tranche 3 ajoute **six** scénarios au bloc `V5` de
# `e2e/api/valeurs-champs.spec.ts` : la résolution de `contact` et de `user`, acceptations et refus.
# 696 + 2 + 6 = **704**, valeur COMPTÉE par `npm run e2e:api -- --list` (704 tests dans 44 fichiers)
# et non déduite d'une exécution — déduire reviendrait à supprimer le contrôle (INC-101).
# --- CRM-060 sous-tranche 4e, achevée le 2026-08-19 ----------------------------------------------
# `e2e/api/contacts.spec.ts` reçoit **neuf** scénarios : les onze mesures d'écriture du §14.3 de
# `docs/SPEC-contacts.md` — les quatre contraintes de forme tenant en un seul scénario — et la
# garde qui exige le seed rendu INTACT après elles. Ce sont ces réponses qui ont décidé du contrat
# de l'écran : le `409` commun à `23505` et `23503`, et le refus de la chaîne vide sur `email` et
# `phone`. 704 + 9 = **713**, valeur COMPTÉE par `playwright test --list`
# (« Total: 713 tests in 44 files ») et confirmée par `npm run e2e:api`, **713 verts**. Le nombre
# de FICHIERS ne bouge pas.
#
# --- CRM-060 sous-tranche 4f, livrée le 2026-08-19 -----------------------------------------------
# `e2e/api/contacts.spec.ts` reçoit **onze** scénarios : les sept mesures d'autorisation du §15.4
# de `docs/SPEC-contacts.md`, l'ambiguïté `PGRST201` entre `cards` et `channels` FIGÉE comme telle
# — sans ce scénario, un remaniement futur retirerait la clé nommée en croyant simplifier —, le
# filtre qui écarte la corbeille vérifié DES DEUX CÔTÉS sur une sonde retirée dans un `finally`, et
# la garde du seed intact. 713 + 11 = **724**, valeur COMPTÉE par `playwright test --list`
# (« Total: 724 tests in 44 files ») et confirmée par `npm run e2e:api`, **724 verts**. Le nombre de
# FICHIERS ne bouge pas.
#
# --- CRM-060 sous-tranche 4g, livrée le 2026-08-19 -----------------------------------------------
# `e2e/api/contacts.spec.ts` reçoit **sept** scénarios de MODIFICATION (§16.3) : les deux rôles qui
# écrivent, le SILENCE opposé à la lectrice — `200` et zéro ligne, sans erreur — figé sur une sonde
# ET sur une ligne du seed, l'identifiant inexistant qui rend le MÊME silence, les six refus de
# forme et d'unicité classés par le code PostgreSQL, la ligne qui réécrit son propre email sans se
# heurter à l'unicité, l'organisation retenue puis détachée avec le trigger `updated_at`, et les
# deux refus EXPLICITES du `WITH CHECK` et de l'anonyme. Sans le scénario du silence, un remaniement
# futur prendrait « aucune ligne modifiée » pour un succès. 724 + 7 = **731**, valeur COMPTÉE par
# `playwright test --list` (« Total: 731 tests in 44 files »). Le nombre de FICHIERS ne bouge pas.
# **RÉVISION DU 2026-08-19 — `CRM-060` sous-tranche 4h.** Le rattachement d'une affaire depuis la
# fiche d'un contact ajoute **neuf** scénarios d'API : les huit mesures d'autorisation du §17.4 —
# dont les deux qui FONDENT une décision d'écran plutôt que de la confirmer, l'affaire archivée
# acceptée et l'affaire en corbeille acceptée elle aussi — et la constatation que le seed est rendu
# intact. 731 + 9 = **740**, valeur COMPTÉE par `playwright test --list` (« Total: 740 tests in
# 44 files »), jamais déduite (INC-101). Le nombre de FICHIERS ne bouge pas.
# **RÉVISION DU 2026-08-19 — `CRM-060` sous-tranche 4i.** Le détachement d'une affaire depuis la
# fiche d'un contact ajoute **neuf** scénarios d'API : les huit mesures d'écriture du §18.3 — dont
# celle qui IMPOSE une troisième issue, la lectrice recevant `200` et zéro ligne SANS erreur sur un
# rattachement qui existe et qui reste en base — et la constatation que le seed est rendu intact.
# 740 + 9 = **749**, valeur COMPTÉE par `playwright test --list` (« Total: 749 tests in 44 files »),
# jamais déduite (INC-101). Le nombre de FICHIERS ne bouge pas.
# **RÉVISION DU 2026-08-19 — `CRM-060` sous-tranche 4j.** La modification du rôle d'un rattachement
# ajoute **quinze** scénarios d'API : les quatorze mesures d'écriture du §19.3 — dont celle qui
# IMPOSE la troisième issue, la lectrice recevant `200` et zéro ligne SANS erreur sur une ligne qui
# garde son rôle, et celle qui DÉCIDE DU CORPS, un `card_id` envoyé DÉPLAÇANT le rattachement — et
# la constatation que le seed est rendu intact. Deux mesures partagent un scénario (la chaîne vide
# et la chaîne blanche, même contrainte), d'où quinze et non seize. 749 + 15 = **764**, valeur
# COMPTÉE par `playwright test --list` (« Total: 764 tests in 44 files »), jamais déduite (INC-101).
# Le nombre de FICHIERS ne bougeait pas.
#
# `CRM-081` tranche 2 c — le sommeil d'un FIL de messagerie (docs/SPEC-cards.md §16.14) — ajoute un
# FICHIER, `e2e/api/snooze-fils.spec.ts`, et **dix** scénarios : les neuf lignes du contrat du
# §16.14.8 avec les jetons réels — dont celle qui prouve la discrétion AVEC LE MÊME PROFIL, le
# business developer réussissant sur le fil qu'il lit et se voyant opposer `thread_not_found` sur
# celui qu'il ne lit pas —, plus la mesure que la table REFUSE un `POST` et un `DELETE` directs,
# celle qui empêche un futur `grant` de rouvrir en silence la porte que les `alter default
# privileges` de la plateforme avaient laissée ouverte. 764 + 10 = **774**, valeur COMPTÉE par
# `playwright test --list` (« Total: 774 tests in 45 files »), jamais déduite (INC-101).
# **RÉVISION DU 2026-08-20 — voir le bloc « dérive antérieure » plus haut.** 818, valeur COMPTÉE
# par `playwright test --list` (« Total: 818 tests »), dont **+2** pour la sous-tranche 2 bis de
# `CRM-060` : la lecture de la suggestion du seed sous le jeton de l'administratrice, et le refus
# opposé au `business_developer` comme à la `viewer`.
# **RÉVISION DU 2026-08-20 — `CRM-088`.** Trois scénarios d'API ajoutés à
# `e2e/api/comptes-entrants.spec.ts` : la lectrice CRÉE sa propre boîte et la relit seule, la même
# lectrice se voit refuser la boîte système avec la contre-épreuve qu'aucune écriture n'a eu lieu,
# et `INC-193` est FIGÉE — le corps d'un refus de contrainte porte la référence Vault que le chemin
# normal refuse en `403`. 818 + 3 = **821**, valeur COMPTÉE par `npm run e2e:api` (« 821 passed »),
# jamais déduite (INC-101). Le garde-fou est RÉVISÉ, jamais retiré (mécanisme de la décision 51).
# **RÉVISION DU 2026-08-21 — `CRM-089`.** Trois scénarios d'API ajoutés à
# `e2e/api/identites-sortantes.spec.ts` : la lectrice DÉCLARE sa propre identité et se voit refuser
# celle de service avec sa contre-épreuve ; changer l'adresse d'expédition rend un identifiant NEUF
# et laisse DEUX lignes, l'adresse faisant partie de la clé ; et le nom d'expéditeur, sous
# `coalesce`, est conservé quand le paramètre est omis mais EFFACÉ quand une chaîne vide est
# envoyée. 821 + 3 = **824**, valeur COMPTÉE par `playwright test --list` (« Total: 824 tests »),
# jamais déduite (INC-101). Le garde-fou est RÉVISÉ, jamais retiré (mécanisme de la décision 51).
# **RÉVISION DU 2026-08-21 — `CRM-046`, tranche 3.** Le scénario « aucune card du seed n'atteint son
# seuil de relance » de `e2e/api/board.spec.ts` figeait une ABSENCE que le seed comble désormais : il
# est RETOURNÉ et devient TROIS scénarios — exactement une card au-delà de son seuil et c'est
# `…0c3` à trente jours pour un seuil de quatorze ; ce seuil hérité du nœud et non surchargé par
# l'étape ; et aucune card ARCHIVÉE vieillie au passage. 824 - 1 + 3 = **826**, valeur COMPTÉE par
# `playwright test --list` (« Total: 826 tests »), jamais déduite (INC-101). Le garde-fou est
# RÉVISÉ, jamais retiré (mécanisme de la décision 51).
# **RÉVISION DU 2026-08-21 — `CRM-061`, tranche 1.** `e2e/api/ma-journee.spec.ts` déclare **11**
# scénarios : les neuf lignes du contrat du §17.7 de `docs/SPEC-cards.md`, plus les deux contrôles
# du seed du §13.5 de `docs/SPEC-seed.md`. Aucun autre fichier n'a gagné ni perdu de scénario.
# 826 + 11 = **837**, valeur COMPTÉE par `playwright test --list` (« Total: 837 tests in 49
# files »), jamais déduite (INC-101). Le garde-fou est RÉVISÉ, jamais retiré (décision 51).
# **RÉVISION DU 2026-08-24 — `CRM-062`, tranche 1.** `e2e/api/relances.spec.ts` déclare **11**
# scénarios : les dix lignes du contrat d'API du §4 de `docs/SPEC-relances.md`, plus le constat que
# le seed sort intact. Aucun autre fichier n'a gagné ni perdu de scénario. 837 + 11 = **848**,
# valeur COMPTÉE par `playwright test --list`, jamais déduite. **RÉVISÉE dans la même session à
# 850** : deux scénarios de COHÉRENCE ont été ajoutés après coup — ils confrontent le verdict de
# `public.cards_figees()` à celui de `webapp/src/lib/carte-figee.ts`, la règle du produit importée
# et non recopiée, sur toutes les affaires que l'administratrice lit. « Total: 850 tests in 50
# files ».
# **RÉVISÉE à 858 par `CRM-062` tranche 2, le 2026-08-24** : `e2e/api/relances.spec.ts` gagne huit
# scénarios — la relance lue dans la timeline par les trois profils réels et par l'anonyme, l'acteur
# nul, le payload aux deux seules clés, l'absence de route `rpc/relancer_cards_figees`, et le
# constat que ces lectures n'ont rien écrit. 850 + 8 = **858**, valeur COMPTÉE.
SCENARIOS_API=858
# 37 depuis `CRM-021` : 13 scénarios de la route d'un track et de sa barre d'onglets
# (`e2e/ui/channels.spec.ts`). Inchangé à `CRM-030`, `CRM-031`, `CRM-032`, `CRM-033` puis
# `CRM-035`, qui ne livrent aucune interface — ni le catalogue de nœuds, ni les workflows, ni la
# mention de divergence, ni l'affectation d'un workflow à un channel, ni la grille champ × étape
# n'ont d'écran. **`CRM-037` est la première unité du chunk 3 à en livrer un** : la route de détail
# d'une card, qui reste un écran d'appelant anonyme tant qu'INC-021 n'est pas tranchée.
# **50 depuis la reprise de `CRM-037`** : trois scénarios de plus pour la coquille de cet écran.
# **71 depuis `CRM-041`** : vingt et un scénarios de board — colonnes, menu de transitions, dépôt
# autorisé, dépôt refusé sans appel émis, retour arrière, saisie du motif exigé, quatre paliers et
# la vidéo du glisser-déposer.
# **72 après la correction de l'écart au §7.5** (décision 180) : un scénario de plus pour le repli
# du libellé d'une transition sans nom, que les onze transitions du seed ne peuvent pas exercer et
# qu'aucune preuve n'atteignait.
# **99 depuis `CRM-042`** : vingt-sept scénarios de vue liste — le tableau et ses cinq colonnes, le
# tri et son `aria-sort`, la clôture des clés de tri, les deux filtres, la pagination et son `416`,
# la bascule entre les deux vues, les données longues à deux paliers, et les quatre paliers.
# **113 depuis `CRM-043`** : quatorze scénarios de panneau de commentaires — l'appelant anonyme qui
# n'atteint jamais le panneau, la requête du fil observée sur la VRAIE API avec sa réponse vide, les
# trois états d'un commentaire (vivant, modifié, pierre tombale), les auteurs nommés, le
# fil vide, le composeur et son état désactivé, le `403` affiché sans perdre le texte saisi, la
# publication au clavier, les quatre paliers et un commentaire très long.
# Valeur MESURÉE, non déduite.
# **127 depuis `CRM-044`** : quatorze scénarios de timeline unifiée — l'appelant anonyme qui
# n'émet AUCUNE requête d'événements faute de card, le fil où la parole se range AU MILIEU des
# faits, la résolution des libellés d'étape et de champ, les acteurs nommés, les quatre
# bascules et leur compte qui suit la SOURCE, le filtre qui masque sans relire, le clavier, les deux
# vides distincts, l'absence de toute persistance, et les quatre paliers.
# Valeur MESURÉE, non déduite.
# **136 depuis `CRM-047`** : neuf scénarios de `e2e/ui/manuel.spec.ts`. Huit exercent, SANS AUCUNE
# SUBSTITUTION, les huit adresses que `docs/manual.md` cite, et exigent le libellé EXACT que le
# manuel promet — c'est la seule preuve du dépôt dont l'objet est une phrase de documentation. Le
# neuvième substitue un événement `channel_changed` pour MESURER INC-077, que rien d'autre ne rend
# visible : le fil n'est jamais atteint par un anonyme. `CRM-019` conserve ce scénario et le fait
# désormais exiger « Dossier changé » : la résolution change le verdict, pas le compteur.
# Valeur MESURÉE, non déduite.
# **142 lors de la première livraison de `CRM-009`** : six scénarios connectés sans substitution — refus
# générique, session limitée à l'onglet et déconnexion, publication puis relecture d'un commentaire,
# refus du `viewer` avec texte conservé, déplacement du `viewer` refusé et inchangé, déplacement
# administrateur puis relecture d'une card d'essai, et les quatre paliers de l'écran de connexion.
# Les écritures sont nettoyées par identifiant ou contenu.
# **144 depuis la clôture de `CRM-009`** : fermeture d'un onglet prouvant la disparition de sa
# session, puis parcours destinataire réel depuis l'interface Inbucket jusqu'à la session GoTrue,
# URL nettoyée, `localStorage` vide et contenu français rendu. La console stricte s'applique aux
# deux scénarios comme à tous les autres.
# **145 depuis `CRM-022`** : un parcours clavier/souris sans substitution traverse le header,
# board, liste, commentaire et timeline, puis vérifie les avatars locaux et le mobile sans
# débordement. Les scénarios historiques nomment désormais aussi auteurs et acteurs.
# Valeur MESURÉE par la liste Playwright, puis par l'exécution complète.
# **152 DEPUIS `CRM-012`, ET LE COMPTEUR ÉTAIT RESTÉ EN ARRIÈRE** — même défaut qu'à `CRM-045`,
# relevé cette fois en exécutant la campagne complète : `e2e/ui/droits-fins.spec.ts` porte **sept**
# scénarios livrés par le commit « Prouve les droits fins à l'écran et ouvre INC-085 », et ce
# fichier réclamait toujours 145. Une révision manquée rend le harnais rouge pour une raison qui ne
# regarde pas l'unité en cours, et fait porter le soupçon sur elle.
# **157 depuis la reprise de `CRM-043`** : `e2e/ui/commentaires-gestes.spec.ts` livre les cinq
# scénarios que l'unité devait à INC-021 — correction avec relecture de la base, suppression
# confirmée puis pierre tombale vidée, pierre tombale sans geste, parcours clavier sans aucun
# survol, et la garde qui interdit à ce fichier de mesurer avec la clé anonyme ce qu'il prétend
# mesurer avec la clé de service. Aucun scénario n'y substitue de réponse.
# Valeur MESURÉE par l'exécution complète : 157 scénarios verts, aucune erreur console.
# **163 depuis `CRM-057`** : `e2e/ui/inbox.spec.ts` livre les six scénarios de l'inbox globale —
# les trois panneaux, la sélection annoncée par `aria-current`, le parcours entièrement au clavier,
# la double visibilité d'un message classé, le tri d'un non classé relu par l'API, et les quatre
# paliers. Valeur MESURÉE par l'exécution complète.
# **167 depuis `CRM-058`** : `e2e/ui/envoi.spec.ts` livre les quatre scénarios de la composition —
# écrire depuis la card, la saisie incomplète dite avant tout aller-retour, répondre depuis l'inbox
# en visant la même affaire, et l'absence d'action de réponse sur un message non classé.
# **182 pour la même raison** : l'écran d'administration de l'arborescence et l'écran d'état de la
# messagerie apportent leurs parcours, captures comprises. Valeur COMPTÉE par `--list`.
# **185 depuis `CRM-043`** (INC-101, le 2026-08-14) : `e2e/ui/commentaires-gestes.spec.ts` passe de
# **5 à 8 scénarios** déclarés avec le geste de modération du lot G — la confirmation, la pierre
# tombale, et l'action unique opposée au commentaire d'un tiers. Aucun autre fichier d'`e2e/ui/` n'a
# changé depuis, et le compte se reconstitue à l'unité : 182 + 3 = **185**.
# Valeur COMPTÉE par `--list` (185 tests dans 17 fichiers), puis confrontée au nombre de verts.
# **193 depuis `CRM-076`** (le 2026-08-14) : `e2e/ui/administration-workflows.spec.ts` livre les
# huit scénarios de l'éditeur de workflows — les six gestes à la souris confirmés en base, le refus
# réel d'une étape occupée, le parcours au clavier seul, les quatre paliers et leurs captures.
# 185 + 8 = **193**, valeur MESURÉE par l'exécution complète (193 verts).
# **201 depuis la DEUXIÈME tranche de `CRM-076`** (le 2026-08-14) : le même fichier gagne les huit
# scénarios des transitions — les trois gestes à la souris confirmés en base, le refus d'unicité
# obtenu par une course réelle, les trois gestes au clavier seul, la capture du formulaire ouvert
# et les quatre paliers du bloc des arêtes. 193 + 8 = **201**, valeur MESURÉE par l'exécution
# complète (201 verts, 5,0 min).
# **210 depuis la TROISIÈME tranche de `CRM-076`** (le 2026-08-14) : le même fichier gagne les neuf
# scénarios des champs de formulaire — les cinq gestes à la souris confirmés en base, la déclaration
# d'un champ à choix avec le refus de deux clés identiques que la base accepterait, le refus réel
# d'une clé déjà prise, le parcours au clavier seul, la capture du formulaire ouvert et les quatre
# paliers du bloc des champs. 201 + 9 = **210**, valeur MESURÉE par l'exécution complète.
# **219 depuis la QUATRIÈME tranche de `CRM-076`** (le 2026-08-15) : le même fichier gagne les neuf
# scénarios de la grille champ × étape — la grille lue contre les règles seedées, le réglage puis le
# changement d'une même case par `upsert`, le retour au défaut vérifié par l'absence de ligne en
# base, le parcours au clavier seul, le compte des quinze règles seedées retrouvé après la campagne,
# la capture de la grille et les quatre paliers. 210 + 9 = **219**, valeur MESURÉE par l'exécution
# complète du fichier (34 verts) puis par la campagne entière.
# **241 depuis les CINQUIÈME et SIXIÈME tranches de `CRM-076`** (le 2026-08-15) : les deux tranches
# ont été livrées par des sessions concurrentes qui n'ont pas pu MESURER la campagne entière, et
# elles ont laissé le compteur à 219 en le disant. Il est porté ici sur une mesure, jamais sur une
# addition d'annonces : `--list` compte **241 tests dans 18 fichiers**, dont **56** pour
# `e2e/ui/administration-workflows.spec.ts` contre 34 à la quatrième tranche, et la campagne
# complète rend **241 verts en 5,4 min**. 219 + 22 = **241**. Les vingt-deux se répartissent en
# treize pour les exigences de transition — les exigences seedées et leur origine, l'exigence de
# règle sans commande de retrait, les deux gestes à la souris puis au clavier, les choix privés du
# champ déjà exigé et de l'archivé, le refus `23505`, la liaison sans effet, le seed retrouvé, et
# les quatre paliers — et neuf pour la prévisualisation des effets — les deux nombres mesurés
# contre le seed, le renoncement vérifié par l'absence de ligne, la confirmation au clavier seul,
# les quinze règles retrouvées, et les quatre paliers.
#
# CE CONTRÔLE A JOUÉ DEUX FOIS DANS LA MÊME JOURNÉE, et les deux fois il a désigné un vrai défaut,
# jamais un compteur à rafraîchir : une boucle de rendu du formulaire d'exigence, qui faisait partir
# les appels RPC sans fin, puis trois parcours clavier dont le tour du document dépassait le délai
# par défaut sous la charge de la campagne. Aucun des deux n'aurait été vu par une exécution isolée.
# Porté de 366 à 368 par `CRM-042` : deux scénarios ajoutés à `e2e/ui/liste-cards.spec.ts` — le
# parcours complet de l'accueil à la seconde page, et le même chemin au clavier seul.
#
# CONFIRMÉ le 2026-08-18, et par une mesure directe. La valeur avait d'abord été posée par
# DÉDUCTION, le poste Docker étant tombé (INC-145, décision 435) — et un compteur dérivé qui se
# croit mesuré est exactement ce que ce harnais existe pour attraper. Il restait pourtant un moyen
# de le mesurer sans la pile : `playwright test --list` ÉNUMÈRE les scénarios sans en exécuter un
# seul. Il rend **368 tests dans 28 fichiers**. La déduction était juste, et elle est désormais
# une observation. Le projet `api` a été confirmé de la même façon, à **678**.
#
# Porté de 368 à **370** par `CRM-033`, qui livre enfin ses deux preuves d'interface
# (`docs/SPEC-workflow-engine.md` §4.12.9) : le sélecteur de workflow comparé par égalité sous deux
# tracks, et la course du §7.2 reproduite jusqu'au refus du trigger. Le fichier
# `e2e/ui/coherence-workflow.spec.ts` porte le total des fichiers de 28 à **29**. Valeur MESURÉE
# par `playwright test --list`, contrôle « 2 bis » de la décision 441, puis par l'exécution.
#
# Porté de 370 à **379** par `CRM-060` tranche 4a, qui livre le carnet de contacts
# (`docs/SPEC-contacts.md` §10) : `e2e/ui/contacts.spec.ts` ajoute **neuf** scénarios — quatre de
# parcours (la barre latérale mène au carnet, les cellules vides restent vides, la lectrice lit le
# carnet, le clavier seul l'atteint), les **quatre paliers** du §7, et l'état vide anonyme. Le
# fichier porte le total des fichiers de 29 à **30**. Valeur MESURÉE par l'énumération du contrôle
# « 2 bis » — 379 énumérés — puis par l'exécution de la suite, 9/9 verts.
#
# Porté de 379 à **390** par `CRM-060` sous-tranche 4b, qui livre la fiche d'organisation
# (`docs/SPEC-contacts.md` §11) : `e2e/ui/contacts.spec.ts` gagne **onze** scénarios — sept de
# parcours (le carnet mène à la fiche, l'organisation sans domaine ni site, celle sans contact,
# l'identifiant inconnu et le mal formé rendant le même écran, le clavier, la lectrice, l'appelant
# anonyme) et les **quatre paliers** du §7. Le nombre de FICHIERS est inchangé, à 30 : les
# scénarios rejoignent un fichier existant. Valeur MESURÉE par `playwright test --list`
# (« Total: 390 tests in 30 files »), puis par l'exécution de la suite complète, **390 verts,
# aucun échec**.
#
# Porté de 390 à **398** par `CRM-060` sous-tranche 4c, qui livre le rattachement d'un contact à
# une affaire (`docs/SPEC-contacts.md` §12) : le fichier NEUF `e2e/ui/contacts-affaire.spec.ts`
# ajoute **huit** scénarios — la lecture du rattachement du seed, la place du bloc dans la colonne
# gauche mesurée à l'écran, le rattachement PUIS le détachement par les gestes de l'écran, le même
# parcours au clavier, le refus d'insertion opposé à la lectrice, son détachement SANS EFFET, l'état
# vide qui garde son formulaire, et les **quatre paliers** du §7 en un scénario. Le nombre de
# FICHIERS passe de 30 à **31**. Valeur MESURÉE par `playwright test --list`
# (« Total: 398 tests in 31 files »), puis par l'exécution de la suite neuve, **8/8 verts**,
# rejouée trois fois de suite sans intermittence.
#
# Porté de 398 à **404** par `CRM-060` sous-tranche 4d, qui livre les deux sélecteurs de référence
# du formulaire (`docs/SPEC-contacts.md` §13) : le fichier NEUF
# `e2e/ui/formulaire-selecteurs.spec.ts` ajoute **six** scénarios — les deux champs seedés rendus en
# NOMS et non en identifiants, les listes offertes avec leur option vide, le changement enregistré
# qui survit au rechargement PUIS rétabli par le même geste, le parcours au clavier, le refus
# traduit opposé à la lectrice, et les **quatre paliers** du §7 en un scénario. Le nombre de
# FICHIERS passe de 31 à **32**. Valeur MESURÉE par `playwright test --list`
# (« Total: 404 tests in 32 files »), puis par l'exécution de la suite neuve, **6/6 verts**.
#
# Porté de 404 à **407** par `CRM-060` sous-tranche 4e, livrée en parallèle par une autre session :
# `e2e/ui/carnet-creation.spec.ts` ajoute **trois** scénarios et le fichier n'avait pas été révisé
# avec eux. Valeur REMESURÉE ici par `playwright test --list` après synchronisation avec
# `origin/main` (« Total: 407 tests in 33 files »), plutôt que laissée fausse — un compteur figé qui
# rougit ne dit plus rien du produit.
#
# Porté de 407 à **408** par l'achèvement de `CRM-060` sous-tranche 4e : le §14.8 exigeait le
# **parcours clavier**, qui manquait, et `e2e/ui/carnet-creation.spec.ts` le porte désormais — il
# est la preuve, sur la pile réelle, que fermer le formulaire REND le focus à la commande
# d'ouverture (cas c du §14.5), défaut trouvé et corrigé le 2026-08-19. Le nombre de FICHIERS ne
# bouge pas. Valeur MESURÉE par `playwright test --list` (« Total: 408 tests in 33 files »), puis
# par l'exécution de la suite entière, **408 verts, aucun échec**.
#
# Porté de 408 à **420** par `CRM-060` sous-tranche 4f, la fiche d'un contact : `e2e/ui/contacts.spec.ts`
# reçoit **douze** scénarios — la fiche atteinte depuis le carnet, le lien vers une affaire SUIVI
# jusqu'à l'affaire elle-même, l'état vide d'un contact sans affaire, la fiche d'organisation qui y
# mène à son tour, l'introuvable sous ses deux formes, la LECTRICE dont les droits fins vident la
# zone des affaires, l'accès sans session, le parcours clavier et les quatre paliers. Le nombre de
# FICHIERS ne bouge pas. Valeur MESURÉE par `playwright test --list`
# (« Total: 420 tests in 33 files »), puis par l'exécution de la suite entière.
#
# Porté de 420 à **424** par `CRM-060` sous-tranche 4g, la modification d'un contact :
# `e2e/ui/contacts.spec.ts` reçoit **quatre** scénarios — le formulaire prérempli dans le flux avec
# la zone 1 et le TITRE de la route qui suivent, puis le seed restitué PAR LES GESTES DE L'ÉCRAN ;
# le retour du focus à la commande d'ouverture au CLAVIER ; le silence du serveur DIT à la lectrice
# avec sa saisie conservée ; et le rendu à 390 px sans débordement. Le nombre de FICHIERS ne bouge
# pas. Valeur MESURÉE par `playwright test --list` (« Total: 424 tests in 33 files »).
# **RÉVISION DU 2026-08-19 — `CRM-060` sous-tranche 4h.** Quatre scénarios d'interface ajoutés : le
# rattachement par les gestes de l'écran, le parcours clavier, le refus opposé à la lectrice et le
# rendu à 390 px. 424 + 4 = **428**, valeur COMPTÉE par `playwright test --list` (« Total: 428 tests
# in 33 files »).
# **RÉVISION DU 2026-08-19 — `CRM-060` sous-tranche 4i.** Quatre scénarios d'interface ajoutés : le
# détachement par les gestes de l'écran avec l'exclusivité des confirmations, le parcours clavier,
# le SILENCE opposé à la lectrice — où la ligne RESTE —, et le rendu à 390 px. 428 + 4 = **432**,
# valeur COMPTÉE par `playwright test --list` (« Total: 432 tests in 33 files »).
# **RÉVISION DU 2026-08-19 — `CRM-060` sous-tranche 4j.** Cinq scénarios d'interface ajoutés : la
# modification du rôle par les gestes de l'écran avec la cellule réécrite sans relecture,
# l'EFFACEMENT du rôle sur une ligne qui demeure, le parcours clavier avec l'exclusivité ENTRE LES
# DEUX GESTES, le SILENCE opposé à la lectrice — où la saisie RESTE —, et le rendu à 390 px.
# 432 + 5 = **437**, valeur COMPTÉE par `playwright test --list` (« Total: 437 tests in 33 files »).
# **RÉVISION DU 2026-08-20 — voir le bloc « dérive antérieure » plus haut.** 549, valeur COMPTÉE
# par `playwright test --list` (« Total: 549 tests »), dont **+4** pour la sous-tranche 2 bis de
# `CRM-060` : le bloc de suggestion et son lien, le TÉMOIN d'un message sans suggestion,
# l'acceptation au clavier relue par l'API, et les quatre paliers avec la mesure du débordement.
# **RÉVISION DU 2026-08-20 — `CRM-088`.** Huit scénarios d'interface ajoutés par
# `e2e/ui/reglages-comptes-mail.spec.ts` : le parcours depuis l'index des réglages avec la
# vérification de l'ORDRE des entrées, la modification du libellé suivie de la preuve que le secret
# déchiffre toujours, le refus réel d'un port hors bornes avec sa phrase du produit, l'état vide
# d'une lectrice AVEC son geste, et les quatre paliers. 549 + 8 = **557**, valeur COMPTÉE par
# `npm run e2e:ui` (« 557 passed »), jamais déduite. Garde-fou RÉVISÉ, jamais retiré.
# **RÉVISION DU 2026-08-21 — `CRM-089`.** Neuf scénarios d'interface ajoutés par
# `e2e/ui/reglages-identites-mail.spec.ts` : le parcours depuis l'index des réglages avec la
# vérification de l'ORDRE des trois entrées de la famille « messagerie », la modification du
# libellé suivie de la preuve que le secret déchiffre toujours, l'apparition de la SECONDE identité
# quand l'adresse change, le refus réel d'une adresse non conforme avec sa phrase du produit,
# l'état vide d'une lectrice AVEC son geste, et les quatre paliers. 557 + 9 = **566**, valeur
# COMPTÉE par `playwright test --list` (« Total: 566 tests »), jamais déduite. Garde-fou RÉVISÉ,
# jamais retiré.
# **RÉVISION DU 2026-08-21 — `CRM-046`, tranche 3.** Deux scénarios d'interface ajoutés par
# `e2e/ui/anciennete-board.spec.ts` : les trois états de la pastille d'ancienneté rendus sur la
# donnée RÉELLE du seed, sans aucune substitution réseau, avec leurs captures ; et la bascule
# mesurée au palier 390 px, pastille comprise dans la largeur de la carte. 566 + 2 = **568**, valeur
# COMPTÉE par `playwright test --list` (« Total: 568 tests »), jamais déduite. Garde-fou RÉVISÉ,
# jamais retiré.
# **RÉVISION DU 2026-08-21 — `CRM-061`, tranche 1.** `e2e/ui/ma-journee.spec.ts` déclare **13**
# scénarios : le parcours depuis la barre latérale, la teinte de retard portée par l'échéance, les
# deux liens d'une ligne — la fiche et le channel —, la bascule de portée, la lectrice qui voit
# moins, le parcours clavier, la clôture de la portée, les QUATRE paliers — un test chacun, le
# palier étant posé avant la connexion — et les deux états vides en visiteur anonyme.
# 568 + 13 = **581**, valeur COMPTÉE par `playwright test --list` (« Total: 581 tests in 47
# files »), jamais déduite. Garde-fou RÉVISÉ, jamais retiré.
#
# **RÉVISION DU 2026-08-25 — `CRM-062`, tranche 3, révision EN RETARD d'une livraison.** L'écran
# `/affaires-figees` a été livré le 2026-08-24 avec `e2e/ui/affaires-figees.spec.ts` et ses **neuf**
# scénarios — le parcours depuis la barre latérale, le classement par retard, le regroupement par
# dossier, la lectrice qui voit un dossier de moins, le clavier, les quatre paliers —, sans que ce
# compteur ne soit repris dans le même changement. Le harnais a donc rendu `31 contrôles, 2
# anomalies` au rejeu de la série, les DEUX portant ce seul écart : « projet ui : 581 attendus, 590
# énumérés » et « e2e:ui VERT mais 590 scénarios au lieu de 581 ». Le second mot compte : la suite
# est verte, aucun scénario n'a disparu, et c'est le garde-fou qui est en retard, pas le produit.
# 581 + 9 = **590**, valeur COMPTÉE par `playwright test --list` (« Total: 590 tests in 48 files »)
# et corroborée par le décompte de la décision 506 bis, jamais déduite. Garde-fou RÉVISÉ, jamais
# retiré : un compte qui MONTE reste un écart au même titre qu'un compte qui descend.
#
# **`CRM-083` tranche 2g, le 2026-08-25** : `e2e/ui/objectifs.spec.ts` gagne **trois** scénarios —
# créer puis archiver un tableau entièrement au clavier sans perdre le focus, `Échap` refermant les
# trois surfaces de la liste sans rien écrire, et les quatre paliers gardant la confirmation
# utilisable au clavier. 590 + 3 = **593**, valeur COMPTÉE par `playwright test --list`
# (« Total: 593 tests in 48 files »), jamais déduite. Le compteur est repris DANS LE MÊME
# CHANGEMENT que les scénarios, ce qui est précisément ce que la révision ci-dessus reprochait à la
# livraison de `/affaires-figees`.
SCENARIOS_UI=594
# Projet `mail`, DÉCLARÉ POUR LA PREMIÈRE FOIS par `CRM-050` : il était annoncé par `README.md` §7
# et laissé vide par `CRM-008`, faute de sujet à exercer (INC-023).
# **16 scénarios** : trois sessions IMAP réelles (une par boîte), le refus d'un mot de passe faux,
# le délimiteur de hiérarchie annoncé par le serveur, la remise par le catch-all d'une adresse de
# card jamais déclarée et sa relecture, le refus d'une soumission non authentifiée, trois contrôles
# de l'API de gestion — anonyme, mot de passe faux, inventaire des boîtes —, trois contrôles de
# ClamAV — PONG, détection d'EICAR, contre-épreuve sur un contenu anodin — et trois scénarios
# Roundcube, dont deux produisent les captures de l'unité.
# Valeur MESURÉE, non déduite.
# **21 DEPUIS `CRM-051`, ET LE COMPTEUR ÉTAIT RESTÉ EN ARRIÈRE LUI AUSSI** — troisième compteur
# pris en défaut par la même campagne (voir `SCENARIOS_UI` ci-dessus). Le service `mail-sync`
# a livré cinq scénarios de protocole supplémentaires, et son propre compte rendu les annonçait
# — « `npm run e2e:mail` 21/21 » — sans que ce fichier soit révisé dans le même changement.
# Valeur MESURÉE par l'exécution complète.
# **27 depuis `CRM-052`** : six scénarios ouvrent de VRAIES sessions IMAP contre le Stalwart de
# `CRM-050` — succès et `LIST` sur la boîte système, `auth_failed` après changement de secret,
# `tls_failed` sur le certificat auto-signé, `connection_refused` faute de listener 993, compte
# inconnu, et jeton exigé. Chaque scénario relit la BASE, pas seulement la réponse HTTP.
# **39 depuis `CRM-058`** : `e2e/mail/envoi.spec.ts` ajoute l'ALLER-RETOUR complet — mise en file
# par la vraie garde, soumission par le worker, réception dans la boîte du destinataire, réponse à
# l'adresse du `Reply-To`, et retour de cette réponse dans la même card par la relève.
# **41 depuis `CRM-059`** : `e2e/mail/resilience.spec.ts` ajoute la COUPURE RÉELLE — l'identité
# pointée vers un port fermé, le message reprogrammé plutôt que perdu, puis parti au retour du
# serveur — et la reprise d'un envoi orphelin abandonné par un worker mort.
# **42** (INC-101, le 2026-08-14) : `e2e/mail/backfill.spec.ts` est le seul fichier de scénario
# AJOUTÉ à `e2e/mail/` depuis, et il en déclare **1**. Aucun des dix autres n'a gagné ni perdu de
# scénario : 41 + 1 = **42**. Valeur COMPTÉE par `--list` (42 tests dans 11 fichiers), puis
# confrontée au nombre de verts.
# CONFIRMÉ le 2026-08-18 par listage direct, Docker absent : `--list` rend 42 tests dans 11
# fichiers. Il rendait « 0 test dans 0 fichier » quelques heures plus tôt — neuf specs appelaient
# `docker` à l'import et faisaient échouer la collecte du projet entier (INC-151, corrigée).
SCENARIOS_MAIL=42

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

# Tout ce que les contrôles de non-complaisance altèrent est restauré quoi qu'il arrive : la
# suite pgTAP mutée, le test unitaire faux, la politique RLS posée, et le serveur de rapport.
menage() {
	[ -f "$TRAVAIL/suite.sql" ] && cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"
	rm -f "$TEST_FAUX" "$SUITE_FAUX_VERT"
	psql_db -c "drop policy if exists \"$POLITIQUE\" on public.workspaces;" >/dev/null 2>&1 || true
	[ -n "${PID_RAPPORT:-}" ] && kill "$PID_RAPPORT" 2>/dev/null || true
	rm -rf "$TRAVAIL"
}

echo
echo "Preuves de CRM-008 — harnais de tests"
echo

# --- 1. Prérequis ------------------------------------------------------------------------------

echo "1. Prérequis"

# Cette validation précède même le répertoire temporaire : aucune dégradation ne peut être
# déclarée correctement refusée si l'exécuteur commun était déjà inutilisable (décision 278).
if node_toolchain_prepare "$PWD/.nvmrc"; then
	ok "Node $NODE_TOOLCHAIN_NODE_VERSION / npm $NODE_TOOLCHAIN_NPM_VERSION Linux via $NODE_TOOLCHAIN_SOURCE ($NODE_TOOLCHAIN_NODE_PATH)"
else
	exit 1
fi

TRAVAIL=$(mktemp -d)
trap menage EXIT

if scripts/verify-node-toolchain.sh >"$TRAVAIL/node-toolchain.log" 2>&1; then
	ok "résolution Node éprouvée en environnement isolé (5 contrôles)"
else
	fail "la preuve isolée de résolution Node échoue"
	sed 's/^/        /' "$TRAVAIL/node-toolchain.log" | tail -n 20
	exit 1
fi

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh." >&2
	exit 1
fi
if ! docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

comptes_seed=$(psql_db -c "select count(*) from public.profiles where id::text like '5eed%';")
if [ "$comptes_seed" -ge 3 ]; then
	ok "pile démarrée et seed appliqué ($comptes_seed profils seedés)"
else
	echo "ERREUR : seed non appliqué. Lancez supabase/seed/apply-seed.sh." >&2
	exit 1
fi

cp "$SUITE_MUTABLE" "$TRAVAIL/suite.sql"

# La suite évolue avec le produit. Les contre-épreuves visent sa structure courante, jamais une
# valeur de plan historique qui finirait par ne plus correspondre à aucune ligne (décision 308).
nombre_plans=$(grep -cE '^select plan\([0-9]+\);$' "$SUITE_MUTABLE" || true)
plan_suite=$(sed -nE 's/^select plan\(([0-9]+)\);$/\1/p' "$SUITE_MUTABLE")
if [ "$nombre_plans" -ne 1 ] || [ -z "$plan_suite" ]; then
	echo "ERREUR : $SUITE_MUTABLE doit porter exactement un select plan(N)." >&2
	exit 1
fi

# --- 2. npm run test:sql -----------------------------------------------------------------------

echo
echo "2. npm run test:sql — suites pgTAP"

if npm run --silent test:sql >"$TRAVAIL/sql.log" 2>&1; then
	resumes=$(grep -cE '[0-9]+ fichiers, [0-9]+ assertions, aucune anomalie' "$TRAVAIL/sql.log" || true)
	resume=$(grep -oE '[0-9]+ fichiers, [0-9]+ assertions, aucune anomalie' "$TRAVAIL/sql.log" | tail -n 1 || true)
	fichiers=$(printf '%s' "$resume" | grep -oE '^[0-9]+' || echo 0)
	assertions=$(printf '%s' "$resume" | grep -oE '[0-9]+ assertions' | grep -oE '^[0-9]+' || echo 0)
	if [ "$resumes" -ne 1 ]; then
		fail "npm run test:sql vert mais son résumé apparaît $resumes fois au lieu d'une"
		sed 's/^/        /' "$TRAVAIL/sql.log" | tail -n 20
	elif [ "${fichiers:-0}" -eq "$FICHIERS_SQL_ATTENDUS" ] \
		&& [ "${assertions:-0}" -eq "$ASSERTIONS_ATTENDUES" ]; then
		ok "npm run test:sql : $fichiers fichiers, $assertions assertions, aucune anomalie"
	else
		fail "npm run test:sql vert mais $fichiers fichiers / $assertions assertions au lieu de $FICHIERS_SQL_ATTENDUS / $ASSERTIONS_ATTENDUES"
	fi
else
	fail "npm run test:sql échoue"
	sed 's/^/        /' "$TRAVAIL/sql.log" | tail -n 20
fi

# --- 2 bis. Les trois compteurs, ÉPROUVÉS SANS INFRASTRUCTURE ------------------------------------
#
# AJOUTÉ le 2026-08-18, et le motif est un défaut RÉCURRENT de ce dépôt : les compteurs de scénarios
# dérivent. Ils n'étaient jusqu'ici confrontés au réel qu'APRÈS l'exécution complète des suites —
# donc jamais sans Docker, et jamais vite. Plusieurs unités ont livré des scénarios sans réviser le
# compteur, dont `CRM-042` le 2026-08-17 (décision 435).
#
# `playwright test --list` ÉNUMÈRE les scénarios sans en exécuter un seul : ni base, ni services, ni
# navigateur. La dérive est donc détectable en quelques secondes, et sur un poste sans pile. Ce
# contrôle ne remplace pas la vérification d'après exécution — il la DEVANCE, et dit lequel des deux
# nombres a bougé avant qu'on ait payé le prix d'un balayage complet.
#
# Le dénombrement de `mail` n'était lui-même possible que depuis la correction d'INC-151 : neuf de
# ses onze specs appelaient `docker` à l'import et faisaient échouer la collecte du projet entier.

# `titre` N'EXISTE PAS DANS CE FICHIER, et cet appel le tuait ici même — INC-156, mesuré le
# 2026-08-18 des deux côtés d'un `git stash`, donc antérieur. Sous `set -e`, « titre: command not
# found » interrompait le harnais À CETTE LIGNE : tout ce qui suit — le dénombrement, les projets
# `ui` et `mail`, les sections suivantes — n'a jamais été exécuté depuis que cette ligne existe, et
# le harnais rendait pourtant un verdict. Les autres en-têtes du fichier emploient `echo`.
echo
echo "2 bis. Dénombrement des scénarios, sans exécuter une seule suite"

for projet in api ui mail; do
	case "$projet" in
		api)  attendu=$SCENARIOS_API ;;
		ui)   attendu=$SCENARIOS_UI ;;
		mail) attendu=$SCENARIOS_MAIL ;;
	esac
	denombre=$(E2E_PROJETS="$projet" npx playwright test --config e2e/playwright.config.ts \
		--project="$projet" --list 2>&1 | sed -n 's/^Total: \([0-9]*\) tests.*/\1/p' | tail -1)
	if [ "${denombre:-vide}" = "$attendu" ]; then
		ok "projet $projet : $denombre scénarios énumérés, conforme au compteur"
	else
		fail "projet $projet : $attendu attendus, ${denombre:-aucun} énumérés"
	fi
done

# --- 3. npm run e2e:api ------------------------------------------------------------------------

echo
echo "3. npm run e2e:api — contrats et refus, hors interface"

if npm run --silent e2e:api >"$TRAVAIL/api.log" 2>&1; then
	passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -n 1 | grep -oE '^[0-9]+' || echo 0)
	if [ "${passes:-0}" -eq "$SCENARIOS_API" ]; then
		ok "npm run e2e:api : $passes scénarios verts (A1 à A6, preuve de refus n° 11 comprise)"
	else
		fail "npm run e2e:api vert mais $passes scénarios au lieu de $SCENARIOS_API"
	fi
else
	fail "npm run e2e:api échoue"
	sed 's/^/        /' "$TRAVAIL/api.log" | tail -n 25
fi

# --- 4. Le projet `api` ne construit ni ne sert la webapp --------------------------------------
# Mesuré, et non déduit de l'absence de `webServer` dans la configuration : le build est
# supprimé avant l'exécution. S'il réapparaît, c'est que `npm run build && npm run preview` a
# tourné — ce que la décision 49 vise précisément à éviter.

echo
echo "4. Le projet api ne démarre aucun serveur web"

rm -rf webapp/dist
npm run --silent e2e:api >/dev/null 2>&1 || true
if [ ! -e webapp/dist ]; then
	ok "webapp/dist n'a pas été recréé : aucun build, aucun serveur de prévisualisation"
else
	fail "webapp/dist a été recréé : le webServer a démarré pour le projet api"
fi

# --- 5. npm run e2e:ui -------------------------------------------------------------------------

echo
echo "5. npm run e2e:ui — projet d'interface de CRM-007, non régressé"

if npm run --silent e2e:ui >"$TRAVAIL/ui.log" 2>&1; then
	passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -n 1 | grep -oE '^[0-9]+' || echo 0)
	if grep -qi 'warning' "$TRAVAIL/ui.log"; then
		fail "npm run e2e:ui est vert mais sa console contient un avertissement"
	elif [ "${passes:-0}" -eq "$SCENARIOS_UI" ]; then
		ok "npm run e2e:ui : $passes scénarios verts contre le build servi, aucun avertissement"
	else
		fail "npm run e2e:ui vert mais $passes scénarios au lieu de $SCENARIOS_UI"
	fi
else
	fail "npm run e2e:ui échoue"
	sed 's/^/        /' "$TRAVAIL/ui.log" | tail -n 25
fi

if [ -s webapp/dist/index.html ]; then
	ok "webapp/dist reconstruit par le projet ui : l'état d'avant le contrôle 4 est rétabli"
else
	fail "webapp/dist absent après le projet ui"
fi

# --- 5 bis. npm run e2e:mail -------------------------------------------------------------------
# Le projet `mail` ne parle qu'aux serveurs de messagerie : il n'a besoin ni du build de la webapp
# ni du `webServer`. Un harnais qui l'ignorerait laisserait un projet entier hors de son périmètre,
# ce qui est exactement le défaut que `CRM-008` s'interdit.

echo
echo "5 bis. npm run e2e:mail — protocoles de messagerie, projet livré par CRM-050"

if npm run --silent e2e:mail >"$TRAVAIL/mail.log" 2>&1; then
	passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/mail.log" | tail -n 1 | grep -oE '^[0-9]+' || echo 0)
	if [ "${passes:-0}" -eq "$SCENARIOS_MAIL" ]; then
		ok "npm run e2e:mail : $passes scénarios verts (IMAP, SMTP, ClamAV, Roundcube réels)"
	else
		fail "npm run e2e:mail vert mais $passes scénarios au lieu de $SCENARIOS_MAIL"
	fi
else
	fail "npm run e2e:mail échoue"
	sed 's/^/        /' "$TRAVAIL/mail.log" | tail -n 25
fi

# --- 6. npm run test:unit et 7. npm run typecheck ----------------------------------------------

echo
echo "6. npm run test:unit et npm run typecheck"

if npm run --silent test:unit >"$TRAVAIL/unit.log" 2>&1; then
	ok "npm run test:unit : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/unit.log" | tail -n 1)"
else
	fail "npm run test:unit échoue"
	sed 's/^/        /' "$TRAVAIL/unit.log" | tail -n 20
fi

if npm run --silent typecheck >"$TRAVAIL/tsc.log" 2>&1; then
	ok "npm run typecheck : quatre projets compilés, e2e/ compris"
else
	fail "npm run typecheck échoue"
	sed 's/^/        /' "$TRAVAIL/tsc.log" | tail -n 20
fi

# --- 8. npm run e2e:report ---------------------------------------------------------------------

echo
echo "8. npm run e2e:report — le dernier rapport est réellement servi"

if [ -s e2e/report/index.html ]; then
	ok "rapport HTML produit par la dernière exécution E2E"
else
	fail "aucun rapport HTML dans e2e/report/"
fi

PLAYWRIGHT_HTML_HOST=127.0.0.1 PLAYWRIGHT_HTML_PORT="$PORT_RAPPORT" \
	npm run --silent e2e:report >"$TRAVAIL/rapport.log" 2>&1 &
PID_RAPPORT=$!

code_rapport=000
for _ in $(seq 1 20); do
	code_rapport=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_RAPPORT/" || echo 000)
	[ "$code_rapport" = "200" ] && break
	sleep 1
done

if [ "$code_rapport" = "200" ]; then
	ok "npm run e2e:report sert le rapport sur le port $PORT_RAPPORT (HTTP 200 constaté)"
else
	fail "npm run e2e:report ne sert rien : dernier code obtenu $code_rapport"
	sed 's/^/        /' "$TRAVAIL/rapport.log" | tail -n 10
fi

kill "$PID_RAPPORT" 2>/dev/null || true
wait "$PID_RAPPORT" 2>/dev/null || true
PID_RAPPORT=

# --- 9. Non-complaisance -----------------------------------------------------------------------
# Chaque contrôle dégrade réellement le monde, exige l'échec, puis restaure. Un harnais qui
# n'échoue jamais ne prouve rien de ce qu'il affirme.

echo
echo "9. Non-complaisance : six dégradations réelles doivent faire échouer le harnais"

# 9.1 — une assertion volontairement fausse dans une suite pgTAP réelle.
sed -i "s/'P2Enjoy SAS',/'P2Enjoy SARL',/" "$SUITE_MUTABLE"
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "une assertion fausse ne fait pas échouer npm run test:sql"
else
	ok "une assertion fausse fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.2 — plan non tenu ET `finish()` retiré : pgTAP n'émet alors AUCUN diagnostic (décision 48).
# C'est le contrôle qui prouve que le verdict est calculé, et non emprunté à pgTAP.
plan_tronque=$((plan_suite + 1))
sed -i "s/^select plan($plan_suite);$/select plan($plan_tronque);/" "$SUITE_MUTABLE"
sed -i 's/^select \* from finish();$//' "$SUITE_MUTABLE"
sortie_tronquee=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA \
	-v ON_ERROR_STOP=1 -f - < "$SUITE_MUTABLE" 2>&1 || true)
if printf '%s' "$sortie_tronquee" | grep -q 'Looks like you planned'; then
	fail "pgTAP diagnostique le plan tronqué : le contrôle ne prouve pas ce qu'il prétend"
else
	ok "pgTAP n'émet aucun diagnostic sans finish() — le verdict ne peut pas lui être emprunté"
fi
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "un plan non tenu sans finish() ne fait pas échouer npm run test:sql"
else
	ok "un plan non tenu sans finish() fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.3 — erreur SQL : `psql` sort en 3, l'exécuteur doit la relayer.
sed -i "s/^select plan($plan_suite);$/select plan($plan_suite);\nselect fonction_inexistante_crm_008();/" "$SUITE_MUTABLE"
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "une erreur SQL ne fait pas échouer npm run test:sql"
else
	ok "une erreur SQL fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.4 — politique RLS permissive réellement posée : le projet `api` doit la voir.
# C'est le contrôle décisif du projet `api` : sans lui, ses scénarios pourraient se contenter
# de constater une base vide au lieu de mesurer un refus.
psql_db -c "create policy \"$POLITIQUE\" on public.workspaces for select to anon using (true);" >/dev/null
lignes_anon=$(curl -s "http://127.0.0.1:$(sed -n 's/^KONG_HTTP_PORT=//p' .env | tail -1)/rest/v1/workspaces?select=id" \
	-H "apikey: $(sed -n 's/^ANON_KEY=//p' .env | tail -1)" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
if [ "$lignes_anon" -ge 1 ]; then
	ok "la politique permissive est réellement effective : l'anonyme voit $lignes_anon ligne(s)"
else
	fail "la politique posée n'a aucun effet : le contrôle suivant ne prouverait rien"
fi
if npm run --silent e2e:api >/dev/null 2>&1; then
	fail "une politique RLS permissive ne fait pas échouer npm run e2e:api"
else
	ok "une politique RLS permissive fait échouer npm run e2e:api"
fi
psql_db -c "drop policy \"$POLITIQUE\" on public.workspaces;" >/dev/null

# 9.5 — un test unitaire volontairement faux.
cat > "$TEST_FAUX" <<'FAUX'
// Fichier temporaire créé par scripts/verify-harness.sh, supprimé par son trap.
import { expect, test } from 'vitest'
test('assertion volontairement fausse', () => { expect(1).toBe(2) })
FAUX
if npm run --silent test:unit >/dev/null 2>&1; then
	fail "un test unitaire faux ne fait pas échouer npm run test:unit"
else
	ok "un test unitaire faux fait échouer npm run test:unit"
fi
rm -f "$TEST_FAUX"

# 9.6 — plan tenu ligne pour ligne, mais dernières assertions dans un savepoint annulé.
# C'EST LA RÉGRESSION D'UN FAUX VERT RÉEL DE CET EXÉCUTEUR (docs/JOURNAL.md, décision 79). pgTAP
# tient deux comptes : la numérotation, portée par une séquence que rien n'annule, et le compte relu
# par `finish()`, porté par une table qu'un `rollback to savepoint` annule. Avant le cinquième
# contrôle du §3.2, l'exécuteur comparait `3` à `3`, ne trouvait aucun `not ok`, et rendait `0` sur
# une suite que pgTAP déclarait tronquée.
#
# Le contrôle est écrit en deux temps, et le premier compte autant que le second : il faut d'abord
# constater que la suite **émet bien** autant de lignes que son plan en annonce, sans quoi c'est le
# quatrième contrôle qui la refuserait et le cinquième ne prouverait rien.
cat > "$SUITE_FAUX_VERT" <<'FAUXVERT'
-- Fichier temporaire créé par scripts/verify-harness.sh, supprimé par son trap.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(true, 'assertion hors savepoint');
savepoint s1;
select ok(true, 'assertion dans un savepoint annule');
select ok(true, 'derniere assertion, dans le meme savepoint');
rollback to s1;
select * from finish();
rollback;
FAUXVERT

sortie_faux_vert=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA \
	-v ON_ERROR_STOP=1 -f - < "$SUITE_FAUX_VERT" 2>&1 || true)
emises_faux_vert=$(printf '%s\n' "$sortie_faux_vert" | grep -cE '^(not )?ok ' || true)
if [ "$emises_faux_vert" = "3" ] \
	&& printf '%s' "$sortie_faux_vert" | grep -q 'Looks like you planned 3 tests but ran 1'; then
	ok "la suite piégée émet bien ses 3 lignes tout en étant tronquée pour pgTAP : le quatrième contrôle ne la verrait pas"
else
	fail "la suite piégée n'a pas le comportement attendu ($emises_faux_vert ligne(s)) : le contrôle suivant ne prouverait rien"
fi

if npm run --silent test:sql >/dev/null 2>&1; then
	fail "un plan dénoncé par pgTAP ne fait pas échouer npm run test:sql — le faux vert de la décision 79 est de retour"
else
	ok "un plan dénoncé par pgTAP fait échouer npm run test:sql"
fi
rm -f "$SUITE_FAUX_VERT"

# --- 10. État final ----------------------------------------------------------------------------

echo
echo "10. Le harnais a tout restauré, et le constate"

if cmp -s "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"; then
	ok "la suite pgTAP mutée est identique à l'état reçu avant dégradation"
else
	fail "la suite pgTAP diffère encore de l'instantané pris avant dégradation"
fi

if [ ! -e "$TEST_FAUX" ]; then
	ok "le test unitaire faux est supprimé"
else
	fail "le test unitaire faux subsiste : $TEST_FAUX"
fi

if [ ! -e "$SUITE_FAUX_VERT" ]; then
	ok "la suite pgTAP piégée est supprimée : supabase/tests/ ne contient que les suites versionnées"
else
	fail "la suite pgTAP piégée subsiste : $SUITE_FAUX_VERT"
fi

politiques=$(psql_db -c "select count(*) from pg_policies where schemaname='public' and tablename='workspaces';")
politique_livree=$(psql_db -c "select count(*) from pg_policies where schemaname='public' and tablename='workspaces' and policyname='workspaces_lecture_membre';")
if [ "$politiques" -eq 1 ] && [ "$politique_livree" -eq 1 ]; then
	ok "seule la politique livrée workspaces_lecture_membre subsiste après restauration"
else
	fail "inventaire inattendu après restauration : $politiques politique(s), dont $politique_livree livrée(s)"
fi

if npm run --silent test:sql >/dev/null 2>&1; then
	ok "npm run test:sql redevient vert après restauration"
else
	fail "npm run test:sql reste rouge après restauration"
fi

if npm run --silent e2e:api >/dev/null 2>&1; then
	ok "npm run e2e:api redevient vert après restauration"
else
	fail "npm run e2e:api reste rouge après restauration"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n\n' "$checks" "$failures"
exit 1
