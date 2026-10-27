// @spec CRM-118 (docs/BACKLOG.md) — tranche T1.b : le panneau « Changer de workflow » sous la ligne d'un channel de
//       l'arborescence — le nouveau workflow, une destination par étape occupée, la perte des réponses consentie
//       (docs/SPEC-workflow-engine.md §7 quinquies.3 ; docs/JOURNAL.md décisions 758 et 760)
// @spec docs/SPEC-change-channel-workflow.md §2 (le mapping exhaustif, aucune destination devinée), §3 (les refus), §5 (la
//       perte explicite des réponses)
// @spec docs/DESIGN_SYSTEM.md §5.72 (ce panneau), §5.13 (dans le flux, sous la ligne, refus dans le bloc), §5.50 (le
//       bouton désactivé tant qu'un choix manque — l'état de la saisie, jamais un droit), §5.59 (commandes éteintes avec
//       le motif de l'écran), §5.27 (borné à la fenêtre), §11 (repli sous `md`), §10 (aucun texte en dur)
//
// LE PANNEAU NE DÉCIDE RIEN : il lit les étapes occupées et les cibles, compose le mapping que la personne a choisi, et
// laisse `change_channel_workflow` trancher. La case de perte n'apparaît qu'APRÈS le refus `field_values_would_be_lost` :
// elle répond à ce que la base a mesuré, jamais à une estimation de l'écran.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useRefus } from '../components/ui/RefusCommandes'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { enChargement } from '../lib/async'
import {
	changerWorkflowChannel,
	composerMapping,
	lireEtapesCibles,
	lireEtapesOccupees,
	lireNomWorkflow,
	lireWorkflowsCibles,
	mappingComplet,
	type EtapeCible,
	type EtapeOccupee,
	type RefusChangement,
	type WorkflowCible,
} from '../lib/changement-workflow-channel'
import type { ClientCrm } from '../lib/supabase'

/** Le dictionnaire FERMÉ des refus : jamais le message du serveur (`CLAUDE.md` §20). La perte a sa propre alerte. */
export function texteRefusChangement(refus: Exclude<RefusChangement, { nature: 'perte' }>): string {
	switch (refus.nature) {
		case 'meme-workflow':
			return t('admin.tree.workflowChange.refus.meme-workflow')
		case 'mapping-incomplet':
			return t('admin.tree.workflowChange.refus.mapping-incomplet')
		case 'mapping-invalide':
			return t('admin.tree.workflowChange.refus.mapping-invalide')
		case 'etape-hors-workflow':
			return t('admin.tree.workflowChange.refus.etape-hors-workflow')
		case 'workflow-introuvable':
			return t('admin.tree.workflowChange.refus.workflow-introuvable')
		case 'workflow-incompatible':
			return t('admin.tree.workflowChange.refus.workflow-incompatible')
		case 'channel-introuvable':
			return t('admin.tree.workflowChange.refus.channel-introuvable')
		case 'interdit':
			return t('admin.tree.workflowChange.refus.interdit')
		case 'reseau':
			return t('admin.tree.workflowChange.refus.reseau')
		case 'inconnu':
			return t('admin.tree.workflowChange.refus.inconnu')
	}
}

/** « 3 affaires » : le nombre en toutes lettres et par clé (§10). */
function texteAffaires(n: number): string {
	return n === 1
		? t('admin.tree.workflowChange.cards.one')
		: t('admin.tree.workflowChange.cards.other', { n: String(n) })
}

const CLASSES_CONTROLE = [
	'min-h-[var(--size-target)] w-full rounded-sm border border-border bg-surface px-3',
	'focus:outline-none focus:ring-2 focus:ring-brand',
].join(' ')

export type ChannelAChanger = {
	readonly id: string
	readonly name: string
	readonly workspace_id: string
	readonly track_id: string
	readonly workflow_id: string
}

export type ProprietesPanneauChangementWorkflow = {
	readonly client: ClientCrm
	readonly channel: ChannelAChanger
	readonly onAnnuler: () => void
	/** Le changement est appliqué : l'écran referme, annonce et relit la ligne. */
	readonly onApplique: (nomWorkflow: string) => void
}

