// @verifies CRM-153 (docs/BACKLOG.md) — tranche T3 : la notification d'une mention dans le fil d'une organisation — son
//           adresse (la fiche, à l'ancre du commentaire), le nom de l'organisation, l'auteur et l'extrait lus dans
//           `organization_comments`, et la lecture de la boîte qui interroge chaque table de commentaires selon le sujet
// @verifies docs/SPEC-organisations.md §9.2, §9.3 ; docs/DESIGN_SYSTEM.md §5.107, §5.43

import { describe, expect, it } from 'vitest'
import { COLONNES_COMMENTAIRE_MENTION_ORGANISATION } from './colonnes-notifications'
import { apparier, lireBoite, type LigneCommentaireCite, type LigneNotificationLue } from './notifications'
import type { ClientCrm } from './supabase'

const MENTION_ORGANISATION: LigneNotificationLue = {
	id: 'n-1',
	type: 'mention',
	read_at: null,
	created_at: '2026-11-18T10:00:00Z',
	subject_card_id: null,
	subject_organization_id: 'org-1',
	organizations: { id: 'org-1', name: 'Vertigo Conseil' },
	payload: { comment_id: 'c-1', author_id: 'u-1' },
	cards: null,
}

const CITE: LigneCommentaireCite = {
	id: 'c-1',
	body: 'Peux-tu relancer leur directeur ?',
	deleted_at: null,
	author_id: 'u-1',
	auteur: { id: 'u-1', full_name: 'Camille Aubert', avatar_url: null },
}

describe('apparier — une mention sur une organisation', () => {
	it('mène à la fiche, à l’ancre du commentaire, et nomme l’organisation ; aucune affaire ni pilule de channel', () => {
		const affichee = apparier(MENTION_ORGANISATION, new Map([['c-1', CITE]]))
		expect(affichee).toMatchObject({
			adresse: '/contacts/organisations/org-1#commentaire-c-1',
			nomOrganisation: 'Vertigo Conseil',
			titreAffaire: null,
			adresseChannel: null,
			nomTrack: null,
			extrait: 'Peux-tu relancer leur directeur ?',
		})
		expect(affichee.auteur?.full_name).toBe('Camille Aubert')
	})

	it('une organisation illisible ne rend aucune adresse ; un commentaire supprimé, ni auteur ni extrait', () => {
		const sansOrganisation = apparier({ ...MENTION_ORGANISATION, organizations: null }, new Map([['c-1', CITE]]))
		expect(sansOrganisation.adresse).toBeNull()
		expect(sansOrganisation.nomOrganisation).toBeNull()
		const supprime = apparier(MENTION_ORGANISATION, new Map([['c-1', { ...CITE, body: '', deleted_at: '2026-11-18T11:00:00Z' }]]))
		expect(supprime.auteur).toBeNull()
		expect(supprime.extrait).toBeNull()
		expect(supprime.adresse).toBe('/contacts/organisations/org-1#commentaire-c-1')
	})

	it('une mention d’affaire garde sa forme, sans nom d’organisation', () => {
		const affaire = apparier(
			{ ...MENTION_ORGANISATION, subject_organization_id: null, organizations: null, subject_card_id: 'card-1' },
			new Map(),
		)
		expect(affaire.nomOrganisation).toBeNull()
	})
})

describe('lireBoite — les commentaires cités, table par table', () => {
	it('lit les commentaires d’organisation dans `organization_comments`, et seulement eux', async () => {
		const tables: { table: string; select: unknown; ids: unknown }[] = []
		const client = {
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
						tables.push(appel)
						if (table === 'notifications') {
							return resoudre(
								appel.select === undefined || String(appel.select).startsWith('id')
									? { data: [MENTION_ORGANISATION], error: null, status: 200, count: 1 }
									: { data: [], error: null, status: 200, count: 1 },
							)
						}
						return resoudre({ data: table === 'organization_comments' ? [CITE] : [], error: null, status: 200 })
					},
				}
				return maillon
			},
		} as unknown as ClientCrm
		const lu = await lireBoite(client)
		expect(tables.filter((a) => a.table === 'card_comments')).toEqual([])
		const organisation = tables.find((a) => a.table === 'organization_comments')!
		expect(organisation.select).toBe(COLONNES_COMMENTAIRE_MENTION_ORGANISATION)
		expect(organisation.ids).toEqual(['c-1'])
		if (lu.statut !== 'pret') throw new Error('lecture attendue')
		expect(lu.donnees.notifications[0]!.extrait).toBe('Peux-tu relancer leur directeur ?')
	})
})
