// @spec CRM-153 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Catégories d'organisations — lire le catalogue de l'espace, créer
//       une catégorie, la modifier, l'archiver et la désarchiver, toutes deux sans confirmation
// @spec docs/SPEC-organisations.md §9.1 (le catalogue, « supprimer » archive, décision 939), §9.3 (l'écran) ;
//       docs/DESIGN_SYSTEM.md §5.107 (la forme de Réglages ▸ Étiquettes et ▸ Pastilles des mails, sans descriptif ;
//       archiver sans confirmation), §5.103, §5.73, §5.68 (le sélecteur de couleur), §5.59 (les commandes éteintes avec
//       leur motif), §5.29 (le focus revient à une ancre qui survit), §5.29 bis (une archivée ne garde que
//       « Désarchiver » ; le refus de doublon nomme « Afficher les archivées »), §5.13, §5.8
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : la capacité d'administrer, rendue par la base, éteint les commandes ;
//       la RLS de `organization_categories` reste seule juge de chaque écriture, et son refus est traduit
//
// L'ÉCRAN EST LISIBLE PAR TOUT MEMBRE (§9.3) : chacun pose des catégories ou les lit sur la fiche. Qui n'administre pas
// l'espace voit les commandes, éteintes avec leur motif, jamais masquées (§5.59).

import { Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { PastilleEtiquette } from '../components/ui/PastilleEtiquette'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { NatureErreur } from '../lib/async'
import type { CouleurNoeud } from '../lib/board'
import {
	archiverCategorieOrganisation,
	creerCategorieOrganisation,
	LONGUEUR_NOM_CATEGORIE,
	lireCategoriesOrganisations,
	modifierCategorieOrganisation,
	type CategorieOrganisation,
	type NatureRefusCategorie,
} from '../lib/categories-organisations'
import { couleurEtiquette } from '../lib/etiquettes'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useContexteEspace } from './ContexteEspace'
import { SelecteurCouleur } from './SelecteurCouleur'

const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-base text-text'
const ID_MOTIF = 'categories-organisations-lecture-seule'
/** L'ancre qui survit à tout geste : la commande de création de l'en-tête (§5.29, tranche 2 g). */
const ANCRE_NOUVELLE = 'nouvelle'

const CLES_REFUS: Readonly<Record<NatureRefusCategorie, CleTraduction>> = {
	'nom-pris': 'admin.orgCategories.refus.nom',
	forme: 'admin.orgCategories.refus.forme',
	forbidden: 'admin.orgCategories.refus.forbidden',
	'sans-effet': 'admin.orgCategories.refus.sansEffet',
	network: 'admin.orgCategories.refus.panne',
	unknown: 'admin.orgCategories.refus.panne',
}

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly categories: readonly CategorieOrganisation[] }

type Ouverture = { readonly type: 'creation' } | { readonly type: 'modification'; readonly categorie: CategorieOrganisation } | null

export type ProprietesReglagesCategoriesOrganisations = { readonly client?: ClientCrm | null }

