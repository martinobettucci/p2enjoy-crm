// @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 3b : ce que la
//           sous-surface des occurrences lit et écrit
// @verifies docs/SPEC-costs.md §2.2 (libellé non vide, périodes et enveloppe facultatives et
//           purement descriptives, clôture indépendante du budget), §3.2 (qui écrit),
//           §4.1 bis.1 (aucun filtre de clôture, l'ordre), §4.1 bis.3 (ce que l'écriture envoie),
//           §4.1 bis.4 (dictionnaire fermé des refus), §4.1 bis.5 (les mesures M5, M8, M9, M11)
// @verifies supabase/migrations/0050_budgets.sql §2 (le `CHECK` du libellé, l'index d'unicité),
//           §3 (le trigger de récurrence et son message)
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue, comme
// `budgets.test.ts` dont il est le pendant. Trois exigences de la spécification sont portées par la
// requête elle-même — l'ABSENCE de filtre de clôture, l'ordre, et l'envoi des trois attributs
// facultatifs même nuls —, et un test qui n'observerait que la réponse les laisserait disparaître
// sans bruit. C'est la seule façon de voir qu'un paramètre est envoyé plutôt qu'omis.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
	COLONNES_OCCURRENCE_ADMIN,
	FRAGMENT_BUDGET_NON_RECURRENT,
	NOM_CONTRAINTE_OCCURRENCE_REFERENCEE,
	classerRefusOccurrence,
	cloturerOccurrence,
	creerOccurrence,
	libelleOccurrenceConforme,
	lireBornePeriode,
	lireEnveloppeOccurrence,
	lireOccurrences,
	modifierOccurrence,
	retirerOccurrence,
} from './occurrences'
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
	verbe?: 'insert' | 'update' | 'delete'
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
				delete: () => {
					appel.verbe = 'delete'
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
	for (const methode of ['is', 'eq', 'order', 'select', 'then']) chaine[methode] = exploser
	return {
		from: () => ({
			select: () => chaine,
			insert: () => chaine,
			update: () => chaine,
			delete: () => chaine,
		}),
	} as unknown as ClientCrm
}

const vide: Reponse = { data: [], error: null, status: 200 }
const applique: Reponse = { data: [{ id: 'o1' }], error: null, status: 200 }

// ---------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------

describe('lireOccurrences', () => {
	it('demande exactement les colonnes que la liste rend, sur le seul budget visé', async () => {
		const { client, appel } = espionLecture(vide)
		await lireOccurrences(client, 'b1')
		expect(appel.table).toBe('budget_occurrences')
		expect(appel.colonnes).toBe(COLONNES_OCCURRENCE_ADMIN)
		expect(appel.filtres).toContainEqual(['budget_id', 'b1'])
	})

	it("N'ÉMET AUCUN FILTRE DE CLÔTURE, et c'est la règle du §4.1 bis.1", async () => {
		// Un `closed_at is null` ajouté par mimétisme avec `lireBudgetsAdministrables` viderait la
		// liste de la moitié de son objet EN SILENCE : l'onglet « À saisir » du §4.8 liste
		// précisément les lignes des occurrences closes. La preuve porte donc sur une ABSENCE.
		const { client, appel } = espionLecture(vide)
		await lireOccurrences(client, 'b1')
		expect(appel.filtres.some(([colonne]) => colonne === 'closed_at')).toBe(false)
	})

	it('trie par période DÉCROISSANTE puis par libellé croissant (§4.1 bis.1)', async () => {
		const { client, appel } = espionLecture(vide)
		await lireOccurrences(client, 'b1')
		expect(appel.tris.map(([colonne]) => colonne)).toEqual(['period_start', 'label'])
		expect(appel.tris[0]?.[1]).toEqual({ ascending: false, nullsFirst: false })
		expect(appel.tris[1]?.[1]).toEqual({ ascending: true })
	})

	it("range les périodes absentes EN QUEUE, les deux bornes étant facultatives (§2.2)", async () => {
		// `nullsFirst: false` est explicite : sous le défaut de PostgreSQL pour un tri descendant,
		// une occurrence sans période passerait DEVANT la plus récente.
		const { client, appel } = espionLecture(vide)
		await lireOccurrences(client, 'b1')
		expect((appel.tris[0]?.[1] as { nullsFirst?: boolean }).nullsFirst).toBe(false)
	})

	it('rend les lignes telles quelles quand la lecture aboutit', async () => {
		const ligne = {
			id: 'o1',
			budget_id: 'b1',
			label: 'Janvier 2026',
			period_start: '2026-01-01',
			period_end: '2026-01-31',
			planned_amount: 2000,
			closed_at: null,
		}
		const { client } = espionLecture({ data: [ligne], error: null, status: 200 })
		const etat = await lireOccurrences(client, 'b1')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toEqual([ligne])
	})

	it('classe un refus de lecture plutôt que de lever', async () => {
		const { client } = espionLecture({
			data: null,
			error: { message: 'refusé' },
			status: 403,
		})
		const etat = await lireOccurrences(client, 'b1')
		expect(etat.statut).toBe('erreur')
	})

	it("classe une exception de transport plutôt que de la laisser remonter à l'écran", async () => {
		const etat = await lireOccurrences(clientQuiLeve(new Error('socket close')), 'b1')
		expect(etat.statut).toBe('erreur')
	})
})

