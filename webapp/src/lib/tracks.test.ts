// @verifies CRM-020 (docs/BACKLOG.md) — lecture des tracks par la barre latérale
// @verifies docs/SPEC-tracks.md §7 (requête émise), §4 (archivage masqué), §3 (ordre)
// @verifies docs/SPEC-webapp.md §6.4 (contrat asynchrone), §7 (états systématiques)
// @verifies INC-254, décision 608 — docs/BACKLOG.md « Correctif arbitré le 2026-09-28 » ;
//           docs/SPEC-webapp.md §6.3 bis (la relecture silencieuse et le signal `p2enjoy:tracks-modifies`),
//           docs/DESIGN_SYSTEM.md §5.13, §5.29 tranche 2 c (un rechargement n'efface pas la liste qu'il relit)
//
// Ce fichier éprouve **la requête réellement émise** et la classification des échecs, pas
// seulement la valeur rendue. Motif : deux des trois exigences de `docs/SPEC-tracks.md` §7 sont
// portées par la requête elle-même — le filtre des archivés et l'ordre — et un test qui
// n'observerait que la réponse les laisserait disparaître sans bruit.

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
	COLONNES_TRACK,
	EVENEMENT_TRACKS_MODIFIES,
	lireTracks,
	signalerTracksModifies,
	useApresTracksModifies,
	useTracks,
	type Track,
} from './tracks'
import type { ClientCrm } from './supabase'

type Appel = {
	table?: string
	colonnes?: string
	filtres: [string, unknown][]
	tris: string[]
}

type Reponse = { data: Track[] | null; error: { message: string } | null; status: number }

/** Client factice qui **enregistre** la requête construite, puis rend la réponse voulue. */
function clientEspion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { filtres: [], tris: [] }
	const chaine = {
		is: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		order: (colonne: string) => {
			appel.tris.push(colonne)
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

/** Client dont le transport échoue par une exception, comme `supabase-js` peut le faire. */
function clientQuiLeve(cause: unknown): ClientCrm {
	return {
		from: () => ({
			select: () => ({
				// Deux `is` enchaînés : l'archivage, puis la corbeille (CRM-077). Le double reflète
				// la requête réelle — un double plus court passerait en `undefined is not a
				// function` et accuserait le transport d'une erreur d'écriture du test.
				is: () => ({
					is: () => ({
						order: () => ({
							order: () => {
								throw cause
							},
						}),
					}),
				}),
			}),
		}),
	} as unknown as ClientCrm
}

const TRACK: Track = {
	id: 't-1',
	name: 'Conseil & IA',
	slug: 'conseil-ia',
	color: 'brand',
	icon: 'sparkles',
	position: 1,
}

describe('la requête émise porte les règles de docs/SPEC-tracks.md', () => {
	it('interroge `tracks`, et ne demande que les colonnes affichées', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireTracks(client)
		expect(appel.table).toBe('tracks')
		expect(appel.colonnes).toBe(COLONNES_TRACK)
		// `description` et les horodatages ne sont pas demandés : une requête ne rapporte que ce
		// qui est affiché.
		expect(appel.colonnes).not.toContain('description')
		expect(appel.colonnes).not.toContain('created_at')
	})

	it('masque les tracks archivés **côté serveur**, pas après coup', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireTracks(client)
		expect(appel.filtres[0]).toEqual(['archived_at', null])
	})

	// @verifies CRM-077 — docs/SPEC-corbeille.md §3.1 et §4
	//
	// LES DEUX FILTRES SONT SÉPARÉS, ET L'ASSERTION LE FIGE. Archiver et mettre à la corbeille sont
	// deux états indépendants : un track archivé PUIS mis à la corbeille ne doit pas réapparaître le
	// jour où on le désarchive. Un filtre unique — ou un `or` — aurait confondu les deux, et le
	// produit n'aurait plus eu de moyen de les distinguer à l'écran de la corbeille.
	it('retire aussi les tracks EN CORBEILLE, par un filtre distinct de l’archivage', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireTracks(client)
		expect(appel.filtres).toEqual([
			['archived_at', null],
			['deleted_at', null],
		])
	})

	it('trie par `position` puis par `name`, pour que l’ordre soit stable', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireTracks(client)
		expect(appel.tris).toEqual(['position', 'name'])
	})
})

describe('états rendus (docs/SPEC-webapp.md §6.4)', () => {
	it('rend l’état prêt avec les lignes reçues', async () => {
		const { client } = clientEspion({ data: [TRACK], error: null, status: 200 })
		const etat = await lireTracks(client)
		expect(etat).toEqual({ statut: 'pret', donnees: [TRACK] })
	})

	// « 200 et zéro ligne » est le refus de la RLS, pas une erreur : c'est un état **vide**.
	it('rend un état prêt et vide quand la RLS refuse par zéro ligne', async () => {
		const { client } = clientEspion({ data: [], error: null, status: 200 })
		const etat = await lireTracks(client)
		expect(etat).toEqual({ statut: 'pret', donnees: [] })
	})

	it('classe un 403 en refus, et non en erreur générique', async () => {
		const { client } = clientEspion({
			data: null,
			error: { message: 'permission denied for table tracks' },
			status: 403,
		})
		const etat = await lireTracks(client)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})

	it('classe une absence de réponse en panne de transport', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'Failed to fetch' }, status: 0 })
		const etat = await lireTracks(client)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('network')
	})

	it('classe un code inattendu en erreur inconnue, sans prétendre savoir', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'boom' }, status: 500 })
		const etat = await lireTracks(client)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('unknown')
	})

	// Une exception de transport ne doit pas remonter jusqu'à React : elle est rendue comme un
	// état, jamais relancée.
	it('ne lève jamais, même quand le client lève', async () => {
		const etat = await lireTracks(clientQuiLeve(new Error('socket fermée')))
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') {
			expect(etat.erreur.nature).toBe('network')
			expect(etat.erreur.detail).toBe('socket fermée')
		}
	})

	it('rend un état d’erreur lisible même si la cause n’est pas une Error', async () => {
		const etat = await lireTracks(clientQuiLeve('panne brute'))
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.detail).toBe('panne brute')
	})
})

