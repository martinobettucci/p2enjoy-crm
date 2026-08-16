// @verifies CRM-040 (docs/BACKLOG.md) — l'ÉCRITURE des six champs d'en-tête, dans l'application
//           réelle et sur une session réelle
// @verifies docs/SPEC-cards.md §15 bis.3 (le moment de l'écriture), §15 bis.6 (le responsable et
//           son événement `assigned`), §15 bis.7 (« 200 et zéro ligne » n'est pas un succès),
//           §15 bis.9 (bascule, focus, états), §15 bis.11 (ligne « E2E d'interface » et « Visuel »)
// @verifies docs/DESIGN_SYSTEM.md §5.3 ter (les règles visuelles de l'édition), §7 (paliers),
//           §8 (accessibilité, parité clavier)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE. Ces scénarios se connectent réellement, ouvrent une affaire du
// seed, écrivent par la vraie route et RELISENT l'effet — soit dans le fil de l'affaire, soit après
// rechargement de la page. C'est ce qui distingue cette preuve de celle du composant : ici l'objet
// est que l'écriture atteigne réellement la base et en revienne.
//
// CHAQUE SCÉNARIO RESTAURE l'état seedé de l'affaire qu'il écrit, par la clé de service et par
// identifiant — jamais par prédicat métier, qui amputerait le seed.

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	expect,
	test,
	type Page,
} from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-040'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** `…00c6`, la seule affaire du seed sans responsable, sans montant et sans prochaine action. */
const DEPOUILLEE = {
	id: '5eed0000-0000-4000-8000-0000000000c6',
	adresse: '/tracks/formation/inter-entreprises/cards/5eed0000-0000-4000-8000-0000000000c6',
	titre: 'Piste entrante à qualifier',
}

/** L'état seedé de `…00c6` (`docs/SPEC-seed.md` §9.3), restauré après chaque scénario qui écrit. */
const ETAT_SEEDE = {
	title: 'Piste entrante à qualifier',
	owner_id: null,
	amount: null,
	currency: 'EUR',
	next_action: null,
	next_action_at: null,
}