// ---------------------------------------------------------------------------------------------
// Validation de forme
// ---------------------------------------------------------------------------------------------

describe('libelleOccurrenceConforme', () => {
	it('refuse le vide et les blancs seuls, comme le `CHECK` de la base', () => {
		expect(libelleOccurrenceConforme('')).toBe(false)
		expect(libelleOccurrenceConforme('   ')).toBe(false)
	})

	it('accepte un libellé bordé de blancs, que la base accepte aussi', () => {
		expect(libelleOccurrenceConforme('  Janvier 2026  ')).toBe(true)
	})

	it("NE REPLIE PAS LA CASSE : deux libellés qui ne diffèrent que par elle sont tous deux conformes", () => {
		// MESURE M5 (§4.1 bis.5) : l'index d'unicité porte sur `app.btrim_blancs(label)`, qui retire
		// les blancs SANS toucher à la casse — exactement comme celui des budgets sur leur nom.
		// Replier la casse ici refuserait localement ce que la base accepte.
		expect(libelleOccurrenceConforme('Janvier 2026')).toBe(true)
		expect(libelleOccurrenceConforme('janvier 2026')).toBe(true)
	})

	it("recopie la contrainte réellement écrite dans la migration, jamais une paraphrase", () => {
		const migration = readFileSync('supabase/migrations/0050_budgets.sql', 'utf8')
		expect(migration).toContain("app.btrim_blancs(label) <> ''")
	})
})

describe('lireEnveloppeOccurrence', () => {
	it('rend « absente » sur le vide, et NON zéro (§2.2, enveloppe facultative)', () => {
		expect(lireEnveloppeOccurrence('')).toEqual({ statut: 'absente' })
		expect(lireEnveloppeOccurrence('   ')).toEqual({ statut: 'absente' })
	})

	it("distingue « aucune enveloppe » d'« une enveloppe de zéro »", () => {
		expect(lireEnveloppeOccurrence('0')).toEqual({ statut: 'lue', montant: 0 })
	})

	it('lit la virgule décimale comme le point', () => {
		expect(lireEnveloppeOccurrence('1234,50')).toEqual({ statut: 'lue', montant: 1234.5 })
	})

	it('accepte un montant négatif — un avoir est un coût légitime (§2.1)', () => {
		expect(lireEnveloppeOccurrence('-120')).toEqual({ statut: 'lue', montant: -120 })
	})

	it("rend « illisible » plutôt que `NaN`, qui se serait envoyé en silence", () => {
		expect(lireEnveloppeOccurrence('douze')).toEqual({ statut: 'illisible' })
	})
})

