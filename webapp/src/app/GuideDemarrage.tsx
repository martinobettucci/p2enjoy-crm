// @spec CRM-079 (docs/BACKLOG.md) — guide de démarrage : l'écran
// @spec docs/SPEC-onboarding.md §4 (où le guide vit), §4.4 (aucune mesure sans session),
//       §5 (interruption et reprise),
//       §6 (états, et il y en a cinq), §7 (accessibilité et clavier)
// @spec docs/DESIGN_SYSTEM.md §5.17 (de quoi l'écran a l'air), §5.8 (états), §8, §9
// @spec CRM-094 (docs/BACKLOG.md) tranche T2 — docs/SPEC-onboarding.md §10.1 (six étapes), §10.3 (le
//       geste « Créer le workflow de départ », son bouton tenu jusqu'à la re-mesure, le focus rendu au
//       lien de l'étape) ; docs/DESIGN_SYSTEM.md §5.49 ; docs/JOURNAL.md décisions 606 et 607
//
// L'écran LIT et RENVOIE : chaque étape pointe vers l'écran réellement livré qui l'accomplit
// (docs/SPEC-onboarding.md §1.2). Une seule exception depuis `CRM-094`, et elle est nommée : l'étape
// « Workflow » porte le geste qui pose le workflow de départ, parce qu'un espace neuf n'a ni workflow
// ni nœud, et qu'aucun écran ne l'accomplit en un temps (§10.3).
//
// Il n'éteint AUCUN lien. Les écrans visés portent déjà leurs propres refus, mesurés et prouvés par
// leurs unités ; un lien éteint d'après un rôle lu côté client ferait passer une règle de base pour
// une décision d'interface (`CLAUDE.md` §10, §6.3 de la spécification). Le GESTE, lui, n'est rendu
// qu'à qui la base rend `admin` (§10.3) : il écrit, et la base le refuse à tout autre rôle.

import { Circle, CircleCheck, CircleHelp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuthentification } from './Authentification'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { EtatVide } from '../components/ui/States'
import {
	compterAccomplies,
	creerWorkflowDeDepart,
	estAccomplie,
	mesureEnCours,
	resteUneEtape,
	useDemarrage,
	type CleEtapeDemarrage,
	type EtapeDemarrage,
	type IssueWorkflowDepart,
	type ProgressionDemarrage,
} from '../lib/demarrage'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { CHEMIN_ADMIN_ARBORESCENCE, CHEMIN_ADMIN_WORKFLOWS, CHEMIN_DEMARRAGE, CHEMIN_ETAT_MESSAGERIE } from './chemins'
import { useContexteEspace } from './ContexteEspace'
import { useMasqueDemarrage } from './preferences'

/**
 * Ce que chaque étape dit et où elle mène. Une table, et non six blocs de JSX : les six lignes
 * partagent exactement la même composition, et les distinguer structurellement produirait six
 * variantes à maintenir au lieu d'une.
 *
 * `destination` absente pour la première étape : elle est accomplie par la connexion elle-même, et
 * un lien vers l'écran courant serait une commande morte (docs/SPEC-onboarding.md §3).
 */
type DescriptionEtape = {
	readonly cle: CleEtapeDemarrage
	readonly cleTitre: CleTraduction
	readonly cleCorps: CleTraduction
	/**
	 * La phrase qui dit ce que l'appelant VOIT — rendue **uniquement** sur une étape à faire
	 * (docs/SPEC-onboarding.md §6.2).
	 *
	 * TROUVÉ EN REGARDANT UNE CAPTURE, et non par un test : écrite d'abord dans `cleCorps`, elle
	 * s'affichait sous « Fait » et la ligne se contredisait — « Vous n'en voyez aucun » sur une
	 * étape accomplie. Aucune assertion ne pouvait l'attraper, les deux textes étant corrects
	 * séparément.
	 */
	readonly cleVide: CleTraduction
	readonly destination?: string
	readonly cleAction?: CleTraduction
}

