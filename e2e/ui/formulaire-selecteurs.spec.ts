// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4d
// @verifies docs/SPEC-contacts.md §13.1 (ce que la sous-tranche livre), §13.3 (les deux lectures),
//           §13.5 (cas a à d et f, éprouvés sur la pile réelle), §13.6 (le seed enrichi),
//           §13.7 (les autorisations, que l'écran ne calcule pas)
// @verifies docs/SPEC-form-composer.md §4 bis.3 (le moment de l'écriture), §4 bis.6 (les états),
//           §4 bis.7 (dictionnaire fermé des refus)
// @verifies docs/DESIGN_SYSTEM.md §5.22 (les deux sélecteurs), §7 (paliers) ; CLAUDE.md §16
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, et l'écriture passe par le sélecteur de l'écran.
//
// LE SEED EST RENDU INTACT, ET C'EST UNE CONTRAINTE (§13.9). Le seed pose `contact-principal` à
// Léo Marchand sur « Migration ERP Sogexia » ; le scénario d'écriture retient Élise Fabre, constate
// l'enregistrement, puis RÉTABLIT Léo par le même geste — le rétablissement n'est pas une commodité
// de test, c'est le même contrôle exercé une seconde fois. Un filet de sécurité en fin de fichier
// remet la valeur seedée si un scénario s'est interrompu entre les deux.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { CLE_SERVICE, MOT_DE_PASSE_SEED, URL_API } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-060'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** `Migration ERP Sogexia` : la seule affaire dont le seed renseigne les deux champs (§13.6). */
const AFFAIRE_ADMIN = {
	adresse: '/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c2',
	titre: 'Migration ERP Sogexia',
}

/** L'affaire que la LECTRICE lit — son track lui est ouvert — et qu'elle ne peut pas écrire. */
const AFFAIRE_LECTRICE = {
	adresse: '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4',
	titre: 'Refonte intranet Ville de Lyon',
}

const CARD_ADMIN = '5eed0000-0000-4000-8000-0000000000c2'
const CHAMP_CONTACT = '5eed0000-0000-4000-8000-000000000088'
const CONTACT_LEO = '5eed0000-0000-4000-8000-000000000091'
const CONTACT_ELISE = '5eed0000-0000-4000-8000-000000000093'
const MEMBRE_DRISS = '5eed0000-0000-4000-8000-000000000012'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/**
 * Attend que le sélecteur ait REÇU sa liste.
 *
 * `aria-busy` est le signal du cas g, et c'est la seule condition d'attente honnête : tant qu'il
 * est posé, le contrôle n'offre rien à choisir. Attendre une option nommée reviendrait à supposer
 * l'issue de la lecture.
 */
async function selecteurPret(page: Page, cle: string) {
	const selecteur = page.getByTestId(`selecteur-${cle}`)
	await expect(selecteur).toBeVisible()
	await expect(selecteur).not.toHaveAttribute('aria-busy', 'true')
	return selecteur
}

