// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.a : les anciennes adresses reconnues et menées dans l'espace de leur
//           ressource — le message, le mail préparé, l'affaire, le premier espace par nom qui porte le slug du track —, sinon
//           dans l'espace de repli ; une ressource illisible ou une panne ne devinent jamais un espace
// @verifies docs/SPEC-espace-courant.md §8.2, §15.4 ; docs/JOURNAL.md décision 967

import { describe, expect, it } from 'vitest'
import { espaceDeLAncienneAdresse, reconnaitre } from './ancienne-adresse'
import type { ClientCrm } from './supabase'

const ESPACES = [
	{ id: 'w-1', name: 'P2Enjoy SAS', slug: 'p2enjoy' },
	{ id: 'w-2', name: 'Studio Lumen', slug: 'studio-lumen' },
]

/** Un client qui rend, par table, les lignes données ; note chaque lecture. */
function client(lignes: Record<string, unknown[] | Error>) {
	const lectures: { table: string; filtres: [string, unknown][] }[] = []
	const faux = {
		from: (table: string) => {
			const lecture = { table, filtres: [] as [string, unknown][] }
			lectures.push(lecture)
			const chaine: Record<string, unknown> = {}
			chaine['select'] = () => chaine
			chaine['eq'] = (c: string, v: unknown) => {
				lecture.filtres.push([c, v])
				return chaine
			}
			chaine['is'] = () => chaine
			chaine['limit'] = () => chaine
			chaine['then'] = (resoudre: (r: unknown) => unknown, rejeter: (e: unknown) => unknown) => {
				const reponse = lignes[table]
				if (reponse instanceof Error) return Promise.reject(reponse).then(resoudre, rejeter)
				return Promise.resolve({ data: reponse ?? [], error: null, status: 200 }).then(resoudre)
			}
			return chaine
		},
	} as unknown as ClientCrm
	return { client: faux, lectures }
}

describe('reconnaître une ancienne adresse (§15.4)', () => {
	it('les quatre familles, et rien d’autre', () => {
		expect(reconnaitre('/inbox', '?message=m-1')).toEqual({ genre: 'inbox', idMessage: 'm-1', idBrouillon: null })
		expect(reconnaitre('/inbox', '?brouillon=d-1')).toEqual({ genre: 'inbox', idMessage: null, idBrouillon: 'd-1' })
		expect(reconnaitre('/tracks/conseil/grands-comptes/cards/c-1', '')).toEqual({ genre: 'affaire', idCard: 'c-1' })
		expect(reconnaitre('/tracks/conseil/grands-comptes/liste', '')).toEqual({ genre: 'track', slugTrack: 'conseil' })
		expect(reconnaitre('/tracks/conseil/couts/b-1', '')).toEqual({ genre: 'track', slugTrack: 'conseil' })
		expect(reconnaitre('/reglages/etiquettes', '')).toEqual({ genre: 'reglages' })
		expect(reconnaitre('/contacts', '')).toBeNull()
	})
})

describe('l’espace où la mener (§15.4)', () => {
	it('un message, un mail préparé, une affaire : l’espace de la ressource', async () => {
		const { client: c, lectures } = client({ mail_messages: [{ workspace_id: 'w-2' }], mail_drafts: [{ workspace_id: 'w-2' }], cards: [{ workspace_id: 'w-2' }] })
		expect(await espaceDeLAncienneAdresse(c, { genre: 'inbox', idMessage: 'm-1', idBrouillon: null }, ESPACES, 'p2enjoy')).toBe('studio-lumen')
		expect(await espaceDeLAncienneAdresse(c, { genre: 'inbox', idMessage: null, idBrouillon: 'd-1' }, ESPACES, 'p2enjoy')).toBe('studio-lumen')
		expect(await espaceDeLAncienneAdresse(c, { genre: 'affaire', idCard: 'c-1' }, ESPACES, 'p2enjoy')).toBe('studio-lumen')
		expect(lectures.map((l) => [l.table, l.filtres])).toEqual([
			['mail_messages', [['id', 'm-1']]],
			['mail_drafts', [['id', 'd-1']]],
			['cards', [['id', 'c-1']]],
		])
	})

	it('un track : le premier espace PAR NOM qui en porte un de ce slug', async () => {
		const { client: c } = client({ tracks: [{ workspace_id: 'w-2' }, { workspace_id: 'w-1' }] })
		expect(await espaceDeLAncienneAdresse(c, { genre: 'track', slugTrack: 'conseil' }, ESPACES, 'studio-lumen')).toBe('p2enjoy')
	})

	it('une ressource illisible, une panne, les réglages : l’espace de repli, jamais un espace deviné', async () => {
		const { client: vide } = client({})
		expect(await espaceDeLAncienneAdresse(vide, { genre: 'affaire', idCard: 'c-x' }, ESPACES, 'studio-lumen')).toBe('studio-lumen')
		expect(await espaceDeLAncienneAdresse(vide, { genre: 'track', slugTrack: 'absent' }, ESPACES, 'studio-lumen')).toBe('studio-lumen')
		const { client: panne } = client({ cards: new Error('fetch failed') })
		expect(await espaceDeLAncienneAdresse(panne, { genre: 'affaire', idCard: 'c-1' }, ESPACES, 'p2enjoy')).toBe('p2enjoy')
		expect(await espaceDeLAncienneAdresse(vide, { genre: 'reglages' }, ESPACES, 'studio-lumen')).toBe('studio-lumen')
		// Un espace rendu mais non lu par la personne (droits changés) ne s'impose pas.
		const { client: ailleurs } = client({ cards: [{ workspace_id: 'w-9' }] })
		expect(await espaceDeLAncienneAdresse(ailleurs, { genre: 'affaire', idCard: 'c-1' }, ESPACES, 'p2enjoy')).toBe('p2enjoy')
	})
})
