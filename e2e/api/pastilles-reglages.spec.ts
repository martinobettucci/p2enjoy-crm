// @verifies CRM-141 (docs/BACKLOG.md) — tranche T3 : la liste des pastilles des mails, hors interface, avec les vrais
//           jetons — l'administratrice crée, modifie, archive et désarchive ; le business developer et la lectrice lisent
//           et sont refusés ; un nom pris, archivées comprises, est refusé à la casse près ; aucune suppression
// @verifies docs/SPEC-mail-subsystem.md §31.2 (bornes, unicité), §31.3 (lecture par tout membre, écriture par
//           l'administrateur) ; docs/JOURNAL.md décision 926 (supprimer, c'est archiver) ; CLAUDE.md §10 (refus par
//           requête directe)
//
// Les pastilles créées ici sont retirées à la fin, par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const NOM = `ZZ pastille API ${Date.now()}`

const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })
const representation = (jeton: string) => ({ ...json(jeton), Prefer: 'return=representation' })

test.describe('les pastilles des mails — réglages hors interface (docs/SPEC-mail-subsystem.md §31.3)', () => {
	const creees: string[] = []

	test.afterAll(async ({ request }) => {
		for (const id of creees) await request.delete(`${URL_API}/rest/v1/mail_labels?id=eq.${id}`, { headers: enTetesService() })
	})

	test('l’administratrice crée, modifie, archive et désarchive ; l’auteur est posé par la base', async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		const creation = await request.post(`${URL_API}/rest/v1/mail_labels`, {
			headers: representation(camille),
			data: { workspace_id: ESPACE, name: NOM, color: 'danger', description: 'Une pastille de la preuve API.' },
		})
		expect(creation.status(), await creation.text()).toBe(201)
		const [pastille] = (await creation.json()) as { id: string; created_by: string; archived_at: string | null }[]
		creees.push(pastille!.id)
		expect(pastille!.created_by).toBe('5eed0000-0000-4000-8000-000000000011')
		expect(pastille!.archived_at).toBeNull()

		const modification = await request.patch(`${URL_API}/rest/v1/mail_labels?id=eq.${pastille!.id}`, {
			headers: representation(camille),
			data: { color: 'success', description: 'Descriptif revu.' },
		})
		expect(modification.status()).toBe(200)
		expect(((await modification.json()) as { color: string }[])[0]!.color).toBe('success')

		const archivage = await request.patch(`${URL_API}/rest/v1/mail_labels?id=eq.${pastille!.id}`, {
			headers: representation(camille),
			data: { archived_at: new Date().toISOString() },
		})
		expect(((await archivage.json()) as { archived_at: string | null }[])[0]!.archived_at).not.toBeNull()
		const desarchivage = await request.patch(`${URL_API}/rest/v1/mail_labels?id=eq.${pastille!.id}`, {
			headers: representation(camille),
			data: { archived_at: null },
		})
		expect(((await desarchivage.json()) as { archived_at: string | null }[])[0]!.archived_at).toBeNull()

		// Aucune suppression, même pour l'administratrice : une pastille s'archive (décision 926).
		const suppression = await request.delete(`${URL_API}/rest/v1/mail_labels?id=eq.${pastille!.id}`, { headers: json(camille) })
		expect(suppression.status()).toBe(403)
		// L'espace d'une pastille ne se change pas : la colonne n'est pas écrivable.
		const deplacement = await request.patch(`${URL_API}/rest/v1/mail_labels?id=eq.${pastille!.id}`, {
			headers: json(camille),
			data: { workspace_id: '00000000-0000-4000-8000-000000000000' },
		})
		expect(deplacement.status()).toBe(403)
	})

	test('le business developer et la lectrice LISENT la liste ; leurs écritures sont refusées', async ({ request }) => {
		for (const adresse of ['bizdev@p2enjoy.test', 'viewer@p2enjoy.test']) {
			const jeton = await jetonDe(adresse)
			const lecture = await request.get(`${URL_API}/rest/v1/mail_labels?select=name&workspace_id=eq.${ESPACE}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(lecture.status()).toBe(200)
			const noms = ((await lecture.json()) as { name: string }[]).map((l) => l.name)
			expect(noms, adresse).toEqual(expect.arrayContaining(['Spam', 'Lead', 'Newsletter']))

			const creation = await request.post(`${URL_API}/rest/v1/mail_labels`, {
				headers: representation(jeton),
				data: { workspace_id: ESPACE, name: `ZZ interdite ${adresse}`, color: 'neutral', description: 'x' },
			})
			expect(creation.status(), adresse).toBe(403)

			// Une écriture que la politique filtre rend zéro ligne (décision 70) : rien n'est archivé.
			const archivage = await request.patch(`${URL_API}/rest/v1/mail_labels?workspace_id=eq.${ESPACE}&name=eq.Spam`, {
				headers: representation(jeton),
				data: { archived_at: new Date().toISOString() },
			})
			expect(archivage.status(), adresse).toBe(200)
			expect(await archivage.json(), adresse).toEqual([])
		}
		const spam = await request.get(`${URL_API}/rest/v1/mail_labels?select=archived_at&workspace_id=eq.${ESPACE}&name=eq.Spam`, {
			headers: enTetesService(),
		})
		expect(await spam.json()).toEqual([{ archived_at: null }])
	})

	test('un nom pris — par une archivée aussi, à la casse près — est refusé ; les bornes aussi', async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		// « Newsletter » est archivée par le seed (docs/SPEC-seed.md §46) : son nom reste pris.
		const doublon = await request.post(`${URL_API}/rest/v1/mail_labels`, {
			headers: representation(camille),
			data: { workspace_id: ESPACE, name: 'newsletter', color: 'neutral', description: 'Doublon.' },
		})
		expect(doublon.status()).toBe(409)
		expect(((await doublon.json()) as { code: string }).code).toBe('23505')

		for (const donnees of [
			{ name: 'ZZ couleur', color: 'fuchsia', description: 'x' },
			{ name: 'Z'.repeat(41), color: 'neutral', description: 'x' },
			{ name: 'ZZ descriptif', color: 'neutral', description: 'x'.repeat(501) },
			{ name: 'ZZ vide', color: 'neutral', description: '   ' },
		]) {
			const refus = await request.post(`${URL_API}/rest/v1/mail_labels`, {
				headers: representation(camille),
				data: { workspace_id: ESPACE, ...donnees },
			})
			expect(refus.status(), JSON.stringify(donnees)).toBe(400)
			expect(((await refus.json()) as { code: string }).code).toBe('23514')
		}
	})

	test('l’anonyme ne lit rien et n’écrit rien', async ({ request }) => {
		const lecture = await request.get(`${URL_API}/rest/v1/mail_labels?select=id`, { headers: enTetesAnonymes() })
		expect(lecture.status()).toBe(200)
		expect(await lecture.json()).toEqual([])
		const creation = await request.post(`${URL_API}/rest/v1/mail_labels`, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { workspace_id: ESPACE, name: 'ZZ anonyme', color: 'neutral', description: 'x' },
		})
		expect([401, 403]).toContain(creation.status())
	})
})
