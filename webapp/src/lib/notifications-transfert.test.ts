// @verifies CRM-156 (docs/BACKLOG.md) — tranche T4 : la notification `mail_transfer` — l'adresse `/inbox?message=`, le nombre
//           et l'objet lus dans la charge utile, l'auteur lu par une troisième lecture de `profiles`, non bloquante ; ni
//           affaire, ni organisation, ni commentaire ; une charge utile amputée rend la ligne sans lien ni auteur
// @verifies docs/SPEC-notifications.md §52 ; docs/DESIGN_SYSTEM.md §5.109 bis, §5.43 ; docs/SPEC-mail-subsystem.md §32.7

import { describe, expect, it } from 'vitest'
import { COLONNES_PROFIL_AFFICHE, type ProfilAffiche } from './identites'
import { apparier, lireBoite, type LigneNotificationLue } from './notifications'
import type { ClientCrm } from './supabase'

const TRANSFERT: LigneNotificationLue = {
	id: 'n-1',
	type: 'mail_transfer',
	read_at: null,
	created_at: '2026-11-18T10:00:00Z',
	subject_card_id: null,
	subject_organization_id: null,
	organizations: null,
	payload: { count: 3, author_id: 'u-1', message_id: 'm-1', subject: 'Devis Lumen' },
	cards: null,
}

const CAMILLE: ProfilAffiche = { id: 'u-1', full_name: 'Camille Aubert', avatar_url: null }

describe('apparier — un transfert de mails', () => {
	it('mène à l’inbox, message ouvert ; dit le nombre et l’objet ; ni affaire, ni organisation, ni extrait', () => {
		const affichee = apparier(TRANSFERT, new Map(), new Map([['u-1', CAMILLE]]))
		expect(affichee).toMatchObject({
			adresse: '/inbox?message=m-1',
			titreAffaire: null,
			nomOrganisation: null,
			adresseChannel: null,
			nomTrack: null,
			nomChannel: null,
			extrait: null,
			transfert: { nombre: 3, objet: 'Devis Lumen' },
		})
		expect(affichee.auteur?.full_name).toBe('Camille Aubert')
	})

	it('une charge utile amputée : ni lien, ni auteur, un mail, aucun objet — jamais une exception', () => {
		const affichee = apparier({ ...TRANSFERT, payload: { subject: '   ' } }, new Map(), new Map([['u-1', CAMILLE]]))
		expect(affichee.adresse).toBeNull()
		expect(affichee.auteur).toBeNull()
		expect(affichee.transfert).toEqual({ nombre: 1, objet: null })
		expect(apparier({ ...TRANSFERT, payload: null }, new Map()).transfert).toEqual({ nombre: 1, objet: null })
	})

	it('une mention ne porte pas de transfert', () => {
		const mention = apparier({ ...TRANSFERT, type: 'mention', payload: { comment_id: 'c-1' } }, new Map())
		expect(mention.transfert).toBeUndefined()
	})
})

/** Un client qui enregistre chaque lecture ; `profiles` peut échouer. */
function client(profilsEnPanne: boolean) {
	const lectures: { table: string; select: unknown; ids: unknown }[] = []
	const factice = {
		from: (table: string) => {
			const appel = { table, select: undefined as unknown, ids: undefined as unknown }
			const maillon: Record<string, unknown> = {
				select: (colonnes: unknown) => {
					appel.select = colonnes
					return maillon
				},
				order: () => maillon,
				limit: () => maillon,
				is: () => maillon,
				in: (_colonne: string, ids: unknown) => {
					appel.ids = ids
					return maillon
				},
				then: (resoudre: (r: unknown) => unknown) => {
					lectures.push(appel)
					if (table === 'notifications') return resoudre({ data: [TRANSFERT], error: null, status: 200, count: 1 })
					if (table === 'profiles')
						return resoudre(
							profilsEnPanne
								? { data: null, error: { message: 'panne' }, status: 500 }
								: { data: [CAMILLE], error: null, status: 200 },
						)
					return resoudre({ data: [], error: null, status: 200 })
				},
			}
			return maillon
		},
	} as unknown as ClientCrm
	return { factice, lectures }
}

describe('lireBoite — l’auteur d’un transfert', () => {
	it('lit les auteurs dans `profiles`, et aucune table de commentaires', async () => {
		const { factice, lectures } = client(false)
		const lu = await lireBoite(factice)
		expect(lectures.filter((a) => a.table === 'card_comments' || a.table === 'organization_comments')).toEqual([])
		const profils = lectures.find((a) => a.table === 'profiles')!
		expect(profils.select).toBe(COLONNES_PROFIL_AFFICHE)
		expect(profils.ids).toEqual(['u-1'])
		if (lu.statut !== 'pret') throw new Error('lecture attendue')
		expect(lu.donnees.notifications[0]!.auteur?.full_name).toBe('Camille Aubert')
	})

	it('une panne de `profiles` rend la boîte, la ligne sans auteur — jamais une erreur', async () => {
		const { factice } = client(true)
		const lu = await lireBoite(factice)
		if (lu.statut !== 'pret') throw new Error('lecture attendue')
		expect(lu.donnees.notifications[0]!.auteur).toBeNull()
		expect(lu.donnees.notifications[0]!.adresse).toBe('/inbox?message=m-1')
	})
})
