// @verifies CRM-125 (docs/BACKLOG.md) T3 — l'aperçu des paliers d'une séquence sur le jeu d'exemple, sur la pile réelle et
//           le seed : un palier, la séquence entière et ses délais cumulés, le rendu partagé par modèle, la mention des
//           données d'exemple, l'identité de la personne (Driss et sa signature ; la mention de l'expéditeur fictif), la lectrice sans accès à la
//           fiche, le clavier,
//           les quatre paliers d'écran
// @verifies docs/SPEC-modeles-emails.md §14.3, §14.4, §14.5 ; docs/DESIGN_SYSTEM.md §5.41 (révision `CRM-125`) ;
//           CLAUDE.md §16 (captures observées)
//
// CE FICHIER N'ÉCRIT RIEN : l'aperçu est une lecture (`render_mail_template_sample` est `STABLE`).

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesAuthentifies, jetonDe } from '../api/jetons'

const UNITE = 'CRM-125'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** La séquence du seed : 3, 7, 14 jours — J+3, J+10, J+24 ; le palier 3 réemploie le modèle du palier 1. */
const SEQUENCE = 'Relance en trois temps'

async function ouvrirFiche(page: Page, email: string) {
	await connecterAvecLeLabs(page, email)
	await page.goto('/reglages/sequences-relance')
	await page.getByTestId('ligne-sequence').filter({ hasText: SEQUENCE }).getByTestId('modifier-sequence').click()
	await expect(page.getByTestId('ligne-palier')).toHaveCount(3)
}

test.describe('l’aperçu des paliers d’une séquence (§14.5, CRM-125)', () => {
	test('un palier se déplie sur le jeu d’exemple, un seul à la fois', async ({ page }) => {
		await ouvrirFiche(page, ADMIN)
		const lignes = page.getByTestId('ligne-palier')
		await lignes.nth(0).getByTestId('apercu-palier').click()
		const bloc = lignes.nth(0).getByTestId('apercu-palier-bloc')
		await expect(bloc.getByTestId('mention-donnees-exemple')).toContainText('M. Dupont, ENTREPRISE INC')
		await expect(bloc.getByTestId('apercu-palier-rendu-objet')).toHaveText('Où en est Projet exemple ?')
		await expect(bloc.getByTestId('apercu-palier-rendu-corps')).toContainText('Bonjour M. Dupont,')
		await capturer(page, 'apercu-palier-1440', UNITE)

		await lignes.nth(1).getByTestId('apercu-palier').click()
		await expect(page.getByTestId('apercu-palier-bloc')).toHaveCount(1)
		await expect(lignes.nth(1).getByTestId('apercu-palier-bloc')).toBeVisible()
	})

	test('la séquence entière : trois paliers, leurs délais cumulés, deux appels pour deux modèles', async ({ page }) => {
		await ouvrirFiche(page, ADMIN)
		const appels: string[] = []
		page.on('request', (requete) => {
			if (requete.url().includes('/rpc/render_mail_template_sample')) appels.push(requete.postData() ?? '')
		})
		await page.getByTestId('apercu-sequence-ouvrir').click()
		const panneau = page.getByTestId('apercu-sequence')
		await expect(panneau.getByTestId('apercu-sequence-titre')).toHaveText([
			'Palier 1 · J+3 — J+3 depuis l’armement',
			'Palier 2 · J+7 — J+10 depuis l’armement',
			'Palier 3 · J+14 — J+24 depuis l’armement',
		])
		await expect(panneau.getByTestId('apercu-sequence-rendu')).toHaveCount(3)
		expect(appels, 'un appel par modèle distinct').toHaveLength(2)
		await capturer(page, 'apercu-sequence-1440', UNITE)

		// AU CLAVIER : « Fermer » rend le focus à la commande qui a ouvert.
		await panneau.getByTestId('fermer-apercu-sequence').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('apercu-sequence')).toHaveCount(0)
		await expect(page.getByTestId('apercu-sequence-ouvrir')).toBeFocused()
	})

	test('Driss voit sa propre signature, et aucun expéditeur fictif', async ({ page }) => {
		await ouvrirFiche(page, BIZDEV)
		await page.getByTestId('ligne-palier').nth(0).getByTestId('apercu-palier').click()
		await expect(page.getByTestId('apercu-palier-rendu-corps')).toContainText('-- \nDriss Lemoine')
		await expect(page.getByTestId('mention-identite-fictive')).toHaveCount(0)
	})

	// L'EXPÉDITEUR FICTIF SE LIT QUAND LA PERSONNE N'A NI DÉFAUT NI IDENTITÉ UNIQUE (§14.4). L'attendu est relu par l'API
	// avec le jeton réel : l'identité de l'administratrice dépend du seed (INC-335 lui en donnera une), et l'écran doit
	// dire exactement ce que la base rend.
	test('la mention de l’expéditeur fictif suit ce que la base rend pour la personne', async ({ page }) => {
		const jeton = await jetonDe(ADMIN)
		const reponse = await page.request.post(`${URL_API}/rest/v1/rpc/render_mail_template_sample`, {
			headers: enTetesAuthentifies(jeton),
			data: { p_template_id: '7e11a7e0-0000-4000-8000-000000000001' },
		})
		const [ligne] = (await reponse.json()) as { identity_is_sample: boolean }[]
		await ouvrirFiche(page, ADMIN)
		await page.getByTestId('ligne-palier').nth(0).getByTestId('apercu-palier').click()
		await expect(page.getByTestId('apercu-palier-rendu-objet')).toHaveText('Où en est Projet exemple ?')
		await expect(page.getByTestId('mention-identite-fictive')).toHaveCount(ligne?.identity_is_sample ? 1 : 0)
		await capturer(page, 'apercu-mention-identite-1440', UNITE)
	})

	// LA LECTRICE N'OUVRE PAS LA FICHE D'UNE SÉQUENCE (« Modifier » éteint, CRM-093) : l'aperçu, qui y vit, ne lui est
	// pas offert à l'écran. La fonction lui reste lisible — prouvé par `e2e/api/apercu-modeles-emails.spec.ts`.
	test('la lectrice n’atteint pas la fiche, donc pas l’aperçu', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/reglages/sequences-relance')
		const modifier = page.getByTestId('ligne-sequence').filter({ hasText: SEQUENCE }).getByTestId('modifier-sequence')
		await expect(modifier).toBeDisabled()
		await expect(page.getByTestId('apercu-palier')).toHaveCount(0)
	})

	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : l’aperçu de la séquence, sans débordement`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await ouvrirFiche(page, ADMIN)
			await page.getByTestId('apercu-sequence-ouvrir').click()
			await expect(page.getByTestId('apercu-sequence-rendu')).toHaveCount(3)
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
			expect(deborde, 'aucun défilement horizontal').toBe(false)
			await capturer(page, `apercu-sequence-${palier.nom}`, UNITE)
		})
	}
})
