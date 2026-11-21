// @verifies CRM-156 (docs/BACKLOG.md) — tranche T4 : les ajouts de l'inbox sur la vraie pile — le filtre par expéditeur posé
//           depuis le message ouvert et retiré ; le transfert à un membre (le bloc, la ligne du transfert, la notification
//           du destinataire qui ouvre le mail, le retrait par le destinataire) ; le blocage d'un expéditeur au clavier (la
//           double confirmation, le bilan, l'effet en base) et son déblocage dans Réglages ▸ Expéditeurs bloqués ; la
//           création d'un contact depuis un expéditeur inconnu ; les quatre paliers
// @verifies docs/DESIGN_SYSTEM.md §5.109 bis ; docs/SPEC-mail-subsystem.md §32.7 à §32.10 ; docs/SPEC-notifications.md §52 ;
//           docs/JOURNAL.md décisions 945 et 947 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LES MAILS SONT PROPRES À LA PREUVE, NON CLASSÉS, dans la boîte de Camille (l'administratrice), posés par la clé de service ;
// chaque expéditeur porte le suffixe de l'exécution. Tout ce que la preuve écrit — mails, transferts, notifications, blocage,
// contact — est retiré à la fin, par la clé de service.
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.

import { type APIRequestContext, type Page } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-156'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const suffixe = Date.now().toString(36)
const PREFIXE = `<tst-crm156-t4-${suffixe}`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

const TRANSFERT = `transfert-${suffixe}@sonde.test`
const BLOQUE = `bloque-${suffixe}@sonde.test`
const INCONNU = `inconnu-${suffixe}@inconnu-${suffixe}.example`
const objet = (rang: number) => `ZZ 156T4 ${rang} ${suffixe}`

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 1000 } })

const mails: string[] = []

