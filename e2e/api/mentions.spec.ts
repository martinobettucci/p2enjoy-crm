// @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences, TRANCHE 1
// @verifies docs/SPEC-notifications.md §8 (les quinze lignes du contrat d'API), §8.1 (les deux
//           lignes que la mesure a corrigées), §5.1 (la règle d'éligibilité), §6 (les trois refus
//           du trigger), §7.1 (les trois politiques et l'absence de la quatrième), §7.2
//           (privilèges), §7.4 (le retrait de `card_comments.mentions`), §9 (ce que le seed livre)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur ;
//           preuves de refus n° 4 et n° 11)
// @verifies docs/SPEC-cards.md §13.6 (INC-071 : commenter, et compléter, est un droit d'ÉCRITURE)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0061_mentions_commentaires.test.sql`
// prouve la règle **en base**, sous le propriétaire. Rien n'y garantit que la pile la rende par la
// vraie route : c'est même l'inverse qui a été MESURÉ le 2026-08-26 — le privilège d'exécution de
// `app.can_read_card_pour` manquant à `authenticated`, quatre lignes du contrat rendaient
// `403 / 42501` là où trois attendaient un refus MÉTIER et une un succès, **et la suite pgTAP
// serait restée verte** : elle s'exécute sous le propriétaire, qui n'a besoin d'aucun privilège.
// C'est la même famille de défaut que la migration 53 de `CRM-062` a payée.
//
// CE FICHIER ÉCRIT, ET IL REND LE PRODUIT DANS L'ÉTAT OÙ IL LE TROUVE. Chaque ligne posée est
// retirée, et une dernière lecture le CONSTATE — décision 501 : une preuve qui laisse ses sondes
// en base fait rougir la suivante.