describe('lireBornePeriode', () => {
	it('rend `null` sur le vide : les deux bornes sont facultatives (§2.2)', () => {
		expect(lireBornePeriode('')).toBeNull()
		expect(lireBornePeriode('  ')).toBeNull()
	})

	it('rend la date telle que le champ la porte', () => {
		expect(lireBornePeriode('2026-03-01')).toBe('2026-03-01')
	})

	it("N'EXIGE AUCUNE COHÉRENCE entre les deux bornes, qu'aucun `CHECK` ne demande", () => {
		// En l'imposant ici, l'écran poserait une règle métier que la base ignore, et deux vérités
		// coexisteraient sur le même fait. Les bornes sont « purement descriptives » (§2.2).
		expect(lireBornePeriode('2026-12-31')).toBe('2026-12-31')
		const migration = readFileSync('supabase/migrations/0050_budgets.sql', 'utf8')
		expect(migration).not.toContain('period_end >= period_start')
	})
})

// ---------------------------------------------------------------------------------------------
// Le dictionnaire fermé des refus — §4.1 bis.4
// ---------------------------------------------------------------------------------------------

describe('classerRefusOccurrence', () => {
	it('M5 — `23505` est un libellé déjà pris sur ce budget', () => {
		expect(
			classerRefusOccurrence(409, '23505', 'duplicate key … budget_occurrences_budget_label_key')
				.nature,
		).toBe('libelle-pris')
	})

	it('M4 — `23514` portant le message du trigger est un budget non récurrent', () => {
		const detail = `${FRAGMENT_BUDGET_NON_RECURRENT} (docs/SPEC-costs.md §2.2)`
		expect(classerRefusOccurrence(400, '23514', detail).nature).toBe('budget-non-recurrent')
	})

	it('M10 — `23514` sans ce message est un libellé vide, et les deux gestes diffèrent', () => {
		const detail = 'violates check constraint "budget_occurrences_label_check"'
		expect(classerRefusOccurrence(400, '23514', detail).nature).toBe('libelle-vide')
	})

	it('M11 — `23503` nommant la clé de `card_costs` est une occurrence référencée', () => {
		const detail = `violates foreign key constraint "${NOM_CONTRAINTE_OCCURRENCE_REFERENCEE}"`
		expect(classerRefusOccurrence(409, '23503', detail).nature).toBe('occurrence-referencee')
	})

	it('`23503` sans ce nom est une référence absente — deux causes, deux gestes', () => {
		expect(classerRefusOccurrence(409, '23503', "le budget « … » n'existe pas").nature).toBe(
			'reference-absente',
		)
	})

	it('M2 — `403` sans code est un refus de droit', () => {
		expect(classerRefusOccurrence(403, undefined, 'permission denied').nature).toBe('forbidden')
		expect(classerRefusOccurrence(401, undefined, 'jwt expired').nature).toBe('forbidden')
	})

	it("classe sur le CODE avant le STATUT : un `23514` remonte en `400` et reste de forme", () => {
		// Classer par le statut d'abord dirait « vous n'avez pas le droit » là où c'est le libellé
		// qui est vide. L'ordre est celui de `classerRefusBudget`, repris sans exception.
		const detail = 'violates check constraint "budget_occurrences_label_check"'
		expect(classerRefusOccurrence(403, '23514', detail).nature).toBe('libelle-vide')
	})

	it('rend « network » sans statut, et « unknown » sur un statut non couvert', () => {
		expect(classerRefusOccurrence(undefined, undefined, 'fetch failed').nature).toBe('network')
		expect(classerRefusOccurrence(0, undefined, 'fetch failed').nature).toBe('network')
		expect(classerRefusOccurrence(500, undefined, 'boom').nature).toBe('unknown')
	})

	it('conserve le détail reçu, que la surface est libre de ne pas afficher', () => {
		expect(classerRefusOccurrence(500, undefined, 'boom').detail).toBe('boom')
	})

	it('recopie le fragment du trigger tel que la migration l’écrit, jamais une paraphrase', () => {
		const migration = readFileSync('supabase/migrations/0050_budgets.sql', 'utf8')
		// La migration double l'apostrophe dans son littéral SQL ; le fragment du module la porte
		// simple. La comparaison se fait donc sur la forme SQL, pour rester une vraie vérification.
		expect(migration).toContain(FRAGMENT_BUDGET_NON_RECURRENT.replace("n'e", "n''e"))
	})
})

