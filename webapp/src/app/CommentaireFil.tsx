// @spec CRM-153 (docs/BACKLOG.md) — tranche T3 : le commentaire du fil et le sélecteur de mentions, partagés par le fil d'une
//       affaire (PanneauTimeline) et celui d'une organisation (BlocCommentairesOrganisation) — docs/SPEC-organisations.md §9.2,
//       §9.3 ; docs/DESIGN_SYSTEM.md §5.107 (« le panneau du §5.10 tel quel, et le sélecteur de mentions du §5.44 »)
// @spec CRM-043 (docs/BACKLOG.md) — le commentaire, ses gestes d'auteur et sa pierre tombale (docs/SPEC-cards.md §13.4 à
//       §13.10 ; docs/DESIGN_SYSTEM.md §5.10)
// @spec CRM-064 (docs/BACKLOG.md) — sous-tranche 3b : le sélecteur de mentions du composeur (docs/SPEC-notifications.md §33
//       à §36 ; docs/DESIGN_SYSTEM.md §5.44)
// @spec CRM-093 (docs/BACKLOG.md) tranche T4 — les commandes lisent le refus du bloc (docs/DESIGN_SYSTEM.md §5.59)
//
// DÉPLACÉ SANS CHANGEMENT DE RENDU depuis `PanneauTimeline.tsx` (CRM-153 T3) : un seul commentaire, une seule forme, pour
// les deux fils du produit (§5.29 bis). Seul ajout : la propriété facultative `ancre`, qui donne au commentaire l'adresse
// `#commentaire-{id}` vers laquelle mène une notification (§5.107).

import { AtSign } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { useRefus } from '../components/ui/RefusCommandes'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import type { ProprietesCommande } from '../lib/capacites'
import type { CommentaireAffiche } from '../lib/commentaires'
import type { IssueMention, NatureRefusMention, PersonneMentionnable } from '../lib/mentions'

type PromesseGeste = Promise<boolean>

/** L'ancre d'un commentaire, `commentaire-{id}` : la cible d'une notification de mention (§5.107). */
export const ancreCommentaire = (idCommentaire: string): string => `commentaire-${idCommentaire}`

/**
 * La nature d'une issue refusée, ou le repli `unknown`.
 *
 * `IssueMention` est un type somme dont seule la branche `refus` porte une nature ; la liste des
 * refusées ne contient que celle-là, mais le compilateur ne le sait pas. Le repli est écrit **une
 * fois**, ici, plutôt que dilué en assertions de type dans le JSX — une assertion ferait taire le
 * compilateur sans rien garantir, et `unknown` rend un message honnête si la garantie tombait.
 */
export function natureDe(issue: IssueMention | undefined): NatureRefusMention {
	return issue !== undefined && issue.statut === 'refus' ? issue.nature : 'unknown'
}

/**
 * Le sélecteur de mentions du composeur — `CRM-064` sous-tranche 3b,
 * `docs/SPEC-notifications.md` §36, `docs/DESIGN_SYSTEM.md` §5.44.
 *
 * CE N'EST PAS UN `select`, ET L'ÉCART AVEC LE §5.22 EST MOTIVÉ : là-bas le choix est unique, ici il
 * est multiple. `<select multiple>` est le contrôle que les plateformes rendent le plus mal —
 * sélection à la souris destructrice, hauteur illisible sous le palier `md` —, et le §8 exige mieux.
 * Un `fieldset` de cases à cocher n'ajoute aucune dépendance et porte le clavier de la plateforme.
 *
 * IL NE PORTE AUCUNE RÈGLE D'ACCÈS (`CLAUDE.md` §10). La liste vient de `public.mentionnables`, qui
 * appelle `app.can_read_card_pour` : le composant n'écarte personne, il rend ce que la base donne.
 */
