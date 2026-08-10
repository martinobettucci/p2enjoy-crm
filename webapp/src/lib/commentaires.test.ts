// @verifies CRM-043 (docs/BACKLOG.md) — projection du fil, requête émise, classification des refus
// @verifies CRM-022 (docs/BACKLOG.md) — auteur embarqué et détachable
// @verifies docs/SPEC-cards.md §13.4 (la pierre tombale), §13.5 (`edited_at`), §13.9 (recharger à
//           l'abonnement), §13.10 (ce que le panneau montre), §13.14 (preuves attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.10 (ordre chronologique croissant, place tenue)
// @verifies docs/JOURNAL.md décisions 195, 200, 201
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue. Motif, repris de
// `board.test.ts` : plusieurs exigences sont portées par la requête elle-même — les colonnes, le
// filtre par card, l'ordre **total** —, et un test qui n'observerait que la réponse les laisserait
// disparaître sans bruit.
//
// La projection, elle, est éprouvée **sans navigateur** : c'est tout l'objet de la séparation
// entre `commentaires.ts` et `PanneauCommentaires.tsx`.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_COMMENTAIRE,
	LONGUEUR_MAX_CORPS,
	classerRefusPublication,
	filtreCanal,
	lireCommentaires,
	nomCanal,
	projeterFil,
	publierCommentaire,
	classerRefusGeste,
	modifierCommentaire,
	supprimerCommentaire,
	type CommentaireLu,
} from './commentaires'
import type { ClientCrm } from './supabase'

/** Une ligne telle que la base la rend, mesurée sur le seed le 2026-08-05. */
function ligne(partiel: Partial<CommentaireLu> & { id: string }): CommentaireLu {
	return {
		card_id: '5eed0000-0000-4000-8000-0000000000c1',
		author_id: '5eed0000-0000-4000-8000-000000000011',
		body: 'Un commentaire.',
		created_at: '2026-08-05T10:00:00.000Z',
		edited_at: null,
		deleted_at: null,
		auteur: null,
		...partiel,
	}
}

describe('projection du fil (docs/DESIGN_SYSTEM.md §5.10)', () => {
	it('ordonne du plus ancien au plus récent — le sens où la conversation s’est tenue', () => {
		const fil = projeterFil([
			ligne({ id: 'c', created_at: '2026-08-05T12:00:00.000Z' }),
			ligne({ id: 'a', created_at: '2026-08-05T10:00:00.000Z' }),
			ligne({ id: 'b', created_at: '2026-08-05T11:00:00.000Z' }),
		])
		expect(fil.map((commentaire) => commentaire.id)).toEqual(['a', 'b', 'c'])
	})

	// L'ordre est TOTAL, terminé par `id` : deux commentaires publiés dans la même milliseconde
	// suffisent à rendre l'affichage instable d'un rechargement à l'autre, ce qu'un lecteur voit.
	// C'est la leçon de la sonde `sonde_l2` de `CRM-042` (décision 185), appliquée à un fil.
	it('départage deux commentaires de MÊME date par leur identifiant, jamais au hasard', () => {
		const memeInstant = '2026-08-05T10:00:00.000Z'
		const premier = projeterFil([
			ligne({ id: 'z', created_at: memeInstant }),
			ligne({ id: 'a', created_at: memeInstant }),
		])
		const second = projeterFil([
			ligne({ id: 'a', created_at: memeInstant }),
			ligne({ id: 'z', created_at: memeInstant }),
		])
		expect(premier.map((c) => c.id)).toEqual(['a', 'z'])
		expect(second.map((c) => c.id)).toEqual(premier.map((c) => c.id))
	})

	it('NE MASQUE PAS un commentaire supprimé : sa place est tenue', () => {
		const fil = projeterFil([
			ligne({ id: 'a' }),
			ligne({ id: 'b', body: '', deleted_at: '2026-08-05T11:00:00.000Z', created_at: '2026-08-05T11:00:00.000Z' }),
		])
		expect(fil).toHaveLength(2)
		expect(fil[1]?.supprime).toBe(true)
		// La base ne porte plus de corps : ce n'est pas un contenu masqué, c'est un contenu détruit.
		expect(fil[1]?.corps).toBe('')
	})

	it('porte la date de modification quand le corps a changé, et rien sinon', () => {
		const fil = projeterFil([
			ligne({ id: 'a' }),
			ligne({ id: 'b', edited_at: '2026-08-05T12:00:00.000Z', created_at: '2026-08-05T11:00:00.000Z' }),
		])
		expect(fil[0]?.modifieLe).toBeNull()
		expect(fil[1]?.modifieLe).toBe('2026-08-05T12:00:00.000Z')
	})

	it('ne modifie pas le tableau reçu — la projection est une lecture, pas un effet', () => {
		const lignes = [
			ligne({ id: 'b', created_at: '2026-08-05T12:00:00.000Z' }),
			ligne({ id: 'a', created_at: '2026-08-05T10:00:00.000Z' }),
		]
		projeterFil(lignes)
		expect(lignes.map((l) => l.id)).toEqual(['b', 'a'])
	})
})

