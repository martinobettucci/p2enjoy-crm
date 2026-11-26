// @spec CRM-166 (docs/BACKLOG.md) — tranche T2 : l'assistant de l'inbox, côté écran sans rendu — découper la sélection en lots, demander un lot à
//       la fonction `ia` (flux NDJSON, « assistant occupé » relancé, annulation), le plan et l'état de chaque fil, appliquer une action par
//       le geste de la page, « Tout accepter » qui laisse les actions à confirmation
// @spec docs/SPEC-ia.md §17.2 (les lots), §17.4 (les actions et leurs gestes), §17.6 (la route, l'occupation), §17.8 (le mode dégradé, l'annulation) ;
//       docs/SPEC-mail-subsystem.md §36.2 (les états d'un fil), §36.3 (le même chemin que le geste de la page), §36.4 (« Tout accepter ») ;
//       docs/DESIGN_SYSTEM.md §5.116 ; docs/JOURNAL.md décisions 994 et 997 ; CLAUDE.md §10
//
// Ce module DÉCRIT et APPELLE. Aucun droit n'y est appliqué : la base garde le dernier mot à l'application (CLAUDE.md §10), l'écran dit le refus
// qu'elle rend. Le plan n'est conservé nulle part (§17.8) : c'est un état d'écran.

import { appelAction, type ActionGroupee, type FilCoche, type PorteeGroupee, descriptionPortee } from './actions-groupees'
import { classerErreur, type ErreurDonnees } from './async'
import { ECHEANCES_USUELLES, echeanceUsuelle } from './sommeil-card'
import type { AccesAssistant, RaisonIndisponible } from './assistant-ia'

// ── Les bornes (docs/SPEC-ia.md §17.7) ─────────────────────────────────────────────────────────────────────────────────────

export const FILS_MAX = 50
export const LOT_FILS = 5
export const DEMANDE_MAX = 1_000
/** « Assistant occupé » : 6 relances au plus, de 5 s en 5 s (§17.6). */
export const RELANCES_OCCUPE = 6
export const ATTENTE_OCCUPE_MS = 5_000

// ── Le plan, tel que la fonction le rend (docs/SPEC-ia.md §17.5) ─────────────────────────────────────────────────────────

export type NomAction =
	| 'pose_pastille'
	| 'retire_pastille'
	| 'classe'
	| 'declasse'
	| 'sommeil'
	| 'lu'
	| 'non_lu'
	| 'supprime_ici'
	| 'supprime_partout'
	| 'transfere'
	| 'bloque_expediteur'

export type CibleDuPlan = { readonly genre: 'pastille' | 'affaire' | 'membre' | 'duree'; readonly id: string; readonly libelle: string }

export type ActionDuPlan = {
	readonly action: NomAction
	readonly cible: CibleDuPlan | null
	readonly motif: string
	/** Vrai pour supprimer partout et bloquer l'expéditeur : « Tout accepter » ne les applique pas (§36.4). */
	readonly confirmation: boolean
}

export type PlanDeFil = {
	readonly workspace_id: string
	readonly thread_key: string
	readonly objet: string
	readonly expediteur: string
	readonly actions: readonly ActionDuPlan[]
}

// ── Découper la sélection ────────────────────────────────────────────────────────────────────────────────────────────────

/** Les lots de la sélection, dans l'ordre de la liste : 5 fils au plus par lot (§17.2). */
export function decouperEnLots<T>(fils: readonly T[], taille: number = LOT_FILS): T[][] {
	const lots: T[][] = []
	for (let debut = 0; debut < fils.length; debut += taille) lots.push(fils.slice(debut, debut + taille))
	return lots
}

/** La portée d'un lot (§17.6) : celle de la page, désignant ces seuls fils. */
export function porteeDeLot(portee: PorteeGroupee, fils: readonly FilCoche[]): { [cle: string]: unknown } {
	return descriptionPortee({ ...portee, fils })
}

