// @spec CRM-068 (docs/BACKLOG.md) — tranche T3b : les checklists dans l'éditeur de workflows — le bloc « Checklists des
//       étapes » et les points exigés sous chaque transition du bloc des exigences
// @spec docs/SPEC-checklists.md §3.1, §3.4, §4 (décision 759) ; docs/DESIGN_SYSTEM.md §5.70 bis (ce bloc), §5.15 (l'éditeur :
//       barre de boutons discrets toujours visibles, commandes d'ordre désactivées aux extrémités, formulaires dans le
//       flux), §5.18 (liste plate, point archivé nommé), §5.28 (un seul élément ouvert), §5.41 (retrait sans confirmation),
//       §5.50 (bouton désactivé sur champ blanc), §5.59 (commandes éteintes avec le motif de l'éditeur), §5.8 (états)
// @spec CLAUDE.md §10 — le sélecteur « Exiger un point » ne propose que les points de l'étape de départ : ce n'est pas un
//       droit calculé, c'est le refus d'une cible vouée au refus ; la base tranche, l'écran traduit
//
// UN SEUL ÉLÉMENT OUVERT À LA FOIS, TOUS BLOCS CONFONDUS (§5.28) : l'état d'ouverture est fourni par l'éditeur, qui le
// partage entre le bloc des checklists et chaque transition du bloc des exigences.

import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { useRefus } from '../components/ui/RefusCommandes'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import {
	LONGUEUR_MAX_POINT_ETAPE,
	ajouterPointEtape,
	archiverPointEtape,
	deplacementPoint,
	exigerPoint,
	nePlusExigerPoint,
	placerPointEtape,
	pointsDeLEtape,
	pointsExigeables,
	pointsExiges,
	positionNouveauPoint,
	renommerPointEtape,
	type ChecklistsWorkflow,
	type IssueChecklistsWorkflow,
	type NatureRefusChecklistsWorkflow,
	type PointEtape,
} from '../lib/administration-checklists'
import {
	grouperTransitions,
	libelleEtape,
	type EtapeAdministrable,
	type TransitionAdministrable,
} from '../lib/administration-workflows'
import type { ClientCrm } from '../lib/supabase'

/** Le dictionnaire FERMÉ des refus : jamais le message du serveur (`CLAUDE.md` §20). */
export const MESSAGES_REFUS_CHECKLISTS_WORKFLOW: Readonly<Record<NatureRefusChecklistsWorkflow, CleTraduction>> = {
	libelle: 'admin.workflows.checklists.refus.libelle',
	'hors-etape': 'admin.workflows.checklists.refus.hors-etape',
	'deja-exige': 'admin.workflows.checklists.refus.deja-exige',
	forbidden: 'admin.workflows.checklists.refus.forbidden',
	'sans-effet': 'admin.workflows.checklists.refus.sans-effet',
	network: 'admin.workflows.checklists.refus.network',
	unknown: 'admin.workflows.checklists.refus.unknown',
}

/** Ce qui est ouvert dans les checklists de l'éditeur, au plus une chose (§5.28). */
export type OuvertureChecklist =
	| { readonly genre: 'ajout'; readonly idEtape: string }
	| { readonly genre: 'renommage'; readonly idPoint: string }
	| { readonly genre: 'exigence'; readonly idTransition: string }
	| null

/** Ce que l'éditeur fournit aux deux composants : le client, l'état partagé, et les rappels d'après écriture. */
export type ContexteChecklistsWorkflow = {
	readonly client: ClientCrm
	readonly checklists: EtatAsync<ChecklistsWorkflow>
	readonly ouverture: OuvertureChecklist
	readonly onOuvrir: (ouverture: OuvertureChecklist) => void
	/** Appelé après chaque écriture appliquée : l'éditeur relit les checklists, et annonce l'issue. */
	readonly onEcrit: (annonce: string) => void
	readonly onReprise: () => void
}

const CLASSES_CONTROLE = [
	'min-h-[var(--size-target)] w-full rounded-sm border border-border bg-surface px-3',
	'focus:outline-none focus:ring-2 focus:ring-brand',
].join(' ')
const CLASSES_REFUS = 'rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft'

