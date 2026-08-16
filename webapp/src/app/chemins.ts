// @spec CRM-079 (docs/BACKLOG.md) — adresses des surfaces atteintes hors de `ROUTES`
// @spec docs/SPEC-onboarding.md §4.1 (une adresse propre), §4.3 (entrée dans l'index des réglages)
// @spec docs/SPEC-webapp.md §5.2 (routes) ; docs/SPEC-administration-arborescence.md §3.1 ;
//       docs/SPEC-mail-subsystem.md §20.11.1 ; docs/SPEC-corbeille.md §4.1 ;
//       docs/SPEC-workflow-engine.md §7 bis.2
//
// POURQUOI CE MODULE EXISTE, et il n'existait pas avant `CRM-079`. Ces adresses vivaient dans
// `routes.tsx`, qui rend aussi les écrans. Le guide de démarrage RENVOIE vers deux d'entre elles ;
// l'importer depuis `routes.tsx` aurait créé un cycle `routes → GuideDemarrage → routes`, que
// `CLAUDE.md` §3 interdit. Les constantes descendent donc dans un module sans rendu, dont
// `routes.tsx` les RÉEXPORTE : aucun appelant existant n'est modifié.

/** Adresse de l'inbox globale — `CRM-057`. */
export const CHEMIN_INBOX = '/inbox' as const

/** Administration de l'arborescence — `CRM-075`. */
export const CHEMIN_ADMIN_ARBORESCENCE = '/reglages/arborescence' as const

/** Éditeur de workflows — `CRM-076`. */
export const CHEMIN_ADMIN_WORKFLOWS = '/reglages/workflows' as const

/** Administration du catalogue de nœuds — `CRM-030`, `docs/SPEC-workflow-engine.md` §2 bis.2. */
export const CHEMIN_ADMIN_CATALOGUE = '/reglages/catalogue' as const

/** État de la messagerie — `CRM-059`. */
export const CHEMIN_ETAT_MESSAGERIE = '/reglages/messagerie' as const

/** Corbeille — `CRM-077`. */
export const CHEMIN_CORBEILLE = '/reglages/corbeille' as const

/** Guide de démarrage — `CRM-079`, `docs/SPEC-onboarding.md` §4.1. */
export const CHEMIN_DEMARRAGE = '/demarrage' as const
