// @spec CRM-037 (docs/BACKLOG.md) — écran hôte du formulaire conditionnel
// @spec CRM-043 (docs/BACKLOG.md) — colonne de droite : le panneau de commentaires
// @spec docs/SPEC-cards.md §13.10 (le panneau) ; docs/DESIGN_SYSTEM.md §5.10
// @spec docs/SPEC-form-composer.md §4.6 (l'écran hôte, et pourquoi c'est une route),
//       §4.6 bis (ce que la coquille montre autour du formulaire), §4.5 (états)
// @spec docs/SPEC-channels.md §5 (ce que la barre d'onglets lit), §5.4 (toute route portant un
//       `slugTrack` l'alimente par le même chargeur)
// @spec docs/DESIGN_SYSTEM.md §4 (onglets : les channels du track courant), §5.3 (détail de card),
//       §5.8 (états explicites), §7 (responsive)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
//
// Le formulaire est la colonne gauche du détail de card (docs/DESIGN_SYSTEM.md §5.3). Il lui faut
// une adresse : c'est le procédé de `CRM-021`, qui a livré la route d'un track parce que la barre
// d'onglets n'avait aucun hôte.
//
// LA COLONNE DE DROITE EST LIVRÉE PAR `CRM-043` : le **panneau de commentaires**
// (docs/DESIGN_SYSTEM.md §5.10). Elle n'est pas encore la timeline unifiée que le §5.3 décrit —
// `CRM-044` y fondra les transitions, les activités et les emails —, et les champs d'en-tête de la
// card (`CRM-040`) restent dus par leur unité.
//
// La card est désignée par son **identifiant** et non par un slug : `docs/SPEC-cards.md` ne lui en
// donne aucun, et son `email_local_part` est délibérément non devinable — en faire une adresse
// publique le divulguerait.
//
// Sans session, une route de card tombe sur « card introuvable » : c'est le refus réel du backend,
// pas un défaut d'interface. Après connexion, le même écran rend la card consentie. Un identifiant
// refusé et un identifiant inexistant produisent toujours le même écran, délibérément : les
// distinguer renseignerait un appelant sans droit sur l'existence d'une card
// (docs/SPEC-permissions-rls.md §7).
//
// DEUX CHARGEMENTS INDÉPENDANTS, ET POURQUOI (§4.6 bis, décision 167). La card et son formulaire
// d'un côté ; le track porteur et ses channels de l'autre, pour la barre d'onglets — que
// `docs/DESIGN_SYSTEM.md` §4 veut alimentée sur toute route portant un track courant. La première
// livraison de cette route transmettait `slugTrack` sans les channels : la barre affichait
// « Aucun channel » partout. Les channels sont lus par le **même chargeur** que la route d'un
// track (`docs/SPEC-channels.md` §5.4) ; aucune lecture propre à cet écran n'est écrite.
//
// L'onglet courant n'est **pas** calculé ici : `NavLink` le résout par préfixe de segments, et
// l'adresse d'une card commence par celle de son channel (§4.6 bis).
//
// Rien ne confronte le couple `(slugTrack, slugChannel)` de l'adresse à la card qu'elle désigne —
// **INC-065**, comportement inchangé, arbitrage demandé.

import { Link, useParams } from 'react-router'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { projeterChannels, useContenuTrack } from '../lib/channels'
import { useContenuCard, type ModeleFormulaire } from '../lib/formulaire'
import { clientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'
import { AppShell } from './AppShell'
import { FormulaireCard } from './FormulaireCard'
import { PanneauTimeline } from './PanneauTimeline'

/** Classes du lien de retour, identiques à celles de `PageIntrouvable` (docs/DESIGN_SYSTEM.md §5.5). */
const CLASSES_RETOUR = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
].join(' ')

/**
 * Repli du titre de l'en-tête, remplacé par le titre de la card dès qu'il est connu.
 *
 * Déclarée comme constante et non écrite dans le JSX, pour la même raison que `CLE_TITRE_TRACK` :
 * le contrôle de clés mortes de `webapp/src/i18n/i18n.test.ts` cherche les clés citées entre
 * apostrophes, et un attribut JSX entre guillemets lui échapperait.
 */
const CLE_TITRE_CARD: CleTraduction = 'route.card.title'

