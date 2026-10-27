// @spec CRM-118 (docs/BACKLOG.md) — tranche T1.b : l'en-tête du workflow choisi dans l'éditeur — son nom, ses pilules et
//       ses cinq commandes, renommer, définir par défaut, copier vers un track, archiver, rétablir
//       (docs/SPEC-workflow-engine.md §7 quinquies.2 ; docs/JOURNAL.md décisions 758, 760 et la précision du 2026-10-27)
// @spec docs/DESIGN_SYSTEM.md §5.72 (cet en-tête), §5.15 (l'éditeur : formulaires dans le flux, aucune modale), §5.13
//       (confirmation destructive dans le flux, refus dans le bloc), §5.16 (un geste qui se défait d'un geste n'a pas de
//       confirmation), §5.21 (une commande vouée au refus n'est pas rendue), §5.50 (bouton désactivé sur champ blanc),
//       §5.59 (commandes éteintes avec le motif de l'éditeur), §5.6 (pilules), §9 (icônes Lucide), §10 (aucun texte en dur)
//
// AUCUN DROIT N'EST CALCULÉ ICI, la règle de l'éditeur : les commandes suivent la capacité fournie par
// `FournisseurRefus`, et le refus réel de la base est traduit par le dictionnaire fermé de `entete-workflow.ts`. Les
// seules commandes que l'écran ne rend pas sont celles que la base refuserait à coup sûr, d'après la ligne lue (§5.21).

import { Archive, ArchiveRestore, GitBranchPlus, PencilLine, Star, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useRefus } from '../components/ui/RefusCommandes'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import type { TrackAffectable, WorkflowAdministrable } from '../lib/administration-workflows'
import {
	archiverWorkflow,
	copierVersTrack,
	definirParDefaut,
	renommerWorkflow,
	type RefusEnTete,
	type ResultatEnTete,
} from '../lib/entete-workflow'
import type { ClientCrm } from '../lib/supabase'

/** Ce que l'en-tête a ouvert, au plus une chose (§5.28). */
export type OuvertureEnTete = 'renommer' | 'copier' | 'archiver' | null

/** Le dictionnaire FERMÉ des refus : jamais le message du serveur (`CLAUDE.md` §20). */
export function texteRefusEnTete(refus: RefusEnTete): string {
	switch (refus.nature) {
		case 'employe':
			return refus.channels === 1
				? t('admin.workflows.header.refus.employe.one')
				: t('admin.workflows.header.refus.employe.other', { n: String(refus.channels) })
		case 'par-defaut':
			return t('admin.workflows.header.refus.par-defaut')
		case 'non-global':
			return t('admin.workflows.header.refus.non-global')
		case 'archive':
			return t('admin.workflows.header.refus.archive')
		case 'nom-vide':
			return t('admin.workflows.header.refus.nom-vide')
		case 'track-introuvable':
			return t('admin.workflows.header.refus.track-introuvable')
		case 'introuvable':
			return t('admin.workflows.header.refus.introuvable')
		case 'interdit':
			return t('admin.workflows.header.refus.interdit')
		case 'reseau':
			return t('admin.workflows.header.refus.reseau')
		case 'inconnu':
			return t('admin.workflows.header.refus.inconnu')
	}
}

const CLASSES_CONTROLE = [
	'min-h-[var(--size-target)] w-full rounded-sm border border-border bg-surface px-3',
	'focus:outline-none focus:ring-2 focus:ring-brand',
].join(' ')

function AlerteEnTete({ message }: { readonly message: string }) {
	return (
		<p
			role="alert"
			data-testid="entete-workflow-refus"
			className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
		>
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
			<span>{message}</span>
		</p>
	)
}

export type ProprietesEnTeteWorkflow = {
	readonly client: ClientCrm
	readonly workflow: WorkflowAdministrable
	/** Les tracks de l'espace : le nom de la pilule d'un workflow propre à un track, et le choix de la copie. */
	readonly tracks: EtatAsync<readonly TrackAffectable[]>
	readonly ouverture: OuvertureEnTete
	/** Ouvrir une chose dans l'en-tête ferme ce que l'éditeur avait ouvert ailleurs (§5.28). */
	readonly onOuvrir: (ouverture: OuvertureEnTete) => void
	/** Après un geste appliqué : l'éditeur relit la liste, choisit `idChoisi` s'il est donné, et annonce. */
	readonly onApplique: (annonce: string, idChoisi?: string) => void
}

