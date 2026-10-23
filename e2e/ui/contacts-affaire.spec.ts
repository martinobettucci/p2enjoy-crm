// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4c
// @verifies docs/SPEC-contacts.md §12.2 (le bloc vit dans la colonne gauche de la fiche),
//           §12.3 (la lecture), §12.4 (les mesures 1, 2, 4 et 12 : l'administratrice écrit, la
//           lectrice se voit refuser l'insertion et détache SANS EFFET),
//           §12.5 (le dictionnaire fermé), §12.7 (cas a, d, g, h, m, n, o, p)
// @verifies docs/DESIGN_SYSTEM.md §5.21 (le bloc), §5.13 (formulaire et confirmation dans le
//           flux), §7 (paliers) ; CLAUDE.md §16 (vérification visuelle)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du
//           SSO, fixture connecterAvecLeLabs (CRM-092 T5) : plus aucun mot de passe du CRM
// @verifies CRM-093 (docs/BACKLOG.md) — les cas h et o de la lectrice révisés : rattacher et détacher sont éteints avec le motif de l'a
//           ffaire (docs/SPEC-droits-interface.md §3, §5)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, et l'écriture passe par le formulaire de l'écran.
//
// LE SEED EST RENDU INTACT, ET C'EST UNE CONTRAINTE DURE (§12.9) : `apply-seed.sh` compare
// `card_contacts` à la taille de son propre tableau — DEUX —, et une garde exige en outre que Léo
// Marchand soit rattaché à EXACTEMENT UNE card active, état que la règle 3 du classement lit
// (`CRM-055`). Le scénario d'écriture rattache donc Élise Fabre — que le seed ne rattache nulle
// part — puis la DÉTACHE par le geste de l'écran. Le détachement n'est pas ici une commodité de
// test : c'est le second geste que la sous-tranche livre, exercé par sa propre preuve. Un filet
// de sécurité en fin de fichier retire le rattachement si un scénario s'est interrompu avant lui.

import {
	connecterAvecLeLabs,
	expect,
	test,
	type Page,
} from './fixtures'
import { CLE_SERVICE, URL_API } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-060'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** `Migration ERP Sogexia` : l'affaire que l'administratrice écrit, avec Léo déjà rattaché. */
const AFFAIRE_ADMIN = {
	adresse: '/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c2',
	titre: 'Migration ERP Sogexia',
}

/**
 * `Refonte intranet Ville de Lyon` : l'affaire que la LECTRICE lit — son track lui est ouvert —
 * et qu'elle ne peut pas écrire. C'est la seule qui exerce les mesures 2, 6 et 12 du §12.4.
 */
const AFFAIRE_LECTRICE = {
	adresse: '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4',
	titre: 'Refonte intranet Ville de Lyon',
}

const ELISE = '5eed0000-0000-4000-8000-000000000093'

async function connecter(page: Page, email: string): Promise<void> {
	await connecterAvecLeLabs(page, email)
}

