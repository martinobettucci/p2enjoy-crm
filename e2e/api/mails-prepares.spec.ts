// @verifies CRM-128 (docs/BACKLOG.md) — tranches T2 et T4 : les mails préparés par requête directe, sous les vrais jetons
//           de session — préparer, lire (la personne seule), mettre en file le contenu relu, écarter ; les refus de
//           l'autre personne (404), de la lectrice (`forbidden`) et d'un mail qui n'est plus en attente
// @verifies docs/SPEC-mails-prepares.md §3.2 à §3.5, §8 ; docs/SPEC-test-harness.md §4.3 ; CLAUDE.md §10 (règle d'accès
//           prouvée hors interface)
//
// LE REFUS DU JETON DU CONNECTEUR (`review_required`) EST PROUVÉ PAR L'INTÉGRATION DU CONNECTEUR (T3), qui frappe ce jeton
// par son propre code ; ici, les jetons sont ceux de la fonction `session`, ceux de l'interface web.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const AFFAIRE = '5eed0000-0000-4000-8000-0000000000c1'
const MARQUE = 'API CRM-128'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

/** La première ligne d'une lecture, qui doit exister : l'absence fait échouer la preuve en le disant. */
function premiere<T>(lignes: readonly T[]): T {
	const ligne = lignes[0]
	if (ligne === undefined) throw new Error('aucune ligne lue')
	return ligne
}

async function preparer(request: APIRequestContext, qui: string, objet: string) {
	return request.post(rest('rpc/prepare_email'), {
		headers: enTetesAuthentifies(await jetonDe(qui)),
		data: { p_card_id: AFFAIRE, p_to: ['client@exterieur.test'], p_subject: objet, p_body_text: `${MARQUE} — préparé.` },
	})
}

test.afterEach(async ({ request }) => {
	await request.delete(rest(`mail_outbox?body_text=like.${encodeURIComponent(MARQUE)}*`), { headers: enTetesService() })
	await request.delete(rest(`mail_drafts?body_text=like.${encodeURIComponent(MARQUE)}*`), { headers: enTetesService() })
})

test('préparer ne met rien en file ; mettre en file le contenu relu crée l’envoi, une seule fois', async ({ request }) => {
	const prepare = await preparer(request, ADMIN, 'Préparé')
	expect(prepare.status(), await prepare.text()).toBe(200)
	const id = (await prepare.json()) as string
	const avant = await request.get(rest(`mail_outbox?body_text=like.${encodeURIComponent(MARQUE)}*&select=id`), {
		headers: enTetesService(),
	})
	expect(await avant.json()).toEqual([])

	const jeton = await jetonDe(ADMIN)
	const identite = await request.get(rest('mail_outbound_identities?owner_id=eq.5eed0000-0000-4000-8000-000000000011&select=id'), {
		headers: enTetesAuthentifies(jeton),
	})
	const { id: idIdentite } = premiere((await identite.json()) as { id: string }[])
	const envoi = await request.post(rest('rpc/send_email_draft'), {
		headers: enTetesAuthentifies(jeton),
		data: { p_draft_id: id, p_identity_id: idIdentite, p_to: ['client@exterieur.test'], p_body_text: `${MARQUE} — relu.` },
	})
	expect(envoi.status(), await envoi.text()).toBe(200)
	const idFile = (await envoi.json()) as string
	const file = await request.get(rest(`mail_outbox?id=eq.${idFile}&select=body_text,card_id,status`), {
		headers: enTetesService(),
	})
	const ligne = premiere((await file.json()) as { body_text: string; card_id: string; status: string }[])
	expect(ligne.body_text).toContain('relu.')
	expect([ligne.card_id, ligne.status]).toEqual([AFFAIRE, 'queued'])

	const encore = await request.post(rest('rpc/send_email_draft'), {
		headers: enTetesAuthentifies(jeton),
		data: { p_draft_id: id, p_identity_id: idIdentite, p_to: ['client@exterieur.test'], p_body_text: `${MARQUE} — bis.` },
	})
	expect(encore.status()).toBe(400)
	expect(((await encore.json()) as { message: string }).message).toBe('draft_not_pending')
})

test('le mail préparé de Camille n’existe pas pour Driss : ni lu, ni écarté, ni envoyé — le même 404', async ({ request }) => {
	const id = (await (await preparer(request, ADMIN, 'De Camille')).json()) as string
	const jetonDriss = await jetonDe(BIZDEV)
	const lu = await request.get(rest(`mail_drafts?id=eq.${id}&select=id`), { headers: enTetesAuthentifies(jetonDriss) })
	expect(await lu.json()).toEqual([])
	const ecart = await request.post(rest('rpc/discard_email_draft'), {
		headers: enTetesAuthentifies(jetonDriss),
		data: { p_draft_id: id },
	})
	expect(ecart.status()).toBe(404)
	const inconnu = await request.post(rest('rpc/discard_email_draft'), {
		headers: enTetesAuthentifies(jetonDriss),
		data: { p_draft_id: '00000000-0000-4000-8000-000000000000' },
	})
	expect(inconnu.status()).toBe(404)
	expect(await inconnu.text()).toBe(await ecart.text())
	const etat = await request.get(rest(`mail_drafts?id=eq.${id}&select=status`), { headers: enTetesService() })
	expect(await etat.json()).toEqual([{ status: 'pending' }])
})

test('la lectrice n’écrit pas l’affaire : elle ne prépare rien', async ({ request }) => {
	const reponse = await preparer(request, LECTRICE, 'Interdit')
	expect(reponse.status()).toBe(403)
	expect(((await reponse.json()) as { message: string }).message).toBe('forbidden')
})

test('aucune écriture directe dans `mail_drafts` : toute écriture passe par les fonctions', async ({ request }) => {
	const insertion = await request.post(rest('mail_drafts'), {
		headers: enTetesAuthentifies(await jetonDe(ADMIN)),
		data: {
			workspace_id: '5eed0000-0000-4000-8000-000000000001',
			card_id: AFFAIRE,
			to_addrs: ['x@exterieur.test'],
			body_text: `${MARQUE} — direct.`,
			origin: 'web',
			created_by: '5eed0000-0000-4000-8000-000000000011',
		},
	})
	expect(insertion.status()).toBe(403)
})
