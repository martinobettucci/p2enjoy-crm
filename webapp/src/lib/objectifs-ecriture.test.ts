// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2a : la géométrie
// @verifies docs/SPEC-goals.md §3 (poser un bloc — la position vient du GESTE ; déplacer et
//           redimensionner — persiste `pos_x`, `pos_y`, `width`, `height`), §2.2 (colonnes),
//           §4.2 (l'écriture est décidée par la base, jamais par l'écran)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus filtré par `using` est zéro ligne, pas une
//           erreur)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (gestes de géométrie du canevas)
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE, et pas seulement la valeur rendue. Deux
// exigences de la spécification ne vivent que dans la requête, et aucune assertion de valeur ne
// les attraperait :
//
//   * un déplacement n'envoie PAS de taille, et un redimensionnement n'envoie PAS de position —
//     écrire les quatre colonnes à chaque geste écraserait celles qu'un collègue vient de changer ;
//   * un bloc neuf n'envoie AUCUN `channel_id` : poser un lien exige `app.can_write_channel`
//     (§4.2), c'est un geste distinct.
//
// La troisième issue — `200` avec zéro ligne, produite par la clause `using` — est éprouvée
// CONTRE SON SUCCÈS : une implémentation qui rendrait « enregistrée » sur une réponse vide
// passerait tous les autres cas de ce fichier.

import { describe, expect, it } from 'vitest'
import {
	CODE_INTERDIT,
	CODE_SAISIE_INVALIDE,
	PAS_CLAVIER,
	PAS_CLAVIER_FIN,
	TAILLE_BLOC_MINIMALE,
	TAILLE_BLOC_NEUF,
	blocDepuisLigne,
	bornerCoordonnee,
	bornerDimension,
	classerRefusBloc,
	ecrireGeometrieBloc,
	poserBloc,
} from './objectifs-ecriture'
import { COLONNES_BLOC } from './objectifs'
import type { ClientCrm } from './supabase'

const ID_TABLEAU = '5eed0000-0000-4000-8000-0000000000b1'
const ID_BLOC = '5eed0000-0000-4000-8000-0000000000b2'

/** Une ligne telle que PostgREST la rend, avec l'imbrication du channel. */
function ligneRendue(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: ID_BLOC,
		title: 'Nouvel objectif',
		body: null,
		fill_percent: 0,
		channel_id: null,
		pos_x: 120,
		pos_y: 64,
		width: TAILLE_BLOC_NEUF.largeur,
		height: TAILLE_BLOC_NEUF.hauteur,
		color: 'brand',
		channels: null,
		...surcharge,
	}
}

type AppelEcriture = {
	table?: string
	operation?: 'insert' | 'update'
	charge?: Record<string, unknown>
	filtres: string[]
	colonnes?: string
}