import { expect, test } from '@playwright/test'
import { CLE_SERVICE, URL_API, enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const MENTIONS = '/rest/v1/card_comment_mentions'
const COMMENTAIRES = '/rest/v1/card_comments'

/** Les trois profils du seed — `docs/SPEC-seed.md` §2.3. */
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

/**
 * Les commentaires du seed, et ce que chacun apporte au contrat.
 *
 * `…0d1` et `…0d2` vivent sur la card `…0c1`, dans `grands-comptes` — channel **fermé** à Farida
 * (`docs/SPEC-notifications.md` §2, mesures M5 et M6). `…0d5` vit sur `…0c5`, dans `maintenance`,
 * où Farida est `read` et Camille `write`. `…0d4` est la pierre tombale.
 */
const D1_DE_CAMILLE = '5eed0000-0000-4000-8000-0000000000d1'
const D4_TOMBALE = '5eed0000-0000-4000-8000-0000000000d4'
const D5_DE_FARIDA = '5eed0000-0000-4000-8000-0000000000d5'

const CARD_FERMEE = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_OUVERTE = '5eed0000-0000-4000-8000-0000000000c5'

/** Un identifiant bien formé qui ne désigne aucun profil — mesure M8. */
const PERSONNE = '00000000-0000-4000-8000-00000000dead'
/** Un identifiant bien formé qui ne désigne aucun commentaire. */
const NEANT = '00000000-0000-4000-8000-00000000beef'

/**
 * Relit une mention **avec la clé de service**, donc hors de toute politique.
 *
 * C'est ce qui distingue un refus d'un échec silencieux : un refus qui laisse une trace n'est pas
 * un refus (`docs/SPEC-notifications.md` §8).
 */
async function mentionEnBase(
	requete: import('@playwright/test').APIRequestContext,
	commentaire: string,
	profil: string,
): Promise<unknown[]> {
	const reponse = await requete.get(
		`${URL_API}${MENTIONS}?comment_id=eq.${commentaire}&profile_id=eq.${profil}`,
		{ headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` } },
	)
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as unknown[]
}

test.describe('CRM-064 tranche 1 — le contrat d’API de la mention', () => {
	let camille: string
	let driss: string
	let farida: string

	test.beforeAll(async () => {
		camille = await jetonDe('admin@p2enjoy.test')
		driss = await jetonDe('bizdev@p2enjoy.test')
		farida = await jetonDe('viewer@p2enjoy.test')
	})

	test('a et m — l’auteur pose une mention éligible, et la retire', async ({ request }) => {
		// `…0d5` × Camille : un couple que le seed ne pose PAS (§9), et éligible — Camille est
		// `write` sur `maintenance`. Le poser sur un couple seedé ferait rougir sur le doublon.
		//
		// L'AUTEUR DE `…0d5` EST FARIDA, ET C'EST ELLE QUI DOIT POSER. Elle est `read` sur
		// `maintenance` : la politique la refusera, et c'est la ligne h. Le cas NOMINAL de cette
		// ligne emploie donc `…0d1`, dont Camille est l'auteure, avec un destinataire non seedé.
		const pose = await request.post(`${URL_API}${MENTIONS}`, {
			headers: { ...enTetesAuthentifies(camille), Prefer: 'return=representation' },
			data: { comment_id: D1_DE_CAMILLE, profile_id: CAMILLE },
		})
		expect(pose.status(), 'a — l’auteure mentionne un profil éligible').toBe(201)

		const posee = (await pose.json()) as Array<Record<string, unknown>>
		expect(posee).toHaveLength(1)
		// `workspace_id` est DÉRIVÉ par le trigger, jamais envoyé (§6).
		expect(posee[0].workspace_id).toBe('5eed0000-0000-4000-8000-000000000001')
		expect(posee[0].created_at, '`created_at` est posé par le trigger').toBeTruthy()

		const retrait = await request.delete(
			`${URL_API}${MENTIONS}?comment_id=eq.${D1_DE_CAMILLE}&profile_id=eq.${CAMILLE}`,
			{ headers: enTetesAuthentifies(camille) },
		)
		expect(retrait.status(), 'm — l’auteure retire sa propre mention').toBe(204)
		expect(await mentionEnBase(request, D1_DE_CAMILLE, CAMILLE)).toHaveLength(0)
	})

	test('b — la clé primaire refuse le doublon', async ({ request }) => {
		// Le seed a déjà posé Driss sur `…0d1` (§9). Le reposer doit rendre `409`.
		const doublon = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(camille),
			data: { comment_id: D1_DE_CAMILLE, profile_id: DRISS },
		})
		expect(doublon.status()).toBe(409)
		expect((await doublon.json()).code).toBe('23505')

		// La ligne du seed est INTACTE : un refus n'efface rien.
		expect(await mentionEnBase(request, D1_DE_CAMILLE, DRISS)).toHaveLength(1)
	})

	test('c — un destinataire sans accès à l’affaire est refusé', async ({ request }) => {
		// LE CAS DE REFUS DE LA TRANCHE, et il est DÉJÀ dans le seed : Farida est `none` sur
		// `grands-comptes`, où vit `…0c1` (§2, mesures M5 et M6).
		const refus = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(camille),
			data: { comment_id: D1_DE_CAMILLE, profile_id: FARIDA },
		})
		expect(refus.status()).toBe(400)
		const corps = await refus.json()
		expect(corps.code).toBe('P0001')
		expect(corps.message).toBe('mention_destinataire_sans_acces')

		// LE REFUS NE DIT PAS QUI (§6) : ni le nom, ni l'identifiant du destinataire.
		const texte = JSON.stringify(corps)
		expect(texte).not.toContain(FARIDA)
		expect(texte).not.toContain('Farida')

		expect(await mentionEnBase(request, D1_DE_CAMILLE, FARIDA)).toHaveLength(0)
	})

	test('d — un identifiant qui ne désigne aucun profil est refusé, SANS le dire', async ({
		request,
	}) => {
		// LIGNE RÉVISÉE PAR LA MESURE (§8.1). Elle attendait `409 / 23503`, la clé étrangère. Le
		// trigger est `BEFORE INSERT` : il refuse AVANT, et `app.can_read_card_pour` rend `false`
		// pour un identifiant qui ne désigne personne comme pour un profil sans accès.
		//
		// LE COMPORTEMENT OBTENU EST MEILLEUR QUE CELUI QUI ÉTAIT PRÉVU, et c'est ce qui décide de
		// ne rien changer : le refus ne dit pas si le profil existe. Un `23503` l'aurait dit.
		// La clé étrangère reste la SECONDE barrière, éprouvée trigger désactivé par la suite pgTAP.
		const refus = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(camille),
			data: { comment_id: D1_DE_CAMILLE, profile_id: PERSONNE },
		})
		expect(refus.status()).toBe(400)
		const corps = await refus.json()
		expect(corps.message).toBe('mention_destinataire_sans_acces')
		// Le refus est LE MÊME qu'à la ligne c : rien ne distingue « n'existe pas » de « n'a pas
		// accès », et c'est la propriété recherchée.
		expect(corps.code).toBe('P0001')
	})

	test('e — un commentaire inconnu rend `comment_not_found`', async ({ request }) => {
		const refus = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(camille),
			data: { comment_id: NEANT, profile_id: DRISS },
		})
		expect(refus.status()).toBe(400)
		expect((await refus.json()).message).toBe('comment_not_found')
	})

	test('f — une pierre tombale ne mentionne plus personne', async ({ request }) => {
		const refus = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(camille),
			data: { comment_id: D4_TOMBALE, profile_id: DRISS },
		})
		expect(refus.status()).toBe(400)
		// LE VOCABLE EST CELUI QUE `app.card_comments_avant_maj` REND DÉJÀ : un second vocable pour
		// le même fait ferait diverger deux dictionnaires de refus (§6).
		expect((await refus.json()).message).toBe('comment_deleted')
	})

	test('g — un tiers en écriture ne complète pas le propos d’autrui', async ({ request }) => {
		// Driss est `write` sur `grands-comptes` : `app.can_write_card` lui dit oui. C'est la
		// SECONDE condition de la politique qui le refuse — il n'est pas l'auteur de `…0d1`.
		// Compléter le propos d'un tiers reviendrait à le lui faire dire (§7.1).
		const refus = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(driss),
			data: { comment_id: D1_DE_CAMILLE, profile_id: CAMILLE },
		})
		expect(refus.status()).toBe(403)
		expect((await refus.json()).code).toBe('42501')
		expect(await mentionEnBase(request, D1_DE_CAMILLE, CAMILLE)).toHaveLength(0)
	})

	test('h — l’auteure d’un commentaire retombée à `read` ne le complète plus', async ({
		request,
	}) => {
		// INC-071, appliquée à la mention. Farida EST l'auteure de `…0d5`, mais elle n'est que
		// `read` sur `maintenance` : son commentaire y a été posé par la clé de service, et le
		// droit qui compte est le droit COURANT.
		const refus = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(farida),
			data: { comment_id: D5_DE_FARIDA, profile_id: CAMILLE },
		})
		expect(refus.status()).toBe(403)
		expect((await refus.json()).code).toBe('42501')
		expect(await mentionEnBase(request, D5_DE_FARIDA, CAMILLE)).toHaveLength(0)
	})

	test('h bis — sur un commentaire qu’elle ne peut PAS lire, le refus est indistinguable de l’absence', async ({
		request,
	}) => {
		// LA DISCRÉTION DU §6, MESURÉE. Le trigger est `SECURITY INVOKER` : il ne voit pas ce que
		// la RLS cache à Farida. Un commentaire fermé et un commentaire inexistant rendent donc le
		// MÊME refus — comparer avec la ligne e, qui emploie un identifiant inventé.
		const refus = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(farida),
			data: { comment_id: D1_DE_CAMILLE, profile_id: CAMILLE },
		})
		expect(refus.status()).toBe(400)
		expect((await refus.json()).message).toBe('comment_not_found')
	})

	test('i, j et k — la lecture applique les droits fins, et le refus est ZÉRO LIGNE', async ({
		request,
	}) => {
		// i — Farida ne lit AUCUNE mention de `…0c1` : le refus est une liste vide, jamais une
		// erreur (`docs/SPEC-permissions-rls.md` §7).
		const fermee = await request.get(
			`${URL_API}${MENTIONS}?comment_id=eq.${D1_DE_CAMILLE}`,
			{ headers: enTetesAuthentifies(farida) },
		)
		expect(fermee.status()).toBe(200)
		expect(await fermee.json()).toEqual([])

		// j — Driss, lui, les lit. LE REFUS SE MESURE DONC COMME UNE LIGNE ABSENTE D'UNE LISTE
		// PEUPLÉE, forme bien plus stricte qu'un écran vide, qu'une politique cassée rendrait tout
		// aussi vert.
		const ouverte = await request.get(
			`${URL_API}${MENTIONS}?comment_id=eq.${D1_DE_CAMILLE}`,
			{ headers: enTetesAuthentifies(driss) },
		)
		expect(ouverte.status()).toBe(200)
		const lues = (await ouverte.json()) as Array<Record<string, unknown>>
		expect(lues).toHaveLength(1)
		expect(lues[0].profile_id).toBe(DRISS)

		// k — l'anonyme obtient `200 []`, jamais `401`. Le privilège existe précisément pour cela :
		// `auth.uid()` étant nul, le prédicat de la politique est faux.
		const anonyme = await request.get(`${URL_API}${MENTIONS}`, { headers: enTetesAnonymes() })
		expect(anonyme.status()).toBe(200)
		expect(await anonyme.json()).toEqual([])
	})

	test('l — aucune mise à jour, à personne : le refus est DOUBLE', async ({ request }) => {
		// Le privilège refuse le premier ; la politique absente tiendrait la seconde barrière. La
		// suite pgTAP fige les deux séparément — sans cela, on ne saurait pas lequel des deux
		// refuse (§7.1).
		const refus = await request.patch(
			`${URL_API}${MENTIONS}?comment_id=eq.${D1_DE_CAMILLE}&profile_id=eq.${DRISS}`,
			{ headers: enTetesAuthentifies(camille), data: { profile_id: CAMILLE } },
		)
		expect(refus.status()).toBe(403)
		expect((await refus.json()).code).toBe('42501')

		// La ligne du seed est INTACTE : le destinataire n'a pas été substitué.
		expect(await mentionEnBase(request, D1_DE_CAMILLE, DRISS)).toHaveLength(1)
	})

	test('n — un tiers qui retire une mention ne touche AUCUNE ligne', async ({ request }) => {
		// `204` SANS EFFET, et c'est la forme du refus d'une politique `DELETE` : le `USING`
		// filtre, et le `DELETE` ne trouve rien. Un `204` seul ne prouverait donc RIEN — la
		// relecture en base est la preuve.
		const tentative = await request.delete(
			`${URL_API}${MENTIONS}?comment_id=eq.${D1_DE_CAMILLE}&profile_id=eq.${DRISS}`,
			{ headers: enTetesAuthentifies(driss) },
		)
		expect(tentative.status()).toBe(204)
		expect(
			await mentionEnBase(request, D1_DE_CAMILLE, DRISS),
			'la mention du seed survit au DELETE d’un tiers',
		).toHaveLength(1)
	})

	test('o — `card_comments.mentions` n’existe plus', async ({ request }) => {
		// LA CONTRE-ÉPREUVE DU §7.4. Sans elle, le retrait de la colonne ne serait prouvé que par
		// l'absence d'erreur ailleurs.
		const refus = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: enTetesAuthentifies(camille),
			data: { card_id: CARD_OUVERTE, body: 'sonde o — CRM-064', mentions: [DRISS] },
		})
		expect(refus.status()).toBe(400)
		expect((await refus.json()).code).toBe('PGRST204')
	})

	test('le seed est rendu intact — deux mentions, aucune pour la lectrice', async ({
		request,
	}) => {
		// DÉCISION 501 : une preuve qui laisse ses sondes en base fait rougir la suivante. Ce
		// fichier a posé et retiré ; la dernière lecture le CONSTATE plutôt que de le supposer.
		const toutes = await request.get(`${URL_API}${MENTIONS}?select=comment_id,profile_id`, {
			headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` },
		})
		expect(toutes.status()).toBe(200)
		const lignes = (await toutes.json()) as Array<Record<string, string>>
		expect(lignes, 'le seed pose DEUX mentions, et ce fichier n’en laisse aucune').toHaveLength(2)

		// LA LECTRICE N'EN PORTE AUCUNE, et c'est le seed qui démontre la règle par ce qu'il ne
		// parvient PAS à écrire (§9).
		expect(lignes.filter((l) => l.profile_id === FARIDA)).toHaveLength(0)

		// Et aucun commentaire n'a été ajouté par la ligne o.
		const commentaires = await request.get(
			`${URL_API}${COMMENTAIRES}?card_id=eq.${CARD_OUVERTE}&select=id`,
			{ headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` } },
		)
		expect(commentaires.status()).toBe(200)
		expect((await commentaires.json()) as unknown[]).toHaveLength(1)
	})

	test('la règle d’éligibilité est celle de la LECTURE, mesurée sur les deux cards', async ({
		request,
	}) => {
		// LE CROISEMENT QUI FONDE LA TRANCHE (§2, M5 et M6), vérifié par la vraie route plutôt que
		// recopié : Farida ne lit pas `…0c1` et lit `…0c5`. Si cette mesure cessait d'être vraie,
		// les lignes c et i deviendraient vertes sans rien prouver.
		const fermee = await request.get(`${URL_API}/rest/v1/cards?id=eq.${CARD_FERMEE}&select=id`, {
			headers: enTetesAuthentifies(farida),
		})
		expect(fermee.status()).toBe(200)
		expect(await fermee.json()).toEqual([])

		const ouverte = await request.get(`${URL_API}/rest/v1/cards?id=eq.${CARD_OUVERTE}&select=id`, {
			headers: enTetesAuthentifies(farida),
		})
		expect(ouverte.status()).toBe(200)
		expect((await ouverte.json()) as unknown[]).toHaveLength(1)
	})
})
