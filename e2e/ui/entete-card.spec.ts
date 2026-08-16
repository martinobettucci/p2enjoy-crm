// @verifies CRM-040 (docs/BACKLOG.md) — les champs d'en-tête de la fiche d'affaire, dans
//           l'application réelle et sur une session réelle
// @verifies docs/SPEC-cards.md §15.2 (l'en-tête est au-dessus du formulaire), §15.4 (les six
//           données et leurs absences), §15.5 (l'action de copie), §15.7 (les trois états),
//           §15.10 (ligne « E2E d'interface » et ligne « Visuel »)
// @verifies docs/DESIGN_SYSTEM.md §5.3 (les champs d'entête, l'adresse en monospace),
//           §5.3 bis (les neuf règles visuelles), §7 (paliers), §8 (accessibilité)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE. Ces scénarios se connectent réellement — l'écran de connexion de
// `CRM-009` —, ouvrent trois affaires **du seed** et lisent ce que le backend consent. C'est ce qui
// distingue cette preuve de celle de `e2e/ui/formulaire.spec.ts`, qui substitue le réseau pour
// isoler des états rares : ici l'objet de la preuve est précisément que les données réelles
// atteignent l'écran.
//
// LES TROIS AFFAIRES SONT CHOISIES POUR CE QU'ELLES PORTENT, et les faits sont MESURÉS en base :
// `…00c2` porte responsable, montant, prochaine action et échéance ; `…00c6` n'a ni responsable, ni
// montant, ni prochaine action ; `…00c8` est archivée.
//
// AUCUNE ÉCRITURE : l'en-tête est en lecture, et le seed sort intact.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-040'
const ADMIN = 'admin@p2enjoy.test'

