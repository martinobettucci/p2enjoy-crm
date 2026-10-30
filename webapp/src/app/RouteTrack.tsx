// @spec CRM-071 (docs/BACKLOG.md) — tranche T6 : la vue liste monte « Importer un fichier » et son panneau, exclusif du
//       formulaire de création, puis relit la liste sans chargement (docs/DESIGN_SYSTEM.md §5.78)
// @spec CRM-071 (docs/BACKLOG.md) — tranches T2 et T4 : la vue liste monte les vues sauvegardées du channel et l'export CSV
//       de ce que ses filtres retiennent (docs/DESIGN_SYSTEM.md §5.75, §5.76)
// @spec CRM-069 (docs/BACKLOG.md) — tranche T2 : la liste reçoit le catalogue d'étiquettes pour son filtre (docs/DESIGN_SYSTEM.md §5.73)
// @spec CRM-093 (docs/BACKLOG.md) tranche T4 — le board et la liste lisent la capacité d'écrire sur le channel et la
//       fournissent à leurs commandes (docs/SPEC-droits-interface.md §2.1, §3 ; docs/DESIGN_SYSTEM.md §5.59)
// @spec CRM-021 (docs/BACKLOG.md) — route d'un track : ses onglets et le contenu d'un channel
// @spec CRM-041 (docs/BACKLOG.md) — le board d'un channel ouvert
// @spec CRM-042 (docs/BACKLOG.md) — la vue liste du même channel, seconde lecture du même contenu
// @spec docs/SPEC-channels.md §5.1 (route d'un track), §5.3 (barre d'onglets), §1.2 (hors périmètre)
// @spec docs/SPEC-workflow-engine.md §7.2 (ce que le board lit), §7.11 (états systématiques)
// @spec docs/SPEC-cards.md §12.2 (l'adresse porte tout), §12.3 (ce que la liste lit), §12.9 (états)
// @spec docs/DESIGN_SYSTEM.md §4 (architecture), §5.8 (états explicites), §10 (libellés métier)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
// @spec CRM-095 (docs/BACKLOG.md) — tranche T2 : « Nouvelle affaire » dans la vue liste, dont l'état vit
//       dans sa zone (docs/SPEC-cards.md §18.3, docs/DESIGN_SYSTEM.md §5.50) ; tranche T2 bis : les
//       états vides « aucun channel » et « aucune étape » mènent à l'écran qui les comble (INC-258,
//       décision 611 ; docs/SPEC-cards.md §18.4 bis, docs/DESIGN_SYSTEM.md §5.51)
// @spec CRM-100 (docs/BACKLOG.md) tranche T1 — « Nouveau channel » dans la vue du track : le formulaire ouvert par
//       `nouveau-channel=1`, en tête de la zone principale ; après la création, le board du nouveau channel, les
//       channels relus, l'annonce et le focus sur son onglet ; refermé, le focus rendu à la commande ; l'état vide
//       « aucun channel » sans lien (docs/SPEC-administration-arborescence.md §13.3, §13.6 ; docs/DESIGN_SYSTEM.md
//       §5.51, §5.55 ; docs/JOURNAL.md décision 623)
// @spec CRM-110 (docs/BACKLOG.md) tranche T2 — le fil d'Ariane : sur un channel ouvert, le track le précède et le
//       titre est le nom du channel ; sans channel lu, le titre reste le nom du track (docs/SPEC-webapp.md §5.1 bis)
//
// La destination que `CRM-020` avait annoncée sans pouvoir la livrer : « un track s'ouvre sur ses
// channels, livrés par `CRM-021` » (docs/DESIGN_SYSTEM.md §12.4).
//
// Quatre issues, toutes explicites, aucune page blanche :
//
//   * track trouvé, channel choisi     → le **board** de ce channel (`CRM-041`), ou sa **vue
//     liste** (`CRM-042`) lorsque l'adresse porte le segment `/liste` ;
//   * track trouvé, aucun channel      → l'état vide de la barre d'onglets ;
//   * track trouvé, aucun channel ouvert → l'invitation à en choisir un ;
//   * aucun track pour ce slug         → « track introuvable », avec un retour vers l'accueil.
//
// La dernière n'est pas hypothétique : un appelant anonyme ou privé du track n'obtient aucune
// ligne. C'est le refus réel du backend, mesuré (docs/SPEC-channels.md §7, ligne b), et non un
// défaut d'interface. Une session consentie atteint au contraire le board réel.
//
// Un slug refusé et un slug inexistant produisent le **même** écran, délibérément : les
// distinguer renseignerait un appelant sans droit sur l'existence d'un track
// (docs/SPEC-permissions-rls.md §7).

