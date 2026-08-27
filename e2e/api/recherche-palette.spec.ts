// @verifies CRM-065 (docs/BACKLOG.md) — tranche 2, sous-tranche 2a : les résolutions d'adresse
// @verifies docs/SPEC-recherche.md §13.1 (une lecture puis au plus deux résolutions),
//           §13.4 (la destination famille par famille), §13.5 (le message et son paramètre)
// @verifies docs/SPEC-recherche.md §11 M14 (la RPC ne rend AUCUNE adresse), M15 (l'embarquement
//           est ambigu, et la relation doit être NOMMÉE), M16 (un message porte son affaire quand
//           il est classé, et rien sinon), M19 (l'asymétrie du seed, par son COMPTE)
// @verifies docs/SPEC-permissions-rls.md §4.3 (le refus est une absence)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND, ET QU'UN TEST UNITAIRE NE PEUT PAS POSER.
// `webapp/src/lib/recherche.test.ts` vérifie que le module DEMANDE les bonnes colonnes ; il ne peut
// pas vérifier que la pile les RÉSOUT — le double de client rend ce qu'on lui donne. Or la mesure
// M15 est précisément une propriété de PostgREST : `cards` porte deux clés étrangères vers
// `channels`, et l'embarquement nu rend `PGRST201`. Une chaîne `select` fausse passerait tous les
// tests unitaires du dépôt et casserait la palette au premier lancement.
//
// CE FICHIER N'ÉCRIT RIEN. Les résolutions sont des lectures, comme la recherche elle-même : le
// seed sort intact par construction, sans nettoyage à écrire — donc sans nettoyage qui puisse
// échouer. C'est la discipline de `recherche-globale.spec.ts`, reprise sans changement.

import { expect, test } from '@playwright/test'
import {
	COLONNES_ADRESSE_AFFAIRE,
	COLONNES_ADRESSE_COMMENTAIRE,
} from '../../webapp/src/lib/colonnes-recherche'
import { URL_API, enTetesAuthentifies, jetonDe } from './jetons'

const RPC = '/rest/v1/rpc/recherche_globale'

/** Une ligne du résultat, telle que le §6.1 la décrit. */
type Ligne = {
	objet: string
	id: string
	titre: string | null
	sous_titre: string | null
	extrait: string | null
	rang: number
}

/** La forme que la résolution d'une affaire rend (M15). */
type LigneAdresseAffaire = {
	id: string
	channels: { slug: string; tracks: { slug: string } | null } | null
}

/**
 * Le terme qui porte l'asymétrie du seed sur une seule frappe (M19).
 *
 * Il rend **quatre** lignes à l'administratrice et **trois** à la lectrice, l'affaire manquante
 * étant celle du track `Grands comptes`, fermé à cette dernière. C'est le terme que la preuve
 * d'interface de 2b emploiera, et il est mesuré ici d'abord.
 */
const TERME_ASYMETRIQUE = 'sogexia'

/** Identifiants du seed, stables par contrat (`docs/SPEC-seed.md`). */
const CARD_VITRINE = '5eed0000-0000-4000-8000-0000000000c1'
const COMMENTAIRE_GABARIT = '5eed0000-0000-4000-8000-0000000000d1'

const chercher = async (
	request: import('@playwright/test').APIRequestContext,
	jeton: string,
	terme: string,
	limite = 20,
) =>
	request.post(`${URL_API}${RPC}`, {
		headers: enTetesAuthentifies(jeton),
		data: { p_terme: terme, p_limite: limite },
	})

