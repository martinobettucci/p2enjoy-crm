// @verifies CRM-065 (docs/BACKLOG.md) — tranche 2, sous-tranche 2b : la palette, sur session réelle
// @verifies docs/SPEC-recherche.md §12.1 (la place dans l'en-tête), §12.2 (ni modale ni voile),
//           §14.1 (le raccourci), §14.2 (ce que le champ envoie et la troncature),
//           §14.3 (la navigation clavier), §14.4 (les états et l'état d'arrivée),
//           §14.5 (sans session, rien n'est rendu), §13.4 (la destination des cinq familles),
//           §11 M19 (l'asymétrie du seed, éprouvée par son COMPTE)
// @verifies docs/DESIGN_SYSTEM.md §5.46 (cette surface), §7 (les paliers), §8 (clavier) ;
//           CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER, comme un utilisateur réel : aucune fonction interne n'est
// appelée, aucune réponse n'est substituée, et le navigateur obtient son jeton par le formulaire
// réel puis parle à la vraie API. C'est la discipline de `e2e/ui/notifications.spec.ts`.
//
// LE SEED SORT INTACT : cette suite n'écrit RIEN. La recherche est une lecture, et la navigation
// vers un objet n'en modifie aucun.
//
// L'ASYMÉTRIE DU SEED EST ÉPROUVÉE PAR SON COMPTE, JAMAIS PAR UNE SEULE ABSENCE (M19). Sans les
// deux comptes, un écran qui n'afficherait RIEN passerait le refus : c'est le défaut que la
// contre-épreuve interne évite.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-065'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** Le terme qui porte l'asymétrie du seed sur une seule frappe (M19). */
const TERME_ASYMETRIQUE = 'sogexia'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Ouvre la palette AU RACCOURCI et frappe le terme, comme un utilisateur. */
async function chercherAuClavier(page: Page, terme: string): Promise<void> {
	await page.keyboard.press('ControlOrMeta+k')
	await expect(page.getByTestId('champ-recherche')).toBeFocused()
	await page.keyboard.type(terme)
}

test.describe('Le champ et son raccourci (§12.1, §14.1, §14.5)', () => {
	// SANS SESSION, RIEN N'EST RENDU (§14.5). Un champ offert à un anonyme promettrait une
	// recherche que la base refuse par le PRIVILÈGE — la commande morte du §5.10.
	test('aucun champ de recherche pour un visiteur anonyme', async ({ page }) => {
		await page.goto('/')
		await expect(page.getByTestId('entete')).toBeVisible()
		// Le témoin qui rend l'absence PROBANTE, et non un écran simplement vide : l'en-tête
		// anonyme rend « Se connecter » à la place de l'identité (§5.12).
		await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible()
		await expect(page.getByTestId('champ-recherche')).toHaveCount(0)
		// Le raccourci est INACTIF, et pas seulement le champ absent.
		await page.keyboard.press('ControlOrMeta+k')
		await expect(page.getByTestId('panneau-recherche')).toHaveCount(0)
	})

	test('le champ vit dans l’en-tête, et son libellé est masqué SANS être retiré (§12.3)', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		const champ = page.getByTestId('champ-recherche')
		await expect(champ).toBeVisible()
		// Le libellé n'est pas rendu à l'œil, mais il EST le nom accessible : réduire l'affichage
		// ne réduit pas l'information annoncée aux technologies d'assistance (§12.3).
		await expect(champ).toHaveAccessibleName('Rechercher dans le CRM')
		await expect(page.getByText('Rechercher dans le CRM', { exact: true })).toHaveCount(1)
		// Le raccourci est ÉCRIT DANS LE CHAMP : un raccourci qu'aucun écran n'enseigne n'existe
		// que pour qui le connaît déjà (§5.46).
		await expect(page.getByTestId('raccourci-recherche')).toBeVisible()
	})

	test('le raccourci ouvre la palette et porte le focus dans le champ', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.keyboard.press('ControlOrMeta+k')
		await expect(page.getByTestId('champ-recherche')).toBeFocused()
		await expect(page.getByTestId('panneau-recherche')).toBeVisible()
	})

	// LE RACCOURCI ROUVRE, IL NE BASCULE JAMAIS (§14.3). Une palette qui se refermerait sur une
	// seconde pression punirait qui l'a frappée deux fois par réflexe.
	test('une SECONDE pression ne referme pas la palette : elle resélectionne le terme', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, 'refonte')
		await page.keyboard.press('ControlOrMeta+k')
		await expect(page.getByTestId('panneau-recherche')).toBeVisible()
		// Le texte est SÉLECTIONNÉ : la frappe suivante le remplace, ce qui est le geste utile.
		await page.keyboard.type('audit')
		await expect(page.getByTestId('champ-recherche')).toHaveValue('audit')
	})

	// AUCUNE MODALE, ET C'EST LE POINT DE LA SURFACE (§12.2, §5.46). Le voile cacherait l'écran
	// d'où l'on cherche.
	test('AUCUN voile, et l’écran d’où l’on cherche reste lisible sous la palette', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		await expect(page.getByTestId('panneau-recherche')).toBeVisible()
		// Le voile du tiroir de navigation est le SEUL du produit, et il n'est pas ici.
		await expect(page.getByTestId('voile-tiroir')).toHaveCount(0)
		// Le titre de la route et l'identité de session restent lisibles : on cherche DEPUIS
		// quelque part, et ce quelque part reste visible.
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
	})
})

