// @spec CRM-044 (docs/BACKLOG.md) — timeline unifiée du détail de card
// @spec CRM-043 (docs/BACKLOG.md) — le fil des commentaires, que cette unité REPREND
// @spec CRM-022 (docs/BACKLOG.md) — auteurs et acteurs nommés sans UUID
// @spec docs/SPEC-cards.md §14.10 (ce que le fil unifié montre), §13.10 (le panneau que
//       `CRM-043` a livré et que le §5.10 annonçait comme « la première voie d'un fil unifié »),
//       §13.4 (la pierre tombale), §13.5 (la mention « modifié »), §13.6 (le refus vient du
//       backend), §14.6 (aucun libellé dans le `payload`)
// @spec docs/DESIGN_SYSTEM.md §5.11 (timeline unifiée), §5.10 (panneau de commentaires),
//       §5.3 (détail de card), §5.8 (états systématiques), §7 (responsive), §8 (accessibilité),
//       §9 (icônes Lucide), §12.3 (libellé masqué), §12.5 (aucune donnée illisible rendue)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone), §11 (aucun stockage côté client)
// @spec docs/JOURNAL.md décisions 201 (le flux déclenche la lecture), 209 (le fil est unifié à la
//       LECTURE)
//
// LE COMPOSANT NE PORTE AUCUNE RÈGLE. L'ordre du fil, la fusion des deux sources, les familles de
// filtres, la résolution des libellés et la classification des refus vivent dans
// `webapp/src/lib/timeline.ts` et `webapp/src/lib/commentaires.ts`, vérifiables sans navigateur.
// Ici, on rend.
//
// DEUX SOURCES, UN FIL (décision 209). Les commentaires et les événements sont lus séparément —
// deux tables, deux politiques — puis rangés ensemble sur `(created_at, clé)`. Un commentaire
// n'écrit AUCUN événement : le dupliquer produirait deux représentations d'un même fait, dont
// l'une, immuable, survivrait à la pierre tombale de l'autre.
//
// LE FILTRE EST UNE VUE, JAMAIS UNE REQUÊTE. Filtrer ne relance rien : les deux sources sont déjà
// chargées. Un filtre qui rechargerait ferait dépendre le contenu du fil de l'état d'un contrôle
// d'interface, et rendrait l'état vide ambigu.
//
// LE COMPOSEUR EST TOUJOURS RENDU, et c'est délibéré (`CLAUDE.md` §10) : l'interface ne calcule
// aucun droit d'écriture, elle envoie et traduit le refus du backend.
//
// Les auteurs et acteurs viennent de relations PostgREST embarquées. Un commentaire détaché nomme
// « Compte supprimé » ; un acteur nul reste muet, car ce `null` peut aussi désigner le service.

