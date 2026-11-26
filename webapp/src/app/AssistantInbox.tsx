// @spec CRM-166 (docs/BACKLOG.md) — tranche T2 : l'écran de l'assistant de l'inbox — la bulle, le panneau, la demande, le plan fil par fil, « Tout accepter »
// @spec docs/DESIGN_SYSTEM.md §5.116 (la bulle, le panneau non modal, les quatre états, les lignes de plan, les états d'un fil), §5.109 (les confirmations
//       de la page), §5.13 (dans le flux, le focus), §5.8 (états), §8 (jamais la couleur seule) ; docs/SPEC-mail-subsystem.md §36.1 à §36.9 ; docs/SPEC-ia.md §17 ;
//       docs/JOURNAL.md décisions 994 et 997 ; CLAUDE.md §10 (la base refuse, l'écran le dit), §22 (clavier), §23 (textes centralisés)
//
// Rendu par `RouteInbox` seulement. L'assistant ne lit pas la liste : il reçoit la portée de la sélection et envoie des clés de fil à la fonction `ia`.

import { useEffect, useId, useRef, useState } from 'react'
import {
	AlarmClock,
	Check,
	FolderInput,
	FolderOutput,
	Forward,
	Mail,
	MailOpen,
	ShieldBan,
	Sparkles,
	Tag,
	Trash2,
	TriangleAlert,
	X,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { compterPortee, type ComptePortee, type FilCoche, type PorteeGroupee } from '../lib/actions-groupees'
import type { EtatAsync } from '../lib/async'
import { DEMANDE_MAX, estRejouable, etatDeFil, nombreFaites, type ActionDuPlan, type EchecDeLot, type LigneDePlan, type NomAction, type PlanDeFil } from '../lib/assistant-inbox'
import { clientCrm } from '../lib/supabase'
import { compterImpactBlocage } from '../lib/transferts-inbox'
import { textePortee } from './ActionsGroupeesInbox'
import { RAISONS } from './PanneauSuggestionIa'
import { cleDeLigne, useAssistantInbox, type ConfirmationEnAttente } from './useAssistantInbox'

const accord = (n: number, un: CleTraduction, plusieurs: CleTraduction): string => (n === 1 ? t(un) : t(plusieurs, { n: String(n) }))
const texteActions = (n: number) => accord(n, 'inbox.assistant.actions.un', 'inbox.assistant.actions.plusieurs')
const texteMails = (n: number) => accord(n, 'inbox.assistant.mails.un', 'inbox.assistant.mails.plusieurs')

const CLES_ACTION: Readonly<Record<NomAction, CleTraduction>> = {
	pose_pastille: 'inbox.assistant.action.pose_pastille',
	retire_pastille: 'inbox.assistant.action.retire_pastille',
	classe: 'inbox.assistant.action.classe',
	declasse: 'inbox.assistant.action.declasse',
	sommeil: 'inbox.assistant.action.sommeil',
	lu: 'inbox.assistant.action.lu',
	non_lu: 'inbox.assistant.action.non_lu',
	supprime_ici: 'inbox.assistant.action.supprime_ici',
	supprime_partout: 'inbox.assistant.action.supprime_partout',
	transfere: 'inbox.assistant.action.transfere',
	bloque_expediteur: 'inbox.assistant.action.bloque_expediteur',
}

const ICONES_ACTION = {
	pose_pastille: Tag,
	retire_pastille: Tag,
	classe: FolderInput,
	declasse: FolderOutput,
	sommeil: AlarmClock,
	lu: MailOpen,
	non_lu: Mail,
	supprime_ici: Trash2,
	supprime_partout: Trash2,
	transfere: Forward,
	bloque_expediteur: ShieldBan,
} as const

const CLES_ECHEC: Readonly<Record<EchecDeLot, CleTraduction>> = {
	delai_depasse: 'inbox.assistant.echec.delai_depasse',
	serveur_injoignable: 'inbox.assistant.echec.serveur_injoignable',
	cle_refusee: 'inbox.assistant.echec.cle_refusee',
	reponse_invalide: 'inbox.assistant.echec.reponse_invalide',
	occupe: 'inbox.assistant.echec.occupe',
	indisponible: 'inbox.assistant.echec.indisponible',
	session: 'inbox.assistant.echec.session',
	refuse: 'inbox.assistant.echec.refuse',
	demande_invalide: 'inbox.assistant.echec.demande_invalide',
	lecture_impossible: 'inbox.assistant.echec.lecture_impossible',
	reseau: 'inbox.assistant.echec.reseau',
	flux_coupe: 'inbox.assistant.echec.flux_coupe',
}

/** Les refus nommés de la base : les phrases des actions groupées de la page (§36.3) ; le reste par « Cette action n'a pas pu être appliquée ». */
const MOTIFS_REFUS: Readonly<Record<string, CleTraduction>> = {
	forbidden: 'inbox.bulk.refus.forbidden',
	message_not_found: 'inbox.bulk.refus.message_not_found',
	card_not_available: 'inbox.bulk.refus.card_not_available',
	no_writable_mailbox: 'inbox.bulk.refus.no_writable_mailbox',
	label_not_found: 'inbox.bulk.refus.label_not_found',
	label_archived: 'inbox.bulk.refus.label_archived',
	outbound_message: 'inbox.bulk.refus.outbound_message',
	thread_not_found: 'inbox.bulk.refus.thread_not_found',
	snooze_date_in_past: 'inbox.bulk.refus.snooze_date_in_past',
	snooze_date_required: 'inbox.bulk.refus.snooze_date_required',
	recipient_not_member: 'inbox.bulk.refus.recipient_not_member',
	self_transfer: 'inbox.bulk.refus.self_transfer',
	reseau: 'inbox.assistant.refus.reseau',
}

const texteRefus = (code: string): string => {
	const cle = MOTIFS_REFUS[code]
	return cle === undefined ? t('inbox.assistant.refus.inconnu') : t(cle)
}

const CLES_ETAT_ACTION: Readonly<Record<'faite' | 'refusee' | 'declinee', CleTraduction>> = {
	faite: 'inbox.assistant.action.faite',
	refusee: 'inbox.assistant.action.refusee',
	declinee: 'inbox.assistant.action.declinee',
}

const libelleAction = (action: ActionDuPlan): string =>
	t(CLES_ACTION[action.action], action.cible === null ? {} : { cible: action.cible.libelle })

const objetDe = (plan: PlanDeFil): string => (plan.objet.trim() === '' ? t('inbox.assistant.sans.objet') : plan.objet)

// =================================================================================================
// Les confirmations des gestes irréversibles — celles de la page (§5.109), dans le panneau, sous la ligne
// =================================================================================================

function ConfirmationSuppression({
	porteeFil,
	retention,
	onDecider,
}: {
	readonly porteeFil: PorteeGroupee
	readonly retention: number | null
	readonly onDecider: (accord: boolean) => void
}) {
	const [compte, setCompte] = useState<EtatAsync<ComptePortee>>({ statut: 'chargement' })
	const [essai, setEssai] = useState(0)
	const refAnnuler = useRef<HTMLButtonElement | null>(null)
	const idTitre = useId()
	useEffect(() => {
		let vivant = true
		setCompte({ statut: 'chargement' })
		void compterPortee(clientCrm, porteeFil).then((lu) => {
			if (vivant) setCompte(lu)
		})
		return () => {
			vivant = false
		}
		// La portée du fil ne change pas pendant que la confirmation est ouverte.
	}, [essai])
	useEffect(() => {
		refAnnuler.current?.focus()
	}, [])
	const pret = compte.statut === 'pret' ? compte.donnees : null
	return (
		<div
			role="group"
			aria-labelledby={idTitre}
			data-testid="assistant-confirmation"
			className="mt-2 rounded-sm border border-border p-3 flex flex-col gap-2"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') {
					evenement.stopPropagation()
					onDecider(false)
				}
			}}
		>
			<p id={idTitre} className="font-medium text-ink">
				{pret === null ? t('inbox.assistant.confirmation.titre.suppression') : t('inbox.bulk.question.delete_everywhere', { portee: textePortee(pret) })}
			</p>
			{compte.statut === 'chargement' ? (
				<p role="status" className="text-sm text-text-2">
					{t('inbox.bulk.comptage')}
				</p>
			) : null}
			{compte.statut === 'erreur' ? (
				<div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					<span>{t('inbox.bulk.comptage.erreur')}</span>
					<Button variante="discret" taille="compacte" onClick={() => setEssai((n) => n + 1)}>
						{t('inbox.bulk.reessayer')}
					</Button>
				</div>
			) : null}
			<p className="text-sm text-text-2">
				{retention === null
					? t('inbox.bulk.consequence.delete_everywhere.sansDuree')
					: t('inbox.bulk.consequence.delete_everywhere', { n: String(retention) })}
			</p>
			<div className="flex flex-col md:flex-row md:flex-wrap gap-2">
				<Button ref={refAnnuler} variante="secondaire" taille="compacte" onClick={() => onDecider(false)}>
					{t('inbox.bulk.annuler')}
				</Button>
				<Button
					variante="destructif"
					taille="compacte"
					data-testid="assistant-confirmer"
					disabled={pret === null || pret.messages === 0}
					onClick={() => onDecider(true)}
				>
					<Trash2 aria-hidden="true" size={16} />
					{t('inbox.bulk.option.delete_everywhere')}
				</Button>
			</div>
		</div>
	)
}