test.describe('Les états de la palette (§14.4)', () => {
	// L'ÉTAT D'ARRIVÉE N'EST PAS UN VIDE : la phrase dit ce que la recherche cherche, plutôt que
	// d'annoncer une absence que personne n'a demandée.
	test('à l’ouverture, la palette dit ce qu’elle cherche — et n’annonce AUCUNE absence', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.keyboard.press('ControlOrMeta+k')
		await expect(page.getByTestId('recherche-arrivee')).toBeVisible()
		await expect(page.getByTestId('recherche-vide')).toHaveCount(0)
		await expect(page.getByTestId('liste-recherche')).toHaveCount(0)
	})

	// LE MESSAGE DIT QUE LA RECHERCHE A ABOUTI, pas qu'elle a échoué, et il n'offre AUCUNE action.
	test('un terme sans correspondance rend « aucun résultat », sans action', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, 'zzzintrouvablezzz')
		await expect(page.getByTestId('recherche-vide')).toBeVisible()
		await expect(page.getByTestId('liste-recherche')).toHaveCount(0)
		await expect(page.getByTestId('recherche-arrivee')).toHaveCount(0)
	})

	// VIDER LE CHAMP RAMÈNE À L'ÉTAT D'ARRIVÉE, jamais à « aucun résultat » : n'avoir rien tapé
	// n'est pas n'avoir rien trouvé.
	test('vider le champ ramène à l’état d’arrivée, jamais à l’état vide', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		await expect(page.getByTestId('liste-recherche')).toBeVisible()
		await page.getByTestId('champ-recherche').fill('')
		await expect(page.getByTestId('recherche-arrivee')).toBeVisible()
		await expect(page.getByTestId('recherche-vide')).toHaveCount(0)
	})
})

test.describe('Ce que la liste rend, et pour qui (§13.4, M19)', () => {
	/**
	 * M19 — L'ASYMÉTRIE DU SEED, ÉPROUVÉE PAR SON COMPTE.
	 *
	 * Un seul terme exerce les familles côté lecture et la RLS côté refus. La contre-épreuve est
	 * le COMPTE des deux côtés : sans elle, un écran qui n'afficherait rien passerait le refus.
	 */
	test('l’administratrice voit QUATRE résultats là où la lectrice en voit TROIS', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		await expect(page.getByTestId('resultat-recherche')).toHaveCount(4)
		await expect(page.getByText('Migration ERP Sogexia')).toBeVisible()
	})

	test('la lectrice en voit TROIS, et l’écran NE NOMME JAMAIS la quatrième', async ({ page }) => {
		await connecter(page, VIEWER)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		await expect(page.getByTestId('resultat-recherche')).toHaveCount(3)
		// L'écran ne dit pas « une affaire vous est masquée » : c'est la règle de discrétion que le
		// §5.33 et le §5.37 tiennent déjà, et la divulguer par la bande serait pire que la montrer.
		await expect(page.getByText('Migration ERP Sogexia')).toHaveCount(0)
		await expect(page.getByTestId('panneau-recherche')).not.toContainText('masqué')
	})

	// LA FAMILLE EST UN MOT, jamais une icône ni une teinte (§1, §9), et JAMAIS le discriminant
	// technique de la base (§10).
	test('chaque ligne porte sa famille EN TOUTES LETTRES, jamais le discriminant brut', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		const premier = page.getByTestId('resultat-recherche').first()
		await expect(premier).toHaveAttribute('data-famille', 'organisation')
		await expect(premier).toContainText('Organisation')
		// Le discriminant technique de la base n'atteint JAMAIS l'écran.
		await expect(page.getByTestId('panneau-recherche')).not.toContainText('affaire ')
	})

	// TROIS FAMILLES SUR UN MÊME TERME : c'est ce qui distingue une recherche transverse du filtre
	// local de chaque écran.
	test('un terme trouvé dans plusieurs familles les rend toutes, classées entre elles', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, 'refonte')
		const lignes = page.getByTestId('resultat-recherche')
		await expect(lignes.first()).toBeVisible()
		const familles = await lignes.evaluateAll((noeuds) =>
			noeuds.map((noeud) => noeud.getAttribute('data-famille')),
		)
		expect(new Set(familles).size).toBeGreaterThan(1)
		// L'ORDRE VIENT DU SERVEUR et n'est jamais retrié à l'écran (§14.4) : les familles se
		// mêlent donc, elles ne se regroupent pas.
		expect(familles).toContain('affaire')
	})
})