import {
	Archive,
	ArchiveRestore,
	ArrowRightLeft,
	FolderSync,
	PencilLine,
	RotateCcw,
	Mail,
	Sparkles,
	Trash2,
	UserRoundCog,
	Workflow,
	type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { Avatar } from '../components/ui/Avatar'
import { LiveRegion } from '../components/ui/LiveRegion'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import {
	modifierCommentaire,
	publierCommentaire,
	supprimerCommentaire,
	useFilCommentaires,
	type CommentaireAffiche,
	type NatureRefusPublication,
	type ResultatGeste,
} from '../lib/commentaires'
import { lireMessagesDeCard } from '../lib/inbox'
import type { ClientCrm } from '../lib/supabase'
import {
	FAMILLES,
	compterParFamille,
	filtrer,
	fusionnerFil,
	lireEtapesWorkflow,
	lireEvenements,
	resoudreDetail,
	type ComptesFamille,
	type Famille,
	type FamillesActives,
	type LibellesFil,
	type LigneEvenement,
	type LigneFil,
} from '../lib/timeline'

/**
 * Libellé, icône et pastille de chaque type — écrits UNE FOIS, jamais construits par
 * concaténation (`CLAUDE.md` §23, docs/DESIGN_SYSTEM.md §5.11).
 *
 * Les couleurs sont celles du §1 du design system, à travers les classes Tailwind du projet :
 * aucune teinte n'est inventée ici.
 */
const PRESENTATION: Readonly<
	Record<string, { readonly cle: CleTraduction; readonly icone: LucideIcon; readonly pastille: string }>
> = {
	created: { cle: 'timeline.event.created', icone: Sparkles, pastille: 'bg-success-soft text-success' },
	moved: { cle: 'timeline.event.moved', icone: ArrowRightLeft, pastille: 'bg-brand-soft text-brand' },
	channel_changed: { cle: 'timeline.event.channel_changed', icone: FolderSync, pastille: 'bg-accent-soft text-ink' },
	workflow_changed: { cle: 'timeline.event.workflow_changed', icone: Workflow, pastille: 'bg-brand-soft text-brand' },
	assigned: { cle: 'timeline.event.assigned', icone: UserRoundCog, pastille: 'bg-accent-soft text-ink' },
	archived: { cle: 'timeline.event.archived', icone: Archive, pastille: 'bg-hover text-text-3' },
	unarchived: { cle: 'timeline.event.unarchived', icone: ArchiveRestore, pastille: 'bg-accent-soft text-ink' },
	trashed: { cle: 'timeline.event.trashed', icone: Trash2, pastille: 'bg-hover text-text-3' },
	restored: { cle: 'timeline.event.restored', icone: RotateCcw, pastille: 'bg-success-soft text-success' },
	field_changed: { cle: 'timeline.event.field_changed', icone: PencilLine, pastille: 'bg-hover text-text-3' },
	// `CRM-057` §18.6 — le fil cesse de montrer un événement sans détail : il nomme le courrier.
	mail_received: { cle: 'timeline.event.mail_received', icone: Mail, pastille: 'bg-brand-soft text-brand' },
}

/**
 * Repli d'un type inconnu, **documenté** — même règle que la pilule de track du §5.5 bis : la
 * valeur vient du backend, et un type ne garantit jamais une valeur (`docs/SPEC-types.md`).
 *
 * L'ANNONCE S'EST VÉRIFIÉE, ET LE REPLI A JOUÉ. `CRM-055` a écrit `mail_received`, et le fil l'a
 * montré comme un événement sans détail plutôt que de le faire disparaître. `CRM-057` le nomme
 * désormais, avec son objet et son expéditeur (§18.6) : le repli redevient ce qu'il est, une
 * garantie pour le type d'après. Une mémoire ne cache pas ce qu'elle ne comprend pas.
 */
const REPLI = {
	cle: 'timeline.event.unknown' as CleTraduction,
	icone: Sparkles,
	pastille: 'bg-hover text-text-3',
}

const LIBELLES_FILTRES: Readonly<Record<Famille, CleTraduction>> = {
	discussion: 'timeline.filter.discussion',
	etapes: 'timeline.filter.etapes',
	champs: 'timeline.filter.champs',
	organisation: 'timeline.filter.organisation',
	cycle: 'timeline.filter.cycle',
}

/** Traductions des refus, écrites une fois — le composant n'en construit aucune. */
const CLES_REFUS: Readonly<Record<NatureRefusPublication, Parameters<typeof t>[0]>> = {
	forbidden: 'comments.refus.forbidden',
	invalide: 'comments.refus.invalide',
	supprime: 'comments.refus.supprime',
	moderation: 'comments.refus.moderation',
	network: 'comments.refus.network',
	unknown: 'comments.refus.unknown',
}

/**
 * Alias de la promesse rendue par un geste d'auteur.
 *
 * Il fut d'abord un contournement : écrite `=> Promise<boolean>`, la signature faisait un faux
 * positif du contrôle de textes en dur de `i18n.test.ts`, dont l'expression régulière voyait un
 * nœud JSX dans la suite `>`…`<` (INC-070). Le contrôle lit désormais l'arbre syntaxique, et une
 * signature générique n'y est pas un texte (`docs/JOURNAL.md` décisions 296 et 381).
 *
 * L'alias est CONSERVÉ, parce qu'il nomme la valeur de retour commune aux deux gestes d'auteur et
 * se lit mieux que la signature répétée. Ce qui disparaît est la raison contrainte de l'écrire.
 */
type PromesseGeste = Promise<boolean>

export type ProprietesPanneauTimeline = {
	readonly client: ClientCrm | null
	readonly idCard: string
	/**
	 * Le workspace de la card, tel que la route l'a lu.
	 *
	 * Il n'est **pas** décidé ici : le trigger de la migration 15 le remplace par celui de la card
	 * (décision 200). Il traverse le composant parce que le générateur de types, qui ne voit pas
	 * les triggers, déclare la colonne obligatoire à l'insertion.
	 */
	readonly idWorkspace: string
	/** Le workflow de la card : il sert à résoudre les libellés d'étape des événements `moved`. */
	readonly idWorkflow: string
	/**
	 * Les libellés des champs, tels que la fiche les a DÉJÀ chargés.
	 *
	 * Ils ne sont pas relus : le formulaire les porte, et une seconde requête pour la même donnée
	 * serait un coût sans contrepartie. Ils ne viennent jamais du `payload` d'un événement (§14.6).
	 */
	readonly libellesChamps: LibellesFil['champs']
	/**
	 * L'identifiant de la session, ou `null` hors session.
	 *
	 * Il ne sert QU'À NE PAS OFFRIR un geste voué au refus : la règle est tenue par la politique
	 * `UPDATE` de `card_comments`, qui exige `author_id = auth.uid()` et le droit d'écriture
	 * courant. Ce n'est donc pas un contrôle d'accès (`CLAUDE.md` §10), et le backend reste seul
	 * juge — y compris lorsque cette comparaison se trompe.
	 */
	readonly idUtilisateur: string | null
	/**
	 * Vrai si l'appelant est `admin` du workspace de la card — décision 376, INC-072.
	 *
	 * MÊME NATURE QUE `idUtilisateur`, ET MÊME LIMITE : ce n'est PAS un contrôle d'accès
	 * (`CLAUDE.md` §10). La règle est tenue par la politique `card_comments_moderation`, qui juge
	 * sur `app.is_workspace_admin` et `app.can_read_card`. Ce booléen ne sert qu'à ne pas offrir un
	 * geste voué au néant : MESURÉ, un non-administrateur qui tenterait le `PATCH` recevrait `200`
	 * et **zéro ligne**, soit un bouton qui ne dit rien et ne fait rien — la commande morte que le
	 * §5.10 du design system refuse. Lorsqu'il se trompe, `sans-effet` le dit.
	 */
	readonly estAdminWorkspace: boolean
}

export function PanneauTimeline({
	client,
	idCard,
	idWorkspace,
	idWorkflow,
	libellesChamps,
	idUtilisateur,
	estAdminWorkspace,
}: ProprietesPanneauTimeline) {
	const { etat, recharger, reprendre } = useFilCommentaires(client, idCard)
	const [brouillon, setBrouillon] = useState('')
	const [envoiEnCours, setEnvoiEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusPublication | null>(null)
	// Le refus silencieux du `USING` n'est pas une nature de refus HTTP : il a son propre état,
	// et son propre message. Les fondre rendrait l'un des deux invisible.
	const [sansEffet, setSansEffet] = useState(false)
	const [annonce, setAnnonce] = useState('')
	// Le champ de composition, pour lui rendre le focus après une publication réussie (décision 315).
	const zoneComposition = useRef<HTMLTextAreaElement>(null)

	// LES ÉVÉNEMENTS SONT LUS SÉPARÉMENT DES COMMENTAIRES, et relus chaque fois que le fil des
	// commentaires change : `card_events` n'est PAS publiée au temps réel (§14.1), et un
	// commentaire publié depuis cet écran peut avoir été précédé d'un déplacement fait ailleurs.
	// Le coût — une requête de plus par événement de commentaire — est nommé au §14.13.
	const [evenements, setEvenements] = useState<readonly LigneFil[]>([])
	const [libellesEtapes, setLibellesEtapes] = useState<LibellesFil['etapes']>(new Map())
	// Les messages classés dans cette card — `CRM-057` §18.6. Ils sont relus en même temps que les
	// événements : un classement fait depuis l'inbox ajoute un `mail_received` que le fil doit
	// pouvoir nommer sans attendre un rechargement complet.
	const [libellesMessages, setLibellesMessages] = useState<ReadonlyMap<string, string>>(new Map())
	// AUCUNE PERSISTANCE (`CLAUDE.md` §11) : ni `localStorage`, ni `sessionStorage`. L'état d'un
	// filtre n'est pas nécessaire au fonctionnement, et repartir complet est la seule valeur qui
	// ne cache jamais rien.
	const [actives, setActives] = useState<FamillesActives>(() => new Set(FAMILLES))

	useEffect(() => {
		if (client === null) return
		let vivant = true
		void (async () => {
			const resultat = await lireEvenements(client, idCard)
			if (!vivant) return
			// Une lecture d'événements en échec ne rend PAS le fil indisponible : les commentaires
			// portent leur propre état, et un fil amputé vaut mieux qu'un panneau muet. L'échec se
			// voit — le compte de la famille tombe à zéro.
			setEvenements(resultat.statut === 'pret' ? resultat.donnees : [])
		})()
		return () => {
			vivant = false
		}
	}, [client, idCard, etat])

	useEffect(() => {
		if (client === null) return
		let vivant = true
		void (async () => {
			const libelles = await lireEtapesWorkflow(client, idWorkflow)
			if (vivant) setLibellesEtapes(libelles)
		})()
		return () => {
			vivant = false
		}
	}, [client, idWorkflow])

	// LA LECTURE N'A LIEU QUE S'IL Y A QUELQUE CHOSE À NOMMER. Une requête émise sur toutes les
	// fiches serait doublement fautive : inutile sur les neuf dixièmes des cards, qui n'ont reçu
	// aucun courrier, et bruyante pour un appelant sans droit — mesuré, elle laissait un `401`
	// dans la console de chaque preuve d'interface à session anonyme, ce que `CRM-007` interdit.
	const porteDuCourrier = useMemo(
		() => evenements.some((ligne) => ligne.genre === 'evenement' && ligne.type === 'mail_received'),
		[evenements],
	)

	useEffect(() => {
		if (!porteDuCourrier) {
			setLibellesMessages(new Map())
			return
		}
		let vivant = true
		void (async () => {
			const messages = await lireMessagesDeCard(client, idCard)
			if (!vivant) return
			setLibellesMessages(
				new Map(
					[...messages].map(([identifiant, message]) => [
						identifiant,
						// L'OBJET PUIS L'EXPÉDITEUR, dans un seul libellé résolu : le §5.11 interdit de
						// composer une phrase par concaténation à l'affichage, pas de nommer ici ce
						// que la ligne désigne.
						t('timeline.mail.summary', { objet: message.objet, expediteur: message.expediteur }),
					]),
				),
			)
		})()
		return () => {
			vivant = false
		}
	}, [client, idCard, porteDuCourrier])

	const commentaires = etat.statut === 'pret' ? etat.donnees : []
	const fil = useMemo(() => fusionnerFil(commentaires, evenements), [commentaires, evenements])
	const comptes = useMemo(() => compterParFamille(fil), [fil])
	const visibles = useMemo(() => filtrer(fil, actives), [fil, actives])

	function basculer(famille: Famille) {
		setActives((precedentes) => {
			const suivantes = new Set(precedentes)
			if (suivantes.has(famille)) suivantes.delete(famille)
			else suivantes.add(famille)
			return suivantes
		})
	}

	async function publier(evenement: FormEvent) {
		evenement.preventDefault()
		if (client === null || envoiEnCours) return
		setEnvoiEnCours(true)
		setRefus(null)
		const resultat = await publierCommentaire(client, {
			idCard,
			idWorkspace,
			corps: brouillon,
		})
		setEnvoiEnCours(false)
		if (resultat.statut === 'refus') {
			// LE TEXTE SAISI EST CONSERVÉ (docs/DESIGN_SYSTEM.md §5.10) : le vider ferait perdre à
			// l'utilisateur un texte pour une erreur qui n'est pas la sienne.
			setRefus(resultat.refus.nature)
			return
		}
		setBrouillon('')
		setAnnonce(t('live.comments.published'))
		// LE FOCUS RETOURNE DANS LE CHAMP, ET CE N'EST PAS UN CONFORT (décision 315). Le bouton
		// « Publier » devient DÉSACTIVÉ dès que le brouillon est vidé : le navigateur lui retire
		// alors le focus et le rend au `body`. Un utilisateur qui vient de publier au clavier est
		// donc renvoyé en haut du document, et doit retraverser la page pour écrire la phrase
		// suivante. Le champ qu'il vient de quitter est le seul endroit sensé (`docs/DESIGN_SYSTEM.md`
		// §8). Mesuré par la preuve clavier, qui perdait le focus une fois sur trois.
		zoneComposition.current?.focus()
		// Le flux relira de lui-même (décision 201) ; ce rechargement est ce qui rend l'écran juste
		// même lorsque l'abonnement a échoué — auquel cas rien d'autre ne le mettrait à jour.
		recharger()
	}

	/**
	 * Applique un geste d'auteur et rend `true` s'il a réellement porté.
	 *
	 * TROIS ISSUES, ET AUCUNE N'EST CONFONDUE AVEC UNE AUTRE. Un refus HTTP est nommé ; un `200`
	 * rendant zéro ligne — le `USING` de la politique a filtré, ligne *j* du §13.8 — est nommé
	 * lui aussi, avec son propre message : c'est le cas exact où l'écran croyait pouvoir offrir
	 * le geste et où le backend a dit non sans erreur. Le confondre avec un succès afficherait
	 * une modification qui n'a pas eu lieu.
	 */
	async function appliquer(
		geste: () => PromesseResultat,
		cleAnnonce: Parameters<typeof t>[0],
	): PromesseGeste {
		if (client === null) return false
		setRefus(null)
		setSansEffet(false)
		const resultat = await geste()
		if (resultat.statut === 'refus') {
			setRefus(resultat.refus.nature)
			return false
		}
		if (resultat.statut === 'sans-effet') {
			setSansEffet(true)
			// Le fil est relu quand même : si la ligne a changé sous nos pieds, l'écran doit
			// montrer son état réel plutôt que celui sur lequel le geste a été tenté.
			recharger()
			return false
		}
		setAnnonce(t(cleAnnonce))
		recharger()
		return true
	}

	return (
		<section aria-label={t('comments.aria')} className="flex flex-col gap-4">
			<h2 className="text-base font-medium text-ink">{t('comments.title')}</h2>

			<LiveRegion libelle={t('live.comments.aria')} message={annonce} />

			{/*
			 * LA BARRE N'EST RENDUE QUE S'IL Y A QUELQUE CHOSE À FILTRER (décision 212, VU SUR
			 * `fil-vide-1440.jpg`) : cinq bascules affichant « 0 » au-dessus de « aucun
			 * événement » sont un contrôle sans objet. Le seuil porte sur le fil CHARGÉ, non sur
			 * le fil filtré — sans quoi éteindre toutes les familles ferait disparaître le moyen
			 * de les rallumer.
			 */}
			{fil.length === 0 ? null : (
				<BarreFiltres comptes={comptes} actives={actives} onBasculer={basculer} />
			)}

			<Fil
				etat={etat}
				lignes={visibles}
				totalCharge={fil.length}
				libelles={{ etapes: libellesEtapes, champs: libellesChamps, messages: libellesMessages }}
				onReprise={reprendre}
				idUtilisateur={idUtilisateur}
				estAdminWorkspace={estAdminWorkspace}
				onModifier={(idCommentaire, corps) =>
					appliquer(
						async () => await modifierCommentaire(client as ClientCrm, idCommentaire, corps),
						'live.comments.edited',
					)
				}
				onSupprimer={(idCommentaire, parModeration) =>
					appliquer(
						async () => await supprimerCommentaire(client as ClientCrm, idCommentaire),
						// L'ANNONCE SUIT LE GESTE, ET NON LA TABLE. Le `PATCH` est le même dans les
						// deux cas ; ce que la personne vient de faire ne l'est pas. Annoncer
						// « Commentaire supprimé » à un modérateur lui laisserait croire qu'il a
						// perdu le sien (docs/DESIGN_SYSTEM.md §8).
						parModeration ? 'live.comments.moderated' : 'live.comments.deleted',
					)
				}
			/>

			{/* Le refus d'un geste d'auteur se pose SOUS le fil et AU-DESSUS du composeur : il
			    concerne une ligne du fil, pas le texte en cours de rédaction. Le mêler à l'alerte
			    du composeur ferait croire que la publication a échoué. */}
			{sansEffet ? (
				<p role="alert" className="text-sm text-danger" data-testid="geste-sans-effet">
					{t('comments.geste.sans-effet')}
				</p>
			) : null}

			<form onSubmit={publier} className="flex flex-col gap-2">
				<label htmlFor="commentaire-corps" className="sr-only">
					{t('comments.compose.label')}
				</label>
				<textarea
					ref={zoneComposition}
					id="commentaire-corps"
					rows={3}
					value={brouillon}
					onChange={(evenement) => setBrouillon(evenement.target.value)}
					placeholder={t('comments.compose.placeholder')}
					className={[
						'w-full rounded-sm border border-border bg-surface px-3 py-2',
						'text-base text-ink placeholder:text-text-3',
						'focus:outline-none focus:ring-2 focus:ring-brand',
					].join(' ')}
				/>
				{refus === null ? null : (
					<p role="alert" className="text-sm text-danger">
						{t(CLES_REFUS[refus])}
					</p>
				)}
				<div className="flex justify-end">
					<Button
						type="submit"
						variante="primaire"
						disabled={brouillon.trim() === '' || envoiEnCours}
					>
						{envoiEnCours ? t('comments.compose.sending') : t('comments.compose.submit')}
					</Button>
				</div>
			</form>
		</section>
	)
}

/**
 * La barre de filtres.
 *
 * Des boutons `aria-pressed`, non des cases à cocher : ils n'appartiennent à aucun formulaire et
 * ne se soumettent pas (docs/DESIGN_SYSTEM.md §5.11). Le compte porté par chaque bascule compte
 * **la source**, pas le filtre — un compte qui suivrait le filtre vaudrait toujours zéro sur une
 * famille éteinte, et ne dirait plus rien.
 */
function BarreFiltres({
	comptes,
	actives,
	onBasculer,
}: {
	readonly comptes: ComptesFamille
	readonly actives: FamillesActives
	readonly onBasculer: (famille: Famille) => void
}) {
	return (
		// LA BARRE SE REPLIE, ELLE NE DÉFILE PAS (décision 212, VU SUR CAPTURE). Écrite d'abord
		// avec `overflow-x-auto`, elle laissait « Cycle de vie » COUPÉ hors du panneau à 1440 px —
		// la colonne de droite est étroite quelle que soit la largeur de l'écran. Un contrôle dont
		// la dernière option sort du cadre est un contrôle qui cache une option.
		<div role="group" aria-label={t('timeline.filters.aria')} className="flex flex-wrap gap-2">
			{FAMILLES.map((famille) => {
				const active = actives.has(famille)
				return (
					<button
						key={famille}
						type="button"
						aria-pressed={active}
						onClick={() => onBasculer(famille)}
						className={[
							'inline-flex shrink-0 items-center gap-2 rounded-full px-3',
							'min-h-[var(--size-target)] text-sm',
							'focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2',
							active
								? 'bg-brand-soft text-brand font-medium'
								: 'bg-surface text-text-3 border border-border hover:bg-hover',
						].join(' ')}
					>
						{/*
						 * LE LIBELLÉ EST DANS UN `span`, ET C'EST UNE CORRECTION MESURÉE
						 * (décision 212). Écrit comme nœud de texte nu, il devenait un élément
						 * flex ANONYME que `gap` ne sépare pas du compte : la capture
						 * `fil-unifie-1440.jpg` montrait « Discussion1 » et « Cycle de vie2 ».
						 */}
						<span>{t(LIBELLES_FILTRES[famille])}</span>
						<span className="tabular-nums">{comptes[famille]}</span>
					</button>
				)
			})}
		</div>
	)
}

function Fil({
	etat,
	lignes,
	totalCharge,
	libelles,
	onReprise,
	idUtilisateur,
	estAdminWorkspace,
	onModifier,
	onSupprimer,
}: {
	readonly etat: ReturnType<typeof useFilCommentaires>['etat']
	readonly lignes: readonly LigneFil[]
	readonly totalCharge: number
	readonly libelles: LibellesFil
	readonly onReprise: () => void
	readonly idUtilisateur: string | null
	readonly estAdminWorkspace: boolean
	readonly onModifier: (idCommentaire: string, corps: string) => PromesseGeste
	readonly onSupprimer: (idCommentaire: string, parModeration: boolean) => PromesseGeste
}) {
	// Pendant le chargement, le fil ne montre rien plutôt qu'un « aucun événement » prématuré :
	// annoncer l'absence avant d'avoir la réponse serait une valeur par défaut trompeuse
	// (`CLAUDE.md` §18).
	if (etat.statut === 'chargement') return null

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('comments.error.title')}
				corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={onReprise}
			/>
		)
	}

	// DEUX VIDES DISTINCTS (docs/DESIGN_SYSTEM.md §5.11). Les confondre ferait passer un filtre
	// trop restrictif pour une affaire sans histoire.
	if (lignes.length === 0) {
		return totalCharge === 0 ? (
			<EtatVide titre={t('comments.empty.title')} corps={t('comments.empty.body')} />
		) : (
			<EtatVide titre={t('timeline.filtered.title')} corps={t('timeline.filtered.body')} />
		)
	}

	// Ordre CROISSANT — le plus ancien en haut, le composeur en bas (docs/DESIGN_SYSTEM.md §5.10,
	// §5.11). C'est la fusion qui l'établit, jamais ce rendu.
	return (
		<ol className="flex flex-col gap-3">
			{lignes.map((ligne) => (
				<li key={ligne.cle}>
					{ligne.genre === 'commentaire' ? (
						<Commentaire
							commentaire={ligne.commentaire}
							estAuteur={
								idUtilisateur !== null && ligne.commentaire.auteurId === idUtilisateur
							}
							estAdminWorkspace={estAdminWorkspace}
							onModifier={(corps) => onModifier(ligne.commentaire.id, corps)}
							onSupprimer={(parModeration) =>
								onSupprimer(ligne.commentaire.id, parModeration)
							}
						/>
					) : (
						<Evenement ligne={ligne} libelles={libelles} />
					)}
				</li>
			))}
		</ol>
	)
}

