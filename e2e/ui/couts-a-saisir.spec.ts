// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 6b : le parcours d'interface de
//           l'onglet « À saisir », et les preuves que la Definition of Done réclame nommément
// @verifies docs/SPEC-costs.md §4.0 (l'onglet vit dans la chaîne de requête, `?onglet=saisir`),
//           §4.8 (ce que l'onglet liste — budgets clôturés COMPRIS —, la saisie en série, la ligne
//           enregistrée qui reste en place, zéro qui n'est pas un vide, la lecture seule avec son
//           motif, le compteur, les trois états), §4.8.1 (le droit d'écriture rendu par la base),
//           §4.8.2 (le badge compte ce que le tableau liste), §4.8.3 (l'arbitrage d'INC-182 : le
//           badge et la mention du §4.4 comptent deux populations, mesuré sur le seed, et l'écran
//           écrit la portée du compteur)
// @verifies docs/DESIGN_SYSTEM.md §5.31 (table de saisie en série : onglets, badge, clavier,
//           pilule « clôturé », lecture seule), §5.9 (tableau de données), §5.8 (états),
//           §7 (les quatre paliers), §8 (clavier), §12.1 (navigation par liens)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// CE FICHIER ÉCRIT, ET IL RESTAURE — l'écart avec `couts-track.spec.ts`, `couts-budget.spec.ts` et
// `couts-workspace.spec.ts`, qui ne modifient rien. Il ne peut pas ne pas écrire : la saisie EST
// l'objet de cet onglet, et une preuve qui ne l'exercerait pas ne dirait rien de ce que la
// Definition of Done demande. La règle de la décision 362 s'applique donc — la purge accompagne
// l'écriture —, sous une forme adaptée à ce que le geste fait : il ne CRÉE aucune ligne, il
// renseigne le `actual_cost` d'une ligne SEEDÉE. L'épilogue le remet donc à `NULL`, en entrée
// comme en sortie, faute de quoi `scripts/verify-card-costs.sh` — qui exige qu'« au moins une
// ligne sans réel vive sur un budget clôturé » — deviendrait rouge sur un résidu.
//
// LA LIGNE ÉCRITE EST CELLE DU BUDGET CLÔTURÉ, et ce choix porte une preuve à lui seul : la
// Definition of Done demande qu'« une ligne d'un budget clôturé soit présente ET saisissable », et
// c'est exactement ce que S3 exerce. Elle est en outre la seule des trois qu'aucun histogramme ne
// compte — le §4.2 et le §4.5 excluent les budgets clos —, de sorte que l'écrire ne peut pas
// déplacer un total mesuré par une autre preuve.
//
// LES NOMBRES CI-DESSOUS SONT MESURÉS SUR LA PILE RÉELLE le 2026-08-20, avec les jetons du seed :
//
//   * `admin` et `bizdev` lisent TROIS lignes en attente — « Publicité » (100, « Publicité 2026 »,
//     Studio web), « Prospection terrain » (800, « Prospection sortante », Conseil & IA) et
//     « Impression plaquettes » (1200, « Salon du web 2025 » CLÔTURÉ, Studio web) —, et
//     `reel_saisissable` vaut `true` sur les trois ;
//   * `viewer` en lit DEUX — « Publicité » et « Impression plaquettes » —, et `reel_saisissable`
//     vaut `false` sur les deux : « Prospection terrain » vit sur un track qu'elle ne lit pas, et
//     la double condition du §3.1 l'écarte. C'est le cas qui rend l'état « aucune ligne écrivable,
//     mais des lignes lisibles » du §4.8 réellement observable ;
//   * la portée d'un track ne rend que ses budgets : DEUX lignes sur `studio-web`, UNE sur
//     `conseil-ia`.

