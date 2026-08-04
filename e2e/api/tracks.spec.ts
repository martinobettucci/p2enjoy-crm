// @verifies CRM-020 (docs/BACKLOG.md) — tracks : CRUD, ordre, archivage, écriture réservée
// @verifies docs/SPEC-tracks.md §6 (contrat d'API mesuré, lignes b à m), §3 (ordre), §4 (archivage)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 3 et n° 11)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés, obtenus par la véritable route de connexion. Aucun navigateur n'est
// lancé.
//
// Ils reprennent une à une les douze lignes du tableau de `docs/SPEC-tracks.md` §6, qui sont des
// **mesures** et non des prévisions : la spécification a été écrite après les avoir observées sur
// une table sonde, et ces scénarios les rejouent contre la table réelle.
//
// Ce que ce fichier ne fait jamais : prouver un refus avec la clé de service. Elle contourne la
// RLS, et ne sert donc qu'à **constater l'état de la base** — ce qui est indispensable, car un
// « zéro ligne » sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout
// (docs/JOURNAL.md décision 50).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Les trois tracks actifs du seed, dans l'ordre de leur `position` (`docs/SPEC-tracks.md` §8). */
const TRACKS_ACTIFS = ['conseil-ia', 'studio-web', 'formation']

/** Le quatrième track du seed, archivé — il existe pour rendre l'état « archivé » démontrable. */
const TRACK_ARCHIVE = 'pipeline-2024'

const CHEMIN = '/rest/v1/tracks'

type Track = {
	id: string
	slug: string
	name: string
	color: string
	icon: string
	position: number
	archived_at: string | null
	workspace_id: string
}

/**
 * Crée un second workspace et un track qui lui appartient, avec la clé de service.
 *
 * Il n'existe **aucun** moyen de le créer autrement : aucune politique n'autorise la création
 * d'un workspace par un client, et c'est voulu — `CRM-012` en décidera. Le fait est nommé ici
 * plutôt que masqué, comme `scripts/verify-authz.sh` le fait déjà pour ses propres fixtures.
 */
async function poserWorkspaceB(
	requete: APIRequestContext,
	suffixe: string,
): Promise<{ workspaceId: string; trackId: string }> {
	const workspaceId = `b0000000-0000-4000-8000-0000000${suffixe}`
	const trackId = `b0000000-0000-4000-8000-0000001${suffixe}`

	await requete.post('/rest/v1/workspaces', {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { id: workspaceId, name: `Workspace B ${suffixe}`, slug: `workspace-b-${suffixe}` },
	})
	await requete.post(CHEMIN, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: {
			id: trackId,
			workspace_id: workspaceId,
			name: 'Track du workspace B',
			slug: 'track-b',
			position: 1,
		},
	})
	return { workspaceId, trackId }
}