/**
 * Un événement est une **ligne**, pas une carte (docs/DESIGN_SYSTEM.md §5.11).
 *
 * La différence de forme porte la différence de nature : l'un est une parole, l'autre un fait.
 * Sans elle, le fil serait une suite de blocs équivalents où l'œil ne distinguerait plus ce qui a
 * été dit de ce qui est arrivé.
 *
 * Un acteur consenti est nommé ; un acteur nul reste muet, car la même valeur représente un geste
 * de service ou un compte détaché. Aucun détail n'est inventé : lorsqu'un libellé ne se résout pas,
 * la ligne montre le libellé générique de son type, sans phrase tronquée.
 */
function Evenement({
	ligne,
	libelles,
}: {
	readonly ligne: LigneEvenement
	readonly libelles: LibellesFil
}) {
	const presentation = PRESENTATION[ligne.type] ?? REPLI
	const Icone = presentation.icone
	const { detail } = resoudreDetail(ligne, libelles)

	return (
		<div className="flex items-start gap-3">
			<span
				aria-hidden="true"
				className={[
					// `size-[1.75rem]` en valeur arbitraire, et non `size-7` : l'échelle du §3 du
					// design system est DISCRÈTE, et une classe hors échelle ne produit AUCUNE
					// règle CSS — la pastille était alors invisible (décision 212, MESURÉ).
					'flex size-[1.75rem] shrink-0 items-center justify-center rounded-md',
					presentation.pastille,
				].join(' ')}
			>
				<Icone size={16} strokeWidth={2} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-base text-ink">
					{t(presentation.cle)}
					{detail === null ? null : (
						<span className="text-text-3 before:content-['·'] before:mx-1 break-words">{detail}</span>
					)}
				</p>
				<p className="text-sm text-text-3">
					<time dateTime={ligne.date}>{formaterDate(ligne.date)}</time>
					{ligne.acteur === null ? null : (
						<span className="before:content-['·'] before:mx-1">
							{t('timeline.actor', { nom: ligne.acteur.full_name })}
						</span>
					)}
				</p>
			</div>
		</div>
	)
}

