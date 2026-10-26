// @verifies CRM-072 (docs/BACKLOG.md) — tranche T2 : la lecture du journal d'audit, ses filtres d'adresse et son curseur
// @verifies docs/SPEC-audit.md §3.2 (lu sous la RLS : zéro ligne n'est pas une erreur), §7.3 (les noms des contacts lus à
//           l'affichage, un contact absent n'existant plus), §8 (filtres dans l'adresse, « Au » inclusif, pages de 50) ;
//           docs/DESIGN_SYSTEM.md §5.66 ; docs/JOURNAL.md décisions 725 à 728

import { describe, expect, it } from 'vitest'
import {
	ACTEUR_SYSTEME,
	AUCUN_FILTRE,
	contactsDe,
	curseurSuivantAudit,
	debutJour,
	ecrireFiltres,
	jourValide,
	lireFiltres,
	lireJournalAudit,
	lireNomsContacts,
	PAGE_AUDIT,
	type EntreeAudit,
} from './audit'
import type { ClientCrm } from './supabase'

const UUID = '5eed0000-0000-4000-8000-000000000011'

describe('les filtres de l’adresse', () => {
	it('lit les quatre filtres valides et les réécrit à l’identique', () => {
		const parametres = new URLSearchParams({ famille: 'access', acteur: UUID, du: '2026-10-01', au: '2026-10-26' })
		const filtres = lireFiltres(parametres)
		expect(filtres).toEqual({ famille: 'access', acteur: UUID, du: '2026-10-01', au: '2026-10-26' })
		expect(ecrireFiltres(filtres).toString()).toBe(parametres.toString())
	})

	it('ignore toute valeur inconnue au lieu de la deviner', () => {
		expect(lireFiltres(new URLSearchParams({ famille: 'mentions', acteur: 'camille', du: '2026-02-30', au: '26/10/2026' }))).toEqual(
			AUCUN_FILTRE,
		)
	})

	it('reconnaît l’acteur « système » et n’écrit rien pour un filtre absent', () => {
		expect(lireFiltres(new URLSearchParams({ acteur: ACTEUR_SYSTEME })).acteur).toBe(ACTEUR_SYSTEME)
		expect(ecrireFiltres(AUCUN_FILTRE).toString()).toBe('')
	})

	it('un jour n’est valide que s’il existe au calendrier', () => {
		expect(jourValide('2024-02-29')).toBe(true)
		expect(jourValide('2026-02-29')).toBe(false)
		expect(jourValide(null)).toBe(false)
	})

	it('« Au » inclut le jour qu’il nomme : la borne est minuit local du lendemain', () => {
		const lendemain = new Date(debutJour('2026-10-26', 1))
		expect([lendemain.getDate(), lendemain.getHours(), lendemain.getMinutes()]).toEqual([27, 0, 0])
	})
})

type Appel = readonly [string, ...unknown[]]

/** Un client qui enregistre la chaîne de requête et rend une réponse au format de PostgREST. */
function client(reponses: Record<string, { data: unknown; error: { message: string } | null; status: number }>) {
	const appels: Record<string, Appel[]> = {}
	const fake = {
		from(table: string) {
			const liste: Appel[] = []
			appels[table] = liste
			const chaine: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'is', 'gte', 'lt', 'in', 'order', 'limit']) {
				chaine[methode] = (...args: unknown[]) => {
					liste.push([methode, ...args])
					return chaine
				}
			}
			chaine.then = (ok: (r: unknown) => unknown) => Promise.resolve(reponses[table]).then(ok)
			return chaine
		},
	}
	return { client: fake as unknown as ClientCrm, appels }
}

const ligne = (id: number, extra: Record<string, unknown> = {}) => ({
	id,
	occurred_at: '2026-10-26T09:00:00Z',
	family: 'access',
	action: 'added',
	entity_type: 'member',
	entity_id: UUID,
	entity_label: 'Sabine Plateforme',
	details: { user_id: UUID, role: 'viewer' },
	actor_id: UUID,
	acteur: { full_name: 'Camille Aubert' },
	...extra,
})

