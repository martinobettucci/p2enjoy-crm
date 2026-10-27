// @spec CRM-068 (docs/BACKLOG.md) — tranche T4b1 : Réglages ▸ Modèles d'affaires — lire, poser, modifier, archiver
// @spec docs/SPEC-checklists.md §3.5 (écriture administrateur, lecture membre ; nom unique parmi les non archivés), §4 ;
//       docs/DESIGN_SYSTEM.md §5.71 (l'écran), §5.39 (la forme de l'écran des modèles d'emails, reprise sans être
//       répétée), §5.59 (la capacité d'administrer l'espace), §5.8 (états), §5.41 (archivage sans confirmation)
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : refusée par la base, la capacité d'administrer ferme l'écran ; la
//       RLS de `card_templates` reste seule juge de chaque écriture, et son refus est traduit sous les champs
//
// LES RÉPONSES AUX QUESTIONS D'UN MODÈLE NE SE SAISISSENT PAS ICI (T4b2) : la fiche dit leur nombre et la façon de les
// reprendre, et une modification les laisse telles quelles — la colonne n'est pas envoyée.

import { Plus, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { NatureErreur } from '../lib/async'
import { lireWorkflowsAdministrables, type WorkflowAdministrable } from '../lib/administration-workflows'
import {
	archiverModele,
	lireModeles,
	lireMontant,
	modifierModele,
	poserModele,
	type ModeleAffaire,
	type NatureRefusModele,
	type SaisieModele,
} from '../lib/modeles-affaires'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useContexteEspace } from './ContexteEspace'

const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-base text-text'
const CLASSES_LIBELLE = 'text-sm text-text-2'

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly workflows: readonly WorkflowAdministrable[]; readonly modeles: readonly ModeleAffaire[] }

/** Ce que la fiche édite : un modèle nouveau, ou un modèle existant. */
type Ouverture = { readonly type: 'creation' } | { readonly type: 'modification'; readonly modele: ModeleAffaire } | null

const CLES_REFUS: Readonly<Record<NatureRefusModele | 'montant', CleTraduction>> = {
	'nom-pris': 'admin.cardTemplates.refus.nom',
	forme: 'admin.cardTemplates.refus.forme',
	point: 'admin.cardTemplates.refus.point',
	reponse: 'admin.cardTemplates.refus.reponse',
	forbidden: 'admin.cardTemplates.refus.forbidden',
	'sans-effet': 'admin.cardTemplates.refus.sansEffet',
	network: 'admin.cardTemplates.refus.panne',
	unknown: 'admin.cardTemplates.refus.panne',
	montant: 'admin.cardTemplates.refus.montant',
}

export type ProprietesReglagesModelesAffaires = { readonly client?: ClientCrm | null }