/**
 * Un commentaire, et — s'il est le vôtre — les deux gestes que le §5.10 décrit.
 *
 * POURQUOI CES BOUTONS N'ÉTAIENT PAS RENDUS, ET POURQUOI ILS LE SONT MAINTENANT. `CRM-043` les
 * avait écartés faute de session : « un bouton offert à tous, qui échouerait pour tous sauf
 * l'auteur, serait une aide d'interface trompeuse ». Le motif était juste, et il a disparu avec
 * INC-021 — l'écran connaît désormais l'appelant.
 *
 * COMPARER `auteurId` À L'IDENTIFIANT DE SESSION N'EST PAS UN CONTRÔLE D'ACCÈS (`CLAUDE.md` §10).
 * La règle est tenue par la politique `UPDATE`, qui exige `author_id = auth.uid()` **et** le droit
 * d'écriture COURANT sur la card. Cette comparaison ne sert qu'à ne pas proposer un geste voué au
 * refus ; lorsqu'elle se trompe — droit fin retombé depuis le chargement —, le backend refuse, et
 * l'écran le dit au lieu de prétendre un succès.
 */
/**
 * Second alias, pour le même motif que `PromesseGeste`, et placé pour la même raison juste avant
 * une déclaration qui s'ouvre par `{` : l'accolade est exclue du motif du contrôle, ce qui arrête
 * sa recherche avant qu'elle ne traverse la signature.
 */
