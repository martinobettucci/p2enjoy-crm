// @spec CRM-166 (docs/BACKLOG.md) — tranche T2 : l'état de l'assistant de l'inbox — lire l'état de la fonction, demander le plan lot après lot,
//       l'accepter ou le refuser fil par fil, « Tout accepter », les confirmations des gestes irréversibles
// @spec docs/SPEC-mail-subsystem.md §36.1 à §36.5, §36.9 (un état, pas des effets : `repos` → demande en cours → plan) ; docs/SPEC-ia.md §17.2, §17.6, §17.8 ;
//       docs/DESIGN_SYSTEM.md §5.116 ; docs/JOURNAL.md décisions 994 et 997 ; CLAUDE.md §10 (aucun droit appliqué ici), §11 (aucun stockage du plan)
//
// Le plan est un ÉTAT D'ÉCRAN : il n'est écrit ni dans `sessionStorage` ni dans `localStorage`. Chaque action acceptée passe par la fonction de base que la
// page appelle pour ce geste ; la base garde le dernier mot, l'écran dit son refus.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { appliquerParPaquets, descriptionPortee, type FilCoche, type PorteeGroupee } from '../lib/actions-groupees'
import { accesAssistantCrm, lireEtatAssistant, type AccesAssistant, type EtatAssistant } from '../lib/assistant-ia'
import {
	DEMANDE_MAX,
	FILS_MAX,
	accepterFil,
	actionGroupeeDe,
	actionsDeToutAccepter,
	decouperEnLots,
	etatDeFil,
	demanderLot,
	ligneProposee,
	porteeDeLot,
	refuserLeFil,
	toutAccepter as toutAccepterLignes,
	type ActionDuPlan,
	type EchecDeLot,
	type Executeur,
	type LigneDePlan,
	type PlanDeFil,
	type ResultatAction,
} from '../lib/assistant-inbox'
import { t } from '../i18n'
import { clientCrm } from '../lib/supabase'
import { bloquerExpediteur } from '../lib/transferts-inbox'
import type { RaisonIndisponible } from '../lib/assistant-ia'

/** Ce qui rend la demande inutile à retenter lot après lot : on s'arrête, les lots restants sont gardés pour « Réessayer ». */
const ECHEC_DURABLE: ReadonlySet<EchecDeLot> = new Set(['indisponible', 'session', 'refuse', 'demande_invalide', 'cle_refusee', 'serveur_injoignable', 'occupe'])

export type LecteurEtat =
	| { readonly statut: 'attente' }
	| { readonly statut: 'lecture' }
	| { readonly statut: 'pret' }
	| { readonly statut: 'indisponible'; readonly raison: RaisonIndisponible | null }
	| { readonly statut: 'illisible' }

export type Progression = { readonly lot: number; readonly lots: number; readonly occupe: number | null }

export type EchecDemande = { readonly echec: EchecDeLot; readonly raison: RaisonIndisponible | null; readonly lotsRestants: number; readonly lotsTotal: number }

/** Une confirmation attend la personne : l'action à confirmer, son fil ; `decider` la résout. */
export type ConfirmationEnAttente = {
	readonly cle: string
	readonly action: ActionDuPlan
	readonly plan: PlanDeFil
	readonly decider: (accord: boolean) => void
}

export type ParametresAssistant = {
	readonly portee: Omit<PorteeGroupee, 'fils'>
	/** Les fils cochés, ou `null` pour « tout le filtre ». */
	readonly fils: readonly FilCoche[] | null
	readonly onApplique: () => void
	readonly onAnnonce: (message: string) => void
	readonly acces?: AccesAssistant | null
}

/** Le code de refus dit sur une ligne : celui de la base, ou `reseau` / `inconnu` (l'écran le traduit). */
function refusDe(compte: { readonly refus: Readonly<Record<string, number>>; readonly interruption: { readonly nature: string } | null }): string | null {
	const code = Object.keys(compte.refus).find((cle) => (compte.refus[cle] ?? 0) > 0)
	if (code !== undefined) return code
	if (compte.interruption === null) return null
	return compte.interruption.nature === 'forbidden' ? 'forbidden' : compte.interruption.nature === 'network' ? 'reseau' : 'inconnu'
}

