// @verifies CRM-127 (docs/BACKLOG.md) — tranche T4 : « Tester la connexion » depuis les deux écrans de réglages, parcours
//           réel à la souris et au clavier
// @verifies docs/SPEC-mail-subsystem.md §23.5 (la commande, son vol, le verdict sous la ligne, la liste relue, l'incident
//           d'une ligne en erreur, `pending` lu « Non testée »), §23.6 (l'échec se reproduit par le véritable parcours),
//           §23.7 (preuve E2E UI) ; docs/DESIGN_SYSTEM.md §5.93, §7 (paliers) ; CLAUDE.md §8 (aucune trace fabriquée),
//           §16 (captures observées)
//
// LE TEST OUVRE DE VRAIES SESSIONS IMAP ET SMTP vers le Stalwart de développement, par la vraie fonction edge et le vrai
// service `mail-sync` : aucune réponse n'est substituée. L'échec `auth_failed` naît d'un mauvais mot de passe saisi dans
// le formulaire, puis le bon mot de passe est remis par le même formulaire et la ligne est retestée (§23.6).
//
// LE SEED EST RENDU TEL QU'IL A ÉTÉ REÇU (leçon d'INC-061) : chaque ligne touchée retrouve son `status`, son `last_error`
// et son `last_checked_at` d'avant, par la clé de service — la forme de `e2e/api/tester-connexion.spec.ts`. Avant chaque
// test, `last_checked_at` est vidé par la même clé : un test d'une campagne précédente déclencherait la garde de 30 s, que
// la preuve d'API éprouve déjà.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-127'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const LABEL_SYSTEME = 'Boîte système du workspace'
const LABEL_DRISS = 'Boîte de Driss Lemoine'

type Table = 'mail_inbound_accounts' | 'mail_outbound_identities'
type Ligne = { id: string; status: string; last_error: string | null; last_checked_at: string | null }

const retenues: Record<string, { table: Table; avant: Ligne }> = {}

