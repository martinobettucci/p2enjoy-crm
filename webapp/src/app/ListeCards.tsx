// @spec CRM-042 (docs/BACKLOG.md) — vue liste d'un channel : tableau, tri, filtres, pagination
// @spec CRM-022 (docs/BACKLOG.md) — colonne Responsable avec avatar et nom
// @spec docs/SPEC-cards.md §12.4 (le tri), §12.5 (les filtres), §12.6 (la pagination et le `416`),
//       §12.7 (le tableau, sa densité et ses colonnes), §12.8 (accessibilité et clavier),
//       §12.9 (états systématiques)
// @spec docs/DESIGN_SYSTEM.md §5.9 (tableau de données), §5.5 (boutons), §5.6 (badges),
//       §5.7 (champs), §5.8 (états), §7 (paliers), §8 (accessibilité), §9 (icônes Lucide),
//       §12.1 (navigation par liens, non `tablist`), §12.6 (débordement signalé)
//
// Ce composant **rend** ; il ne compose pas. La clôture des tris, l'ordre total, le repli des
// paramètres d'adresse, le bornage du rang de page et la classification du `416` vivent dans
// `webapp/src/lib/liste-cards.ts`, où ils sont vérifiables sans navigateur.
//
// Aucune règle d'accès n'est portée ici : ce que la liste montre est ce que la RLS a consenti à
// rendre (CLAUDE.md §10).

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge, type TonBadge } from '../components/ui/Badge'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import type { CouleurNoeud, EtapeBoard } from '../lib/board'
import {
	TRIS,
	nombreDePages,
	type CardListe,
	type CleTri,
	type ParametresListe,
	type SensTri,
} from '../lib/liste-cards'

/**
 * Le ton de badge d'une couleur de nœud.
 *
 * `neutral` devient `neutre` : le design system nomme ses tons en français et le catalogue nomme
 * ses couleurs en anglais. La correspondance vit ici, à un seul endroit, comme celle des liserés
 * de carte vit dans `Board.tsx`.
 */
const TONS: Readonly<Record<CouleurNoeud, TonBadge>> = {
	brand: 'brand',
	success: 'success',
	accent: 'accent',
	danger: 'danger',
	neutral: 'neutre',
}

/** Libellé de chaque colonne triable, et de chaque colonne tout court. */
const LIBELLES: Readonly<Record<CleTri | 'responsable' | 'etape' | 'next_action', CleTraduction>> = {
	title: 'liste.colonne.title',
	responsable: 'liste.colonne.owner',
	etape: 'liste.colonne.etape',
	amount: 'liste.colonne.amount',
	next_action: 'liste.colonne.next_action',
	next_action_at: 'liste.colonne.next_action_at',
	created_at: 'liste.colonne.title',
}

/**
 * Une ligne fait exactement `--size-target` de haut, et une seule ligne de texte par cellule
 * (docs/DESIGN_SYSTEM.md §5.9) : c'est la « densité maîtrisée » de la Definition of Done, et
 * l'écart voulu avec la carte de board, qui accorde deux lignes à son titre.
 */
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_CELLULE_TECHNIQUE = 'h-[var(--size-target)] px-3 text-right whitespace-nowrap'

/**
 * Un montant se rend en **donnée technique** (docs/DESIGN_SYSTEM.md §2, §5.9) : monospace,
 * chiffres tabulaires, aligné à droite. Le formatage est délégué à `Intl`, jamais construit par
 * concaténation — la place du symbole et le séparateur des milliers sont des règles de langue.
 *
 * Reproduit depuis `Board.tsx` plutôt qu'importé : le board expose son formatage à l'intérieur de
 * son propre module de rendu, et l'en extraire pour deux appelants dépasserait le périmètre de
 * cette unité. L'écart est **nommé** ici plutôt que tu.
 */