function ConfirmationBlocage({
	idEspace,
	adresse,
	onDecider,
}: {
	readonly idEspace: string | null
	readonly adresse: string
	readonly onDecider: (accord: boolean) => void
}) {
	const [etape, setEtape] = useState<1 | 2>(1)
	const [impact, setImpact] = useState<EtatAsync<number>>({ statut: 'chargement' })
	const [essai, setEssai] = useState(0)
	const refAnnuler = useRef<HTMLButtonElement | null>(null)
	const idTitre = useId()
	useEffect(() => {
		let vivant = true
		setImpact({ statut: 'chargement' })
		if (idEspace === null) return
		void compterImpactBlocage(clientCrm, idEspace, adresse).then((lu) => {
			if (vivant) setImpact(lu)
		})
		return () => {
			vivant = false
		}
	}, [idEspace, adresse, essai])
	useEffect(() => {
		refAnnuler.current?.focus()
	}, [etape])
	const nombre = (n: number): string =>
		n === 0 ? t('inbox.block.impact.0') : n === 1 ? t('inbox.block.impact.1') : t('inbox.block.impact.n', { n: String(n) })
	return (
		<div
			role="group"
			aria-labelledby={idTitre}
			data-testid="assistant-confirmation"
			className="mt-2 rounded-sm border border-border p-3 flex flex-col gap-2"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') {
					evenement.stopPropagation()
					onDecider(false)
				}
			}}
		>
			<p id={idTitre} className="font-medium text-ink break-words">
				{etape === 1 ? t('inbox.block.question', { adresse }) : t('inbox.block.confirmQuestion', { adresse })}
			</p>
			{etape === 1 ? (
				impact.statut === 'chargement' ? (
					<p role="status" className="text-sm text-text-2">
						{t('inbox.block.impact.loading')}
					</p>
				) : impact.statut === 'erreur' ? (
					<div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
						<span>{t('inbox.block.impact.error')}</span>
						<Button variante="discret" taille="compacte" onClick={() => setEssai((n) => n + 1)}>
							{t('inbox.bulk.reessayer')}
						</Button>
					</div>
				) : (
					<p className="text-sm text-text-2" data-testid="assistant-blocage-impact">
						{nombre(impact.donnees)}
					</p>
				)
			) : null}
			<div className="flex flex-col md:flex-row md:flex-wrap gap-2">
				<Button ref={refAnnuler} variante="secondaire" taille="compacte" onClick={() => onDecider(false)}>
					{t('inbox.block.cancel')}
				</Button>
				{etape === 1 ? (
					<Button variante="secondaire" taille="compacte" data-testid="assistant-blocage-continuer" disabled={impact.statut !== 'pret'} onClick={() => setEtape(2)}>
						{t('inbox.block.continue')}
					</Button>
				) : (
					<Button variante="destructif" taille="compacte" data-testid="assistant-confirmer" onClick={() => onDecider(true)}>
						<ShieldBan aria-hidden="true" size={16} />
						{t('inbox.block.confirm', { adresse })}
					</Button>
				)}
			</div>
		</div>
	)
}

