// @verifies CRM-141 (docs/BACKLOG.md) — tranche T4 : les gestes de l'inbox sur la vraie base, avec les vrais jetons — poser
//           et retirer une pastille (toujours un choix manuel), demander une réévaluation ; les refus nommés pour qui
//           n'édite pas l'espace, une pastille archivée, une pastille inconnue, un mail envoyé, un message
//           inconnu ; et le filtre de la liste, tel que la webapp le demande
// @verifies docs/SPEC-mail-subsystem.md §31.4, §31.7 ; docs/JOURNAL.md décision 926 ; CLAUDE.md §10 (refus par requête
//           directe)
//
// LES MAILS SONT PROPRES À LA PREUVE, posés par la clé de service dans « Refonte du site vitrine » (`…00c1`), et retirés à
// la fin quoi qu'il arrive. Les gestes portent des lignes `manual`, que la passe de la minute ne touche jamais.

import { type APIRequestContext, expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
// « Formation Data & IA », que la lectrice lit (le patron de `card-costs.spec.ts`).
const CARD_C7 = '5eed0000-0000-4000-8000-0000000000c7'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const INCONNU = '00000000-0000-4000-8000-0000000000aa'
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })
const suffixe = Date.now().toString(36)
// La requête de la webapp, recopiée : le projet des E2E ne compile pas les modules de la webapp (`import.meta.env`). Sa
// valeur est épinglée par `webapp/src/lib/inbox.test.ts`.
const COLONNES_LISTE_INBOX_FILTREE =
	'id, workspace_id, card_id, classification, subject, from_address, from_name, received_at, references_ids, rfc822_message_id, is_read, pastilles:mail_message_labels(label_id, applied), filtre_pastille:mail_message_labels!inner(label_id, applied)'
const rpc = (nom: string) => `${URL_API}/rest/v1/rpc/${nom}`

test.describe.configure({ mode: 'serial' })

const crees: string[] = []

async function poserMail(
	request: APIRequestContext,
	objet: string,
	direction: 'inbound' | 'outbound',
	card = CARD_C1,
): Promise<string> {
	const reponse = await request.post(`${URL_API}/rest/v1/mail_messages`, {
		headers: json({ ...enTetesService(), Prefer: 'return=representation' }),
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `<tst-crm141-t4-${suffixe}-${crees.length}@sonde.test>`,
			card_id: card,
			classification: 'manual',
			from_address: 'contact@sonde.test',
			subject: objet,
			body_text: 'Preuve des gestes de pastilles.',
			direction,
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const id = ((await reponse.json()) as { id: string }[])[0]!.id
	crees.push(id)
	return id
}

async function pastille(request: APIRequestContext, nom: string, espace = ESPACE): Promise<string> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_labels?workspace_id=eq.${espace}&name=eq.${encodeURIComponent(nom)}&select=id`,
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

async function ligne(request: APIRequestContext, message: string, label: string) {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_message_labels?message_id=eq.${message}&label_id=eq.${label}&select=source,applied,set_by`,
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as { source: string; applied: boolean; set_by: string | null }[])[0] ?? null
}