export function EnTeteWorkflow({ client, workflow, tracks, ouverture, onOuvrir, onApplique }: ProprietesEnTeteWorkflow) {
	const droit = useRefus()
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const commandes = useRef<Partial<Record<Exclude<OuvertureEnTete, null>, HTMLButtonElement | null>>>({})
	const [focusRendu, setFocusRendu] = useState<Exclude<OuvertureEnTete, null> | null>(null)
	const archive = workflow.archived_at !== null
	const global = workflow.scope === 'global'

	// Le refus d'un workflow ne survit pas au choix d'un autre.
	useEffect(() => {
		setRefus(null)
	}, [workflow.id])

	// Le focus revient à la commande qui a ouvert, un rendu après sa remontée (§5.25). Aucune temporisation.
	useEffect(() => {
		if (focusRendu === null) return
		const cible = commandes.current[focusRendu]
		if (cible === null || cible === undefined) return
		cible.focus()
		setFocusRendu(null)
	}, [focusRendu, ouverture])

	const ouvrir = (suivante: Exclude<OuvertureEnTete, null>) => {
		setRefus(null)
		onOuvrir(suivante)
	}
	const fermer = (depuis: Exclude<OuvertureEnTete, null>) => {
		setRefus(null)
		onOuvrir(null)
		setFocusRendu(depuis)
	}

	async function executer<T>(
		geste: () => Promise<ResultatEnTete<T>>,
		apres: (valeur: T) => void,
	): Promise<void> {
		setEnCours(true)
		try {
			const resultat = await geste()
			if (resultat.statut === 'refus') {
				setRefus(texteRefusEnTete(resultat.refus))
				return
			}
			if (resultat.statut === 'sans-effet') {
				setRefus(t('admin.workflows.header.refus.sans-effet'))
				return
			}
			setRefus(null)
			apres(resultat.valeur)
		} finally {
			setEnCours(false)
		}
	}

	const nomTrack =
		workflow.track_id === null || tracks.statut !== 'pret'
			? null
			: (tracks.donnees.find((track) => track.id === workflow.track_id)?.name ?? null)

	return (
		<div data-testid="entete-workflow" className="flex flex-col gap-3">
			{ouverture === 'renommer' ? (
				<FormulaireRenommage
					nom={workflow.name}
					enCours={enCours}
					refus={refus}
					onAnnuler={() => fermer('renommer')}
					onValider={(nom) =>
						void executer(
							() => renommerWorkflow(client, workflow.id, nom),
							() => {
								onOuvrir(null)
								setFocusRendu('renommer')
								onApplique(t('admin.workflows.header.live.renamed', { nom: nom.trim() }))
							},
						)
					}
				/>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="text-h2 font-semibold">{workflow.name}</h2>
					<Badge>
						{global
							? t('admin.workflows.scope.global')
							: (nomTrack ?? t('admin.workflows.scope.track'))}
					</Badge>
					{workflow.is_default ? <Badge ton="brand">{t('admin.workflows.default')}</Badge> : null}
					{archive ? (
						<span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium bg-accent-soft text-accent-on-soft">
							<Archive aria-hidden="true" size={14} strokeWidth={2} />
							{t('admin.workflows.archived')}
						</span>
					) : null}
				</div>
			)}

			<div
				role="toolbar"
				aria-label={t('admin.workflows.header.toolbar', { nom: workflow.name })}
				className="flex flex-wrap items-center gap-1"
			>
				<Button
					ref={(element) => {
						commandes.current.renommer = element
					}}
					variante="discret"
					taille="compacte"
					{...droit}
					aria-expanded={ouverture === 'renommer'}
					aria-label={t('admin.workflows.header.rename.aria', { nom: workflow.name })}
					onClick={() => ouvrir('renommer')}
				>
					<PencilLine aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.workflows.header.rename')}
				</Button>
				{workflow.is_default || archive || !global ? null : (
					<Button
						variante="discret"
						taille="compacte"
						{...droit}
						disabled={droit.disabled === true || enCours}
						aria-label={t('admin.workflows.header.default.aria', { nom: workflow.name })}
						onClick={() => {
							onOuvrir(null)
							void executer(
								() => definirParDefaut(client, workflow.id),
								() => onApplique(t('admin.workflows.header.live.default', { nom: workflow.name })),
							)
						}}
					>
						<Star aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.workflows.header.default')}
					</Button>
				)}
				{archive || !global ? null : (
					<Button
						ref={(element) => {
							commandes.current.copier = element
						}}
						variante="discret"
						taille="compacte"
						{...droit}
						aria-expanded={ouverture === 'copier'}
						aria-label={t('admin.workflows.header.copy.aria', { nom: workflow.name })}
						onClick={() => ouvrir('copier')}
					>
						<GitBranchPlus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.workflows.header.copy')}
					</Button>
				)}
				{archive ? (
					<Button
						variante="discret"
						taille="compacte"
						{...droit}
						disabled={droit.disabled === true || enCours}
						aria-label={t('admin.workflows.header.restore.aria', { nom: workflow.name })}
						onClick={() => {
							onOuvrir(null)
							void executer(
								() => archiverWorkflow(client, workflow.id, false),
								() => onApplique(t('admin.workflows.header.live.restored', { nom: workflow.name })),
							)
						}}
					>
						<ArchiveRestore aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.workflows.header.restore')}
					</Button>
				) : (
					<Button
						ref={(element) => {
							commandes.current.archiver = element
						}}
						variante="discret"
						taille="compacte"
						{...droit}
						aria-expanded={ouverture === 'archiver'}
						aria-label={t('admin.workflows.header.archive.aria', { nom: workflow.name })}
						onClick={() => ouvrir('archiver')}
					>
						<Archive aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.workflows.header.archive')}
					</Button>
				)}
			</div>

			{ouverture === 'copier' ? (
				<FormulaireCopie
					nom={workflow.name}
					tracks={tracks}
					enCours={enCours}
					refus={refus}
					onAnnuler={() => fermer('copier')}
					onValider={(idTrack, nom) =>
						void executer(
							() => copierVersTrack(client, workflow.id, idTrack, nom),
							(idCopie) => {
								onOuvrir(null)
								onApplique(t('admin.workflows.header.live.copied', { nom: workflow.name }), idCopie)
							},
						)
					}
				/>
			) : null}

			{ouverture === 'archiver' ? (
				<ConfirmationArchivageWorkflow
					nom={workflow.name}
					enCours={enCours}
					refus={refus}
					onAnnuler={() => fermer('archiver')}
					onConfirmer={() =>
						void executer(
							() => archiverWorkflow(client, workflow.id, true),
							() => {
								onOuvrir(null)
								onApplique(t('admin.workflows.header.live.archived', { nom: workflow.name }))
							},
						)
					}
				/>
			) : null}

			{/* Le refus d'un geste sans formulaire — défaut, rétablissement — se lit sous l'en-tête. */}
			{ouverture === null && refus !== null ? <AlerteEnTete message={refus} /> : null}
		</div>
	)
}

