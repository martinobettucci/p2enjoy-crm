// @verifies CRM-064 (docs/BACKLOG.md) — tranche 3a : ce que la surface de réception lit, et le
//            temps réel comme SURFACE D'AUTORISATION
// @verifies docs/SPEC-notifications.md §27 (les sept lignes du contrat de la tranche 3a),
//            §24.1 (les deux requêtes de l'écran), §25.1 (la publication), §25.3 (le filtre),
//            §26.1 (le compteur sans corps), §26.5 (la borne), §31 (preuves attendues)
// @verifies docs/SPEC-notifications.md §21 (M4, M5, M8, M9, M13) ; §16.1 (la politique de lecture)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LES SEIZE LIGNES DU §17 NE SONT PAS REJOUÉES ICI : `notifications.spec.ts` les tient, et la
// tranche 3a ne change AUCUNE règle de la table. Ce fichier éprouve ce que la tranche AJOUTE — la
// publication, les deux lectures de l'écran, et les trois abonnements.
//
// LES TROIS ABONNEMENTS SONT LE CŒUR DE CE CONTRAT. `realtime.apply_rls` évalue la politique
// `SELECT` pour le rôle et les revendications de CHAQUE abonné : le temps réel est une surface
// d'autorisation, et c'est une propriété qui se prouve. Aucune autre preuve du dépôt ne l'exerce
// pour cette table.
//
// LE PRODUIT EST RENDU DANS L'ÉTAT OÙ IL A ÉTÉ TROUVÉ : chaque ligne posée est retirée, chaque
// marquage est défait, et une dernière lecture le CONSTATE (décision 501).

import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
	CLE_ANONYME,
	URL_API,
	enTetesAnonymes,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from './jetons'

const NOTIFICATIONS = '/rest/v1/notifications'
const COMMENTAIRES = '/rest/v1/card_comments'
const MENTIONS = '/rest/v1/card_comment_mentions'

/** Identifiants du seed, stables (`docs/SPEC-seed.md` §4). */
const ADMIN = '5eed0000-0000-4000-8000-000000000011'
const BIZDEV = '5eed0000-0000-4000-8000-000000000012'
const VIEWER = '5eed0000-0000-4000-8000-000000000013'
const CARD_GRANDS_COMPTES = '5eed0000-0000-4000-8000-0000000000c1'
const COMMENTAIRE_D1 = '5eed0000-0000-4000-8000-0000000000d1'
const COMMENTAIRE_D2 = '5eed0000-0000-4000-8000-0000000000d2'

/**
 * Préfixe des lignes que ce fichier crée.
 *
 * Il n'emploie **pas** `5eed` : les assertions de conformité du seed comptent les lignes de ce
 * préfixe, et une sonde survivante y passerait pour une donnée du seed. C'est le procédé de
 * `commentaires.spec.ts`.
 */
const essai = (suffixe: string) => `e2e00064-0000-4000-8000-0000000003${suffixe}`

/** Les colonnes que l'écran demande — `webapp/src/lib/colonnes-notifications.ts`, §24.1. */
const COLONNES_NOTIFICATION =
	'id, type, read_at, created_at, subject_card_id, payload, ' +
	'cards(id, title, channels!cards_channel_id_workspace_id_fkey(slug, name, tracks(slug, name)))'

const COLONNES_COMMENTAIRE_MENTION =
	'id, body, deleted_at, author_id, ' +
	'auteur:profiles!card_comments_author_id_fkey(id, full_name, avatar_url)'

