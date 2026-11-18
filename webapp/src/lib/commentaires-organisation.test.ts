// @verifies CRM-153 (docs/BACKLOG.md) — tranche T3 : la lecture du fil d'une organisation (colonnes, ordre, projection de
//           l'affaire réemployée), la publication sans espace, les gestes d'auteur et les mentions sur les tables de
//           l'organisation, les mentionnables (membres de l'espace moins l'appelant), la lecture et la pose des catégories,
//           et le dictionnaire fermé des refus d'une pose
// @verifies docs/SPEC-organisations.md §9.1, §9.2 ; docs/DESIGN_SYSTEM.md §5.107, §5.44
//
// Les droits réels sont éprouvés contre la vraie base par `supabase/tests/0176_commentaires_categories_organisations.test.sql`
// et `e2e/api/commentaires-categories-organisations.spec.ts` (CLAUDE.md §10).

import { describe, expect, it } from 'vitest'
import {
	classerRefusPose,
	COLONNES_COMMENTAIRE_ORGANISATION,
	lireCategoriesDeLOrganisation,
	lireCommentairesOrganisation,
	lireMentionnablesOrganisation,
	modifierCommentaireOrganisation,
	poserCategorie,
	poserMentionsOrganisation,
	publierCommentaireOrganisation,
	supprimerCommentaireOrganisation,
} from './commentaires-organisation'
import type { ClientCrm } from './supabase'

type Appel = { readonly methode: string; readonly args: readonly unknown[] }

