// @verifies CRM-055 (docs/BACKLOG.md) — classement manuel et ses refus
// @verifies docs/SPEC-mail-subsystem.md §16.3 (droit d'écriture exigé, idempotence)
// @verifies docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10
//
// Le scénario crée ses propres messages avec la clé de service et les retire : le seed n'est
// jamais touché.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
// Card d'un channel que le `viewer` NE PEUT PAS écrire — c'est ce qui rend son refus mesurable.
const CARD = '5eed0000-0000-4000-8000-0000000000c1'

async function creerMessage(
	request: import('@playwright/test').APIRequestContext,
	identifiant: string,
): Promise<string> {
	const reponse = await request.post(`${URL_API}/rest/v1/mail_messages`, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			workspace_id: WORKSPACE,
			rfc822_message_id: identifiant,
			from_address: 'client@exterieur.test',
			subject: 'Message de preuve',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [ligne] = (await reponse.json()) as { id: string }[]
	return ligne!.id
}

test.describe('classement manuel — ce que la pile consent', () => {
	test('classer exige le droit d’ÉCRITURE, non celui de lecture', async ({ request }) => {
		const identifiant = `<classe-${Date.now()}@preuves.test>`
		const message = await creerMessage(request, identifiant)

		try {
			const jetonViewer = await jetonDe('viewer@p2enjoy.test')
			const refus = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
				headers: enTetesAuthentifies(jetonViewer),
				data: { p_message_id: message, p_card_id: CARD },
			})
			expect(refus.status()).toBe(403)
			expect(await refus.text()).toContain('forbidden')

			const anonyme = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
				headers: enTetesAnonymes(),
				data: { p_message_id: message, p_card_id: CARD },
			})
			expect([401, 403]).toContain(anonyme.status())

			// La ligne est relue : un refus ne doit RIEN avoir écrit.
			const apres = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=classification,card_id`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await apres.json()) as { classification: string; card_id: null }[]
			expect(ligne?.classification).toBe('unclassified')
			expect(ligne?.card_id).toBeNull()
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
				headers: enTetesService(),
			})
		}
	})

	test('un message classé devient lisible par qui lit la card, et il ne l’était pas avant', async ({
		request,
	}) => {
		const identifiant = `<lisible-${Date.now()}@preuves.test>`
		const message = await creerMessage(request, identifiant)
		const jeton = await jetonDe('admin@p2enjoy.test')

		try {
			// AVANT : non classé, donc invisible — même pour l'administratrice (`CRM-054`).
			const avant = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			expect((await avant.json()) as unknown[]).toHaveLength(0)

			const classement = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
				headers: enTetesAuthentifies(jeton),
				data: { p_message_id: message, p_card_id: CARD },
			})
			expect(classement.status(), await classement.text()).toBe(200)

			// APRÈS : classé, donc lisible par qui lit la card.
			const apres = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id,classification,classified_by`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			const lues = (await apres.json()) as {
				classification: string
				classified_by: string
			}[]
			expect(lues).toHaveLength(1)
			expect(lues[0]?.classification).toBe('manual')
			// Le classement manuel a un AUTEUR, et il est journalisé (§16.3).
			expect(lues[0]?.classified_by).toBe('5eed0000-0000-4000-8000-000000000011')

			// L'événement de timeline est écrit : la card garde la mémoire du message reçu.
			const evenements = await request.get(
				`${URL_API}/rest/v1/card_events?card_id=eq.${CARD}&type=eq.mail_received&select=id`,
				{ headers: enTetesService() },
			)
			expect(((await evenements.json()) as unknown[]).length).toBeGreaterThanOrEqual(1)
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
				headers: enTetesService(),
			})
			// L'ÉVÉNEMENT DE TIMELINE N'EST PAS RETIRÉ, ET IL NE PEUT PAS L'ÊTRE : `card_events`
			// n'accorde aucun privilège d'écriture, `service_role` compris (`CRM-044`).
			// L'historique ne se corrige pas. Un `DELETE` ici aurait été refusé en silence, et le
			// scénario aurait cru nettoyer ce qu'il laissait derrière lui — c'est exactement le
			// piège d'INC-061, à l'envers.
		}
	})

	test('le classement AUTOMATIQUE n’est pas offert au client', async ({ request }) => {
		// C'est un constat de la relève, pas un geste d'utilisateur : l'exposer laisserait un
		// client déclarer qu'un message a été classé par une règle qui ne s'est pas appliquée.
		const jeton = await jetonDe('admin@p2enjoy.test')
		const refus = await request.post(
			`${URL_API}/rest/v1/rpc/classer_message_automatiquement`,
			{ headers: enTetesAuthentifies(jeton), data: { p_message_id: CARD } },
		)
		expect([401, 403, 404]).toContain(refus.status())
	})
})