test.describe('La navigation clavier (§14.3)', () => {
	// LE FOCUS NE QUITTE JAMAIS LE CHAMP, et c'est la règle qui décide la forme : les flèches
	// déplacent un RÉSULTAT ACTIF, pas le focus.
	test('les flèches déplacent le résultat actif SANS jamais sortir du champ', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		await expect(page.getByTestId('resultat-recherche')).toHaveCount(4)

		const champ = page.getByTestId('champ-recherche')
		const lignes = page.getByTestId('resultat-recherche')
		await expect(lignes.nth(0)).toHaveAttribute('aria-selected', 'true')

		await page.keyboard.press('ArrowDown')
		await expect(champ).toBeFocused()
		await expect(lignes.nth(1)).toHaveAttribute('aria-selected', 'true')
		await expect(lignes.nth(0)).toHaveAttribute('aria-selected', 'false')

		await page.keyboard.press('ArrowUp')
		await expect(champ).toBeFocused()
		await expect(lignes.nth(0)).toHaveAttribute('aria-selected', 'true')
	})

	// LA BOUCLE EST UN CHOIX ÉCRIT (§14.3) : sur vingt lignes au plus, revenir en haut est plus
	// court que de remonter.
	test('la flèche haut depuis le premier résultat va au DERNIER', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		const lignes = page.getByTestId('resultat-recherche')
		await expect(lignes).toHaveCount(4)
		await page.keyboard.press('ArrowUp')
		await expect(lignes.nth(3)).toHaveAttribute('aria-selected', 'true')
	})

	// LE CHAMP EST UNE `combobox`, ET SA LIGNE ACTIVE EST DÉSIGNÉE PAR `aria-activedescendant` —
	// le premier du produit, employé parce qu'aucun autre patron ne tient les deux exigences.
	test('`aria-activedescendant` désigne réellement la ligne active', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		const champ = page.getByTestId('champ-recherche')
		await expect(champ).toHaveRole('combobox')
		// LA PREUVE ATTEND LES RÉSULTATS AVANT DE FRAPPER LA FLÈCHE, et c'est un défaut de PREUVE
		// trouvé en l'exécutant : sans cette attente, `ArrowDown` arrive sur une liste vide, le
		// gestionnaire sort sans rien faire — comme le §14.3 le demande —, et l'attribut est
		// légitimement absent. La preuve mesurait alors son propre empressement.
		await expect(page.getByTestId('resultat-recherche')).toHaveCount(4)
		await page.keyboard.press('ArrowDown')
		const designe = await champ.getAttribute('aria-activedescendant')
		expect(designe).toBeTruthy()
		const ligneActive = page.getByTestId('resultat-recherche').nth(1)
		await expect(ligneActive).toHaveAttribute('id', designe as string)
	})

	// `ÉCHAP` REFERME ET REND LE FOCUS (§14.1, §5.13).
	test('`Échap` referme la palette et rend le focus', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		await expect(page.getByTestId('panneau-recherche')).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('panneau-recherche')).toHaveCount(0)
	})
})

