// @verifies CRM-114 (docs/BACKLOG.md) — tranche T2 : la bibliothèque des organisations — lecture, normalisation, refus,
//           écritures
// @verifies docs/SPEC-organisations.md §2 (ce qui est lu et écrit), §3 (dictionnaire fermé des refus ; zéro ligne est un
//           refus) ; docs/DESIGN_SYSTEM.md §5.64 (domaine en minuscules, champ facultatif vidé effacé)
// @verifies CRM-152 (docs/BACKLOG.md) — tranche T2 : l'adresse lue et écrite (le défaut jamais écrit, une valeur inconnue
//           repliée, un track mal formé ignoré), les arguments de `organization_list`, la page et ses tracks en deux appels
//           (docs/SPEC-organisations.md §8.1 à §8.3 ; docs/JOURNAL.md décision 936)
// @verifies CRM-153 (docs/BACKLOG.md) — tranche T4 : la clé `categories` de l'adresse, l'argument `p_category_ids`, et les
//           catégories de la page en un troisième appel, groupées et projetées (docs/SPEC-organisations.md §9.1, §9.3).
//           Les objets de paramètres et les comptes d'appels ci-dessous sont RÉVISÉS le 2026-11-18 pour la clé nouvelle.

import { describe, expect, it } from 'vitest'
import {
	PARAMETRES_ORGANISATIONS_PAR_DEFAUT,
	argumentsListeOrganisations,
	classerRefusOrganisation,
	creerOrganisation,
	ecrireParametresOrganisations,
	filtresOrganisationsPoses,
	lireParametresOrganisations,
	lirePageOrganisations,
	lireTracksDOrganisation,
	modifierOrganisation,
	normaliserSaisieOrganisation,
	sansFiltresOrganisations,
} from './organisations'
import type { ClientCrm } from './supabase'

type Reponse = { data?: unknown; error?: { code?: string; message: string } | null; status?: number }

function double(reponse: Reponse) {
	const appels: { methode: string; charge?: unknown; filtres: string[]; select?: string; ordres: string[] }[] = []
	const client = {
		from: (table: string) => {
			const appel = { methode: '', table, charge: undefined as unknown, filtres: [] as string[], select: undefined as string | undefined, ordres: [] as string[] }
			const chaine: Record<string, unknown> = {
				select: (c: string) => { appel.select = c; return chaine },
				order: (c: string) => { appel.ordres.push(c); return chaine },
				eq: (c: string, v: string) => { appel.filtres.push(`${c}=${v}`); return chaine },
				insert: (charge: unknown) => { appel.methode = 'insert'; appel.charge = charge; return chaine },
				update: (charge: unknown) => { appel.methode = 'update'; appel.charge = charge; return chaine },
				then: (resoudre: (v: unknown) => unknown) =>
					Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null, status: reponse.status ?? 200 }).then(resoudre),
			}
			appels.push(appel)
			return chaine
		},
	} as unknown as ClientCrm
	return { client, appels }
}

describe('normaliserSaisieOrganisation', () => {
	it('rogne, met le domaine en minuscules, et efface un champ facultatif blanc', () => {
		expect(normaliserSaisieOrganisation({ nom: ' Sogexia ', domaine: ' Sogexia.FR ', siteWeb: '  ' })).toEqual({
			name: 'Sogexia', domain: 'sogexia.fr', website: null,
		})
		expect(normaliserSaisieOrganisation({ nom: 'x', domaine: '', siteWeb: ' https://x.fr ' })).toEqual({
			name: 'x', domain: null, website: 'https://x.fr',
		})
	})
})

describe('classerRefusOrganisation (docs/SPEC-organisations.md §3)', () => {
	it.each([
		[409, '23505', 'duplicate key value violates unique constraint "organizations_workspace_domain_key"', 'domaine-pris'],
		[400, '23514', 'violates check constraint "organizations_name_check"', 'nom-invalide'],
		[400, '23514', 'violates check constraint "organizations_domain_check"', 'domaine-invalide'],
		[400, '23514', 'violates check constraint "organizations_website_check"', 'site-invalide'],
		[400, '23514', 'violates check constraint "autre"', 'inconnu'],
		[403, '42501', 'new row violates row-level security policy', 'interdit'],
		[401, undefined, 'JWT expired', 'interdit'],
		[undefined, undefined, 'Failed to fetch', 'reseau'],
		[500, 'XX000', 'boum', 'inconnu'],
	] as const)('%s %s → %s', (statut, code, message, nature) => {
		expect(classerRefusOrganisation(statut, code, message)).toBe(nature)
	})
})