// ---------------------------------------------------------------------------------------------
// Les écritures — §4.1 bis.3
// ---------------------------------------------------------------------------------------------

describe('creerOccurrence', () => {
	it('envoie le budget, le libellé et les trois attributs facultatifs', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerOccurrence(client, {
			idBudget: 'b1',
			libelle: 'Mars 2026',
			debut: '2026-03-01',
			fin: '2026-03-31',
			enveloppe: 1234.5,
		})
		expect(appel.table).toBe('budget_occurrences')
		expect(appel.verbe).toBe('insert')
		expect(appel.charge).toEqual({
			budget_id: 'b1',
			label: 'Mars 2026',
			period_start: '2026-03-01',
			period_end: '2026-03-31',
			planned_amount: 1234.5,
		})
	})

	it("N'ENVOIE JAMAIS `closed_at` : une occurrence naît ouverte", async () => {
		const { client, appel } = espionEcriture(applique)
		await creerOccurrence(client, {
			idBudget: 'b1',
			libelle: 'Mars 2026',
			debut: null,
			fin: null,
			enveloppe: null,
		})
		expect(Object.keys(appel.charge ?? {})).not.toContain('closed_at')
	})

	it('accompagne l’écriture d’un `select`, sans quoi « zéro ligne » serait un succès', async () => {
		const { client, appel } = espionEcriture(applique)
		await creerOccurrence(client, {
			idBudget: 'b1',
			libelle: 'Mars 2026',
			debut: null,
			fin: null,
			enveloppe: null,
		})
		expect(appel.colonnesRendues).toBe('id')
	})
})

describe('modifierOccurrence', () => {
	it('envoie le libellé et les TROIS attributs facultatifs, y compris nuls (§4.1 bis.3)', async () => {
		// C'est la seule façon de voir qu'un paramètre est envoyé plutôt qu'omis. Les omettre au
		// motif qu'ils sont vides rendrait ineffaçable une enveloppe posée par erreur.
		const { client, appel } = espionEcriture(applique)
		await modifierOccurrence(client, 'o1', {
			libelle: 'Mars 2026',
			debut: null,
			fin: null,
			enveloppe: null,
		})
		expect(appel.verbe).toBe('update')
		expect(appel.charge).toEqual({
			label: 'Mars 2026',
			period_start: null,
			period_end: null,
			planned_amount: null,
		})
		expect(appel.filtres).toContainEqual(['id', 'o1'])
	})

	it("N'ENVOIE PAS `closed_at` : la clôture a sa propre fonction et ses propres refus", async () => {
		const { client, appel } = espionEcriture(applique)
		await modifierOccurrence(client, 'o1', {
			libelle: 'Mars 2026',
			debut: null,
			fin: null,
			enveloppe: null,
		})
		expect(Object.keys(appel.charge ?? {})).not.toContain('closed_at')
	})

	it('M8 — ne pose AUCUNE garde de clôture : une occurrence close reste modifiable', async () => {
		// Mesuré : `PATCH planned_amount` sur une occurrence close rend `200`. Aucun trigger ne s'y
		// oppose, et le §4.8 suppose précisément que les factures arrivent après la clôture.
		const { client, appel } = espionEcriture(applique)
		const resultat = await modifierOccurrence(client, 'o1', {
			libelle: 'Janvier 2026',
			debut: null,
			fin: null,
			enveloppe: 42,
		})
		expect(resultat).toEqual({ statut: 'applique' })
		expect(appel.filtres).toEqual([['id', 'o1']])
	})
})

