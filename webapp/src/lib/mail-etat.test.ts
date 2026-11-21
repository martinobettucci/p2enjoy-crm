// @verifies CRM-059 (docs/BACKLOG.md) — écran d'état de la messagerie
// @verifies docs/SPEC-mail-subsystem.md §20.7 (les faits montrés), §20.11.2 (deux lectures,
//           aucune règle nouvelle), §20.11.4 (dictionnaire fermé des six codes)
// @verifies CRM-161 (docs/BACKLOG.md) — tranche T1 : la lecture porte le filtre de l'espace (`workspace_id`) —
//           docs/SPEC-mail-subsystem.md §35.5
//
// Comme `administration-arborescence.test.ts`, ce fichier éprouve la requête RÉELLEMENT émise,
// pas seulement la valeur rendue : le filtre de la file sortante (`queued`/`sending` contre
// `failed`) est une exigence de la spécification portée par la requête elle-même.
// @verifies CRM-001 tranche INC-299, docs/DAT.md §3.5 bis (décision 700) — un compte est un `GET … limit=0`, jamais un `HEAD`

import { describe, expect, it } from 'vitest'
import {
	CODES_INCIDENT_MAIL,
	COLONNES_COMPTE_MAIL_ETAT,
	estCodeIncidentConnu,
	lireComptesMailEtat,
	lireCompteursFileSortante,
} from './mail-etat'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }
type ReponseCompte = { count: number | null; error: { message: string } | null; status: number }

// ---------------------------------------------------------------------------------------------
// Clients espions
// ---------------------------------------------------------------------------------------------

type AppelComptes = { table?: string; colonnes?: string; egalites: [string, unknown][]; tris: [string, unknown?][] }