const T1 = '5eed0000-0000-4000-8000-000000000021'
const T2 = '5eed0000-0000-4000-8000-000000000023'

describe('l’adresse de l’onglet (§8.3)', () => {
	it('l’adresse nue est le défaut', () => {
		expect(lireParametresOrganisations(new URLSearchParams())).toEqual(PARAMETRES_ORGANISATIONS_PAR_DEFAUT)
	})

	it('lit chaque clé ; une valeur inconnue est repliée, un track mal formé ou répété ignoré', () => {
		const lu = lireParametresOrganisations(new URLSearchParams(
			`q=%20vertigo%20&tracks=${T1},pas-un-uuid,${T2.toUpperCase()},${T1}&categories=${T2},faux,${T2}&recettes=avec&tri=contacts&sens=desc`))
		expect(lu).toEqual({ recherche: 'vertigo', tracks: [T1, T2], categories: [T2], recettes: 'avec', tri: 'contacts', sens: 'desc' })
		expect(lireParametresOrganisations(new URLSearchParams('recettes=peut-etre&tri=recettes&sens=haut'))).toEqual(
			PARAMETRES_ORGANISATIONS_PAR_DEFAUT)
	})

	it('le défaut n’est jamais écrit ; les clés étrangères sont gardées ; l’aller-retour est fidèle', () => {
		expect(ecrireParametresOrganisations(PARAMETRES_ORGANISATIONS_PAR_DEFAUT).toString()).toBe('')
		const parametres = { recherche: 'lumen', tracks: [T1, T2], categories: [T2], recettes: 'sans', tri: 'contacts', sens: 'desc' } as const
		const ecrite = ecrireParametresOrganisations(parametres, new URLSearchParams('autre=1&q=ancienne'))
		expect(ecrite.get('autre')).toBe('1')
		expect(ecrite.getAll('q')).toEqual(['lumen'])
		expect(lireParametresOrganisations(ecrite)).toEqual(parametres)
		expect(ecrireParametresOrganisations({ ...parametres, recherche: '   ' }).has('q')).toBe(false)
	})

	it('un filtre est posé par la recherche, un track ou les recettes — jamais par le tri ; effacer garde le tri', () => {
		expect(filtresOrganisationsPoses({ ...PARAMETRES_ORGANISATIONS_PAR_DEFAUT, tri: 'contacts', sens: 'desc' })).toBe(false)
		expect(filtresOrganisationsPoses({ ...PARAMETRES_ORGANISATIONS_PAR_DEFAUT, recherche: 'a' })).toBe(true)
		expect(filtresOrganisationsPoses({ ...PARAMETRES_ORGANISATIONS_PAR_DEFAUT, tracks: [T1] })).toBe(true)
		expect(filtresOrganisationsPoses({ ...PARAMETRES_ORGANISATIONS_PAR_DEFAUT, recettes: 'avec' })).toBe(true)
		expect(filtresOrganisationsPoses({ ...PARAMETRES_ORGANISATIONS_PAR_DEFAUT, categories: [T2] })).toBe(true)
		expect(sansFiltresOrganisations({ recherche: 'a', tracks: [T1], categories: [T2], recettes: 'avec', tri: 'contacts', sens: 'desc' })).toEqual(
			{ ...PARAMETRES_ORGANISATIONS_PAR_DEFAUT, tri: 'contacts', sens: 'desc' })
	})
})

