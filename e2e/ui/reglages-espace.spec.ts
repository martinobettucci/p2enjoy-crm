// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.c : les réglages ne lisent que l'espace de l'adresse — Réglages ▸ Étiquettes
//           et ▸ Arborescence d'un espace ne montrent que ses étiquettes et ses tracks, pour une personne membre de deux espaces
// @verifies docs/SPEC-espace-courant.md §15.4 bis ; docs/JOURNAL.md décisions 965 et 967 ; CLAUDE.md §16 (captures)
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
})
