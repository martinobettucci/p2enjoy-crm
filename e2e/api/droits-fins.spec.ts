// @verifies CRM-012 (docs/BACKLOG.md) — droits fins par track et channel, hors interface
// @verifies docs/SPEC-permissions-rls.md §4.1 (politiques), §4.2 (contrat d'API, lignes a à l),
//           §2.2 (matrice), §7 (preuves de refus n° 3, 4 et 11)
// @verifies docs/JOURNAL.md décisions 105, 106, 107
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios rejouent une à une les treize lignes du contrat d'API de
// `docs/SPEC-permissions-rls.md` §4.2, avec les jetons réels des trois profils seedés obtenus par
// la véritable route de connexion. Aucun navigateur n'est lancé.
//
// Deux règles gouvernent ce fichier, et elles ne sont pas décoratives :
//
//   * **la clé de service ne prouve jamais un refus.** Elle contourne la RLS, et ne sert donc qu'à
//     constater que les lignes **existent** avant d'affirmer que personne ne les voit — sans quoi
//     « zéro ligne » serait vrai sur une table vide (docs/JOURNAL.md décision 50) ;
//   * **une suppression refusée se prouve en relisant la ligne.** Le `USING` d'une politique
//     `for delete` filtre les candidates : la commande réussit, aucune ligne ne disparaît, aucune
//     erreur n'est levée (décision 106). Un test qui constaterait l'absence d'erreur serait vert
//     que la politique tienne ou qu'elle ait été retirée.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Les quatre droits fins du seed (`docs/SPEC-seed.md` §2.11). */
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const TRACK_FORMATION = '5eed0000-0000-4000-8000-000000000023'
const CH_PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
const CH_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'

const U_ADMIN = '5eed0000-0000-4000-8000-000000000011'
const U_BIZDEV = '5eed0000-0000-4000-8000-000000000012'
const U_VIEWER = '5eed0000-0000-4000-8000-000000000013'

const TM = '/rest/v1/track_members'
const CM = '/rest/v1/channel_members'

type DroitFin = { track_id?: string; channel_id?: string; user_id: string; access: string }

/**
 * Crée un second workspace et un track qui lui appartient, avec la clé de service.
 *
 * Il n'existe aucun moyen de le créer autrement : aucune politique n'autorise la création d'un
 * workspace par un client, et c'est le sujet d'INC-014, hors de cette unité. Le fait est nommé ici
 * plutôt que masqué, comme le font déjà `tracks.spec.ts` et `scripts/verify-authz.sh`.
 */
async function poserWorkspaceB(
	requete: APIRequestContext,
	suffixe: string,
): Promise<{ workspaceId: string; trackId: string }> {
	const workspaceId = `d0000000-0000-4000-8000-0000000${suffixe}`
	const trackId = `d0000000-0000-4000-8000-0000001${suffixe}`

	await requete.post('/rest/v1/workspaces', {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { id: workspaceId, name: `Workspace DF ${suffixe}`, slug: `workspace-df-${suffixe}` },
	})
	await requete.post('/rest/v1/tracks', {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: {
			id: trackId,
			workspace_id: workspaceId,
			name: 'Track du workspace DF',
			slug: 'track-df',
			position: 1,
		},
	})
	return { workspaceId, trackId }
}