import { lireEtiquettes, type Etiquette } from '../lib/etiquettes'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { composerBoard, useContenuBoard, type CardBoard, type EtapeBoard } from '../lib/board'
import { projeterChannels, useContenuTrack, type Channel, type TrackOuvert } from '../lib/channels'
import { ancetresChannel } from '../lib/fil-ariane'
import { PARAM_NOUVEAU_CHANNEL, VALEUR_NOUVEAU_CHANNEL_TRACK } from '../lib/nouveau-channel'
import {
	CLE_URL_SOMMEIL,
	MODE_SOMMEIL_PAR_DEFAUT,
	VALEUR_URL_SOMMEIL_VISIBLES,
	bornerPage,
	ecrireParametres,
	lireModeSommeil,
	lireParametres,
	useEtapesChannel,
	usePageCards,
	type CardListe as CardListeRendue,
	type ModeSommeil,
	type ParametresListe,
} from '../lib/liste-cards'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'
import { Board } from './Board'
import { CHEMIN_ADMIN_WORKFLOWS } from './chemins'
import { BasculeVue, ListeCards } from './ListeCards'
import { CommandesVues, PanneauVue, useVuesSauvegardees } from './VuesSauvegardees'
import { CommandeExportCsv, type FichierPrepare } from './ExportCsv'
import { CommandeImportAffaires, PanneauImport } from './ImportCsv'
import { csvAffaires, dateDuJour, exporterAffaires } from '../lib/export-csv'
import { filtresDepuisParametres } from '../lib/vues-sauvegardees'
import { ZoneNouveauChannel } from './NouveauChannelTrack'
import { CommandeNouvelleAffaire, FormulaireNouvelleAffaire, useCreationAffaire } from './NouvelleAffaire'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { motifVisible, proprietesCommande, useEcriturePermise } from '../lib/capacites'

/** Le motif d'un channel, cité par ses commandes quand la base refuse d'y écrire (CRM-093). */
const ID_MOTIF_CHANNEL = 'channel-lecture-seule'

/** Les deux lectures d'un même channel. Le board est la vue par défaut (docs/SPEC-cards.md §12.2). */
export type VueChannel = 'board' | 'liste'

/** Classes du lien de retour, identiques à celles de `PageIntrouvable` (docs/DESIGN_SYSTEM.md §5.5). */
const CLASSES_RETOUR = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
].join(' ')

/**
 * Repli du titre de l'en-tête. Le nom du track le remplace dès qu'il est connu ; il sert donc
 * pendant le chargement et lorsque le track est introuvable — l'en-tête n'est jamais sans titre.
 *
 * Déclarée comme constante et non écrite dans le JSX : le contrôle de clés mortes de
 * `webapp/src/i18n/i18n.test.ts` cherche les clés citées entre apostrophes, et un attribut JSX
 * entre guillemets lui échapperait. Le contrôle a réellement signalé cette clé comme morte.
 */
const CLE_TITRE_TRACK: CleTraduction = 'route.track.title'