function formaterMontant(montant: number, devise: string): string {
	try {
		return new Intl.NumberFormat('fr-FR', {
			style: 'currency',
			currency: devise,
			maximumFractionDigits: 0,
		}).format(montant)
	} catch {
		// Une devise que le navigateur ne connaît pas ne doit pas faire tomber l'écran.
		return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(montant)} ${devise}`
	}
}

/** Une échéance se rend elle aussi en donnée technique, au format court de la langue. */
function formaterEcheance(horodatage: string): string {
	const date = new Date(horodatage)
	if (Number.isNaN(date.getTime())) return horodatage
	return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date)
}

export type ProprietesListeCards = {
	readonly cards: readonly CardListe[]
	readonly etapes: readonly EtapeBoard[]
	readonly parametres: ParametresListe
	readonly total: number
	readonly slugTrack: string
	readonly slugChannel: string
	readonly onParametres: (parametres: ParametresListe) => void
	/**
	 * Ce qui remplace le tableau lorsque le total est nul.
	 *
	 * DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE, pas en lisant un test. La première écriture rendait
	 * l'état vide **au-dessus** de la barre de filtres — l'utilisateur lisait « aucune affaire ne
	 * correspond » avant de voir les filtres qui en étaient la cause —, doublait l'action
	 * « Effacer les filtres », et laissait sous elle une **carcasse de tableau** : une ligne
	 * d'en-têtes sans une seule ligne de données. Trois défauts qu'aucune assertion ne pouvait
	 * attraper, les trois éléments existant bel et bien (décision 190).
	 */
	readonly etatVide?: ReactNode
}

/**
 * Le tableau d'un channel.
 *
 * L'état des paramètres est **détenu par l'appelant**, qui les tient dans l'adresse (§12.2) : un
 * état interne au tableau serait perdu au rechargement, et la pagination mentirait sur l'endroit
 * où l'on est.
 */
export function ListeCards({
	cards,
	etapes,
	parametres,
	total,
	slugTrack,
	slugChannel,
	onParametres,
	etatVide,
}: ProprietesListeCards) {
	const etapesParId = new Map(etapes.map((etape) => [etape.id, etape]))
	const pages = nombreDePages(total)
	const vide = total === 0 && etatVide !== undefined

	return (
		<div className="flex flex-col gap-3 min-w-0">
			{/* Les filtres restent **au-dessus** et **toujours rendus**, y compris sur un total nul :
			    ils sont la cause de l'état vide filtré, et les masquer priverait l'utilisateur du
			    seul geste qui l'en sort. */}
			<BarreFiltres
				etapes={etapes}
				parametres={parametres}
				total={total}
				onParametres={onParametres}
				offrirEffacement={!vide}
			/>
			{vide ? (
				etatVide
			) : (
				<>
					{/* Conteneur du défilement horizontal : la page ne défile jamais de ce côté
					    (docs/DESIGN_SYSTEM.md §7), et le débordement est **signalé** par
					    `.indique-debordement-x` — dont la portée annonçait nommément la vue liste
					    (§12.6). Aucun `scroll-snap`, contrairement au board : il n'y a pas de colonne
					    sur laquelle s'ancrer. */}
					<div className="overflow-x-auto indique-debordement-x">
						<table data-testid="tableau-liste" className="w-full border-collapse text-left">
							<caption className="sr-only">{t('liste.aria')}</caption>
							<thead>
								<tr className="border-b border-border">
									<EnTeteTriable
										cle="title"
										parametres={parametres}
										onParametres={onParametres}
										alignementDroite={false}
									/>
									<EnTeteFixe cle="responsable" />
									<EnTeteFixe cle="etape" />
									<EnTeteTriable
										cle="amount"
										parametres={parametres}
										onParametres={onParametres}
										alignementDroite
									/>
									<EnTeteFixe cle="next_action" />
									<EnTeteTriable
										cle="next_action_at"
										parametres={parametres}
										onParametres={onParametres}
										alignementDroite
									/>
								</tr>
							</thead>
							<tbody>
								{cards.map((card) => (
									<Ligne
										key={card.id}
										card={card}
										etape={etapesParId.get(card.current_step_id)}
										slugTrack={slugTrack}
										slugChannel={slugChannel}
									/>
								))}
							</tbody>
						</table>
					</div>
					<Pagination parametres={parametres} pages={pages} onParametres={onParametres} />
				</>
			)}
		</div>
	)
}

/**
 * En-tête d'une colonne triable (§12.8).
 *
 * Le `th` porte `aria-sort` : sans lui, un lecteur d'écran ne sait pas sur quelle colonne le
 * tableau est trié. L'icône de sens **accompagne** le libellé, elle ne le remplace pas — la
 * direction ne repose jamais sur la seule icône (docs/DESIGN_SYSTEM.md §5.9).
 */
function EnTeteTriable({
	cle,
	parametres,
	onParametres,
	alignementDroite,
}: {
	readonly cle: CleTri
	readonly parametres: ParametresListe
	readonly onParametres: (parametres: ParametresListe) => void
	readonly alignementDroite: boolean
}) {
	const actif = parametres.tri === cle
	const sens: SensTri = actif ? parametres.sens : 'asc'
	const Icone = !actif ? ArrowUpDown : sens === 'asc' ? ArrowUp : ArrowDown
	const libelle = t(LIBELLES[cle])

	return (
		<th
			scope="col"
			data-testid="entete-triable"
			data-cle={cle}
			// Un `aria-sort` n'est porté que par la colonne **réellement** triée : l'annoncer
			// « none » partout est correct, l'annoncer sur plusieurs colonnes ne l'est pas.
			aria-sort={actif ? (sens === 'asc' ? 'ascending' : 'descending') : 'none'}
			className={['bg-bg text-sm text-text-2 font-medium', alignementDroite ? 'text-right' : ''].join(' ')}
		>
			<button
				type="button"
				data-testid="tri"
				aria-label={t('liste.tri.aria', { colonne: libelle })}
				onClick={() => {
					// Cliquer la colonne déjà triée **inverse** le sens ; en changer prend le sens
					// par défaut de la nouvelle clé (§12.4). Toute bascule ramène à la page 1 : la
					// page 3 d'un tri n'a aucun rapport avec la page 3 d'un autre.
					const defaut = TRIS.find((candidat) => candidat.cle === cle)?.sensParDefaut ?? 'asc'
					const suivant: SensTri = actif ? (parametres.sens === 'asc' ? 'desc' : 'asc') : defaut
					onParametres({ ...parametres, tri: cle, sens: suivant, page: 1 })
				}}
				className={[
					'inline-flex items-center gap-2 w-full',
					'min-h-[var(--size-target)] px-3',
					alignementDroite ? 'justify-end' : '',
					'hover:bg-hover',
				].join(' ')}
			>
				{libelle}
				<Icone aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
			</button>
		</th>
	)
}

/** En-tête d'une colonne non triable. `aria-sort` y serait un mensonge, il n'y est pas. */
function EnTeteFixe({ cle }: { readonly cle: 'responsable' | 'etape' | 'next_action' }) {
	return (
		<th
			scope="col"
			className="bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3"
		>
			{t(LIBELLES[cle])}
		</th>
	)
}

/**
 * Une ligne du tableau.
 *
 * **Seul le titre est un lien** : la ligne entière ne l'est pas, pour que la cible du clic soit la
 * cible annoncée (docs/DESIGN_SYSTEM.md §5.9). Une cellule sans valeur reste **vide** — ni tiret,
 * ni « non renseigné » : un tiret est un caractère que rien ne distingue d'une donnée.
 */
function Ligne({
	card,
	etape,
	slugTrack,
	slugChannel,
}: {
	readonly card: CardListe
	readonly etape: EtapeBoard | undefined
	readonly slugTrack: string
	readonly slugChannel: string
}) {
	return (
		<tr data-testid="ligne-card" data-card={card.id} className="border-b border-border hover:bg-hover">
			<td className={CLASSES_CELLULE}>
				<Link
					to={`/tracks/${slugTrack}/${slugChannel}/cards/${card.id}`}
					title={card.title}
					className="text-ink font-medium hover:text-brand"
				>
					{card.title}
				</Link>
			</td>
			<td className="h-[var(--size-target)] px-3 whitespace-nowrap">
				{card.responsable === null ? null : (
					<span className="flex items-center gap-2 min-w-0" title={card.responsable.full_name}>
						<Avatar profil={card.responsable} taille={24} decoratif />
						<span className="max-w-[24ch] truncate">{card.responsable.full_name}</span>
					</span>
				)}
			</td>
			<td className="h-[var(--size-target)] px-3 whitespace-nowrap">
				{/* Une étape que l'appelant n'a pas le droit de lire laisse la cellule vide : le
				    module de composition ne ment pas sur ce qu'il a reçu, et le rendu non plus. */}
				{etape === undefined ? null : (
					<Badge ton={TONS[etape.couleur]}>{etape.libelle}</Badge>
				)}
			</td>
			<td className={CLASSES_CELLULE_TECHNIQUE}>
				{card.amount === null ? null : (
					<code data-testid="montant-liste" className="text-text-2">
						{formaterMontant(card.amount, card.currency)}
					</code>
				)}
			</td>
			<td className={CLASSES_CELLULE} title={card.next_action ?? ''}>
				{card.next_action}
			</td>
			<td className={CLASSES_CELLULE_TECHNIQUE}>
				{card.next_action_at === null ? null : (
					<code data-testid="echeance-liste" className="text-text-2">
						{formaterEcheance(card.next_action_at)}
					</code>
				)}
			</td>
		</tr>
	)
}

/**
 * Filtres et compte (§12.5).
 *
 * La recherche est un `form` que `Entrée` soumet : une recherche qui partirait à chaque frappe
 * émettrait une requête par caractère (§12.8). Le filtre par étape, lui, s'applique au changement —
 * un `select` n'a pas d'autre geste de validation.
 */
function BarreFiltres({
	etapes,
	parametres,
	total,
	onParametres,
	offrirEffacement,
}: {
	readonly etapes: readonly EtapeBoard[]
	readonly parametres: ParametresListe
	readonly total: number
	readonly onParametres: (parametres: ParametresListe) => void
	/** `false` lorsque l'état vide porte déjà l'action : deux boutons identiques côte à côte. */
	readonly offrirEffacement: boolean
}) {
	const idEtape = useId()
	const idRecherche = useId()
	const filtre = offrirEffacement && (parametres.etape !== null || parametres.recherche !== '')

	return (
		<form
			data-testid="filtres-liste"
			aria-label={t('liste.filtres.aria')}
			className="flex flex-wrap items-end gap-3"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				const saisie = new FormData(evenement.currentTarget).get(CHAMP_RECHERCHE)
				onParametres({
					...parametres,
					recherche: typeof saisie === 'string' ? saisie.trim() : '',
					page: 1,
				})
			}}
		>
			<div className="flex flex-col gap-1">
				<label htmlFor={idEtape} className="text-sm text-text-2">
					{t('liste.filtre.etape')}
				</label>
				<select
					id={idEtape}
					data-testid="filtre-etape"
					value={parametres.etape ?? ''}
					onChange={(evenement) => {
						const choisie = evenement.target.value
						onParametres({ ...parametres, etape: choisie === '' ? null : choisie, page: 1 })
					}}
					className="min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-base"
				>
					{/* Toutes les étapes du workflow, y compris celles qu'aucune card n'occupe : une
					    étape absente de la liste ferait croire qu'elle n'existe pas (§12.5). */}
					<option value="">{t('liste.filtre.etape.toutes')}</option>
					{etapes.map((etape) => (
						<option key={etape.id} value={etape.id}>
							{etape.libelle}
						</option>
					))}
				</select>
			</div>

			<div className="flex flex-col gap-1 min-w-0">
				<label htmlFor={idRecherche} className="text-sm text-text-2">
					{t('liste.filtre.recherche')}
				</label>
				<input
					id={idRecherche}
					name={CHAMP_RECHERCHE}
					data-testid="filtre-recherche"
					type="search"
					defaultValue={parametres.recherche}
					// `key` force le champ à repartir de la valeur de l'adresse lorsque celle-ci change
					// autrement que par cette saisie — un « effacer les filtres », par exemple.
					key={parametres.recherche}
					className="min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-base"
				/>
			</div>

			<Button variante="secondaire" type="submit" data-testid="valider-recherche">
				<Search aria-hidden="true" size={16} strokeWidth={2} />
				{t('liste.filtre.recherche.submit')}
			</Button>

			{!filtre ? null : (
				<Button
					variante="discret"
					data-testid="effacer-filtres"
					onClick={() => onParametres({ ...parametres, etape: null, recherche: '', page: 1 })}
				>
					{t('liste.filtre.effacer')}
				</Button>
			)}

			<p data-testid="total-liste" className="text-sm text-text-2 ml-auto">
				{t('liste.total', { total: String(total) })}
			</p>
		</form>
	)
}

const CHAMP_RECHERCHE = 'recherche'

/**
 * Pagination (§12.8).
 *
 * Les boutons sont **désactivés** aux extrémités, jamais masqués : un état désactivé reste lisible
 * et dit pourquoi l'action est indisponible (docs/DESIGN_SYSTEM.md §8). Le rang et le total sont
 * écrits en toutes lettres, pas seulement suggérés par la position des boutons.
 */
function Pagination({
	parametres,
	pages,
	onParametres,
}: {
	readonly parametres: ParametresListe
	readonly pages: number
	readonly onParametres: (parametres: ParametresListe) => void
}) {
	return (
		<nav data-testid="pagination-liste" aria-label={t('liste.page.position', {
			rang: String(parametres.page),
			pages: String(pages),
		})} className="flex items-center gap-3">
			<Button
				variante="secondaire"
				data-testid="page-precedente"
				disabled={parametres.page <= 1}
				onClick={() => onParametres({ ...parametres, page: parametres.page - 1 })}
			>
				{t('liste.page.precedente')}
			</Button>
			<p data-testid="rang-page" className="text-sm text-text-2">
				{t('liste.page.position', { rang: String(parametres.page), pages: String(pages) })}
			</p>
			<Button
				variante="secondaire"
				data-testid="page-suivante"
				disabled={parametres.page >= pages}
				onClick={() => onParametres({ ...parametres, page: parametres.page + 1 })}
			>
				{t('liste.page.suivante')}
			</Button>
		</nav>
	)
}

/**
 * La bascule board ↔ liste.
 *
 * Une paire de **liens**, `aria-current="page"` sur la vue ouverte : le patron déjà retenu pour la
 * barre d'onglets (docs/DESIGN_SYSTEM.md §12.1), et pour le même motif — les deux vues changent
 * d'adresse, ce qu'un `tablist` ne décrit pas.
 */
export function BasculeVue({
	slugTrack,
	slugChannel,
	vue,
}: {
	readonly slugTrack: string
	readonly slugChannel: string
	readonly vue: 'board' | 'liste'
}) {
	const base = `/tracks/${slugTrack}/${slugChannel}`
	const liens = [
		{ vue: 'board' as const, adresse: base, cle: 'liste.vue.board' as CleTraduction },
		{ vue: 'liste' as const, adresse: `${base}/liste`, cle: 'liste.vue.liste' as CleTraduction },
	]

	return (
		<nav aria-label={t('liste.vue.aria')} data-testid="bascule-vue">
			<ul className="flex items-center gap-2">
				{liens.map((lien) => {
					const courant = lien.vue === vue
					return (
						<li key={lien.vue}>
							<Link
								to={lien.adresse}
								data-testid="lien-vue"
								data-vue={lien.vue}
								{...(courant ? { 'aria-current': 'page' as const } : {})}
								className={[
									'inline-flex items-center justify-center',
									'min-h-[var(--size-target)] px-4 rounded-sm text-base font-medium',
									'transition-colors duration-[var(--transition-duration-fast)]',
									courant ? 'bg-brand-soft text-brand' : 'text-text-2 hover:bg-hover',
								].join(' ')}
							>
								{t(lien.cle)}
							</Link>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}
