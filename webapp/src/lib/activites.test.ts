// @verifies CRM-067 (docs/BACKLOG.md) — tranche T2 : la bibliothèque des activités — lecture, ordre, refus traduits,
//           écritures et participants
// @verifies docs/SPEC-activites.md §2 (type fermé, date jamais future, durée entière, sujet, compte rendu), §3 (auteur et
//           espace posés par la base, pierre tombale, participants écrits par différence), §5 (dictionnaire fermé des
//           refus) ; docs/DESIGN_SYSTEM.md §5.63 (la plus récente en tête ; échec partiel des participants)
//
// Le client est un double qui ENREGISTRE chaque appel : ce que ces tests prouvent, c'est la requête émise et l'issue
// rendue pour chaque réponse de la base. Les politiques elles-mêmes sont prouvées par la suite pgTAP `0091` et par
// `e2e/api/activites.spec.ts`, aux jetons réels.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_ACTIVITE,
	classerRefusActivite,
	consignerActivite,
	corrigerActivite,
	depuisChampLocal,
	lireActivites,
	lireDuree,
	projeterActivites,
	retirerActivite,
	versChampLocal,
	type ActiviteLue,
	type SaisieActivite,
} from './activites'
import type { ClientCrm } from './supabase'

function lue(partiel: Partial<ActiviteLue> & { id: string }): ActiviteLue {
	return {
		card_id: 'card-1',
		type: 'call',
		occurred_at: '2026-10-20T09:00:00+00:00',
		duration_minutes: null,
		subject: 'Sujet',
		body: null,
		author_id: 'auteur',
		created_at: '2026-10-20T10:00:00+00:00',
		edited_at: null,
		deleted_at: null,
		deleted_by: null,
		auteur: null,
		participants: [],
		...partiel,
	}
}

const saisie = (partiel: Partial<SaisieActivite> = {}): SaisieActivite => ({
	type: 'meeting',
	survenueLe: '2026-10-20T09:00:00.000Z',
	dureeMinutes: 45,
	sujet: 'Cadrage',
	compteRendu: '',
	contacts: [],
	membres: [],
	...partiel,
})

type Appel = { readonly table: string; readonly geste: string; readonly charge?: unknown; readonly filtres: string[] }
type Reponse = { data?: unknown; error?: { code?: string; message: string } | null; status?: number }

/**
 * Un client qui note chaque appel et rend, pour chaque geste, la réponse fournie par le test.
 *
 * `reponses` est consultée par `table:geste` ; une fonction reçoit l'appel, pour qu'un participant précis puisse être
 * refusé et les autres acceptés.
 */
function clientDouble(reponses: Record<string, Reponse | ((appel: Appel) => Reponse)>) {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => {
			const chaine = (geste: string, charge?: unknown) => {
				const appel: Appel = { table, geste, charge, filtres: [] }
				appels.push(appel)
				const repondre = () => {
					const fournie = reponses[`${table}:${geste}`] ?? {}
					const r = typeof fournie === 'function' ? fournie(appel) : fournie
					return { data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 }
				}
				const objet: Record<string, unknown> = {
					eq: (colonne: string, valeur: string) => {
						appel.filtres.push(`${colonne}=${valeur}`)
						return objet
					},
					select: (colonnes?: string) => {
						appel.filtres.push(`select:${colonnes ?? ''}`)
						return objet
					},
					single: () => objet,
					then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(repondre()).then(resoudre),
				}
				return objet
			}
			return {
				select: (colonnes: string) => {
					const objet = chaine('select') as Record<string, unknown> & { eq: (c: string, v: string) => unknown }
					;(appels.at(-1) as Appel).filtres.push(`select:${colonnes}`)
					return objet
				},
				insert: (charge: unknown) => chaine('insert', charge),
				update: (charge: unknown) => chaine('update', charge),
				delete: () => chaine('delete'),
			}
		},
	} as unknown as ClientCrm
	return { client, appels }
}