export const ETAPES_DEMARRAGE: readonly DescriptionEtape[] = [
	{
		cle: 'espace',
		cleTitre: 'onboarding.step.espace.title',
		cleCorps: 'onboarding.step.espace.body',
		cleVide: 'onboarding.step.espace.vide',
	},
	{
		cle: 'track',
		cleTitre: 'onboarding.step.track.title',
		cleCorps: 'onboarding.step.track.body',
		cleVide: 'onboarding.step.track.vide',
		destination: CHEMIN_ADMIN_ARBORESCENCE,
		cleAction: 'onboarding.step.track.action',
	},
	{
		cle: 'workflow',
		cleTitre: 'onboarding.step.workflow.title',
		cleCorps: 'onboarding.step.workflow.body',
		cleVide: 'onboarding.step.workflow.vide',
		destination: CHEMIN_ADMIN_WORKFLOWS,
		cleAction: 'onboarding.step.workflow.action',
	},
	{
		cle: 'channel',
		cleTitre: 'onboarding.step.channel.title',
		cleCorps: 'onboarding.step.channel.body',
		cleVide: 'onboarding.step.channel.vide',
		destination: CHEMIN_ADMIN_ARBORESCENCE,
		cleAction: 'onboarding.step.channel.action',
	},
	{
		cle: 'affaire',
		cleTitre: 'onboarding.step.affaire.title',
		cleCorps: 'onboarding.step.affaire.body',
		cleVide: 'onboarding.step.affaire.vide',
		destination: CHEMIN_ADMIN_ARBORESCENCE,
		cleAction: 'onboarding.step.affaire.action',
	},
	{
		cle: 'messagerie',
		cleTitre: 'onboarding.step.messagerie.title',
		cleCorps: 'onboarding.step.messagerie.body',
		cleVide: 'onboarding.step.messagerie.vide',
		destination: CHEMIN_ETAT_MESSAGERIE,
		cleAction: 'onboarding.step.messagerie.action',
	},
]

/**
 * Ce que le geste du §10.3 exige : le client et l'espace courant. Absent — `null` —, le geste n'est
 * pas rendu : c'est le cas de tout rôle autre qu'`admin`, et de toute preuve qui monte l'écran seul.
 */
export type GesteDepart = { readonly client: ClientCrm; readonly idWorkspace: string }

/** Le geste n'est offert qu'à qui la base rend `admin`, dans un espace connu (§10.3). */
export function useGesteDepart(client: ClientCrm | null): GesteDepart | null {
	const { idWorkspace, estAdmin } = useContexteEspace()
	return client !== null && idWorkspace !== null && estAdmin ? { client, idWorkspace } : null
}

export type ProprietesVueGuideDemarrage = {
	readonly progression: ProgressionDemarrage
	readonly recharger: () => void
	/** Le geste du §10.3, ou `null` quand il n'est pas offert. */
	readonly geste?: GesteDepart | null
	/**
	 * Commande de masquage — rendue uniquement là où le masquage a un sens, c'est-à-dire sur `/`.
	 * `/demarrage` ignore la préférence et ne propose donc pas de la poser (§4.1, §5).
	 */
	readonly onMasquer?: () => void
}

/**
 * Le rendu, sans mesure : les deux surfaces du §4 mesurent chacune UNE fois et rendent cette vue.
 * Mesurer ici obligerait l'accueil à compter deux fois pour décider puis afficher.
 */
export function VueGuideDemarrage({ progression, recharger, onMasquer, geste = null }: ProprietesVueGuideDemarrage) {
	const { accomplies, total } = compterAccomplies(progression)

	return (
		<section
			data-testid="guide-demarrage"
			aria-labelledby="titre-guide-demarrage"
			className="flex flex-col gap-4 max-w-[70ch]"
		>
			<header className="flex flex-col gap-2">
				<h2 id="titre-guide-demarrage" className="text-h3">
					{t('onboarding.title')}
				</h2>
				<p className="text-text-2">{t('onboarding.intro')}</p>
				<Progression accomplies={accomplies} total={total} progression={progression} />
			</header>

			<ListeEtapesDemarrage progression={progression} recharger={recharger} geste={geste} />

			{onMasquer === undefined ? null : (
				<div className="flex flex-col gap-1">
					<Button variante="secondaire" onClick={onMasquer} data-testid="masquer-guide">
						{t('onboarding.hide')}
					</Button>
					<p className="text-sm text-text-3">{t('onboarding.hide.help')}</p>
				</div>
			)}
		</section>
	)
}

