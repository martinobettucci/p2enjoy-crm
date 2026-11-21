// @spec CRM-156 (docs/BACKLOG.md) — tranche T5 : le chapitre 5 révisé (décision 51) — la cloche de Driss compte aussi le
//       transfert du seed §49, la mention est nommée dans le panneau ; « recevoir-les-mentions » montre la case des
//       transferts (docs/manual.md §5.2, §5.6 ; docs/SPEC-seed.md §49)
// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.1 : les images du chapitre 5, « Vos notifications »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 5 ; docs/SPEC-notifications.md §26 (la cloche, le
//       panneau, le marquage), §42 (les préférences)
// @spec CRM-153 (docs/BACKLOG.md) — tranche T6 : l'image d'une mention dans le fil d'une organisation, que Camille Aubert
//       reçoit de Driss Lemoine (docs/manual.md §5.2 ; docs/SPEC-organisations.md §9.2 ; docs/SPEC-seed.md §50)
//
// Les notifications montrées sont celles du seed : Driss Lemoine en porte deux, non lues — la mention de Camille Aubert, et
// le transfert d'un mail (seed §49, `CRM-156` T5). Trois états
// demandent un geste, et chacun est défait dans le même scénario :
// - la cloche qui n'a pas pu compter s'annonce « Notifications » : son compte est COUPÉ au niveau du réseau ;
// - « Aucune notification n'a été modifiée » : la notification change de destinataire, par la clé de service, entre
//   l'ouverture du panneau et le geste — le cas même que le manuel décrit — puis lui est rendue ;
// - « Enregistré » : la case des mentions est décochée, puis recochée.
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, BIZDEV, connecterAvecLeLabs, immobile, lireService, service } from './outils'

const CHAPITRE = 'vos-notifications-savoir-qu-on-vous-a-nomme'

test('la cloche dans l’en-tête, et la cloche qui n’a pas pu compter', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/')
	const cloche = page.getByTestId('cloche-notifications')
	// `CRM-156` T5 (décision 51) : Driss porte deux non-lues — sa mention, et le transfert du seed §49.
	await expect(page.getByTestId('compteur-notifications')).toHaveText('2')
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
	// `CRM-156` T5 : la mention est nommée — le transfert du seed §49, plus récent, est en tête du panneau.
	const mention = page.getByTestId('notification').filter({ hasText: 'Camille Aubert vous a mentionné' })
	await expect(mention).toBeVisible()
	await immobile(page, 'panneau-notifications')
	await illustrer(page, { chapitre: CHAPITRE, section: 'ce-que-le-panneau-montre', nom: 'panneau', cibles: [panneau] })

	const [driss] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent('Driss Lemoine')}&select=id`)
	const [farida] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent('Farida Nowak')}&select=id`)
	const [notification] = await lireService<{ id: string }[]>(request, `notifications?recipient_id=eq.${driss?.id}&type=eq.mention&select=id`)
	if (driss === undefined || farida === undefined || notification === undefined) throw new Error('le seed des notifications est absent')
	await service(request, 'patch', `notifications?id=eq.${notification.id}`, { recipient_id: farida.id })
	try {
		await mention.getByRole('button', { name: 'Marquer comme lue' }).click()
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

test('choisir ce que vous recevez', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/p2enjoy/reglages/notifications')
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
		// *Révisé par la campagne de livraison du 2026-11-03 (INC-342)* : recocher écrit une préférence `in_app = true`, que le
		// seed ne porte pas ; elle faisait rougir `supabase/tests/0064_preferences_notifications.test.sql`. La clé de service
		// rend l'état du seed — aucune ligne.
		await service(request, 'delete', 'notification_preferences?profile_id=eq.5eed0000-0000-4000-8000-000000000012&type=eq.mention')
	}
})

test('une mention dans le fil d’une organisation', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/')
	await page.getByTestId('cloche-notifications').click()
	const ligne = page.getByTestId('notification').filter({ hasText: 'à propos de Vertigo Conseil' })
	await expect(ligne).toContainText('Driss Lemoine vous a mentionné à propos de Vertigo Conseil')
	await immobile(page, 'panneau-notifications')
	await illustrer(page, { chapitre: CHAPITRE, section: 'ce-que-le-panneau-montre', nom: 'mention-organisation', cibles: [ligne] })
})