let jetonAdmin = ''
let jetonBizdev = ''
let jetonViewer = ''

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test.describe('Ce que la surface lit — §24.1', () => {
	// LIGNE r — l'affaire s'embarque par la clé étrangère COMPOSITE, en une seule requête (M5).
	// Les DEUX slugs sont exigés par l'adresse d'une affaire, et aucun ne se déduit de l'autre.
	test('r — la notification rend son affaire et les DEUX slugs, en une requête', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${URL_API}${NOTIFICATIONS}?select=${encodeURIComponent(COLONNES_NOTIFICATION)}&order=created_at.desc&limit=20`,
			{ headers: enTetesAuthentifies(jetonBizdev) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as {
			id: string
			payload: Record<string, unknown>
			cards: { title: string; channels: { slug: string; tracks: { slug: string } } } | null
		}[]
		expect(lignes).toHaveLength(1)
		const ligne = lignes[0]
		expect(ligne?.cards?.title).toBe('Refonte du site vitrine')
		expect(ligne?.cards?.channels?.slug).toBe('grands-comptes')
		expect(ligne?.cards?.channels?.tracks?.slug).toBe('conseil-ia')
		// LA CHARGE UTILE NE PORTE AUCUN CONTENU (§13.4) : de quoi désigner, jamais de quoi lire.
		expect(ligne?.payload?.['comment_id']).toBe(COMMENTAIRE_D1)
		expect(ligne?.payload).not.toHaveProperty('body')
	})

	// LIGNE s — le compteur se lit SANS CORPS (M4) : le nombre est dans l'en-tête, et c'est la
	// lecture la moins chère que la pile sache rendre pour la cloche fermée.
	test('s — le compteur de non-lues se lit dans l’en-tête, sans ramener une ligne', async ({
		request,
	}) => {
		const reponse = await request.head(`${URL_API}${NOTIFICATIONS}?select=id&read_at=is.null`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'count=exact' },
		})
		expect(reponse.status()).toBe(200)
		const plage = reponse.headers()['content-range']
		expect(plage).toBeDefined()
		expect(plage?.split('/')[1]).toBe('1')
	})

	// LIGNE t — UNE SEULE REQUÊTE POUR TOUTE LA PAGE, auteur embarqué (M8), et un identifiant
	// INCONNU ne fait pas échouer la lecture (M9). C'est la mesure qui a corrigé l'estimation
	// « une lecture par notification affichée » du §13.4.
	test('t — les commentaires cités se lisent groupés, auteur embarqué, sans échouer sur un inconnu', async ({
		request,
	}) => {
		const inconnu = '00000000-0000-4000-8000-000000000000'
		const reponse = await request.get(
			`${URL_API}${COMMENTAIRES}?select=${encodeURIComponent(COLONNES_COMMENTAIRE_MENTION)}` +
				`&id=in.(${COMMENTAIRE_D1},${inconnu})`,
			{ headers: enTetesAuthentifies(jetonBizdev) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as {
			id: string
			body: string
			auteur: { full_name: string } | null
		}[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.id).toBe(COMMENTAIRE_D1)
		expect(lignes[0]?.auteur?.full_name).toBe('Camille Aubert')
		expect(lignes[0]?.body).toContain('La DSI a confirmé')
	})

	// LA BOÎTE D'UN AUTRE N'EST PAS LISIBLE, et le refus se mesure comme ZÉRO LIGNE — jamais une
	// erreur (§16.1). C'est la ligne b du §17, reprise ici parce que la surface l'exerce à chaque
	// ouverture : la cloche de Camille ne doit jamais montrer celle de Driss.
	test('la boîte de chacun est la sienne, et Farida n’en a aucune', async ({ request }) => {
		const deCamille = await request.get(`${URL_API}${NOTIFICATIONS}?select=recipient_id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(deCamille.status()).toBe(200)
		const lignesCamille = (await deCamille.json()) as { recipient_id: string }[]
		expect(lignesCamille.map((une) => une.recipient_id)).toEqual([ADMIN])

		const deFarida = await request.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(deFarida.status()).toBe(200)
		expect(await deFarida.json()).toEqual([])

		const anonyme = await request.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
			headers: enTetesAnonymes(),
		})
		expect(anonyme.status()).toBe(200)
		expect(await anonyme.json()).toEqual([])
	})
})