/**
 * La liste ordonnée des étapes — partagée par la page et par le panneau flottant (§5.49) : c'est le
 * même guide dans un autre contenant, jamais une seconde écriture.
 *
 * L'issue ABOUTIE du geste est ANNONCÉE par une région polie : la ligne passe à « Fait », et le bouton
 * qui vient d'agir disparaît avec elle ; sans annonce, une technologie d'assistance ne saurait pas
 * que le geste a abouti (§10.3). La pastille, elle, n'est pas une région vivante : re-mesurée à
 * chaque page, elle ferait annoncer la progression à chaque navigation.
 */
export function ListeEtapesDemarrage({
	progression,
	recharger,
	geste,
}: {
	readonly progression: ProgressionDemarrage
	readonly recharger: () => void
	readonly geste: GesteDepart | null
}) {
	const [annonce, setAnnonce] = useState('')
	return (
		<>
			<ol className="flex flex-col rounded-lg border border-border bg-surface">
				{ETAPES_DEMARRAGE.map((description, rang) => (
					<LigneEtape
						key={description.cle}
						description={description}
						etat={progression.etapes[rang] ?? { statut: 'chargement' }}
						onReprise={recharger}
						geste={description.cle === 'workflow' ? geste : null}
						onGesteAbouti={(issue) => {
							setAnnonce(t(CLES_ANNONCE_DEPART[issue]))
							recharger()
						}}
					/>
				))}
			</ol>
			<p role="status" className="sr-only" data-testid="annonce-demarrage">
				{annonce}
			</p>
		</>
	)
}

/**
 * La progression s'écrit EN TOUTES LETTRES, et la barre qui l'accompagne est décorative
 * (docs/DESIGN_SYSTEM.md §5.17). Une barre seule ne se lit ni à la voix, ni en cas de daltonisme.
 *
 * Tant qu'une mesure est en vol, aucun chiffre n'est écrit : « 0 étape sur 6 » serait faux, et
 * l'annoncer puis le corriger ferait sauter le compte sous les yeux de l'utilisateur.
 */
export function Progression({
	accomplies,
	total,
	progression,
}: {
	readonly accomplies: number
	readonly total: number
	readonly progression: ProgressionDemarrage
}) {
	const enCours = progression.etapes.some((etat) => etat.statut === 'chargement')
	if (enCours) {
		return (
			<p data-testid="progression-demarrage" className="text-sm text-text-2">
				{t('onboarding.progress.loading')}
			</p>
		)
	}
	const largeur = total === 0 ? 0 : Math.round((accomplies / total) * 100)
	return (
		<div className="flex flex-col gap-1">
			<p data-testid="progression-demarrage" className="text-sm text-text-2">
				{t('onboarding.progress', { faites: String(accomplies), total: String(total) })}
			</p>
			<span aria-hidden="true" className="block h-1 rounded-sm bg-hover">
				<span className="block h-1 rounded-sm bg-brand" style={{ width: `${largeur}%` }} />
			</span>
		</div>
	)
}

/**
 * Une ligne, trois états (docs/SPEC-onboarding.md §6.2), et un mot dans chacun : l'icône double le
 * texte, elle ne le remplace pas (docs/DESIGN_SYSTEM.md §1, §9).
 *
 * Une étape accomplie GARDE son lien : on ajoute un second track après le premier.
 */