export function ReglagesCategoriesOrganisations({ client = clientCrm }: ProprietesReglagesCategoriesOrganisations = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const administration = capacites.administration
	// Éteint pendant la lecture de la capacité comme sur un refus ; le motif n'est dit que sur un refus établi (§5.59).
	const eteint = administration === 'refusee' || administration === 'en-lecture'
	const refuse = administration === 'refusee'
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [archives, setArchives] = useState(false)
	const [ouverture, setOuverture] = useState<Ouverture>(null)
	const [enCours, setEnCours] = useState<string | null>(null)
	const [refusLigne, setRefusLigne] = useState<{ readonly id: string; readonly texte: string } | null>(null)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	// Le focus revient à la commande qui a ouvert la fiche, ou qui a archivé ; si sa ligne a quitté la liste, à l'ancre.
	const retourFocus = useRef<string | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const r = ++rang.current
		void lireCategoriesOrganisations(client, idWorkspace).then((lu) => {
			if (r !== rang.current) return
			if (lu.statut === 'erreur') setLecture({ statut: 'erreur', nature: lu.erreur.nature })
			else if (lu.statut === 'pret') setLecture({ statut: 'pret', categories: lu.donnees })
		})
	}, [client, idWorkspace, tentative])

	useEffect(() => {
		if (ouverture !== null || retourFocus.current === null) return
		const cible =
			document.querySelector<HTMLElement>(`[data-retour-focus="${retourFocus.current}"]`) ??
			document.querySelector<HTMLElement>(`[data-retour-focus="${ANCRE_NOUVELLE}"]`)
		cible?.focus()
		retourFocus.current = null
	}, [ouverture, lecture])

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.orgCategories.noworkspace')} />
	}

	const relire = () => setTentative((n) => n + 1)
	const ouvrir = (suivante: Ouverture, cle: string) => {
		retourFocus.current = cle
		setRefusLigne(null)
		setOuverture(suivante)
	}
	const enregistree = (nom: string) => {
		setAnnonce(t('admin.orgCategories.saved', { nom }))
		setOuverture(null)
		relire()
	}
	const categories = lecture.statut === 'pret' ? lecture.categories : []

	// Archiver comme désarchiver s'écrit AUSSITÔT, sans confirmation (§5.107 : aucun effet différé, comme une étiquette).
	const archiver = async (categorie: CategorieOrganisation) => {
		const archive = !categorie.archivee
		setRefusLigne(null)
		setEnCours(categorie.id)
		const issue = await archiverCategorieOrganisation(client, categorie.id, archive)
		setEnCours(null)
		if (issue.statut === 'applique') {
			setAnnonce(t(archive ? 'admin.orgCategories.archived.done' : 'admin.orgCategories.unarchived', { nom: categorie.nom }))
			retourFocus.current = `archiver-${categorie.id}`
			relire()
			return
		}
		// Le refus se lit dans la ligne qui l'a causé (§5.13).
		setRefusLigne({ id: categorie.id, texte: t(CLES_REFUS[issue.nature]) })
	}

	const visibles = categories.filter((c) => archives || !c.archivee)
	const commande = (cle: string) => ({
		disabled: eteint,
		'data-retour-focus': cle,
		...(refuse ? { 'aria-describedby': ID_MOTIF } : {}),
	})

	return (
		<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-categories-organisations">
			<h2 className="text-h3">{t('admin.orgCategories.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('admin.orgCategories.intro')}</p>
			{refuse ? <MotifLectureSeule id={ID_MOTIF}>{t('rights.readonly.administration')}</MotifLectureSeule> : null}
			<div className="flex flex-wrap items-center gap-3">
				{ouverture?.type === 'creation' ? null : (
					<Button
						variante="primaire"
						data-testid="nouvelle-categorie"
						{...commande(ANCRE_NOUVELLE)}
						onClick={() => ouvrir({ type: 'creation' }, ANCRE_NOUVELLE)}
					>
						<Plus aria-hidden="true" size={16} strokeWidth={2} />
						{t('admin.orgCategories.new')}
					</Button>
				)}
				<label className="inline-flex items-center gap-2 min-h-[var(--size-target)] text-sm">
					<input
						type="checkbox"
						data-testid="categories-archivees"
						checked={archives}
						onChange={(evenement) => setArchives(evenement.target.checked)}
						className="size-6 accent-[var(--color-brand)]"
					/>
					{t('admin.orgCategories.showArchived')}
				</label>
			</div>
			<p role="status" className="sr-only" data-testid="annonce-categories">
				{annonce}
			</p>

			{ouverture?.type === 'creation' ? (
				<FicheCategorie
					client={client}
					idWorkspace={idWorkspace}
					categorie={null}
					categories={categories}
					onFermer={() => setOuverture(null)}
					onEnregistree={enregistree}
				/>
			) : null}

			{lecture.statut === 'chargement' ? (
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('admin.orgCategories.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			) : visibles.length === 0 ? (
				ouverture?.type === 'creation' ? null : (
					<EtatVide titre={t('admin.orgCategories.empty.title')} corps={t('admin.orgCategories.empty.body')} />
				)
			) : (
				<ul className="flex flex-col rounded-lg border border-border bg-surface" data-testid="liste-categories-organisations">
					{visibles.map((categorie) =>
						ouverture?.type === 'modification' && ouverture.categorie.id === categorie.id ? (
							<li key={categorie.id} className="p-3 border-b border-border last:border-b-0">
								<FicheCategorie
									client={client}
									idWorkspace={idWorkspace}
									categorie={categorie}
									categories={categories}
									onFermer={() => setOuverture(null)}
									onEnregistree={enregistree}
								/>
							</li>
						) : (
							<li
								key={categorie.id}
								data-testid="ligne-categorie-organisation"
								data-categorie={categorie.id}
								className="flex flex-col gap-2 px-4 py-2 min-h-[var(--size-target)] justify-center border-b border-border last:border-b-0"
							>
								{/* Sous `md`, les commandes prennent TOUJOURS leur propre rangée : repliées au gré de la longueur du nom,
								    deux lignes voisines n'avaient plus la même hauteur (vu en capture à 390 px ; la règle du §5.99). */}
								<div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
									<span className="flex min-w-0 flex-wrap items-center gap-2 md:flex-1">
										<PastilleEtiquette
											etiquette={categorie}
											{...(categorie.archivee
												? { nomAccessible: t('orgCategories.pill.archived', { nom: categorie.nom }) }
												: {})}
										/>
										{/* La mention est TEXTUELLE, jamais une teinte seule (§5.13). */}
										{categorie.archivee ? <Badge ton="accent">{t('admin.orgCategories.archived')}</Badge> : null}
									</span>
									<span className="flex flex-wrap gap-1">
										{/* Une archivée ne garde que « Désarchiver » (§5.29 bis). */}
										{categorie.archivee ? null : (
											<Button
												variante="discret"
												taille="compacte"
												{...commande(`modifier-${categorie.id}`)}
												aria-label={t('admin.orgCategories.edit.aria', { nom: categorie.nom })}
												onClick={() => ouvrir({ type: 'modification', categorie }, `modifier-${categorie.id}`)}
											>
												{t('admin.orgCategories.edit')}
											</Button>
										)}
										<Button
											variante="discret"
											taille="compacte"
											{...commande(`archiver-${categorie.id}`)}
											disabled={eteint || enCours === categorie.id}
											aria-label={t(
												categorie.archivee ? 'admin.orgCategories.unarchive.aria' : 'admin.orgCategories.archive.aria',
												{ nom: categorie.nom },
											)}
											onClick={() => void archiver(categorie)}
										>
											{t(categorie.archivee ? 'admin.orgCategories.unarchive' : 'admin.orgCategories.archive')}
										</Button>
									</span>
								</div>
								{refusLigne?.id === categorie.id ? (
									<p
										role="alert"
										data-testid="refus-ligne-categorie"
										className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
									>
										<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
										<span>{refusLigne.texte}</span>
									</p>
								) : null}
							</li>
						),
					)}
				</ul>
			)}
		</div>
	)
}

/**
 * La fiche d'une catégorie, dans le flux (§5.107) : le nom et la couleur. Une catégorie nouvelle en tête, une existante à
 * sa place. Le refus de doublon nomme « Afficher les archivées » quand le nom est pris par une archivée (§5.29 bis).
 */
function FicheCategorie({
	client,
	idWorkspace,
	categorie,
	categories,
	onFermer,
	onEnregistree,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly categorie: CategorieOrganisation | null
	readonly categories: readonly CategorieOrganisation[]
	readonly onFermer: () => void
	readonly onEnregistree: (nom: string) => void
}) {
	const id = useId()
	const [nom, setNom] = useState(categorie?.nom ?? '')
	const [couleur, setCouleur] = useState<CouleurNoeud>(categorie?.couleur ?? 'neutral')
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<string | null>(null)
	const champNom = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		champNom.current?.focus()
	}, [])

	const envoyer = async () => {
		if (enCours) return
		setRefus(null)
		setEnCours(true)
		const saisie = { nom, couleur }
		const issue =
			categorie === null
				? await creerCategorieOrganisation(client, idWorkspace, saisie)
				: await modifierCategorieOrganisation(client, categorie.id, saisie)
		setEnCours(false)
		if (issue.statut === 'applique') return onEnregistree(nom.trim())
		// Un nom pris par une ARCHIVÉE : le refus nomme le geste qui la montre (§5.29 bis, règle générale).
		const priseParArchivee =
			issue.nature === 'nom-pris' &&
			categories.some(
				(c) => c.archivee && c.id !== categorie?.id && c.nom.toLocaleLowerCase('fr') === nom.trim().toLocaleLowerCase('fr'),
			)
		setRefus(t(priseParArchivee ? 'admin.orgCategories.refus.nomArchivee' : CLES_REFUS[issue.nature]))
		// La saisie est gardée, et le focus revient au nom (§5.73).
		champNom.current?.focus()
	}

	return (
		<form
			data-testid="fiche-categorie-organisation"
			aria-label={t(categorie === null ? 'admin.orgCategories.form.new' : 'admin.orgCategories.form.edit')}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
			noValidate
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
			<div className="flex flex-col gap-1 max-w-[48ch]">
				<label htmlFor={`${id}-nom`} className="text-sm text-text-2">
					{t('admin.orgCategories.field.name')}
				</label>
				<input
					id={`${id}-nom`}
					ref={champNom}
					data-testid="categorie-nom"
					type="text"
					autoComplete="off"
					maxLength={LONGUEUR_NOM_CATEGORIE}
					value={nom}
					onChange={(evenement) => setNom(evenement.target.value)}
					className={CLASSES_CHAMP}
				/>
			</div>
			<SelecteurCouleur valeur={couleur} onChange={(valeur) => setCouleur(couleurEtiquette(valeur))} />
			{refus === null ? null : (
				<p
					role="alert"
					data-testid="refus-categorie"
					className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm max-w-[72ch]"
				>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
					<span>{refus}</span>
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{/* Jamais éteint par l'état du champ : aucune garde de saisie ne double une contrainte de la base (§5.34). */}
				<Button variante="primaire" type="submit" disabled={enCours} data-testid="categorie-enregistrer">
					{t(enCours ? 'admin.orgCategories.pending' : 'admin.orgCategories.save')}
				</Button>
				<Button variante="secondaire" disabled={enCours} data-testid="categorie-annuler" onClick={onFermer}>
					{t('admin.orgCategories.cancel')}
				</Button>
			</div>
		</form>
	)
}