async function lire(page: Page, table: Table, filtre: string): Promise<Ligne & { from_address?: string }> {
	const colonnes = table === 'mail_outbound_identities' ? 'id,status,last_error,last_checked_at,from_address' : 'id,status,last_error,last_checked_at'
	const reponse = await page.request.get(`${URL_API}/rest/v1/${table}?select=${colonnes}&${filtre}`, { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	const [ligne] = (await reponse.json()) as (Ligne & { from_address?: string })[]
	expect(ligne, `${table} ${filtre}`).toBeDefined()
	return ligne!
}

/** Retient l'état d'avant (une fois) et part d'une ligne sans test récent. */
async function preparer(page: Page, table: Table, filtre: string) {
	const ligne = await lire(page, table, filtre)
	retenues[ligne.id] ??= { table, avant: ligne }
	await viderGarde(page, table, ligne.id)
	return ligne
}

async function viderGarde(page: Page, table: Table, id: string): Promise<void> {
	const reponse = await page.request.patch(`${URL_API}/rest/v1/${table}?id=eq.${id}`, {
		headers: { ...enTetesService(), prefer: 'return=minimal' },
		data: { last_checked_at: null },
	})
	expect(reponse.status()).toBe(204)
}

test.describe.configure({ mode: 'serial' })

test.afterAll(async ({ request }) => {
	for (const [id, { table, avant }] of Object.entries(retenues)) {
		await request.patch(`${URL_API}/rest/v1/${table}?id=eq.${id}`, {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: { status: avant.status, last_error: avant.last_error, last_checked_at: avant.last_checked_at },
		})
	}
})

test.describe('« Tester la connexion » (docs/SPEC-mail-subsystem.md §23.5)', () => {
	test('l’administratrice teste la boîte système au clavier : « Connectée » relue en base, le focus rendu', async ({ page }) => {
		test.setTimeout(90_000)
		const systeme = await preparer(page, 'mail_inbound_accounts', 'owner_id=is.null')
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/comptes-mail')
		const ligne = page.getByTestId('ligne-compte-configuration').filter({ hasText: LABEL_SYSTEME })
		const commande = ligne.getByRole('button', { name: `Tester la connexion de ${LABEL_SYSTEME}` })
		await expect(commande).toBeVisible()

		await commande.focus()
		await page.keyboard.press('Enter')
		const verdict = ligne.getByTestId('verdict-test-connexion')
		await expect(verdict).toHaveText('Connexion réussie.', { timeout: 60_000 })
		await expect(ligne.getByText('Connectée')).toBeVisible()
		// Le focus revient à la commande quand elle se réactive (§5.93) : le clavier repart d'où il était.
		await expect(ligne.getByTestId('tester-connexion')).toBeFocused()
		// La pilule dit ce que le SERVICE a écrit, relu en base (§23.5).
		const relue = await lire(page, 'mail_inbound_accounts', `id=eq.${systeme.id}`)
		expect(relue.status).toBe('ok')
		expect(relue.last_checked_at).not.toBeNull()
		await capturer(page, 'tester-boite-systeme-reussi-xl-1440', UNITE)
	})

	test('un membre teste sa boîte et son identité d’expédition : vraies sessions IMAP et SMTP', async ({ page }) => {
		test.setTimeout(120_000)
		await preparer(page, 'mail_inbound_accounts', `owner_id=eq.${DRISS}`)
		const identite = await preparer(page, 'mail_outbound_identities', `owner_id=eq.${DRISS}`)
		await connecterAvecLeLabs(page, BIZDEV)

		await page.goto('/reglages/comptes-mail')
		const boite = page.getByTestId('ligne-compte-configuration').filter({ hasText: LABEL_DRISS })
		await boite.getByTestId('tester-connexion').click()
		await expect(boite.getByTestId('verdict-test-connexion')).toHaveText('Connexion réussie.', { timeout: 60_000 })
		await expect(boite.getByText('Connectée')).toBeVisible()

		await page.goto('/reglages/identites-mail')
		const ligne = page.locator(`[data-identite="${identite.id}"]`)
		await expect(ligne.getByRole('button', { name: `Tester la connexion de ${identite.from_address}` })).toBeVisible()
		await ligne.getByTestId('tester-connexion').click()
		await expect(ligne.getByTestId('verdict-test-connexion')).toHaveText('Connexion réussie.', { timeout: 60_000 })
		await expect(ligne.getByText('Connectée')).toBeVisible()
		expect((await lire(page, 'mail_outbound_identities', `id=eq.${identite.id}`)).status).toBe('ok')
		await capturer(page, 'tester-identite-reussi-xl-1440', UNITE)
	})

	test('un mauvais mot de passe donne « Échec : Authentification refusée », puis le bon est remis et retesté', async ({
		page,
	}) => {
		test.setTimeout(150_000)
		const boiteDriss = await preparer(page, 'mail_inbound_accounts', `owner_id=eq.${DRISS}`)
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto('/reglages/comptes-mail')
		const ligne = page.getByTestId('ligne-compte-configuration').filter({ hasText: LABEL_DRISS })

		const enregistrerMotDePasse = async (motDePasse: string) => {
			await ligne.getByTestId('configurer-compte').click()
			await page.getByTestId('champ-mot-de-passe').fill(motDePasse)
			await page.getByTestId('valider-compte-mail').click()
			await expect(page.getByTestId('formulaire-compte-mail')).toBeHidden()
			// Enregistrer remet l'état à `pending` (§21) : la pilule le lit « Non testée ».
			await expect(ligne.getByText('Non testée')).toBeVisible()
			await viderGarde(page, 'mail_inbound_accounts', boiteDriss.id)
		}

		await enregistrerMotDePasse('ce-mot-de-passe-est-faux')
		await ligne.getByTestId('tester-connexion').click()
		await expect(ligne.getByTestId('verdict-test-connexion')).toHaveText('Échec : Authentification refusée', { timeout: 60_000 })
		await expect(ligne.getByText('En erreur')).toBeVisible()
		await expect(ligne.getByTestId('incident-compte')).toHaveText('Authentification refusée')
		const echouee = await lire(page, 'mail_inbound_accounts', `id=eq.${boiteDriss.id}`)
		expect(echouee).toMatchObject({ status: 'error', last_error: 'auth_failed' })
		await capturer(page, 'tester-echec-authentification-xl-1440', UNITE)

		// La REMISE EN ÉTAT par le véritable parcours (§23.6) : le bon mot de passe, puis un nouveau test.
		await enregistrerMotDePasse(MOT_DE_PASSE_SEED)
		await ligne.getByTestId('tester-connexion').click()
		await expect(ligne.getByTestId('verdict-test-connexion')).toHaveText('Connexion réussie.', { timeout: 60_000 })
		await expect(ligne.getByTestId('incident-compte')).toHaveCount(0)
		expect((await lire(page, 'mail_inbound_accounts', `id=eq.${boiteDriss.id}`)).status).toBe('ok')
	})

	test('deux tests rapprochés : le second est refusé, et la phrase le dit sous la ligne', async ({ page }) => {
		test.setTimeout(90_000)
		await preparer(page, 'mail_inbound_accounts', 'owner_id=is.null')
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/comptes-mail')
		const ligne = page.getByTestId('ligne-compte-configuration').filter({ hasText: LABEL_SYSTEME })
		await ligne.getByTestId('tester-connexion').click()
		await expect(ligne.getByTestId('verdict-test-connexion')).toHaveText('Connexion réussie.', { timeout: 60_000 })
		await ligne.getByTestId('tester-connexion').click()
		await expect(ligne.getByTestId('verdict-test-connexion')).toHaveText(
			'Un test vient d’avoir lieu sur cette ligne. Réessayez dans quelques secondes.',
		)
		// Le refus est le contrôle qui joue : le navigateur en garde la trace, attendue et seule (§23.3).
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[429]])
	})
})

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §5.93, §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la commande, son verdict et la ligne restent lisibles`, async ({ page }) => {
			test.setTimeout(90_000)
			await preparer(page, 'mail_inbound_accounts', 'owner_id=is.null')
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto('/reglages/comptes-mail')
			const ligne = page.getByTestId('ligne-compte-configuration').filter({ hasText: LABEL_SYSTEME })
			await ligne.getByTestId('tester-connexion').click()
			await expect(ligne.getByTestId('verdict-test-connexion')).toHaveText('Connexion réussie.', { timeout: 60_000 })

			const debordePage = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)
			// Les deux commandes gardent la cible de 40 px (§8), et tiennent dans la fenêtre.
			for (const testId of ['tester-connexion', 'configurer-compte']) {
				const cadre = await ligne.getByTestId(testId).boundingBox()
				expect(cadre, testId).not.toBeNull()
				expect(cadre!.height, `${testId} : cible de 40 px`).toBeGreaterThanOrEqual(40)
				expect(cadre!.x + cadre!.width, `${testId} : bord droit dans la fenêtre`).toBeLessThanOrEqual(palier.largeur)
			}
			await capturer(page, `tester-connexion-${palier.nom}`, UNITE)
		})
	}
})
