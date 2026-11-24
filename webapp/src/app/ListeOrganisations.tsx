// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — la liste suit l'espace courant de l'onglet, état intermédiaire jusqu'à T3 (§15.2) ; docs/SPEC-espace-courant.md
// @spec CRM-161 (docs/BACKLOG.md) tranche T3.c — fin de l'état intermédiaire : à partir de deux espaces lus, la liste lit
//       tous les espaces, ou ceux du filtre « Espace », PAR LA LECTURE (`p_workspace_ids`, la liste est paginée) ; la colonne
//       « Espace », la dernière ; le bouton « Espace » dans la barre, son panneau sous elle, un seul panneau ouvert ; les
//       cases « Tracks » et « Catégories » des espaces de la portée, groupées sous une sous-légende par espace ; le vide sous
//       le filtre ; la création dans l'espace de l'onglet, dite ; rien pour une personne d'un seul espace
//       (docs/SPEC-espace-courant.md §16.2, §16.8.3 ; docs/DESIGN_SYSTEM.md §5.115, §5.105, §5.28 ; docs/manual.md §4)
// @spec CRM-114 (docs/BACKLOG.md) — tranche T2 : l'onglet « Organisations » du carnet — la liste et la création
// @spec docs/SPEC-organisations.md §2 (lister, créer, puis ouvrir la fiche), §3 (droits de la base, refus), §4 (de quoi il a
//       l'air) ; docs/DESIGN_SYSTEM.md §5.64 (tableau, « Nouvelle organisation »), §5.59 (commande éteinte avec le motif
//       quand la base refuse l'édition de l'espace), §5.9 (tableau), §5.8 (états), §12.6
// @spec CRM-146 (docs/BACKLOG.md) — tranche T2 : la colonne « Réel sur prévu », après « Contacts » ; les totaux lus par
//       `organization_revenue_totals()` À CÔTÉ DE LA PREMIÈRE PAGE, LES DEUX ATTENDUES ENSEMBLE — une colonne remplie après
//       coup confondrait « pas encore lu » et « aucune recette » ; un échec de l'une rend l'erreur de l'onglet, et
//       « Réessayer » relit les deux (docs/SPEC-recettes.md §12.4 ; docs/DESIGN_SYSTEM.md §5.97)
// @spec CRM-152 (docs/BACKLOG.md) — tranche T2 : la barre « Rechercher » (à la frappe, 300 ms), « Tracks » (un panneau de
//       cases dans le flux), « Recettes », « Effacer les filtres » ; le tri par « Nom » et « Contacts » ; la colonne
//       « Tracks » après « Nom » ; « Afficher plus » et « 50 sur 132 » ; l'adresse qui porte filtres et tri ; une relecture
//       qui garde les lignes ; le vide sous les filtres (docs/SPEC-organisations.md §8.2, §8.3 ; docs/DESIGN_SYSTEM.md
//       §5.105 ; docs/JOURNAL.md décisions 931 et 936). La liste est lue en base, page par page (`organization_list`) ;
//       les totaux restent lus une fois pour l'espace, non paginés — compromis nommé au §8.3.
//
// L'écran ne calcule aucun droit : il lit la capacité que la base rend (`edition_permise`) pour éteindre la commande, et
// traduit le refus de la base si elle survient malgré tout. Il ne filtre ni ne trie rien lui-même : la base le fait.

// @spec CRM-153 (docs/BACKLOG.md) — tranche T4 : les catégories SOUS LE NOM, trois pilules au plus puis « +n » ; le filtre
//       « Catégories » après « Tracks », le même bouton et le même panneau de cases, `categories=` dans l'adresse
//       (docs/SPEC-organisations.md §9.3 ; docs/DESIGN_SYSTEM.md §5.107 ; décision 942). Aucune colonne de plus : le
//       tableau tient toujours dans son cadre (décision 940).
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { PastilleEtiquette, PastilleReste } from '../components/ui/PastilleEtiquette'
import { t, type CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import { motifVisible, proprietesCommande } from '../lib/capacites'
import {
	SAISIE_ORGANISATION_VIDE,
	creerOrganisation,
	ecrireParametresOrganisations,
	filtresOrganisationsPoses,
	lireParametresOrganisations,
	lirePageOrganisations,
	lireTracksDesEspaces,
	sansFiltresOrganisations,
	type FiltreRecettes,
	type OrganisationListee,
	type ParametresOrganisations,
	type PorteeOrganisations,
	type TrackDuFiltre,
	type TriOrganisations,
} from '../lib/organisations'
import { lireCategoriesDesEspaces, type CategorieDEspace, type CategorieOrganisation } from '../lib/categories-organisations'
import { lireTotauxOrganisations, type TotauxParOrganisation } from '../lib/recettes-organisation'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useWorkspaces, type Workspace } from '../lib/workspaces'
import { espacesDeLaPortee, grouperParEspace, nomEspace, type GroupeDEspace } from '../lib/provenance'
import { cheminOrganisation } from './chemins'
import { AppShell } from './AppShell'
import { useContexteEspace } from './ContexteEspace'
import { FormulaireOrganisation } from './FormulaireOrganisation'
import { OngletsCarnet } from './OngletsCarnet'
import { classesPastille } from './presentation-tracks'
import { AUCUN_TOTAL, ReelSurPrevu } from './RecettesOrganisation'
import { idEspaceParmi } from '../lib/espace-onglet'
import {
	BoutonFiltreEspaces,
	PanneauFiltreEspaces,
	VideSousFiltreEspaces,
	useFiltreEspaces,
	type FiltreEspacesDePage,
} from './FiltreEspaces'

const ID_MOTIF = 'organisations-lecture-seule'
/** Le titre de la route, nommé hors du JSX pour le contrôle des clés mortes, comme `CLE_TITRE_CARD`. */
const CLE_TITRE: CleTraduction = 'route.organizations.title'
/** La recherche suit la frappe après ce délai (docs/DESIGN_SYSTEM.md §5.105). */
export const DELAI_RECHERCHE_MS = 300

