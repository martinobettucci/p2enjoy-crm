// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 6b : la barre d'onglets des deux
//       écrans à onglets, et le badge de l'onglet « À saisir »
// @spec docs/SPEC-costs.md §4.8 (les écrans de coûts sont à onglets ; le compteur),
//       §4.8.2 (la portée du badge, et ce qu'elle ne peut pas être — INC-182),
//       §4.8.3 (l'arbitrage d'INC-182 : le nom accessible du badge NOMME sa population),
//       §4.0 (« l'onglet vit dans la CHAÎNE DE REQUÊTE, `?onglet=saisir` »)
// @spec docs/DESIGN_SYSTEM.md §5.31 (onglets et badge), §12.1 (navigation par liens, non
//       `tablist`), §5.4 bis (un compte est un badge neutre au nom accessible entier),
//       §1 (la couleur ne porte jamais seule l'information), §8 (cible de 40 px)
// @spec docs/SPEC-webapp.md §5.3 (composants livrés)
//
// L'ONGLET VIT DANS L'ADRESSE, ET NON DANS UN ÉTAT LOCAL. Le §4.0 pose `?onglet=saisir` dans la
// chaîne de requête : l'onglet est donc partageable, rechargeable, et le bouton « précédent » du
// navigateur le rend. Un état local doublant l'adresse finirait par la contredire — la règle que
// `ZoneListe` tient déjà pour son tri et son filtre (`RouteTrack`, §12.2 de `SPEC-cards.md`).
//
// LE PATRON EST CELUI DU §12.1, ET NON `tablist`. Ces deux entrées changent l'ADRESSE et le contenu
// principal ; les annoncer comme des onglets ARIA décrirait un comportement qui n'est pas celui du
// produit, et le `tabindex` glissant du patron retirerait la navigation par `Tab`. Ce sont donc des
// liens, dans une `nav` étiquetée, et l'état courant se signale par `aria-current="page"` **et** par
// une bordure — jamais par la seule couleur (§1).
//
// `aria-current` EST POSÉ À LA MAIN, ET NON PAR `NavLink`. Les deux entrées partagent le même
// chemin et ne diffèrent que par la chaîne de requête, que `NavLink` ne compare pas : il poserait
// `aria-current` sur les DEUX, ou sur aucune. C'est le seul endroit du produit où deux liens de
// navigation ne se distinguent pas par leur chemin, et c'est la conséquence directe du §4.0.

import { Link, useSearchParams } from 'react-router'
import { t } from '../i18n'

/** Le paramètre d'adresse qui porte l'onglet — §4.0. */
export const CLE_URL_ONGLET = 'onglet' as const

/** La seule valeur écrite dans l'adresse : l'onglet par défaut n'y paraît jamais. */
export const VALEUR_URL_ONGLET_SAISIR = 'saisir' as const

export type OngletCouts = 'ensemble' | 'saisir'

/**
 * L'onglet demandé par l'adresse.
 *
 * **TOUTE VALEUR INCONNUE VAUT « Vue d'ensemble »**, comme l'absence du paramètre : le §4.0 pose
 * que « l'absence du paramètre vaut Vue d'ensemble, qui est l'onglet par défaut ». Une adresse
 * portant `?onglet=nimportequoi` ouvre donc l'écran par défaut plutôt qu'un état vide inventé —
 * la règle de `lireModeSommeil` pour le paramètre `sommeil`.
 */
export function lireOngletCouts(valeur: string | null): OngletCouts {
	return valeur === VALEUR_URL_ONGLET_SAISIR ? 'saisir' : 'ensemble'
}

/** Classes communes aux deux entrées — celles des onglets de channel (`TabBar`, §12.1). */
const CLASSES_ONGLET = [
	'inline-flex items-center gap-2 px-3 whitespace-nowrap',
	// Cible interactive ≥ 40 px (§8).
	'min-h-[var(--size-target)]',
	// La bordure basse porte l'état actif **en plus** de la couleur (§1), et les deux états portent
	// une bordure de même épaisseur : sans quoi le texte se décalerait de deux pixels au changement
	// d'onglet.
	'border-b-2',
	'transition-colors duration-[var(--transition-duration-fast)]',
].join(' ')

const CLASSES_ACTIF = 'border-brand text-brand font-medium'
const CLASSES_INACTIF = 'border-transparent text-text-2 hover:bg-hover'

export type ProprietesOngletsCouts = {
	readonly onglet: OngletCouts
	/**
	 * Le nombre de lignes en attente, ou `null` tant qu'il n'est pas connu.
	 *
	 * `null` ET NON `0` PENDANT LA LECTURE : un badge « 0 » affirmerait que tout est saisi alors que
	 * rien n'a encore été lu, ce qui est la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
	 * Le badge est simplement absent tant que le compte n'est pas en main — et il l'est aussi à
	 * zéro, où « le badge disparaît plutôt que d'afficher `0` » (§5.31).
	 */
	readonly nombreEnAttente: number | null
}

export function OngletsCouts({ onglet, nombreEnAttente }: ProprietesOngletsCouts) {
	const [parametres] = useSearchParams()

	// Les autres paramètres de l'adresse sont CONSERVÉS, et seul celui de l'onglet est réécrit :
	// aucun des deux écrans n'en porte d'autre aujourd'hui, mais un lien qui les effacerait
	// deviendrait faux au premier filtre ajouté — la règle de `changerSommeil` dans `RouteTrack`.
	const versEnsemble = new URLSearchParams(parametres)
	versEnsemble.delete(CLE_URL_ONGLET)
	const versSaisir = new URLSearchParams(parametres)
	versSaisir.set(CLE_URL_ONGLET, VALEUR_URL_ONGLET_SAISIR)

	return (
		<nav
			aria-label={t('costs.tabs.aria')}
			data-testid="onglets-couts"
			className="flex items-center gap-1 border-b border-border overflow-x-auto indique-debordement-x"
		>
			<Link
				to={{ search: enChaine(versEnsemble) }}
				data-testid="onglet-couts-ensemble"
				{...(onglet === 'ensemble' ? { 'aria-current': 'page' as const } : {})}
				className={`${CLASSES_ONGLET} ${onglet === 'ensemble' ? CLASSES_ACTIF : CLASSES_INACTIF}`}
			>
				{t('costs.tabs.overview')}
			</Link>
			<Link
				to={{ search: enChaine(versSaisir) }}
				data-testid="onglet-couts-saisir"
				{...(onglet === 'saisir' ? { 'aria-current': 'page' as const } : {})}
				className={`${CLASSES_ONGLET} ${onglet === 'saisir' ? CLASSES_ACTIF : CLASSES_INACTIF}`}
			>
				{t('costs.tabs.pending')}
				{nombreEnAttente !== null && nombreEnAttente > 0 ? (
					<span
						data-testid="onglet-couts-badge"
						aria-label={t('costs.tabs.pending.count', { n: String(nombreEnAttente) })}
						className="shrink-0 rounded-full bg-hover px-2 text-sm text-text-2 tabular-nums"
					>
						{nombreEnAttente}
					</span>
				) : null}
			</Link>
		</nav>
	)
}

/**
 * La chaîne de requête d'un lien, vide lorsqu'il n'y a plus aucun paramètre.
 *
 * `''` ET NON `'?'` : l'adresse de l'onglet par défaut est la plus COURTE (§4.0), et un point
 * d'interrogation esseulé la ferait différer de celle qu'un utilisateur tape.
 */
function enChaine(parametres: URLSearchParams): string {
	const chaine = parametres.toString()
	return chaine === '' ? '' : `?${chaine}`
}
