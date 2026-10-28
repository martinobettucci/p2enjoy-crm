// @verifies CRM-069 (docs/BACKLOG.md) — tranche T5 : la case du récapitulatif quotidien sur la vraie pile — décochée par
//           défaut, cochée elle écrit le consentement de la personne en base, décochée elle le retire
// @verifies docs/SPEC-etiquettes-digest.md §5.1 ; docs/DESIGN_SYSTEM.md §5.74, §5.7 ter ; CLAUDE.md §10, §11 (un
//           consentement persisté côté serveur), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// La lectrice n'est pas abonnée dans le jeu (docs/SPEC-seed.md §31) : son consentement est posé puis retiré par l'écran, et
// la clé de service s'assure à la fin qu'il ne reste rien.

import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`digest_subscriptions?profile_id=eq.${FARIDA}`), { headers: enTetesService() })
})

test('la lectrice coche le récapitulatif de l’espace, la base le retient ; décochée, la ligne disparaît', async ({ page, request }) => {
	const lire = async () =>
		(await (await request.get(rest(`digest_subscriptions?profile_id=eq.${FARIDA}&select=workspace_id`), { headers: enTetesService() })).json()) as unknown[]
	await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
	await page.goto('/reglages/notifications')
	const groupe = page.getByTestId('fieldset-digest')
	await expect(groupe.getByRole('group', { name: 'Par email' }).or(groupe)).toBeVisible()
	const caseDigest = page.getByRole('checkbox', { name: /Recevoir chaque matin le récapitulatif de P2Enjoy SAS/ })
	await expect(caseDigest).not.toBeChecked()
	await caseDigest.check()
	await expect(groupe.getByText('Enregistré')).toBeVisible()
	expect(await lire()).toHaveLength(1)
	await capturer(page, 'digest-consentement-1440', 'CRM-069')
	await page.reload()
	await expect(page.getByRole('checkbox', { name: /Recevoir chaque matin/ })).toBeChecked()
	await page.getByRole('checkbox', { name: /Recevoir chaque matin/ }).uncheck()
	await expect.poll(lire).toHaveLength(0)
})
