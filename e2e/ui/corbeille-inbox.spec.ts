// @verifies CRM-138 (docs/BACKLOG.md) — tranche T3 : l'inbox à la souris et au clavier — « Marquer comme non lu » libellé
//           près du sommeil, le sommeil dit « message », « Effacer » confirmé dans le flux (annuler, puis effacer), la case
//           « boîte mail » offerte à la titulaire de la boîte et absente pour qui n'en écrit aucune, le dossier « Corbeille »
//           et « Restaurer », les lignes « Message effacé » et « Message restauré » au fil de l'affaire, l'adresse
//           `?corbeille=oui`, et les captures aux quatre paliers
// @verifies docs/SPEC-mail-subsystem.md §29.1, §29.10 (ligne « E2E ui ») ; docs/DESIGN_SYSTEM.md §5.102, §5.13, §5.16 ;
//           docs/SPEC-cards.md §16.14.11 ; décisions 878, 917 et 921 ; CLAUDE.md §15, §16
//
// LES MESSAGES SONT POSÉS PAR LA CLÉ DE SERVICE, comme `mail-sync` les pose : un non classé et un classé dans l'affaire c1,
// chacun présent dans la seule boîte de Camille (l'administratrice). Chaque scénario retire ses messages. CE QUE LA REMISE EN
// ÉTAT NE PEUT PAS DÉFAIRE, et qui est nommé plutôt que tu : les lignes `mail_deleted` et `mail_restored` écrites au fil de
// c1 — `card_events` n'accorde aucune écriture, `service_role` compris (la règle de `outbox.spec.ts`). Les preuves cherchent
// donc la leur, par son objet. L'inbox s'ouvre `courrier=tous` : « Seulement moi » n'est pas le sujet.

