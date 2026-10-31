// @spec CRM-073 (docs/BACKLOG.md) — tranche T3 : les images du chapitre 34, « Les webhooks : prévenir vos autres outils »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 34 ; docs/DESIGN_SYSTEM.md §5.79 ; docs/SPEC-seed.md §34
//       (les trois webhooks semés et leurs remises)
//
// Les webhooks jetables du scénario portent le préfixe `tst-crm073` et sont retirés après chaque test. L'échec d'une remise
// — cinq essais épuisés — ne se rencontre qu'après deux heures et demie de refus réels : le scénario le POSE sur la remise
// en attente d'« Ancienne intégration », par la clé de service, comme `13-etat-messagerie.spec.ts` pose ses incidents, et
// lui rend ensuite l'état exact qu'il lui avait lu.

import { expect, test, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, connecterAvecLeLabs, lireService, service } from './outils'

const CHAPITRE = 'les-webhooks-prevenir-vos-autres-outils'
const ECRAN = '/reglages/webhooks'
const ANCIENNE = `webhook_deliveries?endpoint_id=in.(${'{{id}}'})`

type Remise = { id: string; status: string; attempts: number; next_attempt_at: string | null; last_status_code: number | null }

async function remiseAncienne(request: import('@playwright/test').APIRequestContext): Promise<Remise> {
	const [webhook] = await lireService<{ id: string }[]>(request, `webhook_endpoints?select=id&name=eq.${encodeURIComponent('Ancienne intégration')}`)
	if (webhook === undefined) throw new Error('le webhook « Ancienne intégration » est absent du seed')
	const [remise] = await lireService<Remise[]>(
		request,
		`${ANCIENNE.replace('{{id}}', webhook.id)}&select=id,status,attempts,next_attempt_at,last_status_code&order=created_at&limit=1`,
	)
	if (remise === undefined) throw new Error('la remise d’« Ancienne intégration » est absente du seed')
	return remise
}

async function ouvrir(page: Page) {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(ECRAN)
	await expect(page.getByTestId('ligne-webhook')).toHaveCount(3)
}

const ligne = (page: Page, nom: string) => page.getByTestId('ligne-webhook').filter({ hasText: nom })

test.afterEach(async ({ request }) => {
	await service(request, 'delete', `webhook_endpoints?name=like.${encodeURIComponent('tst-crm073*')}`)
})

test('l’écran et ses lignes, dont une remise en échec', async ({ page, request }) => {
	const avant = await remiseAncienne(request)
	try {
		await ouvrir(page)
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'ecran-webhooks', cibles: [], pleinePage: true })
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'lignes-de-la-liste', cibles: [page.getByTestId('liste-webhooks')] })
		await service(request, 'patch', `webhook_deliveries?id=eq.${avant.id}`, { status: 'failed', attempts: 5, next_attempt_at: null })
		await page.reload()
		await expect(ligne(page, 'Ancienne intégration')).toContainText('Remise en échec')
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'derniere-remise-en-echec', cibles: [ligne(page, 'Ancienne intégration')] })
	} finally {
		await service(request, 'patch', `webhook_deliveries?id=eq.${avant.id}`, {
			status: avant.status,
			attempts: avant.attempts,
			next_attempt_at: avant.next_attempt_at,
		})
	}
})

test('créer un webhook : la commande, la fiche, les contacts éteints, le refus d’une adresse', async ({ page }) => {
	await ouvrir(page)
	const section = 'creer-un-webhook'
	await illustrer(page, { chapitre: CHAPITRE, section, nom: 'nouveau-webhook', cibles: [page.getByTestId('nouveau-webhook')] })
	await page.getByTestId('nouveau-webhook').click()
	// La fiche entière doit tenir dans la fenêtre pour être découpée.
	await page.setViewportSize({ width: 1440, height: 1300 })
	const fiche = page.getByTestId('fiche-webhook')
	await fiche.getByLabel('Nom').fill('tst-crm073 Automate de relance')
	await fiche.getByLabel('Adresse').fill('https://automate.example/crm')
	await fiche.getByLabel('Affaire créée').check()
	await fiche.getByLabel('Étape changée').check()
	await illustrer(page, { chapitre: CHAPITRE, section, nom: 'fiche-webhook', cibles: [fiche] })
	await fiche.getByLabel('Channel').selectOption({ label: 'Studio web — Refonte de site' })
	await expect(fiche.getByTestId('webhook-contacts-eteints')).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section,
		nom: 'contacts-eteints',
		// Le libellé du champ, et le groupe des événements entier : sa dernière phrase ne doit pas être coupée par la découpe.
		cibles: [fiche.getByText('Channel', { exact: true }), fiche.getByRole('group', { name: 'Événements' })],
	})
	await fiche.getByLabel('Adresse').fill('http://automate.example/crm')
	await fiche.getByTestId('webhook-enregistrer').click()
	await expect(fiche.getByTestId('refus-webhook')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section, nom: 'refus-adresse', cibles: [fiche.getByLabel('Adresse'), fiche.getByTestId('refus-webhook')] })
})

