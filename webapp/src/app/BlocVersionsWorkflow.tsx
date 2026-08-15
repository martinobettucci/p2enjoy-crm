// @spec CRM-078 (docs/BACKLOG.md) — cinquième tranche : les écrans du versionnement
// @spec docs/SPEC-workflow-engine.md §7 ter.14.1 (ce que le bloc est et n'est pas),
//       §7 ter.14.2 (sixième bloc de l'éditeur, aucune route nouvelle), §7 ter.14.3 (lecture 8),
//       §7 ter.14.4 (les quatre gestes), §7 ter.14.5 (les instructions portent sur les étapes
//       retirées, et la commande n'est jamais éteinte), §7 ter.14.6 (nommer sans inventer),
//       §7 ter.14.7 (dictionnaire fermé des refus), §7 ter.14.8 (états et écarts nommés)
// @spec docs/DESIGN_SYSTEM.md §5.15 (bloc des versions : tableau du §5.9, aucune commande de
//       ligne, empreinte tronquée, collections nommées, confirmation dans le flux),
//       §5.8 (états), §5.9 (tableau de données), §6 (confirmation), §8 (accessibilité),
//       §9 (icônes Lucide), §10 (aucun texte en dur), §12.6 (débordement signalé)
//
// AUCUN DROIT N'EST CALCULÉ ICI, et aucune commande n'est éteinte d'avance — la règle de
// `CRM-075`, reprise mot pour mot. En particulier, « Restaurer » reste offerte lorsque le plan
// n'est pas applicable : la garde est la vérification 7 du §7 ter.13.6, et un bouton grisé ferait
// passer une règle de base pour une décision d'interface (`CLAUDE.md` §10).

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { History, Minus, Pencil, Plus, RotateCcw } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	choixParDefaut,
	comparerVersions,
	composerInstructions,
	etapesDeLaVersion,
	lireVersions,
	planifierRemappage,
	publierVersion,
	restaurerVersion,
	COLLECTIONS,
	type CleCollection,
	type Comparaison,
	type AffairePlan,
	type ElementCompare,
	type NomElement,
	type PlanRemappage,
	type RefusVersion,
	type Restauration,
	type VersionWorkflow,
} from '../lib/versions-workflow'
import type { ClientCrm } from '../lib/supabase'

// ---------------------------------------------------------------------------------------------
// Textes fermés
// ---------------------------------------------------------------------------------------------

/** Un texte par refus attendu (§7 ter.14.7). Le repli générique en fait partie, il n'est pas un vide. */
const CLES_REFUS: Readonly<Record<RefusVersion, CleTraduction>> = {
	'composition-inchangee': 'admin.workflows.versions.refus.composition-inchangee',
	'workflow-archive': 'admin.workflows.versions.refus.workflow-archive',
	introuvable: 'admin.workflows.versions.refus.introuvable',
	administrateurs: 'admin.workflows.versions.refus.administrateurs',
	'workflows-differents': 'admin.workflows.versions.refus.workflows-differents',
	'plan-non-applicable': 'admin.workflows.versions.refus.plan-non-applicable',
	'structure-modifiee': 'admin.workflows.versions.refus.structure-modifiee',
	'remappage-refuse': 'admin.workflows.versions.refus.remappage-refuse',
	'limite-invalide': 'admin.workflows.versions.refus.limite-invalide',
	generique: 'admin.workflows.versions.refus.generique',
}

const CLES_COLLECTION: Readonly<Record<CleCollection, CleTraduction>> = {
	workflow: 'admin.workflows.versions.collection.workflow',
	steps: 'admin.workflows.versions.collection.steps',
	transitions: 'admin.workflows.versions.collection.transitions',
	fields: 'admin.workflows.versions.collection.fields',
	rules: 'admin.workflows.versions.collection.rules',
	required_fields: 'admin.workflows.versions.collection.required_fields',
}

const CLES_GENRE: Readonly<Record<ElementCompare['genre'], CleTraduction>> = {
	ajout: 'admin.workflows.versions.change.ajout',
	retrait: 'admin.workflows.versions.change.retrait',
	modification: 'admin.workflows.versions.change.modification',
}

