// @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 2 : ce que
//           l'écran d'administration lit et écrit
// @verifies docs/SPEC-costs.md §2.1 (nom, devise, enveloppe facultative, aucune contrainte de
//           signe, unicité limitée aux budgets ouverts), §2.2 (une occurrence se clôture
//           indépendamment de son budget), §3.2 (qui écrit), §4.1 (l'interrupteur des clôturés)
// @verifies supabase/migrations/0050_budgets.sql §1.1 (les `CHECK` recopiés en forme), §3 (le
//           trigger de récurrence et son message)
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue, comme
// `administration-arborescence.test.ts` : deux exigences de la spécification sont portées par la
// requête elle-même — le filtre des budgets clôturés et l'ordre —, et un test qui n'observerait que
// la réponse les laisserait disparaître sans bruit.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
	COLONNES_BUDGET_ADMIN,
	FRAGMENT_RECURRENCE_OCCUPEE,
	MOTIF_DEVISE,
	classerRefusBudget,
	cloturerBudget,
	compterOccurrencesOuvertes,
	creerBudget,
	deplacerBudget,
	deviseConforme,
	lireBudgetsAdministrables,
	lireEnveloppe,
	modifierBudget,
	nomBudgetConforme,
} from './budgets'
import type { ClientCrm } from './supabase'

type Reponse = {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}

type AppelLecture = {
	table?: string
	colonnes?: string
	filtres: [string, unknown][]
	tris: [string, unknown?][]
}

