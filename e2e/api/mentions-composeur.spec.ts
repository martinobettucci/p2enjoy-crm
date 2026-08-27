// @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences,
//           SOUS-TRANCHE 3B : l'émission
// @verifies docs/SPEC-notifications.md §37 (les dix lignes du contrat), §34.2 (la RPC et son refus
//           à zéro ligne), §34.3 (l'appelant absent de sa propre liste), §34.4 (le refus d'`anon`
//           par le PRIVILÈGE), §35.1 (le POST groupé est tout ou rien), §35.2 (un POST par
//           mention, séquentiel), §5.1 (la règle d'éligibilité), §7.1 (la politique juge l'auteur)
// @verifies docs/SPEC-notifications.md §50 (l'état vide du sélecteur, tranché), §50.7 (la ligne
//           *ah* du contrat), §36.4 (les quatre états de la liste)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0063_mentionnables.test.sql` prouve la
// forme de la fonction **en base**, sous le propriétaire. Rien n'y garantit que la pile la rende
// par la vraie route — et le précédent est cuisant : la tranche 1 a mesuré que le privilège
// d'exécution d'`app.can_read_card_pour` manquait à `authenticated`, ce que la suite pgTAP ne
// pouvait pas voir, s'exécutant sous un rôle qui n'a besoin d'aucun privilège.
//
// LA LIGNE *af* EST LA PLUS IMPORTANTE DE CE FICHIER, ET ELLE N'ÉPROUVE PAS LE PRODUIT : elle fige
// une propriété de PostgREST — un `POST` groupé est **tout ou rien** — dont la décision de forme du
// §35.2 dépend entièrement. Le jour où cette propriété changerait, la séquence d'émission de
// l'écran deviendrait un coût payé pour rien, et personne ne le saurait sans cette ligne.
//
// CE FICHIER ÉCRIT, ET IL REND LE PRODUIT DANS L'ÉTAT OÙ IL LE TROUVE. Chaque ligne posée est
// retirée, et une dernière lecture le CONSTATE — décision 501 : une preuve qui laisse ses sondes
// en base fait rougir la suivante.