test.describe('La navigation vers l’objet (§13.4)', () => {
	// C'EST LA DEFINITION OF DONE DE L'UNITÉ : « la palette s'ouvre au clavier, se parcourt au
	// clavier et MÈNE À L'OBJET ».
	test('`Entrée` sur une AFFAIRE mène à sa fiche, et l’adresse porte ses deux slugs', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, 'Migration ERP')
		// LA PREUVE NE SUPPOSE PLUS L'ORDRE DU SERVEUR, et c'est un second défaut de PREUVE trouvé
		// en l'exécutant. Elle attendait l'affaire en TÊTE ; MESURÉ, le terme rend d'abord le
		// message « Point d'avancement — migration ERP » (rang 1,0303) puis l'affaire (rang 1).
		// L'ordre est celui du serveur et l'écran ne le retrie pas (§14.4) : c'était l'attente qui
		// était fausse, jamais le produit. La preuve désigne donc la ligne par sa FAMILLE.
		const affaire = page
			.getByTestId('resultat-recherche')
			.filter({ has: page.getByText('Affaire', { exact: true }) })
			.first()
		await expect(affaire).toHaveAttribute('data-famille', 'affaire')
		await expect(affaire).toHaveAttribute('data-atteignable', 'oui')
		await affaire.click()

		// L'adresse d'une affaire exige les deux slugs, et aucun ne se déduit de l'autre (M15).
		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes\/cards\//)
		// LE TITRE EST CHERCHÉ DANS L'EN-TÊTE DE LA FICHE, ET NON DANS LA PAGE ENTIÈRE : le titre
		// de la route le porte AUSSI (§5.3 bis), et une assertion non scopée en trouve deux. Défaut
		// de PREUVE trouvé en l'exécutant, jamais du produit — les deux titres sont légitimes.
		await expect(
			page.getByTestId('entete-card').getByRole('heading', { name: /Migration ERP Sogexia/ }),
		).toBeVisible()
		// La palette se referme et le champ se vide : on est arrivé, il n'y a plus rien à chercher.
		await expect(page.getByTestId('panneau-recherche')).toHaveCount(0)
		await expect(page.getByTestId('champ-recherche')).toHaveValue('')
	})

	// UN COMMENTAIRE MÈNE À L'AFFAIRE COMMENTÉE, JAMAIS À LUI-MÊME. La tranche 1 avait préparé
	// exactement cela en excluant le commentaire d'une affaire à la corbeille : sans cette clause,
	// la palette offrirait une DESTINATION MORTE.
	test('`Entrée` sur un COMMENTAIRE mène à la fiche de l’affaire commentée', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, 'gabarit')
		const lignes = page.getByTestId('resultat-recherche')
		await expect(lignes).toHaveCount(1)
		await expect(lignes.first()).toHaveAttribute('data-famille', 'commentaire')
		await page.keyboard.press('Enter')

		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes\/cards\//)
		await expect(
			page.getByTestId('entete-card').getByRole('heading', { name: /Refonte du site vitrine/ }),
		).toBeVisible()
	})

	// UNE ORGANISATION MÈNE À SA FICHE PAR SON SEUL IDENTIFIANT : aucune résolution n'est due.
	test('un clic sur une ORGANISATION mène à sa fiche', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, TERME_ASYMETRIQUE)
		const organisation = page
			.getByTestId('resultat-recherche')
			.filter({ has: page.getByText('Organisation') })
			.first()
		await organisation.click()
		await expect(page).toHaveURL(/\/contacts\/organisations\//)
		await expect(page.getByRole('heading', { name: 'Sogexia' })).toBeVisible()
	})

	// UN MESSAGE MÈNE À L'INBOX, ET SON ADRESSE PORTE LE MESSAGE (§13.5). Le paramètre est
	// **inerte** tant que la sous-tranche 2c n'est pas livrée, et l'écart est nommé plutôt que
	// masqué : l'utilisateur arrive sur sa boîte, ce qui n'est pas une destination morte.
	test('`Entrée` sur un MESSAGE mène à l’inbox, l’adresse portant le message', async ({ page }) => {
		await connecter(page, ADMIN)
		await chercherAuClavier(page, 'candidature')
		const lignes = page.getByTestId('resultat-recherche')
		await expect(lignes).toHaveCount(1)
		await expect(lignes.first()).toHaveAttribute('data-famille', 'message')
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/inbox\?message=/)
	})
})