test.describe('D0 — le seed a réellement posé ses quatre droits fins', () => {
	// Condition de validité de tout ce qui suit, et non un contrôle décoratif : sans lignes, les
	// scénarios de refus seraient verts sur une table vide, donc tautologiques (décision 50).
	test('quatre lignes existent, vues par la clé de service', async ({ request }) => {
		const tracks = await request.get(`${TM}?select=track_id,user_id,access`, {
			headers: enTetesService(),
		})
		const channels = await request.get(`${CM}?select=channel_id,user_id,access`, {
			headers: enTetesService(),
		})

		const lignesTracks = (await tracks.json()) as DroitFin[]
		const lignesChannels = (await channels.json()) as DroitFin[]

		// Les quatre situations de la matrice du §2.2, une par ligne (docs/SPEC-seed.md §2.11).
		expect(lignesTracks).toContainEqual({
			track_id: TRACK_CONSEIL,
			user_id: U_VIEWER,
			access: 'none',
		})
		expect(lignesTracks).toContainEqual({
			track_id: TRACK_CONSEIL,
			user_id: U_ADMIN,
			access: 'none',
		})
		expect(lignesChannels).toContainEqual({
			channel_id: CH_PROSPECTION,
			user_id: U_VIEWER,
			access: 'member',
		})
		expect(lignesChannels.map((l) => l.access)).toContain('viewer')
	})
})

test.describe('D1 — lecture des droits fins (§4.2, lignes a, b, c)', () => {
	test('ligne a — un appelant anonyme ne lit aucun droit fin', async ({ request }) => {
		// PREUVE DE REFUS N° 11. Le refus se manifeste par zéro ligne, **pas** par une erreur :
		// les deux formes sont vérifiées séparément (§7, dernier paragraphe).
		for (const chemin of [TM, CM]) {
			const reponse = await request.get(`${chemin}?select=*`, { headers: enTetesAnonymes() })
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])
		}
	})

	test('ligne b — l’administratrice lit toutes les lignes de son workspace', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.get(`${TM}?select=user_id,access`, {
			headers: enTetesAuthentifies(jeton),
		})

		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as DroitFin[]
		// Les deux lignes de `track_members` du seed, dont une qui ne la concerne pas.
		expect(lignes.map((l) => l.user_id).sort()).toEqual([U_ADMIN, U_VIEWER].sort())
	})

	test('ligne c — le `viewer` ne lit que sa propre ligne', async ({ request }) => {
		// DÉCISION 105 : un droit fin n'est pas une donnée d'équipe. L'intéressé voit ce qui
		// s'applique à lui — une restriction invisible à celui qui la subit serait une mauvaise
		// règle —, et rien de ce qui s'applique à ses collègues.
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const reponse = await request.get(`${TM}?select=user_id,access`, {
			headers: enTetesAuthentifies(jeton),
		})

		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as DroitFin[]
		expect(lignes).toEqual([{ user_id: U_VIEWER, access: 'none' }])
		// La ligne de l'administratrice existe pourtant : la clé de service vient de l'établir.
		expect(lignes.map((l) => l.user_id)).not.toContain(U_ADMIN)
	})
})

