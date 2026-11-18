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

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
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
	sansFiltresOrganisations,
	type FiltreRecettes,
	type OrganisationListee,
	type ParametresOrganisations,
	type TriOrganisations,
} from '../lib/organisations'
import { lireTotauxOrganisations, type TotauxParOrganisation } from '../lib/recettes-organisation'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useTracks, type Track } from '../lib/tracks'
import { useWorkspaces } from '../lib/workspaces'
import { cheminOrganisation } from './chemins'
import { AppShell } from './AppShell'
import { useContexteEspace } from './ContexteEspace'
import { FormulaireOrganisation } from './FormulaireOrganisation'
import { OngletsCarnet } from './OngletsCarnet'
import { classesPastille } from './presentation-tracks'
import { AUCUN_TOTAL, ReelSurPrevu } from './RecettesOrganisation'

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
}

/** L'état de « Afficher plus » : au repos, en lecture, ou en échec (écrit sous lui, avec « Réessayer »). */
type EtatPlus = 'repos' | 'chargement' | 'erreur'

export function ListeOrganisations({ client = clientCrm }: { readonly client?: ClientCrm | null } = {}) {
	const { capacites } = useContexteEspace()
	const navigate = useNavigate()
	const espaces = useWorkspaces(client)
	const tracksEspace = useTracks(client)
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

	const idWorkspace = espaces.etat.statut === 'pret' ? (espaces.etat.donnees[0]?.id ?? null) : null
	const cleParametres = JSON.stringify(parametres)

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
		if (client === null || idWorkspace === null) return
		const rang = ++courant.current
		const premiere = totauxLus.current === null
		if (premiere) setEtat(enChargement())
		else setRelecture(true)
		setPlus('repos')
		void (async () => {
			const [page, totaux] = await Promise.all([
				lirePageOrganisations(client, idWorkspace, parametresCourants.current, 0),
				totauxLus.current === null ? lireTotauxOrganisations(client) : Promise.resolve(pret(totauxLus.current)),
			])
			if (rang !== courant.current) return
			setRelecture(false)
			if (page.statut === 'erreur') return setEtat(enErreur(page.erreur))
			if (totaux.statut === 'erreur') return setEtat(enErreur(totaux.erreur))
			if (page.statut !== 'pret' || totaux.statut !== 'pret') return
			totauxLus.current = totaux.donnees
			setEtat(pret({ organisations: page.donnees.organisations, total: page.donnees.total, totaux: totaux.donnees }))
		})()
	}, [client, idWorkspace, cleParametres, tentative])

	// UN TRACK INCONNU DE L'ADRESSE EST REPLIÉ (§8.3) : une fois les tracks de l'espace lus, un identifiant qui n'en est pas
	// un quitte l'adresse plutôt que de vider la liste sans raison visible.
	useEffect(() => {
		if (tracksEspace.etat.statut !== 'pret' || parametres.tracks.length === 0) return
		const connus = new Set(tracksEspace.etat.donnees.map((track) => track.id))
		const gardes = parametres.tracks.filter((id) => connus.has(id))
		if (gardes.length !== parametres.tracks.length) changer({ ...parametres, tracks: gardes })
	}, [tracksEspace.etat, parametres, changer])

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
		if (client === null || idWorkspace === null || etat.statut !== 'pret') return
		const rang = courant.current
		const deja = etat.donnees.organisations.length
		setPlus('chargement')
		const page = await lirePageOrganisations(client, idWorkspace, parametresCourants.current, deja)
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
	}, [client, idWorkspace, etat])

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
	const geste =
		idWorkspace === null ? null : ouvert ? (
			<FormulaireOrganisation
				prefixe="organisation-nouvelle"
				titre={t('organizations.creation.title')}
				saisieInitiale={SAISIE_ORGANISATION_VIDE}
				libelleEnvoi={t('organizations.creation.submit')}
				libelleEnvoiEnCours={t('organizations.creation.pending')}
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
			</>
		)

	const { organisations, total, totaux } = etat.donnees
	const filtre = filtresOrganisationsPoses(parametres)
	// LE VIDE DE L'ESPACE (§5.64) N'EST PAS LE VIDE SOUS LES FILTRES : le premier n'a ni barre ni tableau ; le second garde
	// la barre, cause de l'état, et porte « Effacer les filtres » — jamais en double avec celui de la barre.
	const videEspace = total === 0 && !filtre
	const videFiltre = total === 0 && filtre
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
						tracks={tracksEspace.etat}
						onRechargerTracks={tracksEspace.recharger}
						offrirEffacement={filtre && !videFiltre}
						onParametres={changer}
						onEffacer={effacer}
					/>
					{videFiltre ? (
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
									<colgroup>
										<col className="w-[17%]" />
										<col className="w-[17%]" />
										<col className="w-[25%]" />
										<col className="w-[12%]" />
										<col className="w-[29%]" />
									</colgroup>
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
										</tr>
									</thead>
									<tbody>
										{organisations.map((organisation) => {
											const noms = organisation.tracks.map((track) => track.name).join(' · ')
											return (
												<tr key={organisation.id} data-testid="ligne-organisation" data-organisation={organisation.id} className="border-b border-border hover:bg-hover">
													<td className={CLASSES_CELLULE} title={organisation.name}>
														<Link to={cheminOrganisation(organisation.id)} className="text-brand hover:underline" data-testid="lien-fiche-organisation">
															{organisation.name}
														</Link>
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
 */
function BarreFiltresOrganisations({
	parametres,
	tracks,
	onRechargerTracks,
	offrirEffacement,
	onParametres,
	onEffacer,
}: {
	readonly parametres: ParametresOrganisations
	readonly tracks: EtatAsync<readonly Track[]>
	readonly onRechargerTracks: () => void
	readonly offrirEffacement: boolean
	readonly onParametres: (parametres: ParametresOrganisations) => void
	readonly onEffacer: () => void
}) {
	const idRecherche = useId()
	const idAideRecherche = useId()
	const idRecettes = useId()
	const idPanneau = useId()
	const boutonTracks = useRef<HTMLButtonElement>(null)
	const [panneauOuvert, setPanneauOuvert] = useState(false)
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
		setPanneauOuvert(false)
		boutonTracks.current?.focus()
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
					onClick={() => setPanneauOuvert((ouvert) => !ouvert)}
					onKeyDown={(evenement) => {
						if (evenement.key === 'Escape' && panneauOuvert) replier()
					}}
				>
					{coches === 0 ? t('organizations.filter.tracks') : t('organizations.filter.tracks.count', { nombre: String(coches) })}
				</Button>

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
							<div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
								{tracks.donnees.map((track) => (
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
								))}
							</div>
						)}
					</fieldset>
				</div>
			) : null}
		</div>
	)
}