describe('projeterActivites (docs/DESIGN_SYSTEM.md §5.63)', () => {
	it('range la plus récente EN TÊTE, d’un ordre total terminé par l’identifiant', () => {
		const projetees = projeterActivites([
			lue({ id: 'a', occurred_at: '2026-10-19T09:00:00+00:00' }),
			lue({ id: 'b', occurred_at: '2026-10-21T09:00:00+00:00' }),
			lue({ id: 'c', occurred_at: '2026-10-20T09:00:00+00:00' }),
			lue({ id: 'd', occurred_at: '2026-10-20T09:00:00+00:00' }),
		])
		expect(projetees.map((a) => a.id)).toEqual(['b', 'd', 'c', 'a'])
	})

	it('écarte un type hors des trois — un défaut de la contrainte, pas une valeur à deviner', () => {
		expect(projeterActivites([lue({ id: 'a', type: 'note' }), lue({ id: 'b', type: 'visio' })]).map((a) => a.id)).toEqual(['b'])
	})

	it('sépare les participants en contacts et membres, et ne nomme pas qui n’est pas lisible', () => {
		const [activite] = projeterActivites([
			lue({
				id: 'a',
				participants: [
					{ contact_id: 'k1', profile_id: null, contact: { full_name: 'Léo Marchand' }, profil: null },
					{ contact_id: null, profile_id: 'p1', contact: null, profil: { full_name: 'Camille Aubert' } },
					{ contact_id: null, profile_id: 'p2', contact: null, profil: null },
				],
			}),
		])
		expect(activite?.contacts).toEqual([{ id: 'k1', nom: 'Léo Marchand' }])
		expect(activite?.membres).toEqual([
			{ id: 'p1', nom: 'Camille Aubert' },
			{ id: 'p2', nom: null },
		])
	})

	it('ne dit « retirée par la modération » que si un AUTRE que l’auteur a posé la pierre tombale', () => {
		const projetees = projeterActivites([
			lue({ id: 'a', deleted_at: '2026-10-21T00:00:00+00:00', deleted_by: 'auteur' }),
			lue({ id: 'b', occurred_at: '2026-10-19T09:00:00+00:00', deleted_at: '2026-10-21T00:00:00+00:00', deleted_by: 'admin' }),
			lue({ id: 'c', occurred_at: '2026-10-18T09:00:00+00:00', deleted_at: '2026-10-21T00:00:00+00:00', deleted_by: null }),
			lue({ id: 'd', occurred_at: '2026-10-17T09:00:00+00:00', deleted_by: 'admin' }),
		])
		expect(projetees.map((a) => [a.id, a.retiree, a.retireeParModeration])).toEqual([
			['a', true, false],
			['b', true, true],
			['c', true, false],
			['d', false, false],
		])
	})
})

describe('lireActivites', () => {
	it('demande les colonnes exportées, filtrées sur l’affaire, auteur embarqué par sa clé NOMMÉE', async () => {
		const { client, appels } = clientDouble({ 'card_activities:select': { data: [lue({ id: 'a' })] } })
		const etat = await lireActivites(client, 'card-1')
		expect(etat.statut).toBe('pret')
		expect(appels[0]?.filtres).toEqual([`select:${COLONNES_ACTIVITE}`, 'card_id=card-1'])
		expect(COLONNES_ACTIVITE).toContain('profiles!card_activities_author_id_fkey')
	})

	it('rend une erreur classée, jamais une liste vide trompeuse', async () => {
		const { client } = clientDouble({ 'card_activities:select': { error: { message: 'refus' }, status: 403 } })
		const etat = await lireActivites(client, 'card-1')
		expect(etat).toMatchObject({ statut: 'erreur', erreur: { nature: 'forbidden' } })
	})
})