describe('la lecture d’une page', () => {
	it('demande l’espace, chaque filtre, le curseur, l’ordre décroissant et la taille de page', async () => {
		const { client: c, appels } = client({ audit_log: { data: [ligne(7)], error: null, status: 200 } })
		const page = await lireJournalAudit(c, 'ws', { famille: 'access', acteur: ACTEUR_SYSTEME, du: '2026-10-01', au: '2026-10-26' }, 120)
		expect(page.statut).toBe('pret')
		const noms = (appels['audit_log'] ?? []).map((a) => a[0])
		expect(noms).toEqual(['select', 'eq', 'eq', 'is', 'gte', 'lt', 'lt', 'order', 'limit'])
		expect(appels['audit_log']).toContainEqual(['eq', 'workspace_id', 'ws'])
		expect(appels['audit_log']).toContainEqual(['eq', 'family', 'access'])
		expect(appels['audit_log']).toContainEqual(['is', 'actor_id', null])
		expect(appels['audit_log']).toContainEqual(['lt', 'id', 120])
		expect(appels['audit_log']).toContainEqual(['order', 'id', { ascending: false }])
		expect(appels['audit_log']).toContainEqual(['limit', PAGE_AUDIT])
	})

	it('un acteur nommé filtre par son identifiant', async () => {
		const { client: c, appels } = client({ audit_log: { data: [], error: null, status: 200 } })
		await lireJournalAudit(c, 'ws', { ...AUCUN_FILTRE, acteur: UUID }, null)
		expect(appels['audit_log']).toContainEqual(['eq', 'actor_id', UUID])
		expect((appels['audit_log'] ?? []).some((a) => a[0] === 'lt')).toBe(false)
	})

	it('rend chaque entrée lue, et une famille inconnue reste une ligne, sans famille', async () => {
		const { client: c } = client({
			audit_log: { data: [ligne(7), ligne(6, { family: 'autre', details: [1], acteur: null, actor_id: null })], error: null, status: 200 },
		})
		const page = await lireJournalAudit(c, 'ws', AUCUN_FILTRE, null)
		expect(page.statut === 'pret' && page.donnees.map((e) => [e.id, e.famille, e.acteur])).toEqual([
			[7, 'access', 'Camille Aubert'],
			[6, null, null],
		])
		expect(page.statut === 'pret' && page.donnees[1]?.details).toEqual({})
	})

	it('zéro ligne n’est pas une erreur ; un refus et une panne en sont, classés', async () => {
		const vide = await lireJournalAudit(client({ audit_log: { data: [], error: null, status: 200 } }).client, 'ws', AUCUN_FILTRE, null)
		expect(vide).toEqual({ statut: 'pret', donnees: [] })
		const refus = await lireJournalAudit(
			client({ audit_log: { data: null, error: { message: 'permission denied' }, status: 403 } }).client,
			'ws',
			AUCUN_FILTRE,
			null,
		)
		expect(refus.statut === 'erreur' && refus.erreur.nature).toBe('forbidden')
	})
})

describe('le curseur et les contacts', () => {
	const entree = (id: number, objet = 'member', idObjet: string | null = UUID): EntreeAudit => ({
		id,
		date: '2026-10-26T09:00:00Z',
		famille: 'access',
		action: 'added',
		objet,
		idObjet,
		libelle: null,
		details: {},
		idActeur: null,
		acteur: null,
	})

	it('une page pleine désigne son identifiant le plus ancien ; une page incomplète n’a pas de suite', () => {
		const pleine = Array.from({ length: PAGE_AUDIT }, (_, i) => entree(200 - i))
		expect(curseurSuivantAudit(pleine)).toBe(200 - PAGE_AUDIT + 1)
		expect(curseurSuivantAudit(pleine.slice(1))).toBeNull()
	})

	it('ne cherche que les contacts nommés par une entrée, et lit leur nom dans le carnet', async () => {
		expect(contactsDe([entree(1), entree(2, 'contact', 'c1'), entree(3, 'contact', null)])).toEqual(['c1'])
		const { client: c, appels } = client({ contacts: { data: [{ id: 'c1', full_name: 'Léo Marchand' }], error: null, status: 200 } })
		const noms = await lireNomsContacts(c, ['c1', 'c1'])
		expect(noms.get('c1')).toBe('Léo Marchand')
		expect(appels['contacts']).toContainEqual(['in', 'id', ['c1']])
	})

	it('sans contact à nommer, rien ne part ; un échec rend une table vide, jamais une erreur de l’écran', async () => {
		const { client: c, appels } = client({ contacts: { data: null, error: { message: 'x' }, status: 500 } })
		expect((await lireNomsContacts(c, [])).size).toBe(0)
		expect(appels['contacts']).toBeUndefined()
		expect((await lireNomsContacts(c, ['c1'])).size).toBe(0)
	})
})