export function PanneauChangementWorkflow({ client, channel, onAnnuler, onApplique }: ProprietesPanneauChangementWorkflow) {
	const droit = useRefus()
	const idWorkflow = useId()
	const idPerte = useId()
	const premier = useRef<HTMLSelectElement>(null)
	const [nomCourant, setNomCourant] = useState<EtatAsync<string | null>>(enChargement)
	const [cibles, setCibles] = useState<EtatAsync<readonly WorkflowCible[]>>(enChargement)
	const [occupees, setOccupees] = useState<EtatAsync<readonly EtapeOccupee[]>>(enChargement)
	const [etapesCibles, setEtapesCibles] = useState<EtatAsync<readonly EtapeCible[]> | null>(null)
	const [choixWorkflow, setChoixWorkflow] = useState('')
	const [choix, setChoix] = useState<ReadonlyMap<string, string>>(new Map())
	const [perte, setPerte] = useState<number | null>(null)
	const [perteAcceptee, setPerteAcceptee] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)

	useEffect(() => {
		let vivant = true
		void Promise.all([
			lireNomWorkflow(client, channel.workflow_id),
			lireWorkflowsCibles(client, channel.workspace_id, channel.track_id, channel.workflow_id),
			lireEtapesOccupees(client, channel.id),
		]).then(([nom, workflows, etapes]) => {
			if (!vivant) return
			setNomCourant(nom)
			setCibles(workflows)
			setOccupees(etapes)
		})
		return () => {
			vivant = false
		}
	}, [client, channel.id, channel.workflow_id, channel.workspace_id, channel.track_id])

	// Le focus entre dans le premier champ une fois les lectures arrivées (§5.13).
	const pret = cibles.statut === 'pret' && occupees.statut === 'pret'
	useEffect(() => {
		if (pret) premier.current?.focus()
	}, [pret])

	// Un autre workflow, d'autres destinations : les choix et la perte mesurée repartent de zéro.
	useEffect(() => {
		setChoix(new Map())
		setPerte(null)
		setPerteAcceptee(false)
		setRefus(null)
		if (choixWorkflow === '') {
			setEtapesCibles(null)
			return
		}
		let vivant = true
		setEtapesCibles(enChargement())
		void lireEtapesCibles(client, choixWorkflow).then((lues) => {
			if (vivant) setEtapesCibles(lues)
		})
		return () => {
			vivant = false
		}
	}, [client, choixWorkflow])

	const listeOccupees = occupees.statut === 'pret' ? occupees.donnees : []
	const complet =
		choixWorkflow !== '' && etapesCibles?.statut === 'pret' && mappingComplet(listeOccupees, choix)
	const bloqueParPerte = perte !== null && !perteAcceptee
	const nomCible = cibles.statut === 'pret' ? (cibles.donnees.find((w) => w.id === choixWorkflow)?.name ?? '') : ''

	async function envoyer(evenement: FormEvent) {
		evenement.preventDefault()
		if (!complet || bloqueParPerte) return
		setEnCours(true)
		try {
			const resultat = await changerWorkflowChannel(
				client,
				channel.id,
				choixWorkflow,
				composerMapping(choix),
				perte !== null && perteAcceptee,
			)
			if (resultat.statut === 'applique') {
				onApplique(nomCible)
				return
			}
			if (resultat.refus.nature === 'perte') {
				setRefus(null)
				setPerte(resultat.refus.reponses)
				setPerteAcceptee(false)
				return
			}
			setRefus(texteRefusChangement(resultat.refus))
		} finally {
			setEnCours(false)
		}
	}

	const titre =
		nomCourant.statut === 'pret' && nomCourant.donnees !== null
			? t('admin.tree.workflowChange.title', { channel: channel.name, workflow: nomCourant.donnees })
			: t('admin.tree.workflowChange.title.sans-nom', { channel: channel.name })

	return (
		<form
			data-testid="panneau-changement-workflow"
			aria-label={t('admin.tree.workflowChange.aria', { channel: channel.name })}
			className="my-2 flex max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:max-w-2xl"
			onSubmit={(evenement) => void envoyer(evenement)}
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') onAnnuler()
			}}
		>
			<p className="font-medium whitespace-normal">{titre}</p>

			{!pret && cibles.statut !== 'erreur' && occupees.statut !== 'erreur' ? (
				<SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
			) : null}
			{cibles.statut === 'erreur' || occupees.statut === 'erreur' ? (
				<p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					{t('admin.tree.workflowChange.error')}
				</p>
			) : null}

			{pret ? (
				<>
					<div className="flex flex-col gap-1">
						<label htmlFor={idWorkflow} className="text-sm font-medium">
							{t('admin.tree.workflowChange.workflow')}
						</label>
						<select
							id={idWorkflow}
							ref={premier}
							value={choixWorkflow}
							onChange={(evenement) => setChoixWorkflow(evenement.target.value)}
							className={CLASSES_CONTROLE}
						>
							<option value="">{t('admin.tree.workflowChange.workflow.choose')}</option>
							{cibles.statut === 'pret'
								? cibles.donnees.map((workflow) => (
										<option key={workflow.id} value={workflow.id}>
											{workflow.name}
										</option>
									))
								: null}
						</select>
						{cibles.statut === 'pret' && cibles.donnees.length === 0 ? (
							<p className="text-sm text-text-2 whitespace-normal">{t('admin.tree.workflowChange.workflow.none')}</p>
						) : null}
					</div>

					<fieldset className="flex flex-col gap-2">
						<legend className="mb-1 text-sm font-medium">{t('admin.tree.workflowChange.mapping.title')}</legend>
						{listeOccupees.length === 0 ? (
							<p className="text-sm text-text-2 whitespace-normal">{t('admin.tree.workflowChange.mapping.empty')}</p>
						) : (
							<ul className="flex flex-col gap-2">
								{listeOccupees.map((etape) => (
									<LigneDestination
										key={etape.id}
										etape={etape}
										etapesCibles={etapesCibles}
										valeur={choix.get(etape.id) ?? ''}
										onChange={(valeur) => {
											setChoix((precedents) => new Map(precedents).set(etape.id, valeur))
											setPerte(null)
											setPerteAcceptee(false)
										}}
									/>
								))}
							</ul>
						)}
					</fieldset>

					{perte === null ? null : (
						<div
							role="alert"
							data-testid="changement-workflow-perte"
							className="flex flex-col gap-2 rounded-sm bg-accent-soft px-3 py-2 text-sm text-accent-on-soft"
						>
							<p className="flex items-start gap-2 whitespace-normal">
								<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="mt-[2px] shrink-0" />
								<span>
									{perte === 1
										? t('admin.tree.workflowChange.loss.one')
										: t('admin.tree.workflowChange.loss.other', { n: String(perte) })}
								</span>
							</p>
							<label htmlFor={idPerte} className="inline-flex min-h-[var(--size-target)] items-center gap-2">
								<input
									id={idPerte}
									type="checkbox"
									checked={perteAcceptee}
									onChange={(evenement) => setPerteAcceptee(evenement.target.checked)}
									className="size-6 rounded-sm border border-border"
								/>
								{t('admin.tree.workflowChange.loss.accept')}
							</label>
						</div>
					)}

					{refus === null ? null : (
						<p
							role="alert"
							data-testid="changement-workflow-refus"
							className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft whitespace-normal"
						>
							<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="mt-[2px] shrink-0" />
							<span>{refus}</span>
						</p>
					)}
				</>
			) : null}

			<div className="flex flex-wrap gap-2">
				<Button
					variante="primaire"
					type="submit"
					{...droit}
					disabled={droit.disabled === true || !complet || bloqueParPerte || enCours}
				>
					{t('admin.tree.workflowChange.submit')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

function LigneDestination({
	etape,
	etapesCibles,
	valeur,
	onChange,
}: {
	readonly etape: EtapeOccupee
	readonly etapesCibles: EtatAsync<readonly EtapeCible[]> | null
	readonly valeur: string
	readonly onChange: (valeur: string) => void
}) {
	const id = useId()
	return (
		<li className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
			<span className="flex flex-col md:w-1/2">
				<span className="font-medium whitespace-normal">{etape.nom}</span>
				<span className="text-sm text-text-2">{texteAffaires(etape.affaires)}</span>
			</span>
			<span className="flex flex-col gap-1 md:w-1/2">
				<label htmlFor={id} className="text-sm font-medium">
					{t('admin.tree.workflowChange.destination')}
					<span className="sr-only">{t('admin.tree.workflowChange.destination.of', { etape: etape.nom })}</span>
				</label>
				<select
					id={id}
					value={valeur}
					disabled={etapesCibles === null || etapesCibles.statut !== 'pret'}
					onChange={(evenement) => onChange(evenement.target.value)}
					className={CLASSES_CONTROLE}
				>
					<option value="">{t('admin.tree.workflowChange.destination.choose')}</option>
					{etapesCibles?.statut === 'pret'
						? etapesCibles.donnees.map((cible) => (
								<option key={cible.id} value={cible.id}>
									{cible.nom}
								</option>
							))
						: null}
				</select>
			</span>
		</li>
	)
}
