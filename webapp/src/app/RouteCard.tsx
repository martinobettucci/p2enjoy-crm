// @spec CRM-037 (docs/BACKLOG.md) — écran hôte du formulaire conditionnel
// @spec CRM-043 (docs/BACKLOG.md) — colonne de droite : le panneau de commentaires
// @spec CRM-077 (docs/BACKLOG.md) — huitième tranche : le GESTE de mise à la corbeille d'une affaire
// @spec docs/SPEC-corbeille.md §4 ter.1 (où le geste vit, et les deux surfaces écartées),
//       §4 ter.2 (la confirmation ne porte aucune énumération), §4 ter.3 (les trois issues),
//       §4 ter.5 (après le geste, l'écran nomme la corbeille et ne dit pas « introuvable »)
// @spec docs/DESIGN_SYSTEM.md §5.3 (le geste vit en bas de la colonne gauche, sa confirmation dans
//       le flux, son succès remplace le contenu), §5.5 (variantes), §6 (confirmation nommant
//       l'objet), §8 (role="status", cibles ≥ 40 px), §9 (icônes Lucide)
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

import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { projeterChannels, useContenuTrack } from '../lib/channels'
import { mettreCardALaCorbeille, type NatureRefusGeste } from '../lib/corbeille'
import { useContenuCard, type ModeleFormulaire } from '../lib/formulaire'
import { estAdministrateur, useRoleWorkspace } from '../lib/roles'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'
import { AppShell } from './AppShell'
import { FormulaireCard } from './FormulaireCard'
import { FormulaireEnvoi } from './FormulaireEnvoi'
import { PanneauTimeline } from './PanneauTimeline'
import { CHEMIN_CORBEILLE } from './routes'

/** Classes du lien de retour, identiques à celles de `PageIntrouvable` (docs/DESIGN_SYSTEM.md §5.5). */
const CLASSES_RETOUR = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
].join(' ')

/**
 * Second lien du bloc de succès du §4 ter.5, en variante **secondaire** du §5.5.
 *
 * Deux liens primaires côte à côte ne diraient pas lequel est le chemin ordinaire : revenir au
 * channel l'est, ouvrir la corbeille est le chemin de celui qui veut défaire. Les mêmes classes que
 * la variante secondaire du bouton, portées par un lien : la cible reste ≥ 40 px (§8).
 */
const CLASSES_RETOUR_SECONDAIRE = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-surface text-ink border border-border font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-hover',
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
	const { slugTrack, slugChannel, idCard } = useParams()
	const { etat, recharger } = useContenuCard(clientCrm, idCard)
	const { etat: etatTrack, recharger: rechargerTrack } = useContenuTrack(clientCrm, slugTrack)

	const card = etat.statut === 'pret' ? etat.donnees.card : null

	// L'adresse du channel d'où l'on vient, telle que `CHEMIN_CARD` la porte déjà dans l'URL : le
	// bloc de succès du §4 ter.5 y renvoie sans relire quoi que ce soit. Elle vaut `null` lorsqu'un
	// des deux segments manque — la route ne peut alors pas être celle d'une card, et un lien
	// composé sur `undefined` mènerait à une adresse inexistante.
	const cheminChannel =
		slugTrack === undefined || slugChannel === undefined
			? null
			: `/tracks/${slugTrack}/${slugChannel}`

	return (
		<AppShell
			cleTitreRoute={CLE_TITRE_CARD}
			{...(card === null ? {} : { titreRoute: card.title })}
			etatChannels={projeterChannels(etatTrack)}
			onRechargerChannels={rechargerTrack}
			{...(slugTrack === undefined ? {} : { slugTrack })}
		>
			<ContenuCard etat={etat} onReprise={recharger} cheminChannel={cheminChannel} />
		</AppShell>
	)
}

