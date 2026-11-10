// @verifies CRM-135 (docs/BACKLOG.md) — l'écran d'état montre le motif d'une relève en échec, écrit par la relève elle-même
// @verifies docs/SPEC-mail-subsystem.md §24.3 (l'échec s'écrit, le succès le rend), §24.7 (E2E `ui` : « Authentification
//           refusée » en « Dernier incident », relu en base), §20.11.3 (la colonne « Dernier incident ») ;
//           docs/DESIGN_SYSTEM.md §5.14 (cette surface), §7 (paliers) ; INC-349 ; CLAUDE.md §8 (aucune trace fabriquée), §16
//
// À LA DIFFÉRENCE DE `etat-messagerie.spec.ts`, L'INCIDENT N'EST PAS POSÉ PAR LA CLÉ DE SERVICE : il naît d'une vraie
// relève refusée par le Stalwart de développement, après un mauvais mot de passe posé par le vrai chemin d'écriture. Le
// bon mot de passe est remis par le même chemin, et une vraie relève rend la boîte `ok`.

import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { changerMotDePasse, lireBoite, relever, type BoiteEntrante } from '../releve'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { capturer } from './captures'

const UNITE = 'CRM-135'
const BIZDEV = 'bizdev@p2enjoy.test'
const FILTRE_DRISS = 'owner_id=eq.5eed0000-0000-4000-8000-000000000012'

test.describe.configure({ mode: 'serial' })

async function provoquerEchec(): Promise<BoiteEntrante> {
	const boite = await lireBoite(FILTRE_DRISS)
	await changerMotDePasse(boite, BIZDEV, 'ce-mot-de-passe-est-faux')
	expect(relever(boite.id), 'la relève refusée rend 502').toBe(502)
	expect(await lireBoite(FILTRE_DRISS)).toMatchObject({ status: 'error', last_error: 'auth_failed' })
	return boite
}

async function rendre(boite: BoiteEntrante): Promise<void> {
	await changerMotDePasse(boite, BIZDEV, MOT_DE_PASSE_SEED)
	expect(relever(boite.id), 'la relève avec le bon mot de passe va au bout').toBe(200)
}

async function ouvrirEtat(page: Page): Promise<void> {
	await connecterAvecLeLabs(page, BIZDEV)
	// Depuis l'index des réglages, au clavier : le lien se prend au focus et s'active par Entrée.
	await page.goto('/reglages')
	const lien = page.getByRole('link', { name: 'État de la messagerie' })
	await lien.focus()
	await page.keyboard.press('Enter')
	await expect(page).toHaveURL(/\/reglages\/messagerie$/)
}

test('une relève refusée paraît en « Authentification refusée », puis la boîte rendue n’a plus d’incident', async ({
	page,
}) => {
	test.setTimeout(240_000)
	const boite = await provoquerEchec()
	try {
		await ouvrirEtat(page)
		const ligne = page.getByTestId('ligne-compte-mail').filter({ hasText: 'Driss' })
		await expect(ligne.getByText('Authentification refusée')).toBeVisible()
		await expect(ligne).not.toContainText('auth_failed')
		await capturer(page, 'releve-en-echec-xl-1440', UNITE)
	} finally {
		await rendre(boite)
	}

	await page.reload()
	const ligne = page.getByTestId('ligne-compte-mail').filter({ hasText: 'Driss' })
	await expect(ligne).toBeVisible()
	await expect(ligne.getByText('Authentification refusée')).toHaveCount(0)
	await expect(ligne.locator('code').first()).toHaveText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)
})

test('au palier sm (390), l’incident reste lisible et la page ne défile pas horizontalement', async ({ page }) => {
	test.setTimeout(240_000)
	await page.setViewportSize({ width: 390, height: 844 })
	const boite = await provoquerEchec()
	try {
		await ouvrirEtat(page)
		const ligne = page.getByTestId('ligne-compte-mail').filter({ hasText: 'Driss' })
		await expect(ligne.getByText('Authentification refusée')).toBeVisible()
		const debordePage = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
		)
		expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)
		// Le tableau défile dans SON conteneur (docs/DESIGN_SYSTEM.md §12.6) : l'incident, en dernière colonne, est amené
		// dans la vue avant la capture, et la preuve exige qu'il y soit, non seulement qu'il existe dans la page.
		const incident = ligne.getByText('Authentification refusée')
		await incident.scrollIntoViewIfNeeded()
		await expect(incident).toBeInViewport()
		await capturer(page, 'releve-en-echec-sm-390', UNITE)
	} finally {
		await rendre(boite)
	}
})
