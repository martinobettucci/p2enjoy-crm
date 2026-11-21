// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.a : l'espace en tête du chemin sur la vraie pile — chaque ancienne adresse
//           redirigée dans l'espace de sa ressource (inbox et message, réglages, track, affaire), paramètres gardés et
//           « Précédent » qui ne revient pas à l'ancienne adresse ; un slug inconnu dit « Espace introuvable » ; deux
//           onglets sur deux espaces, chacun avec sa barre latérale et son fil d'Ariane ; une page globale qui garde l'espace
//           de l'onglet ; au clavier, l'entrée « Inbox » de la barre mène dans l'espace courant
// @verifies docs/SPEC-espace-courant.md §8.2 à §8.4, §15.2 à §15.5 ; docs/JOURNAL.md décision 967 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// La preuve pose, sous la clé de service, un espace jetable (« Sonde 161 onglets ») dont Camille est administratrice, avec un
// track ; elle le supprime à la fin, et la cascade emporte le reste. Aucune donnée du seed n'est modifiée.

import type { APIRequestContext, Page } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { ESPACE_SEED } from '../espace'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-161'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const SONDE = { id: 'e1610000-0000-4000-8000-0000000000b1', nom: 'Sonde 161 onglets', slug: 'sonde-161-onglets' } as const
const TRACK_SONDE = { nom: 'Track de la sonde 161', slug: 'track-sonde-161' } as const
const AFFAIRE = { id: '5eed0000-0000-4000-8000-00000000d012', track: 'studio-web', channel: 'maintenance' } as const
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
		['tracks', { workspace_id: SONDE.id, name: TRACK_SONDE.nom, slug: TRACK_SONDE.slug, position: 1 }],
	] as const) {
		const reponse = await request.post(rest(table), { headers: JSON_SERVICE(), data: ligne })
		expect(reponse.status(), await reponse.text()).toBe(201)
	}
}

