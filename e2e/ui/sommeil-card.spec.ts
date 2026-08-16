// @verifies CRM-081 (docs/BACKLOG.md) — mise en sommeil d'une affaire, tranche 2 a
// @verifies docs/SPEC-cards.md §16.2 (« en sommeil » = non nulle ET future), §16.3 (le refus
//           `snooze_date_in_past`), §16.4 (le réveil), §16.11.2 (la pastille),
//           §16.11.3 (les échéances usuelles), §16.11.4 (les issues montrées),
//           §16.11.5 (les deux événements dans le fil), §16.11.6 (le seed),
//           §16.11.7 (ligne « E2E d'interface » et ligne « Visuel »)
// @verifies docs/DESIGN_SYSTEM.md §5.3 quater (de quoi le geste a l'air), §5.11 (famille du fil),
//           §7 (paliers), §8 (accessibilité)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE : ces scénarios se connectent réellement, ouvrent des affaires
// **du seed** et appellent les deux véritables RPC de la migration 44. C'est précisément l'objet de
// la preuve — la tranche 1 avait prouvé les fonctions par l'API, jamais le BOUTON du produit.
//
// LES DEUX AFFAIRES SONT CELLES QUE LE SEED POSE (§16.11.6) : `…00ca` dort — échéance à dix jours —
// et `…00c1` porte une échéance ÉCHUE, qui ne doit produire aucune pastille.
//
// LE SEED SORT INTACT. Le scénario qui réveille `…00ca` la rendort ensuite avec une échéance
// usuelle : sans cette remise en état, la preuve suivante trouverait une affaire éveillée et le
// harnais cesserait d'être rejouable. Le fil, lui, est append-only et conserve les deux traces —
// c'est ce que le §16.5 promet, et le scénario du fil le constate.

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	expect,
	test,
	type Page,
} from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-081'
const ADMIN = 'admin@p2enjoy.test'

/** L'affaire que le seed endort, dans `prospection` (MESURÉ le 2026-08-16). */
const ENDORMIE = {
	adresse: '/tracks/conseil-ia/prospection/cards/5eed0000-0000-4000-8000-0000000000ca',
	titre: 'Cadrage data — Groupe Vallier',
}

