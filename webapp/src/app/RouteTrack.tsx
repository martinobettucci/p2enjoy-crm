// @spec CRM-021 (docs/BACKLOG.md) — route d'un track : ses onglets et le contenu d'un channel
// @spec CRM-041 (docs/BACKLOG.md) — le board d'un channel ouvert
// @spec docs/SPEC-channels.md §5.1 (route d'un track), §5.3 (barre d'onglets), §1.2 (hors périmètre)
// @spec docs/SPEC-workflow-engine.md §7.2 (ce que le board lit), §7.11 (états systématiques)
// @spec docs/DESIGN_SYSTEM.md §4 (architecture), §5.8 (états explicites), §10 (libellés métier)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
//
// La destination que `CRM-020` avait annoncée sans pouvoir la livrer : « un track s'ouvre sur ses
// channels, livrés par `CRM-021` » (docs/DESIGN_SYSTEM.md §12.4).
//
// Quatre issues, toutes explicites, aucune page blanche :
//
//   * track trouvé, channel choisi     → le **board** de ce channel (`CRM-041`) ;
//   * track trouvé, aucun channel      → l'état vide de la barre d'onglets ;
//   * track trouvé, aucun channel ouvert → l'invitation à en choisir un ;
//   * aucun track pour ce slug         → « track introuvable », avec un retour vers l'accueil.
//
// La dernière n'est pas hypothétique : l'appelant étant anonyme (INC-021), **toute** route de
// track y tombe aujourd'hui, la politique de lecture ne consentant aucune ligne. C'est le refus
// réel du backend, mesuré (docs/SPEC-channels.md §7, ligne b), et non un défaut d'interface. Le
// board ne s'affiche donc jamais en conditions réelles, et ses états chargés se prouvent en
// substituant la réponse réseau (docs/DESIGN_SYSTEM.md §12.5).
//
// Un slug refusé et un slug inexistant produisent le **même** écran, délibérément : les
// distinguer renseignerait un appelant sans droit sur l'existence d'un track
// (docs/SPEC-permissions-rls.md §7).

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { composerBoard, useContenuBoard, type CardBoard } from '../lib/board'
import { projeterChannels, useContenuTrack, type Channel } from '../lib/channels'
import { clientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'
import { Board } from './Board'

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

export function RouteTrack() {
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
	channelOuvert,
	slugTrack,
}: {
	readonly chargement: boolean
	readonly trackTrouve: boolean
	readonly nombreChannels: number
	readonly channelDemande: string | undefined
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

	return <ZoneBoard channel={channelOuvert} slugTrack={slugTrack} />
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
