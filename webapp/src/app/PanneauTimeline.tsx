// @spec CRM-044 (docs/BACKLOG.md) — timeline unifiée du détail de card
// @spec CRM-043 (docs/BACKLOG.md) — le fil des commentaires, que cette unité REPREND
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
// AUCUN NOM D'AUTEUR NI D'ACTEUR N'EST AFFICHÉ. `profiles` n'est lisible par aucun jeton
// d'utilisateur (INC-014) ; la règle du §12.5 du design system est appliquée pour la troisième
// fois — une donnée illisible n'est pas rendue **du tout** plutôt que rendue vide.

import {
	Archive,
	ArchiveRestore,
	ArrowRightLeft,
	PencilLine,
	RotateCcw,
	Sparkles,
	Trash2,
	UserRoundCog,
	type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import {
	publierCommentaire,
	useFilCommentaires,
	type CommentaireAffiche,
	type NatureRefusPublication,
} from '../lib/commentaires'
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
	assigned: { cle: 'timeline.event.assigned', icone: UserRoundCog, pastille: 'bg-accent-soft text-ink' },
	archived: { cle: 'timeline.event.archived', icone: Archive, pastille: 'bg-hover text-text-3' },
	unarchived: { cle: 'timeline.event.unarchived', icone: ArchiveRestore, pastille: 'bg-accent-soft text-ink' },
	trashed: { cle: 'timeline.event.trashed', icone: Trash2, pastille: 'bg-hover text-text-3' },
	restored: { cle: 'timeline.event.restored', icone: RotateCcw, pastille: 'bg-success-soft text-success' },
	field_changed: { cle: 'timeline.event.field_changed', icone: PencilLine, pastille: 'bg-hover text-text-3' },
}

/**
 * Repli d'un type inconnu, **documenté** — même règle que la pilule de track du §5.5 bis : la
 * valeur vient du backend, et un type ne garantit jamais une valeur (`docs/SPEC-types.md`). Le
 * jour où `CRM-054` écrira `mail_received`, le fil le montrera comme un événement sans détail
 * plutôt que de le faire disparaître. Une mémoire ne cache pas ce qu'elle ne comprend pas.
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
	cycle: 'timeline.filter.cycle',
}

/** Traductions des quatre refus, écrites une fois — le composant n'en construit aucune. */
const CLES_REFUS: Readonly<Record<NatureRefusPublication, Parameters<typeof t>[0]>> = {
	forbidden: 'comments.refus.forbidden',
	invalide: 'comments.refus.invalide',
	network: 'comments.refus.network',
	unknown: 'comments.refus.unknown',
}

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
}

export function PanneauTimeline({
	client,
	idCard,
	idWorkspace,
	idWorkflow,
	libellesChamps,
}: ProprietesPanneauTimeline) {
	const { etat, recharger } = useFilCommentaires(client, idCard)
	const [brouillon, setBrouillon] = useState('')
	const [envoiEnCours, setEnvoiEnCours] = useState(false)
	const [refus, setRefus] = useState<NatureRefusPublication | null>(null)
	const [annonce, setAnnonce] = useState('')

	// LES ÉVÉNEMENTS SONT LUS SÉPARÉMENT DES COMMENTAIRES, et relus chaque fois que le fil des
	// commentaires change : `card_events` n'est PAS publiée au temps réel (§14.1), et un
	// commentaire publié depuis cet écran peut avoir été précédé d'un déplacement fait ailleurs.
	// Le coût — une requête de plus par événement de commentaire — est nommé au §14.13.
	const [evenements, setEvenements] = useState<readonly LigneFil[]>([])
	const [libellesEtapes, setLibellesEtapes] = useState<LibellesFil['etapes']>(new Map())
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
		// Le flux relira de lui-même (décision 201) ; ce rechargement est ce qui rend l'écran juste
		// même lorsque l'abonnement a échoué — auquel cas rien d'autre ne le mettrait à jour.
		recharger()
	}

	return (
		<section aria-label={t('comments.aria')} className="flex flex-col gap-4">
			<h2 className="text-base font-medium text-ink">{t('comments.title')}</h2>

			<LiveRegion libelle={t('live.comments.aria')} message={annonce} />

			{/*
			 * LA BARRE N'EST RENDUE QUE S'IL Y A QUELQUE CHOSE À FILTRER (décision 212, VU SUR
			 * `fil-vide-1440.jpg`) : quatre bascules affichant « 0 » au-dessus de « aucun
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
				libelles={{ etapes: libellesEtapes, champs: libellesChamps }}
				onReprise={recharger}
			/>

			<form onSubmit={publier} className="flex flex-col gap-2">
				<label htmlFor="commentaire-corps" className="sr-only">
					{t('comments.compose.label')}
				</label>
				<textarea
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
}: {
	readonly etat: ReturnType<typeof useFilCommentaires>['etat']
	readonly lignes: readonly LigneFil[]
	readonly totalCharge: number
	readonly libelles: LibellesFil
	readonly onReprise: () => void
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
						<Commentaire commentaire={ligne.commentaire} />
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
 * AUCUN ACTEUR N'EST NOMMÉ (INC-014), et aucun détail n'est inventé : lorsqu'un libellé ne se
 * résout pas, la ligne montre le libellé générique de son type, sans phrase tronquée.
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
				</p>
			</div>
		</div>
	)
}

function Commentaire({ commentaire }: { readonly commentaire: CommentaireAffiche }) {
	return (
		<article className="rounded-sm bg-surface px-3 py-2">
			<p className="text-sm text-text-3">
				<time dateTime={commentaire.creeLe}>{formaterDate(commentaire.creeLe)}</time>
				{commentaire.modifieLe === null ? null : (
					<span
						className="before:content-['·'] before:mx-1"
						title={`${t('comments.edited.title')} ${formaterDate(commentaire.modifieLe)}`}
					>
						{t('comments.edited')}
					</span>
				)}
			</p>
			{commentaire.supprime ? (
				// Il n'y a rien d'autre à afficher : la base ne porte plus de corps
				// (docs/SPEC-cards.md §13.4). La place est TENUE — masquer la ligne ferait
				// disparaître un tour de parole d'une conversation.
				<p className="text-base italic text-text-3">{t('comments.deleted')}</p>
			) : (
				// `whitespace-pre-wrap` : le corps est du markdown STOCKÉ, rendu en TEXTE BRUT.
				// L'interpréter sans politique d'assainissement ouvrirait une injection, et aucune
				// unité ne porte cette politique (docs/SPEC-cards.md §13.13).
				<p className="whitespace-pre-wrap break-words text-base text-ink">{commentaire.corps}</p>
			)}
		</article>
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
