// @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : la lecture du manuel dans le bucket `manual`
// @verifies docs/SPEC-manual.md §13.4 (introuvable, erreur), §14.2 (lu avec la session, une image en `Blob`) ; aucune
//           traversée de chemin : un identifiant hors de forme ne part jamais au stockage

import { describe, expect, it } from 'vitest'
import { BUCKET_MANUEL, lireChapitre, lireImage, lireSommaire } from './manuel'
import type { ClientCrm } from './supabase'

type Issue = { data: Blob | null; error: ({ message: string; status?: number } & Record<string, unknown>) | null }

/** Un stockage en mémoire : chaque chemin rend son issue, et chaque lecture est relevée. */
function stockage(issues: Record<string, Issue | (() => never)>) {
	const lectures: string[] = []
	const client = {
		storage: {
			from(bucket: string) {
				return {
					download(chemin: string) {
						lectures.push(`${bucket}/${chemin}`)
						const issue = issues[chemin]
						if (typeof issue === 'function') return Promise.reject(new Error('réseau coupé'))
						return Promise.resolve(issue ?? { data: null, error: { message: 'Object not found', status: 400 } })
					},
				}
			},
		},
	} as unknown as ClientCrm
	return { client, lectures }
}

const json = (objet: unknown): Issue => ({ data: new Blob([JSON.stringify(objet)], { type: 'application/json' }), error: null })

describe('lireSommaire', () => {
	it('lit contents.json dans le bucket du manuel', async () => {
		const { client, lectures } = stockage({ 'contents.json': json({ introduction: [], chapters: [{ slug: 'a', title: 'A', sections: [] }] }) })
		const etat = await lireSommaire(client)
		expect(etat).toEqual({ statut: 'pret', donnees: { introduction: [], chapters: [{ slug: 'a', title: 'A', sections: [] }] } })
		expect(lectures).toEqual([`${BUCKET_MANUEL}/contents.json`])
	})

	it('un sommaire absent est une erreur, jamais un manuel vide', async () => {
		const etat = await lireSommaire(stockage({}).client)
		expect(etat.statut).toBe('erreur')
	})

	it('un refus de session est classé « forbidden », une panne « network »', async () => {
		const refus = await lireSommaire(stockage({ 'contents.json': { data: null, error: { message: 'jwt', status: 403 } } }).client)
		expect(refus).toMatchObject({ statut: 'erreur', erreur: { nature: 'forbidden' } })
		const panne = await lireSommaire(stockage({ 'contents.json': () => { throw new Error('x') } }).client)
		expect(panne).toMatchObject({ statut: 'erreur', erreur: { nature: 'network' } })
	})
})

describe('lireChapitre', () => {
	it('rend le chapitre lu', async () => {
		const { client } = stockage({ 'chapters/le-board.json': json({ slug: 'le-board', title: 'Le board', blocks: [] }) })
		expect(await lireChapitre(client, 'le-board')).toEqual({ statut: 'pret', donnees: { slug: 'le-board', title: 'Le board', blocks: [] } })
	})

	it('un chapitre absent ou caché par la politique est introuvable (`null`), pas une panne', async () => {
		const { client } = stockage({ 'chapters/b.json': { data: null, error: { message: 'not found', status: 404 } } })
		expect(await lireChapitre(client, 'a')).toEqual({ statut: 'pret', donnees: null })
		expect(await lireChapitre(client, 'b')).toEqual({ statut: 'pret', donnees: null })
	})

	it.each(['../contents', 'A-majuscule', 'chapters/x', '', 'a b'])('« %s » hors de forme : introuvable, sans aucune requête', async (slug) => {
		const { client, lectures } = stockage({})
		expect(await lireChapitre(client, slug)).toEqual({ statut: 'pret', donnees: null })
		expect(lectures).toEqual([])
	})
})

describe('lireImage', () => {
	it('lit l’image sous images/, en Blob', async () => {
		const blob = new Blob(['jpeg'], { type: 'image/jpeg' })
		const { client, lectures } = stockage({ 'images/board/carte.jpg': { data: blob, error: null } })
		expect(await lireImage(client, 'board/carte.jpg')).toBe(blob)
		expect(lectures).toEqual([`${BUCKET_MANUEL}/images/board/carte.jpg`])
	})

	it('une image indisponible rend `null`, et une source hors de forme ne part jamais', async () => {
		const { client, lectures } = stockage({})
		expect(await lireImage(client, 'board/carte.jpg')).toBeNull()
		expect(await lireImage(client, '../../etc/passwd')).toBeNull()
		expect(await lireImage(client, 'board/carte.png')).toBeNull()
		expect(lectures).toEqual([`${BUCKET_MANUEL}/images/board/carte.jpg`])
	})
})