describe('cloturerOccurrence', () => {
	it("écrit l'horodatage fourni à la clôture, et n'écrit rien d'autre", async () => {
		const { client, appel } = espionEcriture(applique)
		await cloturerOccurrence(client, 'o1', true, () => '2026-03-31T12:00:00.000Z')
		expect(appel.charge).toEqual({ closed_at: '2026-03-31T12:00:00.000Z' })
	})

	it('remet `closed_at` à nul à la réouverture', async () => {
		const { client, appel } = espionEcriture(applique)
		await cloturerOccurrence(client, 'o1', false)
		expect(appel.charge).toEqual({ closed_at: null })
	})

	it("N'ÉCRIT RIEN SUR LE BUDGET PORTEUR : une occurrence se clôture indépendamment (§2.2)", async () => {
		const { client, appel } = espionEcriture(applique)
		await cloturerOccurrence(client, 'o1', true)
		expect(appel.table).toBe('budget_occurrences')
		expect(appel.filtres).toEqual([['id', 'o1']])
	})
})

describe('retirerOccurrence', () => {
	it('émet un `delete` sur la seule ligne visée, avec son `select` de comptage', async () => {
		const { client, appel } = espionEcriture(applique)
		await retirerOccurrence(client, 'o1')
		expect(appel.table).toBe('budget_occurrences')
		expect(appel.verbe).toBe('delete')
		expect(appel.filtres).toEqual([['id', 'o1']])
		expect(appel.colonnesRendues).toBe('id')
	})

	it('M11 — traduit le refus de la clé étrangère en « occurrence référencée »', async () => {
		const { client } = espionEcriture({
			data: null,
			error: {
				code: '23503',
				message: `… violates foreign key constraint "${NOM_CONTRAINTE_OCCURRENCE_REFERENCEE}" …`,
			},
			status: 409,
		})
		const resultat = await retirerOccurrence(client, 'o1')
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'occurrence-referencee', detail: expect.any(String) },
		})
	})
})

// ---------------------------------------------------------------------------------------------
// Les trois issues — §4.1 bis.3
// ---------------------------------------------------------------------------------------------

describe('les trois issues de toute écriture', () => {
	it('« appliqué » quand une ligne est rendue', async () => {
		const { client } = espionEcriture(applique)
		expect(await cloturerOccurrence(client, 'o1', true)).toEqual({ statut: 'applique' })
	})

	it('« sans effet » sur `200` et ZÉRO ligne — la clause `USING` a filtré', async () => {
		// Ni un succès ni une erreur : c'est ce que rend la politique quand le droit d'écriture est
		// retombé depuis le chargement. La troisième issue est DITE, jamais présentée comme un succès.
		const { client } = espionEcriture(vide)
		expect(await cloturerOccurrence(client, 'o1', true)).toEqual({ statut: 'sans-effet' })
	})

	it('« refus » classé quand la base oppose un code', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { code: '23505', message: 'duplicate key' },
			status: 409,
		})
		expect(await creerOccurrence(client, {
			idBudget: 'b1',
			libelle: 'Janvier 2026',
			debut: null,
			fin: null,
			enveloppe: null,
		})).toEqual({ statut: 'refus', refus: { nature: 'libelle-pris', detail: 'duplicate key' } })
	})

	it('une exception de transport devient un refus « network », jamais une exception à l’écran', async () => {
		const resultat = await retirerOccurrence(clientQuiLeve(new Error('fetch failed')), 'o1')
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'network', detail: 'fetch failed' },
		})
	})
})