import type { APIRequestContext, Page } from '@playwright/test'
import { connecterAvecLeLabs, expect, test } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-138'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const AFFAIRE = '5eed0000-0000-4000-8000-0000000000c1'
const CHEMIN_AFFAIRE = '/tracks/conseil-ia/grands-comptes/cards/' + AFFAIRE
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const MARQUE = 'e2e-crm138-ui'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function boiteDeCamille(request: APIRequestContext): Promise<string> {
	const reponse = await request.get(rest(`mail_inbound_accounts?select=id&owner_id=eq.${CAMILLE}&order=created_at&limit=1`), {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

/** Pose un message reçu, présent dans la boîte de Camille, classé dans c1 ou non. */
async function poser(request: APIRequestContext, objet: string, classe: boolean): Promise<string> {
	const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
	const pose = await request.post(rest('mail_messages?select=id'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			workspace_id: WORKSPACE,
			rfc822_message_id: `<${MARQUE}-${unique}@exemple.test>`,
			card_id: classe ? AFFAIRE : null,
			classification: classe ? 'manual' : 'unclassified',
			direction: 'inbound',
			from_address: 'client@exemple.test',
			from_name: 'Client Exemple',
			subject: objet,
			body_text: 'Preuve CRM-138 T3.',
			received_at: new Date().toISOString(),
		},
	})
	expect(pose.status(), await pose.text()).toBe(201)
	const id = ((await pose.json()) as { id: string }[])[0]!.id
	const occurrence = await request.post(rest('mail_message_occurrences'), {
		headers: enTetesService(),
		data: { message_id: id, account_id: await boiteDeCamille(request), folder: 'INBOX', uid: 990_000 + Math.floor(Math.random() * 9_999) },
	})
	expect(occurrence.status(), await occurrence.text()).toBe(201)
	return id
}

async function etat(request: APIRequestContext, id: string) {
	const reponse = await request.get(rest(`mail_messages?select=deleted_at,deleted_by&id=eq.${id}`), { headers: enTetesService() })
	return ((await reponse.json()) as { deleted_at: string | null; deleted_by: string | null }[])[0]
}

async function deplacements(request: APIRequestContext, id: string): Promise<string[]> {
	const reponse = await request.get(rest(`mail_trash_moves?select=state&message_id=eq.${id}`), { headers: enTetesService() })
	return ((await reponse.json()) as { state: string }[]).map((ligne) => ligne.state)
}

async function ouvrirMessage(page: Page, id: string) {
	// LA DESTINATION `message` (CRM-065) OUVRE LE MESSAGE DANS SON DOSSIER ; elle est retirée de l'adresse aussitôt.
	await page.goto(`/inbox?courrier=tous&message=${id}`)
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
}

test.afterEach(async ({ request }) => {
	await request.delete(rest(`mail_messages?rfc822_message_id=like.${encodeURIComponent(`<${MARQUE}-`)}*`), {
		headers: enTetesService(),
	})
})

test.use({ viewport: { width: 1440, height: 900 } })

test('à la souris : non lu libellé, sommeil en mots, effacer puis annuler, effacer avec la case, Corbeille, Restaurer', async ({
	page,
	request,
}) => {
	const id = await poser(request, 'Demande de devis à effacer', false)
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrirMessage(page, id)

	// LA RANGÉE : le sommeil, puis la lecture, puis « Effacer » — trois boutons libellés (§5.102).
	const rangee = page.getByTestId('inbox-commandes-message')
	// `CRM-141` T4 (docs/DESIGN_SYSTEM.md §5.103) : « Réévaluer les pastilles » et « Pastilles » après la lecture, avant « Effacer ».
	await expect(rangee.getByRole('button')).toHaveText([
		'Mettre le message en sommeil',
		'Marquer comme non lu',
		'Réévaluer les pastilles',
		'Pastilles',
		'Effacer',
	])
	await capturer(page, 'inbox-commandes-xl-1440', UNITE)
	await rangee.getByRole('button', { name: 'Marquer comme non lu' }).click()
	await expect(rangee.getByRole('button', { name: 'Marquer comme lu' })).toBeVisible()
	await rangee.getByRole('button', { name: 'Marquer comme lu' }).click()
	await expect(rangee.getByRole('button', { name: 'Marquer comme non lu' })).toBeVisible()

	// EFFACER PUIS ANNULER : rien ne change en base.
	await rangee.getByRole('button', { name: 'Effacer' }).click()
	const confirmation = page.getByRole('group', { name: 'Effacer ce message' })
	await expect(confirmation).toContainText(/Effacer «\s?Demande de devis à effacer\s?»\s?\?/)
	await expect(confirmation).toContainText("d'où vous pourrez le restaurer pendant 30 jours")
	const caseBoite = confirmation.getByRole('checkbox', { name: /L'effacer aussi dans la boîte mail/ })
	await expect(caseBoite).not.toBeChecked()
	await expect(confirmation.getByRole('button', { name: 'Annuler' })).toBeFocused()
	await capturer(page, 'inbox-effacer-confirmation-xl-1440', UNITE)
	await confirmation.getByRole('button', { name: 'Annuler' }).click()
	await expect(confirmation).toHaveCount(0)
	await expect(rangee.getByRole('button', { name: 'Effacer' })).toBeFocused()
	expect((await etat(request, id))?.deleted_at).toBeNull()

	// EFFACER AVEC LA CASE : le message quitte la liste, le panneau se referme, un déplacement est demandé.
	await rangee.getByRole('button', { name: 'Effacer' }).click()
	await confirmation.getByRole('checkbox', { name: /L'effacer aussi dans la boîte mail/ }).check()
	await confirmation.getByRole('button', { name: 'Effacer' }).click()
	await expect(page.getByTestId('inbox-message-ouvert')).toHaveCount(0)
	await expect(page.getByText('Aucun message ouvert')).toBeVisible()
	await expect(page.getByTestId('inbox-message').filter({ hasText: 'Demande de devis à effacer' })).toHaveCount(0)
	await expect(page.getByRole('status').filter({ hasText: 'Message mis à la corbeille.' })).toHaveCount(1)
	const efface = await etat(request, id)
	expect(efface?.deleted_at).not.toBeNull()
	expect(efface?.deleted_by).toBe(CAMILLE)
	expect((await deplacements(request, id)).length, 'un déplacement par occurrence de sa boîte').toBe(1)

	// LA CORBEILLE : l'entrée, l'adresse, la ligne et son état de déplacement, puis « Restaurer » sans confirmation.
	const entree = page.getByTestId('inbox-corbeille')
	await entree.click()
	await expect(page).toHaveURL(/corbeille=oui/)
	const panneau = page.getByTestId('inbox-panneau-corbeille')
	await expect(panneau).toContainText('Un message reste 30 jours dans la corbeille, puis il est effacé définitivement.')
	await expect(panneau).not.toContainText('Vous voyez les messages que vous avez effacés.')
	const ligne = page.locator(`[data-testid="inbox-corbeille-ligne"][data-message="${id}"]`)
	await expect(ligne).toContainText('Demande de devis à effacer')
	await expect(ligne).toContainText(/Effacé le \d{2}\/\d{2}\/\d{4} par /)
	await expect(ligne).toContainText(/Effacement définitif le \d{2}\/\d{2}\/\d{4}/)
	await expect(ligne.getByTestId('inbox-corbeille-deplacement')).toHaveText(
		/Déplacement en attente|Déplacé dans la corbeille de la boîte/,
	)
	await capturer(page, 'inbox-corbeille-deplacement-xl-1440', UNITE)
	// UN RECHARGEMENT GARDE LE DOSSIER (§5.102 : une désignation de ce qui est montré).
	await page.reload()
	await expect(ligne).toBeVisible()
	await ligne.getByRole('button', { name: 'Restaurer « Demande de devis à effacer »' }).click()
	await expect(ligne).toHaveCount(0)
	await expect(panneau.getByTestId('inbox-corbeille-mention')).toHaveText('Message restauré.')
	expect((await etat(request, id))?.deleted_at).toBeNull()

	// Restauré, il est de nouveau dans « Non classés ».
	await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
	await expect(page).not.toHaveURL(/corbeille=oui/)
	await expect(page.getByTestId('inbox-message').filter({ hasText: 'Demande de devis à effacer' })).toHaveCount(1)
})

test('au clavier, pour qui lit l’affaire sans écrire la boîte : pas de case, Échap, effacer, le fil de l’affaire, restaurer', async ({
	page,
	request,
}) => {
	const id = await poser(request, 'Compte rendu de réunion à effacer', true)
	await connecterAvecLeLabs(page, BIZDEV)
	await ouvrirMessage(page, id)
	await expect(page.getByTestId('inbox-commandes-message').getByRole('button', { name: 'Mettre le message en sommeil' })).toBeVisible()

	const effacer = page.getByTestId('inbox-effacer')
	await effacer.focus()
	await page.keyboard.press('Enter')
	const confirmation = page.getByRole('group', { name: 'Effacer ce message' })
	await expect(confirmation.getByRole('button', { name: 'Annuler' })).toBeFocused()
	// DRISS N'ÉCRIT AUCUNE BOÎTE OÙ LE MESSAGE FIGURE : la case est absente (la capacité rendue par la base, §29.1).
	await expect(confirmation.getByRole('checkbox')).toHaveCount(0)
	await page.keyboard.press('Escape')
	await expect(confirmation).toHaveCount(0)
	await expect(effacer).toBeFocused()

	await page.keyboard.press('Enter')
	await expect(confirmation.getByRole('button', { name: 'Annuler' })).toBeFocused()
	await page.keyboard.press('Tab')
	await expect(page.getByTestId('inbox-effacer-confirmer')).toBeFocused()
	await page.keyboard.press('Enter')
	await expect(page.getByTestId('inbox-message-ouvert')).toHaveCount(0)
	// LE FOCUS NE VA JAMAIS SUR CE QUI DISPARAÎT (§5.13) : une ligne de la liste, ou l'entrée du dossier.
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const actif = document.activeElement
				return actif?.getAttribute('data-testid') ?? (actif?.closest('[data-testid="inbox-panneau-dossiers"]') ? 'dossier' : actif?.tagName)
			}),
		)
		.toMatch(/inbox-message|dossier/)
	expect((await etat(request, id))?.deleted_at).not.toBeNull()
	expect(await deplacements(request, id)).toEqual([])

	// LE FIL DE L'AFFAIRE porte « Message effacé », l'objet et l'acteur.
	await page.goto(CHEMIN_AFFAIRE)
	const ligneEffacee = page.getByText(/Message effacé.*Compte rendu de réunion à effacer/).last()
	await expect(ligneEffacee).toBeVisible()
	await ligneEffacee.scrollIntoViewIfNeeded()
	await capturer(page, 'fil-message-efface-xl-1440', UNITE)

	// LA CORBEILLE AU CLAVIER : la phrase de portée pour qui n'administre pas, puis « Restaurer ».
	await page.goto('/inbox?courrier=tous')
	const entree = page.getByTestId('inbox-corbeille')
	await entree.focus()
	await page.keyboard.press('Enter')
	const panneau = page.getByTestId('inbox-panneau-corbeille')
	await expect(panneau).toContainText('Vous voyez les messages que vous avez effacés.')
	const restaurer = panneau.getByRole('button', { name: 'Restaurer « Compte rendu de réunion à effacer »' })
	await restaurer.focus()
	await page.keyboard.press('Enter')
	await expect(restaurer).toHaveCount(0)
	await expect(panneau.getByTestId('inbox-corbeille-mention')).toHaveText('Message restauré.')
	await expect
		.poll(async () => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
		.toMatch(/inbox-corbeille-ligne|inbox-corbeille-vide/)
	expect((await etat(request, id))?.deleted_at).toBeNull()

	await page.goto(CHEMIN_AFFAIRE)
	await expect(page.getByText(/Message restauré.*Compte rendu de réunion à effacer/).last()).toBeVisible()
})

test.describe('les quatre paliers', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : la rangée, la confirmation et la corbeille tiennent, sans défilement horizontal`, async ({
			page,
			request,
		}) => {
			const id = await poser(
				request,
				'Proposition au très long objet pour vérifier le repli de la confirmation et de la corbeille sur un petit écran',
				false,
			)
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await ouvrirMessage(page, id)
			await page.getByTestId('inbox-effacer').click()
			await expect(page.getByTestId('inbox-effacer-confirmation')).toBeVisible()
			await page.getByTestId('inbox-effacer-confirmation').scrollIntoViewIfNeeded()
			await capturer(page, `inbox-palier-confirmation-${palier.nom}`, UNITE)
			let largeurs = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
			expect(largeurs[0], 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(largeurs[1]!)
			await page.getByTestId('inbox-effacer-confirmer').click()
			await expect(page.getByTestId('inbox-message-ouvert')).toHaveCount(0)

			await page.goto('/inbox?courrier=tous&corbeille=oui')
			// SOUS 1024 PX, LA PILE S'OUVRE SUR LES DOSSIERS : l'entrée mène à la liste.
			if (palier.largeur < 1024) await page.getByTestId('inbox-corbeille').click()
			const ligne = page.locator(`[data-testid="inbox-corbeille-ligne"][data-message="${id}"]`)
			await expect(ligne).toBeVisible()
			await capturer(page, `inbox-palier-corbeille-${palier.nom}`, UNITE)
			largeurs = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
			expect(largeurs[0], 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(largeurs[1]!)
		})
	}
})