// =================================================================================================
// Une ligne de plan : un fil, ses actions, son état
// =================================================================================================

function IndicateurEtat({ ligne }: { readonly ligne: LigneDePlan }) {
	const etat = etatDeFil(ligne)
	if (etat === 'propose') return null
	const faites = nombreFaites(ligne)
	const total = ligne.plan.actions.length
	if (etat === 'applique')
		return (
			<span data-testid="assistant-etat" className="inline-flex items-center gap-1 text-sm text-success">
				<Check aria-hidden="true" size={16} />
				{accord(faites, 'inbox.assistant.etat.applique.un', 'inbox.assistant.etat.applique.plusieurs')}
			</span>
		)
	if (etat === 'refuse')
		return (
			<span data-testid="assistant-etat" className="inline-flex items-center gap-1 text-sm text-text-2">
				<X aria-hidden="true" size={16} />
				{t('inbox.assistant.etat.refuse')}
			</span>
		)
	if (etat === 'partiel')
		return (
			<span data-testid="assistant-etat" className="inline-flex items-center gap-1 text-sm text-text-2">
				<TriangleAlert aria-hidden="true" size={16} />
				{t('inbox.assistant.etat.partiel', { faites: String(faites), total: String(total) })}
			</span>
		)
	return (
		<span data-testid="assistant-etat" className="inline-flex items-center gap-1 text-sm text-danger">
			<TriangleAlert aria-hidden="true" size={16} />
			{t('inbox.assistant.etat.echec')}
		</span>
	)
}