// ---------------------------------------------------------------------------------------------
// INC-254, décision 608 — docs/SPEC-webapp.md §6.3 bis
// ---------------------------------------------------------------------------------------------

/** Un client dont les réponses se succèdent, une par lecture, et qui peut retenir la suivante. */
function clientSuccessif(reponses: Reponse[]): { client: ClientCrm; lectures: () => number; liberer: () => void } {
	let lectures = 0
	// `await` appelle le `then` d'un objet dans une micro-tâche : une libération demandée AVANT cet appel
	// est retenue, sans quoi elle ne libérerait rien et la lecture attendrait pour toujours.
	let libere = false
	let suite: (() => void) | null = null
	const client = {
		from: () => ({
			select: () => {
				const rang = lectures
				lectures += 1
				const reponse = reponses[Math.min(rang, reponses.length - 1)] as Reponse
				const chaine = {
					is: () => chaine,
					order: () => chaine,
					then: (resoudre: (valeur: Reponse) => unknown) =>
						// La SECONDE lecture est retenue jusqu'à `liberer` : c'est la fenêtre où une relecture
						// qui repasserait par le chargement ferait paraître le squelette.
						rang === 0
							? Promise.resolve(reponse).then(resoudre)
							: new Promise<void>((poursuivre) => {
									if (libere) poursuivre()
									else suite = poursuivre
								}).then(() => resoudre(reponse)),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return {
		client,
		lectures: () => lectures,
		liberer: () => {
			libere = true
			suite?.()
		},
	}
}

const SECOND: Track = { ...TRACK, id: 't-2', name: 'Studio web', slug: 'studio-web', position: 2 }

describe('la relecture silencieuse — docs/SPEC-webapp.md §6.3 bis', () => {
	it('garde la liste affichée pendant la relecture, puis rend la nouvelle — aucun squelette', async () => {
		const espion = clientSuccessif([
			{ data: [TRACK], error: null, status: 200 },
			{ data: [TRACK, SECOND], error: null, status: 200 },
		])
		const { result } = renderHook(() => useTracks(espion.client))
		await waitFor(() => expect(result.current.etat.statut).toBe('pret'))

		act(() => result.current.relire())
		// La relecture est en vol : l'état reste PRÊT, avec l'ancienne liste.
		expect(espion.lectures()).toBe(2)
		expect(result.current.etat).toEqual({ statut: 'pret', donnees: [TRACK] })

		await act(async () => espion.liberer())
		await waitFor(() => expect(result.current.etat).toEqual({ statut: 'pret', donnees: [TRACK, SECOND] }))
	})

	it('un échec de la relecture est un échec de lecture comme un autre — jamais une liste gardée en silence', async () => {
		const espion = clientSuccessif([
			{ data: [TRACK], error: null, status: 200 },
			{ data: null, error: { message: 'Failed to fetch' }, status: 0 },
		])
		const { result } = renderHook(() => useTracks(espion.client))
		await waitFor(() => expect(result.current.etat.statut).toBe('pret'))
		act(() => result.current.relire())
		await act(async () => espion.liberer())
		await waitFor(() => expect(result.current.etat.statut).toBe('erreur'))
	})

	it('`recharger`, la reprise d’une erreur, repasse bien par le chargement : seule la relecture est silencieuse', async () => {
		const espion = clientSuccessif([
			{ data: [TRACK], error: null, status: 200 },
			{ data: [TRACK], error: null, status: 200 },
		])
		const { result } = renderHook(() => useTracks(espion.client))
		await waitFor(() => expect(result.current.etat.statut).toBe('pret'))
		act(() => result.current.recharger())
		expect(result.current.etat.statut).toBe('chargement')
		await act(async () => espion.liberer())
	})
})

describe('le signal `p2enjoy:tracks-modifies` — docs/SPEC-webapp.md §6.3 bis', () => {
	it('`signalerTracksModifies` émet l’événement nommé, et l’abonnement le reçoit', () => {
		let recus = 0
		const relire = () => {
			recus += 1
		}
		const { unmount } = renderHook(() => useApresTracksModifies(relire))
		signalerTracksModifies()
		expect(recus).toBe(1)
		// Démonté, il le lâche : aucune relecture ne part d'une coquille quittée.
		unmount()
		globalThis.dispatchEvent(new Event(EVENEMENT_TRACKS_MODIFIES))
		expect(recus).toBe(1)
	})
})

