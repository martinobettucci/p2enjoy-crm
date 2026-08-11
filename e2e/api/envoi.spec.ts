// @verifies CRM-058 (docs/BACKLOG.md) — contrat d'API de la file d'envoi
// @verifies docs/SPEC-mail-subsystem.md §19.4 (les six refus, le quota), §19.7 (preuves exigées)
// @verifies docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10
// @verifies docs/JOURNAL.md décision 330
//
// TOUT SE MESURE HORS INTERFACE, avec de vrais jetons obtenus par la route de connexion : une
// règle d'accès vérifiée depuis l'écran ne prouve que l'écran. Le scénario retire ce qu'il crée.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const CARD = '5eed0000-0000-4000-8000-0000000000c1'

type Reponse = { code?: string; message?: string }

async function identiteDeService(
	request: import('@playwright/test').APIRequestContext,
): Promise<string> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_outbound_identities?select=id&owner_id=is.null&limit=1`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne, 'l’identité de service du seed est introuvable').toBeDefined()
	return ligne!.id
}

async function mettreEnFile(
	request: import('@playwright/test').APIRequestContext,
	entetes: Record<string, string>,
	corps: Record<string, unknown>,
): Promise<import('@playwright/test').APIResponse> {
	return request.post(`${URL_API}/rest/v1/rpc/queue_outbound_email`, {
		headers: { ...entetes, 'Content-Type': 'application/json' },
		data: corps,
	})
}

test.describe('file d’envoi — ce que la pile refuse', () => {
	test('un anonyme ne met rien en file', async ({ request }) => {
		const refus = await mettreEnFile(request, enTetesAnonymes(), {
			p_card_id: CARD,
			p_identity_id: await identiteDeService(request),
			p_to: ['client@exterieur.test'],
		})
		expect([401, 403]).toContain(refus.status())
	})

	// LA CLÉ DE SERVICE NON PLUS, ET C'EST VOULU : `auth.uid()` y est nul, et un envoi part
	// toujours au nom de quelqu'un. Une intégration qui voudrait envoyer devra porter une identité.
	test('la clé de service elle-même est refusée : un envoi a un auteur', async ({ request }) => {
		const refus = await mettreEnFile(request, enTetesService(), {
			p_card_id: CARD,
			p_identity_id: await identiteDeService(request),
			p_to: ['client@exterieur.test'],
		})
		expect(refus.status()).toBe(403)
		expect(((await refus.json()) as Reponse).message).toBe('not_authenticated')
	})

	test('le `viewer` est refusé : écrire au nom d’une affaire, c’est y ajouter du contenu', async ({
		request,
	}) => {
		const refus = await mettreEnFile(
			request,
			enTetesAuthentifies(await jetonDe('viewer@p2enjoy.test')),
			{
				p_card_id: CARD,
				p_identity_id: await identiteDeService(request),
				p_to: ['client@exterieur.test'],
			},
		)
		expect(refus.status()).toBe(403)
		const corps = (await refus.json()) as Reponse
		expect(corps.code).toBe('42501')
		expect(corps.message).toBe('forbidden')
	})

	test('un membre n’emprunte pas l’identité de SERVICE du workspace', async ({ request }) => {
		const refus = await mettreEnFile(
			request,
			enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test')),
			{
				p_card_id: CARD,
				p_identity_id: await identiteDeService(request),
				p_to: ['client@exterieur.test'],
			},
		)
		// `403`, ET NON `500` : `P0002` — d'abord retenu — était traduit par PostgREST en panne de
		// serveur, ce qui aurait envoyé l'exploitant chercher un incident là où le produit a dit non.
		expect(refus.status()).toBe(403)
		expect(((await refus.json()) as Reponse).message).toBe('identity_not_available')
	})

	test('un message sans destinataire est refusé', async ({ request }) => {
		const refus = await mettreEnFile(
			request,
			enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')),
			{ p_card_id: CARD, p_identity_id: await identiteDeService(request), p_to: [] },
		)
		expect(refus.status()).toBe(400)
		expect(((await refus.json()) as Reponse).message).toBe('recipient_required')
	})

	// LE QUOTA EST DÉGRADÉ PUIS RESTAURÉ : le seed ne garde aucune trace du passage.
	test('le quota journalier refuse, et le refus est nommé', async ({ request }) => {
		const identite = await identiteDeService(request)
		try {
			const bride = await request.patch(
				`${URL_API}/rest/v1/mail_outbound_identities?id=eq.${identite}`,
				{ headers: { ...enTetesService(), Prefer: 'return=minimal' }, data: { daily_quota: 0 } },
			)
			expect([200, 204]).toContain(bride.status())

			const refus = await mettreEnFile(
				request,
				enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')),
				{
					p_card_id: CARD,
					p_identity_id: identite,
					p_to: ['client@exterieur.test'],
					p_subject: 'Refusé par le quota',
					p_body_text: 'Corps.',
				},
			)
			expect(refus.status()).toBe(409)
			expect(((await refus.json()) as Reponse).message).toBe('quota_exceeded')
		} finally {
			await request.patch(`${URL_API}/rest/v1/mail_outbound_identities?id=eq.${identite}`, {
				headers: { ...enTetesService(), Prefer: 'return=minimal' },
				data: { daily_quota: null },
			})
		}
	})

	test('aucun client n’écrit directement dans la file, ni ne la vide', async ({ request }) => {
		const entetes = enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))

		const insertion = await request.post(`${URL_API}/rest/v1/mail_outbox`, {
			headers: { ...entetes, Prefer: 'return=minimal' },
			data: {
				workspace_id: '5eed0000-0000-4000-8000-000000000001',
				identity_id: await identiteDeService(request),
				card_id: CARD,
				to_addrs: ['client@exterieur.test'],
				body_text: 'Contournement.',
			},
		})
		expect([401, 403]).toContain(insertion.status())

		// LES TROIS FONCTIONS DU WORKER SONT FERMÉES AU CLIENT : les offrir laisserait déclarer
		// qu'un message est parti alors qu'il ne l'est pas.
		for (const fonction of ['reserver_envois', 'marquer_envoi_reussi', 'marquer_envoi_echoue']) {
			const refus = await request.post(`${URL_API}/rest/v1/rpc/${fonction}`, {
				headers: { ...entetes, 'Content-Type': 'application/json' },
				data: {},
			})
			expect([401, 403, 404], `${fonction} a rendu ${refus.status()}`).toContain(refus.status())
		}
	})
})

test.describe('file d’envoi — ce que la pile consent', () => {
	test('une administratrice met en file, et la ligne porte son auteur', async ({ request }) => {
		const identite = await identiteDeService(request)
		let file: string | undefined
		try {
			const miseEnFile = await mettreEnFile(
				request,
				enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')),
				{
					p_card_id: CARD,
					p_identity_id: identite,
					p_to: ['client@exterieur.test'],
					p_subject: 'Contrat d’API',
					p_body_text: 'Corps de preuve.',
				},
			)
			expect(miseEnFile.status(), await miseEnFile.text()).toBe(200)
			file = (await miseEnFile.json()) as string

			const ligne = await request.get(
				`${URL_API}/rest/v1/mail_outbox?select=status,created_by,card_id,attempts&id=eq.${file}`,
				{ headers: enTetesService() },
			)
			const [envoi] = (await ligne.json()) as {
				status: string
				created_by: string
				card_id: string
				attempts: number
			}[]
			expect(envoi?.status).toBe('queued')
			expect(envoi?.created_by).toBe('5eed0000-0000-4000-8000-000000000011')
			expect(envoi?.card_id).toBe(CARD)
			expect(envoi?.attempts).toBe(0)

			// LA LECTURE SUIT LA CARD : un membre qui lit l'affaire voit son courrier en partance.
			const parLeMembre = await request.get(
				`${URL_API}/rest/v1/mail_outbox?select=id&id=eq.${file}`,
				{ headers: enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test')) },
			)
			expect(parLeMembre.status()).toBe(200)
			expect((await parLeMembre.json()) as unknown[]).toHaveLength(1)
		} finally {
			if (file !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, {
					headers: enTetesService(),
				})
			}
		}
	})
})
