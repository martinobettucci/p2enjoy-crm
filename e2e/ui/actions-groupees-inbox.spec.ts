// @verifies CRM-156 (docs/BACKLOG.md) — tranche T3 : la sélection et les actions groupées de l'inbox sur la vraie pile — cocher
//           des fils, la barre et son compte, une action confirmée et son compte rendu (l'effet relu en base), « Tout
//           sélectionner » sous un filtre explicite et son absence sans filtre, la suppression groupée puis la restauration
//           groupée depuis la corbeille, au clavier, et les quatre paliers
// @verifies docs/DESIGN_SYSTEM.md §5.109 ; docs/SPEC-mail-subsystem.md §32.2 à §32.6 ; docs/JOURNAL.md décisions 944, 946 et
//           949 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LES MAILS SONT PROPRES À LA PREUVE, NON CLASSÉS, dans la boîte de Camille (l'administratrice), posés par la clé de service
// et retirés à la fin par préfixe : un mail classé qu'on supprime ou restaure écrirait au journal immuable d'une affaire du
// seed. Leur pastille est posée par `set_message_label` sous le jeton de Camille (le vrai geste), et c'est une pastille
// qu'aucun mail non classé du seed ne porte : « tout le filtre » ne désigne alors que les mails de la preuve.
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.

import { type APIRequestContext, type Page } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-156'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const suffixe = Date.now().toString(36)
const PREFIXE = `<tst-crm156-ui-${suffixe}`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 1000 } })

const mails: string[] = []
let pastille = { id: '', nom: '' }

