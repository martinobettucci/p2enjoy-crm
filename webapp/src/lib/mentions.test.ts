// @verifies CRM-064 (docs/BACKLOG.md) — sous-tranche 3b : l'émission
// @verifies docs/SPEC-notifications.md §34.2 (la RPC réellement appelée, et son refus à zéro
//           ligne), §35.1 (la mesure qui interdit le POST groupé), §35.2 (un POST par mention,
//           séquentiel et dans l'ordre de la liste), §35.4 (les trois issues et la traduction des
//           causes), §40 (preuves unitaires attendues)
// @verifies docs/SPEC-notifications.md §5.1 (l'éligibilité), §6 (les trois refus du trigger),
//           §7.1 (la politique d'insertion juge l'AUTEUR)
//
// Ces tests portent sur la LOGIQUE, sans navigateur : c'est ce que la séparation du module rend
// possible. Le rendu est éprouvé par `webapp/src/app/PanneauTimeline.test.tsx`, et la pile réelle
// par `e2e/api/mentions-composeur.spec.ts`.

import { describe, expect, it } from 'vitest'
import {
	SYMBOLE_COMMENTAIRE_INTROUVABLE,
	SYMBOLE_COMMENTAIRE_SUPPRIME,
	SYMBOLE_DESTINATAIRE_SANS_ACCES,
	classerRefusMention,
	lireMentionnables,
	poserMentions,
	resumerPublication,
	type IssueMention,
	type PersonneMentionnable,
} from './mentions'
import type { ClientCrm } from './supabase'

const personne = (id: string, nom: string): PersonneMentionnable => ({ id, nom, avatar: null })

/** Un double de `client.rpc`, qui retient l'appel émis. */
function clientRpc(reponse: {
	data?: readonly { profile_id: string; full_name: string; avatar_url: string | null }[] | null
	error: { message: string } | null
	status: number
}) {
	const appel: { nom?: string; arguments?: Record<string, unknown> } = {}
	const client = {
		rpc: (nom: string, args: Record<string, unknown>) => {
			appel.nom = nom
			appel.arguments = args
			return Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { client, appel }
}

describe('la lecture des personnes mentionnables (§34.2)', () => {
	it('appelle la RPC `mentionnables` avec l’identifiant de l’affaire, et RIEN D’AUTRE', async () => {
		const { client, appel } = clientRpc({ data: [], error: null, status: 200 })
		await lireMentionnables(client, 'card-1')

		expect(appel.nom).toBe('mentionnables')
		expect(appel.arguments).toEqual({ card_id: 'card-1' })
	})

	// LE MODULE NE RECOPIE AUCUN PRÉDICAT D'ACCÈS (`CLAUDE.md` §10). Il rend ce que la base donne,
	// dans l'ordre où elle le donne : un second tri ici serait une seconde définition de l'ordre.
	it('rend les personnes DANS L’ORDRE DU SERVEUR, sans les retrier', async () => {
		const { client } = clientRpc({
			data: [
				{ profile_id: 'p2', full_name: 'Zoé Abadie', avatar_url: null },
				{ profile_id: 'p1', full_name: 'Émile Bry', avatar_url: '/avatars/emile.svg' },
			],
			error: null,
			status: 200,
		})
		const etat = await lireMentionnables(client, 'card-1')

		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees.map((p) => p.nom)).toEqual(['Zoé Abadie', 'Émile Bry'])
		expect(etat.donnees[1]?.avatar).toBe('/avatars/emile.svg')
	})

	// MESURÉ (§32, M8) : une affaire fermée à l'appelant — ou inexistante — rend `200 []`. C'est
	// un état VIDE, jamais un état d'erreur, et le confondre ferait afficher une panne là où le
	// produit fonctionne exactement comme prévu.
	it('rend une liste VIDE, et non une erreur, quand l’affaire n’est pas ouverte à l’appelant', async () => {
		const { client } = clientRpc({ data: [], error: null, status: 200 })
		const etat = await lireMentionnables(client, 'card-fermee')

		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees).toEqual([])
	})

	it('classe un refus de privilège en erreur, avec sa nature', async () => {
		const { client } = clientRpc({ data: null, error: { message: 'refusé' }, status: 401 })
		const etat = await lireMentionnables(client, 'card-1')

		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})
})