const CLES_ETAT: Readonly<Record<AffairePlan['state'], CleTraduction>> = {
	active: 'admin.workflows.versions.plan.state.active',
	archived: 'admin.workflows.versions.plan.state.archived',
	deleted: 'admin.workflows.versions.plan.state.deleted',
}

const CLES_RESOLUTION: Readonly<Record<AffairePlan['resolution'], CleTraduction>> = {
	unchanged: 'admin.workflows.versions.plan.resolution.unchanged',
	remapped: 'admin.workflows.versions.plan.resolution.remapped',
	unresolved: 'admin.workflows.versions.plan.resolution.unresolved',
}

/**
 * Date et heure au format court du produit — celui de la corbeille et de l'état de la messagerie.
 *
 * Deux dates du même produit ne se lisent pas dans deux formats (`docs/DESIGN_SYSTEM.md` §5.16).
 * Un horodatage illisible est rendu tel quel plutôt que remplacé par un vide trompeur.
 */
function formaterPublication(horodatage: string): string {
	const date = new Date(horodatage)
	if (Number.isNaN(date.getTime())) return horodatage
	return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

/** L'empreinte, tronquée à douze caractères, la valeur entière portée par `title` (§5.15). */
const empreinteCourte = (empreinte: string): string => empreinte.slice(0, 12)

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'

// ---------------------------------------------------------------------------------------------
// Pièces de rendu
// ---------------------------------------------------------------------------------------------

/** Le refus reçu, dans le bloc qui l'a causé (§5.13, §5.16 du design system). */
function AlerteRefus({ message, marqueur }: { readonly message: string; readonly marqueur: string }) {
	return (
		<p
			role="alert"
			data-testid={marqueur}
			className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
		>
			{message}
		</p>
	)
}

/** Le nom d'un élément comparé, dans les trois formes que le module peut rendre (§7 ter.14.6). */
function NomCompare({ nom }: { readonly nom: NomElement }) {
	if (nom.genre === 'libelle') return <span className="font-medium">{nom.texte}</span>
	if (nom.genre === 'renomme') {
		return (
			<span className="font-medium">
				{t('admin.workflows.versions.renamed', { avant: nom.avant, apres: nom.apres })}
			</span>
		)
	}
	// Dernier repli : les identifiants, en `code`. Mieux vaut un identifiant qu'une phrase à trou.
	return (
		<span className="flex flex-wrap gap-1">
			{nom.valeurs.map((valeur) => (
				<code key={valeur} className="rounded-sm bg-hover px-1 text-sm">
					{valeur}
				</code>
			))}
		</span>
	)
}

const ICONES_GENRE = { ajout: Plus, retrait: Minus, modification: Pencil } as const
const TONS_GENRE = {
	ajout: 'bg-success-soft text-success-on-soft',
	retrait: 'bg-danger-soft text-danger-on-soft',
	modification: 'bg-hover text-text-2',
} as const

function LigneElement({ element }: { readonly element: ElementCompare }) {
	const Icone = ICONES_GENRE[element.genre]
	return (
		<li className="flex flex-col gap-1 py-1">
			<span className="flex flex-wrap items-center gap-2">
				<span
					className={[
						'inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium',
						TONS_GENRE[element.genre],
					].join(' ')}
				>
					<Icone aria-hidden="true" size={14} strokeWidth={2} />
					{t(CLES_GENRE[element.genre])}
				</span>
				<NomCompare nom={element.nom} />
			</span>
			{element.attributs.length > 0 ? (
				<ul className="flex flex-col gap-1 pl-4 text-sm text-text-2">
					{element.attributs.map((attribut) => (
						<li key={attribut.nom}>
							{t('admin.workflows.versions.attribute', {
								attribut: attribut.nom,
								avant: attribut.avant ?? t('admin.workflows.versions.value.none'),
								apres: attribut.apres ?? t('admin.workflows.versions.value.none'),
							})}
						</li>
					))}
				</ul>
			) : null}
		</li>
	)
}

/**
 * Les six collections d'une comparaison.
 *
 * Une collection vide est NOMMÉE (`docs/DESIGN_SYSTEM.md` §5.15) : une liste vide se lirait comme
 * un défaut de chargement. Lorsque les deux versions sont identiques, l'appelant n'affiche pas ce
 * bloc du tout — il n'y a rien à parcourir.
 */
function Collections({ comparaison }: { readonly comparaison: Comparaison }) {
	return (
		<ul data-testid="comparaison-collections" className="flex flex-col gap-3">
			{COLLECTIONS.map((cle) => {
				const collection = comparaison.collections.find((entree) => entree.cle === cle)
				const elements = collection?.elements ?? []
				return (
					<li key={cle} className="flex flex-col gap-1">
						<h5 className="font-medium">{t(CLES_COLLECTION[cle])}</h5>
						{elements.length === 0 ? (
							<p className="text-sm text-text-2">{t('admin.workflows.versions.compare.empty')}</p>
						) : (
							<ul className="flex flex-col">
								{elements.map((element) => (
									<LigneElement key={element.cle} element={element} />
								))}
							</ul>
						)}
					</li>
				)
			})}
		</ul>
	)
}

// ---------------------------------------------------------------------------------------------
// Le bloc
// ---------------------------------------------------------------------------------------------

export type ProprietesBlocVersions = {
	readonly client: ClientCrm | null
	readonly idWorkflow: string
	readonly nomWorkflow: string
	/**
	 * Libellés de la structure VIVANTE, par identifiant — troisième repli du nommage (§7 ter.14.6).
	 * L'éditeur les a déjà chargés ; les relire ici serait une requête pour rien.
	 */
	readonly structure: ReadonlyMap<string, string>
	/** Appelé après une restauration : elle réécrit étapes, arêtes, champs et règles. */
	readonly onStructureRestauree: () => void
	/** Annonce polie, portée par la région `aria-live` déjà posée par l'éditeur. */
	readonly onAnnonce: (texte: string) => void
}

type Bloc = 'publication' | 'comparaison' | 'plan' | 'restauration'

export function BlocVersionsWorkflow({
	client,
	idWorkflow,
	nomWorkflow,
	structure,
	onStructureRestauree,
	onAnnonce,
}: ProprietesBlocVersions) {
	const [versions, setVersions] = useState<EtatAsync<readonly VersionWorkflow[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [note, setNote] = useState('')
	const [idBase, setIdBase] = useState<string | null>(null)
	const [idCible, setIdCible] = useState<string | null>(null)
	const [comparaison, setComparaison] = useState<Comparaison | null>(null)
	const [idPlan, setIdPlan] = useState<string | null>(null)
	const [plan, setPlan] = useState<PlanRemappage | null>(null)
	const [choix, setChoix] = useState<ReadonlyMap<string, string>>(new Map())
	const [confirmation, setConfirmation] = useState(false)
	const [restauration, setRestauration] = useState<Restauration | null>(null)
	const [refus, setRefus] = useState<{ readonly bloc: Bloc; readonly texte: string } | null>(null)
	const [enCours, setEnCours] = useState<Bloc | null>(null)

	const idNote = useId()
	const idChoixBase = useId()
	const idChoixCible = useId()
	const idChoixPlan = useId()

	// Une réponse arrivée après le démontage, ou périmée par un changement de workflow, ne doit pas
	// écraser un état plus récent — la garde de l'éditeur, reprise sans changement.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setVersions(enChargement)
		setComparaison(null)
		setPlan(null)
		setChoix(new Map())
		setRestauration(null)
		setRefus(null)
		setNote('')
		void (async () => {
			const lues = await lireVersions(client, idWorkflow)
			if (rang !== courant.current) return
			setVersions(lues)
			if (lues.statut !== 'pret') return
			const defauts = choixParDefaut(lues.donnees)
			setIdBase(defauts.base)
			setIdCible(defauts.cible)
			setIdPlan(defauts.cible)
		})()
	}, [client, idWorkflow, tentative])

	const liste = versions.statut === 'pret' ? versions.donnees : []
	const versionDuPlan = liste.find((version) => version.id === idPlan) ?? null
	const etapesCibles = etapesDeLaVersion(versionDuPlan)

	/** Recharge la lecture 8 sans réinitialiser ce que l'écran affiche déjà. */
	const rechargerVersions = useCallback(async () => {
		if (client === null) return
		const rang = ++courant.current
		const lues = await lireVersions(client, idWorkflow)
		if (rang !== courant.current) return
		setVersions(lues)
	}, [client, idWorkflow])

	const publier = useCallback(async () => {
		if (client === null) return
		setEnCours('publication')
		setRefus(null)
		try {
			const issue = await publierVersion(client, idWorkflow, note)
			if (issue.statut === 'refus') {
				setRefus({ bloc: 'publication', texte: t(CLES_REFUS[issue.refus]) })
				return
			}
			setNote('')
			onAnnonce(t('live.workflows.version.published'))
			await rechargerVersions()
		} finally {
			setEnCours(null)
		}
	}, [client, idWorkflow, note, onAnnonce, rechargerVersions])

	const comparer = useCallback(async () => {
		if (client === null || idBase === null || idCible === null) return
		setEnCours('comparaison')
		setRefus(null)
		try {
			const issue = await comparerVersions(client, idBase, idCible, structure)
			if (issue.statut === 'refus') {
				setComparaison(null)
				setRefus({ bloc: 'comparaison', texte: t(CLES_REFUS[issue.refus]) })
				return
			}
			setComparaison(issue.donnees)
			onAnnonce(t('live.workflows.version.compared'))
		} finally {
			setEnCours(null)
		}
	}, [client, idBase, idCible, onAnnonce, structure])

	/**
	 * Demande le plan avec les instructions courantes.
	 *
	 * REPLANIFIER PLUTÔT QUE RECALCULER LE VERDICT À L'ÉCRAN (§7 ter.14.5) : `ready` n'a qu'une
	 * formulation, celle de la base, et une seconde finirait par diverger.
	 */
	const planifier = useCallback(
		async (instructions: ReadonlyMap<string, string>) => {
			if (client === null || idPlan === null) return
			setEnCours('plan')
			setRefus(null)
			try {
				const issue = await planifierRemappage(client, idPlan, composerInstructions(instructions))
				if (issue.statut === 'refus') {
					setPlan(null)
					setRefus({ bloc: 'plan', texte: t(CLES_REFUS[issue.refus]) })
					return
				}
				setPlan(issue.donnees)
				onAnnonce(t('live.workflows.version.planned'))
			} finally {
				setEnCours(null)
			}
		},
		[client, idPlan, onAnnonce],
	)

	const restaurer = useCallback(async () => {
		if (client === null || idPlan === null) return
		setEnCours('restauration')
		setRefus(null)
		try {
			const issue = await restaurerVersion(client, idPlan, composerInstructions(choix))
			if (issue.statut === 'refus') {
				setRefus({ bloc: 'restauration', texte: t(CLES_REFUS[issue.refus]) })
				return
			}
			setConfirmation(false)
			setRestauration(issue.donnees)
			// Le plan décrit un monde qui n'existe plus ; le résultat, lui, RESTE affiché
			// (`docs/DESIGN_SYSTEM.md` §5.15) : il est la seule trace visible du geste.
			setPlan(null)
			setChoix(new Map())
			onAnnonce(t('live.workflows.version.restored'))
			await rechargerVersions()
			onStructureRestauree()
		} finally {
			setEnCours(null)
		}
	}, [choix, client, idPlan, onAnnonce, onStructureRestauree, rechargerVersions])

	return (
		<section
			aria-label={t('admin.workflows.versions.aria', { workflow: nomWorkflow })}
			className="flex flex-col gap-3"
		>
			<div className="flex flex-col gap-1">
				<h3 className="flex items-center gap-2 font-medium">
					<History aria-hidden="true" size={16} strokeWidth={2} />
					{t('admin.workflows.versions.title')}
				</h3>
				<p className="text-sm text-text-2">{t('admin.workflows.versions.intro')}</p>
			</div>

			{versions.statut === 'chargement' ? (
				<SkeletonListe lignes={2} libelle={t('admin.workflows.versions.loading')} />
			) : null}
			{versions.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.workflows.versions.error')}
					corps={t('admin.workflows.error.body')}
					libelleReprise={t('admin.tree.error.retry')}
					onReprise={() => setTentative((precedente) => precedente + 1)}
				/>
			) : null}

			{versions.statut === 'pret' && liste.length === 0 ? (
				<p data-testid="versions-vide" className="text-sm text-text-2">
					{t('admin.workflows.versions.empty')}
				</p>
			) : null}

			{versions.statut === 'pret' && liste.length > 0 ? (
				<div className="overflow-x-auto indique-debordement-x">
					<table data-testid="tableau-versions" className="w-full border-collapse text-left">
						<caption className="sr-only">
							{t('admin.workflows.versions.aria', { workflow: nomWorkflow })}
						</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('admin.workflows.versions.column.number')}
								</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('admin.workflows.versions.column.published')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('admin.workflows.versions.column.author')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('admin.workflows.versions.column.note')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('admin.workflows.versions.column.fingerprint')}
								</th>
							</tr>
						</thead>
						<tbody>
							{liste.map((version) => (
								<tr key={version.id} className="border-b border-border hover:bg-hover">
									<td className="h-[var(--size-target)] px-3 text-right whitespace-nowrap">
										<code>{version.version_number}</code>
									</td>
									<td className="h-[var(--size-target)] px-3 text-right whitespace-nowrap">
										<code>{formaterPublication(version.published_at)}</code>
									</td>
									<td className={CLASSES_CELLULE}>
										{version.auteur ?? t('admin.workflows.versions.author.unknown')}
									</td>
									{/* Cellule vide et non un tiret lorsqu'il n'y a pas de note (§5.9). */}
									<td className={CLASSES_CELLULE} title={version.note ?? undefined}>
										{version.note}
									</td>
									<td className="h-[var(--size-target)] px-3 whitespace-nowrap">
										<code title={version.composition_fingerprint}>
											{empreinteCourte(version.composition_fingerprint)}
										</code>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}

			{/* --- Publier ------------------------------------------------------------------ */}
			<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
				<h4 className="font-medium">{t('admin.workflows.versions.publish.title')}</h4>
				<label className="text-sm text-text-2" htmlFor={idNote}>
					{t('admin.workflows.versions.publish.note')}
				</label>
				<input
					id={idNote}
					type="text"
					value={note}
					onChange={(evenement) => setNote(evenement.target.value)}
					className="h-[var(--size-target)] rounded-sm border border-border px-3"
				/>
				<p className="text-sm text-text-3">{t('admin.workflows.versions.publish.note.hint')}</p>
				<div className="flex">
					<Button
						variante="primaire"
						disabled={enCours !== null}
						data-testid="publier-version"
						onClick={() => void publier()}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.workflows.versions.publish.action')}
					</Button>
				</div>
				{refus?.bloc === 'publication' ? (
					<AlerteRefus marqueur="refus-publication" message={refus.texte} />
				) : null}
			</div>

			{/* --- Comparer ----------------------------------------------------------------- */}
			{liste.length > 0 ? (
				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
					<h4 className="font-medium">{t('admin.workflows.versions.compare.title')}</h4>
					<p className="text-sm text-text-2">{t('admin.workflows.versions.compare.hint')}</p>
					<div className="flex flex-wrap gap-3">
						<span className="flex flex-col gap-1">
							<label className="text-sm text-text-2" htmlFor={idChoixBase}>
								{t('admin.workflows.versions.compare.base')}
							</label>
							<select
								id={idChoixBase}
								value={idBase ?? ''}
								onChange={(evenement) => setIdBase(evenement.target.value)}
								className="h-[var(--size-target)] rounded-sm border border-border px-3"
							>
								{liste.map((version) => (
									<option key={version.id} value={version.id}>
										{t('admin.workflows.versions.number', {
											numero: String(version.version_number),
										})}
									</option>
								))}
							</select>
						</span>
						<span className="flex flex-col gap-1">
							<label className="text-sm text-text-2" htmlFor={idChoixCible}>
								{t('admin.workflows.versions.compare.target')}
							</label>
							<select
								id={idChoixCible}
								value={idCible ?? ''}
								onChange={(evenement) => setIdCible(evenement.target.value)}
								className="h-[var(--size-target)] rounded-sm border border-border px-3"
							>
								{liste.map((version) => (
									<option key={version.id} value={version.id}>
										{t('admin.workflows.versions.number', {
											numero: String(version.version_number),
										})}
									</option>
								))}
							</select>
						</span>
					</div>
					<div className="flex">
						<Button
							variante="secondaire"
							disabled={enCours !== null}
							data-testid="comparer-versions"
							onClick={() => void comparer()}
						>
							{t('admin.workflows.versions.compare.action')}
						</Button>
					</div>
					{enCours === 'comparaison' ? (
						<p role="status" className="text-sm text-text-2">
							{t('admin.workflows.versions.compare.running')}
						</p>
					) : null}
					{refus?.bloc === 'comparaison' ? (
						<AlerteRefus marqueur="refus-comparaison" message={refus.texte} />
					) : null}
					{comparaison !== null && comparaison.identique ? (
						<p data-testid="comparaison-identique" className="text-sm text-text-2">
							{t('admin.workflows.versions.compare.identical')}
						</p>
					) : null}
					{comparaison !== null && !comparaison.identique ? (
						<>
							<p data-testid="comparaison-resume" className="text-sm text-text-2">
								{t('admin.workflows.versions.compare.summary', {
									ajouts: String(comparaison.resume.ajouts),
									retraits: String(comparaison.resume.retraits),
									modifications: String(comparaison.resume.modifications),
								})}
							</p>
							<Collections comparaison={comparaison} />
						</>
					) : null}
				</div>
			) : null}

			{/* --- Planifier et restaurer ---------------------------------------------------- */}
			{liste.length > 0 ? (
				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
					<h4 className="font-medium">{t('admin.workflows.versions.plan.title')}</h4>
					<p className="text-sm text-text-2">{t('admin.workflows.versions.plan.hint')}</p>
					{/* La liste garde la largeur de son contenu, comme les deux listes de la
					    comparaison juste au-dessus : étirée sur toute la colonne, elle se lisait
					    comme un champ de saisie — vu sur la capture du 2026-08-15. */}
					<span className="flex w-fit flex-col gap-1">
						<label className="text-sm text-text-2" htmlFor={idChoixPlan}>
							{t('admin.workflows.versions.plan.version')}
						</label>
						<select
							id={idChoixPlan}
							value={idPlan ?? ''}
							onChange={(evenement) => {
								setIdPlan(evenement.target.value)
								// Les instructions portent sur les étapes d'UNE version : changer de
								// version les rend caduques, et les conserver ferait refuser le plan
								// en `origine de remappage inconnue` (§7 ter.12.4, vérification 7).
								setChoix(new Map())
								setPlan(null)
							}}
							className="h-[var(--size-target)] rounded-sm border border-border px-3"
						>
							{liste.map((version) => (
								<option key={version.id} value={version.id}>
									{t('admin.workflows.versions.number', {
										numero: String(version.version_number),
									})}
								</option>
							))}
						</select>
					</span>
					<div className="flex">
						<Button
							variante="secondaire"
							disabled={enCours !== null}
							data-testid="planifier-restauration"
							onClick={() => void planifier(choix)}
						>
							{t('admin.workflows.versions.plan.action')}
						</Button>
					</div>
					{enCours === 'plan' ? (
						<p role="status" className="text-sm text-text-2">
							{t('admin.workflows.versions.plan.running')}
						</p>
					) : null}
					{refus?.bloc === 'plan' ? (
						<AlerteRefus marqueur="refus-plan" message={refus.texte} />
					) : null}

					{plan !== null ? (
						<div data-testid="plan-remappage" className="flex flex-col gap-3">
							<p className="text-sm text-text-2">
								{t('admin.workflows.versions.plan.summary', {
									total: String(plan.resume.total),
									inchangees: String(plan.resume.inchangees),
									remappees: String(plan.resume.remappees),
									nonResolues: String(plan.resume.nonResolues),
								})}
							</p>
							<p
								role="status"
								data-testid="plan-verdict"
								className={plan.applicable ? 'text-sm text-success-on-soft' : 'text-sm text-danger-on-soft'}
							>
								{plan.applicable
									? t('admin.workflows.versions.plan.ready')
									: t('admin.workflows.versions.plan.notReady')}
							</p>

							{plan.retirees.length > 0 ? (
								<div className="flex flex-col gap-2">
									<h5 className="font-medium">{t('admin.workflows.versions.plan.removed')}</h5>
									<ul data-testid="etapes-retirees" className="flex flex-col gap-2">
										{plan.retirees.map((etape) => {
											const nom = etape.label ?? etape.step_id
											return (
												<li key={etape.step_id} className="flex flex-col gap-1">
													<span className="font-medium">{nom}</span>
													<span className="text-sm text-text-2">
														{t('admin.workflows.versions.plan.step.cards', {
															total: String(etape.cards_total),
															bloquees: String(etape.cards_unresolved),
														})}
													</span>
													<select
														aria-label={t('admin.workflows.versions.plan.step.target', {
															etape: nom,
														})}
														value={choix.get(etape.step_id) ?? ''}
														disabled={enCours !== null}
														onChange={(evenement) => {
															const suivant = new Map(choix)
															suivant.set(etape.step_id, evenement.target.value)
															setChoix(suivant)
															void planifier(suivant)
														}}
														className="h-[var(--size-target)] rounded-sm border border-border px-3"
													>
														{/* Aucune destination n'est devinée : l'option vide est en
														    tête et se nomme (§7 ter.14.5). */}
														<option value="">
															{t('admin.workflows.versions.plan.step.none')}
														</option>
														{etapesCibles.map((cible) => (
															<option key={cible.id} value={cible.id}>
																{cible.libelle}
															</option>
														))}
													</select>
												</li>
											)
										})}
									</ul>
								</div>
							) : null}

							{plan.retablies.length > 0 ? (
								<div className="flex flex-col gap-1">
									<h5 className="font-medium">{t('admin.workflows.versions.plan.restored')}</h5>
									<ul data-testid="etapes-retablies" className="flex flex-col">
										{plan.retablies.map((etape) => (
											<li key={etape.step_id}>{etape.label ?? etape.step_id}</li>
										))}
									</ul>
									<p className="text-sm text-text-3">
										{t('admin.workflows.versions.plan.restored.hint')}
									</p>
								</div>
							) : null}

							<div className="flex flex-col gap-1">
								<h5 className="font-medium">{t('admin.workflows.versions.plan.cards')}</h5>
								{/* La troncature est ÉCRITE, jamais laissée à deviner (§7 ter.12.7). */}
								<p data-testid="plan-troncature" className="text-sm text-text-2">
									{plan.affaires.tronquee
										? t('admin.workflows.versions.plan.cards.truncated', {
												rendues: String(plan.affaires.rendues),
												total: String(plan.affaires.total),
											})
										: t('admin.workflows.versions.plan.cards.all', {
												total: String(plan.affaires.total),
											})}
								</p>
								<div className="overflow-x-auto indique-debordement-x">
									<table
										data-testid="tableau-plan"
										className="w-full border-collapse text-left"
									>
										<caption className="sr-only">
											{t('admin.workflows.versions.plan.cards')}
										</caption>
										<thead>
											<tr className="border-b border-border">
												<th scope="col" className={CLASSES_ENTETE}>
													{t('admin.workflows.versions.plan.column.card')}
												</th>
												<th scope="col" className={CLASSES_ENTETE}>
													{t('admin.workflows.versions.plan.column.state')}
												</th>
												<th scope="col" className={CLASSES_ENTETE}>
													{t('admin.workflows.versions.plan.column.resolution')}
												</th>
											</tr>
										</thead>
										<tbody>
											{plan.affaires.items.map((affaire) => (
												<tr key={affaire.card_id} className="border-b border-border hover:bg-hover">
													<td className={CLASSES_CELLULE} title={affaire.title ?? undefined}>
														{affaire.title}
													</td>
													<td className={CLASSES_CELLULE}>{t(CLES_ETAT[affaire.state])}</td>
													<td className={CLASSES_CELLULE}>
														{t(CLES_RESOLUTION[affaire.resolution])}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>

							{/* La commande n'est JAMAIS éteinte par le verdict du plan (§7 ter.14.5). */}
							{confirmation ? (
								<div
									data-testid="confirmation-restauration"
									className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3"
								>
									<p className="font-medium">
										{t('admin.workflows.versions.restore.confirm', {
											numero: String(plan.version.version_number),
										})}
									</p>
									<p className="text-sm text-text-2">
										{t('admin.workflows.versions.restore.confirm.body')}
									</p>
									{/* Le geste écrit : un bloc muet pendant la transaction se lirait comme
									    une confirmation sans effet (§7 ter.14.8). */}
									{enCours === 'restauration' ? (
										<p role="status" className="text-sm text-text-2">
											{t('admin.workflows.versions.restore.running')}
										</p>
									) : null}
									{refus?.bloc === 'restauration' ? (
										<AlerteRefus marqueur="refus-restauration" message={refus.texte} />
									) : null}
									<div className="flex flex-wrap gap-2">
										<Button
											variante="destructif"
											disabled={enCours !== null}
											data-testid="confirmer-restauration"
											onClick={() => void restaurer()}
										>
											<RotateCcw aria-hidden="true" size={16} strokeWidth={2} />
											{t('admin.workflows.versions.restore.confirm.action')}
										</Button>
										<Button
											variante="secondaire"
											disabled={enCours !== null}
											onClick={() => {
												setRefus(null)
												setConfirmation(false)
											}}
										>
											{t('admin.action.cancel')}
										</Button>
									</div>
								</div>
							) : (
								<div className="flex">
									<Button
										variante="secondaire"
										disabled={enCours !== null}
										data-testid="ouvrir-restauration"
										onClick={() => {
											setRefus(null)
											setConfirmation(true)
										}}
									>
										<RotateCcw aria-hidden="true" size={16} strokeWidth={2} />
										{t('admin.workflows.versions.restore.action')}
									</Button>
								</div>
							)}
						</div>
					) : null}

					{/* Le résultat RESTE affiché après le rechargement du graphe (§5.15). */}
					{restauration !== null ? (
						<div data-testid="resultat-restauration" className="flex flex-col gap-1">
							<p role="status" className="font-medium">
								{t('admin.workflows.versions.restore.done', {
									numero: String(restauration.version.version_number),
								})}
							</p>
							<p className="text-sm text-text-2">
								{restauration.pointDeRetour.publie
									? t('admin.workflows.versions.restore.rollback.published', {
											numero: String(restauration.pointDeRetour.version_number),
										})
									: t('admin.workflows.versions.restore.rollback.existing', {
											numero: String(restauration.pointDeRetour.version_number),
										})}
							</p>
							<p className="text-sm text-text-2">
								{t('admin.workflows.versions.restore.counters', {
									affaires: String(restauration.affairesDeplacees),
									creees: String(restauration.etapes.creees),
									supprimees: String(restauration.etapes.supprimees),
									majes: String(restauration.etapes.majes),
									champsCrees: String(restauration.champs.crees),
									desarchives: String(restauration.champs.desarchives),
									archives: String(restauration.champs.archives),
									champsMajes: String(restauration.champs.majes),
								})}
							</p>
							<p className="text-sm text-text-2">
								{restauration.conformeALaVersion
									? t('admin.workflows.versions.restore.matches')
									: t('admin.workflows.versions.restore.differs')}
							</p>
						</div>
					) : null}
				</div>
			) : null}
		</section>
	)
}