export function RouteTrack({ vue = 'board' }: { readonly vue?: VueChannel } = {}) {
	const { slugTrack, slugChannel } = useParams()
	const { etat, recharger } = useContenuTrack(clientCrm, slugTrack)

	const track = etat.statut === 'pret' ? etat.donnees.track : null
	const channels = etat.statut === 'pret' ? etat.donnees.channels : []
	// La projection vit dans `webapp/src/lib/channels.ts` depuis que la route d'une card la fait
	// elle aussi (décision 167) : recopiée, elle aurait fini par diverger.
	const etatChannels = projeterChannels(etat)

	// Le channel courant est **résolu dans la liste déjà chargée**, sans aucune requête : la
	// coquille la rapporte pour la barre d'onglets, et `workflow_id` y a rejoint les colonnes lues
	// (docs/SPEC-channels.md §5, décision 169).
	const channelOuvert = channels.find((channel) => channel.slug === slugChannel)

	// `CRM-100` (§13.3) — ce qui survit au formulaire « Nouveau channel » : l'annonce, et le focus à poser APRÈS le
	// rendu qui le referme. La commande de la barre d'onglets ne reparaît qu'une fois les paramètres retirés, l'onglet
	// du channel créé qu'une fois les channels relus : le focus attend l'un ou l'autre, sans temporisation.
	const navigate = useNavigate()
	const { key: cleAdresse } = useLocation()
	const [annonce, setAnnonce] = useState('')
	const [focusApres, setFocusApres] = useState<
		{ readonly cible: 'commande' } | { readonly cible: 'onglet'; readonly slug: string } | null
	>(null)
	useEffect(() => {
		if (focusApres === null) return
		const selecteur =
			focusApres.cible === 'commande'
				? '[data-testid="commande-nouveau-channel"]'
				: `[data-testid="onglet-channel"][data-slug="${focusApres.slug}"]`
		const cible = document.querySelector<HTMLElement>(selecteur)
		if (cible === null) return
		cible.focus()
		setFocusApres(null)
	}, [focusApres, etat, cleAdresse])

	const apresCreation = useCallback(
		(slug: string, nom: string) => {
			if (slugTrack === undefined) return
			navigate(`/tracks/${slugTrack}/${slug}`)
			recharger()
			setAnnonce(t('live.track.channel.created', { nom }))
			setFocusApres({ cible: 'onglet', slug })
		},
		[navigate, recharger, slugTrack],
	)
	const apresFermeture = useCallback(() => setFocusApres({ cible: 'commande' }), [])

	// Le titre est l'objet le plus profond que la route a lu : le channel ouvert, sinon le track (§5.1 bis).
	const titre = channelOuvert?.name ?? track?.name

	return (
		<AppShell
			cleTitreRoute={CLE_TITRE_TRACK}
			{...(titre === undefined ? {} : { titreRoute: titre })}
			ancetres={ancetresChannel(track, channelOuvert)}
			etatChannels={etatChannels}
			onRechargerChannels={recharger}
			{...(slugTrack === undefined ? {} : { slugTrack })}
		>
			<LiveRegion libelle={t('live.admin.aria')} message={annonce} />
			<ContenuTrack
				chargement={etat.statut === 'chargement'}
				track={track}
				onChannelCree={apresCreation}
				onFormulaireFerme={apresFermeture}
				nombreChannels={channels.length}
				vue={vue}
				channelDemande={slugChannel}
				{...(channelOuvert === undefined ? {} : { channelOuvert })}
				{...(slugTrack === undefined ? {} : { slugTrack })}
			/>
		</AppShell>
	)
}

function ContenuTrack({
	chargement,
	track,
	onChannelCree,
	onFormulaireFerme,
	nombreChannels,
	channelDemande,
	vue,
	channelOuvert,
	slugTrack,
}: {
	readonly chargement: boolean
	readonly track: TrackOuvert | null
	readonly onChannelCree: (slug: string, nom: string) => void
	readonly onFormulaireFerme: () => void
	readonly nombreChannels: number
	readonly channelDemande: string | undefined
	readonly vue: VueChannel
	readonly channelOuvert?: Channel
	readonly slugTrack?: string
}) {
	// Lu ici, et non passé par une propriété : l'adresse est la source du mode du sommeil (§16.12.4),
	// et la bascule de vue rendue ci-dessous est le seul élément de ce composant qui le transporte.
	const [parametresVue] = useSearchParams()

	// Pendant le chargement, la zone principale ne montre rien plutôt qu'un « introuvable »
	// prématuré : annoncer l'absence avant d'avoir la réponse serait une valeur par défaut
	// trompeuse (CLAUDE.md §18). Les squelettes vivent là où la donnée est attendue — barre
	// latérale et barre d'onglets.
	if (chargement) return null

	if (track === null) {
		return (
			<EtatVide
				titre={t('route.track.notfound.title')}
				corps={t('route.track.notfound.body')}
				action={
					<Link to="/" className={CLASSES_RETOUR}>
						{t('route.notfound.action')}
					</Link>
				}
			/>
		)
	}

	// `CRM-100` (§13.3) : le formulaire « Nouveau channel » est un état de l'ADRESSE. Il vient en tête de la zone
	// principale, au-dessus de ce que la vue rend d'ordinaire.
	const nouveauChannel =
		// Sans client configuré, la route n'a de toute façon rien lu : `track` est alors nul et l'on n'arrive pas ici.
		parametresVue.get(PARAM_NOUVEAU_CHANNEL) === VALEUR_NOUVEAU_CHANNEL_TRACK && clientCrm !== null ? (
			<ZoneNouveauChannel client={clientCrm} track={track} onCree={onChannelCree} onFerme={onFormulaireFerme} />
		) : null

	if (nombreChannels === 0) {
		// UN ÉTAT VIDE NOMME LE GESTE QUI LE COMBLE (INC-258, docs/DESIGN_SYSTEM.md §5.51). Depuis `CRM-100`, « Nouveau
		// channel » vit dans la barre d'onglets de ce track : le geste étant sur l'écran même, le texte le nomme et
		// aucun lien n'est ajouté (§5.51, deuxième règle). Le formulaire ouvert remplace l'état vide (§5.55).
		return (
			nouveauChannel ?? (
				<EtatVide titre={t('route.track.nochannel.title')} corps={t('route.track.nochannel.body')} />
			)
		)
	}

	if (channelDemande === undefined) {
		return (
			<>
				{nouveauChannel}
				<EtatVide titre={t('route.track.pickchannel.title')} corps={t('route.track.pickchannel.body')} />
			</>
		)
	}

	// L'adresse nomme un channel que le track ne porte pas — ou que l'appelant n'a pas le droit de
	// lire. Le même écran que « choisissez un channel » : distinguer les deux renseignerait sur
	// l'existence d'un channel refusé (docs/SPEC-permissions-rls.md §7).
	if (channelOuvert === undefined || slugTrack === undefined) {
		return (
			<>
				{nouveauChannel}
				<EtatVide titre={t('route.track.pickchannel.title')} corps={t('route.track.pickchannel.body')} />
			</>
		)
	}

	// La bascule est **au-dessus** de la zone, et non dans l'une des deux vues : elle doit rester
	// atteignable pendant le chargement, sur un état vide et sur un état d'erreur — l'utilisateur
	// dont la liste échoue doit pouvoir revenir au board sans retaper une adresse
	// (docs/DESIGN_SYSTEM.md §5.8, docs/SPEC-cards.md §12.8).
	return (
		<div className="flex flex-col min-w-0">
			{nouveauChannel}
			<div className="px-4 pt-4">
				{/* Le mode du sommeil est lu ICI, au-dessus des deux zones, parce que c'est ici que la
				    bascule de vue le transporte (§16.12.4). Chaque zone le relit de l'adresse pour son
				    propre compte : l'adresse est la seule source, et un état partagé la doublerait. */}
				<BasculeVue
					slugTrack={slugTrack}
					slugChannel={channelOuvert.slug}
					vue={vue}
					modeSommeil={lireModeSommeil(parametresVue.get(CLE_URL_SOMMEIL))}
				/>
			</div>
			<DroitChannel idChannel={channelOuvert.id}>
				{vue === 'liste' ? (
					<ZoneListe channel={channelOuvert} slugTrack={slugTrack} />
				) : (
					<ZoneBoard channel={channelOuvert} slugTrack={slugTrack} />
				)}
			</DroitChannel>
		</div>
	)
}