export function RouteCard() {
	const { slugTrack, idCard } = useParams()
	const { etat, recharger } = useContenuCard(clientCrm, idCard)
	const { etat: etatTrack, recharger: rechargerTrack } = useContenuTrack(clientCrm, slugTrack)

	const card = etat.statut === 'pret' ? etat.donnees.card : null

	return (
		<AppShell
			cleTitreRoute={CLE_TITRE_CARD}
			{...(card === null ? {} : { titreRoute: card.title })}
			etatChannels={projeterChannels(etatTrack)}
			onRechargerChannels={rechargerTrack}
			{...(slugTrack === undefined ? {} : { slugTrack })}
		>
			<ContenuCard etat={etat} onReprise={recharger} />
		</AppShell>
	)
}

function ContenuCard({
	etat,
	onReprise,
}: {
	readonly etat: ReturnType<typeof useContenuCard>['etat']
	readonly onReprise: () => void
}) {
	// L'identité de session ne sert qu'à décider quels gestes du fil SONT OFFERTS ; la règle reste
	// tenue par la politique `UPDATE` de `card_comments` (`CLAUDE.md` §10). Le hook est appelé
	// avant tout retour anticipé : l'ordre des hooks ne dépend jamais de l'état.
	const authentification = useAuthentification()

	// Pendant le chargement, la zone principale ne montre rien plutôt qu'un « introuvable »
	// prématuré : annoncer l'absence avant d'avoir la réponse serait une valeur par défaut
	// trompeuse (CLAUDE.md §18).
	if (etat.statut === 'chargement') return null

	if (etat.statut === 'erreur') {
		if (etat.erreur.nature === 'forbidden') {
			return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
		}
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={onReprise}
			/>
		)
	}

	if (etat.donnees.card === null) {
		return (
			<EtatVide
				titre={t('route.card.notfound.title')}
				corps={t('route.card.notfound.body')}
				action={
					<Link to="/" className={CLASSES_RETOUR}>
						{t('route.notfound.action')}
					</Link>
				}
			/>
		)
	}

	// La card existe, son étape non : le backend a consenti l'une et refusé l'autre. L'écran le
	// dit plutôt que d'inventer une étape sans nom (webapp/src/lib/formulaire.ts).
	if (etat.donnees.modele === null) {
		return <EtatVide titre={t('route.card.nostep.title')} corps={t('route.card.nostep.body')} />
	}

	// DEUX COLONNES sur grand écran, EMPILÉES sous 1024 px (docs/DESIGN_SYSTEM.md §5.3 et §7).
	// Sous ce palier, le fil passe SOUS le formulaire, dans l'ordre du document : une histoire se
	// lit après le dossier qu'elle raconte (§5.10, §5.11).
	return (
		<div className="mx-auto max-w-[104rem] grid gap-6 px-4 py-6 lg:grid-cols-[minmax(0,72ch)_minmax(0,1fr)]">
			<FormulaireCard modele={etat.donnees.modele} />
			<PanneauTimeline
				client={clientCrm}
				idCard={etat.donnees.card.id}
				idWorkspace={etat.donnees.card.workspace_id}
				idWorkflow={etat.donnees.card.workflow_id}
				libellesChamps={libellesChamps(etat.donnees.modele)}
				idUtilisateur={
					authentification.etat.statut === 'authentifie'
						? authentification.etat.utilisateur.id
						: null
				}
			/>
		</div>
	)
}

/**
 * Les libellés des champs, tels que la fiche les a DÉJÀ chargés.
 *
 * Ils sont pris des deux listes du modèle — celle de l'étape courante ET la section repliée des
 * autres étapes —, car un événement `field_changed` peut porter sur un champ que l'étape courante
 * ne montre pas. Aucune requête supplémentaire : le formulaire porte déjà la donnée, et le fil ne
 * lit jamais un libellé dans le `payload` d'un événement (docs/SPEC-cards.md §14.6).
 */
function libellesChamps(modele: ModeleFormulaire): ReadonlyMap<string, string> {
	const libelles = new Map<string, string>()
	for (const resolu of [...modele.champs, ...modele.autresEtapes]) {
		libelles.set(resolu.champ.id, resolu.champ.label)
	}
	return libelles
}