/** La route de l'onglet : sa coquille, les onglets du carnet, puis la liste. */
export function RouteOrganisations() {
	return (
		<AppShell cleTitreRoute={CLE_TITRE}>
			<div className="flex flex-col gap-4">
				<OngletsCarnet actif="organisations" />
				<ListeOrganisations />
			</div>
		</AppShell>
	)
}
// `CRM-152` (décision 940) : LE TABLEAU A DES COLONNES DE LARGEUR FIXE (`table-fixed` et `colgroup`) — une cellule trop
// longue se tronque, son texte entier en `title`, et le tableau ne déborde plus de son cadre : il tient de 900 à 1440 px ;
// sous sa largeur minimale (864 px), à 390 px, il défile dans son cadre (docs/DESIGN_SYSTEM.md §7, §12.6, §5.105).
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate'
const CLASSES_CELLULE_TECHNIQUE = 'h-[var(--size-target)] px-3 text-right whitespace-nowrap truncate'
const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'
// Une cellule « Réel sur prévu » prend la hauteur de ses devises empilées, 40 px restant son minimum (§5.97, l'écart au
// §5.9 du §5.60).
const CLASSES_CELLULE_RECETTES = 'h-[var(--size-target)] px-3 py-1 text-right whitespace-nowrap'
const CLASSES_CONTROLE = 'min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-base'

/** Les lignes rendues, leur total au-delà de la page, et les totaux de recettes lus à côté. */
type ListeLue = {
	readonly organisations: readonly OrganisationListee[]
	readonly total: number
	readonly totaux: TotauxParOrganisation
	/**
	 * `CRM-161` T3.c : la page a été lue sous un filtre « Espace ». Le vide se juge sur la portée DES LIGNES MONTRÉES, non
	 * sur l'adresse : sitôt le filtre vidé, et avant la relecture, la page n'est pas « vide », et la barre — où
	 * « Afficher tous les espaces » rend le focus — reste montée. *Trouvé par le test unitaire de T3.c.*
	 */
	readonly sousFiltreEspaces: boolean
}

/** L'état de « Afficher plus » : au repos, en lecture, ou en échec (écrit sous lui, avec « Réessayer »). */
type EtatPlus = 'repos' | 'chargement' | 'erreur'

/** Une lecture des cases, marquée des espaces qu'elle couvre : une réponse d'une autre portée n'en replie aucune. */
type CasesLues<T> = { readonly cle: string; readonly etat: EtatAsync<readonly T[]> }

