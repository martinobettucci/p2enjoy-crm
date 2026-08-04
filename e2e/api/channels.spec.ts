// @verifies CRM-021 (docs/BACKLOG.md) — channels : CRUD, ordre, archivage, cloisonnement
// @verifies docs/SPEC-channels.md §7 (contrat d'API mesuré, lignes b à o), §3 (ordre), §4, §2.4
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 3 et n° 11)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés, obtenus par la véritable route de connexion. Aucun navigateur n'est lancé.
//
// Ils reprennent une à une les quatorze lignes du tableau de `docs/SPEC-channels.md` §7, qui sont
// des **mesures** et non des prévisions : la spécification a été écrite après les avoir observées
// sur une table sonde, et ces scénarios les rejouent contre la table réelle.
//
// Ce que ce fichier ne fait jamais : prouver un refus avec la clé de service. Elle contourne la
// RLS, et ne sert donc qu'à **constater l'état de la base** — indispensable, car un « zéro ligne »
// sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout (décision 50).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Les tracks du seed qui portent des channels (`docs/SPEC-channels.md` §8). */
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'
const TRACK_FORMATION = '5eed0000-0000-4000-8000-000000000023'

/** Les channels actifs de `conseil-ia`, dans l'ordre de leur `position`. */
const CHANNELS_CONSEIL_ACTIFS = ['prospection', 'grands-comptes']
const CHANNEL_ARCHIVE = 'appels-offres'

const CHEMIN = '/rest/v1/channels'

type Channel = {
	id: string
	slug: string
	name: string
	position: number
	workflow_id: string | null
	archived_at: string | null
	track_id: string
	workspace_id: string
}

/**
 * Crée un second workspace, son track et son channel, avec la clé de service.
 *
 * Il n'existe **aucun** moyen de les créer autrement : aucune politique n'autorise la création
 * d'un workspace par un client, et c'est voulu — `CRM-012` en décidera. Le fait est nommé ici
 * plutôt que masqué, comme `e2e/api/tracks.spec.ts` le fait déjà.
 */
async function poserWorkspaceB(
	requete: APIRequestContext,
	suffixe: string,
): Promise<{ workspaceId: string; trackId: string }> {
	// Le suffixe complète un UUID : il vaut exactement cinq caractères hexadécimaux, sinon
	// l'identifiant produit est trop court et PostgREST refuse la requête en `400` — un échec qui
	// ressemblerait à un refus d'autorisation sans en être un.
	if (!/^[0-9a-f]{5}$/.test(suffixe)) throw new Error(`suffixe invalide : ${suffixe}`)
	const workspaceId = `c0000000-0000-4000-8000-0000000${suffixe}`
	const trackId = `c0000000-0000-4000-8000-0000001${suffixe}`

	const ws = await requete.post('/rest/v1/workspaces', {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { id: workspaceId, name: `Workspace CH B ${suffixe}`, slug: `workspace-ch-b-${suffixe}` },
	})
	expect(ws.status(), 'la fixture du workspace B doit être posée').toBeLessThan(300)
	const tr = await requete.post('/rest/v1/tracks', {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: {
			id: trackId,
			workspace_id: workspaceId,
			name: 'Track du workspace B',
			slug: 'track-ch-b',
			position: 1,
		},
	})
	expect(tr.status(), 'la fixture du track de B doit être posée').toBeLessThan(300)
	return { workspaceId, trackId }
}

/** Retire ce que le scénario a créé, pour que la base reste conforme au seed. */
async function retirerWorkspaceB(requete: APIRequestContext, workspaceId: string): Promise<void> {
	await requete.delete(`/rest/v1/workspaces?id=eq.${workspaceId}`, { headers: enTetesService() })
}

