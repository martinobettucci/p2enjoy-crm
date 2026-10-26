// @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : le manuel lu par les seuls membres connectés, par requête directe
// @verifies docs/SPEC-manual.md §14.1 (le bucket privé et sa seule politique, de lecture), §15 (la publication en
//           miroir), §16 (preuve d'API) ; docs/SCHEMA.md §9 septies ; CLAUDE.md §10 (une règle d'accès se prouve en
//           contournant l'interface)
//
// Aucune réponse n'est substituée : la pile réelle, le bucket publié par le seed (`scripts/manuel/publier.sh`), et les
// jetons des trois comptes du seed. Chaque refus est mesuré deux fois : par le code rendu, et par l'absence du contenu —
// un refus qui laisserait passer le corps ne serait pas un refus.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { CLE_ANONYME, COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const RACINE = join(import.meta.dirname, '..', '..')
const CONSTRUIT = join(RACINE, 'docs', 'manuel', 'construit')
const SOMMAIRE = JSON.parse(readFileSync(join(CONSTRUIT, 'contents.json'), 'utf8')) as {
	chapters: Array<{ slug: string; title: string }>
}
const CHAPITRE = SOMMAIRE.chapters[0]?.slug ?? ''

const lecture = (chemin: string) => `${URL_API}/storage/v1/object/authenticated/manual/${chemin}`

/** Un jeton de la bonne forme, signé d'une autre clé : il ne doit rien ouvrir. */
function jetonForge(): string {
	const b64 = (objet: object) => Buffer.from(JSON.stringify(objet)).toString('base64url')
	const maintenant = Math.floor(Date.now() / 1000)
	return [
		b64({ alg: 'HS256', typ: 'JWT' }),
		b64({ sub: '5eed0000-0000-4000-8000-000000000011', role: 'authenticated', iat: maintenant, exp: maintenant + 300 }),
		Buffer.from('signature-forgee').toString('base64url'),
	].join('.')
}

test.describe('M1 — le manuel est publié en miroir de sa source (§15)', () => {
	test('le sommaire et chaque chapitre sont dans le bucket, à l’octet près', async ({ request }) => {
		for (const chemin of ['contents.json', ...SOMMAIRE.chapters.map((c) => `chapters/${c.slug}.json`)]) {
			const reponse = await request.get(lecture(chemin), { headers: enTetesService() })
			expect(reponse.status(), chemin).toBe(200)
			expect((await reponse.body()).toString('utf8'), chemin).toBe(readFileSync(join(CONSTRUIT, chemin), 'utf8'))
		}
	})
})

test.describe('M2 — sans session, rien ne se lit (§14.1)', () => {
	test('la clé anonyme seule ne lit ni le sommaire, ni un chapitre', async ({ request }) => {
		for (const chemin of ['contents.json', `chapters/${CHAPITRE}.json`]) {
			const reponse = await request.get(lecture(chemin), {
				headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${CLE_ANONYME}` },
			})
			expect(reponse.status(), chemin).not.toBe(200)
			expect(await reponse.text(), chemin).not.toContain(SOMMAIRE.chapters[0]?.title ?? '§')
		}
	})

	test('l’adresse publique du bucket ne sert rien : il est privé', async ({ request }) => {
		const reponse = await request.get(`${URL_API}/storage/v1/object/public/manual/contents.json`)
		expect(reponse.status()).not.toBe(200)
		expect(await reponse.text()).not.toContain('"chapters"')
	})

	test('un jeton forgé ne lit rien', async ({ request }) => {
		const reponse = await request.get(lecture('contents.json'), { headers: enTetesAuthentifies(jetonForge()) })
		expect(reponse.status()).not.toBe(200)
		expect(await reponse.text()).not.toContain('"chapters"')
	})

	test('la liste des objets du bucket est vide sans session', async ({ request }) => {
		const reponse = await request.post(`${URL_API}/storage/v1/object/list/manual`, {
			headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${CLE_ANONYME}` },
			data: { prefix: '', limit: 100, offset: 0 },
		})
		const corps = reponse.status() === 200 ? ((await reponse.json()) as unknown[]) : []
		expect(corps).toEqual([])
	})
})

test.describe('M3 — chaque session lit le manuel, aucune ne l’écrit (§14.1)', () => {
	for (const compte of COMPTES_SEED) {
		test(`${compte.role} lit le sommaire et un chapitre`, async ({ request }) => {
			const jeton = await jetonDe(compte.adresse)
			const sommaire = await request.get(lecture('contents.json'), { headers: enTetesAuthentifies(jeton) })
			expect(sommaire.status()).toBe(200)
			expect(((await sommaire.json()) as typeof SOMMAIRE).chapters.length).toBe(SOMMAIRE.chapters.length)
			const chapitre = await request.get(lecture(`chapters/${CHAPITRE}.json`), { headers: enTetesAuthentifies(jeton) })
			expect(chapitre.status()).toBe(200)
		})
	}

	test('même l’administratrice ne dépose, ne remplace ni ne retire rien', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const entetes = enTetesAuthentifies(jeton)

		const depot = await request.post(`${URL_API}/storage/v1/object/manual/chapters/forge.json`, {
			headers: { ...entetes, 'Content-Type': 'application/json' },
			data: '{}',
		})
		expect(depot.status()).not.toBe(200)

		const remplacement = await request.post(`${URL_API}/storage/v1/object/manual/contents.json`, {
			headers: { ...entetes, 'Content-Type': 'application/json', 'x-upsert': 'true' },
			data: '{"chapters":[]}',
		})
		expect(remplacement.status()).not.toBe(200)

		const retrait = await request.delete(`${URL_API}/storage/v1/object/manual`, {
			headers: { ...entetes, 'Content-Type': 'application/json' },
			data: { prefixes: ['contents.json'] },
		})
		// L'API de stockage rend `200` et une liste VIDE quand la politique ne laisse rien voir : on mesure l'effet.
		if (retrait.status() === 200) expect(await retrait.json()).toEqual([])

		// Le témoin : le manuel est intact, et aucun objet forgé n'existe.
		const temoin = await request.get(lecture('contents.json'), { headers: enTetesService() })
		expect((await temoin.body()).toString('utf8')).toBe(readFileSync(join(CONSTRUIT, 'contents.json'), 'utf8'))
		const forge = await request.get(lecture('chapters/forge.json'), { headers: enTetesService() })
		expect(forge.status()).not.toBe(200)
	})
})
