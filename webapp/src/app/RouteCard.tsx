// @spec CRM-093 (docs/BACKLOG.md) tranche T4 — la fiche lit la capacité d'écrire sur l'affaire et la FOURNIT à ses blocs ;
// @spec CRM-066 (docs/BACKLOG.md) — tranche 4 : le bloc « Santé de l'affaire » sous l'en-tête — docs/DESIGN_SYSTEM.md §5.65
//       refusée par la base, le motif se pose en tête de la colonne de gauche (docs/SPEC-droits-interface.md §2.1, §3 ;
//       docs/DESIGN_SYSTEM.md §5.59)
// @spec CRM-037 (docs/BACKLOG.md) — écran hôte du formulaire conditionnel
// @spec CRM-040 (docs/BACKLOG.md) — les champs d'en-tête de la fiche, en haut de la colonne gauche
// @spec docs/SPEC-cards.md §15.2 (où l'en-tête vit, et pourquoi au-dessus du formulaire)
// @spec CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4c : le bloc des contacts de l'affaire
// @spec CRM-085 (docs/BACKLOG.md) — tranche 2 : la section « Coûts » de la fiche d'affaire
// @spec CRM-063 (docs/BACKLOG.md) — tranche 4 sous-tranche 4c : armer une relance depuis l'affaire
// @spec docs/SPEC-modeles-emails.md §13.8 (le bloc vit dans la colonne gauche, entre les coûts et
//       le geste de corbeille) ; docs/DESIGN_SYSTEM.md §5.42
// @spec docs/SPEC-costs.md §4.6 (la section vit dans la fiche, ce qu'elle liste et ce qu'elle
//       écrit), §4.7 (les états) ; docs/DESIGN_SYSTEM.md §5.3
// @spec docs/SPEC-contacts.md §12.2 (le bloc vit dans la colonne gauche, entre le formulaire et le
//       geste de corbeille) ; docs/DESIGN_SYSTEM.md §5.21
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
//       §4.6 bis (ce que la coquille montre autour du formulaire), §4.5 (états),
//       §4 bis.4 (les identifiants que l'écriture d'une valeur exige)
// @spec docs/SPEC-channels.md §5 (ce que la barre d'onglets lit), §5.4 (toute route portant un
//       `slugTrack` l'alimente par le même chargeur)
// @spec docs/DESIGN_SYSTEM.md §4 (onglets : les channels du track courant), §5.3 (détail de card),
//       §5.8 (états explicites), §7 (responsive)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
// @spec CRM-110 (docs/BACKLOG.md) tranche T2 — le fil d'Ariane d'une affaire : workspace, track, channel, affaire
//       (docs/SPEC-webapp.md §5.1 bis ; docs/DESIGN_SYSTEM.md §5.62)
//
// Le formulaire est la colonne gauche du détail de card (docs/DESIGN_SYSTEM.md §5.3). Il lui faut
// une adresse : c'est le procédé de `CRM-021`, qui a livré la route d'un track parce que la barre
// d'onglets n'avait aucun hôte.
//
// LA COLONNE DE DROITE EST LIVRÉE PAR `CRM-043` : le **panneau de commentaires**
// (docs/DESIGN_SYSTEM.md §5.10), que `CRM-044` a fondu dans la timeline unifiée.
//
// LES CHAMPS D'EN-TÊTE SONT LIVRÉS PAR `CRM-040` (docs/SPEC-cards.md §15), en HAUT de la colonne
// gauche : titre, responsable, montant, prochaine action et son échéance, plus l'adresse email de
// l'affaire et son action de copie. Leur ÉCRITURE reste due — les privilèges existent, le geste
// non (§15.1).
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
// @spec CRM-098 (docs/BACKLOG.md) — tranche T3 : le bloc « Temps passé » de la fiche (docs/SPEC-temps.md §7.5)
// @spec CRM-106 (docs/BACKLOG.md) — tranche T2 : la bande de la semaine du bloc, pour la personne connectée
//       (docs/SPEC-temps.md §7.6, docs/DESIGN_SYSTEM.md §5.54 bis)
// @spec CRM-108 (docs/BACKLOG.md) tranche T3 — blocs « Recettes » et « Rentabilité » de la fiche (docs/SPEC-recettes.md §6.1,
//       §6.2 ; docs/DESIGN_SYSTEM.md §5.60)
// @spec CRM-068 (docs/BACKLOG.md) tranche T3a — le bloc « Checklist », juste après le formulaire, et la relecture du fil
//       après chacun de ses gestes (docs/SPEC-checklists.md §4 ; docs/DESIGN_SYSTEM.md §5.70)
// @spec CRM-067 (docs/BACKLOG.md) tranche T2 — le bloc « Activités », juste après les contacts, et la relecture du fil
//       après chacun de ses gestes (docs/SPEC-activites.md §4 ; docs/DESIGN_SYSTEM.md §5.63)