test.describe('D2 — la lecture des tracks et des channels applique le droit fin (lignes d, e, f, g)', () => {
	test('ligne d — le `viewer` ne voit pas le track sur lequel il porte `none`', async ({
		request,
	}) => {
		// PREUVE DE REFUS N° 4, au niveau des tracks. La ligne existe — établi par la clé de
		// service —, et l'appelant ne la voit pas.
		const controle = await request.get(`/rest/v1/tracks?select=id&id=eq.${TRACK_CONSEIL}`, {
			headers: enTetesService(),
		})
		expect((await controle.json()) as unknown[]).toHaveLength(1)

		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const reponse = await request.get(`/rest/v1/tracks?select=id&id=eq.${TRACK_CONSEIL}`, {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('ligne e — et pas davantage les channels de ce track', async ({ request }) => {
		// PREUVE DE REFUS N° 4, au niveau des channels : le droit fin de track se propage sans
		// qu'aucune ligne `channel_members` soit nécessaire.
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const reponse = await request.get(
			`/rest/v1/channels?select=id&id=eq.${CH_GRANDS_COMPTES}`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('ligne f — mais il voit le channel qu’un droit fin rouvre sous ce même track', async ({
		request,
	}) => {
		// « Le plus spécifique gagne » dans le sens contre-intuitif (§3.1) : un
		// `channel_members.access = 'member'` l'emporte sur le `track_members.access = 'none'`
		// du track qui contient ce channel.
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const reponse = await request.get(`/rest/v1/channels?select=slug&id=eq.${CH_PROSPECTION}`, {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as { slug: string }[]).toEqual([{ slug: 'prospection' }])
	})

	test('ligne g — l’administratrice porte le même `none`, et voit quand même', async ({
		request,
	}) => {
		// RÈGLE 2 DU §2.2 : un administrateur n'est jamais restreint. La ligne existe, elle lui
		// est lisible, et elle est sans effet — elle redeviendra opposante si ce compte cesse
		// d'être administrateur (décision 105).
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.get(`/rest/v1/tracks?select=slug&id=eq.${TRACK_CONSEIL}`, {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as { slug: string }[]).toEqual([{ slug: 'conseil-ia' }])
	})
})

test.describe('D3 — écriture des droits fins (§4.2, lignes h, i, j, j’)', () => {
	test('ligne h — un `business_developer` ne pose aucun droit fin : 403, code 42501', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[1].adresse)
		const reponse = await request.post(TM, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { track_id: TRACK_FORMATION, user_id: U_VIEWER, access: 'none' },
		})

		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as { code?: string }).code).toBe('42501')

		// L'échec doit être réel : la ligne ne doit exister nulle part, y compris pour la clé de
		// service. Un `403` rendu après une insertion réussie serait le pire des deux mondes.
		const controle = await request.get(
			`${TM}?select=user_id&track_id=eq.${TRACK_FORMATION}&user_id=eq.${U_VIEWER}`,
			{ headers: enTetesService() },
		)
		expect(await controle.json()).toEqual([])
	})

	test('lignes i et j — l’administratrice pose un droit fin, puis le retire', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		// État déterministe, quelle que soit l'issue d'une exécution précédente.
		await request.delete(`${TM}?track_id=eq.${TRACK_FORMATION}&user_id=eq.${U_BIZDEV}`, {
			headers: enTetesService(),
		})

		const creation = await request.post(TM, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { track_id: TRACK_FORMATION, user_id: U_BIZDEV, access: 'viewer' },
		})
		expect(creation.status()).toBe(201)

		// L'effet est réel, et non seulement enregistré : le `business_developer` ne peut plus
		// écrire dans ce sous-arbre. La lecture, elle, lui reste ouverte — `access = 'viewer'`.
		const jetonBizdev = await jetonDe(COMPTES_SEED[1].adresse)
		const lecture = await request.get(`/rest/v1/tracks?select=slug&id=eq.${TRACK_FORMATION}`, {
			headers: enTetesAuthentifies(jetonBizdev),
		})
		expect((await lecture.json()) as unknown[]).toHaveLength(1)

		const suppression = await request.delete(
			`${TM}?track_id=eq.${TRACK_FORMATION}&user_id=eq.${U_BIZDEV}`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(suppression.status()).toBe(204)

		// Le retrait rend l'accès **hérité**, ce qui est l'état par défaut du §2.2.
		const apres = await request.get(
			`${TM}?select=user_id&track_id=eq.${TRACK_FORMATION}&user_id=eq.${U_BIZDEV}`,
			{ headers: enTetesService() },
		)
		expect(await apres.json()).toEqual([])
	})

	test('ligne j’ — le `viewer` ne peut pas lever sa propre restriction, et sans erreur', async ({
		request,
	}) => {
		// DÉCISION 106, ET C'EST LA PREUVE LA PLUS FACILE À RATER DE CE FICHIER.
		//
		// Le `USING` d'une politique `for delete` **filtre** les lignes candidates : la commande
		// réussit, `200`, corps vide, et rien n'est supprimé. Aucune erreur n'est levée. Un test
		// qui se contenterait de « la commande n'a pas échoué » serait vert que la politique
		// tienne ou qu'elle ait été retirée : le refus se prouve en **relisant la ligne**.
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)

		const reponse = await request.delete(
			`${TM}?track_id=eq.${TRACK_CONSEIL}&user_id=eq.${U_VIEWER}`,
			{ headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' } },
		)
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		// LA SEULE ASSERTION QUI PROUVE QUELQUE CHOSE : la ligne est intacte.
		const controle = await request.get(
			`${TM}?select=access&track_id=eq.${TRACK_CONSEIL}&user_id=eq.${U_VIEWER}`,
			{ headers: enTetesService() },
		)
		expect((await controle.json()) as DroitFin[]).toEqual([{ access: 'none' }])

		// Et l'effet du droit fin est toujours là.
		const tracks = await request.get(`/rest/v1/tracks?select=id&id=eq.${TRACK_CONSEIL}`, {
			headers: enTetesAuthentifies(jeton),
		})
		expect(await tracks.json()).toEqual([])
	})
})

test.describe('D4 — le cloisonnement par workspace tient (§4.2, lignes k, l)', () => {
	test('ligne k — l’administratrice de A ne pose aucun droit fin sur un track de B', async ({
		request,
	}) => {
		// PREUVE DE REFUS N° 3, appliquée aux droits fins eux-mêmes : le resserrement de la
		// politique de lecture n'a pas relâché le cloisonnement.
		const { workspaceId, trackId } = await poserWorkspaceB(request, '00011')
		try {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.post(TM, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { track_id: trackId, user_id: U_VIEWER, access: 'none' },
			})

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code?: string }).code).toBe('42501')
		} finally {
			await request.delete(`/rest/v1/workspaces?id=eq.${workspaceId}`, {
				headers: enTetesService(),
			})
		}
	})

	test('ligne l — l’administratrice de A ne lit aucun track de B', async ({ request }) => {
		const { workspaceId } = await poserWorkspaceB(request, '00012')
		try {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.get(
				`/rest/v1/tracks?select=slug&workspace_id=eq.${workspaceId}`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])
		} finally {
			await request.delete(`/rest/v1/workspaces?id=eq.${workspaceId}`, {
				headers: enTetesService(),
			})
		}
	})
})