test.describe('CRM-065 sous-tranche 2a — les résolutions d’adresse, hors interface', () => {
	let jetonAdmin = ''
	let jetonViewer = ''

	test.beforeAll(async () => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')
	})

	/**
	 * M14 — LA MESURE QUI COMMANDE TOUTE LA TRANCHE, ÉPROUVÉE PLUTÔT QUE CITÉE.
	 *
	 * Elle est écrite comme une assertion pour qu'une session future qui ajouterait une colonne
	 * d'adresse à la fonction voie **ici** que la tranche 2 s'appuie sur son absence — et qu'elle
	 * décide alors sciemment, plutôt que de découvrir la dépendance après coup.
	 */
	test('M14 — la RPC rend sept colonnes, et AUCUNE n’est une adresse', async ({ request }) => {
		const reponse = await chercher(request, jetonAdmin, 'vitrine')
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Ligne[]
		expect(lignes.length).toBeGreaterThan(0)

		for (const ligne of lignes) {
			expect(Object.keys(ligne).sort()).toEqual([
				'extrait',
				'id',
				'objet',
				'rang',
				'sous_titre',
				'titre',
				'workspace_id',
			])
		}
		// L'`id` d'un commentaire est celui du COMMENTAIRE, jamais de l'affaire commentée.
		const commentaires = await chercher(request, jetonAdmin, 'gabarit')
		const lignesCommentaire = (await commentaires.json()) as Ligne[]
		expect(lignesCommentaire).toHaveLength(1)
		expect(lignesCommentaire[0]?.objet).toBe('commentaire')
		expect(lignesCommentaire[0]?.id).toBe(COMMENTAIRE_GABARIT)
		expect(lignesCommentaire[0]?.id).not.toBe(CARD_VITRINE)
	})

	/**
	 * M15, PREMIÈRE MOITIÉ — L'EMBARQUEMENT NU EST REFUSÉ, ET C'EST LA CONTRE-ÉPREUVE.
	 *
	 * Sans elle, la chaîne nommée passerait pour une précaution de style : on ne saurait pas
	 * qu'elle est **nécessaire**. C'est le mécanisme de la contre-épreuve du vocabulaire au §9 de
	 * la tranche 1 — prouver qu'une décision mordait, en montrant ce qui arrive sans elle.
	 */
	test('M15 — l’embarquement NU de `channels` est refusé par PGRST201', async ({ request }) => {
		const reponse = await request.get(`${URL_API}/rest/v1/cards`, {
			headers: enTetesAuthentifies(jetonAdmin),
			params: { id: `in.(${CARD_VITRINE})`, select: 'id, channels(slug, tracks(slug))' },
		})
		expect(reponse.ok()).toBe(false)
		const corps = await reponse.json()
		expect(corps.code).toBe('PGRST201')
	})

	/**
	 * M15, SECONDE MOITIÉ — LA CHAÎNE QUE LE MODULE EMPLOIE RÉELLEMENT RÉSOUT L'ADRESSE.
	 *
	 * La chaîne n'est pas recopiée ici : elle est **importée** du module que la webapp emploie
	 * (`colonnes-recherche.ts`). Une chaîne recopiée éprouverait la copie, jamais le produit — et
	 * c'est tout l'objet de ce module sans importation (décision 177).
	 */
	test('M15 — la relation NOMMÉE rend les deux slugs, en UNE seule requête', async ({
		request,
	}) => {
		const reponse = await request.get(`${URL_API}/rest/v1/cards`, {
			headers: enTetesAuthentifies(jetonAdmin),
			params: { id: `in.(${CARD_VITRINE})`, select: COLONNES_ADRESSE_AFFAIRE },
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneAdresseAffaire[]
		expect(lignes).toHaveLength(1)
		// LES DEUX SLUGS SONT EXIGÉS PAR L'ADRESSE, et aucun ne se déduit de l'autre.
		expect(lignes[0]?.channels?.slug).toBe('grands-comptes')
		expect(lignes[0]?.channels?.tracks?.slug).toBe('conseil-ia')
	})

	test('M15 — la résolution d’un COMMENTAIRE rend l’adresse de son affaire', async ({
		request,
	}) => {
		const reponse = await request.get(`${URL_API}/rest/v1/card_comments`, {
			headers: enTetesAuthentifies(jetonAdmin),
			params: { id: `in.(${COMMENTAIRE_GABARIT})`, select: COLONNES_ADRESSE_COMMENTAIRE },
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as {
			id: string
			card_id: string | null
			cards: LigneAdresseAffaire | null
		}[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.card_id).toBe(CARD_VITRINE)
		expect(lignes[0]?.cards?.channels?.slug).toBe('grands-comptes')
		expect(lignes[0]?.cards?.channels?.tracks?.slug).toBe('conseil-ia')
	})

	/**
	 * LA RÉSOLUTION EST GROUPÉE, ET CE N'EST PAS `N + 1`.
	 *
	 * Une seule requête rapporte l'adresse de **toutes** les affaires d'une page de résultats.
	 * C'est la mesure M8 de `docs/SPEC-notifications.md` §21, retrouvée ici.
	 */
	test('la résolution GROUPÉE rapporte toutes les affaires d’une page en une requête', async ({
		request,
	}) => {
		const recherche = await chercher(request, jetonAdmin, TERME_ASYMETRIQUE)
		const lignes = (await recherche.json()) as Ligne[]
		const ids = lignes.filter((l) => l.objet === 'affaire').map((l) => l.id)
		expect(ids.length).toBeGreaterThan(1)

		const reponse = await request.get(`${URL_API}/rest/v1/cards`, {
			headers: enTetesAuthentifies(jetonAdmin),
			params: { id: `in.(${ids.join(',')})`, select: COLONNES_ADRESSE_AFFAIRE },
		})
		expect(reponse.status()).toBe(200)
		const adresses = (await reponse.json()) as LigneAdresseAffaire[]
		expect(adresses).toHaveLength(ids.length)
		for (const adresse of adresses) {
			expect(adresse.channels?.slug).toBeTruthy()
			expect(adresse.channels?.tracks?.slug).toBeTruthy()
		}
	})

	/**
	 * LA RÉSOLUTION EST SOUS LA MÊME RLS QUE LA RECHERCHE, ET LA CONTRE-ÉPREUVE EST LE COMPTE.
	 *
	 * Sans elle, une résolution qui rendrait **zéro** ligne pour la lectrice serait verte pour la
	 * mauvaise raison : on ne saurait pas si la RLS a filtré ou si la requête est cassée. Les deux
	 * comptes sont donc mesurés ensemble.
	 */
	test('M19 — l’asymétrie du seed se lit sur les DEUX comptes, jamais sur une seule absence', async ({
		request,
	}) => {
		const cotéAdmin = (await (await chercher(request, jetonAdmin, TERME_ASYMETRIQUE)).json()) as Ligne[]
		const cotéViewer = (await (
			await chercher(request, jetonViewer, TERME_ASYMETRIQUE)
		).json()) as Ligne[]

		expect(cotéAdmin).toHaveLength(4)
		expect(cotéViewer).toHaveLength(3)
		// L'affaire manquante est celle du track fermé à la lectrice — nommée, pour qu'un
		// changement du seed fasse échouer la preuve au lieu de la rendre muette.
		const titresAdmin = cotéAdmin.map((l) => l.titre)
		const titresViewer = cotéViewer.map((l) => l.titre)
		expect(titresAdmin).toContain('Migration ERP Sogexia')
		expect(titresViewer).not.toContain('Migration ERP Sogexia')

		// Et la résolution suit : l'affaire fermée n'a pas d'adresse pour la lectrice, ce qui rend
		// la ligne SANS LIEN du §13.4 — jamais une erreur, jamais une ligne masquée.
		const reponse = await request.get(`${URL_API}/rest/v1/cards`, {
			headers: enTetesAuthentifies(jetonViewer),
			params: {
				id: `in.(${cotéAdmin.filter((l) => l.objet === 'affaire').map((l) => l.id).join(',')})`,
				select: COLONNES_ADRESSE_AFFAIRE,
			},
		})
		expect(reponse.status()).toBe(200)
		const adresses = (await reponse.json()) as LigneAdresseAffaire[]
		expect(adresses).toHaveLength(cotéViewer.filter((l) => l.objet === 'affaire').length)
	})

	/**
	 * M16 — LES DEUX CAS DE MESSAGE EXISTENT DANS LE SEED, ET C'EST CE QUI A ÉCARTÉ L'ISSUE 1.
	 *
	 * Mener un résultat `message` à l'affaire du message laisserait la moitié de la famille sans
	 * issue. La preuve le montre plutôt que de le citer.
	 */
	test('M16 — un message classé porte son affaire, un message non classé n’en porte aucune', async ({
		request,
	}) => {
		const classe = (await (await chercher(request, jetonAdmin, 'vitrine')).json()) as Ligne[]
		const nonClasse = (await (await chercher(request, jetonAdmin, 'candidature')).json()) as Ligne[]
		const idClasse = classe.find((l) => l.objet === 'message')?.id
		const idNonClasse = nonClasse.find((l) => l.objet === 'message')?.id
		expect(idClasse).toBeTruthy()
		expect(idNonClasse).toBeTruthy()

		const reponse = await request.get(`${URL_API}/rest/v1/mail_messages`, {
			headers: enTetesAuthentifies(jetonAdmin),
			params: { id: `in.(${idClasse},${idNonClasse})`, select: 'id, card_id' },
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as { id: string; card_id: string | null }[]
		expect(lignes.find((l) => l.id === idClasse)?.card_id).toBe(CARD_VITRINE)
		expect(lignes.find((l) => l.id === idNonClasse)?.card_id).toBeNull()
	})

	/**
	 * LA RÉSOLUTION D'UN CONTACT ET D'UNE ORGANISATION N'EXISTE PAS, ET C'EST UNE PROPRIÉTÉ.
	 *
	 * Leurs adresses ne prennent que l'identifiant que la RPC rend déjà (§13.4) : aucune seconde
	 * lecture n'est due, et la palette n'en émet aucune. La preuve le fige pour qu'un
	 * élargissement futur des routes le voie.
	 */
	test('un CONTACT et une ORGANISATION n’exigent aucune résolution', async ({ request }) => {
		const lignes = (await (
			await chercher(request, jetonAdmin, TERME_ASYMETRIQUE)
		).json()) as Ligne[]
		const organisation = lignes.find((l) => l.objet === 'organisation')
		expect(organisation).toBeTruthy()
		// L'identifiant rendu par la RPC est CELUI de l'organisation : il suffit à composer
		// `/contacts/organisations/:id`, et aucune autre donnée n'entre dans cette adresse.
		const reponse = await request.get(`${URL_API}/rest/v1/organizations`, {
			headers: enTetesAuthentifies(jetonAdmin),
			params: { id: `eq.${organisation?.id}`, select: 'id, name' },
		})
		expect(reponse.status()).toBe(200)
		const trouvees = (await reponse.json()) as { id: string; name: string }[]
		expect(trouvees).toHaveLength(1)
		expect(trouvees[0]?.name).toBe(organisation?.titre)
	})
})