/** Une étape telle que le bloc la nomme. */
export type EtapeChecklist = { readonly id: string; readonly libelle: string }

// ---------------------------------------------------------------------------------------------
// Le bloc « Checklists des étapes »
// ---------------------------------------------------------------------------------------------

export function BlocChecklistsEtapes({
	etapes,
	idWorkspace,
	idWorkflow,
	nomWorkflow,
	contexte,
}: {
	/** Les étapes dans l'ordre du graphe (§5.15). */
	readonly etapes: readonly EtapeChecklist[]
	readonly idWorkspace: string
	readonly idWorkflow: string
	readonly nomWorkflow: string
	readonly contexte: ContexteChecklistsWorkflow
}) {
	const { checklists } = contexte
	return (
		<section
			aria-label={t('admin.workflows.checklists.aria', { workflow: nomWorkflow })}
			data-testid="bloc-checklists-etapes"
			className="flex flex-col gap-3"
		>
			<div className="flex flex-col gap-1">
				<h3 className="font-medium">{t('admin.workflows.checklists.title')}</h3>
				<p className="text-sm text-text-2">{t('admin.workflows.checklists.intro')}</p>
			</div>
			{checklists.statut === 'chargement' ? (
				<SkeletonListe lignes={2} libelle={t('admin.workflows.checklists.loading')} />
			) : null}
			{checklists.statut === 'erreur' ? (
				<div className="flex flex-col items-start gap-2" data-testid="erreur-checklists-workflow">
					<p role="alert" className={CLASSES_REFUS}>
						{t('admin.workflows.checklists.error')}
					</p>
					<Button taille="compacte" onClick={contexte.onReprise}>
						{t('admin.tree.error.retry')}
					</Button>
				</div>
			) : null}
			{checklists.statut === 'pret' ? (
				<ol className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
					{etapes.map((etape) => (
						<EtapeAvecPoints
							key={etape.id}
							etape={etape}
							points={pointsDeLEtape(checklists.donnees.points, etape.id)}
							tousPoints={checklists.donnees.points}
							idWorkspace={idWorkspace}
							idWorkflow={idWorkflow}
							contexte={contexte}
						/>
					))}
				</ol>
			) : null}
		</section>
	)
}

function EtapeAvecPoints({
	etape,
	points,
	tousPoints,
	idWorkspace,
	idWorkflow,
	contexte,
}: {
	readonly etape: EtapeChecklist
	readonly points: readonly PointEtape[]
	readonly tousPoints: readonly PointEtape[]
	readonly idWorkspace: string
	readonly idWorkflow: string
	readonly contexte: ContexteChecklistsWorkflow
}) {
	const droit = useRefus()
	const idTitre = useId()
	const ajoutOuvert = contexte.ouverture?.genre === 'ajout' && contexte.ouverture.idEtape === etape.id
	const commande = useRef<HTMLButtonElement>(null)
	const [rendreFocus, setRendreFocus] = useState(false)
	useEffect(() => {
		if (!rendreFocus || ajoutOuvert) return
		commande.current?.focus()
		setRendreFocus(false)
	}, [rendreFocus, ajoutOuvert])

	return (
		<li data-testid="checklist-etape" data-etape={etape.id} className="flex flex-col gap-1">
			<h4 id={idTitre} className="font-medium">
				{etape.libelle}
			</h4>
			{points.length === 0 ? (
				<p className="text-sm text-text-2">{t('admin.workflows.checklists.empty')}</p>
			) : (
				<ul aria-labelledby={idTitre} className="flex flex-col">
					{points.map((point) => (
						<LignePointEtape key={point.id} point={point} tousPoints={tousPoints} contexte={contexte} />
					))}
				</ul>
			)}
			{ajoutOuvert ? (
				<FormulaireLibelle
					libelleChamp={t('admin.workflows.checklists.add.label')}
					libelleEnvoi={t('admin.workflows.checklists.add.submit')}
					initiale=""
					onEnvoyer={(libelle) =>
						ajouterPointEtape(
							contexte.client,
							{ idWorkspace, idWorkflow, idEtape: etape.id },
							libelle,
							positionNouveauPoint(tousPoints, etape.id),
						)
					}
					onReussi={(libelle) => {
						contexte.onOuvrir(null)
						setRendreFocus(true)
						contexte.onEcrit(t('admin.workflows.checklists.live.added', { libelle, etape: etape.libelle }))
					}}
					onAnnuler={() => {
						contexte.onOuvrir(null)
						setRendreFocus(true)
					}}
				/>
			) : (
				<div>
					<Button
						{...droit}
						ref={commande}
						variante="discret"
						taille="compacte"
						data-testid="checklist-ajouter-point"
						aria-label={t('admin.workflows.checklists.add.aria', { etape: etape.libelle })}
						onClick={() => contexte.onOuvrir({ genre: 'ajout', idEtape: etape.id })}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.workflows.checklists.add')}
					</Button>
				</div>
			)}
		</li>
	)
}