function LigneEtape({
	description,
	etat,
	onReprise,
	geste,
	onGesteAbouti,
}: {
	readonly description: DescriptionEtape
	readonly etat: EtatAsync<EtapeDemarrage>
	readonly onReprise: () => void
	readonly geste: GesteDepart | null
	readonly onGesteAbouti: (issue: IssueAboutie) => void
}) {
	const lien = useRef<HTMLAnchorElement>(null)
	// Le geste n'a de sens que sur une étape MESURÉE à faire : ni pendant la mesure, ni sur une étape
	// non mesurable — il pourrait créer un second workflow que la base refuserait.
	const offrirGeste = geste !== null && etat.statut === 'pret' && etat.donnees.compte === 0
	return (
		<li
			data-testid={`etape-${description.cle}`}
			className="flex flex-col gap-2 px-4 py-3 border-b border-border last:border-b-0"
		>
			<div className="flex items-start gap-3">
				<MarqueurEtat etat={etat} />
				<div className="flex flex-col gap-1 min-w-0">
					<span className="font-medium">{t(description.cleTitre)}</span>
					<span className="text-sm text-text-2">{t(description.cleCorps)}</span>
					<StatutEtape etat={etat} cleVide={description.cleVide} onReprise={onReprise} />
				</div>
			</div>
			{offrirGeste ? (
				<GesteWorkflowDepart
					geste={geste}
					onAbouti={(issue) => {
						// Le bouton va disparaître avec l'étape accomplie : le focus ne reste jamais sur un
						// élément qui disparaît (docs/DESIGN_SYSTEM.md §5.49). Il passe au lien de la même
						// ligne, qui mène au workflow que la base porte désormais — le geste suivant naturel.
						lien.current?.focus()
						onGesteAbouti(issue)
					}}
				/>
			) : null}
			{description.destination === undefined || description.cleAction === undefined ? null : (
				<Link
					ref={lien}
					to={description.destination}
					data-testid={`lien-${description.cle}`}
					className={[
						'inline-flex items-center self-start',
						'min-h-[var(--size-target)] px-4 rounded-sm',
						'bg-surface text-ink border border-border font-medium',
						'transition-colors duration-[var(--transition-duration-fast)] hover:bg-hover',
					].join(' ')}
				>
					{t(description.cleAction)}
				</Link>
			)}
		</li>
	)
}

/**
 * Les deux issues ABOUTIES du geste : la base porte désormais un workflow, posé à l'instant ou déjà là
 * — un double onglet, un collègue. Dans les deux cas l'étape est accomplie, et le dire comme un refus
 * serait faux : « existant » s'annonce, il ne s'écrit pas en alerte (docs/SPEC-onboarding.md §10.3).
 */
type IssueAboutie = 'cree' | 'existant'

const CLES_ANNONCE_DEPART: Readonly<Record<IssueAboutie, CleTraduction>> = {
	cree: 'onboarding.step.workflow.create.ok',
	existant: 'onboarding.step.workflow.create.existant',
}

/**
 * « Créer le workflow de départ » — le seul bouton PRIMAIRE du guide, parce que c'est la seule action
 * qui s'y accomplit plutôt que d'y mener (docs/DESIGN_SYSTEM.md §5.49).
 *
 * Désactivé pendant l'envoi : un second clic poserait un second appel, que la base refuserait
 * (`workflow existant`) — le refus serait exact, mais l'écran aurait laissé faire un geste inutile.
 * Un refus s'écrit sur la ligne, le bouton restant offert : après une panne, on réessaie.
 *
 * Une issue ABOUTIE le laisse désactivé, « Création… », jusqu'à ce que la re-mesure fasse passer
 * l'étape à « Fait » et le retire. Réactivé à la réponse, il redevenait cliquable pendant la re-mesure
 * — le panneau flottant garde la dernière progression mesurée, où l'étape est encore à faire —, et un
 * second clic aurait valu un refus « existant » sous une étape qui venait de réussir.
 */
