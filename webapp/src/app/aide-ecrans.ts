// @spec CRM-068 (docs/BACKLOG.md) — tranche T4b1 : Réglages ▸ Modèles d'affaires mène à sa section (docs/DESIGN_SYSTEM.md §5.71)
// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : la correspondance entre un écran et le chapitre qui le décrit
// @spec CRM-117 tranche T3.0 — les adresses du plan public (docs/SPEC-manual.md §10 bis) : carnet, boîtes, inbox
// @spec docs/SPEC-manual.md §13.2 (un seul endroit, le motif le plus précis l'emporte), §16 (chaque identifiant existe
//       dans le manuel construit) ; docs/DESIGN_SYSTEM.md §5.69 (« Aide sur cet écran ») ; docs/JOURNAL.md décision 740
//
// Module pur. À chaque motif d'adresse, l'identifiant du chapitre et, s'il y a lieu, de la section. L'ordre de la table
// EST la règle : le premier motif qui correspond l'emporte, et les plus précis viennent donc en tête — la fiche d'une
// affaire avant le board de son channel, le détail d'un budget avant les coûts du track.
//
// LES IDENTIFIANTS SONT CEUX DU MANUEL CONSTRUIT (docs/manuel/construit/contents.json). Une réécriture qui change un
// titre change son identifiant : la preuve unitaire de ce module lit le manuel construit et rougit sur un identifiant
// disparu, pour que le lien d'aide ne mène jamais à un chapitre introuvable.

import { matchPath } from 'react-router'
import {
	CHEMIN_ADMIN_ARBORESCENCE,
	CHEMIN_ADMIN_CATALOGUE,
	CHEMIN_ADMIN_COMPTES_MAIL,
	CHEMIN_ADMIN_COUT_PERSONNEL,
	CHEMIN_ADMIN_IDENTITES_MAIL,
	CHEMIN_ADMIN_JOURNAL,
	CHEMIN_ADMIN_MEMBRES,
	CHEMIN_ADMIN_MODELES_MAIL,
	CHEMIN_ADMIN_SEQUENCES_MAIL,
	CHEMIN_ADMIN_MODELES_AFFAIRES,
	CHEMIN_ADMIN_WORKFLOWS,
	CHEMIN_AFFAIRES_FIGEES,
	CHEMIN_CONTACTS,
	CHEMIN_CORBEILLE,
	CHEMIN_COUTS_BUDGET,
	CHEMIN_COUTS_TRACK,
	CHEMIN_COUTS_WORKSPACE,
	CHEMIN_DEMARRAGE,
	CHEMIN_ETAT_MESSAGERIE,
	CHEMIN_INBOX,
	CHEMIN_MA_JOURNEE,
	CHEMIN_OBJECTIFS,
	CHEMIN_PILOTAGE,
	CHEMIN_PLATEFORME,
	CHEMIN_PLATEFORME_MCP,
	CHEMIN_REGLAGES_NOTIFICATIONS,
	CHEMIN_RENTABILITE,
	CHEMIN_TEMPS,
	cheminAide,
} from './chemins'

/** Où mène « Aide sur cet écran » : un chapitre, et une section s'il y a lieu. */
export type CibleAide = { readonly chapitre: string; readonly section?: string }

const AFFAIRE = 'l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre'
const NAVIGUER = 'naviguer-barre-laterale-onglets-etats'
const TEMPS = 'le-temps-passe-et-le-cout-du-personnel'
const BOITES = 'les-boites-de-reception-et-les-adresses-d-expedition'

/**
 * La table, dans l'ordre où elle est consultée. Un motif finissant par `/*` couvre aussi ses sous-adresses.
 * Exportée pour la preuve, qui vérifie chaque identifiant contre le manuel construit.
 */
