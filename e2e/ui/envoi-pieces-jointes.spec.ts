// @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : copie cachée et pièces jointes dans le formulaire d'envoi, parcours
//           d'écran complet
// @verifies docs/SPEC-mail-subsystem.md §19 bis.2, §19 bis.5, §19 bis.7 (ligne « E2E ui ») ; docs/DESIGN_SYSTEM.md
//           §5.4 sexies, §7 (paliers), §10 (clavier) ; docs/JOURNAL.md décisions 719 et 720 ; CLAUDE.md §16
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LE VRAI ÉCRAN SUR LA VRAIE PILE : le fichier choisi est déposé par l'API de stockage avec la session de Camille, puis
// la mise en file passe par la vraie garde. Rien n'est envoyé — le worker n'est pas déclenché ici ; l'aller réel est
// prouvé par `e2e/mail/envoi-pieces-jointes.spec.ts`. Chaque scénario retire ses lignes de file et ses dépôts.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-058'
const ADMIN = 'admin@p2enjoy.test'
const CARD = '5eed0000-0000-4000-8000-0000000000c1'
const ADRESSE_CARD = `/tracks/conseil-ia/grands-comptes/cards/${CARD}`
const PREFIXE = '5eed0000-0000-4000-8000-000000000001/5eed0000-0000-4000-8000-000000000011/'

const fichier = (nom: string, octets: number, mimeType = 'text/plain') => ({
	name: nom,
	mimeType,
	buffer: Buffer.alloc(octets, 65),
})

/**
 * Les dépôts de Camille dans le bucket des pièces à envoyer, vus par la clé de service — bornés aux NOMS du scénario :
 * le seed laisse dans le même dossier le fichier de son envoi de démonstration (docs/SPEC-seed.md §2.19 ter), que la
 * purge effacera au bout de 24 heures, et un compte sans borne le compterait.
 */