import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { projeterChannels, useContenuTrack } from '../lib/channels'
import { ancetresAffaire } from '../lib/fil-ariane'
import { mettreCardALaCorbeille, type NatureRefusGeste } from '../lib/corbeille'
import { lireClesExigees, useContenuCard, type ModeleFormulaire } from '../lib/formulaire'
import { estAdministrateur, useRoleWorkspace } from '../lib/roles'
import { idRattachement } from '../lib/rattachements'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'
import { AppShell } from './AppShell'
import { BlocActivitesCard } from './BlocActivitesCard'
import { BlocChecklistCard } from './BlocChecklistCard'
import { BlocSanteCard } from './BlocSanteCard'
import { BlocContactsCard } from './BlocContactsCard'
import { BlocCoutsCard } from './BlocCoutsCard'
import { BlocRecettesCard } from './BlocRecettesCard'
import { BlocRentabiliteCard } from './BlocRentabiliteCard'
import { BlocTempsCard } from './SeriePersonnel'
import { BlocSequenceCard } from './BlocSequenceCard'
import { EnTeteCard } from './EnTeteCard'
import { FormulaireCard } from './FormulaireCard'
import { FormulaireEnvoi } from './FormulaireEnvoi'
import { PanneauTimeline } from './PanneauTimeline'
import { CHEMIN_CORBEILLE } from './routes'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { FournisseurRefus, useRefus } from '../components/ui/RefusCommandes'
import { motifVisible, proprietesCommande, useEcriturePermise } from '../lib/capacites'