/** Les trois affaires du seed, avec l'adresse réelle de leur channel (MESURÉ le 2026-08-16). */
const COMPLETE = {
	adresse:
		'/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c2',
	titre: 'Migration ERP Sogexia',
	responsable: 'Driss Lemoine',
	prochaineAction: 'Obtenir le cadrage technique',
}
const DEPOUILLEE = {
	adresse:
		'/tracks/formation/inter-entreprises/cards/5eed0000-0000-4000-8000-0000000000c6',
	titre: 'Piste entrante à qualifier',
}
const ARCHIVEE = {
	adresse:
		'/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c8',
	titre: 'Contrat cadre 2025',
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

test.describe("en-tête de la fiche d'affaire (docs/SPEC-cards.md §15)", () => {
	test("montre les six données d'une affaire complète, sur données réelles", async ({ page }) => {
		await connecter(page)
		await page.goto(COMPLETE.adresse)

		const entete = page.getByTestId('entete-card')
		await expect(entete).toBeVisible()
		// Le titre est le nom accessible de la section, en niveau 2 (§15.6).
		await expect(
			entete.getByRole('heading', { level: 2, name: COMPLETE.titre }),
		).toBeVisible()
		await expect(page.getByTestId('entete-card-responsable')).toContainText(COMPLETE.responsable)
		// Le montant vient de la base, pas d'une constante de test : la valeur exacte est vérifiée
		// par sa forme — chiffres groupés et deux décimales — plutôt que recopiée.
		await expect(page.getByTestId('entete-card-montant')).toContainText('EUR')
		await expect(page.getByTestId('entete-card-montant')).toContainText(/125\s?000,00/u)
		await expect(page.getByTestId('entete-card-prochaine-action')).toContainText(
			COMPLETE.prochaineAction,
		)
		await expect(page.getByTestId('entete-card-echeance')).toBeVisible()
		// L'adresse est composée à l'écran : la partie locale vient de `cards`, le domaine de
		// `workspaces`, et aucune colonne ne la porte (docs/SPEC-cards.md §3.5).
		await expect(page.getByTestId('entete-card-adresse')).toContainText('@crm.p2enjoy.test')
		await expect(page.getByTestId('entete-card-adresse')).toContainText(/^c-[0-9a-z]{8}@/u)
	})

	// L'EN-TÊTE EST AU-DESSUS DU FORMULAIRE (§15.2), et l'ordre est constaté dans le DOM et non
	// supposé : la position est ce que la spécification décide, et une inversion serait invisible
	// à toute assertion portant sur la seule présence.
	test('est rendu au-dessus du formulaire et au-dessus du geste de retrait', async ({ page }) => {
		await connecter(page)
		await page.goto(COMPLETE.adresse)
		await expect(page.getByTestId('entete-card')).toBeVisible()
		const ordre = await page.evaluate(() => {
			const dans = (cle: string) => document.querySelector(`[data-testid="${cle}"]`)
			const entete = dans('entete-card')
			const formulaire = dans('formulaire-card')
			const corbeille = dans('geste-corbeille-card')
			if (entete === null || formulaire === null || corbeille === null) return null
			return {
				avantFormulaire: Boolean(
					entete.compareDocumentPosition(formulaire) & Node.DOCUMENT_POSITION_FOLLOWING,
				),
				avantCorbeille: Boolean(
					entete.compareDocumentPosition(corbeille) & Node.DOCUMENT_POSITION_FOLLOWING,
				),
			}
		})
		expect(ordre, 'les trois blocs de la colonne gauche doivent être rendus').not.toBeNull()
		expect(ordre?.avantFormulaire).toBe(true)
		expect(ordre?.avantCorbeille).toBe(true)
	})

	test("nomme l'absence de responsable et omet les lignes sans donnée", async ({ page }) => {
		await connecter(page)
		await page.goto(DEPOUILLEE.adresse)

		await expect(page.getByTestId('entete-card')).toContainText(DEPOUILLEE.titre)
		// La seule absence qui soit une PHRASE (§5.3 bis).
		await expect(page.getByTestId('entete-card-responsable')).toContainText('Aucun responsable')
		// Les autres disparaissent entièrement : ni tiret, ni « non renseigné ».
		await expect(page.getByTestId('entete-card-montant')).toHaveCount(0)
		await expect(page.getByTestId('entete-card-prochaine-action')).toHaveCount(0)
		await expect(page.getByTestId('entete-card')).not.toContainText('—')
	})

	test("nomme l'affaire archivée, qui reste consultable", async ({ page }) => {
		await connecter(page)
		await page.goto(ARCHIVEE.adresse)
		await expect(page.getByTestId('entete-card')).toContainText(ARCHIVEE.titre)
		// Le mot porte l'information, jamais la seule teinte (docs/DESIGN_SYSTEM.md §1).
		await expect(page.getByTestId('entete-card-archivee')).toContainText('Archivé')
	})

	// LE GESTE RÉEL, sur Chromium et non en jsdom : c'est ici, et seulement ici, que
	// `navigator.clipboard` est réellement appelé. Le presse-papiers est relu — sans quoi la preuve
	// ne regarderait que le libellé du bouton.
	test("copie réellement l'adresse dans le presse-papiers, et le confirme", async ({
		page,
		context,
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])
		await connecter(page)
		await page.goto(COMPLETE.adresse)

		const adresse = (await page.getByTestId('entete-card-adresse').textContent())?.trim() ?? ''
		expect(adresse).toMatch(/^c-[0-9a-z]{8}@crm\.p2enjoy\.test$/u)

		const commande = page.getByRole('button', { name: "Copier l'adresse email de l'affaire" })
		// La cible tient les 40 px du §8, mesurée sur le rendu réel et non déclarée.
		const boite = await commande.boundingBox()
		expect(boite?.height ?? 0).toBeGreaterThanOrEqual(40)

		await commande.click()
		await expect(commande).toContainText('Copié')
		const presse = await page.evaluate(() => navigator.clipboard.readText())
		expect(presse).toBe(adresse)

		// La confirmation s'efface, et le libellé revient : elle REMPLACE, elle ne reste pas.
		await expect(commande).toContainText("Copier l'adresse", { timeout: 5000 })
	})

	test("l'explication d'usage est un texte lisible, pas seulement une infobulle", async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(COMPLETE.adresse)
		await expect(page.getByTestId('entete-card')).toContainText(
			'Mettez cette adresse en copie',
		)
	})

	test('captures aux quatre paliers', async ({ page }) => {
		await connecter(page)
		await page.goto(COMPLETE.adresse)
		await expect(page.getByTestId('entete-card')).toBeVisible()
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await capturer(page, `entete-card-${palier.nom}`, UNITE)
		}
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(ARCHIVEE.adresse)
		await expect(page.getByTestId('entete-card-archivee')).toBeVisible()
		await capturer(page, 'entete-card-archivee-1440', UNITE)
		await page.goto(DEPOUILLEE.adresse)
		await expect(page.getByTestId('entete-card-responsable')).toContainText('Aucun responsable')
		await capturer(page, 'entete-card-sans-responsable-1440', UNITE)
	})
})