test.describe('Vérification visuelle (CLAUDE.md §16, docs/DESIGN_SYSTEM.md §7)', () => {
	test('la palette peuplée aux quatre paliers, et la page ne défile jamais horizontalement', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			// LA PAGE EST RECHARGÉE APRÈS CHAQUE CHANGEMENT DE PALIER, et ce n'est pas une
			// précaution de style : la barre latérale bascule en TIROIR sous 1024 px avec une
			// transition de 250 ms (§3), et une capture prise pendant ce vol montre un tiroir à
			// mi-course qui recouvre le fil d'Ariane — observé sur `recherche-palette-md-900.jpg`.
			// Le rechargement fait rendre la mise en page du palier D'EMBLÉE, sans transition.
			// C'est le procédé de `e2e/ui/notifications.spec.ts`, et **aucune temporisation** n'est
			// ajoutée (`CLAUDE.md` §18).
			await page.reload()
			await expect(page.getByTestId('entete')).toBeVisible()
			// Sous `md`, le champ cède la place au titre de route et devient une commande à icône
			// (§5.46, §12.2). Les deux chemins mènent au MÊME panneau.
			await page.keyboard.press('ControlOrMeta+k')
			await page.getByTestId('champ-recherche').fill(TERME_ASYMETRIQUE)
			await expect(page.getByTestId('resultat-recherche').first()).toBeVisible()
			await capturer(page, `recherche-palette-${palier.nom}`, UNITE)

			// LA PAGE NE DÉFILE JAMAIS HORIZONTALEMENT (§7).
			// LE DIAGNOSTIC NOMME LE COUPABLE, il ne se contente pas de dire « ça déborde » : une
			// preuve de palier qui échoue sans dire QUEL élément sort du cadre oblige à rejouer
			// l'exécution pour l'apprendre. C'est la leçon du §5.43 sur la mesure du CADRE.
			const debordement = await page.evaluate(() => {
				const doc = document.documentElement
				const coupables: string[] = []
				for (const noeud of Array.from(document.querySelectorAll('*'))) {
					const cadre = noeud.getBoundingClientRect()
					if (cadre.width > 0 && cadre.right > doc.clientWidth + 0.5) {
						coupables.push(
							`${noeud.tagName}.${String(noeud.className).slice(0, 60)} → ${Math.round(cadre.right)}`,
						)
					}
				}
				return { deborde: doc.scrollWidth > doc.clientWidth, largeur: doc.clientWidth, coupables }
			})
			expect(
				debordement.deborde,
				`débordement horizontal au palier ${palier.nom} (${debordement.largeur} px) : ${debordement.coupables.join(' | ')}`,
			).toBe(false)

			// LE PANNEAU EST BORNÉ DES DEUX CÔTÉS, et ce n'est pas `scrollWidth` qui le dit : une
			// coordonnée négative n'engendre aucun défilement. C'est la seconde moitié de la leçon
			// payée par le §5.43 — toute preuve de palier portant sur une surface flottante mesure
			// son CADRE.
			const cadre = await page.getByTestId('panneau-recherche').boundingBox()
			expect(cadre, `panneau absent au palier ${palier.nom}`).not.toBeNull()
			expect(cadre?.x ?? -1, `bord gauche hors cadre au palier ${palier.nom}`).toBeGreaterThanOrEqual(0)
			expect(
				(cadre?.x ?? 0) + (cadre?.width ?? 0),
				`bord droit hors cadre au palier ${palier.nom}`,
			).toBeLessThanOrEqual(palier.largeur)

			await page.keyboard.press('Escape')
		}
	})

	test('l’état d’arrivée et l’état vide, capturés au palier large', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.keyboard.press('ControlOrMeta+k')
		await expect(page.getByTestId('recherche-arrivee')).toBeVisible()
		await capturer(page, 'recherche-arrivee-xl-1440', UNITE)

		await page.getByTestId('champ-recherche').fill('zzzintrouvablezzz')
		await expect(page.getByTestId('recherche-vide')).toBeVisible()
		await capturer(page, 'recherche-vide-xl-1440', UNITE)
	})
})