test('le secret de signature, et sa régénération', async ({ page }) => {
	await ouvrir(page)
	const section = 'le-secret-de-signature'
	await page.getByTestId('nouveau-webhook').click()
	const fiche = page.getByTestId('fiche-webhook')
	await fiche.getByLabel('Nom').fill('tst-crm073 Comptabilité')
	await fiche.getByLabel('Adresse').fill('https://compta.example/webhooks/crm')
	await fiche.getByLabel('Affaire créée').check()
	await fiche.getByTestId('webhook-enregistrer').click()
	const bloc = page.getByTestId('bloc-secret')
	await expect(page.getByTestId('webhook-secret')).toHaveValue(/^whsec_/)
	await illustrer(page, { chapitre: CHAPITRE, section, nom: 'secret-de-signature', cibles: [bloc] })
	await page.getByTestId('webhook-secret-fermer').click()
	await ligne(page, 'tst-crm073 Comptabilité').getByRole('button', { name: /Régénérer le secret/ }).click()
	const confirmation = page.getByTestId('confirmation-rotation')
	await illustrer(page, { chapitre: CHAPITRE, section, nom: 'regenerer-le-secret', cibles: [confirmation] })
})

test('l’historique des remises : réussies, en attente, échouée, et le corps d’une remise', async ({ page, request }) => {
	const avant = await remiseAncienne(request)
	const section = 'l-historique-des-remises'
	try {
		await ouvrir(page)
		await page.setViewportSize({ width: 1440, height: 1300 })
		await page.getByRole('button', { name: 'Historique des remises de Tableur commercial' }).click()
		const historique = page.getByTestId('historique-webhook')
		await expect(historique.getByTestId('ligne-remise').first()).toBeVisible()
		await illustrer(page, {
			chapitre: CHAPITRE,
			section,
			nom: 'historique-des-remises',
			cibles: [ligne(page, 'Tableur commercial'), historique],
		})
		const derniere = historique.getByTestId('ligne-remise').last()
		await derniere.getByRole('button', { name: /Voir le corps/ }).click()
		await illustrer(page, { chapitre: CHAPITRE, section, nom: 'corps-d-une-remise', cibles: [derniere, historique.getByTestId('corps-remise')] })
		await historique.getByRole('button', { name: 'Fermer l’historique' }).click()

		await page.getByRole('button', { name: 'Historique des remises de Ancienne intégration' }).click()
		const enAttente = page.getByTestId('historique-webhook').getByTestId('ligne-remise').first()
		await expect(enAttente).toContainText('En attente')
		await illustrer(page, { chapitre: CHAPITRE, section, nom: 'remise-en-attente', cibles: [enAttente] })

		await service(request, 'patch', `webhook_deliveries?id=eq.${avant.id}`, { status: 'failed', attempts: 5, next_attempt_at: null })
		await page.reload()
		await page.getByRole('button', { name: 'Historique des remises de Ancienne intégration' }).click()
		const echouee = page.getByTestId('historique-webhook').getByTestId('ligne-remise').first()
		await expect(echouee).toContainText('Échouée')
		await illustrer(page, { chapitre: CHAPITRE, section, nom: 'remise-echouee', cibles: [echouee] })
	} finally {
		await service(request, 'patch', `webhook_deliveries?id=eq.${avant.id}`, {
			status: avant.status,
			attempts: avant.attempts,
			next_attempt_at: avant.next_attempt_at,
		})
	}
})

test('modifier, désactiver, supprimer : les commandes d’une ligne et la confirmation', async ({ page }) => {
	await ouvrir(page)
	const section = 'modifier-desactiver-supprimer'
	await illustrer(page, { chapitre: CHAPITRE, section, nom: 'commandes-d-une-ligne', cibles: [ligne(page, 'Tableur commercial')] })
	await page.getByTestId('nouveau-webhook').click()
	const fiche = page.getByTestId('fiche-webhook')
	await fiche.getByLabel('Nom').fill('tst-crm073 Ancien tableur')
	await fiche.getByLabel('Adresse').fill('https://tableur.example/hook')
	await fiche.getByLabel('Affaire créée').check()
	await fiche.getByTestId('webhook-enregistrer').click()
	await page.getByTestId('webhook-secret-fermer').click()
	await ligne(page, 'tst-crm073 Ancien tableur').getByRole('button', { name: /Supprimer le webhook/ }).click()
	const confirmation = page.getByTestId('confirmation-suppression')
	await illustrer(page, { chapitre: CHAPITRE, section, nom: 'supprimer-le-webhook', cibles: [confirmation] })
})