export const cleDeLigne = (plan: PlanDeFil): string => `${plan.workspace_id}|${plan.thread_key}`

export function useAssistantInbox({ portee, fils, onApplique, onAnnonce, acces = accesAssistantCrm }: ParametresAssistant) {
	const [etat, setEtat] = useState<LecteurEtat>({ statut: 'attente' })
	const [lignes, setLignes] = useState<readonly LigneDePlan[]>([])
	const [enDemande, setEnDemande] = useState(false)
	const [progression, setProgression] = useState<Progression | null>(null)
	const [echec, setEchec] = useState<EchecDemande | null>(null)
	const [rejetees, setRejetees] = useState(0)
	const [ecartes, setEcartes] = useState(0)
	const [sansProposition, setSansProposition] = useState(0)
	const [trop, setTrop] = useState(false)
	const [demandee, setDemandee] = useState(false)
	const [enApplication, setEnApplication] = useState<ReadonlySet<string>>(() => new Set())
	const [toutEnCours, setToutEnCours] = useState(false)
	const [confirmation, setConfirmation] = useState<ConfirmationEnAttente | null>(null)

	const lignesRef = useRef<readonly LigneDePlan[]>([])
	lignesRef.current = lignes
	const controle = useRef<AbortController | null>(null)
	const reste = useRef<{ lots: FilCoche[][]; demande: string }>({ lots: [], demande: '' })
	const porteeRef = useRef(portee)
	porteeRef.current = portee
	const filsRef = useRef(fils)
	filsRef.current = fils
	const rappels = useRef({ onApplique, onAnnonce })
	rappels.current = { onApplique, onAnnonce }

	const poserLignes = useCallback((suite: (avant: readonly LigneDePlan[]) => readonly LigneDePlan[]) => {
		const apres = suite(lignesRef.current)
		lignesRef.current = apres
		setLignes(apres)
	}, [])

	// ── L'état de la fonction : lu à l'ouverture, jamais en boucle (§36.9) ────────────────────────────────────────────────
	const lireEtat = useCallback(async () => {
		if (acces === null || acces === undefined) {
			setEtat({ statut: 'indisponible', raison: null })
			return
		}
		setEtat({ statut: 'lecture' })
		const lu: EtatAssistant | null = await lireEtatAssistant(acces)
		if (lu === null) setEtat({ statut: 'illisible' })
		else if (!lu.disponible) setEtat({ statut: 'indisponible', raison: lu.raison ?? null })
		else setEtat({ statut: 'pret' })
	}, [acces])

	// ── Demander le plan, lot après lot ───────────────────────────────────────────────────────────────────────────────────────
	const executerLots = useCallback(
		async (lots: readonly FilCoche[][], demande: string, signal: AbortSignal, total: number, premier: number) => {
			if (acces === null || acces === undefined) return
			const restants: FilCoche[][] = []
			let dernier: { echec: EchecDeLot; raison: RaisonIndisponible | null } | null = null
			let arret = false
			for (let rang = 0; rang < lots.length; rang += 1) {
				const lot = lots[rang]!
				if (arret) {
					restants.push(lot)
					continue
				}
				setProgression({ lot: premier + rang + 1, lots: total, occupe: null })
				const resultat = await demanderLot(acces, {
					portee: porteeDeLot({ ...porteeRef.current, fils: null }, lot),
					demande,
					signal,
					surOccupe: (essai) => setProgression({ lot: premier + rang + 1, lots: total, occupe: essai }),
				})
				if (resultat.statut === 'annule') return
				if (resultat.statut === 'echec') {
					restants.push(lot)
					dernier = { echec: resultat.echec, raison: resultat.raison ?? null }
					if (ECHEC_DURABLE.has(resultat.echec)) arret = true
					continue
				}
				const avecActions = resultat.plans.filter((plan) => plan.actions.length > 0)
				setSansProposition((n) => n + (resultat.plans.length - avecActions.length))
				setRejetees((n) => n + resultat.rejetees)
				setEcartes((n) => n + resultat.ecartes)
				poserLignes((avant) => [...avant, ...avecActions.map(ligneProposee)])
				rappels.current.onAnnonce(t('inbox.assistant.annonce.lot', { k: String(premier + rang + 1), n: String(total) }))
			}
			reste.current = { lots: restants, demande }
			setEchec(dernier === null ? null : { ...dernier, lotsRestants: restants.length, lotsTotal: total })
		},
		[acces, poserLignes],
	)

	const lancer = useCallback(
		async (demande: string) => {
			const texte = demande.trim()
			if (texte === '' || texte.length > DEMANDE_MAX || enDemande || enApplication.size > 0 || toutEnCours) return
			controle.current?.abort()
			const ctl = new AbortController()
			controle.current = ctl
			lignesRef.current = []
			setLignes([])
			setEchec(null)
			setRejetees(0)
			setEcartes(0)
			setSansProposition(0)
			setTrop(false)
			setDemandee(true)
			setEnDemande(true)
			setProgression(null)
			reste.current = { lots: [], demande: texte }
			try {
				let cibles: FilCoche[]
				if (filsRef.current === null) {
					if (clientCrm === null) {
						setEchec({ echec: 'lecture_impossible', raison: null, lotsRestants: 0, lotsTotal: 0 })
						return
					}
					const lu = await clientCrm.rpc('inbox_assistant_threads', { p_scope: descriptionPortee({ ...porteeRef.current, fils: null }) })
					if (ctl.signal.aborted) return
					if (lu.error !== null) {
						setEchec({ echec: 'lecture_impossible', raison: null, lotsRestants: 0, lotsTotal: 0 })
						return
					}
					const cles = ((lu.data ?? []) as readonly { workspace_id: string; thread_key: string }[]).map((c) => ({ workspaceId: c.workspace_id, cleFil: c.thread_key }))
					if (cles.length > FILS_MAX) {
						setTrop(true)
						return
					}
					cibles = cles
				} else {
					cibles = [...filsRef.current]
				}
				const lots = decouperEnLots(cibles)
				await executerLots(lots, texte, ctl.signal, lots.length, 0)
			} finally {
				if (controle.current === ctl) {
					controle.current = null
					setEnDemande(false)
					setProgression(null)
					if (!ctl.signal.aborted) {
						const faits = lignesRef.current
						if (faits.length > 0) {
							const total = faits.reduce((n, l) => n + l.plan.actions.length, 0)
							rappels.current.onAnnonce(t('inbox.assistant.annonce.pret', { actions: String(total), mails: String(faits.length) }))
						}
					}
				}
			}
		},
		[enDemande, enApplication, toutEnCours, executerLots],
	)

	const reessayerLots = useCallback(async () => {
		if (enDemande || reste.current.lots.length === 0) return
		const { lots, demande } = reste.current
		const total = (echec?.lotsTotal ?? lots.length)
		const premier = Math.max(0, total - lots.length)
		controle.current?.abort()
		const ctl = new AbortController()
		controle.current = ctl
		setEchec(null)
		setEnDemande(true)
		try {
			await executerLots(lots, demande, ctl.signal, total, premier)
		} finally {
			if (controle.current === ctl) {
				controle.current = null
				setEnDemande(false)
				setProgression(null)
			}
		}
	}, [enDemande, echec, executerLots])

	const annuler = useCallback(() => {
		controle.current?.abort()
		controle.current = null
		setEnDemande(false)
		setProgression(null)
	}, [])

	// Changer de dossier, de filtre ou de sélection pendant une demande l'annule ; le plan reste lisible (§36.9).
	const cleSelection = useMemo(() => JSON.stringify([portee, fils]), [portee, fils])
	const premiereCle = useRef(cleSelection)
	useEffect(() => {
		if (premiereCle.current === cleSelection) return
		premiereCle.current = cleSelection
		if (controle.current !== null) annuler()
	}, [cleSelection, annuler])
	useEffect(() => () => controle.current?.abort(), [])

	// ── Appliquer ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
	const porteeDuFil = useCallback(
		(plan: PlanDeFil): PorteeGroupee => ({
			...porteeRef.current,
			sommeilVisible: true,
			fils: [{ workspaceId: plan.workspace_id, cleFil: plan.thread_key }],
		}),
		[],
	)

	const executeur = useMemo<Executeur>(
		() => ({
			appliquer: async (action, plan): Promise<ResultatAction> => {
				if (action.action === 'bloque_expediteur') {
					const idEspace = porteeRef.current.idWorkspace
					if (idEspace === null) return { statut: 'refuse', code: 'inconnu' }
					const issue = await bloquerExpediteur(clientCrm, idEspace, plan.expediteur)
					if ('corbeille' in issue) return { statut: 'fait' }
					return { statut: 'refuse', code: issue.nature === 'forbidden' ? 'forbidden' : issue.nature === 'network' ? 'reseau' : 'inconnu' }
				}
				const groupee = actionGroupeeDe(action)
				if (groupee === null) return { statut: 'refuse', code: 'inconnu' }
				const compte = await appliquerParPaquets(clientCrm, porteeDuFil(plan), groupee)
				const code = refusDe(compte)
				return code === null ? { statut: 'fait' } : { statut: 'refuse', code }
			},
			confirmer: (action, plan) =>
				new Promise<boolean>((resoudre) => {
					setConfirmation({
						cle: cleDeLigne(plan),
						action,
						plan,
						decider: (accord) => {
							setConfirmation(null)
							resoudre(accord)
						},
					})
				}),
		}),
		[porteeDuFil],
	)

	const remplacer = useCallback(
		(cle: string, ligne: LigneDePlan) => poserLignes((avant) => avant.map((l) => (cleDeLigne(l.plan) === cle ? ligne : l))),
		[poserLignes],
	)

	const accepter = useCallback(
		async (cle: string) => {
			const ligne = lignesRef.current.find((l) => cleDeLigne(l.plan) === cle)
			if (ligne === undefined || enDemande || toutEnCours || enApplication.has(cle)) return
			setEnApplication((s) => new Set(s).add(cle))
			try {
				const apres = await accepterFil(ligne, executeur)
				remplacer(cle, apres)
				const objet = ligne.plan.objet.trim() === '' ? t('inbox.assistant.sans.objet') : ligne.plan.objet
				const issue = etatDeFil(apres)
				if (issue === 'applique') rappels.current.onAnnonce(t('inbox.assistant.annonce.applique', { objet }))
				else if (issue === 'echec' || issue === 'partiel') rappels.current.onAnnonce(t('inbox.assistant.annonce.echec', { objet }))
				if (apres.etats.some((e, i) => e === 'faite' && ligne.etats[i] !== 'faite')) rappels.current.onApplique()
			} finally {
				setEnApplication((s) => {
					const suite = new Set(s)
					suite.delete(cle)
					return suite
				})
			}
		},
		[enDemande, toutEnCours, enApplication, executeur, remplacer],
	)

	const refuser = useCallback(
		(cle: string) => {
			const ligne = lignesRef.current.find((l) => cleDeLigne(l.plan) === cle)
			if (ligne !== undefined) remplacer(cle, refuserLeFil(ligne))
		},
		[remplacer],
	)

	const compteToutAccepter = useMemo(() => actionsDeToutAccepter(lignes), [lignes])

	const toutAccepter = useCallback(async () => {
		if (toutEnCours || enDemande || enApplication.size > 0) return
		setToutEnCours(true)
		try {
			let appliqueAuMoinsUne = false
			await toutAccepterLignes(lignesRef.current, executeur, (rang, ligne) => {
				remplacer(cleDeLigne(ligne.plan), ligne)
				if (ligne.etats.includes('faite')) appliqueAuMoinsUne = true
				void rang
			})
			if (appliqueAuMoinsUne) rappels.current.onApplique()
		} finally {
			setToutEnCours(false)
		}
	}, [toutEnCours, enDemande, enApplication, executeur, remplacer])

	return {
		etat,
		lireEtat,
		lignes,
		enDemande,
		progression,
		echec,
		rejetees,
		ecartes,
		sansProposition,
		trop,
		demandee,
		enApplication,
		toutEnCours,
		confirmation,
		compteToutAccepter,
		lancer,
		reessayerLots,
		annuler,
		accepter,
		refuser,
		toutAccepter,
		porteeDuFil,
	}
}
