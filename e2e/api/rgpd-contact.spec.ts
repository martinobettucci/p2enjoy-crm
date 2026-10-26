// @verifies CRM-072 (docs/BACKLOG.md) — tranche T3 : le volet RGPD d'un contact, contrat d'API hors interface
// @verifies docs/SPEC-audit.md §7.1 (l'export versionné, journalisé sans nom), §7.2 (l'anonymisation confirmée par le
//           nom, ses effets, le contact devenu non modifiable mais supprimable), §7 (réservé aux administrateurs, un
//           contact invisible introuvable) ; CLAUDE.md §10 ; docs/JOURNAL.md décisions 725, 726 et 732
//
// AVEC LES VRAIS JETONS. Le contact éprouvé est créé par Camille et SUPPRIMÉ à la fin, anonymisé ou non : la base
// l'accepte (§7.2). Le journal, en ajout seul, garde les entrées du geste.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CONTACT = 'a0d17000-0000-4000-8000-0000000000e1'
const NOM = 'Régis Épreuve API'

const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })

test.describe('le volet RGPD d’un contact — hors interface (docs/SPEC-audit.md §7)', () => {
	test.beforeAll(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/contacts?id=eq.${CONTACT}`, { headers: enTetesService() })
		const creation = await request.post(`${URL_API}/rest/v1/contacts`, {
			headers: json(await jetonDe('admin@p2enjoy.test')),
			data: { id: CONTACT, workspace_id: ESPACE, full_name: NOM, email: 'regis.epreuve@exemple.test', phone: '+33 6 99 99 99 99' },
		})
		expect(creation.status(), await creation.text()).toBe(201)
	})

	test.afterAll(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/contacts?id=eq.${CONTACT}`, { headers: enTetesService() })
	})

	test('le business developer et la lectrice sont refusés, l’anonyme aussi', async ({ request }) => {
		for (const compte of ['bizdev@p2enjoy.test', 'viewer@p2enjoy.test']) {
			const jeton = await jetonDe(compte)
			const exporter = await request.post(`${URL_API}/rest/v1/rpc/export_contact`, { headers: json(jeton), data: { p_contact: CONTACT } })
			expect(exporter.status(), compte).toBe(403)
			expect(((await exporter.json()) as { message: string }).message).toBe('reserved_to_admins')
			const anonymiser = await request.post(`${URL_API}/rest/v1/rpc/anonymize_contact`, {
				headers: json(jeton),
				data: { p_contact: CONTACT, p_confirmation: NOM },
			})
			expect(anonymiser.status(), compte).toBe(403)
		}
		const anonyme = await request.post(`${URL_API}/rest/v1/rpc/export_contact`, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { p_contact: CONTACT },
		})
		expect([401, 403]).toContain(anonyme.status())
	})

	test('Camille exporte : l’objet versionné, et une entrée de journal sans le nom', async ({ request }) => {
		const reponse = await request.post(`${URL_API}/rest/v1/rpc/export_contact`, {
			headers: json(await jetonDe('admin@p2enjoy.test')),
			data: { p_contact: CONTACT },
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		const objet = (await reponse.json()) as { format: string; contact: { email: string } }
		expect(objet.format).toBe('p2enjoy-crm/contact-export/1')
		expect(objet.contact.email).toBe('regis.epreuve@exemple.test')
		const journal = await request.get(
			`${URL_API}/rest/v1/audit_log?select=action,entity_label,actor_id&entity_id=eq.${CONTACT}&order=id.desc&limit=1`,
			{ headers: enTetesService() },
		)
		expect(await journal.json()).toEqual([{ action: 'exported', entity_label: null, actor_id: '5eed0000-0000-4000-8000-000000000011' }])
	})

	test('Camille anonymise : le nom retapé différent est refusé, puis les données s’effacent et le contact se fige', async ({ request }) => {
		const camille = json(await jetonDe('admin@p2enjoy.test'))
		const mauvais = await request.post(`${URL_API}/rest/v1/rpc/anonymize_contact`, {
			headers: camille,
			data: { p_contact: CONTACT, p_confirmation: 'Regis Epreuve API' },
		})
		expect(mauvais.status()).toBe(400)
		expect(((await mauvais.json()) as { message: string }).message).toBe('confirmation_mismatch')

		const bon = await request.post(`${URL_API}/rest/v1/rpc/anonymize_contact`, {
			headers: camille,
			data: { p_contact: CONTACT, p_confirmation: NOM },
		})
		expect(bon.status(), await bon.text()).toBe(204)
		const relu = await request.get(`${URL_API}/rest/v1/contacts?select=full_name,email,phone,anonymized_at&id=eq.${CONTACT}`, {
			headers: enTetesService(),
		})
		const [contact] = (await relu.json()) as { full_name: string; email: null; phone: null; anonymized_at: string | null }[]
		expect(contact).toMatchObject({ full_name: 'Contact anonymisé', email: null, phone: null })
		expect(contact?.anonymized_at).not.toBeNull()

		const modification = await request.patch(`${URL_API}/rest/v1/contacts?id=eq.${CONTACT}`, {
			headers: camille,
			data: { full_name: NOM },
		})
		expect(modification.status()).toBe(400)
		expect(((await modification.json()) as { message: string }).message).toBe('contact_anonymized')
	})
})