async function poserMail(request: APIRequestContext, boite: string, rang: number, expediteur: string): Promise<string> {
	const reponse = await request.post(rest('mail_messages?select=id'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `${PREFIXE}-${rang}@sonde.test>`,
			classification: 'unclassified',
			from_address: expediteur,
			to_addresses: ['admin@p2enjoy.test'],
			subject: objet(rang),
			body_text: 'Preuve des ajouts de l’inbox.',
			direction: 'inbound',
			received_at: new Date(Date.now() - rang * 60_000).toISOString(),
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const id = ((await reponse.json()) as { id: string }[])[0]!.id
	const occurrence = await request.post(rest('mail_message_occurrences'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { message_id: id, account_id: boite, folder: 'INBOX', uid: 157_000 + rang * 7 + (Date.now() % 1000) },
	})
	expect(occurrence.status(), await occurrence.text()).toBe(201)
	return id
}

test.beforeAll(async ({ request }) => {
	const [boite] = (await (
		await request.get(rest(`mail_inbound_accounts?select=id&owner_id=eq.${CAMILLE}&limit=1`), { headers: enTetesService() })
	).json()) as { id: string }[]
	// 0 : le mail à transférer ; 1 et 2 : l'expéditeur à bloquer ; 3 : l'expéditeur inconnu.
	mails.push(await poserMail(request, boite!.id, 0, TRANSFERT))
	mails.push(await poserMail(request, boite!.id, 1, BLOQUE))
	mails.push(await poserMail(request, boite!.id, 2, BLOQUE))
	mails.push(await poserMail(request, boite!.id, 3, INCONNU))
})

test.afterAll(async ({ request }) => {
	const service = { headers: enTetesService() }
	await request.delete(rest(`notifications?type=eq.mail_transfer&payload->>message_id=in.(${mails.join(',')})`), service)
	await request.delete(rest(`mail_blocked_senders?workspace_id=eq.${ESPACE}&address=eq.${encodeURIComponent(BLOQUE)}`), service)
	await request.delete(rest(`contacts?workspace_id=eq.${ESPACE}&email=eq.${encodeURIComponent(INCONNU)}`), service)
	await request.delete(rest(`mail_messages?rfc822_message_id=like.${encodeURIComponent(`${PREFIXE}*`)}`), service)
})

const liste = (page: Page) => page.getByTestId('inbox-panneau-liste')
const ligne = (page: Page, rang: number) =>
	liste(page).locator('li').filter({ has: page.getByTestId('inbox-message').filter({ hasText: objet(rang) }) })

async function enBase(request: APIRequestContext, chemin: string): Promise<unknown[]> {
	const reponse = await request.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as unknown[]
}

test.describe('le filtre par expéditeur et le transfert (docs/DESIGN_SYSTEM.md §5.109 bis)', () => {
	test('à la souris : filtrer sur l’expéditeur puis retirer le filtre ; transférer à Driss, la ligne du transfert', async ({
		page,
		request,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/p2enjoy/inbox?courrier=tous&message=${mails[0]}`)
		await expect(page.getByTestId('inbox-message-ouvert')).toContainText(objet(0))

		await page.getByTestId('inbox-filtrer-expediteur').click()
		await expect(page).toHaveURL(new RegExp(`expediteur=${encodeURIComponent(TRANSFERT).replace(/\./g, '\\.')}`))
		await expect(page.getByTestId('inbox-filtre-expediteur')).toContainText(TRANSFERT)
		await expect(liste(page).getByTestId('inbox-message')).toHaveCount(1)
		// Un filtre explicite : « Tout sélectionner » existe (§32.3).
		await expect(page.getByTestId('inbox-tout-selectionner')).toBeVisible()
		await capturer(page, 'filtre-expediteur-1440', UNITE)
		await page.getByTestId('inbox-filtre-expediteur-retirer').click()
		await expect(page.getByTestId('inbox-filtre-expediteur')).toHaveCount(0)
		await expect(page).not.toHaveURL(/expediteur=/)

		await page.getByTestId('inbox-transferer').click()
		const bloc = page.getByRole('group', { name: 'Transférer ce message' })
		await expect(bloc).toBeVisible()
		const membre = bloc.getByTestId('inbox-transfert-membre')
		await expect(membre).toBeFocused()
		await expect(membre.locator('option', { hasText: 'Camille Aubert' })).toHaveCount(0)
		await expect(bloc.getByTestId('inbox-transfert-confirmer')).toBeDisabled()
		await membre.selectOption({ label: 'Driss Lemoine' })
		await capturer(page, 'transfert-bloc-1440', UNITE)
		await bloc.getByTestId('inbox-transfert-confirmer').click()
		await expect(bloc).toHaveCount(0)
		await expect(page.getByTestId('inbox-transferts')).toContainText('Transféré à Driss Lemoine par Camille Aubert, le')
		await expect(page.getByTestId('inbox-transfert-retirer')).toHaveAccessibleName('Retirer le transfert à Driss Lemoine')
		await capturer(page, 'transfert-ligne-1440', UNITE)
		expect(await enBase(request, `mail_message_transfers?message_id=eq.${mails[0]}&select=recipient_id,transferred_by`)).toEqual([
			{ recipient_id: DRISS, transferred_by: CAMILLE },
		])
	})

	test('le destinataire : la notification dit le transfert et ouvre le mail ; il retire le transfert reçu', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto('/')
		await page.getByTestId('cloche-notifications').click()
		const panneau = page.getByTestId('panneau-notifications')
		const notification = panneau.getByTestId('notification').filter({ hasText: objet(0) })
		await expect(notification).toContainText('Camille Aubert vous a transféré 1 mail')
		await capturer(page, 'transfert-notification-1440', UNITE)
		await notification.getByRole('link', { name: `Ouvrir le mail ${objet(0)}` }).click()
		await expect(page).toHaveURL(new RegExp(`/inbox\\?message=${mails[0]}`))
		await expect(page.getByTestId('inbox-message-ouvert')).toContainText(objet(0))
		// Driss lit le mail transféré ; il n'édite pas « Transférer » à nouveau vers lui-même, mais il retire ce qu'il a reçu.
		await page.getByRole('button', { name: 'Retirer le transfert à Driss Lemoine' }).click()
		await expect(page.getByTestId('inbox-transferts')).toHaveCount(0)
		expect(await enBase(request, `mail_message_transfers?message_id=eq.${mails[0]}&select=recipient_id`)).toEqual([])
	})
})

test.describe('bloquer un expéditeur et le débloquer (docs/DESIGN_SYSTEM.md §5.109 bis)', () => {
	test('au clavier : la double confirmation, le bilan, le filtre retiré ; Réglages ▸ Expéditeurs bloqués, débloquer', async ({
		page,
		request,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		// Le message ouvert choisit le dossier (les non classés) : sans lui, aucune liste n'est montrée.
		await page.goto(`/p2enjoy/inbox?courrier=tous&expediteur=${encodeURIComponent(BLOQUE)}&message=${mails[1]}`)
		await expect(ligne(page, 1)).toBeVisible()
		const commande = page.getByTestId('inbox-bloquer-expediteur')
		await commande.focus()
		await page.keyboard.press('Enter')
		const bloc = page.getByTestId('inbox-blocage')
		await expect(bloc).toContainText(`Bloquer ${BLOQUE} ?`)
		await expect(page.getByTestId('inbox-blocage-impact')).toContainText('2 mails reçus de cette adresse iront à la corbeille')
		await expect(bloc.getByRole('button', { name: 'Annuler' })).toBeFocused()
		await capturer(page, 'blocage-etape-1-1440', UNITE)
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('inbox-blocage-continuer')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(bloc).toContainText(`Confirmez le blocage de ${BLOQUE}.`)
		await expect(bloc.getByRole('button', { name: 'Annuler' })).toBeFocused()
		await capturer(page, 'blocage-etape-2-1440', UNITE)
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('inbox-blocage-confirmer')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('inbox-bilan-blocage-fait')).toHaveText('Fait : 2 mails mis à la corbeille.')
		await expect(page.getByTestId('inbox-bilan-blocage').getByRole('heading')).toBeFocused()
		await expect(page).not.toHaveURL(/expediteur=/)
		await capturer(page, 'blocage-bilan-1440', UNITE)
		expect(await enBase(request, `mail_messages?id=in.(${mails[1]},${mails[2]})&deleted_at=not.is.null&select=id`)).toHaveLength(2)
		expect(
			await enBase(request, `mail_blocked_senders?workspace_id=eq.${ESPACE}&address=eq.${encodeURIComponent(BLOQUE)}&select=address`),
		).toHaveLength(1)

		// Réglages ▸ Expéditeurs bloqués : l'entrée de l'index, la ligne, « Débloquer » au clavier.
		await page.goto('/p2enjoy/reglages')
		await page.getByTestId('entree-expediteurs-bloques').click()
		const ligneBloquee = page.getByTestId('ligne-expediteur-bloque').filter({ hasText: BLOQUE })
		await expect(ligneBloquee).toContainText('Bloqué par Camille Aubert le')
		await capturer(page, 'reglages-expediteurs-bloques-1440', UNITE)
		await ligneBloquee.getByTestId('debloquer-expediteur').focus()
		await page.keyboard.press('Enter')
		const confirmation = page.getByTestId('confirmation-deblocage')
		await expect(confirmation).toContainText('Ceux qui sont déjà dans la corbeille y restent.')
		await expect(confirmation.getByRole('button', { name: 'Annuler' })).toBeFocused()
		await capturer(page, 'reglages-deblocage-1440', UNITE)
		await page.keyboard.press('Tab')
		await page.keyboard.press('Enter')
		await expect(ligneBloquee).toHaveCount(0)
		expect(
			await enBase(request, `mail_blocked_senders?workspace_id=eq.${ESPACE}&address=eq.${encodeURIComponent(BLOQUE)}&select=address`),
		).toHaveLength(0)
	})
})

test.describe('créer un contact depuis un expéditeur inconnu (docs/DESIGN_SYSTEM.md §5.109 bis)', () => {
	test('cocher le fil, « Créer des contacts », la liste à vérifier, le compte rendu ; le contact naît avec la source `email`', async ({
		page,
		request,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/p2enjoy/inbox?courrier=tous&message=${mails[3]}`)
		await expect(ligne(page, 3)).toBeVisible()
		await ligne(page, 3).getByTestId('inbox-case-fil').check()
		await page.getByTestId('inbox-action-groupee').selectOption('contacts')
		await page.getByTestId('inbox-action-continuer').click()
		const verification = page.getByTestId('inbox-contacts-verifier')
		const ligneContact = verification.getByTestId('inbox-contact-ligne').filter({ hasText: INCONNU })
		await expect(ligneContact).toHaveCount(1)
		await expect(ligneContact.getByRole('checkbox')).toBeChecked()
		await ligneContact.getByTestId('inbox-contact-nom').fill('Ines Inconnue')
		await capturer(page, 'contacts-verifier-1440', UNITE)
		await page.getByTestId('inbox-contacts-creer').click()
		await expect(page.getByTestId('inbox-compte-rendu-fait')).toHaveText('1 contact créé ; 0 ignorés ; 0 refusés.')
		await capturer(page, 'contacts-compte-rendu-1440', UNITE)
		expect(
			await enBase(request, `contacts?workspace_id=eq.${ESPACE}&email=eq.${encodeURIComponent(INCONNU)}&select=full_name,source`),
		).toEqual([{ full_name: 'Ines Inconnue', source: 'email' }])
	})
})

test.describe('les quatre paliers (docs/DESIGN_SYSTEM.md §5.109 bis, §7)', () => {
	test('le bloc du transfert et la double confirmation du blocage se replient ; aucun défilement horizontal', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`/p2enjoy/inbox?courrier=tous&message=${mails[0]}`)
			await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
			await page.getByTestId('inbox-transferer').click()
			const bloc = page.getByTestId('inbox-transfert-bloc')
			await expect(bloc).toBeVisible()
			await bloc.scrollIntoViewIfNeeded()
			const cadre = await bloc.boundingBox()
			expect(cadre !== null && cadre.x >= 0 && cadre.x + cadre.width <= palier.largeur + 0.5, `bloc tenu à ${palier.largeur} px`).toBe(
				true,
			)
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
				`aucun défilement horizontal à ${palier.largeur} px`,
			).toBeLessThanOrEqual(0)
			await capturer(page, `transfert-bloc-${palier.nom}`, UNITE)

			await page.goto(`/p2enjoy/inbox?courrier=tous&expediteur=${encodeURIComponent(TRANSFERT)}&message=${mails[0]}`)
			await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
			const retour = page.getByRole('button', { name: 'Retour aux messages' })
			if (await retour.isVisible()) await retour.click()
			await page.getByTestId('inbox-bloquer-expediteur').click()
			await expect(page.getByTestId('inbox-blocage-impact')).toBeVisible()
			for (const element of [page.getByTestId('inbox-rangee-action'), page.getByTestId('inbox-blocage')]) {
				const boite = await element.boundingBox()
				expect(boite !== null && boite.x >= 0 && boite.x + boite.width <= palier.largeur + 0.5, `cadre tenu à ${palier.largeur} px`).toBe(
					true,
				)
			}
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
			).toBeLessThanOrEqual(0)
			await capturer(page, `blocage-etape-1-${palier.nom}`, UNITE)
			// On ne bloque pas : « Annuler » referme sans rien écrire.
			await page.getByTestId('inbox-blocage').getByRole('button', { name: 'Annuler' }).click()
			await expect(page.getByTestId('inbox-blocage')).toHaveCount(0)
		}
	})
})
