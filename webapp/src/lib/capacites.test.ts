// @verifies CRM-093 (docs/BACKLOG.md) — tranche T2 : la capacité lue par l'interface et ce qu'elle fait d'une commande
// @verifies docs/SPEC-droits-interface.md §2.1 (la capacité d'une affaire ou d'un channel, sur sa ligne), §2.2 (la lecture des deux capacités de l'espace, sur sa ligne), §3 (refusée :
//           désactivée, citant son motif), §4 (en lecture : désactivée sans motif ; inconnue : offerte), §5 (« La
//           corbeille, précisée » : la capacité de plusieurs affaires en une lecture — tranche T4)

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
	CAPACITES_INCONNUES,
	capaciteDansLEtat,
	capaciteDeBoiteMail,
	capaciteDe,
	capaciteDeLEtat,
	capacitesDeLEtat,
	lireCapacitesEspace,
	lireEcriturePermise,
	lireEcrituresPermises,
	motifVisible,
	proprietesCommande,
	useCapacitesEspace,
	useEcriturePermise,
} from './capacites'
import { enChargement, enErreur, pret } from './async'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

function espion(reponse: Reponse | Error) {
	const appels: { table: string; colonnes?: string; filtres: [string, unknown][] }[] = []
	const client = {
		from: (table: string) => {
			const appel: (typeof appels)[number] = { table, filtres: [] }
			appels.push(appel)
			const chaine: Record<string, unknown> = {}
			chaine.select = (colonnes: string) => {
				appel.colonnes = colonnes
				return chaine
			}
			chaine.in = (colonne: string, valeur: unknown) => {
				appel.filtres.push([colonne, valeur])
				return chaine
			}
			chaine.eq = (colonne: string, valeur: unknown) => {
				appel.filtres.push([colonne, valeur])
				return chaine
			}
			chaine.then = (ok: (r: Reponse) => unknown, ko: (e: unknown) => unknown) =>
				reponse instanceof Error ? Promise.reject(reponse).then(ok, ko) : Promise.resolve(reponse).then(ok)
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, appels }
}

describe('une valeur de colonne calculée', () => {
	it('seul false refuse, true permet, tout le reste est inconnu', () => {
		expect(capaciteDe(true)).toBe('permise')
		expect(capaciteDe(false)).toBe('refusee')
		for (const valeur of [null, undefined, 'true', 0, 1]) expect(capaciteDe(valeur)).toBe('inconnue')
	})

	it('un état asynchrone : en lecture, inconnu sur un échec', () => {
		expect(capaciteDeLEtat(enChargement())).toBe('en-lecture')
		expect(capaciteDeLEtat(enErreur({ nature: 'reseau', detail: 'x' } as never))).toBe('inconnue')
		expect(capaciteDeLEtat(pret(false))).toBe('refusee')
		expect(capaciteDeLEtat(pret(null))).toBe('inconnue')
	})
})

describe('ce que la capacité fait d’une commande', () => {
	it('refusée : désactivée, et elle cite le motif du bloc', () => {
		expect(proprietesCommande('refusee', 'motif-x')).toEqual({ disabled: true, 'aria-describedby': 'motif-x' })
		expect(motifVisible('refusee')).toBe(true)
	})

	it('en lecture : désactivée SANS motif — aucun refus ne s’affiche avant d’être su', () => {
		expect(proprietesCommande('en-lecture', 'motif-x')).toEqual({ disabled: true })
		expect(motifVisible('en-lecture')).toBe(false)
	})

	it('permise ou inconnue : offerte — un défaut de lecture ne prive personne de ses gestes', () => {
		expect(proprietesCommande('permise', 'motif-x')).toEqual({})
		expect(proprietesCommande('inconnue', 'motif-x')).toEqual({})
		expect(motifVisible('inconnue')).toBe(false)
	})

	it('une désactivation étrangère au droit — un envoi en vol — est gardée', () => {
		expect(proprietesCommande('permise', 'motif-x', true)).toEqual({ disabled: true })
		expect(proprietesCommande('refusee', 'motif-x', true)).toEqual({ disabled: true, 'aria-describedby': 'motif-x' })
	})
})

describe('les deux capacités de l’espace', () => {
	it('se lisent sur la ligne de l’espace, par ses deux colonnes calculées', async () => {
		const { client, appels } = espion({ data: [{ administration_permise: false, edition_permise: true }], error: null, status: 200 })
		expect(await lireCapacitesEspace(client, 'w1')).toEqual(pret({ administration: 'refusee', edition: 'permise' }))
		expect(appels[0]).toEqual({ table: 'workspaces', colonnes: 'administration_permise, edition_permise', filtres: [['id', 'w1']] })
	})

	it('une colonne absente de la réponse est inconnue, et n’éteint rien', async () => {
		const { client } = espion({ data: [{ edition_permise: false }], error: null, status: 200 })
		expect(await lireCapacitesEspace(client, 'w1')).toEqual(pret({ administration: 'inconnue', edition: 'refusee' }))
	})

	it('aucune ligne : rien n’est su', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		expect(await lireCapacitesEspace(client, 'w1')).toEqual(pret(CAPACITES_INCONNUES))
	})

	it('une erreur de la base, ou une panne de transport, rend une erreur — jamais une exception', async () => {
		const enPanne = await lireCapacitesEspace(espion({ data: null, error: { message: 'PGRST202' }, status: 400 }).client, 'w1')
		expect(enPanne.statut).toBe('erreur')
		const transport = await lireCapacitesEspace(espion(new Error('Failed to fetch')).client, 'w1')
		expect(transport.statut).toBe('erreur')
		expect(capacitesDeLEtat(transport)).toEqual(CAPACITES_INCONNUES)
	})

	it('pendant la lecture, les deux sont en lecture', () => {
		expect(capacitesDeLEtat(enChargement())).toEqual({ administration: 'en-lecture', edition: 'en-lecture' })
	})
})