/** Le motif de la fiche, cité par ses commandes quand la base refuse l'écriture sur l'affaire (CRM-093). */
const ID_MOTIF_CARD = 'fiche-affaire-lecture-seule'

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
	// LES CHAMPS EXIGÉS PAR UN DÉPLACEMENT REFUSÉ — docs/SPEC-form-composer.md §4 ter.2. L'adresse
	// est le seul transport : elle survit au rechargement, fait du bandeau du board un vrai lien,
	// et rend inspectable ce que la fiche sait du refus. Aucune requête n'en dépend — les champs
	// sont déjà tous lus pour le workflow, la clé n'entre que dans la composition.
	const [parametres] = useSearchParams()
	const clesExigees = lireClesExigees(parametres.get('exiges'))
	const { etat, recharger } = useContenuCard(clientCrm, idCard, clesExigees)
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

	// `CRM-110` (§5.1 bis) — le track et le channel lus pour la barre d'onglets nomment le chemin de l'affaire.
	const ancetres = ancetresAffaire(
		etatTrack.statut === 'pret' ? etatTrack.donnees.track : null,
		etatTrack.statut === 'pret' ? etatTrack.donnees.channels : [],
		slugChannel,
	)

	return (
		<AppShell
			cleTitreRoute={CLE_TITRE_CARD}
			{...(card === null ? {} : { titreRoute: card.title })}
			ancetres={ancetres}
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

	// `CRM-093` — LA CAPACITÉ D'ÉCRIRE SUR L'AFFAIRE, rendue par la base sur sa ligne (§2.1), lue à part de l'affaire
	// elle-même : un défaut de lecture n'efface que l'aide d'interface (§4). Le hook précède tout retour anticipé.
	const idDeLaCard = etat.statut === 'pret' ? (etat.donnees.card?.id ?? null) : null
	const capaciteCard = useEcriturePermise(clientCrm, 'cards', idDeLaCard)
	const droitCard = proprietesCommande(capaciteCard, ID_MOTIF_CARD)

	// L'AFFAIRE A ÉTÉ RETIRÉE PENDANT CETTE VISITE — §4 ter.5. L'état vit ici, et non dans le bloc du
	// geste, parce qu'il décide de TOUT l'écran : la card quitte la lecture de sa propre route
	// (`deleted_at=is.null`, MESURÉ), et une relecture ne rendrait plus rien à afficher. Il n'est
	// jamais dérivé de la donnée : c'est le résultat du `PATCH` qui le pose.
	const [retiree, setRetiree] = useState(false)
	// `CRM-108` : une recette écrite fait relire la rentabilité de la fiche (docs/SPEC-recettes.md §6.2).
	const [relectureRentabilite, setRelectureRentabilite] = useState(0)
	const relireRentabilite = useCallback(() => setRelectureRentabilite((n) => n + 1), [])
	// `CRM-067` : un geste du bloc « Activités » fait relire la troisième source du fil (docs/DESIGN_SYSTEM.md §5.63).
	const [relectureActivites, setRelectureActivites] = useState(0)
	const relireActivites = useCallback(() => setRelectureActivites((n) => n + 1), [])
	// `CRM-068` T3a : un cochage écrit une ligne de `card_events`, que le fil relit (docs/DESIGN_SYSTEM.md §5.70).
	const [relectureEvenements, setRelectureEvenements] = useState(0)
	const relireEvenements = useCallback(() => setRelectureEvenements((n) => n + 1), [])
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
		<FournisseurRefus valeur={droitCard}>
		<div className="mx-auto max-w-[104rem] grid gap-6 px-4 py-6 lg:grid-cols-[minmax(0,72ch)_minmax(0,1fr)]">
			<div className="flex flex-col gap-6 min-w-0">
				{motifVisible(capaciteCard) ? (
					<MotifLectureSeule id={ID_MOTIF_CARD}>{t('rights.readonly.card')}</MotifLectureSeule>
				) : null}
				{/* L'EN-TÊTE EST EN HAUT DE CETTE COLONNE — CRM-040, docs/SPEC-cards.md §15.2. Il dit ce
				    QU'EST l'affaire, là où le formulaire dit ce qu'on en sait ; et le bas de la colonne
				    est déjà pris par le geste de retrait. Placé en dessous, il aurait de plus été poussé
				    hors de vue par le défilement de la reprise d'un déplacement refusé (§4 ter). */}
				<EnTeteCard card={etat.donnees.card} />
				{/* LES DEUX SCORES DE SANTÉ — `CRM-066` tranche 4, docs/DESIGN_SYSTEM.md §5.65 : sous l'en-tête, qui dit ce
				    qu'est l'affaire ; les scores disent comment elle va. Aucun bloc pour une affaire décidée. */}
				<BlocSanteCard idCard={etat.donnees.card.id} />
				{/* LES TROIS IDENTIFIANTS VIENNENT DE LA CARD DÉJÀ CHARGÉE (§4 bis.4) : l'écriture
				    d'une valeur les exige tous — clé primaire, charnière des clés composites et
				    colonne dénormalisée pour la RLS —, et les relire serait une requête pour une
				    donnée en main. */}
				<FormulaireCard
					modele={etat.donnees.modele}
					idCard={etat.donnees.card.id}
					rattachements={etat.donnees.card}
					idWorkflow={etat.donnees.card.workflow_id}
					idWorkspace={etat.donnees.card.workspace_id}
				/>
				{/* LA CHECKLIST — `CRM-068` T3a, docs/SPEC-checklists.md §4 : juste après le formulaire — les points disent ce qu'il
				    reste à faire dans l'étape, à côté des questions qui disent ce qu'on en sait (docs/DESIGN_SYSTEM.md §5.70). Le
				    rattachement et son étape viennent de l'affaire déjà chargée. */}
				<BlocChecklistCard
					idCard={etat.donnees.card.id}
					idWorkspace={etat.donnees.card.workspace_id}
					idRattachement={idRattachement(etat.donnees.card)}
					idEtapeCourante={etat.donnees.card.current_step_id}
					onChange={relireEvenements}
				/>
				{/* LES CONTACTS DE L'AFFAIRE — CRM-060 sous-tranche 4c, docs/SPEC-contacts.md §12.2.
				    Ils vivent ENTRE le formulaire et le bloc de corbeille, et les deux bornes sont déjà
				    écrites au §5.3 : la colonne DROITE raconte et n'accueille aucun geste, et le retrait
				    reste EN BAS « parce qu'un retrait n'est pas ce qu'on vient faire sur une fiche ». Les
				    contacts d'une affaire appartiennent à son dossier, donc ils se lisent avec lui.
				    Les deux identifiants viennent de la card DÉJÀ chargée : la FK composite exige le
				    workspace, et le relire serait une requête pour une donnée en main (§4 bis.4). */}
				<BlocContactsCard
					idCard={etat.donnees.card.id}
					idWorkspace={etat.donnees.card.workspace_id}
				/>
				{/* LES ACTIVITÉS — `CRM-067`, docs/SPEC-activites.md §4 : juste après les contacts — avec qui l'affaire se traite,
				    puis ce qu'on a fait avec eux — et avant l'argent (docs/DESIGN_SYSTEM.md §5.63). L'identité de session et le
				    rôle n'y décident que des commandes OFFERTES ; les politiques de `card_activities` tiennent la règle. */}
				<BlocActivitesCard
					idCard={etat.donnees.card.id}
					idWorkspace={etat.donnees.card.workspace_id}
					idUtilisateur={idUtilisateur}
					estAdminWorkspace={estAdministrateur(role.etat)}
					onChange={relireActivites}
				/>
				{/* LES COÛTS DE L'AFFAIRE — CRM-085 tranche 2, docs/SPEC-costs.md §4.6. Ils vivent
				    ENTRE les contacts et le bloc de corbeille, pour la raison qui a déjà placé les
				    contacts là : la colonne DROITE raconte et n'accueille aucun geste, et le retrait
				    reste EN BAS. Une dépense appartient au dossier de l'affaire, donc elle se lit avec
				    lui — et après les contacts, qui disent AVEC QUI l'affaire se traite avant de dire
				    ce qu'elle coûte.
				    Le titre nomme la section dans son étiquette accessible ; aucune autre donnée de la
				    card n'est nécessaire — la section lit son track depuis le CHANNEL de l'affaire et
				    non depuis l'adresse, que rien ne confronte à la card (INC-065). */}
				{/* LES RECETTES — `CRM-108`, docs/SPEC-recettes.md §6.1 : AVANT les coûts — on lit ce que l'affaire rapporte avant
				    ce qu'elle coûte, l'ordre du calcul (docs/DESIGN_SYSTEM.md §5.60). Leur devise est celle de l'affaire. */}
				<BlocRecettesCard
					client={clientCrm}
					idCard={etat.donnees.card.id}
					titreCard={etat.donnees.card.title}
					devise={etat.donnees.card.currency}
					onChange={relireRentabilite}
				/>
				<BlocCoutsCard
					client={clientCrm}
					idCard={etat.donnees.card.id}
					titreCard={etat.donnees.card.title}
				/>
				{/* LE TEMPS PASSÉ — `CRM-098` tranche T3, docs/SPEC-temps.md §7.5 : APRÈS les coûts et à côté d'eux, jamais
				    mêlé à leurs lignes (décision 621, point 8). Sa portée est écrite : un membre n'y lit que son temps. */}
				{/* `CRM-106` (docs/SPEC-temps.md §7.6) : le bloc porte aussi la bande de la semaine, qui ne saisit que le temps
				    de la personne connectée et n'obéit pas au motif de lecture seule de la fiche — le temps décrit la personne. */}
				<BlocTempsCard
					client={clientCrm}
					idCard={etat.donnees.card.id}
					{...(idUtilisateur === null
						? {}
						: { saisie: { idWorkspace: etat.donnees.card.workspace_id, idUtilisateur, titreCard: etat.donnees.card.title } })}
				/>
				{/* LA RENTABILITÉ — `CRM-108`, docs/SPEC-recettes.md §6.2 : après le temps passé, qu'elle soustrait. Absente pour qui
				    la base la refuse (`42501`) : un refus de la base, jamais un rôle lu par l'écran. */}
				<BlocRentabiliteCard
					client={clientCrm}
					idCard={etat.donnees.card.id}
					idWorkspace={etat.donnees.card.workspace_id}
					relecture={relectureRentabilite}
				/>
				{/* ARMER UNE RELANCE — CRM-063 sous-tranche 4c, docs/SPEC-modeles-emails.md §13.8.
				    Le bloc vit ENTRE les coûts et le bloc de corbeille, pour la raison qui a déjà placé
				    les contacts et les coûts là : la colonne DROITE raconte et n'accueille aucun geste,
				    et le retrait reste EN BAS. Armer une cadence est un geste SUR l'affaire, non un
				    réglage — `armer_sequence_relance` prend le RATTACHEMENT de l'affaire (`CRM-111` T2.3.5)
				    et exige qu'il soit figé (§13.1 question 3).
				    L'ÉCRAN NE CALCULE PAS SI L'AFFAIRE EST FIGÉE : `public.cards_figees()` porte cette
				    définition une seule fois, et le refus `card_not_stalled` est TRADUIT. */}
				<BlocSequenceCard
					idCard={etat.donnees.card.id}
					rattachements={etat.donnees.card}
				/>
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
				relectureActivites={relectureActivites}
				relectureEvenements={relectureEvenements}
				/>
			</div>
		</div>
		</FournisseurRefus>
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
	const droit = useRefus()
	const [phase, setPhase] = useState<PhaseGeste>('inactif')
	const [message, setMessage] = useState<string | null>(null)
	const commande = useRef<HTMLButtonElement>(null)
	/**
	 * Le focus est rendu APRÈS le rendu, et c'est un défaut trouvé par la preuve clavier.
	 *
	 * La commande est DÉMONTÉE tant que la confirmation est ouverte : appeler `focus()` depuis le
	 * gestionnaire d'annulation vise une référence nulle, et le focus retombe sur le corps du
	 * document — exactement ce que le §5.13 du design system interdit. L'intention est donc posée
	 * ici, et honorée par l'effet ci-dessous quand la commande est de nouveau montée.
	 */
	const [focusARendre, setFocusARendre] = useState(false)

	useEffect(() => {
		if (phase !== 'inactif' || !focusARendre) return
		commande.current?.focus()
		setFocusARendre(false)
	}, [focusARendre, phase])

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
		setFocusARendre(true)
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
					<Button ref={commande} {...droit} onClick={() => setPhase('confirmation')}>
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
			className="mx-auto max-w-[72ch] flex flex-col gap-3 px-4 py-8 text-center"
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