function espionComptes(reponse: Reponse): { client: ClientCrm; appel: AppelComptes } {
	const appel: AppelComptes = { egalites: [], tris: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.egalites.push([colonne, valeur])
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

type AppelCompteurs = {
	table?: string
	colonnes?: string
	options?: unknown
	in?: [string, unknown]
	eq?: [string, unknown]
	/** `CRM-161` T1 (§35.5) : l'espace de chaque compte, posé avant le filtre d'état. */
	espaces: unknown[]
	/** Bornes `limit` posées, une par compte : `LIMITE_COMPTE` (`compter.ts`). */
	limites: number[]
}

/** Route la réponse « en attente » sur `.in(...)`, la réponse « échecs » sur `.eq(...)`. */
function espionCompteurs(
	enAttente: ReponseCompte,
	echecs: ReponseCompte,
): { client: ClientCrm; appel: AppelCompteurs } {
	const appel: AppelCompteurs = { espaces: [], limites: [] }
	const borner = (reponse: ReponseCompte) => ({
		limit: (nombre: number) => {
			appel.limites.push(nombre)
			return Promise.resolve(reponse)
		},
	})
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string, options?: unknown) => {
					appel.colonnes = colonnes
					appel.options = options
					const filtre = {
						in: (colonne: string, valeur: unknown) => {
							appel.in = [colonne, valeur]
							return borner(enAttente)
						},
						eq: (colonne: string, valeur: unknown): unknown => {
							if (colonne === 'workspace_id') {
								appel.espaces.push(valeur)
								return filtre
							}
							appel.eq = [colonne, valeur]
							return borner(echecs)
						},
					}
					return filtre
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

function clientQuiLeve(cause: unknown): ClientCrm {
	const exploser = () => {
		throw cause
	}
	return {
		from: () => ({ select: exploser }),
	} as unknown as ClientCrm
}

const COMPTES_OK: Reponse = {
	data: [{ id: 'a', label: 'Boîte système', last_sync_at: null, status: 'pending', last_error: null }],
	error: null,
	status: 200,
}

// ---------------------------------------------------------------------------------------------
// lireComptesMailEtat
// ---------------------------------------------------------------------------------------------

describe('lireComptesMailEtat', () => {
	it('lit la table, les colonnes et le tri attendus (§20.11.3)', async () => {
		const { client, appel } = espionComptes(COMPTES_OK)
		const resultat = await lireComptesMailEtat(client, 'ws-1')
		expect(appel.table).toBe('mail_inbound_accounts')
		// `CRM-161` T1 (§35.5) : les boîtes de l'espace courant, et de lui seul.
		expect(appel.egalites).toEqual([['workspace_id', 'ws-1']])
		expect(appel.colonnes).toBe(COLONNES_COMPTE_MAIL_ETAT)
		expect(appel.tris).toEqual([['label', undefined]])
		expect(resultat).toEqual({ statut: 'pret', donnees: COMPTES_OK.data })
	})

	it('classe un refus 403 en `forbidden`', async () => {
		const { client } = espionComptes({ data: null, error: { message: 'denied' }, status: 403 })
		const resultat = await lireComptesMailEtat(client, 'ws-1')
		expect(resultat).toEqual({ statut: 'erreur', erreur: { nature: 'forbidden', detail: 'denied' } })
	})

	it('classe une exception de transport en `network`', async () => {
		const client = clientQuiLeve(new TypeError('Failed to fetch'))
		const resultat = await lireComptesMailEtat(client, 'ws-1')
		expect(resultat).toEqual({
			statut: 'erreur',
			erreur: { nature: 'network', detail: 'Failed to fetch' },
		})
	})
})

// ---------------------------------------------------------------------------------------------
// lireCompteursFileSortante
// ---------------------------------------------------------------------------------------------

describe('lireCompteursFileSortante', () => {
	it('compte « en attente » sur queued/sending et « échecs » sur failed (§20.11.2)', async () => {
		const { client, appel } = espionCompteurs(
			{ count: 3, error: null, status: 200 },
			{ count: 1, error: null, status: 200 },
		)
		const resultat = await lireCompteursFileSortante(client, 'ws-1')
		expect(appel.table).toBe('mail_outbox')
		// Deux `GET` bornés à zéro ligne, jamais un `HEAD` (INC-299, décision 700, `compter.ts`).
		expect(appel.options).toEqual({ count: 'exact' })
		expect(appel.limites).toEqual([0, 0])
		// `CRM-161` T1 (§35.5) : les deux comptes portent l'espace courant.
		expect(appel.espaces).toEqual(['ws-1', 'ws-1'])
		expect(appel.in).toEqual(['status', ['queued', 'sending']])
		expect(appel.eq).toEqual(['status', 'failed'])
		expect(resultat).toEqual({
			statut: 'pret',
			donnees: { enAttente: 3, echecsDefinitifs: 1 },
		})
	})

	it('rend zéro sans confondre l’absence de droit avec une panne', async () => {
		const { client } = espionCompteurs(
			{ count: 0, error: null, status: 200 },
			{ count: 0, error: null, status: 200 },
		)
		const resultat = await lireCompteursFileSortante(client, 'ws-1')
		expect(resultat).toEqual({ statut: 'pret', donnees: { enAttente: 0, echecsDefinitifs: 0 } })
	})

	it('classe un refus sur le premier comptage sans lire le second', async () => {
		const { client } = espionCompteurs(
			{ count: null, error: { message: 'denied' }, status: 403 },
			{ count: 0, error: null, status: 200 },
		)
		const resultat = await lireCompteursFileSortante(client, 'ws-1')
		expect(resultat).toEqual({ statut: 'erreur', erreur: { nature: 'forbidden', detail: 'denied' } })
	})

	it('traite un `count` absent comme un contrat rompu, jamais comme zéro', async () => {
		const { client } = espionCompteurs(
			{ count: null, error: null, status: 200 },
			{ count: 0, error: null, status: 200 },
		)
		const resultat = await lireCompteursFileSortante(client, 'ws-1')
		expect(resultat.statut).toBe('erreur')
	})
})

// ---------------------------------------------------------------------------------------------
// Le dictionnaire fermé des six codes — §20.11.4
// ---------------------------------------------------------------------------------------------

describe('estCodeIncidentConnu', () => {
	it.each(CODES_INCIDENT_MAIL)('reconnaît %s', (code) => {
		expect(estCodeIncidentConnu(code)).toBe(true)
	})

	it('refuse un septième code — la contrainte serait en défaut, pas ce module', () => {
		expect(estCodeIncidentConnu('unknown_error')).toBe(false)
	})
})