// --- La requête réellement émise ----------------------------------------------------------------

type Appel = { table?: string; colonnes?: string; egalites: [string, unknown][]; tris: string[] }
type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }

function clientEspion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { egalites: [], tris: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.egalites.push([colonne, valeur])
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

describe('la lecture du fil (§13.10)', () => {
	it('demande les commentaires de LA card, dans un ordre TOTAL', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireCommentaires(client, 'card-1')

		expect(appel.table).toBe('card_comments')
		expect(appel.colonnes).toBe(COLONNES_COMMENTAIRE)
		expect(appel.colonnes).toContain('auteur:profiles!card_comments_author_id_fkey')
		expect(appel.egalites).toEqual([['card_id', 'card-1']])
		// `created_at` PUIS `id` : sans le second, l'ordre n'est pas total (décision 185).
		expect(appel.tris).toEqual(['created_at', 'id'])
	})

	// `workspace_id` et `mentions` ne sont pas demandées : la première n'est pas affichée, la
	// seconde n'est alimentée par rien. Une requête ne rapporte que ce que l'écran montre.
	it('ne demande ni `workspace_id`, ni `mentions`', () => {
		expect(COLONNES_COMMENTAIRE).not.toContain('workspace_id')
		expect(COLONNES_COMMENTAIRE).not.toContain('mentions')
	})

	it('classe un refus du backend, et ne rend jamais un fil vide à la place', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'refusé' }, status: 403 })
		const etat = await lireCommentaires(client, 'card-1')
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})
})

// --- La publication -----------------------------------------------------------------------------

type AppelInsertion = { table?: string; charge?: Record<string, unknown> }