export function ListeOrganisations({ client = clientCrm }: { readonly client?: ClientCrm | null } = {}) {
	const { capacites, idWorkspace: idEspaceContexte } = useContexteEspace()
	const navigate = useNavigate()
	const espaces = useWorkspaces(client)
	const [adresse, setAdresse] = useSearchParams()
	const cleAdresse = adresse.toString()
	// eslint-disable-next-line react-hooks/exhaustive-deps -- la clé textuelle de l'adresse dit seule quand relire
	const parametres = useMemo(() => lireParametresOrganisations(adresse), [cleAdresse])
	const parametresCourants = useRef(parametres)
	parametresCourants.current = parametres

	const [etat, setEtat] = useState<EtatAsync<ListeLue>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [relecture, setRelecture] = useState(false)
	const [plus, setPlus] = useState<EtatPlus>('repos')
	const [annonce, setAnnonce] = useState('')
	const [ouvert, setOuvert] = useState(false)
	const [focusARendre, setFocusARendre] = useState(false)
	const commande = useRef<HTMLButtonElement>(null)
	const boutonPlus = useRef<HTMLButtonElement>(null)
	const tableau = useRef<HTMLTableElement>(null)
	const courant = useRef(0)
	// Les totaux de recettes, lus une fois pour l'espace ; gardés d'une relecture des filtres à l'autre.
	const totauxLus = useRef<TotauxParOrganisation | null>(null)

	// `CRM-161` T2.a (docs/SPEC-espace-courant.md §15.2) : l'espace de l'onglet — celui où la création se fait (T3.c, §16.2).
	const idWorkspace = espaces.etat.statut === 'pret' ? idEspaceParmi(espaces.etat.donnees, idEspaceContexte) : null
	const cleParametres = JSON.stringify(parametres)

	// `CRM-161` T3.c (§16.8.3) — LA PORTÉE : d'un seul espace, l'espace de l'onglet, la liste d'avant ; à partir de deux, les
	// espaces du filtre « Espace », sinon tous. Les cases « Tracks » et « Catégories » couvrent les mêmes espaces.
	const filtreEspaces = useFiltreEspaces()
	const cleChoisis = filtreEspaces.choisis.join(',')
	const portee: PorteeOrganisations | null = filtreEspaces.visible
		? { espaces: filtreEspaces.choisis }
		: idWorkspace === null
			? null
			: { espace: idWorkspace }
	const porteeCourante = useRef(portee)
	porteeCourante.current = portee
	const espacesDesCases = filtreEspaces.visible ? espacesDeLaPortee(filtreEspaces.espaces, filtreEspaces.choisis) : null
	const idsDesCases = espacesDesCases === null ? (idWorkspace === null ? [] : [idWorkspace]) : espacesDesCases.map((e) => e.id)
	const cleCases = idsDesCases.join(',')
	// Deux espaces dans la portée des cases : elles se groupent sous le nom de chacun (§5.115).
	const groupesDesCases = espacesDesCases !== null && espacesDesCases.length >= 2 ? espacesDesCases : null

	// `CRM-152` puis T3.c — LES TRACKS DES CASES, lus pour les espaces de la portée, et relus sur reprise.
	const [tracksLus, setTracksLus] = useState<CasesLues<TrackDuFiltre>>({ cle: '', etat: enChargement() })
	const [tentativeTracks, setTentativeTracks] = useState(0)
	useEffect(() => {
		if (client === null || cleCases === '') return
		let actuel = true
		setTracksLus({ cle: cleCases, etat: enChargement() })
		void lireTracksDesEspaces(client, cleCases.split(',')).then((lu) => {
			if (actuel) setTracksLus({ cle: cleCases, etat: lu })
		})
		return () => {
			actuel = false
		}
	}, [client, cleCases, tentativeTracks])

	// `CRM-153` T4 puis T3.c — LE CATALOGUE DES CATÉGORIES, pour le filtre (§5.107) : celui des espaces de la portée, relu
	// sur reprise.
	const [catalogueLu, setCatalogueLu] = useState<CasesLues<CategorieDEspace>>({ cle: '', etat: enChargement() })
	const [tentativeCatalogue, setTentativeCatalogue] = useState(0)
	useEffect(() => {
		if (client === null || cleCases === '') return
		let actuel = true
		setCatalogueLu({ cle: cleCases, etat: enChargement() })
		void lireCategoriesDesEspaces(client, cleCases.split(',')).then((lu) => {
			if (actuel) setCatalogueLu({ cle: cleCases, etat: lu })
		})
		return () => {
			actuel = false
		}
	}, [client, cleCases, tentativeCatalogue])
	// Une lecture d'une autre portée attend la sienne : rien n'en est montré, rien n'en est replié.
	const tracksDesCases = useMemo<EtatAsync<readonly TrackDuFiltre[]>>(
		() => (tracksLus.cle === cleCases ? tracksLus.etat : enChargement()),
		[tracksLus, cleCases],
	)
	const catalogue = useMemo<EtatAsync<readonly CategorieDEspace[]>>(
		() => (catalogueLu.cle === cleCases ? catalogueLu.etat : enChargement()),
		[catalogueLu, cleCases],
	)

	const changer = useCallback(
		(suivants: ParametresOrganisations) => {
			setAdresse((precedente) => ecrireParametresOrganisations(suivants, precedente), { replace: true })
		},
		[setAdresse],
	)

	// LA PREMIÈRE PAGE, relue à chaque changement de recherche, de filtre ou de tri, et à chaque « Réessayer ». Au premier
	// chargement, les totaux sont lus avec elle et attendus ensemble ; ensuite, une relecture GARDE les lignes affichées,
	// atténuées (`aria-busy`), jusqu'à la réponse — aucun squelette au-delà du premier chargement (§5.105).
	useEffect(() => {
		const lue = porteeCourante.current
		if (client === null || lue === null) return
		const rang = ++courant.current
		const premiere = totauxLus.current === null
		if (premiere) setEtat(enChargement())
		else setRelecture(true)
		setPlus('repos')
		void (async () => {
			const [page, totaux] = await Promise.all([
				lirePageOrganisations(client, lue, parametresCourants.current, 0),
				totauxLus.current === null ? lireTotauxOrganisations(client) : Promise.resolve(pret(totauxLus.current)),
			])
			if (rang !== courant.current) return
			setRelecture(false)
			if (page.statut === 'erreur') return setEtat(enErreur(page.erreur))
			if (totaux.statut === 'erreur') return setEtat(enErreur(totaux.erreur))
			if (page.statut !== 'pret' || totaux.statut !== 'pret') return
			totauxLus.current = totaux.donnees
			setEtat(
				pret({
					organisations: page.donnees.organisations,
					total: page.donnees.total,
					totaux: totaux.donnees,
					sousFiltreEspaces: 'espaces' in lue && lue.espaces.length > 0,
				}),
			)
		})()
		// `CRM-161` T3.c : changer le choix des espaces relit la première page, comme un filtre (§16.8.3) ; la portée est lue
		// par sa clé, `cleChoisis`, par `filtreEspaces.visible` et par `idWorkspace`.
	}, [client, idWorkspace, cleParametres, cleChoisis, filtreEspaces.visible, tentative])

	// UN TRACK INCONNU DE L'ADRESSE EST REPLIÉ (§8.3) : une fois les tracks de la portée lus, un identifiant qui n'en est pas
	// un quitte l'adresse plutôt que de vider la liste sans raison visible.
	useEffect(() => {
		if (tracksDesCases.statut !== 'pret' || parametres.tracks.length === 0) return
		const connus = new Set(tracksDesCases.donnees.map((track) => track.id))
		const gardes = parametres.tracks.filter((id) => connus.has(id))
		if (gardes.length !== parametres.tracks.length) changer({ ...parametres, tracks: gardes })
	}, [tracksDesCases, parametres, changer])

	// UNE CATÉGORIE INCONNUE DE L'ADRESSE EST REPLIÉE de même (`CRM-153` T4) ; une archivée reste connue, et filtre (§9.1).
	useEffect(() => {
		if (catalogue.statut !== 'pret' || parametres.categories.length === 0) return
		const connues = new Set(catalogue.donnees.map((categorie) => categorie.id))
		const gardees = parametres.categories.filter((id) => connues.has(id))
		if (gardees.length !== parametres.categories.length) changer({ ...parametres, categories: gardees })
	}, [catalogue, parametres, changer])

	useEffect(() => {
		if (ouvert || !focusARendre) return
		commande.current?.focus()
		setFocusARendre(false)
	}, [ouvert, focusARendre])

	const fermer = useCallback(() => {
		setOuvert(false)
		setFocusARendre(true)
	}, [])

	const afficherPlus = useCallback(async () => {
		const lue = porteeCourante.current
		if (client === null || lue === null || etat.statut !== 'pret') return
		const rang = courant.current
		const deja = etat.donnees.organisations.length
		setPlus('chargement')
		const page = await lirePageOrganisations(client, lue, parametresCourants.current, deja)
		// Une relecture des filtres partie entre-temps rend cette page caduque.
		if (rang !== courant.current) return
		if (page.statut !== 'pret') {
			setPlus('erreur')
			return
		}
		const nouvelles = page.donnees.organisations
		setEtat(pret({ ...etat.donnees, organisations: [...etat.donnees.organisations, ...nouvelles], total: page.donnees.total }))
		setPlus('repos')
		setAnnonce(
			nouvelles.length === 1
				? t('organizations.more.live.one')
				: t('organizations.more.live', { nombre: String(nouvelles.length) }),
		)
		// LE FOCUS RESTE SUR « Afficher plus » (§5.105). *Précisé au code* : quand la dernière page le fait disparaître, il
		// passe au lien de la première organisation ajoutée, jamais au corps du document.
		if (deja + nouvelles.length >= page.donnees.total) {
			requestAnimationFrame(() => {
				const premiere = nouvelles[0]
				if (premiere === undefined) return
				tableau.current
					?.querySelector<HTMLAnchorElement>(`tr[data-organisation="${premiere.id}"] a`)
					?.focus()
			})
		}
	}, [client, etat])

	if (client === null || (espaces.etat.statut === 'pret' && idWorkspace === null)) {
		return <EtatVide titre={t('contacts.noWorkspace.title')} corps={t('contacts.noWorkspace.body')} />
	}
	if (etat.statut === 'erreur' || espaces.etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('organizations.error.title')}
				corps={t('organizations.error.body')}
				libelleReprise={t('organizations.error.retry')}
				onReprise={() => {
					// « Réessayer » relit les deux : la page et les totaux (§12.4 de CRM-146).
					totauxLus.current = null
					if (espaces.etat.statut === 'erreur') espaces.recharger()
					setTentative((n) => n + 1)
				}}
			/>
		)
	}
	if (etat.statut === 'chargement') return <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />

	const droit = proprietesCommande(capacites.edition, ID_MOTIF)
	// `CRM-161` T3.c (§16.2, §5.115) : à partir de deux espaces lus, la création dit l'espace de l'onglet, où elle se fait.
	const nomEspaceDeCreation = filtreEspaces.visible ? nomEspace(filtreEspaces.espaces, idWorkspace) : null
	const commandeCreation = (
		<button
			type="button"
			ref={commande}
			data-testid="ouvrir-creation-organisation"
			className="self-start min-h-[var(--size-target)] rounded-md bg-brand px-4 text-surface disabled:cursor-not-allowed disabled:opacity-70"
			{...droit}
			onClick={() => setOuvert(true)}
		>
			{t('organizations.creation.open')}
		</button>
	)
	const geste =
		idWorkspace === null ? null : ouvert ? (
			<FormulaireOrganisation
				prefixe="organisation-nouvelle"
				titre={t('organizations.creation.title')}
				saisieInitiale={SAISIE_ORGANISATION_VIDE}
				libelleEnvoi={t('organizations.creation.submit')}
				libelleEnvoiEnCours={t('organizations.creation.pending')}
				nomEspace={nomEspaceDeCreation}
				onAnnuler={fermer}
				onEnvoyer={async (saisie) => {
					const issue = await creerOrganisation(client, idWorkspace, saisie)
					if (issue.statut === 'refus') return issue.nature
					// LA FICHE PORTE LA SUITE : ses contacts à rattacher (docs/DESIGN_SYSTEM.md §5.64).
					void navigate(cheminOrganisation(issue.id))
					return null
				}}
			/>
		) : (
			<>
				{motifVisible(capacites.edition) ? (
					<MotifLectureSeule id={ID_MOTIF}>{t('rights.readonly.edition')}</MotifLectureSeule>
				) : null}
				{nomEspaceDeCreation === null ? (
					commandeCreation
				) : (
					<div className="flex flex-wrap items-center gap-3">
						{commandeCreation}
						<span data-testid="espace-des-gestes" className="text-sm text-text-2">
							{t('spaces.creation.in', { nom: nomEspaceDeCreation })}
						</span>
					</div>
				)}
			</>
		)

	const { organisations, total, totaux, sousFiltreEspaces } = etat.donnees
	const filtre = filtresOrganisationsPoses(parametres)
	// LE VIDE DE L'ESPACE (§5.64) N'EST PAS LE VIDE SOUS LES FILTRES : le premier n'a ni barre ni tableau ; le second garde
	// la barre, cause de l'état, et porte « Effacer les filtres » — jamais en double avec celui de la barre.
	// `CRM-161` T3.c (§5.115) : le filtre « Espace » seul a son propre vide, « Rien dans les espaces choisis ».
	const videEspace = total === 0 && !filtre && !sousFiltreEspaces
	const videFiltre = total === 0 && filtre
	const videEspaces = total === 0 && !filtre && sousFiltreEspaces
	// La colonne « Espace » (§5.115), la dernière : à partir de deux espaces lus.
	const espacesNommes: readonly Workspace[] | undefined = filtreEspaces.visible ? filtreEspaces.espaces : undefined
	const effacer = () => changer(sansFiltresOrganisations(parametres))

	return (
		<section aria-label={t('organizations.aria')} className="flex flex-col gap-4">
			<LiveRegion libelle={t('organizations.list.live.aria')} message={annonce} />
			{geste}
			{videEspace ? (
				<EtatVide titre={t('organizations.empty.title')} corps={t('organizations.empty.body')} />
			) : (
				<>
					<BarreFiltresOrganisations
						parametres={parametres}
						tracks={tracksDesCases}
						onRechargerTracks={() => setTentativeTracks((n) => n + 1)}
						categories={catalogue}
						onRechargerCategories={() => setTentativeCatalogue((n) => n + 1)}
						filtreEspaces={filtreEspaces}
						groupes={groupesDesCases}
						offrirEffacement={filtre && !videFiltre}
						onParametres={changer}
						onEffacer={effacer}
					/>
					{videEspaces ? (
						<VideSousFiltreEspaces filtre={filtreEspaces} />
					) : videFiltre ? (
						<EtatVide
							titre={t('organizations.empty.filtered.title')}
							corps=""
							action={
								<Button variante="secondaire" data-testid="effacer-filtres-organisations-vide" onClick={effacer}>
									{t('organizations.filter.clear')}
								</Button>
							}
						/>
					) : (
						<>
							<div className="overflow-x-auto indique-debordement-x">
								<table
									ref={tableau}
									data-testid="tableau-organisations"
									aria-busy={relecture}
									className={['w-full min-w-[54rem] table-fixed border-collapse text-left', relecture ? 'opacity-60' : ''].join(' ')}
								>
									<caption className="sr-only">{t('organizations.table.aria')}</caption>
									{espacesNommes === undefined ? (
										<colgroup>
											<col className="w-[17%]" />
											<col className="w-[17%]" />
											<col className="w-[25%]" />
											<col className="w-[12%]" />
											<col className="w-[29%]" />
										</colgroup>
									) : (
										// `CRM-161` T3.c : la colonne « Espace » prend sa part aux autres ; le tableau tient dans son cadre
										// (décision 940).
										<colgroup>
											<col className="w-[15%]" />
											<col className="w-[15%]" />
											<col className="w-[22%]" />
											<col className="w-[10%]" />
											<col className="w-[25%]" />
											<col className="w-[13%]" />
										</colgroup>
									)}
									<thead>
										<tr className="border-b border-border">
											<EnTeteTriable cle="nom" libelle={t('organizations.table.name')} parametres={parametres} onParametres={changer} />
											<th scope="col" className={CLASSES_ENTETE}>{t('organizations.table.tracks')}</th>
											<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('organizations.table.web')}</th>
											<EnTeteTriable
												cle="contacts"
												libelle={t('organizations.table.contacts')}
												parametres={parametres}
												onParametres={changer}
												alignementDroite
											/>
											<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('organizations.table.revenues')}</th>
											{espacesNommes === undefined ? null : (
												<th scope="col" className={CLASSES_ENTETE}>{t('spaces.column')}</th>
											)}
										</tr>
									</thead>
									<tbody>
										{organisations.map((organisation) => {
											const noms = organisation.tracks.map((track) => track.name).join(' · ')
											return (
												<tr key={organisation.id} data-testid="ligne-organisation" data-organisation={organisation.id} className="border-b border-border hover:bg-hover">
													{/* `CRM-153` T4 (§5.107, décision 942) : la cellule « Nom » porte DEUX LIGNES — le nom, toujours
													    tronqué en ellipse, puis ses catégories ; sans catégorie, aucune ligne vide. */}
													<td className="px-3 py-1 min-h-[var(--size-target)]">
														<span className="block truncate" title={organisation.name}>
															<Link to={cheminOrganisation(organisation.id)} className="text-brand hover:underline" data-testid="lien-fiche-organisation">
																{organisation.name}
															</Link>
														</span>
														<CategoriesSousNom categories={organisation.categories} />
													</td>
													<td className={`${CLASSES_CELLULE} text-text-2`} data-testid="cellule-tracks" {...(noms === '' ? {} : { title: noms })}>
														{noms}
													</td>
													{/* `CRM-152` (décision 940) : LE DOMAINE ET LE SITE WEB DANS UNE CELLULE, sur deux lignes — deux
													    colonnes techniques côte à côte faisaient déborder le tableau. Chacun se tronque, entier en `title`. */}
													<td className="px-3 py-1 text-right" data-testid="cellule-web">
														<span className="flex min-h-[var(--size-target)] flex-col items-end justify-center">
															{organisation.domain === null ? null : (
																<code data-testid="domaine-organisation" className="block max-w-full truncate text-sm text-text-2" title={organisation.domain}>
																	{organisation.domain}
																</code>
															)}
															{organisation.website === null ? null : (
																<code data-testid="site-organisation" className="block max-w-full truncate text-sm text-text-2" title={organisation.website}>
																	{organisation.website}
																</code>
															)}
														</span>
													</td>
													<td className={`${CLASSES_CELLULE_TECHNIQUE} tabular-nums`}>{organisation.contacts}</td>
													<td className={CLASSES_CELLULE_RECETTES}>
														<ReelSurPrevu totaux={totaux.get(organisation.id) ?? AUCUN_TOTAL} />
													</td>
													{espacesNommes === undefined ? null : (
														<td
															data-testid="espace-organisation"
															className={`${CLASSES_CELLULE} text-text-2`}
															title={nomEspace(espacesNommes, organisation.workspace_id) ?? undefined}
														>
															{nomEspace(espacesNommes, organisation.workspace_id) ?? ''}
														</td>
													)}
												</tr>
											)
										})}
									</tbody>
								</table>
							</div>
							<div className="flex flex-wrap items-center gap-3">
								<p data-testid="compte-organisations" className="text-sm text-text-2 tabular-nums">
									{t('organizations.more.count', { affichees: String(organisations.length), total: String(total) })}
								</p>
								{organisations.length < total ? (
									<Button
										ref={boutonPlus}
										taille="compacte"
										data-testid="afficher-plus-organisations"
										aria-busy={plus === 'chargement'}
										onClick={() => {
											if (plus !== 'chargement') void afficherPlus()
										}}
									>
										{plus === 'chargement' ? t('organizations.more.loading') : t('organizations.more.button')}
									</Button>
								) : null}
							</div>
							{plus === 'erreur' ? (
								<div role="alert" data-testid="erreur-plus-organisations" className="flex flex-wrap items-center gap-3 text-sm text-danger">
									{t('organizations.more.error')}
									<Button taille="compacte" variante="discret" onClick={() => void afficherPlus()}>
										{t('organizations.more.retry')}
									</Button>
								</div>
							) : null}
						</>
					)}
				</>
			)}
		</section>
	)
}