describe('la capacité d’écrire sur une affaire ou un channel (§2.1)', () => {
	it('se lit par la colonne calculée de SA ligne', async () => {
		const { client, appels } = espion({ data: [{ ecriture_permise: false }], error: null, status: 200 })
		expect(await lireEcriturePermise(client, 'cards', 'c1')).toEqual(pret(false))
		expect(appels[0]).toEqual({ table: 'cards', colonnes: 'ecriture_permise', filtres: [['id', 'c1']] })
	})

	it('une ligne absente, ou une valeur qui n’est pas un booléen, est inconnue', async () => {
		expect(await lireEcriturePermise(espion({ data: [], error: null, status: 200 }).client, 'channels', 'x')).toEqual(pret(null))
		expect(
			await lireEcriturePermise(espion({ data: [{ ecriture_permise: 'oui' }], error: null, status: 200 }).client, 'channels', 'x'),
		).toEqual(pret(null))
		expect(capaciteDeLEtat(pret(null))).toBe('inconnue')
	})

	it('une erreur — colonne inconnue d’un cache périmé — rend une erreur, donc une capacité inconnue', async () => {
		const etat = await lireEcriturePermise(espion({ data: null, error: { message: 'PGRST204' }, status: 400 }).client, 'cards', 'c1')
		expect(capaciteDeLEtat(etat)).toBe('inconnue')
	})
})

describe('la capacité d’écrire sur plusieurs affaires, en une lecture (§5, la corbeille)', () => {
	it('se lit par la colonne calculée des lignes demandées, en un seul appel', async () => {
		const { client, appels } = espion({
			data: [
				{ id: 'c1', ecriture_permise: true },
				{ id: 'c2', ecriture_permise: false },
				{ id: 'c3', ecriture_permise: null },
			],
			error: null,
			status: 200,
		})
		const etat = await lireEcrituresPermises(client, 'cards', ['c1', 'c2', 'c3', 'c4'])
		expect(appels).toEqual([{ table: 'cards', colonnes: 'id, ecriture_permise', filtres: [['id', ['c1', 'c2', 'c3', 'c4']]] }])
		expect(capaciteDansLEtat(etat, 'c1')).toBe('permise')
		expect(capaciteDansLEtat(etat, 'c2')).toBe('refusee')
		expect(capaciteDansLEtat(etat, 'c3'), 'une valeur qui n’est pas un booléen est inconnue').toBe('inconnue')
		expect(capaciteDansLEtat(etat, 'c4'), 'une ligne non rendue est inconnue').toBe('inconnue')
	})

	it('aucune affaire : aucune requête', async () => {
		const { client, appels } = espion({ data: [], error: null, status: 200 })
		expect(await lireEcrituresPermises(client, 'cards', [])).toEqual(pret({}))
		expect(appels).toEqual([])
	})

	it('pendant la lecture : en lecture ; sur une erreur ou une panne de transport : inconnue', async () => {
		expect(capaciteDansLEtat(enChargement(), 'c1')).toBe('en-lecture')
		const erreur = await lireEcrituresPermises(espion({ data: null, error: { message: 'PGRST204' }, status: 400 }).client, 'cards', ['c1'])
		expect(capaciteDansLEtat(erreur, 'c1')).toBe('inconnue')
		const panne = await lireEcrituresPermises(espion(new Error('réseau')).client, 'cards', ['c1'])
		expect(panne.statut).toBe('erreur')
	})
})