/** Client factice qui **enregistre** la requête de lecture construite, puis rend la réponse voulue. */
function espionLecture(reponse: Reponse): { client: ClientCrm; appel: AppelLecture } {
	const appel: AppelLecture = { filtres: [], tris: [] }
	const chaine = {
		is: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		eq: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		in: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		order: (colonne: string, options?: unknown) => {
			appel.tris.push([colonne, options])
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

type AppelEcriture = {
	table?: string
	verbe?: 'insert' | 'update'
	charge?: Record<string, unknown>
	filtres: [string, unknown][]
	colonnesRendues?: string
}

function espionEcriture(reponse: Reponse): { client: ClientCrm; appel: AppelEcriture } {
	const appel: AppelEcriture = { filtres: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		select: (colonnes: string) => {
			appel.colonnesRendues = colonnes
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				insert: (charge: Record<string, unknown>) => {
					appel.verbe = 'insert'
					appel.charge = charge
					return chaine
				},
				update: (charge: Record<string, unknown>) => {
					appel.verbe = 'update'
					appel.charge = charge
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

/** Client dont le transport échoue par une exception, comme `supabase-js` peut le faire. */
function clientQuiLeve(cause: unknown): ClientCrm {
	const exploser = () => {
		throw cause
	}
	const chaine: Record<string, unknown> = {}
	for (const methode of ['is', 'eq', 'in', 'order', 'select', 'then']) chaine[methode] = exploser
	return {
		from: () => ({ select: () => chaine, insert: () => chaine, update: () => chaine }),
	} as unknown as ClientCrm
}

const vide: Reponse = { data: [], error: null, status: 200 }
const applique: Reponse = { data: [{ id: 'b1' }], error: null, status: 200 }

// ---------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------

describe('lireBudgetsAdministrables', () => {
	it('filtre les budgets clôturés CÔTÉ SERVEUR quand l’interrupteur est éteint (§4.1)', async () => {
		const { client, appel } = espionLecture(vide)
		await lireBudgetsAdministrables(client, 't1', false)
		expect(appel.table).toBe('budgets')
		expect(appel.colonnes).toBe(COLONNES_BUDGET_ADMIN)
		expect(appel.filtres).toContainEqual(['track_id', 't1'])
		expect(appel.filtres).toContainEqual(['closed_at', null])
	})

	it('retire ce seul filtre quand l’interrupteur est allumé, et garde celui du track', async () => {
		const { client, appel } = espionLecture(vide)
		await lireBudgetsAdministrables(client, 't1', true)
		expect(appel.filtres).toContainEqual(['track_id', 't1'])
		expect(appel.filtres.some(([colonne]) => colonne === 'closed_at')).toBe(false)
	})

	it('N’ÉMET AUCUN FILTRE `deleted_at` : `budgets` n’en porte pas, un budget se clôture (§3.2)', async () => {
		const { client, appel } = espionLecture(vide)
		await lireBudgetsAdministrables(client, 't1', false)
		expect(appel.filtres.some(([colonne]) => colonne === 'deleted_at')).toBe(false)
	})

	it('trie par position puis par nom, l’ordre de toutes les listes ordonnées du produit', async () => {
		const { client, appel } = espionLecture(vide)
		await lireBudgetsAdministrables(client, 't1', false)
		expect(appel.tris.map(([colonne]) => colonne)).toEqual(['position', 'name'])
	})

	it('classe une erreur de transport plutôt que de la laisser remonter', async () => {
		const etat = await lireBudgetsAdministrables(clientQuiLeve(new Error('coupure')), 't1', false)
		expect(etat.statut).toBe('erreur')
	})
})

describe('compterOccurrencesOuvertes', () => {
	it('N’ÉMET AUCUNE REQUÊTE pour une liste vide : sa réponse est connue d’avance', async () => {
		const { client, appel } = espionLecture(vide)
		const etat = await compterOccurrencesOuvertes(client, [])
		expect(appel.table).toBeUndefined()
		expect(etat).toEqual({ statut: 'pret', donnees: {} })
	})

	it('compte par budget, et ne retient que les occurrences OUVERTES (§2.2)', async () => {
		const { client, appel } = espionLecture({
			data: [
				{ id: 'o1', budget_id: 'b1' },
				{ id: 'o2', budget_id: 'b1' },
				{ id: 'o3', budget_id: 'b2' },
			],
			error: null,
			status: 200,
		})
		const etat = await compterOccurrencesOuvertes(client, ['b1', 'b2'])
		expect(appel.table).toBe('budget_occurrences')
		expect(appel.filtres).toContainEqual(['budget_id', ['b1', 'b2']])
		// Le filtre porte sur l'occurrence, JAMAIS sur le budget : une occurrence se clôture
		// indépendamment de lui.
		expect(appel.filtres).toContainEqual(['closed_at', null])
		expect(etat).toEqual({ statut: 'pret', donnees: { b1: 2, b2: 1 } })
	})

	it('rend un budget SANS occurrence ouverte absent du dictionnaire, pas à zéro', async () => {
		const { client } = espionLecture({ data: [], error: null, status: 200 })
		const etat = await compterOccurrencesOuvertes(client, ['b1'])
		// C'est l'écran qui traduit l'absence en « 0 » : le module ne fabrique pas une donnée que
		// le serveur n'a pas rendue.
		expect(etat).toEqual({ statut: 'pret', donnees: {} })
	})
})

// ---------------------------------------------------------------------------------------------
// Validation de forme
// ---------------------------------------------------------------------------------------------

describe('validation de forme', () => {
	it('la devise est trois majuscules, comme le `CHECK` de la migration', () => {
		expect(MOTIF_DEVISE.source).toBe('^[A-Z]{3}$')
		expect(deviseConforme('EUR')).toBe(true)
		expect(deviseConforme('CHF')).toBe(true)
		expect(deviseConforme('eur')).toBe(false)
		expect(deviseConforme('EURO')).toBe(false)
		expect(deviseConforme('')).toBe(false)
	})

	it('le motif de la devise est celui que la migration écrit, et non une copie qui aurait dérivé', () => {
		const migration = readFileSync('supabase/migrations/0050_budgets.sql', 'utf8')
		expect(migration).toContain("currency ~ '^[A-Z]{3}$'")
	})

	it('un nom fait de blancs est refusé, comme `app.btrim_blancs(name) <> \'\'`', () => {
		expect(nomBudgetConforme('Salon 2026')).toBe(true)
		expect(nomBudgetConforme('   ')).toBe(false)
		expect(nomBudgetConforme('')).toBe(false)
	})
})

describe('lireEnveloppe', () => {
	it('distingue « pas décidée » de « zéro décidé » — la valeur par défaut trompeuse de CLAUDE.md §18', () => {
		expect(lireEnveloppe('')).toEqual({ statut: 'absente' })
		expect(lireEnveloppe('   ')).toEqual({ statut: 'absente' })
		expect(lireEnveloppe('0')).toEqual({ statut: 'lue', montant: 0 })
	})

	it('accepte un montant NÉGATIF : avoir, remise et remboursement sont légitimes (§2.1)', () => {
		expect(lireEnveloppe('-250.50')).toEqual({ statut: 'lue', montant: -250.5 })
	})

	it('refuse une saisie non numérique au lieu d’en garder la tête, comme le ferait `parseFloat`', () => {
		expect(lireEnveloppe('12abc')).toEqual({ statut: 'invalide' })
		expect(lireEnveloppe('douze')).toEqual({ statut: 'invalide' })
	})
})

// ---------------------------------------------------------------------------------------------
// Les refus
// ---------------------------------------------------------------------------------------------

describe('classerRefusBudget', () => {
	it('classe sur le code PostgreSQL AVANT le statut HTTP', () => {
		// Un `CHECK` remonte avec un statut d'erreur ; classer par le statut d'abord dirait « vous
		// n'avez pas le droit » là où c'est la valeur qui est mauvaise.
		expect(
			classerRefusBudget(400, '23514', 'violates check constraint "budgets_currency_check"').nature,
		).toBe('forme-refusee')
	})

	it('range le `23505` sous « nom pris », y compris à la RÉOUVERTURE (§2.1)', () => {
		expect(classerRefusBudget(409, '23505', 'budgets_track_name_ouvert_key').nature).toBe('nom-pris')
	})

	it('SÉPARE le trigger de récurrence des `CHECK` de forme, qui partagent le `23514`', () => {
		const message = `ce budget porte 2 occurrence(s) : supprimez-les ${FRAGMENT_RECURRENCE_OCCUPEE} (docs/SPEC-costs.md §2.2)`
		expect(classerRefusBudget(400, '23514', message).nature).toBe('recurrence-occupee')
	})

	it('le fragment employé est bien celui que la migration lève, et non un souvenir', () => {
		const migration = readFileSync('supabase/migrations/0050_budgets.sql', 'utf8')
		expect(migration).toContain(FRAGMENT_RECURRENCE_OCCUPEE)
	})

	it('classe `403` en refus d’autorisation, et l’absence de statut en défaut de réseau', () => {
		expect(classerRefusBudget(403, undefined, 'permission denied').nature).toBe('forbidden')
		expect(classerRefusBudget(undefined, undefined, 'fetch failed').nature).toBe('network')
	})

	it('classe le `23503` en référence absente', () => {
		expect(classerRefusBudget(409, '23503', 'budgets_track_id_fkey').nature).toBe('reference-absente')
	})
})

// ---------------------------------------------------------------------------------------------
// Les écritures
// ---------------------------------------------------------------------------------------------

describe('creerBudget', () => {
	it('envoie `position` à null pour laisser le trigger placer le budget en fin de liste', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerBudget(client, {
			idTrack: 't1',
			nom: 'Salon 2026',
			devise: 'EUR',
			enveloppe: 8000,
			recurrent: false,
		})
		expect(appel.table).toBe('budgets')
		expect(appel.verbe).toBe('insert')
		expect(appel.charge).toEqual({
			track_id: 't1',
			name: 'Salon 2026',
			currency: 'EUR',
			planned_amount: 8000,
			is_recurrent: false,
			position: null,
		})
	})

	it('N’ENVOIE NI `closed_at` NI `created_by` : un budget naît ouvert, et l’auteur est une trace', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerBudget(client, {
			idTrack: 't1',
			nom: 'Salon 2026',
			devise: 'EUR',
			enveloppe: null,
			recurrent: true,
		})
		expect(appel.charge).not.toHaveProperty('closed_at')
		expect(appel.charge).not.toHaveProperty('created_by')
		// L'enveloppe non décidée part à `null`, jamais à `0`.
		expect(appel.charge?.planned_amount).toBeNull()
	})

	it('accompagne l’écriture d’un `select` : sans lui, zéro ligne touchée passerait pour un succès', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerBudget(client, {
			idTrack: 't1',
			nom: 'X',
			devise: 'EUR',
			enveloppe: null,
			recurrent: false,
		})
		expect(appel.colonnesRendues).toBe('id')
	})
})

describe('modifierBudget', () => {
	it('n’écrit PAS `closed_at` : la clôture a sa propre fonction et ses propres refus', async () => {
		const { client, appel } = espionEcriture(applique)
		await modifierBudget(client, 'b1', {
			nom: 'Salon 2026',
			devise: 'CHF',
			enveloppe: null,
			recurrent: true,
		})
		expect(appel.verbe).toBe('update')
		expect(appel.charge).toEqual({
			name: 'Salon 2026',
			currency: 'CHF',
			planned_amount: null,
			is_recurrent: true,
		})
		expect(appel.filtres).toContainEqual(['id', 'b1'])
	})
})

describe('cloturerBudget', () => {
	it('pose l’horodatage à la clôture et le remet à nul à la réouverture', async () => {
		const { client, appel } = espionEcriture(applique)
		await cloturerBudget(client, 'b1', true, () => '2026-08-19T10:00:00.000Z')
		expect(appel.charge).toEqual({ closed_at: '2026-08-19T10:00:00.000Z' })

		const rouverture = espionEcriture(applique)
		await cloturerBudget(rouverture.client, 'b1', false)
		expect(rouverture.appel.charge).toEqual({ closed_at: null })
	})

	it('rend `sans-effet` sur un `200` à zéro ligne — le `USING` d’une politique a filtré', async () => {
		const { client } = espionEcriture(vide)
		expect(await cloturerBudget(client, 'b1', true)).toEqual({ statut: 'sans-effet' })
	})

	it('rend le refus `nom-pris` quand la réouverture bute sur un nom repris (§2.1)', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { code: '23505', message: 'budgets_track_name_ouvert_key' },
			status: 409,
		})
		const resultat = await cloturerBudget(client, 'b1', false)
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'nom-pris', detail: 'budgets_track_name_ouvert_key' },
		})
	})
})

describe('deplacerBudget', () => {
	it('n’écrit qu’une ligne, la position calculée — jamais une permutation', async () => {
		const { client, appel } = espionEcriture(applique)
		await deplacerBudget(client, 'b1', 1.5)
		expect(appel.charge).toEqual({ position: 1.5 })
		expect(appel.filtres).toContainEqual(['id', 'b1'])
	})
})

describe('les écritures ne lèvent jamais', () => {
	it('classe une exception de transport en refus réseau', async () => {
		const resultat = await creerBudget(clientQuiLeve(new Error('coupure')), {
			idTrack: 't1',
			nom: 'X',
			devise: 'EUR',
			enveloppe: null,
			recurrent: false,
		})
		expect(resultat.statut).toBe('refus')
		expect(resultat.statut === 'refus' ? resultat.refus.nature : null).toBe('network')
	})
})
