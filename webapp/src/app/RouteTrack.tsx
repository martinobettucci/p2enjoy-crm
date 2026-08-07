// @spec CRM-021 (docs/BACKLOG.md) — route d'un track : ses onglets et le contenu d'un channel
// @spec CRM-041 (docs/BACKLOG.md) — le board d'un channel ouvert
// @spec CRM-042 (docs/BACKLOG.md) — la vue liste du même channel, seconde lecture du même contenu
// @spec docs/SPEC-channels.md §5.1 (route d'un track), §5.3 (barre d'onglets), §1.2 (hors périmètre)
// @spec docs/SPEC-workflow-engine.md §7.2 (ce que le board lit), §7.11 (états systématiques)
// @spec docs/SPEC-cards.md §12.2 (l'adresse porte tout), §12.3 (ce que la liste lit), §12.9 (états)
// @spec docs/DESIGN_SYSTEM.md §4 (architecture), §5.8 (états explicites), §10 (libellés métier)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
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

import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { composerBoard, useContenuBoard, type CardBoard, type EtapeBoard } from '../lib/board'
import { projeterChannels, useContenuTrack, type Channel } from '../lib/channels'
import {
	bornerPage,
	ecrireParametres,
	lireParametres,
	useEtapesChannel,
	usePageCards,
	type CardListe as CardListeRendue,
	type ParametresListe,
} from '../lib/liste-cards'
import { clientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'
import { Board } from './Board'
import { BasculeVue, ListeCards } from './ListeCards'

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

	return (
		<AppShell
			cleTitreRoute={CLE_TITRE_TRACK}
			{...(track === null ? {} : { titreRoute: track.name })}
			etatChannels={etatChannels}
			onRechargerChannels={recharger}
			{...(slugTrack === undefined ? {} : { slugTrack })}
		>
			<ContenuTrack
				chargement={etat.statut === 'chargement'}
				trackTrouve={track !== null}
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
	trackTrouve,
	nombreChannels,
	channelDemande,
	vue,
	channelOuvert,
	slugTrack,
}: {
	readonly chargement: boolean
	readonly trackTrouve: boolean
	readonly nombreChannels: number
	readonly channelDemande: string | undefined
	readonly vue: VueChannel
	readonly channelOuvert?: Channel
	readonly slugTrack?: string
}) {
	// Pendant le chargement, la zone principale ne montre rien plutôt qu'un « introuvable »
	// prématuré : annoncer l'absence avant d'avoir la réponse serait une valeur par défaut
	// trompeuse (CLAUDE.md §18). Les squelettes vivent là où la donnée est attendue — barre
	// latérale et barre d'onglets.
	if (chargement) return null

	if (!trackTrouve) {
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

	if (nombreChannels === 0) {
		return (
			<EtatVide titre={t('route.track.nochannel.title')} corps={t('route.track.nochannel.body')} />
		)
	}

	if (channelDemande === undefined) {
		return (
			<EtatVide titre={t('route.track.pickchannel.title')} corps={t('route.track.pickchannel.body')} />
		)
	}

	// L'adresse nomme un channel que le track ne porte pas — ou que l'appelant n'a pas le droit de
	// lire. Le même écran que « choisissez un channel » : distinguer les deux renseignerait sur
	// l'existence d'un channel refusé (docs/SPEC-permissions-rls.md §7).
	if (channelOuvert === undefined || slugTrack === undefined) {
		return (
			<EtatVide titre={t('route.track.pickchannel.title')} corps={t('route.track.pickchannel.body')} />
		)
	}

	// La bascule est **au-dessus** de la zone, et non dans l'une des deux vues : elle doit rester
	// atteignable pendant le chargement, sur un état vide et sur un état d'erreur — l'utilisateur
	// dont la liste échoue doit pouvoir revenir au board sans retaper une adresse
	// (docs/DESIGN_SYSTEM.md §5.8, docs/SPEC-cards.md §12.8).
	return (
		<div className="flex flex-col min-w-0">
			<div className="px-4 pt-4">
				<BasculeVue slugTrack={slugTrack} slugChannel={channelOuvert.slug} vue={vue} />
			</div>
			{vue === 'liste' ? (
				<ZoneListe channel={channelOuvert} slugTrack={slugTrack} />
			) : (
				<ZoneBoard channel={channelOuvert} slugTrack={slugTrack} />
			)}
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
function ZoneBoard({ channel, slugTrack }: { readonly channel: Channel; readonly slugTrack: string }) {
	const { etat, recharger } = useContenuBoard(
		clientCrm,
		channel.id,
		channel.workflow_id ?? undefined,
	)
	const [cards, setCards] = useState<readonly CardBoard[]>([])

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
		return (
			<EtatVide titre={t('route.channel.nostep.title')} corps={t('route.channel.nostep.body')} />
		)
	}

	const modele = composerBoard({
		etapes: etat.donnees.etapes,
		cards,
		transitions: etat.donnees.transitions,
		maintenant: new Date(),
	})

	if (modele.nombreCards === 0) {
		return (
			<div className="flex flex-col gap-4 px-4 py-6">
				<EtatVide titre={t('route.channel.empty.title')} corps={t('route.channel.empty.body')} />
				<BoardRendu
					modele={modele}
					cards={cards}
					onCards={setCards}
					libelles={etat.donnees.libellesChamps}
					slugTrack={slugTrack}
					slugChannel={channel.slug}
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
				slugTrack={slugTrack}
				slugChannel={channel.slug}
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
	slugTrack,
	slugChannel,
}: {
	readonly modele: ReturnType<typeof composerBoard>
	readonly cards: readonly CardBoard[]
	readonly onCards: (cards: readonly CardBoard[]) => void
	readonly libelles: ReadonlyMap<string, string>
	readonly slugTrack: string
	readonly slugChannel: string
}) {
	return (
		<Board
			modele={modele}
			cards={cards}
			onCards={onCards}
			libellesChamps={libelles}
			client={clientCrm}
			slugTrack={slugTrack}
			slugChannel={slugChannel}
		/>
	)
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
	const [parametresUrl, setParametresUrl] = useSearchParams()
	const demandes = lireParametres(parametresUrl)
	const workflowId = channel.workflow_id ?? undefined
	const etapes = useEtapesChannel(clientCrm, workflowId)
	const [pageBornee, setPageBornee] = useState<number | null>(null)
	const parametres: ParametresListe = {
		...demandes,
		page: pageBornee ?? demandes.page,
	}
	const { etat, total, recharger } = usePageCards(clientCrm, channel.id, parametres)

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

	// Deux états vides distincts, parce que l'utilisateur n'y répond pas de la même façon : un
	// channel sans affaire n'appelle aucune action, un filtre trop étroit appelle son retrait (§12.9).
	//
	// Il est passé **au tableau**, et non empilé au-dessus de lui : le rendre à part plaçait le
	// message avant les filtres qui en étaient la cause, doublait l'action et laissait sous elle une
	// carcasse de tableau — défaut trouvé en regardant une capture (décision 190).
	//
	// Écrit en `if` et non en ternaire : le contrôle de textes en dur de
	// `webapp/src/i18n/i18n.test.ts` lit la queue d'un `? undefined : (` comme un nœud de texte
	// littéral, et l'a réellement signalée. La limite de l'outil est consignée en INC-070 ; la
	// forme choisie ici est de toute façon la plus lisible des deux.
	let etatVide: ReactNode = undefined
	if (totalFiltre === 0) {
		etatVide = (
			<EtatVide
				titre={t(filtre ? 'liste.filtered.title' : 'liste.empty.title')}
				corps={t(filtre ? 'liste.filtered.body' : 'liste.empty.body')}
				{...(filtre
					? {
							action: (
								<button
									type="button"
									data-testid="effacer-filtres-vide"
									onClick={() => appliquer({ ...parametres, etape: null, recherche: '', page: 1 })}
									className={CLASSES_RETOUR}
								>
									{t('liste.filtre.effacer')}
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
				parametres={parametres}
				total={totalFiltre}
				slugTrack={slugTrack}
				slugChannel={channel.slug}
				onParametres={appliquer}
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
	parametres,
	total,
	slugTrack,
	slugChannel,
	onParametres,
	etatVide,
}: {
	readonly cards: readonly CardListeRendue[]
	readonly etapes: readonly EtapeBoard[]
	readonly parametres: ParametresListe
	readonly total: number
	readonly slugTrack: string
	readonly slugChannel: string
	readonly onParametres: (parametres: ParametresListe) => void
	readonly etatVide?: ReactNode
}) {
	return (
		<>
			<LiveRegion libelle={t('live.liste.aria')} message={t('live.liste.loaded')} />
			<ListeCards
				cards={cards}
				etapes={etapes}
				parametres={parametres}
				total={total}
				slugTrack={slugTrack}
				slugChannel={slugChannel}
				onParametres={onParametres}
				{...(etatVide === undefined ? {} : { etatVide })}
			/>
		</>
	)
}