/** Un client espion : chaque chaîne note ses appels et rend `reponse`. */
function espion(reponse: unknown) {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => {
			appels.push({ methode: 'from', args: [table] })
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
				maillon[methode] = (...args: unknown[]) => {
					appels.push({ methode, args })
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => resoudre(reponse)
			return maillon
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const ligne = (id: string, created_at: string, autres: Record<string, unknown> = {}) => ({
	id,
	organization_id: 'org-1',
	author_id: 'u-1',
	body: `Corps ${id}`,
	created_at,
	edited_at: null,
	deleted_at: null,
	deleted_by: null,
	auteur: { id: 'u-1', full_name: 'Camille Aubert', avatar_url: null },
	...autres,
})

describe('lireCommentairesOrganisation', () => {
	it('lit le fil de l’organisation, dans l’ordre croissant, pierres tombales comprises et modération dite', async () => {
		const { client, appels } = espion({
			data: [
				ligne('b', '2026-11-18T10:00:00Z'),
				ligne('a', '2026-11-18T09:00:00Z', { body: '', deleted_at: '2026-11-18T11:00:00Z', deleted_by: 'u-admin' }),
			],
			error: null,
			status: 200,
		})
		const lu = await lireCommentairesOrganisation(client, 'org-1')
		expect(appels.slice(0, 3)).toEqual([
			{ methode: 'from', args: ['organization_comments'] },
			{ methode: 'select', args: [COLONNES_COMMENTAIRE_ORGANISATION] },
			{ methode: 'eq', args: ['organization_id', 'org-1'] },
		])
		expect(COLONNES_COMMENTAIRE_ORGANISATION).toContain('profiles!organization_comments_author_id_fkey')
		if (lu.statut !== 'pret') throw new Error('lecture attendue')
		expect(lu.donnees.map((c) => [c.id, c.supprime, c.retireParModeration])).toEqual([
			['a', true, true],
			['b', false, false],
		])
	})

	it('un échec est une erreur classée, jamais un fil vide', async () => {
		const { client } = espion({ data: null, error: { message: 'fetch failed' }, status: 0 })
		expect((await lireCommentairesOrganisation(client, 'org-1')).statut).toBe('erreur')
	})
})

describe('publier et les gestes d’auteur', () => {
	it('la publication n’envoie ni l’espace ni l’auteur : la base les pose (le privilège ne les accorde pas)', async () => {
		const { client, appels } = espion({ data: [{ id: 'c-1' }], error: null, status: 201 })
		expect(await publierCommentaireOrganisation(client, 'org-1', 'Bonjour')).toEqual({ statut: 'publie', idCommentaire: 'c-1' })
		expect(appels[0]).toEqual({ methode: 'from', args: ['organization_comments'] })
		expect(appels.find((a) => a.methode === 'insert')!.args[0]).toEqual({ organization_id: 'org-1', body: 'Bonjour' })
	})

	it('un refus est traduit par le dictionnaire du fil d’une affaire', async () => {
		const { client } = espion({ data: null, error: { code: '42501', message: 'rls' }, status: 403 })
		const issue = await publierCommentaireOrganisation(client, 'org-1', 'x')
		expect(issue.statut === 'refus' && issue.refus.nature).toBe('forbidden')
	})

	it('modifier et supprimer visent `organization_comments` ; zéro ligne est « sans effet »', async () => {
		const modif = espion({ data: [{ id: 'c-1' }], error: null, status: 200 })
		expect(await modifierCommentaireOrganisation(modif.client, 'c-1', 'Corrigé')).toEqual({ statut: 'applique' })
		expect(modif.appels[0]).toEqual({ methode: 'from', args: ['organization_comments'] })
		expect(modif.appels.find((a) => a.methode === 'update')!.args[0]).toEqual({ body: 'Corrigé' })
		const suppr = espion({ data: [], error: null, status: 200 })
		expect(await supprimerCommentaireOrganisation(suppr.client, 'c-1')).toEqual({ statut: 'sans-effet' })
		expect(suppr.appels[0]).toEqual({ methode: 'from', args: ['organization_comments'] })
		expect((suppr.appels.find((a) => a.methode === 'update')!.args[0] as { body: string }).body).toBe('')
	})
})

describe('les mentions', () => {
	it('les mentionnables sont les membres de l’espace, moins l’appelant et les profils sans nom, dans l’ordre du nom', async () => {
		const { client, appels } = espion({
			data: [
				{ user_id: 'u-3', profiles: { id: 'u-3', full_name: 'Farida Nowak', avatar_url: null } },
				{ user_id: 'u-1', profiles: { id: 'u-1', full_name: 'Camille Aubert', avatar_url: null } },
				{ user_id: 'u-2', profiles: { id: 'u-2', full_name: 'Driss Benali', avatar_url: 'a.png' } },
				{ user_id: 'u-4', profiles: null },
			],
			error: null,
			status: 200,
		})
		const lu = await lireMentionnablesOrganisation(client, 'ws-1', 'u-1')
		expect(appels.find((a) => a.methode === 'eq')!.args).toEqual(['workspace_id', 'ws-1'])
		if (lu.statut !== 'pret') throw new Error('lecture attendue')
		expect(lu.donnees).toEqual([
			{ id: 'u-2', nom: 'Driss Benali', avatar: 'a.png' },
			{ id: 'u-3', nom: 'Farida Nowak', avatar: null },
		])
	})

	it('les mentions se posent dans `organization_comment_mentions`, une par une ; un refus nommé est attribué', async () => {
		const { client, appels } = espion({ data: null, error: { code: 'P0001', message: 'mention_destinataire_sans_acces' }, status: 400 })
		const issues = await poserMentionsOrganisation(client, 'c-1', 'ws-1', [{ id: 'u-2', nom: 'Driss Benali', avatar: null }])
		expect(appels[0]).toEqual({ methode: 'from', args: ['organization_comment_mentions'] })
		// L'espace n'est pas envoyé : la 0188 n'accorde l'insertion que sur `comment_id` et `profile_id`.
		expect(appels.find((a) => a.methode === 'insert')!.args[0]).toEqual({ comment_id: 'c-1', profile_id: 'u-2' })
		expect(issues).toEqual([
			{
				personne: { id: 'u-2', nom: 'Driss Benali', avatar: null },
				statut: 'refus',
				nature: 'destinataire-sans-acces',
				detail: 'mention_destinataire_sans_acces',
			},
		])
	})
})

describe('les catégories d’une organisation', () => {
	it('se lisent par leurs poses, embarquant le catalogue ; actives puis archivées, dans l’ordre du nom', async () => {
		const { client, appels } = espion({
			data: [
				{ categorie: { id: 'c-ancien', name: 'Ancien client', color: 'neutral', archived_at: '2026-11-18T00:00:00Z' } },
				{ categorie: { id: 'c-part', name: 'Partenaire', color: 'success', archived_at: null } },
				{ categorie: { id: 'c-client', name: 'Client', color: 'brand', archived_at: null } },
				{ categorie: null },
			],
			error: null,
			status: 200,
		})
		const lu = await lireCategoriesDeLOrganisation(client, 'org-1')
		expect(appels[0]).toEqual({ methode: 'from', args: ['organization_category_links'] })
		if (lu.statut !== 'pret') throw new Error('lecture attendue')
		expect(lu.donnees.map((c) => [c.nom, c.archivee])).toEqual([
			['Client', false],
			['Partenaire', false],
			['Ancien client', true],
		])
	})

	it('poser insère le couple sans l’espace ; retirer supprime la ligne du couple', async () => {
		const pose = espion({ data: [{ category_id: 'c-1' }], error: null, status: 201 })
		expect(await poserCategorie(pose.client, 'org-1', 'c-1', true)).toEqual({ statut: 'applique' })
		expect(pose.appels.find((a) => a.methode === 'insert')!.args[0]).toEqual({ organization_id: 'org-1', category_id: 'c-1' })
		const retrait = espion({ data: [{ category_id: 'c-1' }], error: null, status: 200 })
		expect(await poserCategorie(retrait.client, 'org-1', 'c-1', false)).toEqual({ statut: 'applique' })
		expect(retrait.appels.filter((a) => a.methode === 'eq').map((a) => a.args)).toEqual([
			['organization_id', 'org-1'],
			['category_id', 'c-1'],
		])
		expect(retrait.appels.some((a) => a.methode === 'delete')).toBe(true)
	})

	it('une catégorie archivée est refusée et nommée ; un retrait filtré est « sans effet »', async () => {
		const archivee = espion({ data: null, error: { code: '22023', message: 'category_archived' }, status: 400 })
		expect(await poserCategorie(archivee.client, 'org-1', 'c-1', true)).toEqual({ statut: 'refus', nature: 'archivee' })
		const filtre = espion({ data: [], error: null, status: 200 })
		expect(await poserCategorie(filtre.client, 'org-1', 'c-1', false)).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})

	it.each([
		[400, '22023', 'category_archived', 'archivee'],
		[400, '22023', 'category_other_workspace', 'unknown'],
		[409, '23505', 'duplicate', 'deja-posee'],
		[403, '42501', 'rls', 'forbidden'],
		[0, undefined, 'fetch failed', 'network'],
	] as const)('statut %s, code %s, détail %s → %s', (statut, code, detail, nature) => {
		expect(classerRefusPose(statut, code, detail)).toBe(nature)
	})
})