function ContenuCard({
	etat,
	onReprise,
	cheminChannel,
}: {
	readonly etat: ReturnType<typeof useContenuCard>['etat']
	readonly onReprise: () => void
	readonly cheminChannel: string | null
}) {
	// L'identité de session ne sert qu'à décider quels gestes du fil SONT OFFERTS ; la règle reste
	// tenue par la politique `UPDATE` de `card_comments` (`CLAUDE.md` §10). Le hook est appelé
	// avant tout retour anticipé : l'ordre des hooks ne dépend jamais de l'état.
	const authentification = useAuthentification()
	const idUtilisateur =
		authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null

	// LE RÔLE DE WORKSPACE, POUR LA MÊME RAISON ET AVEC LA MÊME LIMITE — décision 376, INC-072. Il
	// décide si le fil OFFRE le geste de modération, jamais s'il est permis : `card_comments_moderation`
	// le tient. Comme ci-dessus, le hook précède tout retour anticipé.
	//
	// Le workspace vient de la card elle-même, et vaut donc `null` tant qu'elle n'est pas chargée :
	// le rôle est lu par couple `(workspace_id, user_id)`, et il n'existe aucun rôle « global »
	// dans le modèle. Sans identifiant d'utilisateur, aucune requête n'est émise.
	const workspaceDeLaCard = etat.statut === 'pret' ? (etat.donnees.card?.workspace_id ?? null) : null
	const role = useRoleWorkspace(clientCrm, workspaceDeLaCard, idUtilisateur)

	// L'AFFAIRE A ÉTÉ RETIRÉE PENDANT CETTE VISITE — §4 ter.5. L'état vit ici, et non dans le bloc du
	// geste, parce qu'il décide de TOUT l'écran : la card quitte la lecture de sa propre route
	// (`deleted_at=is.null`, MESURÉ), et une relecture ne rendrait plus rien à afficher. Il n'est
	// jamais dérivé de la donnée : c'est le résultat du `PATCH` qui le pose.
	const [retiree, setRetiree] = useState(false)
	const marquerRetiree = useCallback(() => setRetiree(true), [])

	// Placé AVANT toute lecture de l'état de chargement : l'écran ne relit rien après le geste, et
	// retomber sur « Card introuvable » serait faux pour celui qui vient de la retirer (§4 ter.5).
	if (retiree) return <AffaireRetiree cheminChannel={cheminChannel} />

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
			<div className="flex flex-col gap-6 min-w-0">
				<FormulaireCard modele={etat.donnees.modele} />
				{/* LE GESTE EST EN BAS DE LA COLONNE GAUCHE (docs/DESIGN_SYSTEM.md §5.3) : la colonne
				    droite RACONTE ce qui est arrivé à l'affaire, et un geste qui agit n'appartient pas
				    au récit. En bas, parce qu'un retrait n'est pas ce qu'on vient faire sur une fiche. */}
				<BlocCorbeilleCard
					idCard={etat.donnees.card.id}
					titre={etat.donnees.card.title}
					onRetiree={marquerRetiree}
				/>
			</div>
			<div className="flex flex-col gap-4 min-w-0">
				{/* ÉCRIRE DEPUIS LA CARD EMPRUNTE LE MÊME CHEMIN QUE DEPUIS L'INBOX (§19.6) : même
				    composant, même garde. Le formulaire est posé AVANT le fil, là où l'on écrit —
				    la mémoire de l'affaire se lit en dessous, comme les commentaires. */}
				<FormulaireEnvoi idCard={etat.donnees.card.id} />
				<PanneauTimeline
				client={clientCrm}
				idCard={etat.donnees.card.id}
				idWorkspace={etat.donnees.card.workspace_id}
				idWorkflow={etat.donnees.card.workflow_id}
				libellesChamps={libellesChamps(etat.donnees.modele)}
				idUtilisateur={idUtilisateur}
				estAdminWorkspace={estAdministrateur(role.etat)}
				/>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Le geste de mise à la corbeille — CRM-077, docs/SPEC-corbeille.md §4 ter
// ---------------------------------------------------------------------------------------------

/**
 * Les clés des trois refus classés par `classerRefusGeste`, et le quatrième message que l'écran
 * doit dire : « sans effet ».
 *
 * DICTIONNAIRE FERMÉ, jamais le message du serveur : c'est la règle déjà tenue par les codes
 * d'incident de `CRM-059` et par le classement des refus de `CRM-075`. Un texte d'API n'est pas un
 * texte pour un humain, et le rendre tel quel exposerait le détail de la pile à l'utilisateur
 * (`CLAUDE.md` §20).
 */
const MESSAGES_REFUS: Readonly<Record<NatureRefusGeste, CleTraduction>> = {
	forbidden: 'card.trash.refus.forbidden',
	network: 'card.trash.refus.network',
	unknown: 'card.trash.refus.unknown',
}

/** Clé du message de l'issue « sans effet », nommée hors du JSX comme `CLE_TITRE_CARD`. */
const CLE_SANS_EFFET: CleTraduction = 'card.trash.noeffect'

type PhaseGeste = 'inactif' | 'confirmation' | 'envoi'

/**
 * Le bloc du geste : la commande, puis sa confirmation dans le flux du document.
 *
 * LA COMMANDE N'EST JAMAIS ÉTEINTE D'AVANCE, quel que soit le rôle (§4 ter.3) : la règle vit dans
 * `cards_maj`, et une commande désactivée par l'interface ferait passer une décision de la base pour
 * une décision d'écran (`CLAUDE.md` §10). MESURÉ : un business developer RÉUSSIT ce geste là où il
 * échoue sur un track — la politique porte sur le droit d'écriture du channel, pas sur un rôle.
 */
export function BlocCorbeilleCard({
	idCard,
	titre,
	onRetiree,
	client = clientCrm,
}: {
	readonly idCard: string
	readonly titre: string
	readonly onRetiree: () => void
	/** Injectable pour les preuves ; en production, le client réel du module `supabase`. */
	readonly client?: ClientCrm | null
}) {
	const [phase, setPhase] = useState<PhaseGeste>('inactif')
	const [message, setMessage] = useState<string | null>(null)
	const commande = useRef<HTMLButtonElement>(null)

	const confirmer = useCallback(async () => {
		if (client === null) return
		setPhase('envoi')
		setMessage(null)
		const resultat = await mettreCardALaCorbeille(client, idCard)
		if (resultat.statut === 'appliquee') {
			onRetiree()
			return
		}
		// « Sans effet » n'est NI un succès NI une erreur (§4 ter.3) : la ligne a été filtrée par la
		// clause `USING` avant la mise à jour, rien n'a changé, et l'écran le dit plutôt que
		// d'annoncer un retrait qui n'a pas eu lieu. La confirmation reste ouverte : la refermer
		// effacerait le message avec elle.
		setMessage(
			resultat.statut === 'sans-effet'
				? t(CLE_SANS_EFFET)
				: t(MESSAGES_REFUS[resultat.refus.nature]),
		)
		setPhase('confirmation')
	}, [client, idCard, onRetiree])

	const annuler = useCallback(() => {
		setPhase('inactif')
		setMessage(null)
		// Le focus revient à la commande qui a ouvert la confirmation : sans ce retour, annuler au
		// clavier le laisserait sur un bouton qui vient de disparaître (docs/DESIGN_SYSTEM.md §5.13).
		commande.current?.focus()
	}, [])

	// Sans client configuré, l'application entière rend déjà l'écran de configuration manquante
	// (`AppShell`) : cette branche n'est pas atteignable en production, et une commande qui n'aurait
	// aucun client où écrire serait une commande morte (docs/DESIGN_SYSTEM.md §5.10).
	if (client === null) return null

	return (
		<section
			data-testid="geste-corbeille-card"
			aria-labelledby="geste-corbeille-titre"
			className="flex flex-col gap-3 border-t border-border pt-4"
		>
			<h2 id="geste-corbeille-titre" className="sr-only">
				{t('card.trash.action')}
			</h2>
			{phase === 'inactif' ? (
				<div>
					<Button ref={commande} onClick={() => setPhase('confirmation')}>
						<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
						{t('card.trash.action')}
					</Button>
				</div>
			) : (
				<ConfirmationCorbeilleCard
					titre={titre}
					message={message}
					enCours={phase === 'envoi'}
					onConfirmer={() => void confirmer()}
					onAnnuler={annuler}
				/>
			)}
		</section>
	)
}

/**
 * La confirmation, dans le flux du document et jamais en modale (docs/DESIGN_SYSTEM.md §5.13).
 *
 * ELLE NE PORTE AUCUNE ÉNUMÉRATION (§4 ter.2), et pas davantage la phrase « aucun objet ne devient
 * inaccessible » du §4 bis.3 : cette phrase-là rapporte une mesure qui a rendu zéro. Ici aucune
 * mesure n'a lieu — une affaire n'a pas d'enfant au sens du §3.5 —, et en écrire le résultat serait
 * répondre à une question qui n'a pas été posée.
 */
function ConfirmationCorbeilleCard({
	titre,
	message,
	enCours,
	onConfirmer,
	onAnnuler,
}: {
	readonly titre: string
	readonly message: string | null
	readonly enCours: boolean
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const premier = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	return (
		<div
			data-testid="confirmation-corbeille-card"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{t('card.trash.confirm.title', { titre })}</p>
			<p className="text-sm text-text-2">{t('card.trash.confirm.body')}</p>
			{message === null ? null : (
				// Le refus se lit PRÈS de ce qui l'a causé, jamais en tête d'écran (§5.13, §5.16).
				<p
					role="alert"
					data-testid="refus-corbeille-card"
					className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
				>
					{message}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					ref={premier}
					variante="destructif"
					disabled={enCours}
					onClick={onConfirmer}
					data-testid="confirmer-corbeille-card"
				>
					{t('card.trash.confirm.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('card.trash.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * Ce que l'écran montre APRÈS le geste — §4 ter.5.
 *
 * Ce bloc existe parce que la relecture ne rendrait rien : `useContenuCard` lit `deleted_at=is.null`
 * (MESURÉ), et l'écran retomberait sur « Card introuvable ». Ce serait faux pour celui qui vient de
 * la retirer, et c'est exactement la « valeur par défaut trompeuse » de `CLAUDE.md` §18.
 *
 * DEUX CHEMINS, ET PAS UN SEUL : revenir au channel, et ouvrir la corbeille où l'affaire se
 * restaure. Aucune annulation sur place — restaurer est le geste de l'écran de corbeille, avec ses
 * trois issues et son refus nommé (§4.5).
 */
function AffaireRetiree({ cheminChannel }: { readonly cheminChannel: string | null }) {
	return (
		<div
			data-testid="affaire-retiree"
			role="status"
			className="mx-auto max-w-[72ch] flex flex-col gap-3 px-4 py-10 text-center"
		>
			<h2 className="text-h2">{t('card.trashed.title')}</h2>
			<p className="text-text-2">{t('card.trashed.body')}</p>
			<div className="flex flex-wrap justify-center gap-2">
				{cheminChannel === null ? null : (
					<Link to={cheminChannel} className={CLASSES_RETOUR}>
						{t('card.trashed.channel')}
					</Link>
				)}
				<Link to={CHEMIN_CORBEILLE} className={CLASSES_RETOUR_SECONDAIRE}>
					{t('card.trashed.trash')}
				</Link>
			</div>
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