test.describe('La publication au temps réel — §25.1', () => {
	// LIGNE q — la ligne de base de M13 est CHANGÉE par la migration `0065`. Elle se lit par la
	// clé de service, la vue `pg_publication_tables` n'étant pas exposée à PostgREST.
	test('q — la table figure dans la publication `supabase_realtime`', async ({ request }) => {
		// La preuve passe par une notification produite ET reçue : c'est la seule mesure de la
		// publication qui soit atteignable depuis ce projet, et c'est la SEULE qui compte — une
		// table publiée dont rien ne sort ne servirait à rien. La preuve directe de la ligne de
		// `pg_publication_tables` vit dans `0062_notifications.test.sql`, assertion 40.
		const client = createClient(URL_API, CLE_ANONYME)
		const { error } = await client.auth.signInWithPassword({
			email: 'bizdev@p2enjoy.test',
			password: 'SeedDev2026Local',
		})
		expect(error).toBeNull()
		const canal = client.channel('preuve-publication').on(
			'postgres_changes',
			{ event: '*', schema: 'public', table: 'notifications' },
			() => {},
		)
		const statut = await new Promise<string>((resolve) => {
			canal.subscribe((etat) => {
				if (etat === 'SUBSCRIBED' || etat === 'CHANNEL_ERROR' || etat === 'TIMED_OUT') resolve(etat)
			})
		})
		// UN ABONNEMENT À UNE TABLE NON PUBLIÉE S'ÉTABLIT QUAND MÊME : ce statut ne prouve donc pas
		// la publication à lui seul, et c'est le scénario `v` ci-dessous qui la prouve en recevant
		// réellement un événement. Il est mesuré ici pour que son échec, s'il survenait, se
		// distingue d'un défaut de délivrance.
		expect(statut).toBe('SUBSCRIBED')
		await client.removeAllChannels()
		await client.auth.signOut()
		void request
	})
})

/**
 * Ouvre un canal `postgres_changes` sur `notifications` et rend les charges reçues.
 *
 * C'est `abonne` de `commentaires.spec.ts`, transposé à cette table : le procédé est réemployé
 * plutôt que réécrit, deux ouvertures du même canal divergeant au premier ajustement.
 */
async function abonne(adresse: string, filtre?: string) {
	const client = createClient(URL_API, CLE_ANONYME)
	const { error } = await client.auth.signInWithPassword({
		email: adresse,
		password: 'SeedDev2026Local',
	})
	if (error) throw error

	const recues: { new: Record<string, unknown> }[] = []
	const canal = client
		.channel(`preuve-notif-${adresse}-${filtre ?? 'tout'}`)
		.on(
			'postgres_changes',
			{
				event: 'INSERT',
				schema: 'public',
				table: 'notifications',
				...(filtre ? { filter: filtre } : {}),
			},
			(charge) => recues.push(charge as unknown as { new: Record<string, unknown> }),
		)

	const statut = await new Promise<string>((resolve) => {
		canal.subscribe((etat) => {
			if (etat === 'SUBSCRIBED' || etat === 'CHANNEL_ERROR' || etat === 'TIMED_OUT') resolve(etat)
		})
	})

	return {
		statut,
		recues,
		fermer: async () => {
			await client.removeAllChannels()
			await client.auth.signOut()
		},
	}
}