function espion(reponse: {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}): { client: ClientCrm; appel: AppelEcriture } {
	const appel: AppelEcriture = { filtres: [] }
	const chaine: Record<string, unknown> = {
		eq: (colonne: string, valeur: unknown) => {
			appel.filtres.push(`eq(${colonne},${String(valeur)})`)
			return chaine
		},
		select: (colonnes: string) => {
			appel.colonnes = colonnes
			return chaine
		},
		then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
		single: () =>
			Promise.resolve({
				...reponse,
				data: reponse.data === null ? null : (reponse.data[0] ?? null),
			}),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				insert: (charge: Record<string, unknown>) => {
					appel.operation = 'insert'
					appel.charge = charge
					return chaine
				},
				update: (charge: Record<string, unknown>) => {
					appel.operation = 'update'
					appel.charge = charge
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

describe('bornes du geste', () => {
	it('ramène une coordonnée négative à l’origine du canevas', () => {
		// Un bloc posé hors de l'étendue serait rendu en dehors de la surface défilable, donc
		// inatteignable à la souris COMME au clavier.
		expect(bornerCoordonnee(-40)).toBe(0)
		expect(bornerCoordonnee(0)).toBe(0)
	})

	it('arrondit à l’unité : un demi-pixel de canevas n’est pas une position', () => {
		expect(bornerCoordonnee(17.6)).toBe(18)
	})

	it('tient la taille minimale du GESTE, sans jamais la descendre', () => {
		expect(bornerDimension(10, TAILLE_BLOC_MINIMALE.largeur)).toBe(TAILLE_BLOC_MINIMALE.largeur)
		expect(bornerDimension(300, TAILLE_BLOC_MINIMALE.largeur)).toBe(300)
	})

	it('propose deux pas clavier distincts, sans quoi le clavier n’atteindrait pas ce que la souris atteint', () => {
		expect(PAS_CLAVIER).toBeGreaterThan(PAS_CLAVIER_FIN)
		expect(PAS_CLAVIER_FIN).toBe(1)
	})
})

describe('classerRefusBloc', () => {
	it('classe une contrainte de forme sur son CODE, avant tout statut', () => {
		expect(classerRefusBloc(400, CODE_SAISIE_INVALIDE, 'titre vide').nature).toBe('saisie-invalide')
	})

	it('classe le refus d’une politique sur son code, y compris derrière un statut inattendu', () => {
		expect(classerRefusBloc(400, CODE_INTERDIT, 'row-level security').nature).toBe('interdit')
	})

	it('classe un 403 sans code comme un interdit', () => {
		expect(classerRefusBloc(403, undefined, 'forbidden').nature).toBe('interdit')
	})

	it('replie tout le reste sur « indisponible » plutôt que d’inventer une cause', () => {
		expect(classerRefusBloc(500, undefined, 'boom').nature).toBe('indisponible')
		expect(classerRefusBloc(undefined, undefined, 'réseau').nature).toBe('indisponible')
	})

	it('conserve le détail pour le diagnostic, jamais pour l’écran', () => {
		expect(classerRefusBloc(500, undefined, 'boom').detail).toBe('boom')
	})
})

describe('blocDepuisLigne', () => {
	it('retire l’imbrication de la ligne et la traduit en destination', () => {
		const bloc = blocDepuisLigne(
			ligneRendue({
				channel_id: 'c1',
				channels: {
					id: 'c1',
					name: 'Refonte de site',
					slug: 'refonte',
					deleted_at: null,
					tracks: { name: 'Studio web', slug: 'studio-web', deleted_at: null },
				},
			}),
		)
		expect(bloc.destination?.nom).toBe('Refonte de site')
		expect(bloc.destination?.track?.slug).toBe('studio-web')
		// La clé brute de PostgREST ne doit jamais fuir vers l'écran.
		expect(Object.keys(bloc)).not.toContain('channels')
	})
})

describe('poserBloc', () => {
	it('envoie la position DU GESTE, la taille d’un bloc neuf, et AUCUN channel', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 201 })
		const resultat = await poserBloc(client, {
			idTableau: ID_TABLEAU,
			x: 120.4,
			y: 64,
			titre: '  Nouvel objectif  ',
		})

		expect(appel.table).toBe('goal_blocks')
		expect(appel.operation).toBe('insert')
		expect(appel.charge).toEqual({
			board_id: ID_TABLEAU,
			title: 'Nouvel objectif',
			pos_x: 120,
			pos_y: 64,
			width: TAILLE_BLOC_NEUF.largeur,
			height: TAILLE_BLOC_NEUF.hauteur,
		})
		// §4.2 : poser un lien exige `app.can_write_channel`, c'est un geste distinct.
		expect(appel.charge).not.toHaveProperty('channel_id')
		// §1 : rien n'est dérivé, `fill_percent` n'est même pas envoyé — la base pose son défaut.
		expect(appel.charge).not.toHaveProperty('fill_percent')
		expect(appel.colonnes).toBe(COLONNES_BLOC)
		expect(resultat.statut).toBe('cree')
	})

	it('borne la position à l’origine plutôt que de poser un bloc hors du canevas', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 201 })
		await poserBloc(client, { idTableau: ID_TABLEAU, x: -12, y: -3, titre: 'x' })
		expect(appel.charge?.pos_x).toBe(0)
		expect(appel.charge?.pos_y).toBe(0)
	})

	it('traduit un refus de politique sans jamais rendre le message du serveur', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'new row violates row-level security policy', code: CODE_INTERDIT },
			status: 403,
		})
		const resultat = await poserBloc(client, { idTableau: ID_TABLEAU, x: 0, y: 0, titre: 'x' })
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'interdit', detail: 'new row violates row-level security policy' },
		})
	})
})