function GesteWorkflowDepart({
	geste,
	onAbouti,
}: {
	readonly geste: GesteDepart
	readonly onAbouti: (issue: IssueAboutie) => void
}) {
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<RefusDepart | null>(null)

	const creer = async () => {
		setEnCours(true)
		setRefus(null)
		const issue = await creerWorkflowDeDepart(geste.client, geste.idWorkspace)
		if (issue.ok || issue.raison === 'existant') {
			onAbouti(issue.ok ? 'cree' : 'existant')
			return
		}
		setEnCours(false)
		setRefus(issue)
	}

	return (
		<div className="flex flex-col gap-2 self-start">
			{/* `self-start` : la largeur propre du libellé, comme les liens des étapes — étiré sur la largeur du
			    texte d'aide, il se lisait comme une bande plutôt qu'un bouton (vu sur une capture, décision 607). */}
			<Button
				variante="primaire"
				onClick={() => void creer()}
				disabled={enCours}
				data-testid="creer-workflow-depart"
				className="self-start"
			>
				{enCours ? t('onboarding.step.workflow.create.encours') : t('onboarding.step.workflow.create')}
			</Button>
			<p className="text-sm text-text-3 max-w-[60ch]">{t('onboarding.step.workflow.create.aide')}</p>
			{refus === null ? null : (
				<p role="alert" data-testid="refus-workflow-depart" className="text-sm text-danger-on-soft bg-danger-soft rounded px-2 py-1">
					{refus.raison === 'noeud-archive'
						? t('onboarding.step.workflow.create.refus.noeud-archive', { cle: refus.cle })
						: t(CLES_REFUS_DEPART[refus.raison])}
				</p>
			)}
		</div>
	)
}

/** Les issues qui laissent l'étape à faire, et le geste offert. */
type RefusDepart = Exclude<IssueWorkflowDepart, { ok: true } | { raison: 'existant' }>

const CLES_REFUS_DEPART: Readonly<Record<'reserve' | 'panne', CleTraduction>> = {
	reserve: 'onboarding.step.workflow.create.refus.reserve',
	panne: 'onboarding.step.workflow.create.refus.panne',
}

function MarqueurEtat({ etat }: { readonly etat: EtatAsync<EtapeDemarrage> }) {
	if (etat.statut === 'erreur') {
		return <CircleHelp aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-text-3" />
	}
	if (estAccomplie(etat)) {
		return <CircleCheck aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-success" />
	}
	return <Circle aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-text-3" />
}

/**
 * Le mot qui porte l'état, et lui seul décide.
 *
 * Un refus n'offre AUCUNE reprise : il est définitif tant que la session ne change pas. Une panne
 * en offre une, qui relance réellement les six mesures (docs/SPEC-onboarding.md §6.1).
 */
function StatutEtape({
	etat,
	cleVide,
	onReprise,
}: {
	readonly etat: EtatAsync<EtapeDemarrage>
	readonly cleVide: CleTraduction
	readonly onReprise: () => void
}) {
	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={1} libelle={t('onboarding.step.loading')} className="max-w-[24ch]" />
	}
	if (etat.statut === 'erreur') {
		return (
			<span className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-text-3">{t('onboarding.step.unmeasured')}</span>
				{etat.erreur.nature === 'forbidden' ? null : (
					<Button variante="discret" taille="compacte" onClick={onReprise}>
						{t('state.error.retry')}
					</Button>
				)}
			</span>
		)
	}
	// « Fait » emprunte la teinte de succès du §1 ; « à faire » reste en texte secondaire. La
	// couleur ne porte rien seule — le mot la double —, mais deux états écrits de la même encre
	// obligeraient à lire chaque ligne pour distinguer ce qui reste.
	return estAccomplie(etat) ? (
		<span className="text-sm font-medium text-success">{t('onboarding.step.done')}</span>
	) : (
		<span className="flex flex-col gap-1">
			<span className="text-sm text-text-2">{t('onboarding.step.todo')}</span>
			<span className="text-sm text-text-3">{t(cleVide)}</span>
		</span>
	)
}

// ---------------------------------------------------------------------------------------------
// Les deux surfaces du §4, et elles ne rendent pas la même chose
// ---------------------------------------------------------------------------------------------

/**
 * `/demarrage` — le guide, TOUJOURS (docs/SPEC-onboarding.md §4.1).
 *
 * Même intégralement accompli, même masqué pour la session : c'est ce qui le rend **relançable**.
 * Il n'offre donc pas la commande de masquage — la poser depuis l'écran qui l'ignore n'aurait
 * aucun effet observable, et une commande sans effet est une commande morte.
 */