import { autoriserErreursConsole, expect, test, type APIRequestContext, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-086'
const ADMIN = 'admin@p2enjoy.test'
/** La lectrice : aucune des lignes qu'elle lit n'est écrivable par elle (§4.8.1). */
const VIEWER = 'viewer@p2enjoy.test'

const CUMUL_A_SAISIR = '/couts?onglet=saisir'
const TRACK_A_SAISIR = '/tracks/studio-web/couts?onglet=saisir'
const TRACK_AUTRE = '/tracks/conseil-ia/couts?onglet=saisir'

const LIGNE_BUDGET_CLOS = 'Impression plaquettes'
const LIGNE_OUVERTE = 'Publicité'
const LIGNE_AUTRE_TRACK = 'Prospection terrain'

/** L'identifiant seedé de la ligne écrite par S3 — `supabase/seed/apply-seed.sh` §8 quindecies. */
const ID_LIGNE_BUDGET_CLOS = '5eed0000-0000-4000-8000-0000000000e5'

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/**
 * Remet la ligne écrite dans l'état du seed — `actual_cost` à `NULL`.
 *
 * PAR LA CLÉ DE SERVICE, comme la purge de `card-costs.spec.ts`, et le statut est CONTRÔLÉ : une
 * restauration complaisante laisserait le dépôt dans un état que la preuve suivante lirait comme
 * une régression, ce que la décision 473 a déjà payé une fois.
 */
async function restaurer(request: APIRequestContext): Promise<void> {
	const reponse = await request.patch(
		`${URL_API}/rest/v1/card_costs?id=eq.${ID_LIGNE_BUDGET_CLOS}`,
		{ headers: { ...enTetesService(), 'Content-Type': 'application/json' }, data: { actual_cost: null } },
	)
	expect(reponse.status(), 'la restauration de la ligne seedée doit aboutir').toBeLessThan(300)
}

test.beforeEach(async ({ request }) => {
	await restaurer(request)
})

test.afterEach(async ({ request }) => {
	await restaurer(request)
})

/** La ligne du tableau de l'onglet portant cette nature de dépense. */
const ligneDe = (page: Page, nature: string) =>
	page.getByTestId('couts-a-saisir-ligne').filter({ hasText: nature })

/** Le champ « Réel » de cette ligne — la seule cible de saisie de la table (§5.31). */
const champDe = (page: Page, nature: string) =>
	ligneDe(page, nature).getByTestId('couts-a-saisir-champ')

test.describe('CRM-086 — onglet « À saisir » (docs/SPEC-costs.md §4.8)', () => {
	test('S1 — l’onglet vit dans l’ADRESSE, et son badge compte ce que le tableau liste', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto('/couts')

		// La vue d'ensemble est l'onglet par défaut : l'adresse la plus courte (§4.0).
		await expect(page.getByRole('link', { name: /Vue d’ensemble/ })).toHaveAttribute(
			'aria-current',
			'page',
		)
		// Le badge est lu SUR LES DEUX onglets : c'est lui qui donne la raison d'ouvrir le second.
		const onglet = page.getByTestId('onglet-couts-saisir')
		await expect(onglet.getByTestId('onglet-couts-badge')).toHaveText('3')

		await onglet.click()
		// L'onglet est atteignable, donc partageable et rechargeable : il vit dans la chaîne de
		// requête, jamais dans un état local (§4.0).
		await expect(page).toHaveURL(/\?onglet=saisir$/)
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(3)
		// LE BADGE ET LE TABLEAU NE PEUVENT PAS RÉPONDRE À DEUX SOURCES (§4.8.2) : le nombre annoncé
		// est celui des lignes rendues juste en dessous.
		await expect(onglet.getByTestId('onglet-couts-badge')).toHaveText('3')

		// Rechargée directement, l'adresse ouvre le même onglet : c'est ce que « vivre dans l'adresse »
		// veut dire, et un état local ne le donnerait pas.
		await page.goto(CUMUL_A_SAISIR)
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(3)
	})

	test('S2 — la PORTÉE d’un track ne rend que ses budgets, clôturés compris', async ({ page }) => {
		await connecter(page)
		await page.goto(TRACK_A_SAISIR)

		// « Studio web » porte deux budgets — l'un ouvert, l'autre CLÔTURÉ — et donc deux lignes.
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(2)
		await expect(ligneDe(page, LIGNE_OUVERTE)).toHaveCount(1)
		await expect(ligneDe(page, LIGNE_BUDGET_CLOS)).toHaveCount(1)
		// La ligne de l'autre track n'y est pas : la portée est celle de l'écran (§4.8).
		await expect(ligneDe(page, LIGNE_AUTRE_TRACK)).toHaveCount(0)

		// LA PILULE « clôturé » EST NEUTRE, ET LA LIGNE RESTE SAISISSABLE : c'est la Definition of
		// Done, mot pour mot — « une ligne d'un budget clôturé est présente et saisissable ». Un
		// budget clos n'est pas une erreur, et « c'est précisément après la clôture que les factures
		// arrivent » (§4.8).
		await expect(
			ligneDe(page, LIGNE_BUDGET_CLOS).getByTestId('couts-a-saisir-clos'),
		).toBeVisible()
		await expect(champDe(page, LIGNE_BUDGET_CLOS)).toBeEnabled()
		// La ligne du budget OUVERT ne porte aucune pilule : elle affirmerait un fait qui n'est pas.
		await expect(ligneDe(page, LIGNE_OUVERTE).getByTestId('couts-a-saisir-clos')).toHaveCount(0)

		await page.goto(TRACK_AUTRE)
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(1)
		await expect(ligneDe(page, LIGNE_AUTRE_TRACK)).toHaveCount(1)
	})

	test('S3 — AU CLAVIER SEUL : `Entrée` enregistre, porte le focus sur la ligne suivante, et la ligne reste en place', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(TRACK_A_SAISIR)
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(2)

		// L'ordre est celui du §4.8 — du plus ancien au plus récent —, donc « Publicité » d'abord et
		// « Impression plaquettes » ensuite. Le focus part du premier champ, atteint au clavier.
		const premier = champDe(page, LIGNE_OUVERTE)
		const second = champDe(page, LIGNE_BUDGET_CLOS)
		await premier.focus()
		// ZÉRO EST UNE VALEUR, PAS UN VIDE (§4.8) : il est saisi sur la ligne du budget clôturé, la
		// seule que l'épilogue restaure. Le premier champ est laissé VIDE et ne doit rien envoyer.
		await page.keyboard.press('Enter')
		// LA MESURE QUE LA DoD RÉCLAME : le focus passe au champ de la LIGNE SUIVANTE.
		await expect(second).toBeFocused()

		await page.keyboard.type('0')
		await page.keyboard.press('Enter')
		// La ligne enregistrée RESTE EN PLACE, marquée : la retirer à chaud ferait remonter les
		// suivantes sous les doigts de celui qui saisit (§4.8).
		await expect(ligneDe(page, LIGNE_BUDGET_CLOS).getByTestId('couts-a-saisir-enregistre')).toBeVisible()
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(2)
		// La marque est OBSERVÉE, pas seulement assertée (`CLAUDE.md` §16) : c'est la capture qui dit
		// si le fond de succès et la mention se lisent, et si la ligne a gardé sa place.
		await capturer(page, 'couts-a-saisir-enregistre-1440', UNITE)

		// AU RECHARGEMENT, ET ALORS SEULEMENT, la ligne quitte l'attente : c'est la preuve que
		// l'écriture a réellement abouti côté base, et que `0` vaut « rien dépensé » et non « vide ».
		await page.goto(TRACK_A_SAISIR)
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(1)
		await expect(ligneDe(page, LIGNE_BUDGET_CLOS)).toHaveCount(0)
		// Le champ laissé VIDE n'a rien envoyé : sa ligne est toujours en attente.
		await expect(ligneDe(page, LIGNE_OUVERTE)).toHaveCount(1)
		// Et le badge suit le tableau, sans qu'aucun compte ne soit recalculé ailleurs.
		await expect(
			page.getByTestId('onglet-couts-saisir').getByTestId('onglet-couts-badge'),
		).toHaveText('1')
	})

	test('S4 — LA LECTRICE : ses lignes sont rendues, en LECTURE SEULE, jamais masquées', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(CUMUL_A_SAISIR)

		// Elle lit DEUX des trois lignes ; la troisième vit sur un track qu'elle ne lit pas, et la
		// double condition du §3.1 l'écarte — l'écran ne le dit pas, et c'est voulu : nommer ce qu'on
		// ne montre pas divulguerait par la bande ce que la RLS ferme.
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(2)
		await expect(ligneDe(page, LIGNE_AUTRE_TRACK)).toHaveCount(0)

		// L'ÉTAT « aucune ligne écrivable, mais des lignes lisibles » du §4.8 : le tableau est rendu
		// entier, et le DIT EN TÊTE.
		await expect(page.getByTestId('couts-a-saisir-lecture-seule')).toBeVisible()
		// Chaque champ est désactivé ET LISIBLE, avec son motif — jamais masqué (§4.8, §8).
		await expect(champDe(page, LIGNE_OUVERTE)).toBeDisabled()
		await expect(champDe(page, LIGNE_BUDGET_CLOS)).toBeDisabled()
		await expect(
			ligneDe(page, LIGNE_OUVERTE).getByText('Vous ne pouvez pas modifier cette affaire.'),
		).toBeVisible()
		// Le badge compte AUSSI les lignes qu'elle ne peut pas écrire : les exclure écrirait « 0 » à
		// quelqu'un qui a deux lignes sous les yeux (§4.8.2).
		await expect(
			page.getByTestId('onglet-couts-saisir').getByTestId('onglet-couts-badge'),
		).toHaveText('2')
		// L'écran de la lectrice est OBSERVÉ : un champ désactivé doit rester LISIBLE (§8), et c'est
		// une capture qui le dit, jamais une assertion.
		await capturer(page, 'couts-a-saisir-lecture-seule-1440', UNITE)
	})

	test('S6 — LE BADGE ET LA MENTION DU §4.4 COMPTENT DEUX POPULATIONS, et l’écran le dit (§4.8.3)', async ({
		page,
	}) => {
		// C'EST LA PREUVE QUE L'ÉGALITÉ RETIRÉE NE POUVAIT PAS PORTER, et elle la MESURE plutôt que
		// de la supposer : l'arbitrage d'INC-182 (décision 544) a retiré du §4.8 l'exigence que le
		// badge porte « le même nombre que la mention du §4.4 ». Ce scénario met les deux nombres
		// sous les yeux, sur le même écran et le même jeu de données. Une régression qui ajouterait
		// un filtre de clôture à la lecture de l'onglet — le mimétisme que le §4.8.1 redoute — les
		// rendrait égaux, et ferait tomber cette assertion.
		await connecter(page)
		await page.goto('/tracks/studio-web/couts')

		// La mention du §4.4 est rendue SOUS l'histogramme, qui exclut les budgets clôturés (§4.2) :
		// elle ne compte donc que « Publicité », sur `Publicité 2026`.
		await expect(page.getByText(/^1 ligne\(s\) sans coût réel saisi/)).toBeVisible()
		// Le badge compte ce que le tableau de l'onglet LISTE, budget clos compris : deux lignes.
		const badge = page.getByTestId('onglet-couts-saisir').getByTestId('onglet-couts-badge')
		await expect(badge).toHaveText('2')
		// L'ÉCART EST NOMMÉ À L'ÉCRAN, et c'est ce que l'arbitrage ajoute : sans cette phrase, deux
		// nombres légitimement différents se lisent comme une erreur de calcul.
		await expect(page.getByTestId('couts-portee-compteur')).toBeVisible()
		// Le nom accessible du badge nomme sa population, et pas seulement le fait de compter.
		await expect(badge).toHaveAttribute(
			'aria-label',
			'2 ligne(s) en attente de leur coût réel, budgets clôturés compris, toutes devises confondues',
		)
		// L'écran est OBSERVÉ (`CLAUDE.md` §16) : c'est la capture qui dit si les deux nombres et la
		// phrase qui les sépare se lisent ensemble, sans se contredire à l'œil.
		await capturer(page, 'couts-a-saisir-portee-compteur-1440', UNITE)

		// LA MÊME SCÈNE AU PALIER LE PLUS ÉTROIT, et ce n'est pas un doublon de capture : cette
		// phrase est la plus longue des deux écrans de coûts, et c'est à 390 px qu'elle décide si
		// elle informe ou si elle noie la barre d'onglets qu'elle suit (`CLAUDE.md` §16).
		// LE PALIER EST POSÉ AVANT LA NAVIGATION, comme en S5 : redimensionner une page déjà rendue
		// en 1440 laisse la barre latérale dépliée par-dessus le contenu, et la capture montrerait
		// alors l'artefact du redimensionnement plutôt que l'écran qu'un visiteur reçoit.
		await page.setViewportSize({ width: 390, height: 780 })
		await page.goto('/tracks/studio-web/couts')
		await expect(page.getByTestId('couts-portee-compteur')).toBeVisible()
		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(debordement, 'aucun défilement horizontal de page à sm-390').toBeLessThanOrEqual(0)
		await capturer(page, 'couts-a-saisir-portee-compteur-390', UNITE)
		await page.setViewportSize({ width: 1440, height: 900 })

		// LE BADGE EST BIEN LE COMPTE DES LIGNES RENDUES — l'exigence qui REMPLACE l'égalité retirée.
		await page.goto(TRACK_A_SAISIR)
		await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(2)
		// Et la phrase de portée n'est PAS rendue ici : le tableau visible EST la population du
		// badge, elle n'aurait rien à expliquer.
		await expect(page.getByTestId('couts-portee-compteur')).toHaveCount(0)
	})

	test('S5 — captures aux quatre paliers, page jamais défilante horizontalement (§7)', async ({
		page,
	}) => {
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(CUMUL_A_SAISIR)
			await expect(page.getByTestId('couts-a-saisir-ligne')).toHaveCount(3)
			// « La page ne défile jamais horizontalement » (§7) : la table déborde dans SON conteneur,
			// que `contain: paint` empêche de propager sa largeur intrinsèque jusqu'à la racine.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, `aucun défilement horizontal de page à ${palier.nom}`).toBeLessThanOrEqual(
				0,
			)
			await capturer(page, `couts-a-saisir-${palier.nom}`, UNITE)
		}
		// L'état « tous les coûts réels sont saisis » est capturé lui aussi : la Definition of Done le
		// réclame nommément, et c'est une bonne nouvelle — pas un état vide en défaut (§4.8).
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/tracks/formation/couts?onglet=saisir')
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await capturer(page, 'couts-a-saisir-tout-saisi-1440', UNITE)

		// Aucune erreur console n'est attendue : la liste vide est le verdict.
		autoriserErreursConsole(page, [])
	})
})