describe('ecrireGeometrieBloc', () => {
	it('un DÉPLACEMENT n’envoie que la position — jamais la taille', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireGeometrieBloc(client, ID_BLOC, { x: 40, y: 80 })

		expect(appel.operation).toBe('update')
		expect(appel.charge).toEqual({ pos_x: 40, pos_y: 80 })
		expect(appel.filtres).toEqual([`eq(id,${ID_BLOC})`])
	})

	it('un REDIMENSIONNEMENT n’envoie que la taille — jamais la position', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireGeometrieBloc(client, ID_BLOC, { largeur: 300, hauteur: 200 })
		expect(appel.charge).toEqual({ width: 300, height: 200 })
	})

	it('borne la taille envoyée au minimum du geste', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireGeometrieBloc(client, ID_BLOC, { largeur: 4, hauteur: 4 })
		expect(appel.charge).toEqual({
			width: TAILLE_BLOC_MINIMALE.largeur,
			height: TAILLE_BLOC_MINIMALE.hauteur,
		})
	})

	it('demande la ligne rendue, sans quoi « zéro ligne » serait indistinguable d’un succès', async () => {
		const { client, appel } = espion({ data: [ligneRendue()], error: null, status: 200 })
		await ecrireGeometrieBloc(client, ID_BLOC, { x: 1, y: 1 })
		expect(appel.colonnes).toBe(COLONNES_BLOC)
	})

	it('rend « sans-effet » sur une réponse aboutie de ZÉRO ligne, jamais un succès', async () => {
		// C'est la troisième issue, et elle est STRUCTURELLE : la clause `using` d'une politique
		// rend la ligne invisible à l'écriture, si bien que le serveur répond 200 sans erreur.
		const { client } = espion({ data: [], error: null, status: 200 })
		const resultat = await ecrireGeometrieBloc(client, ID_BLOC, { x: 1, y: 1 })
		expect(resultat).toEqual({ statut: 'sans-effet' })
	})

	it('rend la ligne du serveur sur un succès, pour que l’écran n’ait pas à relire', async () => {
		const { client } = espion({ data: [ligneRendue({ pos_x: 40, pos_y: 80 })], error: null, status: 200 })
		const resultat = await ecrireGeometrieBloc(client, ID_BLOC, { x: 40, y: 80 })
		expect(resultat.statut).toBe('enregistree')
		if (resultat.statut !== 'enregistree') return
		expect(resultat.bloc.pos_x).toBe(40)
		expect(resultat.bloc.pos_y).toBe(80)
	})

	it('traduit une contrainte de forme violée en refus, et ne lève jamais', async () => {
		const { client } = espion({
			data: null,
			error: { message: 'violates check constraint', code: CODE_SAISIE_INVALIDE },
			status: 400,
		})
		const resultat = await ecrireGeometrieBloc(client, ID_BLOC, { largeur: 300 })
		expect(resultat.statut).toBe('refus')
	})

	it('ne lève pas lorsque le transport échoue', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const resultat = await ecrireGeometrieBloc(client, ID_BLOC, { x: 1 })
		expect(resultat).toEqual({
			statut: 'refus',
			refus: { nature: 'indisponible', detail: 'réseau coupé' },
		})
	})
})