/**
 * Le board d'un channel ouvert — `CRM-041`, `docs/SPEC-workflow-engine.md` §7.
 *
 * Les cards affichées sont détenues **ici** et non dans `Board` : le déplacement optimiste et son
 * retour arrière remplacent la liste entière (§7.9), et un état interne au board serait
 * réinitialisé à chaque rechargement du contenu.
 */
/**
 * `CRM-093` — LA CAPACITÉ D'ÉCRIRE SUR LE CHANNEL, rendue par la base sur sa ligne (docs/SPEC-droits-interface.md
 * §2.1), lue à part du board et de la liste : un défaut de lecture n'efface que l'aide d'interface (§4). Refusée, le
 * motif se pose une fois en tête de la vue, et chaque commande d'écriture du board ou de la liste le cite (§5.59).
 */
function DroitChannel({ idChannel, children }: { readonly idChannel: string; readonly children: ReactNode }) {
	const capacite = useEcriturePermise(clientCrm, 'channels', idChannel)
	return (
		<FournisseurRefus valeur={proprietesCommande(capacite, ID_MOTIF_CHANNEL)}>
			{motifVisible(capacite) ? (
				<div className="px-4 pt-4">
					<MotifLectureSeule id={ID_MOTIF_CHANNEL}>{t('rights.readonly.channel')}</MotifLectureSeule>
				</div>
			) : null}
			{children}
		</FournisseurRefus>
	)
}