// ── Demander un lot ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type EchecDeLot =
	| 'delai_depasse'
	| 'serveur_injoignable'
	| 'cle_refusee'
	| 'reponse_invalide'
	| 'occupe'
	| 'indisponible'
	| 'session'
	| 'refuse'
	| 'demande_invalide'
	| 'lecture_impossible'
	| 'reseau'
	| 'flux_coupe'

export type ResultatLot =
	| { readonly statut: 'plan'; readonly plans: readonly PlanDeFil[]; readonly rejetees: number; readonly ecartes: number }
	| { readonly statut: 'echec'; readonly echec: EchecDeLot; readonly raison?: RaisonIndisponible }
	| { readonly statut: 'annule' }

export type OptionsLot = {
	readonly portee: { [cle: string]: unknown }
	readonly demande: string
	readonly signal?: AbortSignal
	/** Dit à l'écran que le lot attend : « L'assistant est occupé » (essai n sur 6). */
	readonly surOccupe?: (essai: number) => void
	readonly attendre?: (ms: number, signal?: AbortSignal) => Promise<void>
}

const attenteParDefaut = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resoudre) => {
		const minuteur = setTimeout(resoudre, ms)
		signal?.addEventListener('abort', () => (clearTimeout(minuteur), resoudre()), { once: true })
	})

type Issue =
	| { issue: 'plan'; plans: PlanDeFil[]; rejetees: number; ecartes: number }
	| { issue: 'echec'; echec: EchecDeLot }

/** Lit le flux NDJSON d'un lot jusqu'à son issue ; `null` si le flux s'est fermé sans la dire. */
async function lireIssue(reponse: Response): Promise<Issue | null> {
	let issue: Issue | null = null
	const traiter = (ligne: string) => {
		if (ligne.trim() === '') return
		try {
			const objet = JSON.parse(ligne) as Record<string, unknown>
			if (objet.issue === 'plan' && Array.isArray(objet.plans)) {
				issue = {
					issue: 'plan',
					plans: objet.plans as PlanDeFil[],
					rejetees: typeof objet.rejetees === 'number' ? objet.rejetees : 0,
					ecartes: typeof objet.ecartes === 'number' ? objet.ecartes : 0,
				}
			} else if (objet.issue === 'echec' && typeof objet.echec === 'string') {
				issue = { issue: 'echec', echec: objet.echec as EchecDeLot }
			}
		} catch {
			// une ligne illisible ne change pas l'issue
		}
	}
	const lecteur = reponse.body?.getReader()
	if (lecteur === undefined) {
		;(await reponse.text()).split('\n').forEach(traiter)
		return issue
	}
	const decodeur = new TextDecoder()
	let reste = ''
	for (let morceau = await lecteur.read(); !morceau.done; morceau = await lecteur.read()) {
		reste += decodeur.decode(morceau.value, { stream: true })
		const lignes = reste.split('\n')
		reste = lignes.pop() ?? ''
		lignes.forEach(traiter)
	}
	traiter(reste)
	return issue
}

/** Le refus que dit un statut rendu avant tout flux (§17.6). */
async function refusDe(reponse: Response): Promise<ResultatLot> {
	let corps: { erreur?: string; raison?: RaisonIndisponible } = {}
	try {
		corps = (await reponse.json()) as typeof corps
	} catch {
		// un corps illisible ne change pas le statut
	}
	switch (reponse.status) {
		case 400:
			return { statut: 'echec', echec: 'demande_invalide' }
		case 401:
			return { statut: 'echec', echec: 'session' }
		case 403:
			return { statut: 'echec', echec: 'refuse' }
		case 503:
			return corps.erreur === 'assistant_indisponible'
				? { statut: 'echec', echec: 'indisponible', ...(corps.raison === undefined ? {} : { raison: corps.raison }) }
				: { statut: 'echec', echec: 'lecture_impossible' }
		default:
			return { statut: 'echec', echec: 'serveur_injoignable' }
	}
}