async function depots(page: Page, noms?: readonly string[]): Promise<string[]> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/rpc/depots_envoi_abandonnes?p_age=${encodeURIComponent('-1 minute')}`,
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as { name: string }[])
		.map((ligne) => ligne.name)
		.filter((nom) => nom.startsWith(PREFIXE))
		.filter((nom) => noms === undefined || noms.includes(nom.split('/').at(-1) ?? ''))
}

async function nettoyer(page: Page, objet: string): Promise<void> {
	await page.request.delete(`${URL_API}/rest/v1/mail_outbox?subject=eq.${encodeURIComponent(objet)}`, {
		headers: enTetesService(),
	})
	const restes = (await depots(page)).filter((nom) => !nom.endsWith('/proposition-monitoring.txt'))
	if (restes.length > 0) {
		await page.request.delete(`${URL_API}/storage/v1/object/mail-outbound-attachments`, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { prefixes: restes },
		})
	}
}

async function ouvrirFormulaire(page: Page): Promise<void> {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(ADRESSE_CARD)
	await page.getByTestId('envoi-ouvrir').click()
	await expect(page.getByTestId('envoi-formulaire')).toBeVisible()
}

test.describe('copie cachée et pièces jointes (docs/SPEC-mail-subsystem.md §19 bis)', () => {
	test('joindre, retirer, ajouter une Cci, puis mettre en file — à la souris', async ({ page }) => {
		const objet = `Pieces ${Date.now()}`
		await ouvrirFormulaire(page)
		try {
			await page.getByLabel('Destinataires').fill('client@exterieur.test')
			await page.getByLabel('Objet').fill(objet)
			await page.getByLabel('Message').fill('Bonjour,\n\nVous trouverez notre proposition jointe.')

			await page.getByRole('button', { name: 'Ajouter Cci' }).click()
			await expect(page.getByLabel('Copie cachée (Cci)')).toBeFocused()
			await page.getByLabel('Copie cachée (Cci)').fill('direction@exterieur.test')

			await page.getByTestId('envoi-fichiers').setInputFiles([
				fichier('Proposition révisée.txt', 2048),
				fichier('brouillon.txt', 100),
			])
			const lignes = page.getByTestId('envoi-piece')
			await expect(lignes).toHaveCount(2)
			await expect(page.locator('[data-testid="envoi-piece"][data-etat="pret"]')).toHaveCount(2)
			await expect(page.getByTestId('envoi-pieces-total')).toHaveText('2 fichiers, 2,1 Ko sur 10 Mo')
			const NOMS = ['Proposition revisee.txt', 'brouillon.txt']
			await expect.poll(() => depots(page, NOMS).then((liste) => liste.length)).toBe(2)
			// LA CAPTURE MONTRE CE QU'ELLE PROUVE : la liste des fichiers et leur total, que la première version laissait
			// sous le pli (défaut vu à l'œil).
			await page.getByTestId('envoi-pieces-total').scrollIntoViewIfNeeded()
			await capturer(page, 'envoi-pieces-cci-1440', UNITE)

			// RETIRER UN FICHIER RETIRE SON DÉPÔT.
			await page.getByRole('button', { name: 'Retirer brouillon.txt' }).click()
			await expect(lignes).toHaveCount(1)
			await expect.poll(() => depots(page, NOMS).then((liste) => liste.length)).toBe(1)

			await page.getByTestId('envoi-valider').click()
			await expect(page.getByTestId('envoi-confirmation')).toBeVisible()

			// L'EFFET BACKEND : la Cci et la pièce — son nom translittéré, sa taille relue dans le stockage.
			const ligne = await page.request.get(
				`${URL_API}/rest/v1/mail_outbox?select=bcc_addrs,attachments&subject=eq.${encodeURIComponent(objet)}`,
				{ headers: enTetesService() },
			)
			const [envoi] = (await ligne.json()) as {
				bcc_addrs: string[]
				attachments: { filename: string; size_bytes: number }[]
			}[]
			expect(envoi?.bcc_addrs).toEqual(['direction@exterieur.test'])
			expect(envoi?.attachments.map((p) => [p.filename, p.size_bytes])).toEqual([['Proposition revisee.txt', 2048]])
		} finally {
			await nettoyer(page, objet)
		}
	})

	test('au-delà de dix fichiers, l’envoi s’éteint et dit pourquoi — au clavier', async ({ page }) => {
		const objet = `Plafond ${Date.now()}`
		await ouvrirFormulaire(page)
		try {
			await page.getByTestId('envoi-joindre').focus()
			await expect(page.getByTestId('envoi-joindre')).toBeFocused()
			await page.getByTestId('envoi-fichiers').setInputFiles(
				Array.from({ length: 11 }, (_, rang) => fichier(`f${rang}.txt`, 10)),
			)
			await expect(page.locator('[data-testid="envoi-piece"][data-etat="pret"]')).toHaveCount(11)
			await expect(page.getByTestId('envoi-valider')).toBeDisabled()
			await expect(page.getByText('Retirez des fichiers : 10 au plus par message.')).toBeVisible()
			await page.getByText('Retirez des fichiers : 10 au plus par message.').scrollIntoViewIfNeeded()
			await capturer(page, 'envoi-pieces-plafond-1440', UNITE)

			// RETIRER AU CLAVIER : tabulation jusqu'au bouton, Entrée.
			await page.getByRole('button', { name: 'Retirer f10.txt' }).focus()
			await page.keyboard.press('Enter')
			await expect(page.getByTestId('envoi-piece')).toHaveCount(10)
			await expect(page.getByTestId('envoi-valider')).toBeEnabled()

			// ANNULER RETIRE TOUS LES DÉPÔTS.
			await page.getByRole('button', { name: 'Annuler' }).click()
			await expect
				.poll(() => depots(page, Array.from({ length: 11 }, (_, rang) => `f${rang}.txt`)).then((l) => l.length))
				.toBe(0)
		} finally {
			await nettoyer(page, objet)
		}
	})

	test('les quatre paliers : la liste des fichiers et le total tiennent de 390 à 1440 px', async ({ page }) => {
		const objet = `Paliers ${Date.now()}`
		await ouvrirFormulaire(page)
		try {
			await page.getByRole('button', { name: 'Ajouter Cci' }).click()
			await page.getByTestId('envoi-fichiers').setInputFiles([
				fichier('Une proposition commerciale au nom particulièrement long pour éprouver la troncature.pdf', 4096, 'application/pdf'),
				fichier('annexe.txt', 300),
			])
			await expect(page.locator('[data-testid="envoi-piece"][data-etat="pret"]')).toHaveCount(2)
			for (const palier of PALIERS) {
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				const formulaire = page.getByTestId('envoi-formulaire')
				await formulaire.scrollIntoViewIfNeeded()
				// AUCUN DÉBORDEMENT : chaque ligne de fichier tient dans le formulaire.
				const cadre = await formulaire.boundingBox()
				for (const ligne of await page.getByTestId('envoi-piece').all()) {
					const boite = await ligne.boundingBox()
					expect(boite!.x + boite!.width).toBeLessThanOrEqual(cadre!.x + cadre!.width + 1)
				}
				await page.getByTestId('envoi-joindre').scrollIntoViewIfNeeded()
				await capturer(page, `envoi-pieces-${palier.nom}`, UNITE)
			}
		} finally {
			await page.setViewportSize({ width: 1440, height: 900 })
			await nettoyer(page, objet)
		}
	})
})