describe('les arguments de `organization_list` (§8.2)', () => {
	it('le défaut : tout, par nom ascendant, cinquante à partir du décalage', () => {
		expect(argumentsListeOrganisations('ws', PARAMETRES_ORGANISATIONS_PAR_DEFAUT, 50)).toEqual({
			p_workspace_id: 'ws', p_search: undefined, p_track_ids: undefined, p_category_ids: undefined, p_revenues: 'all', p_sort: 'name',
			p_descending: false, p_limit: 50, p_offset: 50,
		})
	})
	it('chaque filtre et le tri traduits dans les valeurs de la base', () => {
		expect(argumentsListeOrganisations('ws', { recherche: ' 100% ', tracks: [T1], categories: [T2], recettes: 'sans', tri: 'contacts', sens: 'desc' }, 0))
			.toMatchObject({ p_search: '100%', p_track_ids: [T1], p_category_ids: [T2], p_revenues: 'without', p_sort: 'contacts', p_descending: true })
		expect(argumentsListeOrganisations('ws', { ...PARAMETRES_ORGANISATIONS_PAR_DEFAUT, recettes: 'avec' }, 0).p_revenues).toBe('with')
	})
})

/**
 * Un client dont `rpc` répond selon la fonction appelée, et qui garde chaque appel. *Révisé le 2026-11-18 (`CRM-153` T4)* :
 * la lecture des catégories passe par `from('organization_category_links')`, notée sous ce nom, avec ses identifiants.
 */
function doubleRpc(reponses: Record<string, Reponse>) {
	const appels: [string, unknown][] = []
	const client = {
		rpc: (nom: string, args: unknown) => {
			appels.push([nom, args])
			const r = reponses[nom] ?? { data: [] }
			return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 })
		},
		from: (table: string) => ({
			select: () => ({
				in: (_colonne: string, ids: unknown) => {
					appels.push([table, ids])
					const r = reponses[table] ?? { data: [] }
					return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 })
				},
			}),
		}),
	} as unknown as ClientCrm
	return { client, appels }
}

const LIGNE = (id: string, name: string, extra: object = {}) => ({
	id, name, domain: null, website: null, contacts: 2, has_revenues: false, total_count: 132, ...extra,
})

describe('lirePageOrganisations', () => {
	it('trois appels, pas un par ligne : la page, puis les tracks et les catégories de ses organisations', async () => {
		const { client, appels } = doubleRpc({
			organization_list: { data: [LIGNE('o1', 'Atelier Lumen', { has_revenues: true }), LIGNE('o2', 'Comptoir Vasseur')] },
			organization_tracks: { data: [
				{ organization_id: 'o1', track_id: T1, name: 'Conseil IA', slug: 'conseil-ia', color: 'brand', icon: 'Brain' },
				{ organization_id: 'o1', track_id: T2, name: 'Formation', slug: 'formation', color: 'success', icon: 'GraduationCap' },
			] },
		})
		const etat = await lirePageOrganisations(client, 'ws', PARAMETRES_ORGANISATIONS_PAR_DEFAUT, 0)
		expect(appels.map(([nom]) => nom)).toEqual(['organization_list', 'organization_tracks', 'organization_category_links'])
		expect(appels[1]?.[1]).toEqual({ p_organization_ids: ['o1', 'o2'] })
		expect(appels[2]?.[1]).toEqual(['o1', 'o2'])
		expect(etat).toMatchObject({ statut: 'pret', donnees: { total: 132 } })
		if (etat.statut !== 'pret') throw new Error('page attendue')
		expect(etat.donnees.organisations.map((o) => [o.name, o.aRecettes, o.tracks.map((t) => t.slug)])).toEqual([
			['Atelier Lumen', true, ['conseil-ia', 'formation']],
			['Comptoir Vasseur', false, []],
		])
	})

	it('les catégories de chaque organisation, groupées, actives puis archivées, chacune par nom', async () => {
		const { client } = doubleRpc({
			organization_list: { data: [LIGNE('o1', 'Atelier Lumen'), LIGNE('o2', 'Comptoir Vasseur')] },
			organization_category_links: { data: [
				{ organization_id: 'o1', categorie: { id: 'c3', name: 'Ancien client', color: 'neutral', archived_at: '2026-11-18T00:00:00Z' } },
				{ organization_id: 'o1', categorie: { id: 'c2', name: 'Partenaire', color: 'success', archived_at: null } },
				{ organization_id: 'o1', categorie: { id: 'c1', name: 'Client', color: 'brand', archived_at: null } },
			] },
		})
		const etat = await lirePageOrganisations(client, 'ws', PARAMETRES_ORGANISATIONS_PAR_DEFAUT, 0)
		if (etat.statut !== 'pret') throw new Error('page attendue')
		expect(etat.donnees.organisations.map((o) => o.categories.map((c) => c.nom))).toEqual([
			['Client', 'Partenaire', 'Ancien client'],
			[],
		])
	})

	it('une page vide : total nul, et aucun appel des tracks', async () => {
		const { client, appels } = doubleRpc({ organization_list: { data: [] } })
		expect(await lirePageOrganisations(client, 'ws', PARAMETRES_ORGANISATIONS_PAR_DEFAUT, 0)).toEqual({
			statut: 'pret', donnees: { organisations: [], total: 0 } })
		expect(appels).toHaveLength(1)
	})

	it('un échec de l’un ou l’autre appel rend une erreur classée, jamais une liste vide trompeuse', async () => {
		expect(await lirePageOrganisations(doubleRpc({ organization_list: { error: { message: 'refus' }, status: 403 } }).client,
			'ws', PARAMETRES_ORGANISATIONS_PAR_DEFAUT, 0)).toMatchObject({ statut: 'erreur', erreur: { nature: 'forbidden' } })
		expect(await lirePageOrganisations(doubleRpc({
			organization_list: { data: [LIGNE('o1', 'Atelier Lumen')] },
			organization_tracks: { error: { message: 'boum' }, status: 500 },
		}).client, 'ws', PARAMETRES_ORGANISATIONS_PAR_DEFAUT, 0)).toMatchObject({ statut: 'erreur', erreur: { nature: 'unknown' } })
	})
})