test.describe("contacts d'une affaire (docs/SPEC-contacts.md §12)", () => {
	test('le bloc rend le rattachement du seed, avec son rôle et sa destination — cas a', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)

		const bloc = page.getByTestId('bloc-contacts-card')
		await expect(bloc).toBeVisible()
		await expect(bloc.getByRole('heading', { name: "Contacts de l’affaire" })).toBeVisible()

		const ligne = page.getByTestId('ligne-contact-card')
		await expect(ligne).toHaveCount(1)
		await expect(ligne).toContainText('Léo Marchand')
		// Le rôle est celui du RATTACHEMENT, tel que la donnée le porte, et il n'est pas traduit.
		await expect(ligne.getByTestId('role-rattachement')).toHaveText('decideur')
		// Le nom de l'organisation mène à sa fiche ; celui du contact ne mène nulle part (§11.8).
		await expect(ligne.getByTestId('lien-organisation-rattachement')).toHaveAttribute(
			'href',
			/\/contacts\/organisations\//,
		)
		await expect(ligne.getByRole('link')).toHaveCount(1)

		// LA CAPTURE DOIT MONTRER CE QUI EST LIVRÉ (`CLAUDE.md` §16). Le bloc est en bas de la
		// colonne gauche (§12.2) et la fenêtre s'ouvre sur l'en-tête : sans ce défilement, la
		// capture représente fidèlement l'application, mais pas la fonctionnalité — défaut trouvé
		// EN REGARDANT la première capture produite, pas en lisant un test.
		await bloc.scrollIntoViewIfNeeded()
		await capturer(page, 'contacts-affaire-1440', UNITE)
	})

	test('le bloc vit ENTRE le formulaire et le geste de corbeille — §12.2', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)
		await expect(page.getByTestId('bloc-contacts-card')).toBeVisible()

		// L'ordre de la colonne gauche est une règle du §5.3, pas une préférence : la colonne
		// droite raconte et n'accueille aucun geste, et le retrait reste en bas.
		const positions = await page.evaluate(() => {
			const y = (selecteur: string) =>
				document.querySelector(selecteur)?.getBoundingClientRect().top ?? Number.NaN
			return {
				formulaire: y('[data-testid="formulaire-card"]'),
				contacts: y('[data-testid="bloc-contacts-card"]'),
				corbeille: y('[data-testid="geste-corbeille-card"]'),
			}
		})
		expect(positions.formulaire).toBeLessThan(positions.contacts)
		expect(positions.contacts).toBeLessThan(positions.corbeille)
	})

	test("l'administratrice rattache Élise PUIS la détache — cas g, m, n, et le seed rendu intact", async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)
		await expect(page.getByTestId('ligne-contact-card')).toHaveCount(1)

		// --- Le rattachement, par le formulaire de l'écran et non par une requête ---------------
		await page.getByTestId('ouvrir-rattachement').click()
		const formulaire = page.getByTestId('formulaire-rattachement')
		await expect(formulaire).toBeVisible()
		// Le sélecteur n'offre PAS Léo, déjà rattaché : rattacher deux fois rendrait `409` (§12.6).
		await expect(formulaire.getByRole('option', { name: /Léo Marchand/ })).toHaveCount(0)
		await formulaire.getByTestId('champ-contact').selectOption(ELISE)
		await formulaire.getByTestId('champ-role').fill('technique')
		await capturer(page, 'contacts-affaire-formulaire-1440', UNITE)
		await formulaire.getByTestId('confirmer-rattachement').click()

		// La liste est RELUE, et le formulaire se referme — cas g.
		await expect(page.getByTestId('ligne-contact-card')).toHaveCount(2)
		await expect(page.getByTestId('formulaire-rattachement')).toHaveCount(0)
		const ligneElise = page.getByTestId('ligne-contact-card').filter({ hasText: 'Élise Fabre' })
		await expect(ligneElise.getByTestId('role-rattachement')).toHaveText('technique')
		// L'ordre vient du serveur : Élise avant Léo (collation mesurée au §12.3).
		await expect(page.getByTestId('ligne-contact-card').first()).toContainText('Élise Fabre')
		await capturer(page, 'contacts-affaire-rattache-1440', UNITE)

		// --- Le détachement, avec sa confirmation nommant le contact — cas m et n ---------------
		await ligneElise.getByTestId('detacher-contact').click()
		const confirmation = page.getByTestId('confirmation-detachement')
		await expect(confirmation).toBeVisible()
		await expect(confirmation).toContainText('Élise Fabre')
		await capturer(page, 'contacts-affaire-confirmation-1440', UNITE)
		await confirmation.getByTestId('confirmer-detachement').click()

		// LE SEED EST RENDU INTACT : une seule ligne, celle de Léo posée par `apply-seed.sh`.
		await expect(page.getByTestId('ligne-contact-card')).toHaveCount(1)
		await expect(page.getByTestId('ligne-contact-card')).toContainText('Léo Marchand')
	})

	test('le rattachement se fait aussi entièrement au CLAVIER — §8', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)
		await expect(page.getByTestId('ligne-contact-card')).toHaveCount(1)

		// La commande est atteinte au clavier, et l'ouverture DÉPLACE le focus dans le premier
		// contrôle (§5.13) : sans ce déplacement, le focus resterait sur un bouton disparu.
		await page.getByTestId('ouvrir-rattachement').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('champ-contact')).toBeFocused()
		await page.getByTestId('champ-contact').selectOption(ELISE)
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('champ-role')).toBeFocused()
		await page.keyboard.type('technique')

		// Annuler rend le focus à la commande qui a ouvert le formulaire.
		await page.getByRole('button', { name: 'Annuler' }).click()
		await expect(page.getByTestId('ouvrir-rattachement')).toBeFocused()
		// Rien n'a été écrit : la liste est inchangée.
		await expect(page.getByTestId('ligne-contact-card')).toHaveCount(1)
	})

	test('la lectrice LIT le bloc ; rattacher et détacher sont ÉTEINTS avec le motif de l’affaire — cas h, o (CRM-093)', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(AFFAIRE_LECTRICE.adresse)

		// Mesure 2 du §12.4 : la lecture des rattachements suit celle de la card.
		const ligne = page.getByTestId('ligne-contact-card')
		await expect(ligne).toHaveCount(1)
		await expect(ligne).toContainText('Sophie Dupont')
		// Un rattachement SANS organisation ne porte aucun lien — cas c.
		await expect(ligne.getByRole('link')).toHaveCount(0)

		// DEPUIS `CRM-093` (docs/SPEC-droits-interface.md §3, §5) : la capacité d'écrire sur l'affaire est rendue par la
		// base sur sa ligne ; les deux commandes refusées restent montées, désactivées, et citent le motif de la fiche.
		// Le refus d'insertion (`403`) et le refus silencieux de suppression (`200`, zéro ligne) restent prouvés hors
		// interface (`e2e/api/contacts-affaire.spec.ts`) et par les preuves unitaires du bloc.
		for (const commande of [page.getByTestId('ouvrir-rattachement'), page.getByTestId('detacher-contact')]) {
			await expect(commande).toBeVisible()
			await expect(commande).toBeDisabled()
			// Pendant la lecture de la capacité, la commande est éteinte SANS motif (§4) : attendre le motif, c'est attendre
			// l'état lu.
			await expect(commande).toHaveAttribute('aria-describedby', /.+/)
			const motif = page.locator(`[id="${await commande.getAttribute('aria-describedby')}"]`)
			await expect(motif).toContainText('Vos droits ne vous permettent pas de la modifier')
		}
		await capturer(page, 'contacts-affaire-refus-1440', UNITE)
		// La ligne n'a pas bougé.
		await expect(page.getByTestId('ligne-contact-card')).toHaveCount(1)
	})

	test("une affaire sans aucun rattachement rend l'état vide, qui GARDE son formulaire — cas d", async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		// `Piste entrante à qualifier` : le seed ne lui rattache aucun contact.
		await page.goto('/tracks/formation/inter-entreprises/cards/5eed0000-0000-4000-8000-0000000000c6')
		await expect(page.getByTestId('contacts-card-vide')).toBeVisible()
		// C'est l'écart avec le §5.16 : ici le geste EXISTE, et il est ce qui comble le vide.
		await expect(page.getByTestId('ouvrir-rattachement')).toBeVisible()
		await page.getByTestId('bloc-contacts-card').scrollIntoViewIfNeeded()
		await capturer(page, 'contacts-affaire-vide-1440', UNITE)
	})

	test('les quatre paliers du §7 ne font jamais défiler la page horizontalement', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(AFFAIRE_ADMIN.adresse)
			await expect(page.getByTestId('bloc-contacts-card')).toBeVisible()
			await page.getByTestId('bloc-contacts-card').scrollIntoViewIfNeeded()
			const deborde = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(deborde, `la page défile horizontalement à ${palier.nom}`).toBe(false)
			await capturer(page, `contacts-affaire-${palier.nom}`, UNITE)
		}
	})
})

/**
 * FILET DE SÉCURITÉ — le seed est une contrainte dure (§12.9).
 *
 * Le scénario d'écriture détache lui-même Élise par le geste de l'écran ; s'il s'interrompt entre
 * les deux, la ligne resterait et `apply-seed.sh` échouerait au prochain rejeu sur son compte de
 * `card_contacts`. Ce nettoyage emploie la clé de service, jamais l'interface : il ne prouve rien
 * et ne prétend rien prouver — il rend l'environnement à l'état que le seed garantit.
 */
test.afterAll(async ({ playwright }) => {
	const contexte = await playwright.request.newContext({ baseURL: URL_API })
	try {
		await contexte.delete(`/rest/v1/card_contacts?contact_id=eq.${ELISE}`, {
			headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` },
		})
	} finally {
		await contexte.dispose()
	}
})