type PromesseResultat = Promise<ResultatGeste>

function Commentaire({
	commentaire,
	estAuteur,
	estAdminWorkspace,
	onModifier,
	onSupprimer,
}: {
	readonly commentaire: CommentaireAffiche
	readonly estAuteur: boolean
	readonly estAdminWorkspace: boolean
	readonly onModifier: (corps: string) => PromesseGeste
	readonly onSupprimer: (parModeration: boolean) => PromesseGeste
}) {
	const auteurSupprime = commentaire.auteurId === null
	const nom = auteurSupprime
		? t('comments.author.deleted')
		: (commentaire.auteur?.full_name ?? t('comments.author.unavailable'))

	const [mode, setMode] = useState<'lecture' | 'edition' | 'confirmation'>('lecture')
	const [brouillon, setBrouillon] = useState(commentaire.corps)
	const [enCours, setEnCours] = useState(false)

	// Une pierre tombale n'offre aucun geste : le trigger refuse toute écriture ultérieure
	// (docs/SPEC-cards.md §13.4), et proposer le contraire serait une commande morte.
	const actionsOffertes = estAuteur && !commentaire.supprime

	// LA MODÉRATION EST LE GESTE D'UN TIERS, ET IL EST UNIQUE — décision 376, INC-072.
	//
	// `!estAuteur` n'est pas une redondance avec la ligne du dessus : un administrateur EST l'auteur
	// de ses propres commentaires, et doit alors recevoir SES deux actions, non celle d'un
	// modérateur. Les deux conditions sont donc mutuellement exclusives, et la confirmation qui
	// s'ouvre n'est pas la même.
	//
	// « Supprimer », jamais « Modifier » : c'est la borne du trigger portée telle quelle par la
	// forme (docs/SPEC-cards.md §13.6). Offrir les deux et laisser le serveur trancher enseignerait
	// à l'utilisateur une règle fausse — et lui vaudrait un `comment_moderation_limitee`.
	const moderationOfferte = !estAuteur && estAdminWorkspace && !commentaire.supprime

	// Un seul élément, choisi par `CorpsCommentaire` en `if` successifs — pour la lisibilité, la
	// contrainte d'outil qui l'imposait ayant été levée avec INC-070.

	return (
		// `group` : les actions apparaissent au survol de la carte **et** au focus clavier de l'une
		// d'elles (`group-focus-within`). Le survol seul les rendrait inatteignables sans souris,
		// ce que le §8 refuse — c'est pourquoi le §5.10 écrit « et au focus clavier ».
		<article className="group rounded-sm bg-surface px-3 py-2" data-testid="commentaire">
			{/* `flex-wrap` : lorsque le nom, la date et les deux actions ne tiennent pas côte à
			    côte dans la colonne étroite du §5.3, les actions passent à la ligne SUIVANTE. Deux
			    dispositions ont été essayées et écartées **sur capture** : en flux sans repli, la
			    ligne « Camille Aubert · 09/08/2026 15:29 » se brisait sur trois lignes en
			    permanence ; en superposition absolue, les actions recouvraient la date et le début
			    du corps. Un repli ne cache rien et ne décale rien — les actions sont toujours
			    disposées, seule leur opacité change. */}
			<div className="flex flex-wrap items-center gap-2 min-w-0">
				<Avatar
					profil={commentaire.auteur}
					nomDeRepli={nom}
					taille={24}
					decoratif
				/>
				<p className="min-w-[12rem] flex-1 text-sm text-text-3">
					<span className="font-medium text-text-2">{nom}</span>
					<span className="before:content-['·'] before:mx-1">
						<time dateTime={commentaire.creeLe}>{formaterDate(commentaire.creeLe)}</time>
					</span>
					{commentaire.modifieLe === null ? null : (
						<span
							className="before:content-['·'] before:mx-1"
							title={`${t('comments.edited.title')} ${formaterDate(commentaire.modifieLe)}`}
						>
							{t('comments.edited')}
						</span>
					)}
				</p>
				{(actionsOffertes || moderationOfferte) && mode === 'lecture' ? (
					<div
						className={[
							// `basis-full` : les actions occupent TOUTE la ligne suivante, elles ne
							// partagent jamais celle du nom et de la date. Laissées en `ml-auto` sur
							// la même ligne, elles rétrécissaient la métadonnée jusqu'à couper
							// « 10/08/2026 18:14 » en deux — VU SUR CAPTURE, et en permanence,
							// puisque des actions transparentes occupent quand même leur place.
							'basis-full flex shrink-0 items-center justify-end gap-1',
							'opacity-0 transition-opacity duration-[var(--transition-duration-fast)]',
							'group-hover:opacity-100 group-focus-within:opacity-100',
						].join(' ')}
						data-testid={moderationOfferte ? 'actions-moderation' : 'actions-commentaire'}
					>
						{/* « Modifier » n'existe QUE pour l'auteur. Le rendre désactivé pour un
						    modérateur serait pire que l'omettre : un contrôle grisé annonce un
						    droit temporairement indisponible, quand celui-ci ne le sera jamais
						    (docs/DESIGN_SYSTEM.md §8). */}
						{actionsOffertes ? (
							<Button
								variante="discret"
								taille="compacte"
								onClick={() => {
									setBrouillon(commentaire.corps)
									setMode('edition')
								}}
							>
								{t('comments.action.edit')}
							</Button>
						) : null}
						<Button variante="discret" taille="compacte" onClick={() => setMode('confirmation')}>
							{t('comments.action.delete')}
						</Button>
					</div>
				) : null}
			</div>

			<CorpsCommentaire
				commentaire={commentaire}
				mode={mode}
				parModeration={moderationOfferte}
				brouillon={brouillon}
				onBrouillon={setBrouillon}
				enCours={enCours}
				onValider={async () => {
					setEnCours(true)
					const applique = await onModifier(brouillon)
					setEnCours(false)
					if (applique) setMode('lecture')
				}}
				onConfirmer={async () => {
					setEnCours(true)
					const applique = await onSupprimer(moderationOfferte)
					setEnCours(false)
					if (applique) setMode('lecture')
				}}
				onAnnuler={() => setMode('lecture')}
			/>
		</article>
	)
}