export type ProprietesSurfaceDemarrage = {
	/** Injecté par les preuves ; l'application emploie le client du produit. Patron déjà posé par
	 * `Corbeille` et `AdministrationArborescence`. */
	readonly client?: ClientCrm | null
	/**
	 * Même patron que `client`, et même statut : un point d'injection pour les preuves unitaires,
	 * que l'application ne renseigne JAMAIS — elle laisse le contexte de session décider.
	 *
	 * Ce que ce drapeau commande est écrit au §4.4 de `docs/SPEC-onboarding.md` : tant que la
	 * session n'est pas ouverte, AUCUNE mesure n'est émise.
	 */
	readonly sessionOuverte?: boolean
}

/**
 * La session est-elle ouverte ? Une seule formulation, partagée par les deux surfaces.
 *
 * `chargement` compte comme fermée : la session se restaure encore, et mesurer maintenant émettrait
 * six requêtes sans jeton dont l'une est vouée au `401` (§4.4). Attendre coûte un rendu ; ne pas
 * attendre salit la console de l'écran d'arrivée.
 */
function useSessionOuverte(declaree: boolean | undefined): boolean {
	const { etat } = useAuthentification()
	return declaree ?? etat.statut === 'authentifie'
}

export function GuideDemarrage({
	client = clientCrm,
	sessionOuverte,
}: ProprietesSurfaceDemarrage = {}) {
	const ouverte = useSessionOuverte(sessionOuverte)
	// `useDemarrage(null)` n'émet rien et laisse les étapes en chargement : c'est exactement ce
	// que le §4.4 demande à `/demarrage` pour un visiteur sans session. L'adresse rend le guide
	// QUAND MÊME — §4.1 est intact —, elle ne pose simplement aucune question à la base.
	const { progression, recharger } = useDemarrage(ouverte ? client : null)
	const geste = useGesteDepart(client)
	return <VueGuideDemarrage progression={progression} recharger={recharger} geste={geste} />
}

/**
 * `/` — l'accueil, et sa décision (docs/SPEC-onboarding.md §4.2).
 *
 * Quatre cas, et l'ordre compte. Le chargement passe AVANT tout : rendre l'état vide pendant que
 * les mesures sont en vol ferait clignoter l'écran d'arrivée et afficherait « aucun board » à qui
 * en a. Une seule mesure sert la décision et le rendu.
 *
 * Un CINQUIÈME cas les précède tous depuis le §4.4 : sans session ouverte, l'accueil rend l'état
 * vide EXISTANT, celui de `CRM-007`, et n'émet aucune mesure. Le guide s'adresse à un compte qui
 * se connecte ; à un visiteur sans session, « créez un premier track » nommerait le mauvais
 * problème, quand la coquille lui dit déjà que son espace de travail est absent.
 */
export function AccueilDemarrage({
	client = clientCrm,
	sessionOuverte,
}: ProprietesSurfaceDemarrage = {}) {
	const ouverte = useSessionOuverte(sessionOuverte)
	const { progression, recharger } = useDemarrage(ouverte ? client : null)
	const { masque, masquer } = useMasqueDemarrage()
	const geste = useGesteDepart(client)

	if (!ouverte) {
		return <EtatVide titre={t('route.board.empty.title')} corps={t('route.board.empty.body')} />
	}
	if (mesureEnCours(progression)) {
		return <VueGuideDemarrage progression={progression} recharger={recharger} geste={geste} />
	}
	if (resteUneEtape(progression) && !masque) {
		return <VueGuideDemarrage progression={progression} recharger={recharger} onMasquer={masquer} geste={geste} />
	}
	return (
		<EtatVide
			titre={t('route.board.empty.title')}
			corps={t('route.board.empty.body')}
			action={
				resteUneEtape(progression) ? (
					// Masqué ne veut pas dire perdu : le lien discret est le chemin de retour promis
					// par la phrase d'aide du bouton de masquage (§5).
					<Link
						to={CHEMIN_DEMARRAGE}
						data-testid="rouvrir-guide"
						className={[
							'inline-flex items-center justify-center',
							'min-h-[var(--size-target)] px-4 rounded-sm',
							'bg-surface text-ink border border-border font-medium',
							'transition-colors duration-[var(--transition-duration-fast)] hover:bg-hover',
						].join(' ')}
					>
						{t('onboarding.reopen')}
					</Link>
				) : undefined
			}
		/>
	)
}