function LignePointEtape({
	point,
	tousPoints,
	contexte,
}: {
	readonly point: PointEtape
	readonly tousPoints: readonly PointEtape[]
	readonly contexte: ContexteChecklistsWorkflow
}) {
	const [enVol, setEnVol] = useState(false)
	// La capacité de l'éditeur, composée avec l'envoi en vol : un `disabled` posé après elle ne doit jamais la rallumer.
	const droit = useRefus(enVol)
	const [refus, setRefus] = useState<NatureRefusChecklistsWorkflow | null>(null)
	const archive = point.archived_at !== null
	const renommageOuvert = contexte.ouverture?.genre === 'renommage' && contexte.ouverture.idPoint === point.id
	const monter = deplacementPoint(tousPoints, point, 'monter')
	const descendre = deplacementPoint(tousPoints, point, 'descendre')

	const geste = async (appel: () => Promise<IssueChecklistsWorkflow>, annonce: string) => {
		setEnVol(true)
		setRefus(null)
		const issue = await appel()
		setEnVol(false)
		if (issue.statut === 'applique') contexte.onEcrit(annonce)
		else setRefus(issue.nature)
	}

	if (renommageOuvert) {
		return (
			<li data-testid="checklist-point-etape" data-point={point.id} className="py-1">
				<FormulaireLibelle
					libelleChamp={t('admin.workflows.checklists.rename.label')}
					libelleEnvoi={t('admin.workflows.checklists.rename.submit')}
					initiale={point.label}
					onEnvoyer={(libelle) => renommerPointEtape(contexte.client, point.id, libelle)}
					onReussi={(libelle) => {
						contexte.onOuvrir(null)
						contexte.onEcrit(t('admin.workflows.checklists.live.renamed', { libelle }))
					}}
					onAnnuler={() => contexte.onOuvrir(null)}
				/>
			</li>
		)
	}

	return (
		<li
			data-testid="checklist-point-etape"
			data-point={point.id}
			data-archive={String(archive)}
			className="flex flex-col border-b border-border py-1 last:border-b-0"
		>
			<div className="flex min-h-[var(--size-target)] flex-wrap items-center gap-2">
				{/* Sous `md`, le libellé prend sa ligne et les commandes passent dessous (§5.70 bis) : resserré à côté d'elles,
				    il se coupait lettre à lettre à 390 px — vu sur la capture. */}
				<span data-testid="checklist-libelle-point" className="min-w-0 basis-full break-words md:basis-0 md:flex-1">
					{point.label}
				</span>
				{archive ? (
					<Badge ton="accent">{t('admin.workflows.checklists.archived')}</Badge>
				) : null}
				<div className="flex flex-wrap gap-1">
					{archive ? null : (
						<>
							<Button
								{...droit}
								variante="discret"
								taille="compacte"
								disabled={droit.disabled === true || monter.statut !== 'calcule'}
								aria-label={t('admin.workflows.checklists.up.aria', { libelle: point.label })}
								title={t('admin.workflows.checklists.up')}
								onClick={() =>
									monter.statut === 'calcule'
										? void geste(
												() => placerPointEtape(contexte.client, point.id, monter.position),
												t('admin.workflows.checklists.live.moved', { libelle: point.label }),
											)
										: undefined
								}
							>
								<ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
							</Button>
							<Button
								{...droit}
								variante="discret"
								taille="compacte"
								disabled={droit.disabled === true || descendre.statut !== 'calcule'}
								aria-label={t('admin.workflows.checklists.down.aria', { libelle: point.label })}
								title={t('admin.workflows.checklists.down')}
								onClick={() =>
									descendre.statut === 'calcule'
										? void geste(
												() => placerPointEtape(contexte.client, point.id, descendre.position),
												t('admin.workflows.checklists.live.moved', { libelle: point.label }),
											)
										: undefined
								}
							>
								<ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
							</Button>
							<Button
								{...droit}
								variante="discret"
								taille="compacte"
								aria-label={t('admin.workflows.checklists.rename.aria', { libelle: point.label })}
								onClick={() => contexte.onOuvrir({ genre: 'renommage', idPoint: point.id })}
							>
								<Pencil aria-hidden="true" size={16} strokeWidth={2} />
								{t('admin.workflows.checklists.rename')}
							</Button>
						</>
					)}
					<Button
						{...droit}
						variante="discret"
						taille="compacte"
						data-testid={archive ? 'checklist-desarchiver' : 'checklist-archiver'}
						aria-label={t(
							archive ? 'admin.workflows.checklists.unarchive.aria' : 'admin.workflows.checklists.archive.aria',
							{ libelle: point.label },
						)}
						onClick={() =>
							void geste(
								() => archiverPointEtape(contexte.client, point.id, !archive),
								t(archive ? 'admin.workflows.checklists.live.unarchived' : 'admin.workflows.checklists.live.archived', {
									libelle: point.label,
								}),
							)
						}
					>
						{archive ? (
							<ArchiveRestore aria-hidden="true" size={16} strokeWidth={2} />
						) : (
							<Archive aria-hidden="true" size={16} strokeWidth={2} />
						)}
						{t(archive ? 'admin.workflows.checklists.unarchive' : 'admin.workflows.checklists.archive')}
					</Button>
				</div>
			</div>
			{refus === null ? null : (
				<p role="alert" data-testid="checklist-refus-point" className={CLASSES_REFUS}>
					{t(MESSAGES_REFUS_CHECKLISTS_WORKFLOW[refus])}
				</p>
			)}
		</li>
	)
}

