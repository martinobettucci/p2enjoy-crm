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

/**
 * Carnet de contacts — `CRM-060`, `docs/SPEC-contacts.md` §10.2.
 *
 * Une route de PREMIER NIVEAU, et non une section de `/reglages` : un contact est le matériau
 * quotidien d'un commercial, au même titre qu'une affaire — ce que le §3 de la spécification a
 * déjà tranché en base en ouvrant son écriture au `business_developer`, là où les tracks, les
 * channels et les workflows restent à l'`admin`. Les cinq surfaces de `/reglages` administrent la
 * structure du workspace ; le carnet n'administre rien, il travaille.
 */
export const CHEMIN_CONTACTS = '/contacts' as const

/**
 * Fiche d'organisation — `CRM-060` tranche 4b, `docs/SPEC-contacts.md` §11.2.
 *
 * Une route de DÉTAIL sous le carnet, et non une route de premier niveau `/organisations/:id` :
 * une adresse de premier niveau suppose une surface d'entrée qui la peuple, et il n'existe aucune
 * liste d'organisations (§11.8). Le carnet est cette entrée — on atteint une organisation par un
 * de ses contacts.
 *
 * Elle ne figure PAS dans `ROUTES`, exactement comme `CHEMIN_CARD` et `CHEMIN_LISTE` : son titre
 * est le nom de l'organisation, donc une donnée, et son contenu dépend d'un paramètre d'URL. La
 * couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` reste ainsi inchangée.
 *
 * L'organisation est désignée par son IDENTIFIANT : `organizations` ne porte aucun slug, et
 * `domain` ne peut pas en tenir lieu — il est nul pour une organisation sur deux du seed, et une
 * adresse qui n'existe que pour la moitié des lignes n'est pas une adresse.
 */
export const CHEMIN_ORGANISATION = '/contacts/organisations/:idOrganisation' as const

/** Adresse concrète de la fiche d'une organisation donnée. */
export const cheminOrganisation = (idOrganisation: string) =>
	`/contacts/organisations/${idOrganisation}`

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