describe('classerRefusActivite (docs/SPEC-activites.md §5)', () => {
	it.each([
		[400, '23514', 'activity_in_future', 'future'],
		[400, '23514', 'participant_outside_card', 'participant'],
		[400, '23514', 'new row for relation "card_activities" violates check constraint "card_activities_subject_check"', 'sujet'],
		[400, '23514', 'new row for relation "card_activities" violates check constraint "card_activities_duration_check"', 'duree'],
		[400, '23514', 'new row for relation "card_activities" violates check constraint "card_activities_body_check"', 'compte-rendu'],
		[400, '23514', 'violates check constraint "autre"', 'unknown'],
		[400, 'P0001', 'activity_deleted', 'retiree'],
		[400, 'P0001', 'activity_moderation_limited', 'moderation'],
		[400, 'P0001', 'card_not_found', 'forbidden'],
		[400, 'P0001', 'activity_identity_immutable', 'unknown'],
		[403, '42501', 'new row violates row-level security policy', 'forbidden'],
		[401, undefined, 'JWT expired', 'forbidden'],
		[undefined, undefined, 'Failed to fetch', 'network'],
		[500, 'XX000', 'boum', 'unknown'],
	] as const)('%s %s « %s » → %s', (statut, code, message, nature) => {
		expect(classerRefusActivite(statut, code, message)).toBe(nature)
	})
})