/**
 * « Assistant occupé » (§17.6) : un `502` ou `504`, ou un `503` SANS corps de la fonction — le runtime ne sert qu'un worker à la fois par
 * répertoire, et le second appel échoue au bout de 10 s. Les `503` de la fonction elle-même (`assistant_indisponible`, `lecture_impossible`)
 * portent une `erreur` : ce ne sont pas des attentes.
 */
async function estOccupe(reponse: Response): Promise<boolean> {
	if (reponse.status === 502 || reponse.status === 504) return true
	if (reponse.status !== 503) return false
	const corps = (await reponse.clone().json().catch(() => ({}))) as { erreur?: unknown }
	return typeof corps.erreur !== 'string'
}

/**
 * Demande un lot à la fonction (`POST /ia/inbox/plan`). Un `502`, `503` ou `504` rendu AVANT la première ligne du flux est un « assistant occupé »
 * (§17.6) : relancé 6 fois au plus, de 5 s en 5 s. Annuler coupe la requête : le lot rend `annule`, les lots déjà rendus restent proposés.
 */
export async function demanderLot(acces: AccesAssistant, options: OptionsLot): Promise<ResultatLot> {
	const attendre = options.attendre ?? attenteParDefaut
	// Une fonction, pour que le compilateur ne tienne pas pour acquis ce qu'un autre appel a pu changer entre-temps.
	const annule = () => options.signal?.aborted === true
	const jeton = acces.jeton()
	const entetes: Record<string, string> = {
		apikey: acces.cleAnonyme,
		'content-type': 'application/json',
		...(jeton === null ? {} : { authorization: `Bearer ${jeton}` }),
	}
	for (let essai = 0; essai <= RELANCES_OCCUPE; essai += 1) {
		if (annule()) return { statut: 'annule' }
		let reponse: Response
		try {
			reponse = await (acces.requete ?? fetch)(`${acces.url.replace(/\/+$/, '')}/functions/v1/ia/inbox/plan`, {
				method: 'POST',
				headers: entetes,
				body: JSON.stringify({ scope: options.portee, demande: options.demande }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
			})
		} catch {
			return annule() ? { statut: 'annule' } : { statut: 'echec', echec: 'reseau' }
		}
		if (await estOccupe(reponse)) {
			if (essai === RELANCES_OCCUPE) return { statut: 'echec', echec: 'occupe' }
			options.surOccupe?.(essai + 1)
			await attendre(ATTENTE_OCCUPE_MS, options.signal)
			continue
		}
		if (reponse.status !== 202) return refusDe(reponse)
		try {
			const issue = await lireIssue(reponse)
			if (issue === null) return annule() ? { statut: 'annule' } : { statut: 'echec', echec: 'flux_coupe' }
			return issue.issue === 'plan'
				? { statut: 'plan', plans: issue.plans, rejetees: issue.rejetees, ecartes: issue.ecartes }
				: { statut: 'echec', echec: issue.echec }
		} catch {
			return annule() ? { statut: 'annule' } : { statut: 'echec', echec: 'flux_coupe' }
		}
	}
	return { statut: 'echec', echec: 'occupe' }
}

// ── L'action acceptée : le geste de la page (docs/SPEC-mail-subsystem.md §36.3) ─────────────────────────────────────────

/** Les durées du plan, en jours ajoutés à l'instant — les échéances usuelles du choix de la page (§16.11.3). */
const JOURS_DE_DUREE: Readonly<Record<string, number>> = {
	demain: ECHEANCES_USUELLES[0].jours,
	semaine_prochaine: ECHEANCES_USUELLES[2].jours,
	mois_prochain: ECHEANCES_USUELLES[3].jours,
}

/**
 * L'action groupée que la page appelle pour ce geste, ou `null` pour ce qui n'en est pas une (`bloque_expediteur` passe par `block_sender`).
 * Le sommeil reçoit l'ISO de la durée, calculée ICI comme pour le choix de la page.
 */
export function actionGroupeeDe(action: ActionDuPlan, maintenant: Date = new Date()): ActionGroupee | null {
	switch (action.action) {
		case 'pose_pastille':
		case 'retire_pastille':
			return action.cible === null ? null : { genre: 'set_label', pastille: action.cible.id, posee: action.action === 'pose_pastille' }
		case 'classe':
			return action.cible === null ? null : { genre: 'classify', cardId: action.cible.id }
		case 'declasse':
			return { genre: 'unclassify' }
		case 'sommeil': {
			const jours = action.cible === null ? undefined : JOURS_DE_DUREE[action.cible.id]
			return jours === undefined ? null : { genre: 'snooze', jusqua: echeanceUsuelle(jours, maintenant) }
		}
		case 'lu':
			return { genre: 'mark_read' }
		case 'non_lu':
			return { genre: 'mark_unread' }
		case 'supprime_ici':
			return { genre: 'delete', partout: false }
		case 'supprime_partout':
			return { genre: 'delete', partout: true }
		case 'transfere':
			return action.cible === null ? null : { genre: 'transfer', destinataire: action.cible.id }
		case 'bloque_expediteur':
			return null
	}
}

/** L'appel de base d'une action du plan, pour la preuve : le même `p_action` et `p_argument` que la page. */
export const appelDeLAction = (action: ActionDuPlan, maintenant?: Date) => {
	const groupee = actionGroupeeDe(action, maintenant)
	return groupee === null ? null : appelAction(groupee)
}

// ── L'état d'un fil du plan ──────────────────────────────────────────────────────────────────────────────────────────────

export type EtatAction = 'proposee' | 'faite' | 'refusee' | 'declinee'

export type LigneDePlan = {
	readonly plan: PlanDeFil
	readonly etats: readonly EtatAction[]
	/** Le refus de la base, par action, dit sur la ligne (le code, que l'écran traduit). */
	readonly refus: Readonly<Record<number, string>>
	/** Vrai quand la personne a refusé le fil. */
	readonly refuse: boolean
}

export type EtatDeFil = 'propose' | 'applique' | 'refuse' | 'partiel' | 'echec'

export const ligneProposee = (plan: PlanDeFil): LigneDePlan => ({
	plan,
	etats: plan.actions.map(() => 'proposee' as const),
	refus: {},
	refuse: false,
})

/** L'état affiché d'un fil (§36.2) : il se lit par une icône ET un texte, jamais par la couleur seule. */
export function etatDeFil(ligne: LigneDePlan): EtatDeFil {
	if (ligne.refuse) return 'refuse'
	const faites = ligne.etats.filter((e) => e === 'faite').length
	if (faites === ligne.etats.length) return 'applique'
	if (ligne.etats.includes('refusee')) return faites > 0 ? 'partiel' : 'echec'
	if (faites > 0) return 'partiel'
	return ligne.etats.includes('declinee') ? 'partiel' : 'propose'
}

/** Les actions faites d'un fil : « Appliqué (3 actions) », « 2 sur 3 faites ». */
export const nombreFaites = (ligne: LigneDePlan): number => ligne.etats.filter((e) => e === 'faite').length

/** Un fil refusé, appliqué ou refusé par la base ne se rejoue pas ; un fil en échec se réessaie (§36.2). */
export const estRejouable = (ligne: LigneDePlan): boolean => {
	const etat = etatDeFil(ligne)
	return etat === 'propose' || etat === 'echec' || etat === 'partiel'
}

export const refuserLeFil = (ligne: LigneDePlan): LigneDePlan => (estRejouable(ligne) ? { ...ligne, refuse: true } : ligne)

// ── Appliquer ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ResultatAction = { readonly statut: 'fait' } | { readonly statut: 'refuse'; readonly code: string }

export type Executeur = {
	/** Applique UNE action par le geste de la page, sous le jeton de la personne ; la base répond. */
	readonly appliquer: (action: ActionDuPlan, plan: PlanDeFil) => Promise<ResultatAction>
	/** La confirmation propre d'une action à confirmation (supprimer partout, bloquer) : `false` si la personne décline. */
	readonly confirmer: (action: ActionDuPlan, plan: PlanDeFil) => Promise<boolean>
}

/**
 * Accepte un fil : toutes ses actions, dans l'ordre du plan (§36.3). Une action à confirmation demande la sienne ; la décliner la laisse
 * *déclinée* et n'annule pas les autres. Un refus de la base est gardé sur l'action et n'arrête pas le fil, SAUF que rien n'est appliqué
 * sur un fil dont une action précédente a quitté le dossier : l'ordre du plan place ces gestes en dernier.
 */
export async function accepterFil(ligne: LigneDePlan, executeur: Executeur): Promise<LigneDePlan> {
	const etats = [...ligne.etats]
	const refus: Record<number, string> = { ...ligne.refus }
	for (let rang = 0; rang < ligne.plan.actions.length; rang += 1) {
		if (etats[rang] === 'faite' || etats[rang] === 'declinee') continue
		const action = ligne.plan.actions[rang]!
		if (action.confirmation && !(await executeur.confirmer(action, ligne.plan))) {
			etats[rang] = 'declinee'
			continue
		}
		const resultat = await executeur.appliquer(action, ligne.plan)
		if (resultat.statut === 'fait') {
			etats[rang] = 'faite'
			delete refus[rang]
		} else {
			etats[rang] = 'refusee'
			refus[rang] = resultat.code
		}
	}
	return { ...ligne, etats, refus }
}

/** Ce que « Tout accepter » applique : les actions sans confirmation encore proposées (§36.4). */
export function actionsDeToutAccepter(lignes: readonly LigneDePlan[]): { readonly actions: number; readonly fils: number; readonly aConfirmer: number } {
	let actions = 0
	let aConfirmer = 0
	let fils = 0
	for (const ligne of lignes) {
		if (!estRejouable(ligne)) continue
		let dansLeFil = 0
		ligne.plan.actions.forEach((action, rang) => {
			if (ligne.etats[rang] !== 'proposee' && ligne.etats[rang] !== 'refusee') return
			if (action.confirmation) aConfirmer += 1
			else dansLeFil += 1
		})
		if (dansLeFil > 0) fils += 1
		actions += dansLeFil
	}
	return { actions, fils, aConfirmer }
}

/**
 * « Tout accepter » : fil après fil, les seules actions SANS confirmation ; celles qui en demandent restent proposées (§36.4). Un fil refusé
 * par la base n'arrête pas les suivants. `surFil` reçoit chaque ligne mise à jour : c'est la progression.
 */
export async function toutAccepter(
	lignes: readonly LigneDePlan[],
	executeur: Executeur,
	surFil: (rang: number, ligne: LigneDePlan) => void = () => undefined,
): Promise<readonly LigneDePlan[]> {
	const sansConfirmation: Executeur = { appliquer: executeur.appliquer, confirmer: async () => false }
	const resultat: LigneDePlan[] = []
	for (let rang = 0; rang < lignes.length; rang += 1) {
		const ligne = lignes[rang]!
		if (!estRejouable(ligne)) {
			resultat.push(ligne)
			continue
		}
		// Une action à confirmation reste PROPOSÉE : « déclinée » est le choix de la personne, pas celui de ce bouton.
		const apres = await accepterFil(ligne, sansConfirmation)
		const etats = apres.etats.map((etat, i) => (ligne.plan.actions[i]!.confirmation && etat === 'declinee' ? ligne.etats[i]! : etat))
		const fusionnee = { ...apres, etats }
		resultat.push(fusionnee)
		surFil(rang, fusionnee)
	}
	return resultat
}

/** Le refus que l'erreur de la base dit sur la ligne : son code, ou « inconnu » (l'écran traduit). */
export const codeDeRefus = (erreur: ErreurDonnees): string => (erreur.nature === 'forbidden' ? 'refuse' : erreur.nature === 'network' ? 'reseau' : 'inconnu')
export const refusInconnu = (cause: unknown): ResultatAction => ({ statut: 'refuse', code: codeDeRefus(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause))) })