describe('la classification des refus de mention (§35.4)', () => {
	// LES TROIS SYMBOLES DU TRIGGER SONT DISTINGUÉS, et ce n'est pas un raffinement : « cette
	// personne ne peut pas lire l'affaire » et « ce commentaire a été supprimé » demandent deux
	// gestes différents à l'auteur.
	it('distingue les trois symboles `P0001` du trigger', () => {
		expect(classerRefusMention(400, 'P0001', SYMBOLE_DESTINATAIRE_SANS_ACCES).nature).toBe(
			'destinataire-sans-acces',
		)
		expect(classerRefusMention(400, 'P0001', SYMBOLE_COMMENTAIRE_SUPPRIME).nature).toBe(
			'commentaire-supprime',
		)
		expect(classerRefusMention(400, 'P0001', SYMBOLE_COMMENTAIRE_INTROUVABLE).nature).toBe(
			'commentaire-introuvable',
		)
	})

	// UN `P0001` INCONNU RESTE INCONNU. Le ramener à la cause la plus fréquente serait la valeur
	// par défaut trompeuse que `CLAUDE.md` §18 proscrit — et l'écran dirait à quelqu'un que son
	// commentaire est supprimé alors qu'il est vivant.
	it('ne devine RIEN d’un `P0001` dont le symbole lui est inconnu', () => {
		expect(classerRefusMention(400, 'P0001', 'symbole_futur').nature).toBe('unknown')
	})

	// DEUX JUGES, DEUX REFUS (§32, M3 et M4) : le trigger juge le destinataire et rend `400`, la
	// politique d'insertion juge l'auteur et rend `403`.
	it('classe le refus de la POLITIQUE en `forbidden`, distinct de celui du TRIGGER', () => {
		expect(classerRefusMention(403, '42501', 'row-level security').nature).toBe('forbidden')
		expect(classerRefusMention(401, undefined, '').nature).toBe('forbidden')
	})

	it('classe l’absence de statut en panne de réseau', () => {
		expect(classerRefusMention(undefined, undefined, '').nature).toBe('network')
		expect(classerRefusMention(0, undefined, '').nature).toBe('network')
	})
})

/**
 * Un double d'insertion qui retient CHAQUE charge, dans l'ordre, et répond selon le profil visé.
 *
 * Il ne répond pas « la même chose à tout le monde », et c'est ce qui rend la preuve du résultat
 * partiel possible : c'est exactement la situation mesurée en M6.
 */
function clientInsertions(refusPour: ReadonlySet<string>) {
	const charges: Record<string, unknown>[] = []
	const client = {
		from: (_table: string) => ({
			insert: (charge: Record<string, unknown>) => {
				charges.push(charge)
				return Promise.resolve(
					refusPour.has(String(charge['profile_id']))
						? {
								error: { code: 'P0001', message: SYMBOLE_DESTINATAIRE_SANS_ACCES },
								status: 400,
							}
						: { error: null, status: 201 },
				)
			},
		}),
	} as unknown as ClientCrm
	return { client, charges }
}