async function poserMail(request: APIRequestContext, boite: string, rang: number): Promise<string> {
	const reponse = await request.post(rest('mail_messages?select=id'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `${PREFIXE}-${rang}@sonde.test>`,
			classification: 'unclassified',
			from_address: `sonde-${suffixe}@sonde.test`,
			to_addresses: ['admin@p2enjoy.test'],
			subject: `ZZ 156 ${rang} ${suffixe}`,
			body_text: 'Preuve des actions groupées.',
			direction: 'inbound',
			received_at: new Date(Date.now() - rang * 60_000).toISOString(),
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const id = ((await reponse.json()) as { id: string }[])[0]!.id
	const occurrence = await request.post(rest('mail_message_occurrences'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { message_id: id, account_id: boite, folder: 'INBOX', uid: 156_500 + rang + (Date.now() % 1000) },
	})
	expect(occurrence.status(), await occurrence.text()).toBe(201)
	return id
}

test.beforeAll(async ({ request }) => {
	const [boite] = (await (
		await request.get(rest(`mail_inbound_accounts?select=id&owner_id=eq.${CAMILLE}&limit=1`), { headers: enTetesService() })
	).json()) as { id: string }[]
	// UNE PASTILLE ACTIVE QU'AUCUN MAIL NON CLASSÉ HORS CORBEILLE NE PORTE : « tout le filtre » ne désigne que la preuve.
	const labels = (await (
		await request.get(rest(`mail_labels?workspace_id=eq.${ESPACE}&archived_at=is.null&select=id,name&order=name`), {
			headers: enTetesService(),
		})
	).json()) as { id: string; name: string }[]
	const portees = (await (
		await request.get(
			rest('mail_message_labels?applied=is.true&select=label_id,mail_messages!inner(card_id,deleted_at)&mail_messages.card_id=is.null&mail_messages.deleted_at=is.null'),
			{ headers: enTetesService() },
		)
	).json()) as { label_id: string }[]
	const prises = new Set(portees.map((p) => p.label_id))
	const libre = labels.find((l) => !prises.has(l.id))
	expect(libre, 'une pastille libre parmi les non classés').toBeDefined()
	pastille = { id: libre!.id, nom: libre!.name }
	for (let rang = 0; rang < 3; rang += 1) mails.push(await poserMail(request, boite!.id, rang))
	const camille = await jetonDe('admin@p2enjoy.test')
	for (const id of mails.slice(0, 2)) {
		const pose = await request.post(rest('rpc/set_message_label'), {
			headers: { ...enTetesAuthentifies(camille), 'Content-Type': 'application/json' },
			data: { p_message_id: id, p_label_id: pastille.id, p_applied: true },
		})
		expect(pose.status(), await pose.text()).toBe(204)
	}
})

test.afterAll(async ({ request }) => {
	await request.delete(rest(`mail_messages?rfc822_message_id=like.${encodeURIComponent(`${PREFIXE}*`)}`), {
		headers: enTetesService(),
	})
})

const liste = (page: Page) => page.getByTestId('inbox-panneau-liste')
const ligne = (page: Page, rang: number) =>
	liste(page).locator('li').filter({ has: page.getByTestId('inbox-message').filter({ hasText: `ZZ 156 ${rang} ${suffixe}` }) })
const caseDe = (page: Page, rang: number) => ligne(page, rang).getByTestId('inbox-case-fil')

/** Les lectures de Camille parmi les mails donnés — ouvrir l'inbox sur un message marque son fil lu (§18 bis.2). */
async function lectures(request: APIRequestContext, ids: readonly string[]): Promise<number> {
	const reponse = await request.get(rest(`mail_message_reads?user_id=eq.${CAMILLE}&message_id=in.(${ids.join(',')})&select=message_id`), {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as unknown[]).length
}

test.describe('la sélection et les actions groupées (docs/DESIGN_SYSTEM.md §5.109)', () => {
	test('à la souris : cocher deux fils, marquer comme lus, la confirmation dit les nombres, le compte rendu dit le fait', async ({
		page,
		request,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/p2enjoy/inbox?courrier=tous&message=${mails[2]}`)
		await expect(ligne(page, 2)).toBeVisible()
		// Sans filtre explicite, « Tout sélectionner » n'existe pas (§32.3).
		await expect(page.getByTestId('inbox-tout-selectionner')).toHaveCount(0)
		await caseDe(page, 0).check()
		await caseDe(page, 1).check()
		await expect(page.getByTestId('inbox-selection-compte')).toHaveText('2 fils sélectionnés')
		// Cocher n'ouvre pas le fil.
		await expect(ligne(page, 0).getByTestId('inbox-message')).not.toHaveAttribute('aria-current', 'true')
		await capturer(page, 'selection-barre-1440', UNITE)
		await page.getByTestId('inbox-action-groupee').selectOption('mark_read')
		await page.getByTestId('inbox-action-continuer').click()
		const bloc = page.getByTestId('inbox-confirmation-groupee')
		await expect(bloc).toContainText('Marquer comme lus 2 fils (2 messages) ?')
		await capturer(page, 'selection-confirmation-1440', UNITE)
		await page.getByTestId('inbox-groupe-confirmer').click()
		await expect(page.getByTestId('inbox-compte-rendu-fait')).toHaveText('Fait : 2 messages.')
		await expect(page.getByTestId('inbox-selection-compte')).toHaveCount(0)
		expect(await lectures(request, mails.slice(0, 2))).toBe(2)
		await capturer(page, 'selection-compte-rendu-1440', UNITE)
	})

	test('sous un filtre explicite, « Tout sélectionner » prend tout le filtre ; supprimer ici, puis restaurer depuis la corbeille', async ({
		page,
		request,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/p2enjoy/inbox?courrier=tous&message=${mails[2]}&pastille=${pastille.id}`)
		await expect(ligne(page, 0)).toBeVisible()
		await page.getByTestId('inbox-tout-selectionner').click()
		await expect(page.getByTestId('inbox-selection-compte')).toHaveText('Tout le filtre : 2 fils (2 messages)')
		await expect(caseDe(page, 0)).toBeChecked()
		await page.getByTestId('inbox-action-groupee').selectOption('delete_here')
		await page.getByTestId('inbox-action-continuer').click()
		const bloc = page.getByTestId('inbox-confirmation-groupee')
		await expect(bloc).toContainText('Supprimer 2 fils (2 messages) ici ?')
		await expect(bloc.getByRole('checkbox')).toHaveCount(0)
		await capturer(page, 'selection-tout-supprimer-1440', UNITE)
		await page.getByTestId('inbox-groupe-confirmer').click()
		await expect(page.getByTestId('inbox-compte-rendu-fait')).toHaveText('Fait : 2 messages.')
		const effaces = (await (
			await request.get(rest(`mail_messages?id=in.(${mails.slice(0, 2).join(',')})&deleted_at=not.is.null&select=id`), {
				headers: enTetesService(),
			})
		).json()) as unknown[]
		expect(effaces).toHaveLength(2)

		// La corbeille : une case par message, « Restaurer » direct.
		await page.goto('/p2enjoy/inbox?corbeille=oui')
		const corbeille = page.getByTestId('inbox-corbeille-liste')
		for (const rang of [0, 1]) {
			await corbeille
				.getByTestId('inbox-corbeille-ligne')
				.filter({ hasText: `ZZ 156 ${rang} ${suffixe}` })
				.getByTestId('inbox-case-fil')
				.check()
		}
		await expect(page.getByTestId('inbox-selection-compte')).toHaveText('2 messages sélectionnés')
		await capturer(page, 'corbeille-selection-1440', UNITE)
		await page.getByTestId('inbox-corbeille-restaurer-selection').click()
		await expect(page.getByTestId('inbox-confirmation-groupee')).toContainText('Restaurer')
		await page.getByTestId('inbox-groupe-confirmer').click()
		await expect(page.getByTestId('inbox-compte-rendu-fait')).toHaveText('Fait : 2 messages.')
		const restaures = (await (
			await request.get(rest(`mail_messages?id=in.(${mails.slice(0, 2).join(',')})&deleted_at=is.null&select=id`), {
				headers: enTetesService(),
			})
		).json()) as unknown[]
		expect(restaures).toHaveLength(2)
	})

	test('au clavier : Tab jusqu’à la case, Espace ; l’action au clavier, Échap rend le focus au select ; Entrée confirme', async ({
		page,
		request,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/p2enjoy/inbox?courrier=tous&message=${mails[2]}`)
		await expect(ligne(page, 2)).toBeVisible()
		await caseDe(page, 2).focus()
		await page.keyboard.press('Space')
		await expect(caseDe(page, 2)).toBeChecked()
		const select = page.getByTestId('inbox-action-groupee')
		await select.focus()
		await select.selectOption('mark_unread')
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('inbox-action-continuer')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('inbox-confirmation-groupee')).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('inbox-confirmation-groupee')).toHaveCount(0)
		await expect(select).toBeFocused()
		await page.keyboard.press('Tab')
		await page.keyboard.press('Enter')
		const confirmer = page.getByTestId('inbox-groupe-confirmer')
		await expect(confirmer).toBeEnabled()
		await confirmer.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('inbox-compte-rendu-fait')).toHaveText('Fait : 1 message.')
		// Le titre du compte rendu prend le focus : la barre qui portait la commande a disparu (§5.13).
		await expect(page.getByTestId('inbox-compte-rendu').getByRole('heading')).toBeFocused()
		expect(await lectures(request, [mails[2]!]), 'le fil coché est repassé non lu').toBe(0)
	})

	test('les quatre paliers : la barre et la confirmation se replient, la page ne défile jamais horizontalement', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`/p2enjoy/inbox?courrier=tous&message=${mails[2]}&pastille=${pastille.id}`)
			await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
			// Sous 1024 px, l'inbox est une pile : on remonte du message à la liste.
			const retour = page.getByRole('button', { name: 'Retour aux messages' })
			if (await retour.isVisible()) await retour.click()
			await page.getByTestId('inbox-tout-selectionner').click()
			await expect(page.getByTestId('inbox-selection-compte')).toHaveText('Tout le filtre : 2 fils (2 messages)')
			await page.getByTestId('inbox-action-groupee').selectOption('delete_everywhere')
			await page.getByTestId('inbox-action-continuer').click()
			await expect(page.getByTestId('inbox-confirmation-groupee')).toContainText('partout ?')
			for (const element of [page.getByTestId('inbox-rangee-action'), page.getByTestId('inbox-confirmation-groupee')]) {
				const boite = await element.boundingBox()
				expect(boite !== null && boite.x >= 0 && boite.x + boite.width <= palier.largeur + 0.5, `cadre tenu à ${palier.largeur} px`).toBe(
					true,
				)
			}
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await capturer(page, `selection-confirmation-${palier.nom}`, UNITE)
		}
	})
})