import { expect, test } from '@playwright/test'
import { CLE_SERVICE, URL_API, enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'
import {
	ESPACE_SOLITAIRE,
	demonterEspaceSolitaire,
	monterEspaceSolitaire,
} from './espace-solitaire'

const RPC = '/rest/v1/rpc/mentionnables'
const MENTIONS = '/rest/v1/card_comment_mentions'
const COMMENTAIRES = '/rest/v1/card_comments'
const NOTIFICATIONS = '/rest/v1/notifications'

/** Les trois profils du seed — `docs/SPEC-seed.md` §2.3. */
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'

/**
 * `…0c1` vit dans `grands-comptes`, channel **fermé** à Farida ; `…0c5` dans `maintenance`, que les
 * trois profils lisent (`docs/SPEC-notifications.md` §32, M1). L'écart est **déjà dans le seed** :
 * la même personne y est éligible sur une affaire et pas sur l'autre, et c'est ce qui rend les
 * lignes *y* et *z* strictes.
 */
const CARD_FERMEE_A_FARIDA = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_OUVERTE_A_TOUS = '5eed0000-0000-4000-8000-0000000000c5'

/** Le commentaire de Camille sur `…0c1`, dont elle est l'auteure. */
const D1_DE_CAMILLE = '5eed0000-0000-4000-8000-0000000000d1'
/** Le commentaire de Driss sur la même affaire — celui dont Camille n'est PAS l'auteure. */
const D2_DE_DRISS = '5eed0000-0000-4000-8000-0000000000d2'

/** Un identifiant bien formé qui ne désigne aucune affaire. */
const NEANT = '00000000-0000-4000-8000-00000000beef'

type LigneMentionnable = { profile_id: string; full_name: string; avatar_url: string | null }

/** Appelle la RPC avec un jeton donné, et rend statut et corps. */
async function mentionnables(
	requete: import('@playwright/test').APIRequestContext,
	entetes: Record<string, string>,
	idCard: string,
): Promise<{ statut: number; lignes: LigneMentionnable[]; corps: unknown }> {
	const reponse = await requete.post(`${URL_API}${RPC}`, {
		headers: { ...entetes, 'Content-Type': 'application/json' },
		data: { card_id: idCard },
	})
	const corps = await reponse.json()
	return {
		statut: reponse.status(),
		lignes: Array.isArray(corps) ? (corps as LigneMentionnable[]) : [],
		corps,
	}
}

/** Relit les mentions d'un commentaire **avec la clé de service**, donc hors de toute politique. */
async function mentionsEnBase(
	requete: import('@playwright/test').APIRequestContext,
	commentaire: string,
): Promise<Array<{ profile_id: string }>> {
	const reponse = await requete.get(
		`${URL_API}${MENTIONS}?comment_id=eq.${commentaire}&select=profile_id`,
		{ headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` } },
	)
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as Array<{ profile_id: string }>
}

/**
 * Publie un commentaire sonde par la VRAIE route, avec le jeton de son auteur, et rend son
 * identifiant — c'est-à-dire exactement ce que fait le composeur (§35).
 */
async function commentaireSonde(
	requete: import('@playwright/test').APIRequestContext,
	jeton: string,
	idCard: string,
): Promise<string> {
	const reponse = await requete.post(`${URL_API}${COMMENTAIRES}`, {
		headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
		data: { card_id: idCard, workspace_id: ESPACE, body: 'Sonde du contrat 3b.' },
	})
	expect(reponse.status(), 'la sonde est publiée par la vraie route').toBe(201)
	const lignes = (await reponse.json()) as Array<{ id: string }>
	return lignes[0]!.id
}

/** Détruit une sonde et tout ce qu'elle a produit, avec la clé de service. */
async function detruireSonde(
	requete: import('@playwright/test').APIRequestContext,
	idCommentaire: string,
): Promise<void> {
	const entetes = { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` }
	// LES NOTIFICATIONS D'ABORD : elles ne portent aucune clé étrangère vers la mention (§14.4), et
	// leur `payload` est le seul lien. Les laisser fausserait le compte de la lecture finale.
	await requete.delete(`${URL_API}${NOTIFICATIONS}?payload->>comment_id=eq.${idCommentaire}`, {
		headers: entetes,
	})
	await requete.delete(`${URL_API}${MENTIONS}?comment_id=eq.${idCommentaire}`, { headers: entetes })
	await requete.delete(`${URL_API}${COMMENTAIRES}?id=eq.${idCommentaire}`, { headers: entetes })
}

test.describe('CRM-064 sous-tranche 3b — le contrat d’API de l’émission', () => {
	let camille: string
	let farida: string
	let driss: string

	// ~~LE JETON DE DRISS N'EST PAS OBTENU, ET C'EST DÉLIBÉRÉ~~ — RÉVISÉ le 2026-08-27, et le motif
	// d'origine est conservé parce qu'il reste juste pour les onze premières lignes : Driss y est le
	// DESTINATAIRE des mentions, jamais leur auteur, et obtenir un jeton dont aucune assertion ne se
	// sert laisserait croire qu'un profil est éprouvé alors qu'il ne l'est pas (décision 50).
	// La ligne *ah* du §50.7 change cela : elle APPELLE sous Driss, seul membre d'un espace jetable.
	// Le jeton est donc obtenu, et il sert.
	test.beforeAll(async () => {
		camille = await jetonDe('admin@p2enjoy.test')
		farida = await jetonDe('viewer@p2enjoy.test')
		driss = await jetonDe('bizdev@p2enjoy.test')
	})

	test('x — l’appelant anonyme est refusé PAR LE PRIVILÈGE, pas par une liste vide', async ({
		request,
	}) => {
		// `401` / `42501` et non `200 []` : c'est plus strict, et c'est ce que la ligne `revoke …
		// from public, anon` de la migration achète. Sans elle, `pg_default_acl` aurait laissé
		// `execute` à `anon` — la leçon payée par la migration 53.
		const { statut, corps } = await mentionnables(request, enTetesAnonymes(), CARD_OUVERTE_A_TOUS)

		expect(statut).toBe(401)
		expect((corps as { code?: string }).code).toBe('42501')
	})

	test('y — sur une affaire de « Grands comptes », une seule personne, et ce n’est ni la lectrice ni l’appelante', async ({
		request,
	}) => {
		const { statut, lignes } = await mentionnables(
			request,
			enTetesAuthentifies(camille),
			CARD_FERMEE_A_FARIDA,
		)

		expect(statut).toBe(200)
		expect(lignes.map((l) => l.profile_id)).toEqual([DRISS])
		// LES DEUX ABSENCES SONT DE NATURES DIFFÉRENTES, et le fichier le dit plutôt que de les
		// laisser se confondre : Farida est écartée par l'ÉLIGIBILITÉ (§5.1), Camille par la règle
		// de l'auto-mention (§34.3). La ligne z sépare la première, la ligne ab la seconde.
		expect(lignes.map((l) => l.profile_id)).not.toContain(FARIDA)
		expect(lignes.map((l) => l.profile_id)).not.toContain(CAMILLE)
		// La liste porte de quoi rendre une case à cocher, et rien de plus (§34.2).
		expect(Object.keys(lignes[0]!).sort()).toEqual(['avatar_url', 'full_name', 'profile_id'])
		expect(lignes[0]!.full_name).toBe('Driss Lemoine')
	})

	test('z — la MÊME personne est éligible sur « Maintenance » : la liste dépend de l’affaire', async ({
		request,
	}) => {
		// C'EST CE CROISEMENT QUI REND LA PREUVE STRICTE. Une fonction qui rendrait partout la même
		// liste passerait la ligne y en écartant Farida par erreur ; elle échouerait ici.
		const { statut, lignes } = await mentionnables(
			request,
			enTetesAuthentifies(camille),
			CARD_OUVERTE_A_TOUS,
		)

		expect(statut).toBe(200)
		expect(lignes.map((l) => l.profile_id)).toEqual([DRISS, FARIDA])
	})

	test('aa — une affaire fermée à l’appelante rend ZÉRO LIGNE, jamais une erreur', async ({
		request,
	}) => {
		const { statut, lignes } = await mentionnables(
			request,
			enTetesAuthentifies(farida),
			CARD_FERMEE_A_FARIDA,
		)

		expect(statut).toBe(200)
		expect(lignes).toEqual([])
	})

	test('ab — la lectrice a sa liste, et elle n’y est pas', async ({ request }) => {
		const { statut, lignes } = await mentionnables(
			request,
			enTetesAuthentifies(farida),
			CARD_OUVERTE_A_TOUS,
		)

		expect(statut).toBe(200)
		expect(lignes.map((l) => l.profile_id)).toEqual([CAMILLE, DRISS])
		expect(lignes.map((l) => l.profile_id)).not.toContain(FARIDA)
	})

	test('ac — une affaire inexistante rend le MÊME résultat qu’une affaire fermée', async ({
		request,
	}) => {
		// C'EST UNE PROPRIÉTÉ DE DISCRÉTION, pas une commodité (§6) : distinguer les deux ferait de
		// la fonction un moyen de sonder l'existence des affaires d'autrui.
		const { statut, lignes } = await mentionnables(request, enTetesAuthentifies(camille), NEANT)

		expect(statut).toBe(200)
		expect(lignes).toEqual([])
	})

	test('ad et ae — deux POST séparés rendent un résultat PARTIEL, et la mention posée SURVIT au refus', async ({
		request,
	}) => {
		const sonde = await commentaireSonde(request, camille, CARD_FERMEE_A_FARIDA)
		try {
			// ad — le destinataire éligible passe, ET la notification naît (§14).
			const posee = await request.post(`${URL_API}${MENTIONS}`, {
				headers: enTetesAuthentifies(camille),
				data: { comment_id: sonde, profile_id: DRISS, workspace_id: ESPACE },
			})
			expect(posee.status(), 'ad — la mention éligible est posée').toBe(201)

			const notifications = await request.get(
				`${URL_API}${NOTIFICATIONS}?payload->>comment_id=eq.${sonde}&select=recipient_id`,
				{ headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` } },
			)
			expect(notifications.status()).toBe(200)
			expect(
				(await notifications.json()) as Array<{ recipient_id: string }>,
				'la pose par la vraie route PRODUIT la notification — sans quoi 3b ne remplirait rien',
			).toEqual([{ recipient_id: DRISS }])

			// ae — le destinataire inéligible est refusé, et le refus NOMME la règle, jamais la
			// personne ni son niveau d'accès (§6).
			const refusee = await request.post(`${URL_API}${MENTIONS}`, {
				headers: enTetesAuthentifies(camille),
				data: { comment_id: sonde, profile_id: FARIDA, workspace_id: ESPACE },
			})
			expect(refusee.status(), 'ae — le destinataire sans accès est refusé').toBe(400)
			const corps = (await refusee.json()) as { code?: string; message?: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('mention_destinataire_sans_acces')

			// LE RÉSULTAT EST PARTIEL, ET C'EST TOUT L'OBJET DE LA SÉQUENCE DU §35.2 : la mention
			// éligible reste posée. C'est la mesure M6, rejouée par la vraie route.
			expect(await mentionsEnBase(request, sonde)).toEqual([{ profile_id: DRISS }])
		} finally {
			await detruireSonde(request, sonde)
		}
	})

	test('af — un POST GROUPÉ est TOUT OU RIEN, et c’est ce fait qui décide la forme de l’émission', async ({
		request,
	}) => {
		const sonde = await commentaireSonde(request, camille, CARD_FERMEE_A_FARIDA)
		try {
			// LA MESURE M5, FIGÉE. Deux mentions dans un seul tableau, la première ÉLIGIBLE et la
			// seconde non : le refus emporte les deux, et il ne dit pas laquelle est en cause.
			const groupe = await request.post(`${URL_API}${MENTIONS}`, {
				headers: enTetesAuthentifies(camille),
				data: [
					{ comment_id: sonde, profile_id: DRISS, workspace_id: ESPACE },
					{ comment_id: sonde, profile_id: FARIDA, workspace_id: ESPACE },
				],
			})
			expect(groupe.status()).toBe(400)
			expect((await groupe.json()).message).toBe('mention_destinataire_sans_acces')

			// AUCUNE MENTION N'EST POSÉE, PAS MÊME CELLE QUI ÉTAIT ÉLIGIBLE. Si cette assertion
			// devenait fausse, le §35.2 aurait perdu sa cause et l'écran paierait N requêtes pour
			// rien — c'est pour cela qu'elle est écrite, et non pour éprouver le produit.
			expect(
				await mentionsEnBase(request, sonde),
				'le POST groupé n’a rien posé : c’est ce qui interdit au composeur de grouper',
			).toEqual([])
		} finally {
			await detruireSonde(request, sonde)
		}
	})

	test('ag — la politique juge l’AUTEUR : mentionner sur le commentaire d’autrui est refusé', async ({
		request,
	}) => {
		// DEUX JUGES, DEUX REFUS. Le trigger rend `400` / `P0001` sur le destinataire (ligne ae) ;
		// la politique rend `403` / `42501` sur l'auteur.
		//
		// LE DESTINATAIRE DOIT ÊTRE ÉLIGIBLE POUR QUE CETTE LIGNE MESURE CE QU'ELLE ANNONCE, et la
		// première écriture de ce fichier l'a appris en rougissant : visant Farida — inéligible sur
		// cette affaire —, elle recevait `400` et non `403`. Le trigger est `BEFORE INSERT`, donc il
		// s'exécute AVANT la clause `WITH CHECK` de la politique : un destinataire inéligible fait
		// tomber le refus du destinataire, et celui de l'auteur reste invisible. Driss est ici
		// parfaitement éligible ; ce qui est refusé, c'est que Camille écrive sur SON commentaire.
		const refus = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(camille),
			data: { comment_id: D2_DE_DRISS, profile_id: DRISS, workspace_id: ESPACE },
		})

		expect(refus.status()).toBe(403)
		expect((await refus.json()).code).toBe('42501')
	})

	test('ah — SEUL LECTEUR de son affaire, l’appelant reçoit `200 []` : l’état vide existe', async ({
		request,
	}) => {
		// LA LIGNE *ah* DU §50.7, ET ELLE FIGE LA MESURE MA4. Le §34.2 annonce depuis l'origine que
		// le refus de lecture est zéro ligne, et le §36.4 décrit un état vide « réel, pas un
		// repli ». Aucune donnée ne l'avait encore montré : dans le seed, l'administratrice lit
		// toutes les affaires, si bien qu'un non-administrateur a toujours au moins elle (§36.4).
		//
		// LA FIXTURE NE TOUCHE PAS AU SEED (§50.2) : elle pose un SECOND espace jetable dont Driss
		// est l'unique membre, et le détruit. C'est le chemin déterministe de `CLAUDE.md` §15, déjà
		// emprunté par `preuves-refus.spec.ts` et `demarrage.spec.ts`.
		await monterEspaceSolitaire(request)
		try {
			// LA LIGNE DE BASE EST REJOUÉE DANS LE MÊME SCÉNARIO, et le §50.9 l'exige : sans elle,
			// `[]` ne distinguerait pas « personne n'est éligible » de « la fonction ne rend jamais
			// rien sous ce jeton ». MA1 mesure deux lignes ici.
			const surLeSeed = await mentionnables(request, enTetesAuthentifies(driss), CARD_OUVERTE_A_TOUS)
			expect(surLeSeed.statut).toBe(200)
			expect(surLeSeed.lignes.map((ligne) => ligne.profile_id).sort()).toEqual(
				[CAMILLE, FARIDA].sort(),
			)

			// LA MESURE : sur l'affaire de son espace solitaire, la MÊME fonction, le MÊME jeton et
			// la même route rendent une liste vide. `200`, jamais une erreur, jamais un refus.
			const solitaire = await mentionnables(
				request,
				enTetesAuthentifies(driss),
				ESPACE_SOLITAIRE.card,
			)
			expect(solitaire.statut).toBe(200)
			expect(solitaire.lignes, 'l’appelant est seul lecteur : la liste est vide').toEqual([])

			// ET IL LIT BIEN L'AFFAIRE. Sans cette relecture, une card devenue illisible — donc une
			// fixture cassée — rendrait le même `[]` et le scénario passerait pour de mauvaises
			// raisons : c'est précisément ce que la ligne *ac* mesure de l'affaire inexistante.
			const carte = await request.get(
				`${URL_API}/rest/v1/cards?id=eq.${ESPACE_SOLITAIRE.card}&select=id`,
				{ headers: enTetesAuthentifies(driss) },
			)
			expect(carte.status()).toBe(200)
			expect((await carte.json()) as unknown[]).toHaveLength(1)
		} finally {
			await demonterEspaceSolitaire(request)
		}
	})

	test('le produit est rendu DANS L’ÉTAT OÙ IL A ÉTÉ TROUVÉ', async ({ request }) => {
		// Décision 501 : une preuve qui laisse ses sondes en base fait rougir la suivante. Le seed
		// porte cinq commentaires, deux mentions et deux notifications (§38).
		const entetes = { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` }
		const commentaires = await request.get(`${URL_API}${COMMENTAIRES}?select=id`, {
			headers: entetes,
		})
		const mentions = await request.get(`${URL_API}${MENTIONS}?select=comment_id`, {
			headers: entetes,
		})
		const notifications = await request.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
			headers: entetes,
		})

		expect((await commentaires.json()) as unknown[]).toHaveLength(5)
		expect((await mentions.json()) as unknown[]).toHaveLength(2)
		expect((await notifications.json()) as unknown[]).toHaveLength(2)
	})
})