test.describe('T0 — la table contient réellement des lignes', () => {
	// Condition de validité de tout ce qui suit. Sans elle, « zéro ligne pour l'anonyme » serait
	// vrai sur une table vide, et l'ensemble du fichier deviendrait tautologique (décision 50).
	test('le seed a posé quatre tracks, dont un archivé', async ({ request }) => {
		const reponse = await request.get(
			`${CHEMIN}?select=slug,archived_at&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Track[]
		expect(lignes).toHaveLength(4)
		expect(lignes.filter((t) => t.archived_at !== null)).toHaveLength(1)
	})
})

test.describe('T1 — lecture (docs/SPEC-tracks.md §6, lignes b, c, d)', () => {
	test('ligne b — PREUVE DE REFUS N° 11 : l’anonyme ne lit aucun track', async ({ request }) => {
		const reponse = await request.get(`${CHEMIN}?select=*`, { headers: enTetesAnonymes() })

		// Le refus se manifeste par zéro ligne, **pas** par une erreur : les deux formes sont
		// vérifiées séparément (docs/SPEC-permissions-rls.md §7, dernier paragraphe).
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	for (const compte of COMPTES_SEED) {
		test(`lignes c et d — ${compte.role} lit les tracks de son workspace`, async ({ request }) => {
			const jeton = await jetonDe(compte.adresse)
			const reponse = await request.get(`${CHEMIN}?select=slug,position&order=position`, {
				headers: enTetesAuthentifies(jeton),
			})

			expect(reponse.status()).toBe(200)
			const lignes = (await reponse.json()) as Track[]
			// Les quatre, archivé compris : c'est le **filtre de la barre latérale** qui masque
			// l'archivé, pas la politique de lecture. Un administrateur doit pouvoir désarchiver.
			expect(lignes).toHaveLength(4)
			// Lire n'exige pas d'écrire : le `viewer` voit exactement ce que voit l'administrateur.
			expect(lignes.map((t) => t.slug)).toEqual([...TRACKS_ACTIFS, TRACK_ARCHIVE])
		})
	}

	test('l’ordre rendu par l’API est celui de `position`, pas celui de l’insertion', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const reponse = await request.get(
			`${CHEMIN}?select=slug,position&archived_at=is.null&order=position,name`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		const lignes = (await reponse.json()) as Track[]
		expect(lignes.map((t) => t.slug)).toEqual(TRACKS_ACTIFS)
		expect(lignes.map((t) => Number(t.position))).toEqual([1, 2, 3])
	})
})

test.describe('T2 — écriture réservée aux administrateurs (lignes e, f, g)', () => {
	for (const compte of COMPTES_SEED.filter((c) => c.role !== 'admin')) {
		test(`lignes e et f — ${compte.role} ne crée aucun track : 403, code 42501`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const slug = `refus-${compte.role.replace(/_/g, '-')}`
			const reponse = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: WORKSPACE_SEED, name: 'Interdit', slug, position: 900 },
			})

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code?: string }).code).toBe('42501')

			// L'échec doit être réel : la ligne ne doit exister nulle part, y compris pour la clé
			// de service. Un `403` rendu après une insertion réussie serait le pire des deux mondes.
			const controle = await request.get(`${CHEMIN}?select=id&slug=eq.${slug}`, {
				headers: enTetesService(),
			})
			expect(await controle.json()).toEqual([])
		})
	}

	test('ligne g — l’administrateur crée un track, et `position` est attribuée', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const slug = 'cree-par-admin'

		// Nettoyage préalable : le scénario doit partir d'un état déterministe, quelle que soit
		// l'issue d'une exécution précédente.
		await request.delete(`${CHEMIN}?slug=eq.${slug}`, { headers: enTetesService() })

		const reponse = await request.post(CHEMIN, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			// `position` volontairement omise : c'est le trigger qui doit la poser.
			data: { workspace_id: WORKSPACE_SEED, name: 'Créé par un administrateur', slug },
		})

		expect(reponse.status()).toBe(201)
		const cree = (await reponse.json()) as Track[]
		expect(cree).toHaveLength(1)
		const track = cree[0] as Track
		// Le seed occupe les positions 1 à 4 : le nouveau track prend la suivante.
		expect(Number(track.position)).toBe(5)
		// Les défauts du modèle sont ceux de la spécification, pas ceux d'un composant.
		expect(track.color).toBe('neutral')
		expect(track.icon).toBe('folder')
		expect(track.archived_at).toBeNull()

		await request.delete(`${CHEMIN}?slug=eq.${slug}`, { headers: enTetesService() })
	})
})

test.describe('T3 — contraintes du modèle vues depuis l’API (ligne h)', () => {
	test('ligne h — un slug déjà pris dans le workspace est refusé : 409, code 23505', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHEMIN, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { workspace_id: WORKSPACE_SEED, name: 'Doublon', slug: TRACKS_ACTIFS[0] },
		})

		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as { code?: string }).code).toBe('23505')
	})

	test('une couleur hexadécimale est refusée par la base, pas seulement par l’interface', async ({
		request,
	}) => {
		// docs/DESIGN_SYSTEM.md §1 : une couleur de donnée est un **nom de jeton**. La règle est
		// opposable en base — un appel direct à l'API ne la contourne pas.
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHEMIN, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workspace_id: WORKSPACE_SEED,
				name: 'Couleur libre',
				slug: 'couleur-libre',
				color: '#23468C',
			},
		})

		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as { code?: string }).code).toBe('23514')

		const controle = await request.get(`${CHEMIN}?select=id&slug=eq.couleur-libre`, {
			headers: enTetesService(),
		})
		expect(await controle.json()).toEqual([])
	})
})

test.describe('T4 — archivage, et absence de suppression physique (lignes i, m)', () => {
	test('ligne m — l’administrateur archive puis désarchive son track', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const cible = `${CHEMIN}?slug=eq.${TRACKS_ACTIFS[2]}&workspace_id=eq.${WORKSPACE_SEED}`

		const archivage = await request.patch(cible, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { archived_at: '2026-08-04T00:00:00Z' },
		})
		expect(archivage.status()).toBe(200)
		expect(((await archivage.json()) as Track[])[0]?.archived_at).not.toBeNull()

		// L'archivage est réversible : c'est une suppression douce, pas une suppression.
		const restauration = await request.patch(cible, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { archived_at: null },
		})
		expect(restauration.status()).toBe(200)
		expect(((await restauration.json()) as Track[])[0]?.archived_at).toBeNull()
	})

	test('ligne i — la suppression physique est refusée, même à un administrateur', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.delete(
			`${CHEMIN}?slug=eq.${TRACKS_ACTIFS[0]}&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesAuthentifies(jeton) },
		)

		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as { code?: string; message?: string }
		expect(corps.code).toBe('42501')
		// Le refus vient du **privilège**, pas d'une politique : aucun `grant delete` n'est posé.
		expect(corps.message).toContain('permission denied')

		// Et le track est toujours là : le refus n'a pas supprimé à moitié.
		const controle = await request.get(`${CHEMIN}?select=id&slug=eq.${TRACKS_ACTIFS[0]}`, {
			headers: enTetesService(),
		})
		expect((await controle.json()) as Track[]).toHaveLength(1)
	})
})

