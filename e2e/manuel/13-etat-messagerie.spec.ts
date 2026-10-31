// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.3 : les images du chapitre 13, « Consulter l'état de la messagerie »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 13 ; docs/SPEC-mail-subsystem.md §20.11 (l'écran, les
//       incidents traduits, l'état vide)
//
// Les six incidents que le manuel nomme ne se rencontrent qu'en panne réelle d'un serveur de messagerie. Le scénario
// les POSE tour à tour sur la boîte de Driss Lemoine, par la clé de service — comme `e2e/ui/etat-messagerie.spec.ts` —,
// et rend ensuite à la boîte l'état exact qu'il lui avait lu.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, VIEWER, connecterAvecLeLabs, lireService, service } from './outils'

const CHAPITRE = 'consulter-l-etat-de-la-messagerie'
const BOITE = `mail_inbound_accounts?label=eq.${encodeURIComponent('Boîte de Driss Lemoine')}`
const INCIDENTS = ['auth_failed', 'host_unreachable', 'connection_refused', 'tls_failed', 'timeout', 'protocol_error'] as const

type Etat = { status: string; last_error: string | null; last_sync_at: string | null }

test('l’écran, et les six incidents d’une boîte', async ({ page, request }) => {
	const [avant] = await lireService<Etat[]>(request, `${BOITE}&select=status,last_error,last_sync_at`)
	if (avant === undefined) throw new Error('la boîte de Driss Lemoine est absente du seed')
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/messagerie')
		await expect(page.getByTestId('tableau-comptes-mail')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'etat-de-la-messagerie', cibles: [], pleinePage: true })
		const systeme = page.getByTestId('ligne-compte-mail').filter({ hasText: 'système' })
		await expect(systeme.getByText('Jamais relevée')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'jamais-relevee', cibles: [systeme] })

		for (const code of INCIDENTS) {
			await service(request, 'patch', BOITE, { status: 'error', last_error: code, last_sync_at: '2026-10-27T08:00:00Z' })
			await page.reload()
			const ligne = page.getByTestId('ligne-compte-mail').filter({ hasText: 'Driss' })
			await expect(ligne).not.toContainText(code)
			await illustrer(page, { chapitre: CHAPITRE, section: null, nom: `incident-${code.replaceAll('_', '-')}`, cibles: [ligne] })
		}
	} finally {
		await service(request, 'patch', BOITE, avant)
	}
})

test('un membre sans boîte', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await page.goto('/reglages/messagerie')
	const vide = page.getByTestId('etat-vide')
	await expect(vide).toContainText('Aucune boîte à superviser')
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'aucune-boite', cibles: [vide] })
})