export function ReglagesModelesAffaires({ client = clientCrm }: ProprietesReglagesModelesAffaires = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const administration = capacites.administration
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [archives, setArchives] = useState(false)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [enCours, setEnCours] = useState<string | null>(null)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	// Le focus revient à la commande qui a ouvert la fiche (§5.13) : « Nouveau modèle », ou « Modifier » de sa ligne.
	const retourFocus = useRef<string | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null || administration === 'en-lecture' || administration === 'refusee') return
		const r = ++rang.current
		void (async () => {
			const [workflows, modeles] = await Promise.all([
				lireWorkflowsAdministrables(client, true),
				lireModeles(client, { archives: true }),
			])
			if (r !== rang.current) return
			if (workflows.statut === 'erreur') return setLecture({ statut: 'erreur', nature: workflows.erreur.nature })
			if (modeles.statut === 'erreur') return setLecture({ statut: 'erreur', nature: modeles.erreur.nature })
			if (workflows.statut !== 'pret' || modeles.statut !== 'pret') return
			setLecture({ statut: 'pret', workflows: workflows.donnees, modeles: modeles.donnees })
		})()
	}, [client, idWorkspace, administration, tentative])

	useEffect(() => {
		if (ouverture !== null || retourFocus.current === null) return
		document.querySelector<HTMLElement>(`[data-retour-focus="${retourFocus.current}"]`)?.focus()
		retourFocus.current = null
	}, [ouverture, lecture])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.cardTemplates.noworkspace')} />
	}
	if (administration === 'refusee' || (lecture.statut === 'erreur' && lecture.nature === 'forbidden')) {
		return <EtatRefus titre={t('admin.cardTemplates.forbidden.title')} corps={t('admin.cardTemplates.forbidden.body')} />
	}

	const fermer = () => setOuverture(null)
	const relire = () => setTentative((n) => n + 1)

	const ouvrirCreation = () => {
		retourFocus.current = 'nouveau'
		setOuverture({ type: 'creation' })
	}

	const archiver = async (modele: ModeleAffaire) => {
		setEnCours(modele.id)
		const issue = await archiverModele(client, modele.id, !modele.archive)
		setEnCours(null)
		if (issue.statut === 'applique') {
			setAnnonce(t(modele.archive ? 'admin.cardTemplates.unarchived' : 'admin.cardTemplates.archived.done', { nom: modele.nom }))
			relire()
			return
		}
		// Désarchiver un modèle dont le nom a été repris entre-temps : la base refuse (`23505`), et l'écran le dit.
		setAnnonce(t(CLES_REFUS[issue.nature]))
	}

	const workflowsAvecModeles =
		lecture.statut === 'pret'
			? lecture.workflows
					.map((workflow) => ({
						workflow,
						modeles: lecture.modeles.filter((m) => m.idWorkflow === workflow.id && (archives || !m.archive)),
					}))
					.filter((section) => section.modeles.length > 0)
			: []

	const commandeNouveau =
		ouverture?.type === 'creation' ? null : (
			<Button variante="primaire" data-retour-focus="nouveau" data-testid="nouveau-modele-affaire" onClick={ouvrirCreation}>
				<Plus aria-hidden="true" size={16} strokeWidth={2} />
				{t('admin.cardTemplates.new')}
			</Button>
		)

	return (
		<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-modeles-affaires">
			<h2 className="text-h3">{t('admin.cardTemplates.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('admin.cardTemplates.intro')}</p>
			<div className="flex flex-wrap items-center gap-3">
				{commandeNouveau}
				<label className="inline-flex items-center gap-2 min-h-[var(--size-target)] text-sm">
					<input
						type="checkbox"
						data-testid="modeles-affaires-archives"
						checked={archives}
						onChange={(evenement) => setArchives(evenement.target.checked)}
					/>
					{t('admin.cardTemplates.showArchived')}
				</label>
			</div>
			<p role="status" className="sr-only" data-testid="annonce-modeles-affaires">
				{annonce}
			</p>

			{ouverture?.type === 'creation' && lecture.statut === 'pret' ? (
				<FicheModele
					client={client}
					idWorkspace={idWorkspace}
					workflows={lecture.workflows.filter((w) => w.archived_at === null)}
					modele={null}
					onFermer={fermer}
					onEnregistre={(nom) => {
						setAnnonce(t('admin.cardTemplates.saved', { nom }))
						fermer()
						relire()
					}}
				/>
			) : null}

			{lecture.statut === 'chargement' || administration === 'en-lecture' ? (
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.cardTemplates.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			) : workflowsAvecModeles.length === 0 ? (
				ouverture?.type === 'creation' ? null : (
					<EtatVide titre={t('admin.cardTemplates.empty.title')} corps={t('admin.cardTemplates.empty.body')} />
				)
			) : (
				workflowsAvecModeles.map(({ workflow, modeles }) => (
					<section key={workflow.id} className="flex flex-col gap-2" data-testid="modeles-workflow" data-workflow={workflow.id}>
						<h2 className="text-h3">{workflow.name}</h2>
						<ul className="flex flex-col rounded-lg border border-border bg-surface">
							{modeles.map((modele) =>
								ouverture?.type === 'modification' && ouverture.modele.id === modele.id ? (
									<li key={modele.id} className="p-3 border-b border-border last:border-b-0">
										<FicheModele
											client={client}
											idWorkspace={idWorkspace}
											workflows={lecture.workflows}
											modele={modele}
											onFermer={fermer}
											onEnregistre={(nom) => {
												setAnnonce(t('admin.cardTemplates.saved', { nom }))
												fermer()
												relire()
											}}
										/>
									</li>
								) : (
									<LigneModele
										key={modele.id}
										modele={modele}
										enCours={enCours === modele.id}
										onModifier={() => {
											retourFocus.current = `modifier-${modele.id}`
											setOuverture({ type: 'modification', modele })
										}}
										onArchiver={() => void archiver(modele)}
									/>
								),
							)}
						</ul>
					</section>
				))
			)}
		</div>
	)
}

function LigneModele({
	modele,
	enCours,
	onModifier,
	onArchiver,
}: {
	readonly modele: ModeleAffaire
	readonly enCours: boolean
	readonly onModifier: () => void
	readonly onArchiver: () => void
}) {
	return (
		<li
			data-testid="ligne-modele-affaire"
			data-modele={modele.id}
			data-archive={String(modele.archive)}
			className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-border last:border-b-0"
		>
			<div className="flex min-w-0 basis-full flex-col md:basis-0 md:flex-1">
				<span className="flex flex-wrap items-center gap-2">
					<span className="font-medium break-words">{modele.nom}</span>
					{modele.archive ? <Badge ton="accent">{t('admin.cardTemplates.archived')}</Badge> : null}
				</span>
				<span className="flex flex-wrap items-baseline gap-x-3 text-sm text-text-2">
					{modele.titre === null ? null : <span className="break-words">{modele.titre}</span>}
					{modele.montant === null ? null : (
						<span className="inline-flex items-baseline gap-1">
							<code>{modele.montant.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</code>
							<span>{modele.devise}</span>
						</span>
					)}
					{modele.points.length === 0 ? null : (
						<span>{t(modele.points.length === 1 ? 'admin.cardTemplates.points.one' : 'admin.cardTemplates.points.many', { n: String(modele.points.length) })}</span>
					)}
				</span>
			</div>
			<div className="flex flex-wrap gap-1">
				{modele.archive ? null : (
					<Button
						variante="discret"
						taille="compacte"
						data-retour-focus={`modifier-${modele.id}`}
						aria-label={t('admin.cardTemplates.edit.aria', { nom: modele.nom })}
						onClick={onModifier}
					>
						{t('admin.cardTemplates.edit')}
					</Button>
				)}
				<Button
					variante="discret"
					taille="compacte"
					disabled={enCours}
					aria-label={t(modele.archive ? 'admin.cardTemplates.unarchive.aria' : 'admin.cardTemplates.archive.aria', { nom: modele.nom })}
					onClick={onArchiver}
				>
					{t(modele.archive ? 'admin.cardTemplates.unarchive' : 'admin.cardTemplates.archive')}
				</Button>
			</div>
		</li>
	)
}

/** La fiche d'un modèle, dans le flux (§5.39, §5.71) : un modèle nouveau en tête de liste, un modèle existant à sa place. */
function FicheModele({
	client,
	idWorkspace,
	workflows,
	modele,
	onFermer,
	onEnregistre,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly workflows: readonly WorkflowAdministrable[]
	readonly modele: ModeleAffaire | null
	readonly onFermer: () => void
	readonly onEnregistre: (nom: string) => void
}) {
	const id = useId()
	const [idWorkflow, setIdWorkflow] = useState(modele?.idWorkflow ?? workflows[0]?.id ?? '')
	const [saisie, setSaisie] = useState<SaisieModele>({
		nom: modele?.nom ?? '',
		titre: modele?.titre ?? '',
		description: modele?.description ?? '',
		montant: modele?.montant === null || modele === null ? '' : String(modele.montant).replace('.', ','),
		devise: modele?.devise ?? 'EUR',
		points: modele?.points ?? [],
	})
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusModele | 'montant' | null>(null)
	const premier = useRef<HTMLSelectElement | HTMLInputElement | null>(null)
	const nomRef = useRef<HTMLInputElement | null>(null)
	const montantRef = useRef<HTMLInputElement | null>(null)
	const pointAjoute = useRef(false)
	const listePoints = useRef<HTMLUListElement | null>(null)

	useEffect(() => {
		premier.current?.focus()
	}, [])

	// Un point ajouté prend le focus : « Ajouter un point » puis la saisie, sans chercher le champ (§5.15).
	useEffect(() => {
		if (!pointAjoute.current) return
		pointAjoute.current = false
		const champs = listePoints.current?.querySelectorAll('input')
		champs?.[champs.length - 1]?.focus()
	}, [saisie.points.length])

	const changer = (partiel: Partial<SaisieModele>) => setSaisie((precedente) => ({ ...precedente, ...partiel }))
	const blanc = saisie.nom.trim() === '' || (modele === null && idWorkflow === '')
	const nomWorkflow = workflows.find((w) => w.id === (modele?.idWorkflow ?? idWorkflow))?.name ?? ''

	const envoyer = async () => {
		if (blanc || enCours) return
		const montant = lireMontant(saisie.montant)
		if (!montant.ok) {
			setRefus('montant')
			return montantRef.current?.focus()
		}
		setRefus(null)
		setEnCours(true)
		const issue =
			modele === null
				? await poserModele(client, { idWorkspace, idWorkflow }, saisie, montant.valeur)
				: await modifierModele(client, modele.id, saisie, montant.valeur)
		setEnCours(false)
		if (issue.statut === 'applique') return onEnregistre(saisie.nom.trim())
		setRefus(issue.nature)
		// LA SAISIE EST GARDÉE, ET LE FOCUS REVIENT AU NOM (§5.7 ter) : « Enregistrer », éteint pendant l'envoi, l'a perdu, et
		// `Échap` tombé sur le document n'aurait plus refermé la fiche — trouvé par la preuve E2E.
		nomRef.current?.focus()
	}

	return (
		<form
			data-testid="fiche-modele-affaire"
			aria-label={t(modele === null ? 'admin.cardTemplates.form.new' : 'admin.cardTemplates.form.edit')}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				void envoyer()
			}}
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape' || enCours) return
				evenement.preventDefault()
				evenement.stopPropagation()
				onFermer()
			}}
		>
			{modele === null ? (
				<div className="flex flex-col gap-1 max-w-[72ch]">
					<label htmlFor={`${id}-workflow`} className={CLASSES_LIBELLE}>
						{t('admin.cardTemplates.field.workflow')}
					</label>
					<select
						id={`${id}-workflow`}
						ref={(noeud) => {
							premier.current = noeud
						}}
						data-testid="modele-workflow"
						value={idWorkflow}
						onChange={(evenement) => setIdWorkflow(evenement.target.value)}
						className={CLASSES_CHAMP}
					>
						{workflows.map((w) => (
							<option key={w.id} value={w.id}>
								{w.name}
							</option>
						))}
					</select>
				</div>
			) : (
				// LE WORKFLOW D'UN MODÈLE EXISTANT SE LIT EN PHRASE (§5.15) : ses réponses répondent aux questions de ce workflow.
				<p className="text-sm text-text-2" data-testid="modele-workflow-phrase">
					{t('admin.cardTemplates.field.workflow.fixed', { workflow: nomWorkflow })}
				</p>
			)}
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={`${id}-nom`} className={CLASSES_LIBELLE}>
					{t('admin.cardTemplates.field.name')}
				</label>
				<input
					id={`${id}-nom`}
					ref={(noeud) => {
						nomRef.current = noeud
						if (modele !== null) premier.current = noeud
					}}
					data-testid="modele-nom"
					type="text"
					autoComplete="off"
					maxLength={120}
					value={saisie.nom}
					onChange={(evenement) => changer({ nom: evenement.target.value })}
					className={CLASSES_CHAMP}
				/>
			</div>
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={`${id}-titre`} className={CLASSES_LIBELLE}>
					{t('admin.cardTemplates.field.title')}
				</label>
				<input
					id={`${id}-titre`}
					data-testid="modele-titre"
					type="text"
					autoComplete="off"
					value={saisie.titre}
					onChange={(evenement) => changer({ titre: evenement.target.value })}
					className={CLASSES_CHAMP}
				/>
			</div>
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={`${id}-description`} className={CLASSES_LIBELLE}>
					{t('admin.cardTemplates.field.description')}
				</label>
				<textarea
					id={`${id}-description`}
					data-testid="modele-description"
					rows={3}
					value={saisie.description}
					onChange={(evenement) => changer({ description: evenement.target.value })}
					className={`${CLASSES_CHAMP} py-2`}
				/>
			</div>
			{/* Deux contrôles, le montant et sa devise (§5.3 ter). */}
			<div className="flex flex-wrap items-end gap-2">
				<div className="flex flex-col gap-1">
					<label htmlFor={`${id}-montant`} className={CLASSES_LIBELLE}>
						{t('admin.cardTemplates.field.amount')}
					</label>
					<input
						id={`${id}-montant`}
						ref={montantRef}
						data-testid="modele-montant"
						type="text"
						inputMode="decimal"
						autoComplete="off"
						value={saisie.montant}
						onChange={(evenement) => changer({ montant: evenement.target.value })}
						className={`${CLASSES_CHAMP} w-[16ch]`}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor={`${id}-devise`} className={CLASSES_LIBELLE}>
						{t('admin.cardTemplates.field.currency')}
					</label>
					<input
						id={`${id}-devise`}
						data-testid="modele-devise"
						type="text"
						autoComplete="off"
						maxLength={3}
						value={saisie.devise}
						onChange={(evenement) => changer({ devise: evenement.target.value.toUpperCase() })}
						className={`${CLASSES_CHAMP} w-[8ch]`}
					/>
				</div>
			</div>
			<fieldset className="flex flex-col gap-2 max-w-[72ch]">
				<legend className={`${CLASSES_LIBELLE} mb-1`}>{t('admin.cardTemplates.field.points')}</legend>
				{saisie.points.length === 0 ? null : (
					<ul ref={listePoints} className="flex flex-col gap-2" data-testid="modele-points">
						{saisie.points.map((point, rangPoint) => (
							<li key={rangPoint} className="flex items-center gap-2">
								<input
									type="text"
									autoComplete="off"
									maxLength={200}
									aria-label={t('admin.cardTemplates.point.aria', { n: String(rangPoint + 1) })}
									value={point}
									onChange={(evenement) =>
										changer({ points: saisie.points.map((p, i) => (i === rangPoint ? evenement.target.value : p)) })
									}
									className={`${CLASSES_CHAMP} min-w-0 flex-1`}
								/>
								<Button
									variante="discret"
									taille="compacte"
									aria-label={t('admin.cardTemplates.point.remove.aria', { n: String(rangPoint + 1) })}
									onClick={() => changer({ points: saisie.points.filter((_, i) => i !== rangPoint) })}
								>
									<X aria-hidden="true" size={16} strokeWidth={2} />
									{t('admin.cardTemplates.point.remove')}
								</Button>
							</li>
						))}
					</ul>
				)}
				<Button
					variante="secondaire"
					taille="compacte"
					className="self-start"
					data-testid="modele-ajouter-point"
					onClick={() => {
						pointAjoute.current = true
						changer({ points: [...saisie.points, ''] })
					}}
				>
					<Plus aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.cardTemplates.point.add')}
				</Button>
			</fieldset>
			<p className="text-sm text-text-2 max-w-[72ch]" data-testid="modele-reponses">
				{t('admin.cardTemplates.answers.hint')}
				{modele === null || modele.nombreReponses === 0
					? null
					: ` ${t(modele.nombreReponses === 1 ? 'admin.cardTemplates.answers.one' : 'admin.cardTemplates.answers.many', { n: String(modele.nombreReponses) })}`}
			</p>
			{refus === null ? null : (
				<p
					role="alert"
					data-testid="refus-modele-affaire"
					data-refus={refus}
					className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<span>{t(CLES_REFUS[refus])}</span>
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button variante="primaire" type="submit" disabled={blanc || enCours} data-testid="modele-enregistrer">
					{t(enCours ? 'admin.cardTemplates.pending' : 'admin.cardTemplates.save')}
				</Button>
				<Button variante="secondaire" disabled={enCours} data-testid="modele-annuler" onClick={onFermer}>
					{t('admin.cardTemplates.cancel')}
				</Button>
			</div>
		</form>
	)
}