export function SelecteurMentions({
	commande,
	ouvert,
	onBasculer,
	etat,
	choisies,
	onBasculerPersonne,
	onReprise,
	cleVide = 'comments.mentions.empty',
}: {
	/** `CRM-093` : mentionner compose un commentaire ; refusé avec lui, et citant le même motif. */
	readonly commande: ProprietesCommande
	readonly ouvert: boolean
	readonly onBasculer: () => void
	readonly etat: EtatAsync<readonly PersonneMentionnable[]> | null
	readonly choisies: ReadonlySet<string>
	readonly onBasculerPersonne: (idPersonne: string) => void
	readonly onReprise: () => void
	/** `CRM-153` T3 : le texte de la liste vide, qui nomme l'objet commenté — une affaire, ou un espace (§5.44). */
	readonly cleVide?: CleTraduction
}) {
	return (
		<div className="flex flex-col gap-2">
			{/*
			 * LA COMMANDE PORTE LE COMPTE (§5.44) : un auteur qui replie le sélecteur ne saurait
			 * plus, sinon, qui son commentaire mentionne. Deux clés et non une phrase à trou —
			 * « Mentionner » et « Mentionner (2) » ne sont pas la même phrase (`CLAUDE.md` §23).
			 */}
			<button
				type="button"
				onClick={onBasculer}
				{...commande}
				aria-expanded={ouvert}
				aria-controls="mentions-liste"
				className={[
					'inline-flex w-fit items-center gap-2 rounded-sm px-3',
					'min-h-[var(--size-target)] text-sm text-text-2 hover:bg-hover',
					'focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2',
					'disabled:opacity-70 disabled:cursor-not-allowed',
				].join(' ')}
			>
				<AtSign aria-hidden="true" className="size-4" />
				<span>
					{choisies.size === 0
						? t('comments.mentions.toggle')
						: t('comments.mentions.toggle.count', { compte: String(choisies.size) })}
				</span>
			</button>

			{/*
			 * LE CONTENU N'EST RENDU QUE REPLIÉ-DÉPLIÉ, et non masqué en CSS : une case à cocher
			 * cachée reste atteignable au clavier et se soumettrait avec le formulaire (§8).
			 */}
			{!ouvert ? null : (
				<fieldset
					id="mentions-liste"
					className="flex flex-col gap-2 rounded-sm border border-border px-3 py-2"
					aria-busy={etat === null || etat.statut === 'chargement'}
				>
					<legend className="px-1 text-sm text-text-3">{t('comments.mentions.legend')}</legend>
					{etat === null || etat.statut === 'chargement' ? (
						<p className="text-sm text-text-3">{t('comments.mentions.loading')}</p>
					) : etat.statut === 'erreur' ? (
						// L'ERREUR PORTE SON ACTION DE REPRISE (§5.8) : une liste absente sans moyen
						// de la redemander est une impasse.
						<div className="flex flex-col items-start gap-2">
							<p className="text-sm text-danger">{t('comments.mentions.error')}</p>
							<Button type="button" variante="secondaire" onClick={onReprise}>
								{t('comments.mentions.retry')}
							</Button>
						</div>
					) : etat.donnees.length === 0 ? (
						// L'ÉTAT VIDE N'OFFRE AUCUNE ACTION, et son message dit que l'état est SAIN
						// (§5.44) : être seul à lire une affaire n'est pas un manque.
						<p className="text-sm text-text-3">{t(cleVide)}</p>
					) : (
						etat.donnees.map((personne) => (
							<label
								key={personne.id}
								className="flex min-h-[var(--size-target)] items-center gap-2 text-sm text-ink"
							>
								<input
									type="checkbox"
									checked={choisies.has(personne.id)}
									onChange={() => onBasculerPersonne(personne.id)}
									className="size-4 accent-brand focus:outline-none focus:ring-2 focus:ring-brand"
								/>
								{/* L'AVATAR EST DÉCORATIF : le nom est écrit juste à côté, et le
								    répéter au lecteur d'écran ferait entendre la personne deux
								    fois (§5.4). */}
								<Avatar
									profil={{
										id: personne.id,
										full_name: personne.nom,
										avatar_url: personne.avatar,
									}}
									taille={24}
									decoratif
								/>
								<span>{personne.nom}</span>
							</label>
						))
					)}
				</fieldset>
			)}
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
export function Commentaire({
	commentaire,
	estAuteur,
	estAdminWorkspace,
	onModifier,
	onSupprimer,
	ancre = false,
}: {
	readonly commentaire: CommentaireAffiche
	readonly estAuteur: boolean
	readonly estAdminWorkspace: boolean
	readonly onModifier: (corps: string) => PromesseGeste
	readonly onSupprimer: (parModeration: boolean) => PromesseGeste
	/** `CRM-153` T3 : l'adresse `#commentaire-{id}`, focalisable par programme, vers laquelle mène une notification. */
	readonly ancre?: boolean
}) {
	const droit = useRefus()
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
		<article
			className="group rounded-sm bg-surface px-3 py-2"
			data-testid="commentaire"
			{...(ancre ? { id: ancreCommentaire(commentaire.id), tabIndex: -1 } : {})}
		>
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
							<Button {...droit}
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
						<Button {...droit} variante="discret" taille="compacte" onClick={() => setMode('confirmation')}>
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
export function formaterDate(iso: string): string {
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