describe('la pose des mentions (§35.2)', () => {
	// UNE REQUÊTE PAR PERSONNE, ET C'EST LA MESURE M5 QUI L'IMPOSE : un `POST` groupé est tout ou
	// rien et ne dit pas quelle mention est en cause. Cette assertion FIGE la forme : le jour où
	// quelqu'un « optimiserait » en un seul appel, elle rougirait, et c'est ce pour quoi elle est
	// écrite.
	it('émet UNE insertion PAR PERSONNE, jamais un tableau groupé', async () => {
		const { client, charges } = clientInsertions(new Set())
		await poserMentions(client, 'commentaire-1', 'ws-1', [
			personne('p1', 'Camille'),
			personne('p2', 'Driss'),
		])

		expect(charges).toHaveLength(2)
		for (const charge of charges) expect(Array.isArray(charge)).toBe(false)
		expect(charges[0]).toEqual({
			comment_id: 'commentaire-1',
			profile_id: 'p1',
			workspace_id: 'ws-1',
		})
	})

	// `created_at` N'EST PAS ENVOYÉ : le trigger l'impose, et une valeur transmise ne survit pas.
	// `author_id` n'existe pas sur cette table — la mention désigne le DESTINATAIRE.
	it('n’envoie ni `created_at` ni quoi que ce soit que la base impose', async () => {
		const { client, charges } = clientInsertions(new Set())
		await poserMentions(client, 'commentaire-1', 'ws-1', [personne('p1', 'Camille')])

		expect(charges[0]).not.toHaveProperty('created_at')
		expect(Object.keys(charges[0] ?? {}).sort()).toEqual([
			'comment_id',
			'profile_id',
			'workspace_id',
		])
	})

	it('rend les issues DANS L’ORDRE DE LA LISTE, chacune attribuée à sa personne', async () => {
		const { client } = clientInsertions(new Set(['p2']))
		const issues = await poserMentions(client, 'commentaire-1', 'ws-1', [
			personne('p1', 'Camille'),
			personne('p2', 'Farida'),
			personne('p3', 'Driss'),
		])

		expect(issues.map((issue) => issue.personne.nom)).toEqual(['Camille', 'Farida', 'Driss'])
		expect(issues.map((issue) => issue.statut)).toEqual(['posee', 'refus', 'posee'])
	})

	// LE RÉSULTAT PARTIEL EST ATTRIBUABLE, et c'est tout l'objet de la séquence : le refus nomme
	// quelqu'un. C'est la situation mesurée en M6, rejouée sans pile.
	it('nomme la personne refusée ET sa cause, sans perdre les mentions posées', async () => {
		const { client } = clientInsertions(new Set(['p2']))
		const issues = await poserMentions(client, 'commentaire-1', 'ws-1', [
			personne('p1', 'Camille'),
			personne('p2', 'Farida'),
		])
		const refusee = issues[1]

		expect(refusee?.statut).toBe('refus')
		if (refusee === undefined || refusee.statut !== 'refus') return
		expect(refusee.personne.nom).toBe('Farida')
		expect(refusee.nature).toBe('destinataire-sans-acces')
	})

	it('n’émet AUCUNE requête quand personne n’est choisi', async () => {
		const { client, charges } = clientInsertions(new Set())
		const issues = await poserMentions(client, 'commentaire-1', 'ws-1', [])

		expect(charges).toHaveLength(0)
		expect(issues).toEqual([])
	})
})

describe('le résumé d’une publication (§35.4)', () => {
	const posee = (nom: string): IssueMention => ({ personne: personne(nom, nom), statut: 'posee' })
	const refus = (nom: string): IssueMention => ({
		personne: personne(nom, nom),
		statut: 'refus',
		nature: 'destinataire-sans-acces',
		detail: SYMBOLE_DESTINATAIRE_SANS_ACCES,
	})

	// UNE PUBLICATION SANS MENTION EST UN SUCCÈS COMPLET : il n'y avait rien à poser, et rien n'a
	// échoué. Prétendre le contraire ferait apparaître une alerte sur le geste le plus ordinaire du
	// composeur.
	it('range une publication sans aucune mention en `complet`', () => {
		expect(resumerPublication([])).toEqual({ statut: 'complet' })
	})

	it('range une publication dont toutes les mentions sont posées en `complet`', () => {
		expect(resumerPublication([posee('a'), posee('b')])).toEqual({ statut: 'complet' })
	})

	// LE CAS OÙ TOUTES LES MENTIONS SONT REFUSÉES RESTE `partiel`, et ce n'est pas un abus de nom :
	// ce qui le distingue d'un échec, c'est que LE COMMENTAIRE, LUI, EST PUBLIÉ (§35.3). Le ranger
	// avec les refus laisserait croire que rien n'a eu lieu.
	it('range en `partiel` MÊME quand aucune mention n’a été posée — le commentaire, lui, l’est', () => {
		const bilan = resumerPublication([refus('a'), refus('b')])

		expect(bilan.statut).toBe('partiel')
		if (bilan.statut !== 'partiel') return
		expect(bilan.refusees.map((issue) => issue.personne.nom)).toEqual(['a', 'b'])
	})

	it('ne retient QUE les refusées dans le bilan partiel', () => {
		const bilan = resumerPublication([posee('a'), refus('b'), posee('c')])

		expect(bilan.statut).toBe('partiel')
		if (bilan.statut !== 'partiel') return
		expect(bilan.refusees.map((issue) => issue.personne.nom)).toEqual(['b'])
	})
})