test.describe('C0 — la table contient réellement des lignes', () => {
	// Condition de validité de tout ce qui suit (décision 50).
	test('le seed a posé six channels, dont un archivé, sur trois tracks', async ({ request }) => {
		const reponse = await request.get(
			`${CHEMIN}?select=slug,track_id,archived_at,workflow_id&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Channel[]
		expect(lignes).toHaveLength(6)
		expect(lignes.filter((c) => c.archived_at !== null)).toHaveLength(1)
		expect(new Set(lignes.map((c) => c.track_id)).size).toBe(3)
		// INC-029 : `workflow_id` est nul partout, et c'est l'état réel du produit jusqu'à
		// `CRM-031`. Le seed ne fabrique pas une donnée que le modèle ne sait pas encore produire.
		expect(lignes.every((c) => c.workflow_id === null)).toBe(true)
	})
})

test.describe('C1 — lecture (docs/SPEC-channels.md §7, lignes b, c, d)', () => {
	test('ligne b — PREUVE DE REFUS N° 11 : l’anonyme ne lit aucun channel', async ({ request }) => {
		const reponse = await request.get(`${CHEMIN}?select=*`, { headers: enTetesAnonymes() })

		// Le refus se manifeste par zéro ligne, **pas** par une erreur : les deux formes sont
		// vérifiées séparément (docs/SPEC-permissions-rls.md §7, dernier paragraphe).
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	for (const compte of COMPTES_SEED) {
		test(`lignes c et d — ${compte.role} lit les channels de son workspace`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const reponse = await request.get(`${CHEMIN}?select=slug`, {
				headers: enTetesAuthentifies(jeton),
			})

			expect(reponse.status()).toBe(200)
			const lignes = (await reponse.json()) as Channel[]
			// Les six, archivé compris : c'est le **filtre de la barre d'onglets** qui masque
			// l'archivé, pas la politique de lecture. Un administrateur doit pouvoir désarchiver.
			expect(lignes).toHaveLength(6)
			// Lire n'exige pas d'écrire : le `viewer` voit ce que voit l'administrateur.
			expect(lignes.map((c) => c.slug)).toContain(CHANNEL_ARCHIVE)
		})
	}

	test('la requête de la barre d’onglets rend l’ordre du track, sans l’archivé', async ({
		request,
	}) => {
		// La requête est exactement celle de `webapp/src/lib/channels.ts`.
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const reponse = await request.get(
			`${CHEMIN}?select=id,name,slug,position&track_id=eq.${TRACK_CONSEIL}` +
				'&archived_at=is.null&order=position,name',
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Channel[]
		expect(lignes.map((c) => c.slug)).toEqual(CHANNELS_CONSEIL_ACTIFS)
		expect(lignes.map((c) => Number(c.position))).toEqual([1, 2])
	})

	test('un track qui n’a qu’un channel rend une barre à un seul onglet', async ({ request }) => {
		// Cas d'affichage réel, distinct de la barre vide : c'est pour lui que le seed donne un
		// unique channel à `formation` (docs/SPEC-channels.md §8).
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.get(
			`${CHEMIN}?select=slug&track_id=eq.${TRACK_FORMATION}&archived_at=is.null`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect((await reponse.json()) as Channel[]).toHaveLength(1)
	})
})

test.describe('C2 — écriture réservée aux administrateurs (lignes e, f, g, h)', () => {
	for (const compte of COMPTES_SEED.filter((c) => c.role !== 'admin')) {
		test(`lignes e et f — ${compte.role} ne crée aucun channel : 403, code 42501`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const slug = `refus-${compte.role.replace(/_/g, '-')}`
			const reponse = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: {
					workspace_id: WORKSPACE_SEED,
					track_id: TRACK_CONSEIL,
					name: 'Refusé',
					slug,
				},
			})

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code: string }).code).toBe('42501')

			// Le refus n'a rien laissé derrière lui : constaté avec la clé de service, qui
			// contourne la RLS — sans quoi l'absence de ligne pourrait n'être qu'un refus de
			// lecture.
			const controle = await request.get(`${CHEMIN}?select=slug&slug=eq.${slug}`, {
				headers: enTetesService(),
			})
			expect(await controle.json()).toEqual([])
		})
	}

	test('ligne g — l’administrateur crée un channel, `position` attribuée par le trigger', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const slug = `api-cree-${Date.now()}`
		const reponse = await request.post(CHEMIN, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { workspace_id: WORKSPACE_SEED, track_id: TRACK_STUDIO, name: 'Créé par API', slug },
		})

		expect(reponse.status()).toBe(201)
		const [cree] = (await reponse.json()) as Channel[]
		// `studio-web` porte déjà deux channels : le trigger place celui-ci en troisième position
		// **de son track**, et non à la suite de tous les channels du workspace (décision 61).
		expect(Number(cree?.position)).toBe(3)
		expect(cree?.workflow_id).toBeNull()

		await request.delete(`${CHEMIN}?id=eq.${cree?.id}`, { headers: enTetesService() })
	})

	test('ligne h — le même slug dans le même track est refusé : 409, code 23505', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHEMIN, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: TRACK_CONSEIL,
				name: 'Doublon',
				slug: 'prospection',
			},
		})

		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as { code: string }).code).toBe('23505')
	})

	test('le même slug dans un **autre** track est accepté : l’unicité est par track', async ({
		request,
	}) => {
		// C'est la différence de fond avec `tracks`, dont le slug est unique par workspace.
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHEMIN, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: TRACK_STUDIO,
				name: 'Prospection du studio',
				slug: 'prospection',
			},
		})

		expect(reponse.status()).toBe(201)
		const [cree] = (await reponse.json()) as Channel[]
		await request.delete(`${CHEMIN}?id=eq.${cree?.id}`, { headers: enTetesService() })
	})
})

test.describe('C3 — le cloisonnement, garanti par la clé composite (lignes n, o)', () => {
	test('ligne n — un `workspace_id` incohérent avec le track est refusé : 409, 23503', async ({
		request,
	}) => {
		// La preuve décisive de l'unité. L'appelant est administrateur de son workspace, le track
		// existe, le workspace existe : seule la clé composite peut refuser cette ligne, et sans
		// elle la RLS cloisonnerait sur une valeur fausse (docs/SPEC-channels.md §2.4).
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const { workspaceId, trackId } = await poserWorkspaceB(request, '000c3')
		try {
			const reponse = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: {
					workspace_id: WORKSPACE_SEED,
					track_id: trackId,
					name: 'Menteur',
					slug: 'menteur',
				},
			})

			expect(reponse.status()).toBe(409)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('23503')
			expect(corps.message).toContain('channels_track_id_workspace_id_fkey')
		} finally {
			await retirerWorkspaceB(request, workspaceId)
		}
	})

	test('ligne o — un `track_id` inexistant est refusé par la même contrainte', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHEMIN, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: '00000000-0000-4000-8000-00000000dead',
				name: 'Orphelin',
				slug: 'orphelin',
			},
		})

		expect(reponse.status()).toBe(409)
		const corps = (await reponse.json()) as { code: string; message: string }
		// Même contrainte, même code que la ligne n : la clé composite ne distingue pas « ce track
		// n'existe pas » de « ce track n'est pas dans ce workspace ». Un appelant ne peut donc pas
		// s'en servir pour deviner l'existence d'un track d'un autre workspace.
		expect(corps.code).toBe('23503')
		expect(corps.message).toContain('channels_track_id_workspace_id_fkey')
	})
})

test.describe('C4 — cloisonnement entre workspaces (lignes j, k, l)', () => {
	test('ligne j — PREUVE DE REFUS N° 3 : un membre de A ne voit aucun channel de B', async ({
		request,
	}) => {
		const { workspaceId, trackId } = await poserWorkspaceB(request, '000c4')
		try {
			await request.post(CHEMIN, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: {
					workspace_id: workspaceId,
					track_id: trackId,
					name: 'Channel de B',
					slug: 'channel-b',
					position: 1,
				},
			})

			// La ligne existe : constaté avec la clé de service, sans quoi le « zéro ligne » qui
			// suit serait vrai pour la mauvaise raison (décision 50).
			const avecService = await request.get(
				`${CHEMIN}?select=slug&workspace_id=eq.${workspaceId}`,
				{ headers: enTetesService() },
			)
			expect((await avecService.json()) as Channel[]).toHaveLength(1)

			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.get(`${CHEMIN}?select=slug&workspace_id=eq.${workspaceId}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])
		} finally {
			await retirerWorkspaceB(request, workspaceId)
		}
	})

	test('ligne k — un administrateur de A ne crée aucun channel dans B', async ({ request }) => {
		const { workspaceId, trackId } = await poserWorkspaceB(request, '000c5')
		try {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: workspaceId, track_id: trackId, name: 'Intrusion', slug: 'intrusion' },
			})

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code: string }).code).toBe('42501')
		} finally {
			await retirerWorkspaceB(request, workspaceId)
		}
	})

	test('ligne l — le `WITH CHECK` interdit de déplacer un channel vers un autre workspace', async ({
		request,
	}) => {
		const { workspaceId, trackId } = await poserWorkspaceB(request, '000c6')
		try {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.patch(`${CHEMIN}?slug=eq.prospection`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: workspaceId, track_id: trackId },
			})

			// Sans `WITH CHECK`, le `USING` seul aurait laissé passer : la ligne d'origine
			// appartient bien à l'appelant.
			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code: string }).code).toBe('42501')

			const controle = await request.get(`${CHEMIN}?select=workspace_id&slug=eq.prospection`, {
				headers: enTetesService(),
			})
			const [ligne] = (await controle.json()) as Channel[]
			expect(ligne?.workspace_id).toBe(WORKSPACE_SEED)
		} finally {
			await retirerWorkspaceB(request, workspaceId)
		}
	})
})