/**
 * Ce qu'un commentaire montre, selon le mode — en `if` successifs, jamais en chaîne de ternaires.
 *
 * Cette forme fut d'abord IMPOSÉE par INC-070 : le contrôle de textes en dur de `i18n.test.ts`
 * lisait la queue d'un ternaire comme un nœud de texte visible, et la règle pratique qu'il posait
 * — « pas de ternaire dont la branche est un fragment JSX ouvert par `(` » — était respectée ici
 * plutôt que contournée en élargissant l'expression régulière, ce qui aurait affaibli une garde
 * pour accommoder une écriture (`CLAUDE.md` §18).
 *
 * Le contrôle lit désormais l'arbre syntaxique et non le texte : la contrainte n'existe plus
 * (`docs/JOURNAL.md` décisions 296 et 381). La forme est CONSERVÉE, parce qu'une chaîne de `if`
 * qui rend quatre corps distincts se lit mieux qu'une chaîne de ternaires — la réécrire n'aurait
 * eu d'autre motif que de démontrer qu'elle est de nouveau permise.
 */
function CorpsCommentaire({
	commentaire,
	mode,
	parModeration,
	brouillon,
	onBrouillon,
	enCours,
	onValider,
	onConfirmer,
	onAnnuler,
}: {
	readonly commentaire: CommentaireAffiche
	readonly mode: 'lecture' | 'edition' | 'confirmation'
	/** La confirmation à ouvrir : celle d'un retrait par un tiers, ou celle de l'auteur. */
	readonly parModeration: boolean
	readonly brouillon: string
	readonly onBrouillon: (valeur: string) => void
	readonly enCours: boolean
	readonly onValider: () => void
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	if (mode === 'edition') {
		return (
			<FormulaireEdition
				idCommentaire={commentaire.id}
				brouillon={brouillon}
				onBrouillon={onBrouillon}
				enCours={enCours}
				onValider={onValider}
				onAnnuler={onAnnuler}
			/>
		)
	}

	if (mode === 'confirmation') {
		return (
			<ConfirmationSuppression
				parModeration={parModeration}
				enCours={enCours}
				onConfirmer={onConfirmer}
				onAnnuler={onAnnuler}
			/>
		)
	}

	if (commentaire.supprime) {
		// Il n'y a rien d'autre à afficher : la base ne porte plus de corps
		// (docs/SPEC-cards.md §13.4). La place est TENUE — masquer la ligne ferait disparaître un
		// tour de parole d'une conversation.
		//
		// LA MENTION DIT SI UN TIERS EST INTERVENU, JAMAIS QUI (décision 376). Elle vient de la
		// DONNÉE — `deleted_by` non nul et différent d'`author_id`, comparés dans
		// `webapp/src/lib/commentaires.ts` —, jamais d'un calcul d'écran. Sans cette lecture, la
		// colonne d'audit livrée par la migration `0035` ne serait lue par personne, et le seed
		// modéré ne démontrerait rien de visible. Le nom du modérateur reste hors de l'écran :
		// docs/SPEC-cards.md §13.13, point 7.
		const cle = commentaire.retireParModeration ? 'comments.deleted.moderation' : 'comments.deleted'
		return <p className="text-base italic text-text-3">{t(cle)}</p>
	}

	// `whitespace-pre-wrap` : le corps est du markdown STOCKÉ, rendu en TEXTE BRUT. L'interpréter
	// sans politique d'assainissement ouvrirait une injection, et aucune unité ne porte cette
	// politique (docs/SPEC-cards.md §13.13).
	return <p className="whitespace-pre-wrap break-words text-base text-ink">{commentaire.corps}</p>
}

/** Correction en place — docs/SPEC-cards.md §13.5, ligne *i* du §13.8. */
function FormulaireEdition({
	idCommentaire,
	brouillon,
	onBrouillon,
	enCours,
	onValider,
	onAnnuler,
}: {
	readonly idCommentaire: string
	readonly brouillon: string
	readonly onBrouillon: (valeur: string) => void
	readonly enCours: boolean
	readonly onValider: () => void
	readonly onAnnuler: () => void
}) {
	// LE FOCUS SUIT LE GESTE. Sans cela, activer « Modifier » au clavier laisse le focus sur un
	// bouton qui vient de disparaître : le navigateur le replace alors sur le `body`, et
	// l'utilisateur doit retraverser la page pour atteindre le champ qu'il a lui-même ouvert.
	// Défaut trouvé par la preuve clavier, pas à la lecture (`docs/DESIGN_SYSTEM.md` §8).
	const zone = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		const champ = zone.current
		if (champ === null) return
		champ.focus()
		// LE CURSEUR VA À LA FIN, et ce n'est pas un détail : `focus()` le place en tête, si bien
		// que le premier caractère saisi s'insère AVANT le texte existant. Corriger un commentaire,
		// c'est presque toujours continuer sa phrase — mesuré par la preuve clavier, qui écrivait
		// « au clavierGeste … » au lieu de « Geste … au clavier ».
		champ.setSelectionRange(champ.value.length, champ.value.length)
	}, [])

	return (
		<form
			className="mt-2 flex flex-col gap-2"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				onValider()
			}}
		>
			{/* Le libellé est masqué visuellement, jamais retiré (docs/DESIGN_SYSTEM.md §12.3) :
			    la carte du commentaire dit déjà de quoi il s'agit, mais un lecteur d'écran ne
			    lit pas la carte en arrivant sur le champ. */}
			<label className="sr-only" htmlFor={`edition-${idCommentaire}`}>
				{t('comments.edit.label')}
			</label>
			<textarea
				ref={zone}
				id={`edition-${idCommentaire}`}
				value={brouillon}
				onChange={(evenement) => onBrouillon(evenement.target.value)}
				rows={3}
				className={[
					'w-full rounded-sm border border-border bg-surface px-3 py-2',
					'text-base text-ink',
					'focus:outline-none focus:ring-2 focus:ring-brand',
				].join(' ')}
			/>
			<div className="flex items-center gap-2">
				{/* Désactivé à vide : le `CHECK` du §13.4 refuserait un corps blanc, et proposer
				    un geste que la base refuse serait une commande morte. */}
				<Button type="submit" variante="primaire" disabled={enCours || brouillon.trim() === ''}>
					{enCours ? t('comments.edit.saving') : t('comments.edit.save')}
				</Button>
				<Button type="button" variante="secondaire" onClick={onAnnuler}>
					{t('comments.edit.cancel')}
				</Button>
			</div>
		</form>
	)
}

