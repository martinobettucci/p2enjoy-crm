// @spec CRM-156 (docs/BACKLOG.md) — tranche T4 : Réglages ▸ Expéditeurs bloqués — la liste des adresses bloquées de
//       l'espace, qui les a bloquées et quand, et « Débloquer » avec sa confirmation courte dans le flux
// @spec docs/DESIGN_SYSTEM.md §5.109 bis (« RÉGLAGES ▸ EXPÉDITEURS BLOQUÉS ») ; docs/SPEC-mail-subsystem.md §32.8 ;
//       docs/JOURNAL.md décisions 945 et 947 ; docs/DESIGN_SYSTEM.md §5.104 (la forme reprise), §5.59 (les commandes
//       éteintes avec leur motif), §5.16 (le geste qui ne détruit rien est primaire), §5.13, §5.51, §5.8
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : seul l'administrateur débloque, et la base le tranche
//       (`unblock_sender`) ; la capacité d'administrer, rendue par la base, éteint les commandes
//
// L'ÉCRAN SE LIT PAR TOUT MEMBRE : on y voit pourquoi des mails vont droit à la corbeille. On bloque depuis l'inbox, jamais
// d'ici : le vide n'offre aucune action (§5.51).

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { NatureErreur } from '../lib/async'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { debloquerExpediteur, lireExpediteursBloques, type ExpediteurBloque } from '../lib/transferts-inbox'
import { useContexteEspace } from './ContexteEspace'
import { phraseDatee } from './TransfertInbox'

const ID_MOTIF = 'expediteurs-bloques-lecture-seule'

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly adresses: readonly ExpediteurBloque[] }

export function ReglagesExpediteursBloques({ client = clientCrm }: { readonly client?: ClientCrm | null } = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const eteint = capacites.administration !== 'permise'
	const refuse = capacites.administration === 'refusee'
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [ouverte, setOuverte] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	const refTitre = useRef<HTMLHeadingElement | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const r = ++rang.current
		void lireExpediteursBloques(client, idWorkspace).then((lu) => {
			if (r !== rang.current) return
			if (lu.statut === 'erreur') setLecture({ statut: 'erreur', nature: lu.erreur.nature })
			else if (lu.statut === 'pret') setLecture({ statut: 'pret', adresses: lu.donnees })
		})
	}, [client, idWorkspace, tentative])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.blockedSenders.noworkspace')} />
	}

	const fermer = (adresse: string) => {
		setOuverte(null)
		setRefus(null)
		requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-debloquer="${CSS.escape(adresse)}"]`)?.focus())
	}

	const debloquer = async (adresse: string) => {
		setEnCours(true)
		setRefus(null)
		const erreur = await debloquerExpediteur(client, idWorkspace, adresse)
		setEnCours(false)
		if (erreur !== null) {
			setRefus(
				t(
					erreur.nature === 'forbidden' || erreur.detail.includes('forbidden')
						? 'admin.blockedSenders.refus.forbidden'
						: 'admin.blockedSenders.refus.panne',
				),
			)
			return
		}
		// La ligne disparaît avec sa commande : le focus va au titre de l'écran (§5.13).
		setOuverte(null)
		setAnnonce(t('admin.blockedSenders.unblocked', { adresse }))
		setTentative((n) => n + 1)
		requestAnimationFrame(() => refTitre.current?.focus())
	}

	const adresses = lecture.statut === 'pret' ? lecture.adresses : []

	return (
		<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-expediteurs-bloques">
			<h2 ref={refTitre} tabIndex={-1} className="text-h3">
				{t('admin.blockedSenders.title')}
			</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('admin.blockedSenders.intro')}</p>
			{refuse ? <MotifLectureSeule id={ID_MOTIF}>{t('rights.readonly.administration')}</MotifLectureSeule> : null}
			<p role="status" className="sr-only" data-testid="annonce-expediteurs-bloques">
				{annonce}
			</p>

			{lecture.statut === 'chargement' ? (
				<SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.blockedSenders.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : adresses.length === 0 ? (
				<EtatVide titre={t('admin.blockedSenders.empty')} corps="" />
			) : (
				<ul className="flex flex-col rounded-lg border border-border bg-surface" data-testid="liste-expediteurs-bloques">
					{adresses.map((ligne) => (
						<li
							key={ligne.adresse}
							data-testid="ligne-expediteur-bloque"
							className="flex flex-col gap-2 px-4 py-3 border-b border-border last:border-b-0"
						>
							<div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
								<span className="flex min-w-0 flex-col gap-1 md:flex-1">
									<code className="font-mono text-sm break-all">{ligne.adresse}</code>
									<span className="text-[13px] text-text-2">
										{phraseDatee(
											(date) => t('admin.blockedSenders.by', { nom: ligne.bloquePar ?? t('inbox.transfer.deleted'), date }),
											ligne.le,
										)}
									</span>
								</span>
								<span>
									<Button
										variante="discret"
										taille="compacte"
										data-debloquer={ligne.adresse}
										data-testid="debloquer-expediteur"
										disabled={eteint || ouverte !== null}
										aria-label={t('admin.blockedSenders.unblock.aria', { adresse: ligne.adresse })}
										{...(refuse ? { 'aria-describedby': ID_MOTIF } : {})}
										onClick={() => {
											setRefus(null)
											setOuverte(ligne.adresse)
										}}
									>
										{t('admin.blockedSenders.unblock')}
									</Button>
								</span>
							</div>
							{ouverte === ligne.adresse ? (
								<ConfirmationDeblocage
									adresse={ligne.adresse}
									enCours={enCours}
									refus={refus}
									onAnnuler={() => fermer(ligne.adresse)}
									onConfirmer={() => void debloquer(ligne.adresse)}
								/>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

/** La confirmation courte, dans le flux sous la ligne ; « Débloquer » primaire : le geste ne détruit rien (§5.16). */
function ConfirmationDeblocage({
	adresse,
	enCours,
	refus,
	onAnnuler,
	onConfirmer,
}: {
	readonly adresse: string
	readonly enCours: boolean
	readonly refus: string | null
	readonly onAnnuler: () => void
	readonly onConfirmer: () => void
}) {
	const refAnnuler = useRef<HTMLButtonElement | null>(null)
	const idQuestion = useId()
	useEffect(() => {
		refAnnuler.current?.focus()
	}, [])
	return (
		<div
			role="group"
			aria-labelledby={idQuestion}
			data-testid="confirmation-deblocage"
			className="rounded-sm border border-border p-3 flex flex-col gap-3"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape' && !enCours) {
					evenement.stopPropagation()
					onAnnuler()
				}
			}}
		>
			<p id={idQuestion} className="text-sm text-ink break-words">
				{t('admin.blockedSenders.unblock.confirm', { adresse })}
			</p>
			{refus !== null ? (
				<p role="alert" className="text-sm text-danger" data-testid="refus-deblocage">
					{refus}
				</p>
			) : null}
			<div className="flex flex-col md:flex-row md:flex-wrap gap-2">
				<Button ref={refAnnuler} variante="secondaire" taille="compacte" disabled={enCours} onClick={onAnnuler}>
					{t('inbox.bulk.annuler')}
				</Button>
				<Button
					variante="primaire"
					taille="compacte"
					data-testid="confirmer-deblocage"
					disabled={enCours}
					aria-busy={enCours || undefined}
					onClick={onConfirmer}
				>
					{t('admin.blockedSenders.unblock')}
				</Button>
			</div>
		</div>
	)
}
