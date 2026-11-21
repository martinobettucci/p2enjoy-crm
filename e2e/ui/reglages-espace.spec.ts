// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.c : les réglages ne lisent que l'espace de l'adresse — Réglages ▸ Étiquettes
//           et ▸ Arborescence d'un espace ne montrent que ses étiquettes et ses tracks, pour une personne membre de deux espaces
//           ; et Réglages ▸ Workflows choisit d'office le défaut de l'espace de l'adresse, jamais celui d'un autre, et n'en liste
//           que les suggestions de l'IA en revue (décision 974 : la coquille ne monte la page qu'une fois les espaces lus)
// @verifies docs/SPEC-espace-courant.md §15.4 bis ; docs/JOURNAL.md décisions 965, 967 et 974 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// La preuve pose, sous la clé de service, un espace jetable (« Sonde 161 réglages ») dont Camille est administratrice, avec une
// étiquette et un track ; elle le supprime à la fin, et la cascade emporte le reste. Aucune donnée du seed n'est modifiée.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { ESPACE_SEED } from '../espace'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-161'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const SONDE = { id: 'e1610000-0000-4000-8000-0000000000c1', nom: 'Sonde 161 réglages', slug: 'sonde-161-reglages' } as const
const ETIQUETTE_SONDE = 'Étiquette de la sonde 161'
const TRACK_SONDE = 'Track de la sonde 161 réglages'
// Son nom se trie AVANT ceux du seed et de « Studio Lumen » : une lecture sans filtre d'espace le choisirait d'office.
const WORKFLOW_SONDE = 'Atelier de la sonde 161'
const DEFAUT_SEED = 'Cycle commercial standard'
const SUGGESTION_SONDE = 'Un cycle imaginé pour la sonde 161'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const JSON_SERVICE = () => ({ ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' })

async function retirerSonde(request: APIRequestContext): Promise<void> {
	const reponse = await request.delete(rest(`workspaces?id=eq.${SONDE.id}`), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBeLessThan(300)
}

async function poserSonde(request: APIRequestContext): Promise<void> {
	await retirerSonde(request)
	for (const [table, ligne] of [
		['workspaces', { id: SONDE.id, name: SONDE.nom, slug: SONDE.slug }],
		['workspace_members', { workspace_id: SONDE.id, user_id: CAMILLE, role: 'admin' }],
		['labels', { workspace_id: SONDE.id, name: ETIQUETTE_SONDE }],
		['tracks', { workspace_id: SONDE.id, name: TRACK_SONDE, slug: 'track-sonde-161-reglages', position: 1 }],
		['workflows', { workspace_id: SONDE.id, name: WORKFLOW_SONDE, scope: 'global', is_default: true }],
		['suggestions_ia', { workspace_id: SONDE.id, portee: 'workflow', demande: SUGGESTION_SONDE }],
	] as const) {
		const reponse = await request.post(rest(table), { headers: JSON_SERVICE(), data: ligne })
		expect(reponse.status(), await reponse.text()).toBe(201)
	}
}

test.describe('Les réglages d’un espace ne lisent que lui (docs/SPEC-espace-courant.md §15.4 bis)', () => {
	test.beforeEach(async ({ request }) => {
		await poserSonde(request)
	})
	test.afterEach(async ({ request }) => {
		await retirerSonde(request)
	})

	test('Réglages ▸ Étiquettes : celles de l’espace de l’adresse, et elles seules', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/${ESPACE_SEED}/reglages/etiquettes`)
		const lignes = page.getByTestId('ligne-etiquette')
		await expect(lignes.first()).toBeVisible()
		await expect(lignes.filter({ hasText: ETIQUETTE_SONDE })).toHaveCount(0)

		await page.goto(`/${SONDE.slug}/reglages/etiquettes`)
		await expect(lignes.filter({ hasText: ETIQUETTE_SONDE })).toHaveCount(1)
		await expect(lignes).toHaveCount(1)
		await capturer(page, 'reglages-etiquettes-sonde-1440', UNITE)
	})

	test('Réglages ▸ Arborescence : les tracks de l’espace de l’adresse, et eux seuls', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		const principal = page.getByRole('main')
		await page.goto(`/${ESPACE_SEED}/reglages/arborescence`)
		await expect(principal.getByText('Conseil & IA').first()).toBeVisible()
		await expect(principal.getByText(TRACK_SONDE)).toHaveCount(0)

		await page.goto(`/${SONDE.slug}/reglages/arborescence`)
		await expect(principal.getByText(TRACK_SONDE).first()).toBeVisible()
		await expect(principal.getByText('Conseil & IA')).toHaveCount(0)
		await capturer(page, 'reglages-arborescence-sonde-1440', UNITE)
	})

	test('Réglages ▸ Workflows : le défaut choisi d’office est celui de l’espace de l’adresse (décision 974)', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		const entete = page.getByTestId('entete-workflow')
		const liste = page.getByRole('navigation', { name: 'Choisir un workflow' })
		// Première page de l'onglet : la coquille lit les espaces au moment où la page se monte.
		await page.goto(`/${ESPACE_SEED}/reglages/workflows`)
		await expect(entete.getByRole('heading', { level: 2 })).toHaveText(DEFAUT_SEED)
		await expect(liste.getByText(WORKFLOW_SONDE)).toHaveCount(0)
		// Les suggestions de l'IA en revue, lecture de premier niveau du même écran : celles de cet espace seul.
		await expect(page.getByText(SUGGESTION_SONDE)).toHaveCount(0)

		await page.goto(`/${SONDE.slug}/reglages/workflows`)
		await expect(entete.getByRole('heading', { level: 2 })).toHaveText(WORKFLOW_SONDE)
		await expect(liste.getByText(DEFAUT_SEED)).toHaveCount(0)
		await expect(page.getByText(SUGGESTION_SONDE).first()).toBeVisible()
		await capturer(page, 'reglages-workflows-sonde-1440', UNITE)
	})

	test('pendant la lecture des espaces, la page attend sous un squelette — jamais un écran blanc (décision 974, §5.8)', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		// La lecture des espaces est RETENUE une seconde et demie : l'attente, sinon trop brève, devient observable.
		let retenir = true
		await page.route(/\/rest\/v1\/workspaces\?/, async (route) => {
			if (retenir) await new Promise((fin) => setTimeout(fin, 1500))
			await route.continue()
		})
		await page.goto(`/${ESPACE_SEED}/reglages/workflows`)
		const principal = page.getByRole('main')
		await expect(principal.getByRole('status', { name: 'Chargement en cours' }).first()).toBeVisible()
		await expect(page.getByTestId('entete-workflow')).toHaveCount(0)
		await capturer(page, 'coquille-attente-espaces-1440', UNITE)
		retenir = false
		await expect(page.getByTestId('entete-workflow').getByRole('heading', { level: 2 })).toHaveText(DEFAUT_SEED)
	})
})