test.describe('T5 — cloisonnement entre workspaces (lignes j, k, l)', () => {
	test('ligne j — PREUVE DE REFUS N° 3 : un membre de A ne voit aucun track de B', async ({
		request,
	}) => {
		const { workspaceId, trackId } = await poserWorkspaceB(request, '00001')
		try {
			// La ligne existe réellement, vue par la clé de service : sans ce constat, le « zéro
			// ligne » ci-dessous ne prouverait rien.
			const constat = await request.get(`${CHEMIN}?select=id&id=eq.${trackId}`, {
				headers: enTetesService(),
			})
			expect((await constat.json()) as Track[]).toHaveLength(1)

			for (const compte of COMPTES_SEED) {
				const jeton = await jetonDe(compte.adresse)
				const reponse = await request.get(`${CHEMIN}?select=*&workspace_id=eq.${workspaceId}`, {
					headers: enTetesAuthentifies(jeton),
				})
				expect(reponse.status(), compte.role).toBe(200)
				expect(await reponse.json(), compte.role).toEqual([])
			}
		} finally {
			await request.delete(`/rest/v1/workspaces?id=eq.${workspaceId}`, {
				headers: enTetesService(),
			})
		}
	})

	test('ligne k — l’administrateur de A ne crée aucun track dans B', async ({ request }) => {
		const { workspaceId } = await poserWorkspaceB(request, '00002')
		try {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: workspaceId, name: 'Intrusion', slug: 'intrusion' },
			})

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code?: string }).code).toBe('42501')
		} finally {
			await request.delete(`/rest/v1/workspaces?id=eq.${workspaceId}`, {
				headers: enTetesService(),
			})
		}
	})

	test('ligne l — le `WITH CHECK` interdit de déplacer un track vers un autre workspace', async ({
		request,
	}) => {
		// C'est le scénario que le `USING` seul aurait laissé passer : la ligne **avant**
		// modification appartient bien à l'appelant (docs/JOURNAL.md décision 52).
		const { workspaceId } = await poserWorkspaceB(request, '00003')
		try {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.patch(
				`${CHEMIN}?slug=eq.${TRACKS_ACTIFS[1]}&workspace_id=eq.${WORKSPACE_SEED}`,
				{
					headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
					data: { workspace_id: workspaceId },
				},
			)

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code?: string }).code).toBe('42501')

			// Le track n'a pas bougé.
			const controle = await request.get(
				`${CHEMIN}?select=workspace_id&slug=eq.${TRACKS_ACTIFS[1]}`,
				{ headers: enTetesService() },
			)
			const lignes = (await controle.json()) as Track[]
			expect(lignes).toHaveLength(1)
			expect(lignes[0]?.workspace_id).toBe(WORKSPACE_SEED)
		} finally {
			await request.delete(`/rest/v1/workspaces?id=eq.${workspaceId}`, {
				headers: enTetesService(),
			})
		}
	})
})

test.describe('T6 — INC-024 : le droit fin ne restreint rien encore', () => {
	// LIMITE FIGÉE PAR UNE ASSERTION, ET NON PAR UN COMMENTAIRE (docs/JOURNAL.md décision 51).
	//
	// La politique de lecture de `CRM-020` s'arrête au rôle de workspace : `app.can_read_track`
	// est différée par INC-013. Ce scénario **constate** l'état réel — un `track_members` posé à
	// `none` ne masque rien — et deviendra rouge le jour où `CRM-012` resserrera la politique.
	test('un `track_members.access = "none"` ne masque pas encore le track', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const trackId = '5eed0000-0000-4000-8000-000000000021'
		const userId = '5eed0000-0000-4000-8000-000000000013'

		await request.post('/rest/v1/track_members', {
			headers: {
				...enTetesService(),
				'Content-Type': 'application/json',
				Prefer: 'resolution=merge-duplicates',
			},
			data: { track_id: trackId, user_id: userId, access: 'none' },
		})

		try {
			const reponse = await request.get(`${CHEMIN}?select=id&id=eq.${trackId}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status()).toBe(200)
			expect((await reponse.json()) as Track[]).toHaveLength(1)
		} finally {
			await request.delete(
				`/rest/v1/track_members?track_id=eq.${trackId}&user_id=eq.${userId}`,
				{ headers: enTetesService() },
			)
		}
	})
})