function FormulaireRenommage({
	nom,
	enCours,
	refus,
	onAnnuler,
	onValider,
}: {
	readonly nom: string
	readonly enCours: boolean
	readonly refus: string | null
	readonly onAnnuler: () => void
	readonly onValider: (nom: string) => void
}) {
	const droit = useRefus()
	const id = useId()
	const [saisie, setSaisie] = useState(nom)
	const champ = useRef<HTMLInputElement>(null)
	useEffect(() => {
		champ.current?.focus()
		champ.current?.select()
	}, [])
	const blanc = saisie.trim() === ''
	return (
		<form
			data-testid="entete-workflow-renommage"
			className="flex flex-col gap-2"
			onSubmit={(evenement: FormEvent) => {
				evenement.preventDefault()
				if (!blanc) onValider(saisie)
			}}
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') onAnnuler()
			}}
		>
			<label htmlFor={id} className="text-sm font-medium">
				{t('admin.workflows.header.rename.field')}
			</label>
			<input
				id={id}
				ref={champ}
				value={saisie}
				onChange={(evenement) => setSaisie(evenement.target.value)}
				className={CLASSES_CONTROLE}
			/>
			{refus === null ? null : <AlerteEnTete message={refus} />}
			<div className="flex flex-wrap gap-2">
				<Button variante="primaire" type="submit" {...droit} disabled={droit.disabled === true || blanc || enCours}>
					{t('admin.action.save')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

function FormulaireCopie({
	nom,
	tracks,
	enCours,
	refus,
	onAnnuler,
	onValider,
}: {
	readonly nom: string
	readonly tracks: EtatAsync<readonly TrackAffectable[]>
	readonly enCours: boolean
	readonly refus: string | null
	readonly onAnnuler: () => void
	readonly onValider: (idTrack: string, nom: string) => void
}) {
	const droit = useRefus()
	const idTrack = useId()
	const idNom = useId()
	const [track, setTrack] = useState('')
	const [saisie, setSaisie] = useState(nom)
	const premier = useRef<HTMLSelectElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	return (
		<form
			data-testid="entete-workflow-copie"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement: FormEvent) => {
				evenement.preventDefault()
				if (track !== '') onValider(track, saisie)
			}}
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') onAnnuler()
			}}
		>
			<p className="font-medium">{t('admin.workflows.header.copy.title', { nom })}</p>
			<div className="flex flex-col gap-1">
				<label htmlFor={idTrack} className="text-sm font-medium">
					{t('admin.workflows.header.copy.track')}
				</label>
				<select
					id={idTrack}
					ref={premier}
					value={track}
					onChange={(evenement) => setTrack(evenement.target.value)}
					className={CLASSES_CONTROLE}
				>
					<option value="">{t('admin.workflows.create.track.choose')}</option>
					{tracks.statut === 'pret'
						? tracks.donnees.map((choix) => (
								<option key={choix.id} value={choix.id}>
									{choix.name}
								</option>
							))
						: null}
				</select>
				{tracks.statut === 'chargement' ? (
					<p className="text-sm text-text-2">{t('admin.workflows.create.track.loading')}</p>
				) : null}
				{tracks.statut === 'erreur' ? (
					<p className="text-sm text-danger-on-soft">{t('admin.workflows.create.track.error')}</p>
				) : null}
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={idNom} className="text-sm font-medium">
					{t('admin.workflows.header.copy.name')}
				</label>
				<input
					id={idNom}
					value={saisie}
					onChange={(evenement) => setSaisie(evenement.target.value)}
					className={CLASSES_CONTROLE}
				/>
				<p className="text-sm text-text-2">{t('admin.workflows.header.copy.name.help')}</p>
			</div>
			{refus === null ? null : <AlerteEnTete message={refus} />}
			<div className="flex flex-wrap gap-2">
				<Button
					variante="primaire"
					type="submit"
					{...droit}
					disabled={droit.disabled === true || track === '' || enCours}
				>
					<GitBranchPlus aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.workflows.header.copy.submit')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

function ConfirmationArchivageWorkflow({
	nom,
	enCours,
	refus,
	onAnnuler,
	onConfirmer,
}: {
	readonly nom: string
	readonly enCours: boolean
	readonly refus: string | null
	readonly onAnnuler: () => void
	readonly onConfirmer: () => void
}) {
	const droit = useRefus()
	const premier = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	return (
		<div
			data-testid="entete-workflow-archivage"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') onAnnuler()
			}}
		>
			<p className="font-medium">{t('admin.workflows.header.archive.confirm.title', { nom })}</p>
			<p className="text-sm text-text-2">{t('admin.workflows.header.archive.confirm.body')}</p>
			{refus === null ? null : <AlerteEnTete message={refus} />}
			<div className="flex flex-wrap gap-2">
				<Button
					ref={premier}
					variante="destructif"
					{...droit}
					disabled={droit.disabled === true || enCours}
					onClick={onConfirmer}
				>
					<Archive aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.workflows.header.archive.confirm.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}