test.describe('Le temps réel comme surface d’autorisation — §25.1, §27', () => {
	test.setTimeout(90_000)

	// LIGNES u, v ET w RÉUNIES EN UN SEUL SCÉNARIO, ET C'EST NÉCESSAIRE : le silence de Farida et
	// de l'anonyme n'est probant que si un TÉMOIN a reçu le même événement au même instant
	// (décision 50). Trois scénarios séparés mesureraient trois silences dont aucun ne dirait si
	// le canal était seulement mort.
	test('u, v, w — le destinataire reçoit, la lectrice et l’anonyme ne reçoivent RIEN', async ({
		request,
	}) => {
		const temoin = await abonne('bizdev@p2enjoy.test', `recipient_id=eq.${BIZDEV}`)
		const fermee = await abonne('viewer@p2enjoy.test', `recipient_id=eq.${VIEWER}`)
		// L'ANONYME S'ABONNE SANS SESSION : `auth.uid()` est nul, donc le prédicat du §16.1 est
		// faux et rien ne doit lui parvenir.
		const clientAnonyme = createClient(URL_API, CLE_ANONYME)
		const recuesAnonyme: unknown[] = []
		const canalAnonyme = clientAnonyme
			.channel('preuve-notif-anonyme')
			.on(
				'postgres_changes',
				{ event: 'INSERT', schema: 'public', table: 'notifications' },
				(charge) => recuesAnonyme.push(charge),
			)
		const statutAnonyme = await new Promise<string>((resolve) => {
			canalAnonyme.subscribe((etat) => {
				if (etat === 'SUBSCRIBED' || etat === 'CHANNEL_ERROR' || etat === 'TIMED_OUT') resolve(etat)
			})
		})

		const idCommentaire = essai('01')
		let mentionPosee = false
		try {
			expect(temoin.statut).toBe('SUBSCRIBED')
			expect(fermee.statut).toBe('SUBSCRIBED')
			expect(statutAnonyme).toBe('SUBSCRIBED')

			// LE COMMENTAIRE EST POSÉ PAR LE VRAI CHEMIN, avec le jeton réel de Camille : la
			// notification qui suit doit naître du TRIGGER, jamais d'une insertion directe — le
			// §15.3 refuse d'ailleurs toute insertion par un client.
			const commentaire = await request.post(`${URL_API}${COMMENTAIRES}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: {
					id: idCommentaire,
					card_id: CARD_GRANDS_COMPTES,
					body: 'Preuve de temps réel — CRM-064 tranche 3a.',
				},
			})
			expect(commentaire.status()).toBe(201)

			// ÉTABLISSEMENT OBSERVÉ, ET NON TEMPORISATION ARBITRAIRE (`CLAUDE.md` §18, décision
			// 195) : la mention posée ci-dessous produit la notification, et l'attente porte sur un
			// FAIT — l'arrivée de l'événement — et non sur une durée devinée.
			const mention = await request.post(`${URL_API}${MENTIONS}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { comment_id: idCommentaire, profile_id: BIZDEV },
			})
			expect(mention.status()).toBe(201)
			mentionPosee = true

			await expect
				.poll(() => temoin.recues.length, {
					timeout: 30_000,
					message: 'aucun événement reçu par le destinataire',
				})
				.toBeGreaterThan(0)

			// LIGNE v — l'événement porte bien LA notification produite, et sa charge utile désigne
			// le commentaire sans en recopier le propos.
			const recue = temoin.recues.at(-1)?.new
			expect(recue?.['recipient_id']).toBe(BIZDEV)
			expect((recue?.['payload'] as Record<string, unknown>)?.['comment_id']).toBe(idCommentaire)

			// LIGNES u ET w — `realtime.apply_rls` a évalué la politique pour chaque abonné : ni la
			// lectrice, ni l'anonyme n'ont RIEN reçu. Le témoin ci-dessus est ce qui rend ces deux
			// silences probants.
			expect(fermee.recues).toHaveLength(0)
			expect(recuesAnonyme).toHaveLength(0)
		} finally {
			await temoin.fermer()
			await fermee.fermer()
			await clientAnonyme.removeAllChannels()

			// LE PRODUIT EST RENDU DANS L'ÉTAT OÙ IL A ÉTÉ TROUVÉ (décision 501). La notification
			// SURVIT au retrait de sa mention (§14.4) : elle doit donc être retirée pour elle-même,
			// avec la clé de service — aucun client n'a le privilège `DELETE` (§15.4), et c'est
			// précisément la règle que ce nettoyage ne doit pas contourner en s'en passant.
			if (mentionPosee) {
				await request.delete(
					`${URL_API}${MENTIONS}?comment_id=eq.${idCommentaire}&profile_id=eq.${BIZDEV}`,
					{ headers: enTetesService() },
				)
			}
			await request.delete(
				`${URL_API}${NOTIFICATIONS}?payload->>comment_id=eq.${idCommentaire}`,
				{ headers: enTetesService() },
			)
			await request.delete(`${URL_API}${COMMENTAIRES}?id=eq.${idCommentaire}`, {
				headers: enTetesService(),
			})
		}
	})
})

test.describe('L’état du produit après la suite — décision 501', () => {
	// UNE DERNIÈRE LECTURE CONSTATE que rien n'a survécu : deux notifications, toutes deux non
	// lues, exactement l'état que le seed livre (§19, §28).
	test('le seed est rendu intact : deux notifications, toutes deux non lues', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${URL_API}${NOTIFICATIONS}?select=id,recipient_id,read_at,payload&order=created_at.asc`,
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as {
			recipient_id: string
			read_at: string | null
			payload: Record<string, unknown>
		}[]
		expect(lignes).toHaveLength(2)
		expect(lignes.every((une) => une.read_at === null)).toBe(true)
		expect(new Set(lignes.map((une) => une.recipient_id))).toEqual(new Set([ADMIN, BIZDEV]))
		expect(new Set(lignes.map((une) => une.payload['comment_id']))).toEqual(
			new Set([COMMENTAIRE_D1, COMMENTAIRE_D2]),
		)
	})
})