/** Un champ de libellé et son envoi, dans le flux (§5.13) : le focus y entre, `Échap` referme, un refus garde la saisie. */
function FormulaireLibelle({
	libelleChamp,
	libelleEnvoi,
	initiale,
	onEnvoyer,
	onReussi,
	onAnnuler,
}: {
	readonly libelleChamp: string
	readonly libelleEnvoi: string
	readonly initiale: string
	readonly onEnvoyer: (libelle: string) => Promise<IssueChecklistsWorkflow>
	readonly onReussi: (libelle: string) => void
	readonly onAnnuler: () => void
}) {
	const [libelle, setLibelle] = useState(initiale)
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<NatureRefusChecklistsWorkflow | null>(null)
	const champ = useRef<HTMLInputElement>(null)
	const envoi = useRefus(enVol || libelle.trim() === '')
	const idChamp = useId()
	useEffect(() => champ.current?.focus(), [])

	const envoyer = async (evenement: FormEvent) => {
		evenement.preventDefault()
		if (libelle.trim() === '' || enVol) return
		setEnVol(true)
		setRefus(null)
		const issue = await onEnvoyer(libelle)
		setEnVol(false)
		if (issue.statut === 'applique') onReussi(libelle.trim())
		else setRefus(issue.nature)
	}

	return (
		<form
			onSubmit={(e) => void envoyer(e)}
			onKeyDown={(e) => {
				if (e.key === 'Escape') onAnnuler()
			}}
			data-testid="checklist-formulaire-libelle"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
		>
			<label htmlFor={idChamp} className="text-sm text-text-2">
				{libelleChamp}
			</label>
			<input
				ref={champ}
				id={idChamp}
				type="text"
				value={libelle}
				maxLength={LONGUEUR_MAX_POINT_ETAPE}
				onChange={(e) => setLibelle(e.target.value)}
				className={CLASSES_CONTROLE}
			/>
			{refus === null ? null : (
				<p role="alert" className={CLASSES_REFUS}>
					{t(MESSAGES_REFUS_CHECKLISTS_WORKFLOW[refus])}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button {...envoi} type="submit" variante="primaire">
					{enVol ? t('admin.workflows.checklists.saving') : libelleEnvoi}
				</Button>
				<Button type="button" onClick={onAnnuler}>
					{t('admin.workflows.checklists.cancel')}
				</Button>
			</div>
		</form>
	)
}

// ---------------------------------------------------------------------------------------------
// Les points exigés par une transition — dans le bloc des exigences
// ---------------------------------------------------------------------------------------------

export function ExigencesPointsTransition({
	idTransition,
	idEtapeDepart,
	nomTransition,
	contexte,
}: {
	readonly idTransition: string
	readonly idEtapeDepart: string
	/** « départ vers arrivée », la composition du bloc des exigences (§5.15). */
	readonly nomTransition: string
	readonly contexte: ContexteChecklistsWorkflow
}) {
	const droit = useRefus()
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<NatureRefusChecklistsWorkflow | null>(null)
	const [choix, setChoix] = useState('')
	const idSelect = useId()
	const select = useRef<HTMLSelectElement>(null)
	const commande = useRef<HTMLButtonElement>(null)
	const [rendreFocus, setRendreFocus] = useState(false)
	const ouvert = contexte.ouverture?.genre === 'exigence' && contexte.ouverture.idTransition === idTransition
	useEffect(() => {
		if (ouvert) select.current?.focus()
	}, [ouvert])
	useEffect(() => {
		if (!rendreFocus || ouvert) return
		commande.current?.focus()
		setRendreFocus(false)
	}, [rendreFocus, ouvert])
	const envoi = useRefus(enVol || choix === '')

	if (contexte.checklists.statut !== 'pret') return null
	const exiges = pointsExiges(contexte.checklists.donnees, idTransition, idEtapeDepart)
	const exigeables = pointsExigeables(contexte.checklists.donnees, idTransition, idEtapeDepart)
	const aucunPointDepart = pointsDeLEtape(contexte.checklists.donnees.points, idEtapeDepart).length === 0

	const geste = async (appel: () => Promise<IssueChecklistsWorkflow>, annonce: string): Promise<boolean> => {
		setEnVol(true)
		setRefus(null)
		const issue = await appel()
		setEnVol(false)
		if (issue.statut === 'applique') {
			contexte.onEcrit(annonce)
			return true
		}
		setRefus(issue.nature)
		return false
	}
	const fermer = () => {
		setChoix('')
		setRefus(null)
		contexte.onOuvrir(null)
		setRendreFocus(true)
	}

	return (
		<div data-testid="exigences-points" data-transition={idTransition} className="flex flex-col gap-1">
			<span className="text-sm text-text-2">{t('admin.workflows.checklists.required.title')}</span>
			{exiges.length === 0 ? (
				<span data-testid="exigences-points-aucun" className="text-sm text-text-2">
					{t('admin.workflows.checklists.required.none')}
				</span>
			) : (
				<ul className="flex flex-col gap-1 pl-4">
					{exiges.map((point) => (
						<li key={point.id} data-testid="exigence-point" data-point={point.id} className="flex flex-col">
							<div className="flex min-h-[var(--size-target)] flex-wrap items-center gap-2">
								<span className="min-w-0 basis-full break-words md:basis-0 md:flex-1">{point.label}</span>
								{point.archived_at === null ? null : (
									<Badge ton="accent">{t('admin.workflows.checklists.archived')}</Badge>
								)}
								<Button
									{...droit}
									variante="discret"
									taille="compacte"
									disabled={droit.disabled === true || enVol}
									aria-label={t('admin.workflows.checklists.required.remove.aria', {
										libelle: point.label,
										transition: nomTransition,
									})}
									onClick={() =>
										void geste(
											() => nePlusExigerPoint(contexte.client, idTransition, point.id),
											t('admin.workflows.checklists.live.unrequired', { libelle: point.label }),
										)
									}
								>
									<X aria-hidden="true" size={16} strokeWidth={2} />
									{t('admin.workflows.checklists.required.remove')}
								</Button>
							</div>
							{point.archived_at === null ? null : (
								<span className="text-sm text-text-3">{t('admin.workflows.checklists.required.archived')}</span>
							)}
						</li>
					))}
				</ul>
			)}
			{ouvert ? (
				<form
					onSubmit={(e) => {
						e.preventDefault()
						if (choix === '' || enVol) return
						const point = exigeables.find((p) => p.id === choix)
						void geste(
							() => exigerPoint(contexte.client, idTransition, choix),
							t('admin.workflows.checklists.live.required', { libelle: point?.label ?? '' }),
						).then((ok) => {
							if (ok) fermer()
						})
					}}
					onKeyDown={(e) => {
						if (e.key === 'Escape') fermer()
					}}
					data-testid="exigence-point-formulaire"
					className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
				>
					<label htmlFor={idSelect} className="text-sm text-text-2">
						{t('admin.workflows.checklists.required.select')}
					</label>
					<select
						ref={select}
						id={idSelect}
						value={choix}
						onChange={(e) => setChoix(e.target.value)}
						className={CLASSES_CONTROLE}
					>
						<option value="">{t('admin.workflows.checklists.required.select.empty')}</option>
						{exigeables.map((point) => (
							<option key={point.id} value={point.id}>
								{point.label}
							</option>
						))}
					</select>
					{refus === null ? null : (
						<p role="alert" className={CLASSES_REFUS}>
							{t(MESSAGES_REFUS_CHECKLISTS_WORKFLOW[refus])}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<Button {...envoi} type="submit" variante="primaire">
							{enVol ? t('admin.workflows.checklists.saving') : t('admin.workflows.checklists.required.submit')}
						</Button>
						<Button type="button" onClick={fermer}>
							{t('admin.workflows.checklists.cancel')}
						</Button>
					</div>
				</form>
			) : exigeables.length === 0 ? (
				<span data-testid="exigences-points-indisponible" className="text-sm text-text-2">
					{t(aucunPointDepart ? 'admin.workflows.checklists.required.noPoints' : 'admin.workflows.checklists.required.allRequired')}
				</span>
			) : (
				<div>
					<Button
						{...droit}
						ref={commande}
						variante="discret"
						taille="compacte"
						disabled={droit.disabled === true || enVol}
						data-testid="exiger-point"
						aria-label={t('admin.workflows.checklists.required.add.aria', { transition: nomTransition })}
						onClick={() => contexte.onOuvrir({ genre: 'exigence', idTransition })}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.workflows.checklists.required.add')}
					</Button>
				</div>
			)}
			{!ouvert && refus !== null ? (
				<p role="alert" data-testid="exigence-point-refus" className={CLASSES_REFUS}>
					{t(MESSAGES_REFUS_CHECKLISTS_WORKFLOW[refus])}
				</p>
			) : null}
		</div>
	)
}

/**
 * Les transitions d'un workflow SANS question : le bloc des exigences n'y rend aucune liste de champs, mais une transition
 * peut encore exiger des points. Même composition que la liste des champs exigés — « départ vers arrivée », dans l'ordre
 * du graphe (§5.15).
 */
export function ExigencesPointsSansChamp({
	etapes,
	transitions,
	contexte,
}: {
	readonly etapes: readonly EtapeAdministrable[]
	readonly transitions: readonly TransitionAdministrable[]
	readonly contexte: ContexteChecklistsWorkflow
}) {
	return (
		<ol data-testid="liste-exigences-points" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
			{grouperTransitions(etapes, transitions).flatMap((groupe) =>
				groupe.sorties.map((sortie) => {
					const arrivee = etapes.find((etape) => etape.id === sortie.to_step_id) ?? null
					const nomTransition = t('admin.workflows.transitions.form.edit', {
						depart: libelleEtape(groupe.etape),
						arrivee: arrivee === null ? sortie.to_step_id : libelleEtape(arrivee),
					})
					return (
						<li key={sortie.id} data-testid="transition-exigences" data-transition={sortie.id} className="flex flex-col gap-2">
							<span className="font-medium">{nomTransition}</span>
							<ExigencesPointsTransition
								idTransition={sortie.id}
								idEtapeDepart={groupe.etape.id}
								nomTransition={nomTransition}
								contexte={contexte}
							/>
						</li>
					)
				}),
			)}
		</ol>
	)
}