function ZoneBoard({ channel, slugTrack }: { readonly channel: Channel; readonly slugTrack: string }) {
	const { etat, recharger } = useContenuBoard(
		clientCrm,
		channel.id,
		channel.workflow_id ?? undefined,
	)
	const [cards, setCards] = useState<readonly CardBoard[]>([])
	// LE BOARD LIT LUI AUSSI L'ADRESSE DEPUIS LA TRANCHE 2 b DE `CRM-081` (§16.12.4) : c'est le même
	// paramètre `sommeil` que la vue liste, et c'est ce qui fait que la bascule board ↔ liste le
	// conserve sans que personne n'ait à le recopier. Il était jusqu'ici le seul des deux écrans à
	// n'avoir aucun paramètre.
	const [parametresUrl, setParametresUrl] = useSearchParams()
	const modeSommeil = lireModeSommeil(parametresUrl.get(CLE_URL_SOMMEIL))
	const changerSommeil = (mode: ModeSommeil) => {
		const suivants = new URLSearchParams(parametresUrl)
		// Le défaut ne s'écrit jamais dans l'adresse (§16.12.4) : la vue par défaut reste l'adresse la
		// plus courte. Les autres paramètres éventuels sont conservés — celui-ci est le seul que ce
		// geste concerne.
		if (mode === 'visibles') suivants.set(CLE_URL_SOMMEIL, VALEUR_URL_SOMMEIL_VISIBLES)
		else suivants.delete(CLE_URL_SOMMEIL)
		setParametresUrl(suivants)
	}

	useEffect(() => {
		if (etat.statut === 'pret') setCards(etat.donnees.cards)
	}, [etat])

	// Un channel sans workflow n'a pas d'étapes, donc pas de board : le risque est nommé au §6 de
	// `docs/SPEC-channels.md`. La colonne est `NOT NULL` en base depuis `CRM-033` ; elle peut
	// néanmoins arriver nulle ici si la politique de lecture du channel la consent sans consentir
	// le workflow. L'écran le dit plutôt que de rendre un board sans colonne.
	if (channel.workflow_id === null) {
		return (
			<EtatVide
				titre={t('route.channel.noworkflow.title')}
				corps={t('route.channel.noworkflow.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return (
			<div className="px-4 py-6">
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			</div>
		)
	}

	if (etat.statut === 'erreur') {
		if (etat.erreur.nature === 'forbidden') {
			return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
		}
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	if (etat.donnees.etapes.length === 0) {
		// INC-258 (docs/DESIGN_SYSTEM.md §5.51) : les étapes s'ajoutent dans l'éditeur de workflows.
		return (
			<EtatVide
				titre={t('route.channel.nostep.title')}
				corps={t('route.channel.nostep.body')}
				action={
					<Link to={CHEMIN_ADMIN_WORKFLOWS} data-testid="lien-editeur-vide" className={CLASSES_RETOUR}>
						{t('route.channel.nostep.action')}
					</Link>
				}
			/>
		)
	}

	const modele = composerBoard({
		etapes: etat.donnees.etapes,
		cards,
		transitions: etat.donnees.transitions,
		maintenant: new Date(),
		modeSommeil,
	})

	if (modele.nombreCards === 0) {
		// L'ÉTAT VIDE CESSE DE MENTIR (§16.12.6). Le défaut masque les affaires en sommeil : un board
		// sans carte n'est donc plus la preuve d'un channel sans affaire. Le board, lui, SAIT combien
		// il en masque — il a lu toutes les cards actives du channel —, et il l'affirme sans émettre
		// une requête de plus. L'action qui lève le vide accompagne le message, et elle n'est alors
		// pas répétée : la barre de bascule reste rendue en dessous, ce qui est le patron du §5.8.
		const masquees = modele.nombreEnSommeilMasquees > 0
		return (
			<div className="flex flex-col gap-4 px-4 py-6">
				<EtatVide
					titre={t(masquees ? 'route.channel.empty.sommeil.title' : 'route.channel.empty.title')}
					corps={t(masquees ? 'route.channel.empty.sommeil.body' : 'route.channel.empty.body')}
					{...(masquees
						? {
								action: (
									<button
										type="button"
										data-testid="afficher-sommeil-vide"
										onClick={() => changerSommeil('visibles')}
										className={CLASSES_RETOUR}
									>
										{t('sommeil.afficher')}
									</button>
								),
							}
						: {})}
				/>
				<BoardRendu
					modele={modele}
					cards={cards}
					onCards={setCards}
					libelles={etat.donnees.libellesChamps}
					idChannel={channel.id}
					slugTrack={slugTrack}
					slugChannel={channel.slug}
					modeSommeil={modeSommeil}
					onModeSommeil={changerSommeil}
				/>
			</div>
		)
	}

	return (
		<div className="px-4 py-6 min-w-0">
			<BoardRendu
				modele={modele}
				cards={cards}
				onCards={setCards}
				libelles={etat.donnees.libellesChamps}
				idChannel={channel.id}
				slugTrack={slugTrack}
				slugChannel={channel.slug}
				modeSommeil={modeSommeil}
				onModeSommeil={changerSommeil}
			/>
		</div>
	)
}

/** Petit adaptateur : il évite de répéter six propriétés entre les deux issues ci-dessus. */
function BoardRendu({
	modele,
	cards,
	onCards,
	libelles,
	idChannel,
	slugTrack,
	slugChannel,
	modeSommeil,
	onModeSommeil,
}: {
	readonly modele: ReturnType<typeof composerBoard>
	readonly cards: readonly CardBoard[]
	readonly onCards: (cards: readonly CardBoard[]) => void
	readonly libelles: ReadonlyMap<string, string>
	/** Le channel du board, où naît une affaire créée (`CRM-095`, docs/SPEC-cards.md §18.2). */
	readonly idChannel: string
	readonly slugTrack: string
	readonly slugChannel: string
	readonly modeSommeil: ModeSommeil
	readonly onModeSommeil: (mode: ModeSommeil) => void
}) {
	return (
		<Board
			modele={modele}
			cards={cards}
			onCards={onCards}
			libellesChamps={libelles}
			client={clientCrm}
			idChannel={idChannel}
			slugTrack={slugTrack}
			slugChannel={slugChannel}
			modeSommeil={modeSommeil}
			onModeSommeil={onModeSommeil}
		/>
	)
}

/** `CRM-071` T4 (§5.76) : toutes les affaires que les filtres de l'écran retiennent, dans l'ordre de la liste, en CSV. */
async function preparerExportAffaires(
	client: ClientCrm,
	channel: Channel,
	parametres: ParametresListe,
): Promise<FichierPrepare> {
	const issue = await exporterAffaires(client, channel.id, filtresDepuisParametres(parametres))
	if (issue.statut === 'refus') {
		return {
			refus:
				issue.nature === 'trop-grand'
					? 'export.refus.affaires.tropGrand'
					: issue.nature === 'introuvable'
						? 'export.refus.introuvable'
						: 'export.refus.panne',
		}
	}
	return { nom: `affaires-${channel.slug}-${dateDuJour()}.csv`, contenu: csvAffaires(issue.lignes, window.location.origin) }
}

/**
 * La vue liste d'un channel ouvert — `CRM-042`, `docs/SPEC-cards.md` §12.
 *
 * Les paramètres sont détenus par **l'adresse** (§12.2) : `useSearchParams` les lit, et toute
 * modification les y réécrit. Aucun état local ne les double — un état local et une adresse qui
 * décrivent la même chose finissent par se contredire, et c'est l'adresse qui est partagée.
 *
 * Le rang de page est **borné** par le dernier total connu avant d'être envoyé (§12.6, règle 1) :
 * une adresse portant `page=99` sur un channel d'une page ouvre la page 1 sans aller chercher une
 * page que la première réponse suffit à écarter.
 */
function ZoneListe({ channel, slugTrack }: { readonly channel: Channel; readonly slugTrack: string }) {
	// L'ÉTAT DU GESTE DE CRÉATION VIT ICI, et non dans `ListeCards` (`CRM-095`, §5.50) : le tableau rend,
	// il n'écrit pas — il reçoit la commande et le formulaire, et les place.
	const creation = useCreationAffaire()
	// `CRM-071` T2 (§5.75) : les vues sauvegardées du channel, leur panneau et leurs annonces.
	const vues = useVuesSauvegardees(clientCrm, channel.id)
	const clientExport = clientCrm
	// `CRM-071` T6 (§5.78) : le panneau d'import, exclusif du formulaire de création, et le focus rendu à sa commande.
	const [importOuvert, setImportOuvert] = useState(false)
	const [rendreFocusImport, setRendreFocusImport] = useState(false)
	const commandeImport = useRef<HTMLButtonElement | null>(null)
	useEffect(() => {
		if (!rendreFocusImport) return
		setRendreFocusImport(false)
		commandeImport.current?.focus()
	}, [rendreFocusImport])
	const [parametresUrl, setParametresUrl] = useSearchParams()
	const demandes = lireParametres(parametresUrl)
	const workflowId = channel.workflow_id ?? undefined
	const etapes = useEtapesChannel(clientCrm, workflowId)
	const [pageBornee, setPageBornee] = useState<number | null>(null)
	const parametres: ParametresListe = {
		...demandes,
		page: pageBornee ?? demandes.page,
	}
	const { etat, total, recharger, relireDiscretement } = usePageCards(clientCrm, channel.id, parametres)
	// `CRM-069` T2 (docs/DESIGN_SYSTEM.md §5.73) : les étiquettes non archivées de l'espace, que le filtre propose. Une
	// lecture en panne laisse le filtre absent : la liste ne dépend pas d'elle.
	const [catalogueEtiquettes, setCatalogueEtiquettes] = useState<readonly Etiquette[]>([])
	useEffect(() => {
		if (clientCrm === null) return
		let actif = true
		void lireEtiquettes(clientCrm).then((lu) => {
			if (actif && lu.statut === 'pret') setCatalogueEtiquettes(lu.donnees)
		})
		return () => {
			actif = false
		}
	}, [])

	// Le bornage se fait **après** une réponse qui porte un total, jamais avant : borner par un
	// total qu'on n'a pas reviendrait à inventer une valeur par défaut (CLAUDE.md §18).
	useEffect(() => {
		const borne = bornerPage(demandes.page, total)
		setPageBornee(borne === demandes.page ? null : borne)
	}, [demandes.page, total])

	const appliquer = (suivants: ParametresListe) => {
		setPageBornee(null)
		setParametresUrl(ecrireParametres(suivants))
	}

	if (channel.workflow_id === null) {
		return (
			<EtatVide
				titre={t('route.channel.noworkflow.title')}
				corps={t('route.channel.noworkflow.body')}
			/>
		)
	}

	if (etat.statut === 'chargement' || etapes.etat.statut === 'chargement') {
		return (
			<div className="px-4 py-6">
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			</div>
		)
	}

	const echec = etat.statut === 'erreur' ? etat.erreur : etapes.etat.statut === 'erreur' ? etapes.etat.erreur : null
	if (echec !== null) {
		if (echec.nature === 'forbidden') {
			return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
		}
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={t(echec.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={() => {
					etapes.recharger()
					recharger()
				}}
			/>
		)
	}

	if (etat.statut !== 'pret' || etapes.etat.statut !== 'pret') return null

	// Le `416` n'est pas une erreur de chargement : c'est une réponse légitime à une question qui
	// ne l'est plus (§12.6, règle 2). L'écran le nomme et propose le retour à la première page.
	if (etat.donnees.nature === 'page_inexistante') {
		return (
			<div className="px-4 py-6">
				<EtatVide
					titre={t('liste.gone.title')}
					corps={t('liste.gone.body')}
					action={
						<button
							type="button"
							data-testid="retour-premiere-page"
							onClick={() => appliquer({ ...parametres, page: 1 })}
							className={CLASSES_RETOUR}
						>
							{t('liste.gone.action')}
						</button>
					}
				/>
			</div>
		)
	}

	const { cards, total: totalFiltre } = etat.donnees
	const filtre = parametres.etape !== null || parametres.recherche !== ''
	// TROIS ÉTATS VIDES, ET NON DEUX (§16.12.6). Le troisième n'existe que lorsque le sommeil est la
	// SEULE cause possible du vide : aucun autre filtre posé, et le mode masqué. La liste, elle, ne
	// sait pas s'il dort réellement une affaire — elle a demandé les éveillées et n'en a reçu aucune
	// —, d'où « aucune affaire ÉVEILLÉE », qui est vrai dans les deux cas. Un second comptage pour
	// les distinguer serait une requête payée sur tous les chargements pour un cas de bord.
	const videParSommeil = !filtre && parametres.sommeil === 'masquees'

	// Deux états vides distincts, parce que l'utilisateur n'y répond pas de la même façon : un
	// channel sans affaire n'appelle aucune action, un filtre trop étroit appelle son retrait (§12.9).
	//
	// Il est passé **au tableau**, et non empilé au-dessus de lui : le rendre à part plaçait le
	// message avant les filtres qui en étaient la cause, doublait l'action et laissait sous elle une
	// carcasse de tableau — défaut trouvé en regardant une capture (décision 190).
	//
	// Écrit en `if` et non en ternaire. La contrainte qui l'imposait a disparu : le contrôle de
	// textes en dur lisait la queue d'un `? undefined : (` comme un nœud de texte littéral, et il
	// lit désormais l'arbre syntaxique du fichier, où cette queue n'est pas un texte (INC-070,
	// close ; `docs/JOURNAL.md` décisions 296 et 381). La forme est conservée parce qu'elle est la
	// plus lisible des deux, et non plus parce qu'un outil l'exige.
	let etatVide: ReactNode = undefined
	if (totalFiltre === 0) {
		// Les clés sont ÉCRITES, jamais construites : une clé interpolée ne se retrouverait pas par le
		// contrôle de textes en dur, qui lit l'arbre syntaxique (même règle qu'au §16.11.3 des presets).
		const titre: CleTraduction = filtre
			? 'liste.filtered.title'
			: videParSommeil
				? 'liste.empty.sommeil.title'
				: 'liste.empty.title'
		const corps: CleTraduction = filtre
			? 'liste.filtered.body'
			: videParSommeil
				? 'liste.empty.sommeil.body'
				: 'liste.empty.body'
		etatVide = (
			<EtatVide
				titre={t(titre)}
				corps={t(corps)}
				{...(filtre
					? {
							action: (
								<button
									type="button"
									data-testid="effacer-filtres-vide"
									onClick={() =>
										appliquer({
											...parametres,
											etape: null,
											recherche: '',
											// « Effacer les filtres » efface celui-ci aussi (§16.12.5).
											sommeil: MODE_SOMMEIL_PAR_DEFAUT,
											page: 1,
										})
									}
									className={CLASSES_RETOUR}
								>
									{t('liste.filtre.effacer')}
								</button>
							),
						}
					: {})}
				{...(!filtre && videParSommeil
					? {
							action: (
								<button
									type="button"
									data-testid="afficher-sommeil-vide"
									onClick={() => appliquer({ ...parametres, sommeil: 'visibles', page: 1 })}
									className={CLASSES_RETOUR}
								>
									{t('sommeil.afficher')}
								</button>
							),
						}
					: {})}
			/>
		)
	}

	return (
		<div className="px-4 py-6 min-w-0">
			<ListeRendue
				cards={cards}
				etapes={etapes.etat.donnees}
				catalogueEtiquettes={catalogueEtiquettes}
				parametres={parametres}
				total={totalFiltre}
				slugTrack={slugTrack}
				slugChannel={channel.slug}
				onParametres={appliquer}
				commandeCreation={importOuvert ? null : <CommandeNouvelleAffaire creation={creation} />}
				formulaireCreation={
					creation.ouvert ? (
						<FormulaireNouvelleAffaire
							creation={creation}
							client={clientCrm}
							idChannel={channel.id}
							slugTrack={slugTrack}
							slugChannel={channel.slug}
						/>
					) : null
				}
				commandesVues={<CommandesVues vues={vues} parametres={parametres} onParametres={appliquer} />}
				panneauVues={
					vues.panneau === null ? null : <PanneauVue vues={vues} parametres={parametres} onParametres={appliquer} />
				}
				commandeExport={
					clientExport === null ? null : (
						<CommandeExportCsv
							testId="exporter-affaires"
							nomAccessible={t('export.commande.affaires.aria', { channel: channel.name })}
							preparer={() => preparerExportAffaires(clientExport, channel, parametres)}
						/>
					)
				}
				commandeImport={
					clientExport === null || importOuvert || creation.ouvert ? null : (
						<CommandeImportAffaires ref={commandeImport} onOuvrir={() => setImportOuvert(true)} />
					)
				}
				panneauImport={
					clientExport === null || !importOuvert ? null : (
						<PanneauImport
							client={clientExport}
							cible={{ objet: 'affaires', idChannel: channel.id }}
							onFermer={(relire) => {
								setImportOuvert(false)
								setRendreFocusImport(true)
								if (relire) relireDiscretement()
							}}
						/>
					)
				}
				{...(etatVide === undefined ? {} : { etatVide })}
			/>
		</div>
	)
}

/**
 * Petit adaptateur : il évite de répéter sept propriétés entre les deux issues ci-dessus, et il
 * porte l'annonce `aria-live` — un tableau qui se remplit sans un mot est un changement invisible
 * pour qui ne voit pas l'écran (docs/SPEC-cards.md §12.8).
 */
function ListeRendue({
	cards,
	etapes,
	catalogueEtiquettes,
	parametres,
	total,
	slugTrack,
	slugChannel,
	onParametres,
	commandeCreation,
	formulaireCreation,
	commandesVues,
	panneauVues,
	commandeExport,
	commandeImport,
	panneauImport,
	etatVide,
}: {
	readonly cards: readonly CardListeRendue[]
	readonly etapes: readonly EtapeBoard[]
	readonly catalogueEtiquettes: readonly Etiquette[]
	readonly parametres: ParametresListe
	readonly total: number
	readonly slugTrack: string
	readonly slugChannel: string
	readonly onParametres: (parametres: ParametresListe) => void
	readonly commandeCreation: ReactNode
	readonly formulaireCreation: ReactNode
	readonly commandesVues: ReactNode
	readonly panneauVues: ReactNode
	readonly commandeExport: ReactNode
	readonly commandeImport: ReactNode
	readonly panneauImport: ReactNode
	readonly etatVide?: ReactNode
}) {
	return (
		<>
			<LiveRegion libelle={t('live.liste.aria')} message={t('live.liste.loaded')} />
			<ListeCards
				cards={cards}
				etapes={etapes}
				catalogueEtiquettes={catalogueEtiquettes}
				parametres={parametres}
				total={total}
				slugTrack={slugTrack}
				slugChannel={slugChannel}
				onParametres={onParametres}
				commandeCreation={commandeCreation}
				formulaireCreation={formulaireCreation}
				commandesVues={commandesVues}
				panneauVues={panneauVues}
				commandeExport={commandeExport}
				commandeImport={commandeImport}
				panneauImport={panneauImport}
				{...(etatVide === undefined ? {} : { etatVide })}
			/>
		</>
	)
}