describe('le formulaire : dates et durée', () => {
	it('fait l’aller-retour d’un instant par le champ local, à la minute', () => {
		const champ = versChampLocal('2026-10-20T09:41:37.000Z')
		expect(champ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
		expect(depuisChampLocal(champ)).toBe('2026-10-20T09:41:00.000Z')
	})

	it('rend une chaîne vide pour un instant illisible, et `null` pour un champ vide ou illisible', () => {
		expect(versChampLocal('pas une date')).toBe('')
		expect(depuisChampLocal('')).toBeNull()
		expect(depuisChampLocal('   ')).toBeNull()
		expect(depuisChampLocal('2026-13-45T99:99')).toBeNull()
	})

	it.each([
		['', { ok: true, valeur: null }],
		['  ', { ok: true, valeur: null }],
		['45', { ok: true, valeur: 45 }],
		['0', { ok: true, valeur: 0 }],
		['1500', { ok: true, valeur: 1500 }],
		['1,5', { ok: false }],
		['1.5', { ok: false }],
		['-3', { ok: false }],
		['abc', { ok: false }],
	] as const)('la durée « %s »', (texte, attendu) => {
		expect(lireDuree(texte)).toEqual(attendu)
	})
})

describe('consignerActivite (docs/SPEC-activites.md §3)', () => {
	it('n’envoie ni auteur ni espace — la base les pose — et un compte rendu vide part en `null`', async () => {
		const { client, appels } = clientDouble({ 'card_activities:insert': { data: { id: 'neuve' }, status: 201 } })
		const issue = await consignerActivite(client, 'card-1', saisie())
		expect(issue).toEqual({ statut: 'applique', participantsRefuses: 0, natureParticipants: null })
		expect(appels[0]?.charge).toEqual({
			card_id: 'card-1',
			type: 'meeting',
			occurred_at: '2026-10-20T09:00:00.000Z',
			duration_minutes: 45,
			subject: 'Cadrage',
			body: null,
		})
		expect(appels).toHaveLength(1)
	})

	it('pose les participants UN PAR UN, chacun dans sa colonne', async () => {
		const { client, appels } = clientDouble({
			'card_activities:insert': { data: { id: 'neuve' }, status: 201 },
			'card_activity_participants:insert': { status: 201 },
		})
		await consignerActivite(client, 'card-1', saisie({ contacts: ['k1'], membres: ['p1', 'p2'] }))
		expect(appels.filter((a) => a.table === 'card_activity_participants').map((a) => a.charge)).toEqual([
			{ activity_id: 'neuve', contact_id: 'k1' },
			{ activity_id: 'neuve', profile_id: 'p1' },
			{ activity_id: 'neuve', profile_id: 'p2' },
		])
	})

	it('un participant refusé n’annule pas l’activité : l’issue compte les refus et dit pourquoi', async () => {
		const { client } = clientDouble({
			'card_activities:insert': { data: { id: 'neuve' }, status: 201 },
			'card_activity_participants:insert': (appel) =>
				(appel.charge as Record<string, string>)['contact_id'] === 'etranger'
					? { error: { code: '23514', message: 'participant_outside_card' }, status: 400 }
					: { status: 201 },
		})
		const issue = await consignerActivite(client, 'card-1', saisie({ contacts: ['etranger', 'k1'] }))
		expect(issue).toEqual({ statut: 'applique', participantsRefuses: 1, natureParticipants: 'participant' })
	})

	it('un refus de l’activité n’écrit aucun participant', async () => {
		const { client, appels } = clientDouble({
			'card_activities:insert': { error: { code: '23514', message: 'activity_in_future' }, status: 400 },
		})
		const issue = await consignerActivite(client, 'card-1', saisie({ contacts: ['k1'] }))
		expect(issue).toEqual({ statut: 'refus', nature: 'future' })
		expect(appels.filter((a) => a.table === 'card_activity_participants')).toEqual([])
	})

	it('une exception du transport est un refus réseau, jamais un succès', async () => {
		const client = {
			from: () => {
				throw new Error('Failed to fetch')
			},
		} as unknown as ClientCrm
		expect(await consignerActivite(client, 'card-1', saisie())).toEqual({ statut: 'refus', nature: 'network' })
	})
})

describe('corrigerActivite', () => {
	const existante = {
		id: 'act-1',
		contacts: [{ id: 'k1', nom: 'Léo' }],
		membres: [{ id: 'p1', nom: 'Camille' }],
	}

	it('n’envoie pas `edited_at` — le trigger la pose — et cible l’activité', async () => {
		const { client, appels } = clientDouble({ 'card_activities:update': { data: [{ id: 'act-1' }] } })
		await corrigerActivite(client, existante, saisie({ contacts: ['k1'], membres: ['p1'] }))
		expect(appels[0]?.charge).not.toHaveProperty('edited_at')
		expect(appels[0]?.filtres).toContain('id=act-1')
		// Participants inchangés : aucune écriture.
		expect(appels.filter((a) => a.table === 'card_activity_participants')).toEqual([])
	})

	it('met les participants à jour PAR DIFFÉRENCE : retire les partis, ajoute les nouveaux, ne touche pas aux autres', async () => {
		const { client, appels } = clientDouble({
			'card_activities:update': { data: [{ id: 'act-1' }] },
			'card_activity_participants:delete': { data: [{ activity_id: 'act-1' }] },
			'card_activity_participants:insert': { status: 201 },
		})
		const issue = await corrigerActivite(client, existante, saisie({ contacts: ['k1', 'k2'], membres: [] }))
		expect(issue).toEqual({ statut: 'applique', participantsRefuses: 0, natureParticipants: null })
		const participants = appels.filter((a) => a.table === 'card_activity_participants')
		expect(participants.map((a) => [a.geste, a.charge ?? a.filtres.filter((f) => !f.startsWith('select'))])).toEqual([
			['delete', ['activity_id=act-1', 'profile_id=p1']],
			['insert', { activity_id: 'act-1', contact_id: 'k2' }],
		])
	})

	it('zéro ligne rendue est « sans effet », et rien n’est tenté sur les participants', async () => {
		const { client, appels } = clientDouble({ 'card_activities:update': { data: [] } })
		const issue = await corrigerActivite(client, existante, saisie({ contacts: [] }))
		expect(issue).toEqual({ statut: 'refus', nature: 'sans-effet' })
		expect(appels).toHaveLength(1)
	})

	it('la borne de la modération est traduite', async () => {
		const { client } = clientDouble({
			'card_activities:update': { error: { code: 'P0001', message: 'activity_moderation_limited' }, status: 400 },
		})
		expect(await corrigerActivite(client, existante, saisie())).toEqual({ statut: 'refus', nature: 'moderation' })
	})
})

describe('retirerActivite', () => {
	it('n’envoie que `deleted_at` : le trigger vide le reste', async () => {
		const { client, appels } = clientDouble({ 'card_activities:update': { data: [{ id: 'act-1' }] } })
		expect(await retirerActivite(client, 'act-1')).toEqual({
			statut: 'applique',
			participantsRefuses: 0,
			natureParticipants: null,
		})
		expect(Object.keys(appels[0]?.charge as object)).toEqual(['deleted_at'])
	})

	it('zéro ligne est « sans effet » — un non-administrateur sur l’activité d’un tiers', async () => {
		const { client } = clientDouble({ 'card_activities:update': { data: [] } })
		expect(await retirerActivite(client, 'act-1')).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})
})