test.describe('C5 — archivage et suppression (lignes i, m)', () => {
	test('ligne m — un administrateur archive puis désarchive son channel', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const enTetes = { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' }

		const archive = await request.patch(`${CHEMIN}?slug=eq.maintenance`, {
			headers: { ...enTetes, Prefer: 'return=representation' },
			data: { archived_at: '2026-03-01T00:00:00Z' },
		})
		expect(archive.status()).toBe(200)
		expect(((await archive.json()) as Channel[])[0]?.archived_at).not.toBeNull()

		// L'archivage est **réversible** : c'est une suppression douce, et la vérifier dans un
		// seul sens ne prouverait pas la réversibilité.
		const restaure = await request.patch(`${CHEMIN}?slug=eq.maintenance`, {
			headers: { ...enTetes, Prefer: 'return=representation' },
			data: { archived_at: null },
		})
		expect(restaure.status()).toBe(200)
		expect(((await restaure.json()) as Channel[])[0]?.archived_at).toBeNull()
	})

	test('ligne i — la suppression physique est refusée même à un administrateur', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.delete(`${CHEMIN}?slug=eq.prospection`, {
			headers: enTetesAuthentifies(jeton),
		})

		// Le refus vient du **privilège**, pas de la politique : `DELETE` n'est accordé à
		// personne. Il se manifeste donc en `permission denied for table`.
		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('42501')
		expect(corps.message).toContain('permission denied for table channels')

		const controle = await request.get(`${CHEMIN}?select=slug&slug=eq.prospection`, {
			headers: enTetesService(),
		})
		expect((await controle.json()) as Channel[]).toHaveLength(1)
	})
})

