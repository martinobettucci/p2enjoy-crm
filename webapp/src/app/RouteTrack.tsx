// @spec CRM-021 (docs/BACKLOG.md) — route d'un track : ses onglets et le contenu d'un channel
// @spec docs/SPEC-channels.md §5.1 (route d'un track), §5.3 (barre d'onglets), §1.2 (hors périmètre)
// @spec docs/DESIGN_SYSTEM.md §4 (architecture), §5.8 (états explicites), §10 (libellés métier)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
//
// La destination que `CRM-020` avait annoncée sans pouvoir la livrer : « un track s'ouvre sur ses
// channels, livrés par `CRM-021` » (docs/DESIGN_SYSTEM.md §12.4).
//
// Trois issues, toutes explicites, aucune page blanche :
//
//   * track trouvé, channel choisi     → l'état vide du board, qui nomme l'unité qui le livrera ;
//   * track trouvé, aucun channel      → l'état vide de la barre d'onglets ;
//   * aucun track pour ce slug         → « track introuvable », avec un retour vers l'accueil.
//
// Le troisième cas n'est pas hypothétique : l'appelant étant anonyme (INC-021), **toute** route de
// track y tombe aujourd'hui, la politique de lecture ne consentant aucune ligne. C'est le refus
// réel du backend, mesuré (docs/SPEC-channels.md §7, ligne b), et non un défaut d'interface.
//
// Un slug refusé et un slug inexistant produisent le **même** écran, délibérément : les
// distinguer renseignerait un appelant sans droit sur l'existence d'un track
// (docs/SPEC-permissions-rls.md §7).

import { Link, useParams } from 'react-router'
import { EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { projeterChannels, useContenuTrack } from '../lib/channels'
import { clientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'

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
				channelOuvert={slugChannel}
			/>
		</AppShell>
	)
}

function ContenuTrack({
	chargement,
	trackTrouve,
	nombreChannels,
	channelOuvert,
}: {
	readonly chargement: boolean
	readonly trackTrouve: boolean
	readonly nombreChannels: number
	readonly channelOuvert: string | undefined
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

	if (channelOuvert === undefined) {
		return (
			<EtatVide titre={t('route.track.pickchannel.title')} corps={t('route.track.pickchannel.body')} />
		)
	}

	// Un channel est ouvert. Son contenu — board, vue liste, cards — relève de `CRM-040` à
	// `CRM-042` ; l'état vide le nomme, plutôt que de laisser croire à un channel sans activité.
	return <EtatVide titre={t('route.channel.empty.title')} corps={t('route.channel.empty.body')} />
}