function LigneDuPlan({
	ligne,
	occupee,
	bloquee,
	confirmation,
	idEspace,
	retention,
	porteeFil,
	onAccepter,
	onRefuser,
}: {
	readonly ligne: LigneDePlan
	readonly occupee: boolean
	readonly bloquee: boolean
	readonly confirmation: ConfirmationEnAttente | null
	readonly idEspace: string | null
	readonly retention: number | null
	readonly porteeFil: PorteeGroupee
	readonly onAccepter: () => void
	readonly onRefuser: () => void
}) {
	const etat = etatDeFil(ligne)
	const rejouable = estRejouable(ligne)
	const objet = objetDe(ligne.plan)
	const grise = etat === 'applique' || etat === 'refuse'
	return (
		<li
			tabIndex={-1}
			data-testid="assistant-fil"
			data-fil={ligne.plan.thread_key}
			data-etat={etat}
			className={`rounded-sm border border-border p-3 flex flex-col gap-2 focus:outline-none focus-visible:outline-2 focus-visible:outline-brand ${grise ? 'opacity-70' : ''}`}
		>
			<div className="min-w-0">
				<p className="font-medium text-ink truncate" title={objet}>
					{objet}
				</p>
				<p className="text-sm text-text-2 truncate" title={ligne.plan.expediteur}>
					{ligne.plan.expediteur}
				</p>
			</div>
			<ul className="flex flex-col gap-2">
				{ligne.plan.actions.map((action, rang) => {
					const Icone = ICONES_ACTION[action.action]
					const etatAction = ligne.etats[rang]
					const refus = ligne.refus[rang]
					return (
						<li key={rang} className="flex flex-col gap-1" data-testid="assistant-action" data-action={action.action} data-etat-action={etatAction}>
							<span
								className={`inline-flex w-fit max-w-full items-center gap-1 rounded-full px-2 py-1 text-sm ${
									action.confirmation ? 'bg-accent-soft text-accent-on-soft' : 'bg-hover text-ink'
								}`}
							>
								<Icone aria-hidden="true" size={16} className="shrink-0" />
								<span className="break-words">{libelleAction(action)}</span>
								{action.confirmation ? (
									<span className="inline-flex items-center gap-1 font-medium">
										<TriangleAlert aria-hidden="true" size={14} />
										{t('inbox.assistant.irreversible')}
									</span>
								) : null}
								{etatAction === 'faite' || etatAction === 'refusee' || etatAction === 'declinee' ? (
									<span className="text-text-2">· {t(CLES_ETAT_ACTION[etatAction])}</span>
								) : null}
							</span>
							{action.motif.trim() !== '' ? <span className="text-sm text-text-2">{action.motif}</span> : null}
							{refus !== undefined ? (
								<span role="alert" className="text-sm text-danger" data-testid="assistant-refus">
									{texteRefus(refus)}
								</span>
							) : null}
						</li>
					)
				})}
			</ul>
			<div className="flex flex-wrap items-center gap-2">
				<IndicateurEtat ligne={ligne} />
				{occupee ? (
					<span role="status" className="text-sm text-text-2">
						{t('inbox.assistant.en.application')}
					</span>
				) : null}
				{rejouable && !occupee ? (
					<>
						<Button
							variante="primaire"
							taille="compacte"
							data-testid="assistant-accepter"
							aria-label={t(etat === 'propose' ? 'inbox.assistant.accepter.fil' : 'inbox.assistant.reessayer.fil', { objet })}
							disabled={bloquee || confirmation !== null}
							onClick={onAccepter}
						>
							<Check aria-hidden="true" size={16} />
							{etat === 'propose' ? t('inbox.assistant.accepter') : t('inbox.assistant.echec.reessayer')}
						</Button>
						<Button
							variante="secondaire"
							taille="compacte"
							data-testid="assistant-refuser"
							aria-label={t('inbox.assistant.refuser.fil', { objet })}
							disabled={bloquee || confirmation !== null}
							onClick={onRefuser}
						>
							<X aria-hidden="true" size={16} />
							{t('inbox.assistant.refuser')}
						</Button>
					</>
				) : null}
			</div>
			{confirmation !== null && confirmation.cle === cleDeLigne(ligne.plan) ? (
				confirmation.action.action === 'supprime_partout' ? (
					<ConfirmationSuppression porteeFil={porteeFil} retention={retention} onDecider={confirmation.decider} />
				) : (
					<ConfirmationBlocage idEspace={idEspace} adresse={ligne.plan.expediteur} onDecider={confirmation.decider} />
				)
			) : null}
		</li>
	)
}