function clientInsertion(reponse: {
	error: { message: string; code?: string } | null
	status: number
}): { client: ClientCrm; appel: AppelInsertion } {
	const appel: AppelInsertion = {}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				insert: (charge: Record<string, unknown>) => {
					appel.charge = charge
					return Promise.resolve(reponse)
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

describe('la publication d’un commentaire (§13.6)', () => {
	it('N’ENVOIE PAS `author_id` : la colonne vaut `auth.uid()`, et la politique refuse le reste', async () => {
		const { client, appel } = clientInsertion({ error: null, status: 201 })
		await publierCommentaire(client, { idCard: 'card-1', idWorkspace: 'ws-1', corps: 'Bonjour.' })

		expect(appel.table).toBe('card_comments')
		expect(appel.charge).toEqual({ card_id: 'card-1', workspace_id: 'ws-1', body: 'Bonjour.' })
		expect(appel.charge).not.toHaveProperty('author_id')
	})

	// Décision 200 : le client envoie un `workspace_id` qu'il ne DÉCIDE pas — le trigger le
	// remplace par celui de la card. Il est envoyé parce que le générateur de types, qui ne voit
	// pas les triggers, déclare la colonne obligatoire.
	it('envoie `workspace_id` sans prétendre le décider', async () => {
		const { client, appel } = clientInsertion({ error: null, status: 201 })
		await publierCommentaire(client, { idCard: 'card-1', idWorkspace: 'ws-inventé', corps: 'x' })
		expect(appel.charge?.['workspace_id']).toBe('ws-inventé')
	})

	it('rend un refus classé plutôt qu’un succès silencieux', async () => {
		const { client } = clientInsertion({ error: { message: 'refusé', code: '42501' }, status: 403 })
		const resultat = await publierCommentaire(client, {
			idCard: 'card-1',
			idWorkspace: 'ws-1',
			corps: 'x',
		})
		expect(resultat.statut).toBe('refus')
		if (resultat.statut === 'refus') expect(resultat.refus.nature).toBe('forbidden')
	})
})

describe('classification des refus de publication (§13.10)', () => {
	// « Votre commentaire est trop long » et « vous ne pouvez pas commenter » demandent deux gestes
	// différents : les confondre sous « une erreur est survenue » serait une valeur par défaut
	// trompeuse (`CLAUDE.md` §18).
	it('distingue le `CHECK` du corps de tout autre refus, MÊME quand le statut est le même', () => {
		expect(classerRefusPublication(400, '23514', '').nature).toBe('invalide')
		expect(classerRefusPublication(400, '23503', '').nature).toBe('unknown')
	})

	it('classe `401` et `403` en refus, et l’absence de statut en panne de réseau', () => {
		expect(classerRefusPublication(401, undefined, '').nature).toBe('forbidden')
		expect(classerRefusPublication(403, undefined, '').nature).toBe('forbidden')
		expect(classerRefusPublication(undefined, undefined, '').nature).toBe('network')
		expect(classerRefusPublication(0, undefined, '').nature).toBe('network')
	})

	it('ne prétend pas savoir pour le reste', () => {
		expect(classerRefusPublication(500, undefined, '').nature).toBe('unknown')
	})

	// Le `23514` prime sur le statut : PostgREST le rend en `400`, mais la règle est portée par le
	// code, non par le statut, et une version future pourrait changer le second sans le premier.
	it('fait primer le code de contrainte sur le statut', () => {
		expect(classerRefusPublication(403, '23514', '').nature).toBe('invalide')
	})
})

describe('le canal de temps réel (§13.9)', () => {
	it('est propre à une card, et son filtre aussi', () => {
		expect(nomCanal('card-1')).toBe('commentaires:card-1')
		expect(nomCanal('card-1')).not.toBe(nomCanal('card-2'))
		// Sans ce filtre, tout abonné recevrait les événements de TOUTES les cards qu'il peut lire,
		// et rechargerait un fil qui n'a pas changé.
		expect(filtreCanal('card-1')).toBe('card_id=eq.card-1')
	})
})

describe('la borne du corps', () => {
	// Elle sert au compteur de l'écran et à rien d'autre : la règle est tenue par le `CHECK` de la
	// base, et le `23514` reste traité (`CLAUDE.md` §10).
	it('est celle de la contrainte de la base', () => {
		expect(LONGUEUR_MAX_CORPS).toBe(10_000)
	})
})

// =================================================================================================
// Les deux gestes de l'auteur — docs/SPEC-cards.md §13.4, §13.5 et §13.8 (lignes i, j, k, l)
// =================================================================================================

/** Client factice réduit à `update(...).eq(...).select(...)`, la forme exacte employée. */
function clientMiseAJour(reponse: {
	data: readonly { id: string }[] | null
	error: { message: string; code?: string } | null
	status: number
}): { client: ClientCrm; appel: { charge?: Record<string, unknown>; cible?: string } } {
	const appel: { charge?: Record<string, unknown>; cible?: string } = {}
	const client = {
		from: () => ({
			update: (charge: Record<string, unknown>) => {
				appel.charge = charge
				const chaine = {
					eq: (_colonne: string, valeur: string) => {
						appel.cible = valeur
						return chaine
					},
					select: () => Promise.resolve(reponse),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, appel }
}

describe('la correction d’un commentaire (§13.5, ligne i)', () => {
	it('n’envoie QUE le corps : `edited_at` est fermée et posée par le trigger', async () => {
		const { client, appel } = clientMiseAJour({ data: [{ id: 'c1' }], error: null, status: 200 })
		const resultat = await modifierCommentaire(client, 'c1', 'Corrigé.')

		expect(resultat).toEqual({ statut: 'applique' })
		expect(appel.charge).toEqual({ body: 'Corrigé.' })
		expect(appel.cible).toBe('c1')
	})

	// Ligne *j* : le `USING` de la politique FILTRE. 200 et zéro ligne n'est ni un succès ni une
	// erreur — c'est le refus silencieux, et il doit être nommé pour ne pas afficher un effet
	// qui n'a pas eu lieu.
	it('distingue le refus silencieux du `USING` d’une modification réelle', async () => {
		const { client } = clientMiseAJour({ data: [], error: null, status: 200 })
		expect(await modifierCommentaire(client, 'c1', 'x')).toEqual({ statut: 'sans-effet' })
	})

	it('classe un refus HTTP plutôt que de le taire', async () => {
		const { client } = clientMiseAJour({
			data: null,
			error: { message: 'permission denied', code: '42501' },
			status: 403,
		})
		const resultat = await modifierCommentaire(client, 'c1', 'x')
		expect(resultat.statut).toBe('refus')
		if (resultat.statut === 'refus') expect(resultat.refus.nature).toBe('forbidden')
	})
})

describe('la pierre tombale (§13.4, ligne k)', () => {
	// Les DEUX colonnes ensemble : le `CHECK` exige qu'une ligne supprimée porte un corps vide.
	// Envoyer `deleted_at` seul violerait la contrainte au lieu de supprimer.
	it('vide le corps ET pose `deleted_at`, parce que le `CHECK` l’exige', async () => {
		const { client, appel } = clientMiseAJour({ data: [{ id: 'c1' }], error: null, status: 200 })
		const resultat = await supprimerCommentaire(client, 'c1')

		expect(resultat).toEqual({ statut: 'applique' })
		expect(appel.charge?.['body']).toBe('')
		expect(appel.charge?.['deleted_at']).toEqual(expect.any(String))
	})

	it('rend le refus `comment_deleted` sous sa propre nature', async () => {
		const { client } = clientMiseAJour({
			data: null,
			error: { message: 'comment_deleted', code: 'P0001' },
			status: 400,
		})
		const resultat = await supprimerCommentaire(client, 'c1')
		expect(resultat.statut).toBe('refus')
		if (resultat.statut === 'refus') expect(resultat.refus.nature).toBe('supprime')
	})
})

describe('classification des refus de geste', () => {
	// `P0001` est la seule nature que la publication ne connaît pas : la pierre tombale n'existe
	// que pour une ligne déjà écrite. Le reste est délégué, sans le réécrire.
	it('ajoute `supprime` et délègue le reste à la classification de publication', () => {
		expect(classerRefusGeste(400, 'P0001', 'comment_deleted').nature).toBe('supprime')
		expect(classerRefusGeste(400, '23514', 'check').nature).toBe('invalide')
		expect(classerRefusGeste(403, '42501', 'denied').nature).toBe('forbidden')
		expect(classerRefusGeste(undefined, undefined, 'coupure').nature).toBe('network')
		expect(classerRefusGeste(500, undefined, 'boum').nature).toBe('unknown')
	})
})