/**
 * En-tête triable (docs/DESIGN_SYSTEM.md §5.9) : `aria-sort` sur le `th`, l'icône de sens avec le libellé. Cliquer la
 * colonne triée inverse le sens ; en changer part de l'ascendant (§8.3). La liste repart de la première page.
 */
function EnTeteTriable({
	cle,
	libelle,
	parametres,
	onParametres,
	alignementDroite = false,
}: {
	readonly cle: TriOrganisations
	readonly libelle: string
	readonly parametres: ParametresOrganisations
	readonly onParametres: (parametres: ParametresOrganisations) => void
	readonly alignementDroite?: boolean
}) {
	const actif = parametres.tri === cle
	const Icone = !actif ? ArrowUpDown : parametres.sens === 'asc' ? ArrowUp : ArrowDown
	return (
		<th
			scope="col"
			data-testid="entete-triable-organisations"
			data-cle={cle}
			aria-sort={actif ? (parametres.sens === 'asc' ? 'ascending' : 'descending') : 'none'}
			className={['bg-bg text-sm text-text-2 font-medium', alignementDroite ? 'text-right' : ''].join(' ')}
		>
			<button
				type="button"
				data-testid="tri-organisations"
				aria-label={t('liste.tri.aria', { colonne: libelle })}
				onClick={() =>
					onParametres({ ...parametres, tri: cle, sens: actif && parametres.sens === 'asc' ? 'desc' : 'asc' })
				}
				className={[
					'inline-flex items-center gap-2 w-full min-h-[var(--size-target)] px-3 hover:bg-hover',
					alignementDroite ? 'justify-end' : '',
				].join(' ')}
			>
				{libelle}
				<Icone aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
			</button>
		</th>
	)
}

