// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.3 : les images du chapitre 11, « Les boîtes de réception et les adresses
//       d'expédition »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 11 ; docs/SPEC-mail-subsystem.md (les comptes
//       entrants, les identités d'expédition, le plafond du jour)
//
// Les boîtes et les identités sont celles du seed. Deux états sont posés par la clé de service et rendus tels qu'ils
// ont été lus : une boîte « Connectée », et le plafond du jour d'une adresse d'expédition ramené à zéro le temps d'un
// envoi — que le serveur refuse, si bien que rien n'entre dans la file.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, WORKSPACE_SEED, connecterAvecLeLabs, lireService, service } from './outils'

const CHAPITRE = 'les-boites-de-reception-et-les-adresses-d-expedition'
const BOITES = 'les-boites-de-reception-declarees'
const ADRESSES = 'les-adresses-d-expedition'
const BOITE_DRISS = `mail_inbound_accounts?label=eq.${encodeURIComponent('Boîte de Driss Lemoine')}`

test('les réglages de la messagerie, dans leur ordre', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages')
	const entree = (nom: string) => page.getByRole('link', { name: new RegExp(`^${nom}`) }).first()
	// Une image par section, chacune sur son entrée : un nom ne sert qu'une fois par chapitre (`illustrer`).
	await illustrer(page, { chapitre: CHAPITRE, section: BOITES, nom: 'reglages-boites', cibles: [entree('Comptes de messagerie entrante'), entree('État de la messagerie')] })
	await illustrer(page, { chapitre: CHAPITRE, section: ADRESSES, nom: 'reglages-adresses', cibles: [entree('Identités d’expédition'), entree('État de la messagerie')] })
})

test('les boîtes de réception : la liste, une boîte connectée, la configuration', async ({ page, request }) => {
	const [avant] = await lireService<{ status: string; last_error: string | null; last_sync_at: string | null }[]>(
		request,
		`${BOITE_DRISS}&select=status,last_error,last_sync_at`,
	)
	if (avant === undefined) throw new Error('la boîte de Driss Lemoine est absente du seed')
	await service(request, 'patch', BOITE_DRISS, { status: 'ok', last_error: null, last_sync_at: '2026-10-27T08:00:00Z' })
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/comptes-mail')
		const liste = page.getByTestId('liste-comptes-mail')
		await expect(liste).toContainText('Connectée')
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'comptes-de-messagerie', cibles: [], pleinePage: true })
		await illustrer(page, { chapitre: CHAPITRE, section: BOITES, nom: 'liste-des-boites', cibles: [liste] })
		await page.getByTestId('configurer-compte').first().click()
		const formulaire = page.getByTestId('formulaire-compte-mail')
		await expect(formulaire).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: BOITES, nom: 'configurer-une-boite', cibles: [formulaire] })
	} finally {
		await service(request, 'patch', BOITE_DRISS, avant)
	}
})

test('les adresses d’expédition : la liste et la configuration', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/identites-mail')
	const liste = page.getByTestId('liste-identites-mail')
	await expect(page.getByTestId('ligne-identite-mail').first()).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: ADRESSES, nom: 'liste-des-adresses', cibles: [liste] })
	await page.getByTestId('configurer-identite').first().click()
	const formulaire = page.getByTestId('formulaire-identite-mail')
	await expect(formulaire.getByLabel('Identité par défaut pour cet expéditeur')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: ADRESSES, nom: 'configurer-une-adresse', cibles: [formulaire] })
})

// Le plafond est rendu au seed même quand le test dépasse son délai : son `finally` ne joue alors plus utilement (le
// contexte de requête est fermé), le hook si. Le seed ne plafonne aucune adresse (`daily_quota` nul, migration 0033).
const OBJET_PLAFOND = 'Proposition commerciale — lot 2'
test.afterEach(async ({ request }) => {
	await service(request, 'patch', `mail_outbound_identities?workspace_id=eq.${WORKSPACE_SEED}`, { daily_quota: null })
	await service(request, 'delete', `mail_outbox?subject=eq.${encodeURIComponent(OBJET_PLAFOND)}`)
})

test('une adresse qui a atteint son plafond du jour', async ({ page, request }) => {
	await service(request, 'patch', `mail_outbound_identities?workspace_id=eq.${WORKSPACE_SEED}`, { daily_quota: 0 })
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(AFFAIRE_SOGEXIA)
	await page.getByTestId('envoi-ouvrir').click()
	const formulaire = page.getByTestId('envoi-formulaire')
	// L'adresse proposée d'office : la seule que l'administratrice peut employer dans le seed.
	await page.getByLabel('Destinataires').fill('dsi@sogexia.example')
	await page.getByLabel('Objet').fill(OBJET_PLAFOND)
	await page.getByLabel('Message').fill('Bonjour,\n\nVoici notre proposition pour le lot 2.')
	await page.getByTestId('envoi-valider').click()
	const refus = formulaire.getByRole('alert')
	await expect(refus).toContainText("Cette adresse d'expédition a atteint son plafond du jour.")
	await illustrer(page, { chapitre: CHAPITRE, section: ADRESSES, nom: 'plafond-du-jour', cibles: [page.getByLabel('Expédier depuis'), refus] })
})