export const ECRANS_AIDE: ReadonlyArray<readonly [motif: string, cible: CibleAide]> = [
	// Une route de track, du plus précis au moins précis.
	['/tracks/:slugTrack/:slugChannel/cards/:idCard', { chapitre: AFFAIRE, section: 'la-fiche-d-une-affaire-son-en-tete-son-formulaire-et-ce-qu-ils-montrent' }],
	[CHEMIN_COUTS_BUDGET, { chapitre: 'le-detail-d-un-budget-occurrence-par-occurrence-ligne-par-ligne' }],
	[CHEMIN_COUTS_TRACK, { chapitre: 'les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense' }],
	['/tracks/:slugTrack/:slugChannel/liste', { chapitre: AFFAIRE, section: 'la-vue-liste-d-un-channel' }],
	['/tracks/:slugTrack/:slugChannel', { chapitre: AFFAIRE, section: 'le-tableau-kanban-d-un-channel' }],
	['/tracks/:slugTrack', { chapitre: NAVIGUER, section: 'les-onglets-d-un-track' }],
	// Les entrées de la barre latérale.
	['/', { chapitre: NAVIGUER }],
	[CHEMIN_INBOX, { chapitre: 'l-inbox-lire-trier-et-repondre', section: 'l-inbox-lire-et-trier-le-courrier-recu' }],
	[`${CHEMIN_CONTACTS}/*`, { chapitre: 'le-carnet-de-contacts' }],
	[CHEMIN_MA_JOURNEE, { chapitre: 'ma-journee-ce-qui-est-en-retard-ce-qui-est-du-aujourd-hui' }],
	[CHEMIN_AFFAIRES_FIGEES, { chapitre: 'les-affaires-figees-ce-qui-dort-depuis-trop-longtemps' }],
	[`${CHEMIN_OBJECTIFS}/*`, { chapitre: 'les-objectifs-le-tableau-blanc-de-l-equipe' }],
	[CHEMIN_COUTS_WORKSPACE, { chapitre: 'les-couts-de-tout-l-espace-de-travail-un-cumul-par-track' }],
	[CHEMIN_PILOTAGE, { chapitre: 'l-entonnoir-de-conversion-ou-se-tiennent-vos-affaires' }],
	[CHEMIN_RENTABILITE, { chapitre: 'les-recettes-d-une-affaire-et-sa-rentabilite', section: 'l-ecran-rentabilite' }],
	[CHEMIN_TEMPS, { chapitre: TEMPS }],
	[CHEMIN_DEMARRAGE, { chapitre: 'le-guide-de-demarrage-par-ou-commencer' }],
	// Les sections des réglages.
	[CHEMIN_ADMIN_ARBORESCENCE, { chapitre: 'administrer-l-arborescence-tracks-et-channels' }],
	[CHEMIN_ADMIN_MEMBRES, { chapitre: 'les-membres-de-votre-espace-qui-y-travaille-avec-quel-role' }],
	[CHEMIN_ADMIN_JOURNAL, { chapitre: 'le-journal-d-audit-ce-qui-s-est-fait-dans-votre-espace' }],
	[CHEMIN_ADMIN_WORKFLOWS, { chapitre: 'composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire' }],
	// `CRM-068` T4b1 : Réglages ▸ Modèles d'affaires, décrit par la dernière section du chapitre des workflows.
	[CHEMIN_ADMIN_MODELES_AFFAIRES, { chapitre: 'composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire', section: 'preparer-des-modeles-d-affaires' }],
	[CHEMIN_ADMIN_CATALOGUE, { chapitre: 'le-catalogue-de-noeuds-le-vocabulaire-de-vos-workflows' }],
	[CHEMIN_ADMIN_COMPTES_MAIL, { chapitre: BOITES, section: 'les-boites-de-reception-declarees' }],
	[CHEMIN_ADMIN_IDENTITES_MAIL, { chapitre: BOITES, section: 'les-adresses-d-expedition' }],
	[CHEMIN_ADMIN_MODELES_MAIL, { chapitre: 'ecrire-des-modeles-d-emails-et-les-previsualiser' }],
	[CHEMIN_ADMIN_SEQUENCES_MAIL, { chapitre: 'enchainer-des-relances-les-sequences' }],
	[CHEMIN_ETAT_MESSAGERIE, { chapitre: 'consulter-l-etat-de-la-messagerie' }],
	[CHEMIN_CORBEILLE, { chapitre: 'la-corbeille-ce-qui-a-ete-retire-et-comment-le-rendre' }],
	[CHEMIN_REGLAGES_NOTIFICATIONS, { chapitre: 'vos-notifications-savoir-qu-on-vous-a-nomme', section: 'choisir-ce-que-vous-recevez' }],
	[CHEMIN_ADMIN_COUT_PERSONNEL, { chapitre: TEMPS, section: 'regler-le-cout-du-personnel' }],
	// La plateforme : le connecteur avant le reste de la section.
	[`${CHEMIN_PLATEFORME_MCP}/*`, { chapitre: 'le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant', section: 'accorder-des-droits-du-connecteur' }],
	[`${CHEMIN_PLATEFORME}/*`, { chapitre: 'la-plateforme-espaces-membres-et-superadministrateurs' }],
]

/** Le chapitre qui décrit l'écran de cette adresse, ou `null` : l'index des réglages, l'aide elle-même, une adresse inconnue. */
export function aideDeLecran(chemin: string): CibleAide | null {
	for (const [motif, cible] of ECRANS_AIDE) {
		if (matchPath({ path: motif, end: true }, chemin) !== null) return cible
	}
	return null
}

/** L'adresse de l'aide pour une cible : `/aide/<chapitre>`, et `#<section>` s'il y a lieu (docs/SPEC-manual.md §13.1). */
export function adresseAide(cible: CibleAide): string {
	return cheminAide(cible.chapitre, cible.section)
}