/**
 * La barre (docs/DESIGN_SYSTEM.md §5.105) : « Rechercher » à la frappe, « Tracks » et son panneau dans le flux,
 * « Recettes », « Effacer les filtres ». Rien n'y attend un « Appliquer » : chaque requête est légère et paginée.
 * `CRM-161` T3.c (§5.115) : le bouton « Espace » après « Catégories », son panneau sous la barre comme les leurs ; un seul
 * des trois panneaux ouvert à la fois (§5.28) ; à partir de deux espaces dans la portée, les cases groupées par espace.
 */
function BarreFiltresOrganisations({
	parametres,
	tracks,
	onRechargerTracks,
	categories,
	onRechargerCategories,
	offrirEffacement,
	onParametres,
	onEffacer,
	filtreEspaces,
	groupes,
}: {
	readonly parametres: ParametresOrganisations
	readonly tracks: EtatAsync<readonly TrackDuFiltre[]>
	readonly onRechargerTracks: () => void
	readonly categories: EtatAsync<readonly CategorieDEspace[]>
	readonly onRechargerCategories: () => void
	readonly offrirEffacement: boolean
	readonly onParametres: (parametres: ParametresOrganisations) => void
	readonly onEffacer: () => void
	/** `CRM-161` T3.c : le filtre « Espace » de la page ; son bouton ne paraît qu'à partir de deux espaces lus. */
	readonly filtreEspaces: FiltreEspacesDePage
	/** Les espaces sous lesquels grouper les cases, à partir de deux dans la portée ; `null` : une seule grille. */
	readonly groupes: readonly Workspace[] | null
}) {
	const idRecherche = useId()
	const idAideRecherche = useId()
	const idRecettes = useId()
	const idPanneau = useId()
	const idPanneauCategories = useId()
	const boutonTracks = useRef<HTMLButtonElement>(null)
	const boutonCategories = useRef<HTMLButtonElement>(null)
	// UN SEUL PANNEAU OUVERT À LA FOIS (§5.28) : « Tracks » ou « Catégories » (`CRM-153` T4), ou « Espace » (`CRM-161` T3.c),
	// dont l'état est celui du filtre de la page. Ouvrir l'un replie les autres.
	const [panneau, setPanneau] = useState<'tracks' | 'categories' | null>(null)
	const panneauOuvert = panneau === 'tracks'
	const { ouvert: espacesOuvert, ouvrir: ouvrirEspaces } = filtreEspaces
	useEffect(() => {
		if (espacesOuvert) setPanneau(null)
	}, [espacesOuvert])
	const basculerPanneau = (voulu: 'tracks' | 'categories') => {
		ouvrirEspaces(false)
		setPanneau((ouvert) => (ouvert === voulu ? null : voulu))
	}
	const [saisie, setSaisie] = useState(parametres.recherche)
	const parametresCourants = useRef(parametres)
	parametresCourants.current = parametres
	// La dernière recherche que la saisie a écrite : une recherche qui change AUTREMENT — « Effacer les filtres », le
	// retour arrière — remet le champ à la valeur de l'adresse.
	const derniereEcrite = useRef(parametres.recherche)
	// LES CASES ET LE CHOIX DES RECETTES PORTENT UN ÉTAT LOCAL, qui suit l'adresse. *Trouvé par la preuve E2E* : le routeur
	// applique un changement d'adresse dans une transition (`startTransition`) ; un contrôle tenu par l'adresse seule était
	// remis à son ancienne valeur par React juste après le clic, le temps que la transition aboutisse — la case cochée se
	// décochait sous la souris.
	const [tracksCoches, setTracksCoches] = useState<readonly string[]>(parametres.tracks)
	const [categoriesCochees, setCategoriesCochees] = useState<readonly string[]>(parametres.categories)
	const cleCategories = parametres.categories.join(',')
	useEffect(() => {
		setCategoriesCochees(cleCategories === '' ? [] : cleCategories.split(','))
	}, [cleCategories])
	const [recettesChoisies, setRecettesChoisies] = useState<FiltreRecettes>(parametres.recettes)
	const cleTracks = parametres.tracks.join(',')
	useEffect(() => {
		setTracksCoches(cleTracks === '' ? [] : cleTracks.split(','))
	}, [cleTracks])
	useEffect(() => {
		setRecettesChoisies(parametres.recettes)
	}, [parametres.recettes])

	useEffect(() => {
		if (parametres.recherche === derniereEcrite.current) return
		derniereEcrite.current = parametres.recherche
		setSaisie(parametres.recherche)
	}, [parametres.recherche])

	useEffect(() => {
		const voulue = saisie.trim()
		if (voulue === parametresCourants.current.recherche) return
		const minuteur = window.setTimeout(() => {
			derniereEcrite.current = voulue
			onParametres({ ...parametresCourants.current, recherche: voulue })
		}, DELAI_RECHERCHE_MS)
		return () => window.clearTimeout(minuteur)
	}, [saisie, onParametres])

	const replier = () => {
		const bouton = panneau === 'categories' ? boutonCategories : boutonTracks
		setPanneau(null)
		bouton.current?.focus()
	}
	const surTouchePanneau = (evenement: KeyboardEvent<HTMLElement>) => {
		if (evenement.key !== 'Escape') return
		evenement.stopPropagation()
		replier()
	}
	const basculerTrack = (id: string, coche: boolean) => {
		const suivants = coche ? [...tracksCoches.filter((autre) => autre !== id), id] : tracksCoches.filter((autre) => autre !== id)
		setTracksCoches(suivants)
		onParametres({ ...parametresCourants.current, tracks: suivants })
	}
	const coches = tracksCoches.length
	const basculerCategorie = (id: string, cochee: boolean) => {
		const suivantes = cochee
			? [...categoriesCochees.filter((autre) => autre !== id), id]
			: categoriesCochees.filter((autre) => autre !== id)
		setCategoriesCochees(suivantes)
		onParametres({ ...parametresCourants.current, categories: suivantes })
	}
	// LE FILTRE N'EST RENDU QUE S'IL A UN OBJET (§5.107) : l'espace porte au moins une catégorie, ou l'adresse en filtre une,
	// qu'il faut pouvoir retirer. Pendant la lecture du catalogue, il attend ; en erreur, il est rendu, et son panneau le dit.
	const filtreCategories =
		parametres.categories.length > 0 ||
		categories.statut === 'erreur' ||
		(categories.statut === 'pret' && categories.donnees.length > 0)
	const cochees = categoriesCochees.length

	return (
		<div className="flex flex-col gap-3">
			<div
				role="group"
				data-testid="filtres-organisations"
				aria-label={t('organizations.filters.aria')}
				className="flex flex-col md:flex-row md:flex-wrap md:items-end gap-3 min-w-0"
			>
				<div className="flex flex-col gap-1 min-w-0">
					<label htmlFor={idRecherche} className="text-sm text-text-2">
						{t('organizations.filter.search')}
					</label>
					<input
						id={idRecherche}
						type="search"
						data-testid="recherche-organisations"
						aria-describedby={idAideRecherche}
						value={saisie}
						onChange={(evenement) => setSaisie(evenement.target.value)}
						className={CLASSES_CONTROLE}
					/>
					<span id={idAideRecherche} className="sr-only">
						{t('organizations.filter.search.help')}
					</span>
				</div>

				<Button
					ref={boutonTracks}
					data-testid="ouvrir-filtre-tracks"
					aria-expanded={panneauOuvert}
					aria-controls={idPanneau}
					onClick={() => basculerPanneau('tracks')}
					onKeyDown={(evenement) => {
						if (evenement.key === 'Escape' && panneauOuvert) replier()
					}}
				>
					{coches === 0 ? t('organizations.filter.tracks') : t('organizations.filter.tracks.count', { nombre: String(coches) })}
				</Button>

				{filtreCategories ? (
					<Button
						ref={boutonCategories}
						data-testid="ouvrir-filtre-categories"
						aria-expanded={panneau === 'categories'}
						aria-controls={idPanneauCategories}
						onClick={() => basculerPanneau('categories')}
						onKeyDown={(evenement) => {
							if (evenement.key === 'Escape' && panneau === 'categories') replier()
						}}
					>
						{cochees === 0
							? t('organizations.filter.categories')
							: t('organizations.filter.categories.count', { nombre: String(cochees) })}
					</Button>
				) : null}

				<BoutonFiltreEspaces filtre={filtreEspaces} />

				<div className="flex flex-col gap-1">
					<label htmlFor={idRecettes} className="text-sm text-text-2">
						{t('organizations.filter.revenues')}
					</label>
					<select
						id={idRecettes}
						data-testid="filtre-recettes-organisations"
						value={recettesChoisies}
						onChange={(evenement) => {
							const choisies = evenement.target.value as FiltreRecettes
							setRecettesChoisies(choisies)
							onParametres({ ...parametresCourants.current, recettes: choisies })
						}}
						className={CLASSES_CONTROLE}
					>
						<option value="toutes">{t('organizations.filter.revenues.all')}</option>
						<option value="avec">{t('organizations.filter.revenues.with')}</option>
						<option value="sans">{t('organizations.filter.revenues.without')}</option>
					</select>
				</div>

				{offrirEffacement ? (
					<Button variante="discret" data-testid="effacer-filtres-organisations" onClick={onEffacer}>
						{t('organizations.filter.clear')}
					</Button>
				) : null}
			</div>

			{panneauOuvert ? (
				<div
					id={idPanneau}
					data-testid="panneau-filtre-tracks"
					onKeyDown={surTouchePanneau}
					className="rounded-md border border-border bg-surface p-4"
				>
					<fieldset className="flex flex-col gap-2">
						<legend className="text-sm text-text-2 mb-2">{t('organizations.filter.tracks.legend')}</legend>
						{tracks.statut === 'chargement' ? (
							<p className="text-sm text-text-2">{t('organizations.filter.tracks.loading')}</p>
						) : tracks.statut === 'erreur' ? (
							<div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
								{t('organizations.filter.tracks.error')}
								<Button taille="compacte" variante="discret" onClick={onRechargerTracks}>
									{t('organizations.filter.tracks.retry')}
								</Button>
							</div>
						) : tracks.donnees.length === 0 ? (
							<p className="text-sm text-text-2">{t('organizations.filter.tracks.empty')}</p>
						) : (
							<CasesParEspace
								elements={tracks.donnees}
								groupes={groupes}
								espaceDe={(track) => track.workspace_id}
								rendre={(track) => (
									<label key={track.id} className="flex items-center gap-3 min-h-[var(--size-target)] cursor-pointer">
										<input
											type="checkbox"
											data-testid="case-filtre-track"
											data-slug={track.slug}
											checked={tracksCoches.includes(track.id)}
											onChange={(evenement) => basculerTrack(track.id, evenement.target.checked)}
											className="size-6 shrink-0 accent-brand"
										/>
										<span aria-hidden="true" className={`size-3 rounded-full shrink-0 ${classesPastille(track.color)}`} />
										<span className="truncate">{track.name}</span>
									</label>
								)}
							/>
						)}
					</fieldset>
				</div>
			) : null}

			{panneau === 'categories' ? (
				<div
					id={idPanneauCategories}
					data-testid="panneau-filtre-categories"
					onKeyDown={surTouchePanneau}
					className="rounded-md border border-border bg-surface p-4"
				>
					<fieldset className="flex flex-col gap-2">
						<legend className="text-sm text-text-2 mb-2">{t('organizations.filter.categories.legend')}</legend>
						{categories.statut === 'chargement' ? (
							<p className="text-sm text-text-2">{t('organizations.filter.categories.loading')}</p>
						) : categories.statut === 'erreur' ? (
							<div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
								{t('organizations.filter.categories.error')}
								<Button taille="compacte" variante="discret" onClick={onRechargerCategories}>
									{t('organizations.filter.tracks.retry')}
								</Button>
							</div>
						) : (
							// Les actives d'abord, puis les archivées, suffixées « (archivée) » : on retrouve les organisations d'une
							// catégorie qu'on vient d'archiver (§9.1). Le catalogue est déjà dans cet ordre.
							<CasesParEspace
								elements={categories.donnees}
								groupes={groupes}
								espaceDe={(categorie) => categorie.idEspace}
								rendre={(categorie) => (
									<label key={categorie.id} className="flex items-center gap-3 min-h-[var(--size-target)] cursor-pointer">
										<input
											type="checkbox"
											data-testid="case-filtre-categorie"
											data-categorie={categorie.id}
											checked={categoriesCochees.includes(categorie.id)}
											onChange={(evenement) => basculerCategorie(categorie.id, evenement.target.checked)}
											className="size-6 shrink-0 accent-brand"
										/>
										<span aria-hidden="true" className={`size-3 rounded-full shrink-0 ${classesPastille(categorie.couleur)}`} />
										<span className="truncate">
											{categorie.archivee
												? t('organizations.filter.categories.archived', { nom: categorie.nom })
												: categorie.nom}
										</span>
									</label>
								)}
							/>
						)}
					</fieldset>
				</div>
			) : null}

			<PanneauFiltreEspaces filtre={filtreEspaces} />
		</div>
	)
}