// =================================================================================================
// La bulle et son panneau
// =================================================================================================

export type ProprietesAssistantInbox = {
	readonly portee: Omit<PorteeGroupee, 'fils'>
	/** Les fils cochés, ou `null` pour « tout le filtre ». */
	readonly fils: readonly FilCoche[] | null
	readonly retention: number | null
	/** Après une action appliquée : la page relit sa liste, ses compteurs et l'arborescence (§36.5). */
	readonly onApplique: () => void
	readonly onAnnonce: (message: string) => void
}

export function AssistantInbox({ portee, fils, retention, onApplique, onAnnonce }: ProprietesAssistantInbox) {
	const [ouvert, setOuvert] = useState(false)
	const [demande, setDemande] = useState('')
	const [confirmerTout, setConfirmerTout] = useState(false)
	const a = useAssistantInbox({ portee, fils, onApplique, onAnnonce })
	const idPanneau = useId()
	const idChamp = useId()
	const refBulle = useRef<HTMLButtonElement | null>(null)
	const refChamp = useRef<HTMLTextAreaElement | null>(null)
	const refPanneau = useRef<HTMLElement | null>(null)
	const refAnnulerTout = useRef<HTMLButtonElement | null>(null)

	const sansSelection = fils !== null && fils.length === 0
	const occupe = a.enDemande || a.enApplication.size > 0 || a.toutEnCours
	const pret = a.etat.statut === 'pret'

	const ouvrir = () => {
		setOuvert(true)
		if (a.etat.statut === 'attente' || a.etat.statut === 'illisible') void a.lireEtat()
	}
	const fermer = () => {
		a.annuler()
		setOuvert(false)
		setConfirmerTout(false)
		refBulle.current?.focus()
	}

	// À l'ouverture, le focus entre sur le champ de demande (§36.9) ; sans champ, sur le panneau lui-même.
	useEffect(() => {
		if (!ouvert) return
		if (pret && !sansSelection) refChamp.current?.focus()
		else refPanneau.current?.focus()
	}, [ouvert, pret, sansSelection])

	// La demande finie, le focus n'est jamais perdu : le bouton « Annuler la demande » qui le portait vient de disparaître. Il va à la première ligne du plan
	// — d'où `Tab` atteint « Accepter » —, à défaut au champ de demande (docs/DESIGN_SYSTEM.md §5.116, §8).
	const etaitEnDemande = useRef(false)
	useEffect(() => {
		const finie = etaitEnDemande.current && !a.enDemande
		etaitEnDemande.current = a.enDemande
		if (!finie || !ouvert) return
		const actif = document.activeElement
		if (actif !== null && actif !== document.body && refPanneau.current?.contains(actif)) return
		const premiere = refPanneau.current?.querySelector<HTMLElement>('[data-testid="assistant-fil"]')
		;(premiere ?? refChamp.current)?.focus()
	}, [a.enDemande, ouvert])

	// La confirmation de « Tout accepter » s'ouvre dans le panneau, sous les lignes : le focus entre sur « Annuler » (§5.13), ce qui la rend visible
	// même quand le panneau défile.
	useEffect(() => {
		if (confirmerTout) refAnnulerTout.current?.focus()
	}, [confirmerTout])

	// Un plan qui change de lignes met fin à la confirmation de « Tout accepter » qui ne le concernait plus.
	useEffect(() => {
		if (a.compteToutAccepter.actions === 0) setConfirmerTout(false)
	}, [a.compteToutAccepter.actions])

	const lancer = () => void a.lancer(demande)
	const demandeValide = demande.trim() !== '' && demande.length <= DEMANDE_MAX && !sansSelection

	const raisonEtat =
		a.etat.statut === 'indisponible' ? (a.etat.raison === null ? null : t(RAISONS[a.etat.raison])) : null

	const rendreFocusLigne = (cle: string) =>
		requestAnimationFrame(() => {
			const ligne = refPanneau.current?.querySelector<HTMLElement>(`[data-testid="assistant-fil"][data-fil="${CSS.escape(cle.split('|')[1] ?? '')}"]`)
			const actif = document.activeElement
			if (ligne !== null && ligne !== undefined && (actif === null || actif === document.body || !ligne.contains(actif))) ligne.focus()
		})

	return (
		<div className="absolute bottom-4 right-4 z-30 flex flex-col items-end gap-2 max-w-[calc(100%-2rem)]" data-testid="assistant-ancre">
			{ouvert ? (
				<section
					ref={refPanneau}
					id={idPanneau}
					role="region"
					aria-label={t('inbox.assistant.titre')}
					tabIndex={-1}
					data-testid="assistant-panneau"
					className="bg-surface border border-border rounded-lg shadow-[var(--shadow-card-hover)] w-[min(var(--size-assistant),calc(100vw-2rem))] max-h-[80vh] overflow-y-auto p-4 flex flex-col gap-3 focus:outline-none"
					onKeyDown={(evenement) => {
						if (evenement.key === 'Escape') {
							evenement.stopPropagation()
							fermer()
						}
					}}
				>
					<header className="flex items-center gap-2">
						<Sparkles aria-hidden="true" size={18} className="text-brand" />
						<h2 className="text-h3 font-medium text-ink flex-1">{t('inbox.assistant.titre')}</h2>
						<Button variante="discret" taille="compacte" aria-label={t('inbox.assistant.fermer')} onClick={fermer}>
							<X aria-hidden="true" size={16} />
						</Button>
					</header>

					{a.etat.statut === 'attente' || a.etat.statut === 'lecture' ? (
						<p role="status" className="text-sm text-text-2" data-testid="assistant-lecture">
							{t('inbox.assistant.lecture')}
						</p>
					) : null}

					{a.etat.statut === 'indisponible' ? (
						<p className="text-sm text-text-2" data-testid="assistant-etat-indisponible">
							{raisonEtat === null ? t('ia.refus.indisponible.sans_raison') : t('ia.etat.indisponible', { raison: raisonEtat })}
						</p>
					) : null}

					{a.etat.statut === 'illisible' ? (
						<div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft" data-testid="assistant-etat-indisponible">
							<span>{t('ia.etat.illisible')}</span>
							<Button variante="discret" taille="compacte" onClick={() => void a.lireEtat()}>
								{t('inbox.bulk.reessayer')}
							</Button>
						</div>
					) : null}

					{pret ? (
						<>
							{sansSelection ? (
								<p className="text-sm text-text-2" data-testid="assistant-sans-selection">
									{t('inbox.assistant.sans.selection')}
								</p>
							) : (
								<p className="text-sm text-text-2" data-testid="assistant-selection">
									{fils === null ? t('inbox.assistant.selection.filtre') : accord(fils.length, 'inbox.assistant.selection.un', 'inbox.assistant.selection.plusieurs')}
								</p>
							)}
							{a.trop ? (
								<p role="alert" className="text-sm text-danger" data-testid="assistant-trop">
									{t('inbox.assistant.trop')}
								</p>
							) : null}
							<div className="flex flex-col gap-1">
								<label htmlFor={idChamp} className="text-sm text-text-2">
									{t('inbox.assistant.demande.label')}
								</label>
								<textarea
									ref={refChamp}
									id={idChamp}
									rows={3}
									value={demande}
									disabled={sansSelection || occupe}
									aria-describedby={`${idChamp}-aide`}
									placeholder={t('inbox.assistant.demande.placeholder')}
									data-testid="assistant-demande"
									className="rounded-sm border border-border bg-surface px-3 py-2 min-h-[var(--size-target)] disabled:opacity-60"
									onChange={(evenement) => setDemande(evenement.target.value)}
									onKeyDown={(evenement) => {
										if (evenement.key === 'Enter' && (evenement.ctrlKey || evenement.metaKey)) {
											evenement.preventDefault()
											if (demandeValide && !occupe) lancer()
										}
									}}
								/>
								<div id={`${idChamp}-aide`} className="flex flex-col gap-1">
									<span className={`text-xs ${demande.length > DEMANDE_MAX ? 'text-danger' : 'text-text-2'}`} data-testid="assistant-compteur">
										{t('inbox.assistant.demande.compteur', { n: String(demande.length) })}
									</span>
									<span className="text-xs text-text-2">{sansSelection ? t('inbox.assistant.sans.selection.motif') : t('inbox.assistant.demande.rappel')}</span>
									<span className="text-xs text-text-2">{t('inbox.assistant.envoyer.aide')}</span>
								</div>
							</div>
							<div className="flex flex-wrap gap-2">
								{a.enDemande ? (
									<Button variante="secondaire" taille="compacte" data-testid="assistant-annuler" onClick={a.annuler}>
										<X aria-hidden="true" size={16} />
										{t('inbox.assistant.annuler')}
									</Button>
								) : (
									<Button variante="primaire" taille="compacte" data-testid="assistant-envoyer" disabled={!demandeValide || occupe} onClick={lancer}>
										<Sparkles aria-hidden="true" size={16} />
										{t('inbox.assistant.envoyer')}
									</Button>
								)}
							</div>
						</>
					) : null}

					{a.enDemande ? (
						<div className="flex flex-col gap-2" data-testid="assistant-progression">
							<p role="status" className="text-sm text-text-2 tabular-nums">
								{a.progression === null ? t('inbox.assistant.lecture') : t('inbox.assistant.progression', { k: String(a.progression.lot), n: String(a.progression.lots) })}
								{a.progression?.occupe != null ? ` — ${t('inbox.assistant.occupe', { essai: String(a.progression.occupe) })}` : ''}
							</p>
							<SkeletonListe lignes={2} libelle={t('inbox.assistant.plan.titre')} />
						</div>
					) : null}

					{a.echec !== null && !a.enDemande ? (
						<div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft" data-testid="assistant-echec">
							<TriangleAlert aria-hidden="true" size={16} />
							<span>
								{t(a.echec.lotsRestants === 1 ? 'inbox.assistant.echec.lot.un' : 'inbox.assistant.echec.lots', {
									n: String(a.echec.lotsRestants),
									total: String(a.echec.lotsTotal),
									raison: t(CLES_ECHEC[a.echec.echec]),
								})}
							</span>
							{a.echec.lotsRestants > 0 ? (
								<Button variante="discret" taille="compacte" data-testid="assistant-reessayer-lot" onClick={() => void a.reessayerLots()}>
									{t('inbox.assistant.echec.reessayer')}
								</Button>
							) : null}
						</div>
					) : null}

					{a.lignes.length > 0 ? (
						<ul className="flex flex-col gap-2" data-testid="assistant-plan" aria-label={t('inbox.assistant.plan.titre')}>
							{a.lignes.map((ligne) => {
								const cle = cleDeLigne(ligne.plan)
								return (
									<LigneDuPlan
										key={cle}
										ligne={ligne}
										occupee={a.enApplication.has(cle)}
										bloquee={a.enDemande || a.toutEnCours || (a.enApplication.size > 0 && !a.enApplication.has(cle))}
										confirmation={a.confirmation}
										idEspace={portee.idWorkspace}
										retention={retention}
										porteeFil={a.porteeDuFil(ligne.plan)}
										onAccepter={() => {
											void a.accepter(cle).then(() => rendreFocusLigne(cle))
										}}
										onRefuser={() => {
											a.refuser(cle)
											onAnnonce(t('inbox.assistant.annonce.refuse', { objet: objetDe(ligne.plan) }))
											rendreFocusLigne(cle)
										}}
									/>
								)
							})}
						</ul>
					) : null}

					{a.demandee && !a.enDemande && a.lignes.length === 0 && a.echec === null && !a.trop ? (
						<p className="text-sm text-text-2" data-testid="assistant-plan-vide">
							{t('inbox.assistant.plan.vide')}
						</p>
					) : null}

					{!a.enDemande && (a.rejetees > 0 || a.ecartes > 0 || a.sansProposition > 0) ? (
						<ul className="text-sm text-text-2 flex flex-col gap-1" data-testid="assistant-ecarts">
							{a.rejetees > 0 ? <li>{accord(a.rejetees, 'inbox.assistant.rejetees.un', 'inbox.assistant.rejetees.plusieurs')}</li> : null}
							{a.ecartes > 0 ? <li>{accord(a.ecartes, 'inbox.assistant.ecartes.un', 'inbox.assistant.ecartes.plusieurs')}</li> : null}
							{a.sansProposition > 0 ? <li>{accord(a.sansProposition, 'inbox.assistant.sansproposition.un', 'inbox.assistant.sansproposition.plusieurs')}</li> : null}
						</ul>
					) : null}

					{a.lignes.length > 0 && !a.enDemande ? (
						<div className="flex flex-col gap-2 border-t border-border pt-3">
							{confirmerTout ? (
								<div role="group" aria-label={t('inbox.assistant.tout.accepter')} data-testid="assistant-tout-confirmation" className="rounded-sm border border-border p-3 flex flex-col gap-2">
									{a.compteToutAccepter.actions === 0 ? (
										<p className="text-sm text-text-2">{t('inbox.assistant.tout.rien')}</p>
									) : (
										<p className="font-medium text-ink">
											{t('inbox.assistant.tout.question', {
												actions: texteActions(a.compteToutAccepter.actions),
												mails: texteMails(a.compteToutAccepter.fils),
											})}
										</p>
									)}
									{a.compteToutAccepter.aConfirmer > 0 ? (
										<p className="text-sm text-text-2">
											{accord(a.compteToutAccepter.aConfirmer, 'inbox.assistant.tout.irreversibles.un', 'inbox.assistant.tout.irreversibles.plusieurs')}
										</p>
									) : null}
									<div className="flex flex-wrap gap-2">
										<Button ref={refAnnulerTout} variante="secondaire" taille="compacte" onClick={() => setConfirmerTout(false)}>
											{t('inbox.assistant.tout.annuler')}
										</Button>
										<Button
											variante="primaire"
											taille="compacte"
											data-testid="assistant-tout-appliquer"
											disabled={a.compteToutAccepter.actions === 0 || a.toutEnCours}
											aria-busy={a.toutEnCours}
											onClick={() => {
												setConfirmerTout(false)
												void a.toutAccepter()
											}}
										>
											{t('inbox.assistant.tout.appliquer')}
										</Button>
									</div>
								</div>
							) : (
								<Button
									variante="secondaire"
									taille="compacte"
									data-testid="assistant-tout-accepter"
									disabled={occupe || a.compteToutAccepter.actions === 0}
									onClick={() => setConfirmerTout(true)}
								>
									<Check aria-hidden="true" size={16} />
									{t('inbox.assistant.tout.accepter')}
								</Button>
							)}
						</div>
					) : null}
				</section>
			) : null}
			<button
				ref={refBulle}
				type="button"
				data-testid="assistant-bulle"
				aria-expanded={ouvert}
				aria-controls={ouvert ? idPanneau : undefined}
				aria-label={a.enDemande ? t('inbox.assistant.bulle.nom.encours') : t('inbox.assistant.bulle.nom')}
				className="size-12 rounded-full bg-brand text-white shadow-[var(--shadow-card-hover)] hover:bg-brand-hover inline-flex items-center justify-center"
				onClick={() => (ouvert ? fermer() : ouvrir())}
			>
				<Sparkles aria-hidden="true" size={22} />
			</button>
		</div>
	)
}