describe('la capacité d’écrire une boîte ou une identité mail (§5)', () => {
	it('la sienne est personnelle : jamais éteinte, même quand l’administration est refusée ou en lecture', () => {
		expect(capaciteDeBoiteMail('moi', 'moi', 'refusee')).toBe('permise')
		expect(capaciteDeBoiteMail('moi', 'moi', 'en-lecture')).toBe('permise')
	})
	it('la boîte système et celle d’un autre suivent l’administration de l’espace', () => {
		for (const administration of ['permise', 'refusee', 'en-lecture', 'inconnue'] as const) {
			expect(capaciteDeBoiteMail(null, 'moi', administration)).toBe(administration)
			expect(capaciteDeBoiteMail('autre', 'moi', administration)).toBe(administration)
		}
	})
	it('sans session connue, aucune boîte n’est « la sienne »', () => {
		expect(capaciteDeBoiteMail(null, null, 'refusee')).toBe('refusee')
	})
})

/** Un client dont chaque lecture attend que le test la libère : l'état intermédiaire devient observable. */
function clientEnAttente() {
	const enAttente: ((valeur: boolean) => void)[] = []
	const client = {
		from: () => {
			const chaine: Record<string, unknown> = {}
			chaine.select = () => chaine
			chaine.eq = () => chaine
			chaine.then = (ok: (r: unknown) => unknown) =>
				new Promise<boolean>((resoudre) => enAttente.push(resoudre)).then((valeur) =>
					ok({ data: [{ ecriture_permise: valeur, administration_permise: valeur, edition_permise: valeur }], error: null, status: 200 }),
				)
			return chaine
		},
	}
	const liberer = async (valeur: boolean) =>
		act(async () => {
			// TOUTES les lectures en attente : une lecture abandonnée (effet rejoué) reste dans la file, et libérer la seule
			// première laisserait la vivante en suspens.
			// `await` n'appelle le `then` du client qu'au tour suivant : la lecture n'est inscrite qu'après lui.
			await new Promise((fin) => setTimeout(fin, 0))
			for (const resoudre of enAttente.splice(0)) resoudre(valeur)
			await new Promise((fin) => setTimeout(fin, 0))
		})
	return { client: client as unknown as ClientCrm, liberer }
}

describe('la capacité appartient à la ligne lue, jamais à la précédente (INC-281)', () => {
	it('aucun rendu ne porte, pour un identifiant connu, l’état d’un autre identifiant', async () => {
		const { client, liberer } = clientEnAttente()
		// CHAQUE RENDU est consigné : `rerender` exécute les effets, et seul ce journal voit le rendu intermédiaire où
		// l'identifiant est déjà neuf et l'état encore ancien — le défaut qu'INC-281 corrige.
		const rendus: [string | null, string][] = []
		const { rerender } = renderHook(({ id }: { id: string | null }) => {
			const capacite = useEcriturePermise(client, 'cards', id)
			rendus.push([id, capacite])
			return capacite
		}, { initialProps: { id: null as string | null } })
		rerender({ id: 'c1' })
		await liberer(false)
		rerender({ id: 'c2' })
		await liberer(true)
		const deC1 = rendus.filter(([id]) => id === 'c1').map(([, c]) => c)
		const deC2 = rendus.filter(([id]) => id === 'c2').map(([, c]) => c)
		expect(deC1, 'c1 : en lecture, puis refusée — jamais l’« inconnue » de l’absence').toEqual(
			expect.arrayContaining(['en-lecture', 'refusee']),
		)
		expect(deC1).not.toContain('inconnue')
		expect(deC2, 'c2 : jamais la capacité de c1').not.toContain('refusee')
		expect(deC2.at(-1)).toBe('permise')
	})

	it('l’espace aussi : un espace qui change ne rend jamais les capacités de l’ancien', async () => {
		const { client, liberer } = clientEnAttente()
		const rendus: [string, string][] = []
		const { rerender } = renderHook(({ id }: { id: string }) => {
			const capacites = useCapacitesEspace(client, id)
			rendus.push([id, capacites.administration])
			return capacites
		}, { initialProps: { id: 'w1' } })
		await liberer(false)
		rerender({ id: 'w2' })
		const deW2 = rendus.filter(([id]) => id === 'w2').map(([, c]) => c)
		expect(deW2).not.toContain('refusee')
		expect(deW2.at(-1)).toBe('en-lecture')
	})
})