/** La grille des cases d'un panneau (§5.92). */
const CLASSES_GRILLE_CASES = 'grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]'

/**
 * `CRM-161` T3.c — les cases d'un filtre propre à un espace (§5.115) : une seule grille, ou, à partir de deux espaces dans
 * la portée, une `fieldset` par espace qui a des cases, sous une sous-légende à son nom (`text-sm` `--color-text-2`), dans
 * l'ordre du menu. Deux homonymes de deux espaces restent deux cases.
 */
function CasesParEspace<T>({
	elements,
	groupes,
	espaceDe,
	rendre,
}: {
	readonly elements: readonly T[]
	readonly groupes: readonly Workspace[] | null
	readonly espaceDe: (element: T) => string
	readonly rendre: (element: T) => ReactNode
}) {
	if (groupes === null) return <div className={CLASSES_GRILLE_CASES}>{elements.map(rendre)}</div>
	const parEspace: readonly GroupeDEspace<T>[] = grouperParEspace(elements, groupes, espaceDe)
	return (
		<div className="flex flex-col gap-3">
			{parEspace.map((groupe) => (
				<fieldset key={groupe.espace.id} data-testid="groupe-cases-espace" data-slug={groupe.espace.slug} className="flex flex-col gap-2">
					<legend className="text-sm text-text-2 mb-1">{groupe.espace.name}</legend>
					<div className={CLASSES_GRILLE_CASES}>{groupe.elements.map(rendre)}</div>
				</fieldset>
			))}
		</div>
	)
}

