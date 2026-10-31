// @verifies CRM-074 (docs/BACKLOG.md) — tranche T1 : le texte extrait des pièces jointes hors interface, avec les vrais
//           jetons — une pièce saine et retenue passe à extraire, la clé de service la prend et rend le texte, la personne
//           qui lit la pièce lit son texte ; refus de l'écriture, de la prise et du résultat à tout autre que la clé de service
// @verifies docs/SPEC-pieces-jointes.md §3, §7 ; docs/JOURNAL.md décisions 788 et 789 ; CLAUDE.md §10
//
// Les pièces de la preuve sont des lignes posées par la clé de service sur le message envoyé du seed qui porte
// `proposition-monitoring.txt` ; leur nom commence par `tst-crm074`, et elles sont retirées à la fin. Aucun objet n'est
// déposé au stockage : la preuve porte sur la base, l'extraction réelle sur `mail-sync` (T2).

import { createHash } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const RPC = `${URL_API}/rest/v1/rpc`
const REST = `${URL_API}/rest/v1`
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

type Porteur = { message_id: string; card_id: string | null }

async function porteur(request: APIRequestContext): Promise<Porteur> {
	const reponse = await request.get(
		`${REST}/mail_attachments?filename=eq.proposition-monitoring.txt&select=message_id,card_id&limit=1`,
		{ headers: enTetesService() },
	)
	expect(reponse.status(), await reponse.text()).toBe(200)
	const [ligne] = (await reponse.json()) as Porteur[]
	if (ligne === undefined) throw new Error('le message porteur du seed (proposition-monitoring.txt) est absent')
	return ligne
}

async function piece(request: APIRequestContext, p: Porteur, nom: string, type: string): Promise<{ id: string; text_status: string | null }> {
	const empreinte = createHash('sha256').update(nom).digest('hex')
	const reponse = await request.post(`${REST}/mail_attachments?select=id,text_status`, {
		headers: { ...json(enTetesService()), Prefer: 'return=representation' },
		data: {
			message_id: p.message_id,
			card_id: p.card_id,
			filename: nom,
			mime_type: type,
			size_bytes: 10,
			storage_path: `5eed0000-0000-4000-8000-000000000001/${p.message_id}/${empreinte}`,
			sha256: empreinte,
			av_status: 'clean',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [creee] = (await reponse.json()) as { id: string; text_status: string | null }[]
	return creee!
}

test.describe('le texte extrait des pièces jointes — hors interface (docs/SPEC-pieces-jointes.md §3)', () => {
	test.afterEach(async ({ request }) => {
		await request.delete(`${REST}/mail_attachments?filename=like.${encodeURIComponent('tst-crm074*')}`, { headers: enTetesService() })
	})

	test('une pièce saine et retenue passe à extraire ; la clé de service la prend et rend le texte ; l’administratrice le lit', async ({
		request,
	}) => {
		const p = await porteur(request)
		const pdf = await piece(request, p, 'tst-crm074-devis.pdf', 'application/pdf')
		const image = await piece(request, p, 'tst-crm074-photo.png', 'image/png')
		expect(pdf.text_status).toBe('pending')
		expect(image.text_status, 'une image n’a pas de texte à extraire').toBeNull()

		const prise = await request.post(`${RPC}/claim_attachment_texts`, { headers: json(enTetesService()), data: { p_limit: 50 } })
		expect(prise.status(), await prise.text()).toBe(200)
		const prises = (await prise.json()) as { attachment_id: string; storage_path: string; mime_type: string; attempt: number }[]
		const notre = prises.find((x) => x.attachment_id === pdf.id)
		expect(notre).toMatchObject({ mime_type: 'application/pdf', attempt: 1 })
		expect(prises.some((x) => x.attachment_id === image.id)).toBe(false)

		const resultat = await request.post(`${RPC}/record_attachment_text`, {
			headers: json(enTetesService()),
			data: { p_attachment: pdf.id, p_status: 'extracted', p_text: 'Devis n° 42 — refonte du monitoring' },
		})
		expect(resultat.status(), await resultat.text()).toBe(200)
		expect(await resultat.json()).toBe('extracted')

		const admin = await jetonDe('admin@p2enjoy.test')
		const lu = await request.get(`${REST}/mail_attachments?id=eq.${pdf.id}&select=text_status,extracted_text,text_truncated`, {
			headers: enTetesAuthentifies(admin),
		})
		expect(lu.status()).toBe(200)
		expect(await lu.json()).toEqual([{ text_status: 'extracted', extracted_text: 'Devis n° 42 — refonte du monitoring', text_truncated: false }])
	})

	test('refus directs : ni l’administratrice ni l’anonyme n’écrivent un texte, ne prennent ni ne rendent une extraction', async ({
		request,
	}) => {
		const p = await porteur(request)
		const pdf = await piece(request, p, 'tst-crm074-refus.pdf', 'application/pdf')
		const admin = await jetonDe('admin@p2enjoy.test')

		const ecriture = await request.patch(`${REST}/mail_attachments?id=eq.${pdf.id}`, {
			headers: json(enTetesAuthentifies(admin)),
			data: { text_status: 'extracted', extracted_text: 'falsifié' },
		})
		expect(ecriture.status(), 'aucune écriture de `authenticated` sur les pièces').toBe(403)

		const prise = await request.post(`${RPC}/claim_attachment_texts`, { headers: json(enTetesAuthentifies(admin)), data: {} })
		expect(prise.status(), 'la prise est à la clé de service seule').toBe(403)
		const resultat = await request.post(`${RPC}/record_attachment_text`, {
			headers: json(enTetesAuthentifies(admin)),
			data: { p_attachment: pdf.id, p_status: 'extracted', p_text: 'falsifié' },
		})
		expect(resultat.status(), 'le résultat est à la clé de service seule').toBe(403)
		const anonyme = await request.post(`${RPC}/claim_attachment_texts`, { headers: json(enTetesAnonymes()), data: {} })
		expect(anonyme.status()).toBe(401)

		const relu = await request.get(`${REST}/mail_attachments?id=eq.${pdf.id}&select=text_status,extracted_text`, { headers: enTetesService() })
		expect(await relu.json(), 'la pièce est restée à extraire, sans texte').toEqual([{ text_status: 'pending', extracted_text: null }])
	})
})
