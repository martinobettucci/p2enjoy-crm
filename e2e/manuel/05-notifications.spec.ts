// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.1 : les images du chapitre 5, « Vos notifications »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 5 ; docs/SPEC-notifications.md §26 (la cloche, le
//       panneau, le marquage), §42 (les préférences)
//
// Les notifications montrées sont celles du seed : Driss Lemoine en porte une, de Camille Aubert, non lue. Trois états
// demandent un geste, et chacun est défait dans le même scénario :
// - la cloche qui n'a pas pu compter s'annonce « Notifications » : son compte est COUPÉ au niveau du réseau ;
// - « Aucune notification n'a été modifiée » : la notification change de destinataire, par la clé de service, entre
//   l'ouverture du panneau et le geste — le cas même que le manuel décrit — puis lui est rendue ;
// - « Enregistré » : la case des mentions est décochée, puis recochée.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, BIZDEV, connecterAvecLeLabs, immobile, lireService, service } from './outils'

const CHAPITRE = 'vos-notifications-savoir-qu-on-vous-a-nomme'

test('la cloche dans l’en-tête, et la cloche qui n’a pas pu compter', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/')
	const cloche = page.getByTestId('cloche-notifications')
	await expect(page.getByTestId('compteur-notifications')).toHaveText('1')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: null,
		nom: 'cloche',
		cibles: [page.getByTestId('bouton-aide'), cloche, page.getByRole('button', { name: 'Se déconnecter' })],
	})

	await page.route('**/rest/v1/notifications?*', async (route) => {
		const requete = route.request()
		if (/count=exact/.test(requete.headers()['prefer'] ?? '')) return route.abort('connectionrefused')
		return route.continue()
	})
	await page.reload()
	await expect(cloche).toHaveAccessibleName('Notifications', { timeout: 30_000 })
	await illustrer(page, { chapitre: CHAPITRE, section: 'ce-que-la-cloche-annonce', nom: 'cloche-sans-compte', cibles: [cloche] })
})

test('le panneau, et un marquage resté sans effet', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/')
	await page.getByTestId('cloche-notifications').click()
	const panneau = page.getByTestId('panneau-notifications')
	await expect(page.getByTestId('notification').first()).toContainText('Camille Aubert vous a mentionné')
	await immobile(page, 'panneau-notifications')
	await illustrer(page, { chapitre: CHAPITRE, section: 'ce-que-le-panneau-montre', nom: 'panneau', cibles: [panneau] })

	const [driss] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent('Driss Lemoine')}&select=id`)
	const [farida] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent('Farida Nowak')}&select=id`)
	const [notification] = await lireService<{ id: string }[]>(request, `notifications?recipient_id=eq.${driss?.id}&select=id`)
	if (driss === undefined || farida === undefined || notification === undefined) throw new Error('le seed des notifications est absent')
	await service(request, 'patch', `notifications?id=eq.${notification.id}`, { recipient_id: farida.id })
	try {
		await page.getByRole('button', { name: 'Marquer comme lue' }).first().click()
		const message = page.getByTestId('message-marquage')
		await expect(message).toContainText('Aucune notification n’a été modifiée')
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'marquer-lu-et-marquer-non-lu',
			nom: 'marquage-sans-effet',
			cibles: [panneau],
		})
	} finally {
		await service(request, 'patch', `notifications?id=eq.${notification.id}`, { recipient_id: driss.id, read_at: null })
	}
})

test('« Mentionner », sous le fil d’une affaire', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(AFFAIRE_SOGEXIA)
	const commande = page.getByRole('button', { name: /^Mentionner/ })
	await expect(commande).toBeVisible()
	await commande.click()
	const personne = page.getByRole('checkbox', { name: 'Driss Lemoine' })
	await expect(personne).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'mentionner-quelqu-un-dans-un-commentaire', nom: 'mentionner', cibles: [commande, personne.locator('xpath=ancestor::*[self::fieldset or self::ul][1]')] })
})

test('choisir ce que vous recevez', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/reglages/notifications')
	const laCase = page.getByRole('checkbox', { name: /Recevoir les mentions/ })
	await expect(laCase).toBeChecked()
	await laCase.click()
	await expect(laCase).not.toBeChecked()
	const confirmation = page.getByText('Enregistré', { exact: true })
	await expect(confirmation).toBeVisible()
	try {
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'choisir-ce-que-vous-recevez',
			nom: 'recevoir-les-mentions',
			cibles: [page.getByRole('heading', { name: 'Notifications', level: 2 }), laCase, confirmation, page.getByRole('group', { name: 'Par email' })],
		})
	} finally {
		await laCase.click()
		await expect(laCase).toBeChecked()
	}
})