test.describe('sélecteurs de contact et de membre (docs/SPEC-contacts.md §13)', () => {
	test('les deux champs seedés rendent des NOMS, pas des identifiants — cas b', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)

		const contact = await selecteurPret(page, 'contact-principal')
		// LA VALEUR EST UN IDENTIFIANT, LE LIBELLÉ EST UN NOM : c'est tout l'objet de la
		// sous-tranche. L'organisation distingue deux homonymes (§13.3).
		await expect(contact).toHaveValue(CONTACT_LEO)
		await expect(contact.locator('option:checked')).toHaveText('Léo Marchand — Sogexia')

		const membre = await selecteurPret(page, 'referent-technique')
		await expect(membre).toHaveValue(MEMBRE_DRISS)
		await expect(membre.locator('option:checked')).toHaveText('Driss Lemoine')

		await page.getByTestId('formulaire-card').scrollIntoViewIfNeeded()
		await capturer(page, 'formulaire-selecteurs-1440', UNITE)
	})

	test('les listes offrent les contacts et les membres du workspace, et une option vide', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)

		const contact = await selecteurPret(page, 'contact-principal')
		// Trois contacts seedés, plus l'option vide du §4 bis.5 : elle est le moyen de VIDER.
		await expect(contact.locator('option')).toHaveCount(4)
		await expect(contact.locator('option', { hasText: '— Aucun choix —' })).toHaveCount(1)
		await expect(contact.locator('option', { hasText: 'Sophie Dupont' })).toHaveCount(1)

		const membre = await selecteurPret(page, 'referent-technique')
		await expect(membre.locator('option')).toHaveCount(4)
		await expect(membre.locator('option', { hasText: 'Camille Aubert' })).toHaveCount(1)
		await expect(membre.locator('option', { hasText: 'Farida Nowak' })).toHaveCount(1)

		await page.getByTestId('champ-contact-principal').scrollIntoViewIfNeeded()
		await capturer(page, 'formulaire-selecteurs-liste-1440', UNITE)
	})

	test('retenir un autre contact ENREGISTRE, et le choix survit au rechargement — cas c', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)

		const contact = await selecteurPret(page, 'contact-principal')
		await contact.selectOption(CONTACT_ELISE)
		// La mention d'état vit SOUS le champ (§5.7 ter), et la confirmation REMPLACE l'envoi.
		await expect(page.getByTestId('etat-contact-principal')).toHaveText('Enregistré')
		await page.getByTestId('champ-contact-principal').scrollIntoViewIfNeeded()
		await capturer(page, 'formulaire-selecteurs-enregistre-1440', UNITE)

		// LA BASE A RAISON, PAS L'ÉCRAN : le rechargement relit ce que le serveur porte.
		await page.reload()
		const relu = await selecteurPret(page, 'contact-principal')
		await expect(relu).toHaveValue(CONTACT_ELISE)
		await expect(relu.locator('option:checked')).toHaveText('Élise Fabre — Studio Meunier')

		// LE SEED EST RÉTABLI PAR LE MÊME GESTE, et non par une requête de service.
		await relu.selectOption(CONTACT_LEO)
		await expect(page.getByTestId('etat-contact-principal')).toHaveText('Enregistré')
		await page.reload()
		await expect(await selecteurPret(page, 'contact-principal')).toHaveValue(CONTACT_LEO)
	})

	test('le parcours tient au CLAVIER, sans souris — §8', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)

		const membre = await selecteurPret(page, 'referent-technique')
		await membre.focus()
		await expect(membre).toBeFocused()
		// `selectOption` au clavier : la valeur est arrêtée par la plateforme, l'écriture part au
		// changement (§4 bis.3). Le contrôle GARDE le focus — un contrôle désactivé le perdrait,
		// ce que le §5.7 ter interdit pendant l'envoi.
		await membre.selectOption('5eed0000-0000-4000-8000-000000000011')
		await expect(page.getByTestId('etat-referent-technique')).toHaveText('Enregistré')
		await expect(membre).toBeFocused()

		await membre.selectOption(MEMBRE_DRISS)
		await expect(page.getByTestId('etat-referent-technique')).toHaveText('Enregistré')
	})

	test('la LECTRICE voit les deux sélecteurs et reçoit le refus TRADUIT — cas f', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(AFFAIRE_LECTRICE.adresse)

		// AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE (§13.7) : la règle vit dans la politique RLS, et
		// une liste grisée ferait passer une décision de la base pour une décision d'écran.
		const contact = await selecteurPret(page, 'contact-principal')
		await expect(contact).toBeEnabled()
		await contact.selectOption(CONTACT_ELISE)

		const refus = page.getByTestId('refus-contact-principal')
		await expect(refus).toBeVisible()
		await expect(refus).toContainText("Vous n'avez pas le droit d'écrire sur ce channel")
		// La saisie n'est PAS effacée par le refus (§5.7 ter).
		await expect(contact).toHaveValue(CONTACT_ELISE)
		// Le `403` traverse la console : il est consommé nommément, parce que le scénario vient de
		// le provoquer ET de vérifier que l'écran l'explique (décision 248).
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])

		await page.getByTestId('champ-contact-principal').scrollIntoViewIfNeeded()
		await capturer(page, 'formulaire-selecteurs-refus-1440', UNITE)
	})

	test('les quatre paliers rendent les sélecteurs sans débordement horizontal — §7', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(AFFAIRE_ADMIN.adresse)
		await selecteurPret(page, 'contact-principal')

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.getByTestId('champ-contact-principal').scrollIntoViewIfNeeded()
			await expect(page.getByTestId('selecteur-contact-principal')).toBeVisible()
			const deborde = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(deborde, `la page défile horizontalement à ${palier.nom}`).toBe(false)
			await capturer(page, `formulaire-selecteurs-${palier.nom}`, UNITE)
		}
	})
})

/**
 * FILET DE SÉCURITÉ — le seed est un contrat maintenu (§13.9).
 *
 * Le scénario d'écriture rétablit lui-même la valeur seedée par le geste de l'écran ; s'il
 * s'interrompt entre les deux, `contact-principal` désignerait Élise et la campagne suivante
 * mesurerait un seed dérivé. Ce rétablissement emploie la clé de service, jamais l'interface : il
 * ne prouve rien et ne prétend rien prouver.
 */
test.afterAll(async ({ playwright }) => {
	const contexte = await playwright.request.newContext({ baseURL: URL_API })
	try {
		await contexte.patch(
			`/rest/v1/card_field_values?card_id=eq.${CARD_ADMIN}&field_id=eq.${CHAMP_CONTACT}`,
			{
				headers: {
					apikey: CLE_SERVICE,
					Authorization: `Bearer ${CLE_SERVICE}`,
					'Content-Type': 'application/json',
				},
				data: { value: CONTACT_LEO },
			},
		)
	} finally {
		await contexte.dispose()
	}
})