test.describe('C6 — INC-030 : les droits fins ne sont pas appliqués', () => {
	test('un `channel_members.access = none` ne masque rien encore', async ({ request }) => {
		// L'écart est **prouvé**, pas seulement documenté : le jour où `CRM-012` resserrera la
		// politique, ce scénario deviendra rouge et forcera sa révision (décision 51).
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const profil = await request.get('/rest/v1/profiles?select=id&limit=100', {
			headers: enTetesService(),
		})
		const profils = (await profil.json()) as { id: string }[]
		expect(profils.length).toBeGreaterThan(0)

		const canal = await request.get(`${CHEMIN}?select=id&slug=eq.prospection`, {
			headers: enTetesService(),
		})
		const [cible] = (await canal.json()) as Channel[]

		// L'identifiant du `viewer` seedé (`docs/SPEC-seed.md` §2.3).
		const viewerId = '5eed0000-0000-4000-8000-000000000013'
		await request.post('/rest/v1/channel_members', {
			headers: {
				...enTetesService(),
				'Content-Type': 'application/json',
				Prefer: 'resolution=merge-duplicates',
			},
			data: { channel_id: cible?.id, user_id: viewerId, access: 'none' },
		})

		try {
			const reponse = await request.get(`${CHEMIN}?select=slug&slug=eq.prospection`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status()).toBe(200)
			expect((await reponse.json()) as Channel[]).toHaveLength(1)
		} finally {
			await request.delete(
				`/rest/v1/channel_members?channel_id=eq.${cible?.id}&user_id=eq.${viewerId}`,
				{ headers: enTetesService() },
			)
		}
	})
})