/**
 * Confirmation explicite d'une suppression — `docs/DESIGN_SYSTEM.md` §6.
 *
 * Le caractère irréversible est nommé **dans le libellé de l'action** — « Supprimer
 * définitivement » —, comme le §5.10 l'exige, et non seulement dans le corps du message : un
 * utilisateur qui ne lit que les boutons doit comprendre ce qu'il engage.
 *
 * Ce n'est pas une modale : le design system n'en déclare aucune (§5 ne liste que la carte, le
 * tableau, le panneau et le fil), et en inventer une ici lui ferait porter un composant que
 * personne n'a spécifié. La confirmation reste donc dans le flux du document, à la place du
 * commentaire qu'elle concerne — ce qui la rend aussi atteignable au clavier sans piège de focus.
 */
function ConfirmationSuppression({
	parModeration,
	enCours,
	onConfirmer,
	onAnnuler,
}: {
	readonly parModeration: boolean
	readonly enCours: boolean
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	// DEUX TEXTES, PAS UN SEUL (décision 376, docs/DESIGN_SYSTEM.md §5.10). Supprimer son propre
	// commentaire et retirer celui d'un collègue n'engagent pas la même chose : le second nomme le
	// propriétaire du propos ET la trace nominative laissée. Un texte unique obligerait à choisir
	// entre taire cette trace au modérateur et alourdir le geste ordinaire de l'auteur.
	//
	// Les trois clés sont choisies ensemble et jamais composées : le §23 de `CLAUDE.md` interdit de
	// construire une phrase par concaténation.
	const cles: Readonly<Record<'titre' | 'corps' | 'action', CleTraduction>> = parModeration
		? {
				titre: 'comments.moderation.confirm.title',
				corps: 'comments.moderation.confirm.body',
				action: 'comments.moderation.confirm.action',
			}
		: {
				titre: 'comments.delete.confirm.title',
				corps: 'comments.delete.confirm.body',
				action: 'comments.delete.confirm.action',
			}

	return (
		<div
			className="mt-2 rounded-sm bg-danger-soft px-3 py-2"
			role="group"
			aria-label={t(cles.titre)}
			data-testid={parModeration ? 'confirmation-moderation' : 'confirmation-suppression'}
		>
			<p className="text-sm font-medium text-danger-on-soft">{t(cles.titre)}</p>
			<p className="text-sm text-danger-on-soft">{t(cles.corps)}</p>
			<div className="mt-2 flex items-center gap-2">
				<Button variante="destructif" disabled={enCours} onClick={onConfirmer}>
					{enCours ? t('comments.delete.deleting') : t(cles.action)}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('comments.delete.confirm.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * Date absolue, en français, sans bibliothèque.
 *
 * Une date relative — « il y a 3 heures » — exigerait de se rafraîchir pour ne pas mentir, et
 * `docs/DESIGN_SYSTEM.md` §5.10 demande une date absolue. Une valeur illisible n'est pas remplacée
 * par une date inventée : elle est rendue telle quelle, ce qui se voit.
 */
function formaterDate(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return iso
	return date.toLocaleString('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}