describe('lireTracksDOrganisation (la fiche)', () => {
	it('les tracks de la seule organisation demandée ; aucun, une liste vide', async () => {
		const { client, appels } = doubleRpc({ organization_tracks: { data: [
			{ organization_id: 'o1', track_id: T2, name: 'Formation', slug: 'formation', color: 'success', icon: 'GraduationCap' },
		] } })
		expect(await lireTracksDOrganisation(client, 'o1')).toEqual({ statut: 'pret', donnees: [
			{ id: T2, name: 'Formation', slug: 'formation', color: 'success', icon: 'GraduationCap' }] })
		expect(appels).toEqual([['organization_tracks', { p_organization_ids: ['o1'] }]])
		expect(await lireTracksDOrganisation(doubleRpc({}).client, 'o9')).toEqual({ statut: 'pret', donnees: [] })
	})
})

describe('créer et modifier', () => {
	it('crée dans l’espace donné, avec la saisie normalisée, et rend l’identifiant', async () => {
		const { client, appels } = double({ data: [{ id: 'neuve' }], status: 201 })
		expect(await creerOrganisation(client, 'ws', { nom: 'Atelier', domaine: 'Atelier.FR', siteWeb: '' })).toEqual({
			statut: 'enregistree', id: 'neuve',
		})
		expect(appels[0]?.charge).toEqual({ workspace_id: 'ws', name: 'Atelier', domain: 'atelier.fr', website: null })
	})

	it('modifie l’organisation ciblée ; zéro ligne est un refus, jamais un succès', async () => {
		const { client, appels } = double({ data: [] })
		expect(await modifierOrganisation(client, 'o1', { nom: 'X', domaine: '', siteWeb: '' })).toEqual({
			statut: 'refus', nature: 'interdit',
		})
		expect(appels[0]?.filtres).toEqual(['id=o1'])
		expect(appels[0]?.charge).toEqual({ name: 'X', domain: null, website: null })
	})

	it('traduit le domaine déjà pris', async () => {
		const { client } = double({ error: { code: '23505', message: 'duplicate key' }, status: 409 })
		expect(await creerOrganisation(client, 'ws', { nom: 'X', domaine: 'x.fr', siteWeb: '' })).toEqual({
			statut: 'refus', nature: 'domaine-pris',
		})
	})
})