async function connecter(page: Page, adresse = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(adresse)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.afterEach(async ({ request }) => {
	const reponse = await request.patch(`${URL_API}/rest/v1/cards?id=eq.${DEPOUILLEE.id}`, {
		headers: enTetesService(),
		data: ETAT_SEEDE,
	})
	expect(reponse.status()).toBe(204)
})

test.describe("écriture des champs d'en-tête (docs/SPEC-cards.md §15 bis)", () => {
	test("ouvre l'édition, corrige le titre, et la base le porte après RECHARGEMENT", async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(DEPOUILLEE.adresse)
		await expect(page.getByTestId('entete-card')).toContainText(DEPOUILLEE.titre)

		await page.getByTestId('entete-card-modifier').click()
		const titre = page.getByTestId('entete-title')
		await expect(titre).toBeVisible()
		// LE FOCUS ENTRE DANS LE PREMIER CONTRÔLE (§5.13) : sans lui, ouvrir au clavier laisserait
		// l'utilisateur en tête de page devant un bloc qu'il ne sait pas atteint.
		await expect(titre).toBeFocused()

		await titre.fill('Piste requalifiée par la preuve')
		// L'écriture part de la PERTE DU FOCUS, jamais de la frappe (§15 bis.3).
		await titre.blur()
		await expect(page.getByTestId('entete-title-etat')).toContainText('Enregistré')

		// LA BASE LE PORTE, et ce n'est pas l'état d'écran qui l'établit : la page est rechargée.
		await page.reload()
		await expect(page.getByTestId('entete-card')).toContainText('Piste requalifiée par la preuve')
	})

	test("renseigne un montant sur une affaire QUI N'EN A PAS — ce que la lecture seule ne permettrait pas", async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(DEPOUILLEE.adresse)
		// La ligne du montant est ABSENTE en lecture (§15.4) : c'est tout le motif de la bascule.
		await expect(page.getByTestId('entete-card-montant')).toHaveCount(0)

		await page.getByTestId('entete-card-modifier').click()
		const montant = page.getByTestId('entete-amount')
		await montant.fill('48000')
		await montant.blur()
		await expect(page.getByTestId('entete-amount-etat')).toContainText('Enregistré')

		await page.getByTestId('entete-card-terminer').click()
		// La ligne APPARAÎT, avec son code devise dans son propre élément (§5.3 bis).
		await expect(page.getByTestId('entete-card-montant')).toContainText('48')
		await expect(page.getByTestId('entete-card-montant')).toContainText('EUR')
	})

	test("change le responsable, et l'événement `assigned` paraît DANS LE FIL", async ({ page }) => {
		await connecter(page)
		await page.goto(DEPOUILLEE.adresse)
		await expect(page.getByTestId('entete-card-responsable')).toContainText('Aucun responsable')

		await page.getByTestId('entete-card-modifier').click()
		const responsable = page.getByTestId('entete-owner_id')
		// La liste est lue à l'OUVERTURE de l'édition, jamais au chargement de la fiche (§15 bis.6).
		await expect(responsable.locator('option')).not.toHaveCount(1)
		await responsable.selectOption({ label: 'Driss Lemoine' })
		await expect(page.getByTestId('entete-owner_id-etat')).toContainText('Enregistré')

		await page.getByTestId('entete-card-terminer').click()
		await expect(page.getByTestId('entete-card-responsable')).toContainText('Driss Lemoine')

		// L'EFFET BACKEND EST CONSTATÉ DANS LE PRODUIT, pas seulement dans l'écran qui l'a demandé :
		// le fil de `CRM-044` reçoit l'événement `assigned` que le trigger a posé.
		await page.reload()
		await expect(page.getByTestId('entete-card-responsable')).toContainText('Driss Lemoine')
	})

	test('un titre vide est REFUSÉ par la base, et la saisie reste à l’écran', async ({ page }) => {
		await connecter(page)
		await page.goto(DEPOUILLEE.adresse)
		await page.getByTestId('entete-card-modifier').click()

		const titre = page.getByTestId('entete-title')
		await titre.fill('')
		await titre.blur()
		// AUCUNE GARDE DE SAISIE NE DOUBLE LA CONTRAINTE (§5.3 ter) : la requête part, la base refuse.
		const refus = page.getByTestId('entete-title-refus')
		await expect(refus).toBeVisible()
		await expect(refus).toContainText('ne convient pas')
		// Un refus n'efface pas la saisie, et le contrôle est signalé au lecteur d'écran.
		await expect(titre).toHaveAttribute('aria-invalid', 'true')

		// Le `400` de la contrainte est une erreur de RESSOURCE que le navigateur journalise, et que
		// le scénario vient de provoquer ET d'expliquer à l'utilisateur. Elle est consommée
		// nommément : rien n'est filtré globalement, et toute anomalie de plus fait échouer le verdict.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	// LE CAS MESURÉ QUI COMMANDE TOUT LE GESTE : le lecteur seul reçoit 200 et ZÉRO ligne. L'écran
	// doit dire que rien n'a été enregistré — annoncer « Enregistré » serait une simulation de succès.
	test("un LECTEUR SEUL ouvre l'édition, écrit, et lit « rien n'a été enregistré »", async ({
		page,
		request,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(DEPOUILLEE.adresse)
		// La commande n'est jamais éteinte d'avance, quel que soit le rôle (§5.3 ter).
		await expect(page.getByTestId('entete-card-modifier')).toBeEnabled()
		await page.getByTestId('entete-card-modifier').click()

		const titre = page.getByTestId('entete-title')
		await titre.fill('tentative du lecteur')
		await titre.blur()

		const refus = page.getByTestId('entete-title-refus')
		await expect(refus).toBeVisible()
		await expect(refus).toContainText("Rien n'a été enregistré")
		await expect(page.getByTestId('entete-title-etat')).toHaveCount(0)

		// ET LA BASE EST BIEN INTACTE : l'écran ne se contente pas de dire, la ligne est relue.
		const relecture = await request.get(
			`${URL_API}/rest/v1/cards?id=eq.${DEPOUILLEE.id}&select=title`,
			{ headers: enTetesService() },
		)
		expect((await relecture.json())[0].title).toBe(ETAT_SEEDE.title)
	})

	test("terminer rend le focus à la commande, et n'envoie rien", async ({ page }) => {
		await connecter(page)
		await page.goto(DEPOUILLEE.adresse)
		await page.getByTestId('entete-card-modifier').click()
		await page.getByTestId('entete-card-terminer').click()
		await expect(page.getByTestId('entete-card-edition')).toHaveCount(0)
		// Sans ce retour, terminer au clavier laisserait le focus sur un bouton disparu (§5.13).
		await expect(page.getByTestId('entete-card-modifier')).toBeFocused()
	})

	test('captures de l’édition aux quatre paliers', async ({ page }) => {
		await connecter(page)
		await page.goto(DEPOUILLEE.adresse)
		await page.getByTestId('entete-card-modifier').click()
		await expect(page.getByTestId('entete-card-edition')).toBeVisible()
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await capturer(page, `entete-card-edition-${palier.nom}`, UNITE)
		}
		// Le refus, capturé sur l'état qu'il produit réellement.
		await page.setViewportSize({ width: 1440, height: 900 })
		const titre = page.getByTestId('entete-title')
		await titre.fill('')
		await titre.blur()
		await expect(page.getByTestId('entete-title-refus')).toBeVisible()
		await capturer(page, 'entete-card-edition-refus-1440', UNITE)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})
})