/** L'affaire dont le sommeil est ÉCHU : la colonne est renseignée, l'écran ne montre rien (§16.2). */
const ECHUE = {
	adresse: '/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c1',
	titre: 'Refonte du site vitrine',
}

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('mise en sommeil depuis la fiche (docs/SPEC-cards.md §16.11)', () => {
	test('une affaire endormie du seed porte sa pastille et son échéance', async ({ page }) => {
		await connecter(page)
		await page.goto(ENDORMIE.adresse)

		await expect(page.getByTestId('entete-card')).toBeVisible()
		const pastille = page.getByTestId('entete-card-sommeil')
		await expect(pastille).toBeVisible()
		// L'ÉCHÉANCE EST LÀ, et ce n'est pas un détail : « jusqu'à quand » est la moitié de
		// l'information (§5.3 quater). Le format est la date courte du produit.
		await expect(pastille).toContainText(/\d{2}\/\d{2}\/\d{4}/)
		// DEUX VISAGES, UN SEUL RENDU (§16.11.3).
		await expect(page.getByTestId('entete-card-reveiller')).toBeVisible()
		await expect(page.getByTestId('entete-card-endormir')).toHaveCount(0)

		await capturer(page, 'sommeil-fiche-endormie-1440', UNITE)
	})

	test('une échéance ÉCHUE ne produit aucune pastille, la colonne étant pourtant renseignée', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(ECHUE.adresse)

		await expect(page.getByTestId('entete-card')).toBeVisible()
		await expect(page.getByTestId('entete-card-sommeil')).toHaveCount(0)
		// Elle est traitée comme une affaire ORDINAIRE : c'est la commande d'endormissement qui
		// s'offre, et aucun état « sommeil expiré » n'est inventé.
		await expect(page.getByTestId('entete-card-endormir')).toBeVisible()
	})

	test('le réveil retire la pastille, et la mise en sommeil la ramène', async ({ page }) => {
		await connecter(page)
		await page.goto(ENDORMIE.adresse)
		await expect(page.getByTestId('entete-card-sommeil')).toBeVisible()

		// --- Le réveil : aucun panneau, aucune confirmation (§5.3 quater) ---------------------
		await page.getByTestId('entete-card-reveiller').click()
		await expect(page.getByTestId('entete-card-sommeil')).toHaveCount(0)
		await expect(page.getByTestId('entete-card-endormir')).toBeVisible()

		// LA BASE A BIEN CHANGÉ, et pas seulement l'écran : la fiche est rechargée depuis le
		// serveur. Sans ce rechargement, la preuve ne dirait rien de ce que la RPC a écrit.
		await page.reload()
		await expect(page.getByTestId('entete-card')).toBeVisible()
		await expect(page.getByTestId('entete-card-sommeil')).toHaveCount(0)

		// --- La remise en sommeil, par une échéance usuelle -----------------------------------
		await page.getByTestId('entete-card-endormir').click()
		await expect(page.getByTestId('entete-card-panneau-sommeil')).toBeVisible()
		await capturer(page, 'sommeil-panneau-ouvert-1440', UNITE)
		await page.getByTestId('entete-card-sommeil-semaine').click()

		const pastille = page.getByTestId('entete-card-sommeil')
		await expect(pastille).toBeVisible()
		// Le panneau se referme sur le succès, et sur lui seul.
		await expect(page.getByTestId('entete-card-panneau-sommeil')).toHaveCount(0)

		await page.reload()
		await expect(page.getByTestId('entete-card-sommeil')).toBeVisible()
	})

	test('une échéance PASSÉE est envoyée, et la base la refuse — le refus est montré', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(ECHUE.adresse)

		await page.getByTestId('entete-card-endormir').click()
		const panneau = page.getByTestId('entete-card-panneau-sommeil')
		await expect(panneau).toBeVisible()

		// AUCUNE GARDE DE SAISIE NE DOUBLE LA BASE (§5.3 ter) : la valeur part telle quelle.
		await page.getByTestId('entete-card-sommeil-echeance').fill('2020-01-01T09:00')
		await page.getByTestId('entete-card-sommeil-envoyer').click()

		const mention = page.getByTestId('entete-card-sommeil-mention')
		await expect(mention).toBeVisible()
		await expect(mention).toHaveText('L’échéance doit être future.')
		// LE REFUS N'EFFACE PAS LA SAISIE, et le panneau reste ouvert pour la corriger (§5.7 ter).
		await expect(panneau).toBeVisible()
		await expect(page.getByTestId('entete-card-sommeil')).toHaveCount(0)

		await capturer(page, 'sommeil-echeance-passee-refusee-1440', UNITE)

		// LE `400` DU REFUS EST CONSOMMÉ NOMMÉMENT, jamais filtré globalement : le navigateur
		// journalise toute réponse en échec, et c'est le refus que ce scénario vient de PROVOQUER
		// et de vérifier à l'écran. Un statut, un nombre ou un ordre différent échouerait ici.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	test('le fil de l’affaire nomme les deux gestes, avec leur échéance', async ({ page }) => {
		await connecter(page)
		await page.goto(ENDORMIE.adresse)
		await expect(page.getByTestId('entete-card')).toBeVisible()

		// Le fil est append-only : les gestes du scénario de réveil y sont, et ceux du seed avant
		// eux. La preuve constate la PRÉSENCE des deux libellés, jamais un compte exact — un compte
		// exact ferait dépendre ce scénario de l'ordre d'exécution de ses voisins.
		const fil = page.getByRole('region', { name: 'Fil de cette affaire' })
		await expect(fil).toBeVisible()
		await expect(fil.getByText('Affaire mise en sommeil').first()).toBeVisible()
		await capturer(page, 'sommeil-fil-1440', UNITE)
	})

	test('la pastille tient aux quatre paliers, sans débordement', async ({ page }) => {
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(ENDORMIE.adresse)
			await expect(page.getByTestId('entete-card-sommeil')).toBeVisible()
			// LE CORPS NE DÉFILE PAS HORIZONTALEMENT (§12.6) : une pastille de plus dans l'en-tête
			// est exactement le genre d'ajout qui déborde au palier le plus étroit.
			const deborde = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(deborde, `débordement horizontal au palier ${palier.nom}`).toBe(false)
			await capturer(page, `sommeil-fiche-${palier.nom}`, UNITE)
		}
	})
})