test.describe('D5 — décision 107 : l’écriture avec `return=representation` fonctionne', () => {
	// LA RÉGRESSION QUE CE FICHIER FIGE, ET ELLE A ÉTÉ RÉELLE.
	//
	// La première version de la migration adossait la politique de lecture de `tracks` à une
	// fonction qui relisait `tracks`. Le `RETURNING` d'un `INSERT` étant soumis à la politique
	// `SELECT`, et une fonction `STABLE` ne voyant pas la ligne écrite par l'instruction en
	// cours, toute création de track ou de channel par un administrateur rendait `403`.
	//
	// `e2e/api/tracks.spec.ts` l'a trouvée. Ce scénario la garde ici, à l'endroit de l'unité
	// responsable, pour qu'elle ne puisse pas revenir en silence.
	for (const table of ['tracks', 'channels'] as const) {
		test(`une création de ${table} par l’administratrice rend bien la ligne créée`, async ({
			request,
		}) => {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const slug = `retour-${table}`
			await request.delete(`/rest/v1/${table}?slug=eq.${slug}`, { headers: enTetesService() })

			const donnees =
				table === 'tracks'
					? { workspace_id: WORKSPACE_SEED, name: 'Retour', slug }
					: {
							workspace_id: WORKSPACE_SEED,
							track_id: TRACK_FORMATION,
							workflow_id: '5eed0000-0000-4000-8000-000000000051',
							name: 'Retour',
							slug,
						}

			const reponse = await request.post(`/rest/v1/${table}`, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: donnees,
			})

			expect(reponse.status()).toBe(201)
			expect((await reponse.json()) as unknown[]).toHaveLength(1)

			await request.delete(`/rest/v1/${table}?slug=eq.${slug}`, { headers: enTetesService() })
		})
	}
})