test.afterAll(async ({ request }) => {
	for (const id of crees) await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${id}`, { headers: enTetesService() })
})

test('le business developer pose puis retire une pastille : deux choix manuels, signés', async ({ request }) => {
	const message = await poserMail(request, `ZZ 141 pose ${suffixe}`, 'inbound')
	const lead = await pastille(request, 'Lead')
	const driss = await jetonDe('bizdev@p2enjoy.test')
	const pose = await request.post(rpc('set_message_label'), {
		headers: json(enTetesAuthentifies(driss)),
		data: { p_message_id: message, p_label_id: lead, p_applied: true },
	})
	expect(pose.status(), await pose.text()).toBe(204)
	expect(await ligne(request, message, lead)).toEqual({ source: 'manual', applied: true, set_by: DRISS })
	const retrait = await request.post(rpc('set_message_label'), {
		headers: json(enTetesAuthentifies(driss)),
		data: { p_message_id: message, p_label_id: lead, p_applied: false },
	})
	expect(retrait.status()).toBe(204)
	expect(await ligne(request, message, lead)).toEqual({ source: 'manual', applied: false, set_by: DRISS })

	// Ce que la webapp demande pour le filtre « Pastille » : le message n'y est plus, une fois la pastille retirée.
	const filtre = async () => {
		const reponse = await request.get(
			`${URL_API}/rest/v1/mail_messages?select=${encodeURIComponent(COLONNES_LISTE_INBOX_FILTREE)}&id=eq.${message}` +
				`&filtre_pastille.label_id=eq.${lead}&filtre_pastille.applied=eq.true`,
			{ headers: enTetesAuthentifies(driss) },
		)
		expect(reponse.status(), await reponse.text()).toBe(200)
		return ((await reponse.json()) as { id: string }[]).map((m) => m.id)
	}
	expect(await filtre()).toEqual([])
	await request.post(rpc('set_message_label'), {
		headers: json(enTetesAuthentifies(driss)),
		data: { p_message_id: message, p_label_id: lead, p_applied: true },
	})
	expect(await filtre()).toEqual([message])
})

test('les refus nommés : archivée, pastille inconnue, message inconnu ; retirer une archivée reste permis', async ({ request }) => {
	const message = await poserMail(request, `ZZ 141 refus ${suffixe}`, 'inbound')
	const newsletter = await pastille(request, 'Newsletter')
	const camille = await jetonDe('admin@p2enjoy.test')
	const archivee = await request.post(rpc('set_message_label'), {
		headers: json(enTetesAuthentifies(camille)),
		data: { p_message_id: message, p_label_id: newsletter, p_applied: true },
	})
	expect(archivee.status()).toBe(400)
	expect(((await archivee.json()) as { message: string }).message).toBe('label_archived')
	const retrait = await request.post(rpc('set_message_label'), {
		headers: json(enTetesAuthentifies(camille)),
		data: { p_message_id: message, p_label_id: newsletter, p_applied: false },
	})
	expect(retrait.status()).toBe(204)

	// Le seed n'a qu'un espace : une pastille d'un autre espace se prouve par pgTAP (0172) ; ici, une pastille inexistante,
	// qui rend le même refus.
	const etrangere = await request.post(rpc('set_message_label'), {
		headers: json(enTetesAuthentifies(camille)),
		data: { p_message_id: message, p_label_id: INCONNU, p_applied: true },
	})
	expect(etrangere.status()).toBe(404)
	expect(((await etrangere.json()) as { message: string }).message).toBe('label_not_found')

	const inconnu = await request.post(rpc('request_label_evaluation'), {
		headers: json(enTetesAuthentifies(camille)),
		data: { p_message_id: INCONNU },
	})
	expect(inconnu.status()).toBe(404)
	expect(((await inconnu.json()) as { message: string }).message).toBe('message_not_found')
})

test('la réévaluation : le message repasse en tête de file ; un mail envoyé est refusé', async ({ request }) => {
	const recu = await poserMail(request, `ZZ 141 réévaluation ${suffixe}`, 'inbound')
	const envoye = await poserMail(request, `ZZ 141 envoyé ${suffixe}`, 'outbound')
	const driss = await jetonDe('bizdev@p2enjoy.test')
	const demande = await request.post(rpc('request_label_evaluation'), {
		headers: json(enTetesAuthentifies(driss)),
		data: { p_message_id: recu },
	})
	expect(demande.status(), await demande.text()).toBe(204)
	const file = await request.get(`${URL_API}/rest/v1/mail_label_evaluations?message_id=eq.${recu}&select=priority,attempts`, {
		headers: enTetesService(),
	})
	// La passe de la minute peut l'avoir déjà prise : la priorité, elle, reste celle d'une demande.
	expect(((await file.json()) as { priority: number }[])[0]!.priority).toBe(0)

	const refus = await request.post(rpc('request_label_evaluation'), {
		headers: json(enTetesAuthentifies(driss)),
		data: { p_message_id: envoye },
	})
	expect(refus.status()).toBe(400)
	expect(((await refus.json()) as { message: string }).message).toBe('outbound_message')
})

test('la lectrice : un message qu’elle lit lui est interdit (403) ; un message qu’elle ne lit pas est introuvable (404)', async ({
	request,
}) => {
	const lisible = await poserMail(request, `ZZ 141 lectrice lisible ${suffixe}`, 'inbound', CARD_C7)
	const ferme = await poserMail(request, `ZZ 141 lectrice fermé ${suffixe}`, 'inbound')
	const lead = await pastille(request, 'Lead')
	const farida = await jetonDe('viewer@p2enjoy.test')
	for (const [message, statut, code] of [
		[lisible, 403, 'forbidden'],
		[ferme, 404, 'message_not_found'],
	] as const) {
		const pose = await request.post(rpc('set_message_label'), {
			headers: json(enTetesAuthentifies(farida)),
			data: { p_message_id: message, p_label_id: lead, p_applied: true },
		})
		expect(pose.status(), message).toBe(statut)
		expect(((await pose.json()) as { message: string }).message).toBe(code)
		const reevaluation = await request.post(rpc('request_label_evaluation'), {
			headers: json(enTetesAuthentifies(farida)),
			data: { p_message_id: message },
		})
		expect(reevaluation.status(), message).toBe(statut)
		expect(await ligne(request, message, lead)).toBeNull()
	}
})