/** Un mail non classé du seed que Camille lit, pour l'ancienne adresse `/inbox?message=`. */
async function unMessageDuSeed(request: APIRequestContext): Promise<string> {
	const reponse = await request.get(
		rest('mail_messages?select=id&rfc822_message_id=eq.%3Cseed-inbox-non-classe@p2enjoy.test%3E&limit=1'),
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as { id: string }[]
	expect(lignes[0], 'le mail non classé du seed (docs/SPEC-seed.md §44)').toBeDefined()
	return lignes[0]!.id
}

const pilules = (page: Page) => page.getByTestId('entree-track')
const espaceDuFil = (page: Page) => page.getByTestId('workspace-courant').first()

test.describe('L’espace en tête du chemin (docs/SPEC-espace-courant.md §8, §15)', () => {
	test.afterEach(async ({ request }) => {
		await retirerSonde(request)
	})

	test('les anciennes adresses mènent dans l’espace de leur ressource, et « Précédent » n’y revient pas', async ({ page, request }) => {
		const idMessage = await unMessageDuSeed(request)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')

		await page.goto('/inbox')
		await expect(page).toHaveURL(new RegExp(`/${ESPACE_SEED}/inbox$`))
		await expect(page.getByTestId('route-inbox')).toBeVisible()

		await page.goto(`/inbox?message=${idMessage}`)
		await expect(page).toHaveURL(new RegExp(`/${ESPACE_SEED}/inbox\\?message=${idMessage}$`))

		await page.goto('/reglages/etiquettes')
		await expect(page).toHaveURL(new RegExp(`/${ESPACE_SEED}/reglages/etiquettes$`))

		await page.goto(`/tracks/${AFFAIRE.track}`)
		await expect(page).toHaveURL(new RegExp(`/${ESPACE_SEED}/tracks/${AFFAIRE.track}$`))

		await page.goto(`/tracks/${AFFAIRE.track}/${AFFAIRE.channel}/cards/${AFFAIRE.id}#checklist`)
		await expect(page).toHaveURL(new RegExp(`/${ESPACE_SEED}/tracks/${AFFAIRE.track}/${AFFAIRE.channel}/cards/${AFFAIRE.id}#checklist$`))
		await expect(page.getByRole('heading', { level: 1, name: /Refonte du monitoring/ })).toBeVisible()

		// `replace` : revenir en arrière ramène à la page d'avant, jamais à l'ancienne adresse qui redirigerait aussitôt.
		await page.goBack()
		await expect(page).toHaveURL(new RegExp(`/${ESPACE_SEED}/tracks/${AFFAIRE.track}$`))
	})

	test('un slug d’adresse inconnu dit « Espace introuvable » et propose le premier espace', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/espace-qui-n-existe-pas/inbox')
		const introuvable = page.getByTestId('espace-introuvable')
		await expect(introuvable).toBeVisible()
		await expect(introuvable.getByRole('link', { name: 'Ouvrir mon premier espace' })).toHaveAttribute('href', `/${ESPACE_SEED}/inbox`)
		await capturer(page, 'espace-introuvable-1440', UNITE)
	})

	test('deux onglets sur deux espaces : chacun sa barre latérale, son fil, et une page globale qui garde l’espace de l’onglet', async ({
		page,
		request,
	}) => {
		await poserSonde(request)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/${ESPACE_SEED}/inbox`)
		await expect(espaceDuFil(page)).toHaveText('P2Enjoy SAS')
		await expect(pilules(page).filter({ hasText: 'Conseil & IA' })).toBeVisible()
		await expect(pilules(page).filter({ hasText: TRACK_SONDE.nom })).toHaveCount(0)

		const second = await page.context().newPage()
		await second.goto(`/${SONDE.slug}/inbox`)
		if (second.url().includes('/connexion')) await connecterAvecLeLabs(second, 'admin@p2enjoy.test', { naviguer: false })
		await expect(second).toHaveURL(new RegExp(`/${SONDE.slug}/inbox$`))
		await expect(espaceDuFil(second)).toHaveText(SONDE.nom)
		await expect(pilules(second).filter({ hasText: TRACK_SONDE.nom })).toBeVisible()
		await expect(pilules(second).filter({ hasText: 'Conseil & IA' })).toHaveCount(0)
		await capturer(second, 'deux-onglets-sonde-1440', UNITE)

		// La pilule du track mène dans l'espace de l'onglet.
		await pilules(second).filter({ hasText: TRACK_SONDE.nom }).click()
		await expect(second).toHaveURL(new RegExp(`/${SONDE.slug}/tracks/${TRACK_SONDE.slug}$`))

		// Une page globale garde l'espace de l'onglet, chacun le sien — en naviguant dans l'application : la mémoire de
		// l'onglet est vive, et un rechargement la perd (§2), comme le dit le dernier constat.
		const contacts = (p: Page) => p.getByRole('navigation').getByRole('link', { name: 'Contacts' }).first()
		await contacts(second).click()
		await expect(second).toHaveURL(/\/contacts$/)
		await expect(espaceDuFil(second)).toHaveText(SONDE.nom)
		await contacts(page).click()
		await expect(espaceDuFil(page)).toHaveText('P2Enjoy SAS')
		await second.reload()
		await expect(espaceDuFil(second)).toHaveText('P2Enjoy SAS')
		await second.close()
	})

	test('un track se résout dans l’espace de l’adresse : deux homonymes, chacun le sien ; un track d’un autre espace est introuvable', async ({
		page,
		request,
	}) => {
		// Trouvé par la session f9 (CRM-162) : le slug d'un track n'est unique que dans son espace (§3), et la route d'un track
		// le cherchait dans tous les espaces lisibles.
		await poserSonde(request)
		const homonyme = await request.post(rest('tracks'), {
			headers: JSON_SERVICE(),
			data: { workspace_id: SONDE.id, name: 'Conseil de la sonde 161', slug: 'conseil-ia', position: 2 },
		})
		expect(homonyme.status(), await homonyme.text()).toBe(201)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		const titre = page.getByRole('heading', { level: 1 })

		await page.goto(`/${ESPACE_SEED}/tracks/conseil-ia`)
		await expect(titre).toHaveText('Conseil & IA')
		await page.goto(`/${SONDE.slug}/tracks/conseil-ia`)
		await expect(titre).toHaveText('Conseil de la sonde 161')
		await page.goto(`/${ESPACE_SEED}/tracks/${TRACK_SONDE.slug}`)
		await expect(page.getByTestId('etat-vide')).toContainText('Track introuvable')
	})

	test('au clavier, l’entrée « Inbox » de la barre latérale mène dans l’espace courant', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/${ESPACE_SEED}/reglages`)
		const inbox = page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).first()
		await expect(inbox).toHaveAttribute('href', `/${ESPACE_SEED}/inbox`)
		await inbox.focus()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`/${ESPACE_SEED}/inbox$`))
	})
})