/** Le plafond de la ligne des catégories sous le nom (§5.107, la règle de la carte du board, §5.73). */
const PLAFOND_CATEGORIES = 3

/**
 * `CRM-153` T4 — les catégories SOUS LE NOM (décision 942) : trois pilules au plus, dans l'ordre du catalogue, puis une
 * pilule neutre « +n » dont le nom accessible et l'infobulle énumèrent les autres. Aucune catégorie : rien n'est rendu.
 */
function CategoriesSousNom({ categories }: { readonly categories: readonly CategorieOrganisation[] }) {
	if (categories.length === 0) return null
	const visibles = categories.slice(0, PLAFOND_CATEGORIES)
	const masquees = categories.slice(PLAFOND_CATEGORIES)
	const reste = masquees.map((categorie) => categorie.nom).join(', ')
	return (
		<ul data-testid="categories-sous-nom" aria-label={t('organizations.categories.aria')} className="flex flex-wrap gap-1 min-w-0 pb-1">
			{visibles.map((categorie) => (
				<li key={categorie.id} className="min-w-0">
					<PastilleEtiquette
						etiquette={categorie}
						{...(categorie.archivee ? { nomAccessible: t('orgCategories.pill.archived', { nom: categorie.nom }) } : {})}
					/>
				</li>
			))}
			{masquees.length === 0 ? null : (
				<li>
					<PastilleReste
						n={masquees.length}
						noms={reste}
						// L'accord se fait par clé (§10) : « 1 autres catégories » est faux.
						nomAccessible={
							masquees.length === 1
								? t('organizations.categories.more.aria.one', { noms: reste })
								: t('organizations.categories.more.aria', { n: String(masquees.length), noms: reste })
						}
					/>
				</li>
			)}
		</ul>
	)
}
