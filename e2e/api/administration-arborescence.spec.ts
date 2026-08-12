// @verifies CRM-075 (docs/BACKLOG.md) — administration des tracks et des channels, refus hors interface
// @verifies docs/SPEC-administration-arborescence.md §9 (« un PATCH qui rend 200 et zéro ligne
//           n'est ni un succès ni une erreur »), §10 (« le refus reste prouvé hors interface, avec
//           les jetons réels du viewer et du business_developer »), §12 (preuves attendues)
// @verifies docs/SPEC-tracks.md §6 lignes e, f ; docs/SPEC-channels.md §7 lignes e, f
// @verifies docs/SPEC-permissions-rls.md §4 (écriture réservée à l'administrateur), §7
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// CE FICHIER NE PROUVE AUCUNE RÈGLE NOUVELLE (docs/SPEC-administration-arborescence.md §1) : la
// réserve d'écriture aux administrateurs est déjà posée et mesurée par `CRM-020` et `CRM-021`.
// Ce qu'il ajoute est la couverture des HUIT écritures que `AdministrationArborescence.tsx` envoie
// réellement — création, renommage, déplacement, archivage, pour un track puis pour un channel —
// plutôt que la seule création que `tracks.spec.ts` et `channels.spec.ts` exercent déjà pour un
// non-administrateur.
//
// DEUX FORMES DE REFUS, MESURÉES ICI PLUTÔT QUE SUPPOSÉES (CLAUDE.md §1) — et elles ne se
// ressemblent PAS :
//
//   1. Une CRÉATION porte une ligne qui n'existe pas encore : `WITH CHECK` échoue à l'insertion et
//      PostgREST lève une erreur, `403` / `42501` (mesuré par une première rédaction de ce fichier,
//      qui l'attendait aussi pour les trois autres écritures — à tort).
//   2. Un RENOMMAGE, un DÉPLACEMENT ou un ARCHIVAGE portent sur une ligne qui existe déjà : la
//      politique `USING` de `tracks`/`channels` (migration `0003`, ligne 271) la rend simplement
//      INVISIBLE au `UPDATE` d'un non-administrateur. PostgREST ne trouve alors aucune ligne à
//      modifier — ni erreur, ni statut `4xx` : `200` (avec `Prefer: return=representation`) et un
//      corps VIDE. C'est exactement l'état « sans-effet » que `docs/SPEC-administration-arborescence.md`
//      §9 nomme, et que `webapp/src/lib/administration-arborescence.ts` (`executer`) classe à part de
//      `forbidden` — l'écran affiche alors `admin.refus.sans-effet`, pas un message de droit refusé.
//      La première version de ce fichier attendait `403` pour les trois `UPDATE` : rejouée contre la
//      pile réelle, elle a échoué sur les douze scénarios concernés — la preuve que CLAUDE.md §1
//      demande de ne jamais tenir une hypothèse pour un fait vérifié.
//
// Ces scénarios exercent le backend SANS PASSER PAR L'INTERFACE, avec les jetons réels des deux
// profils non administrateurs du seed, obtenus par la véritable route de connexion. Aucun
// navigateur n'est lancé. Ils ne prouvent jamais un refus avec la clé de service : elle contourne
// la RLS et ne sert qu'à constater l'état de la base avant et après chaque tentative.

import { expect, test } from '@playwright/test'
import { COMPTES_SEED, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Le workflow global par défaut du seed (`docs/SPEC-seed.md` §2.9). */
const WORKFLOW_SEED = '5eed0000-0000-4000-8000-000000000051'

/** Le track « Formation », choisi parce qu'aucun autre scénario de ce dossier ne le modifie. */
const TRACK_FORMATION = '5eed0000-0000-4000-8000-000000000023'
const TRACK_FORMATION_SLUG = 'formation'

/** Le track « Conseil & IA », requis comme parent pour une tentative de création de channel. */
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'

/** Le channel « Inter-entreprises » (track Formation), inutilisé par les autres suites. */
const CHANNEL_INTER_ENTREPRISES = '5eed0000-0000-4000-8000-000000000036'
const CHANNEL_INTER_ENTREPRISES_SLUG = 'inter-entreprises'

const CHEMIN_TRACKS = '/rest/v1/tracks'
const CHEMIN_CHANNELS = '/rest/v1/channels'

const NON_ADMINISTRATEURS = COMPTES_SEED.filter((compte) => compte.role !== 'admin')

type Ligne = Record<string, unknown>

/** Relit une ligne par la clé de service, pour constater qu'une tentative refusée n'a rien changé. */
async function relire(
	requete: import('@playwright/test').APIRequestContext,
	chemin: string,
	id: string,
): Promise<Ligne> {
	const reponse = await requete.get(`${chemin}?select=*&id=eq.${id}`, { headers: enTetesService() })
	const lignes = (await reponse.json()) as Ligne[]
	expect(lignes, `la ligne ${id} doit exister dans ${chemin}`).toHaveLength(1)
	return lignes[0] as Ligne
}

/**
 * Envoie le `PATCH` exactement comme `webapp/src/lib/administration-arborescence.ts` le fait —
 * `.select('id')`, donc `Prefer: return=representation` — seul moyen de distinguer « une ligne
 * modifiée » de « zéro ligne modifiée » : sans lui, PostgREST rend `204` dans les deux cas.
 */
async function patcherSansDroit(
	requete: import('@playwright/test').APIRequestContext,
	chemin: string,
	id: string,
	jeton: string,
	donnees: Record<string, unknown>,
) {
	return requete.patch(`${chemin}?id=eq.${id}`, {
		headers: {
			...enTetesAuthentifies(jeton),
			'Content-Type': 'application/json',
			Prefer: 'return=representation',
		},
		data: donnees,
	})
}

for (const compte of NON_ADMINISTRATEURS) {
	test.describe(`${compte.role} — les huit écritures de l'administration de l'arborescence sont refusées`, () => {
		test(`creerTrack — POST ${CHEMIN_TRACKS} : 403, code 42501, aucune ligne créée`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const slug = `refus-arbo-track-${compte.role.replace(/_/g, '-')}`
			// Nettoyage préalable : une exécution précédente interrompue ne doit pas fausser celle-ci.
			await request.delete(`${CHEMIN_TRACKS}?slug=eq.${slug}`, { headers: enTetesService() })

			const reponse = await request.post(CHEMIN_TRACKS, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: WORKSPACE_SEED, name: 'Refusé', slug },
			})

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code?: string }).code).toBe('42501')

			const controle = await request.get(`${CHEMIN_TRACKS}?select=id&slug=eq.${slug}`, {
				headers: enTetesService(),
			})
			expect(await controle.json()).toEqual([])
		})

		test(`modifierTrack — PATCH ${CHEMIN_TRACKS} (nom) : 200, zéro ligne, ligne inchangée (§9 « sans-effet »)`, async ({
			request,
		}) => {
			const avant = await relire(request, CHEMIN_TRACKS, TRACK_FORMATION)
			const jeton = await jetonDe(compte.adresse)

			const reponse = await patcherSansDroit(request, CHEMIN_TRACKS, TRACK_FORMATION, jeton, {
				name: 'Renommé sans droit',
				color: 'danger',
			})

			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])

			const apres = await relire(request, CHEMIN_TRACKS, TRACK_FORMATION)
			expect(apres.name).toBe(avant.name)
			expect(apres.color).toBe(avant.color)
			expect(avant.slug).toBe(TRACK_FORMATION_SLUG)
		})

		test(`deplacerTrack — PATCH ${CHEMIN_TRACKS} (position) : 200, zéro ligne, position inchangée`, async ({
			request,
		}) => {
			const avant = await relire(request, CHEMIN_TRACKS, TRACK_FORMATION)
			const jeton = await jetonDe(compte.adresse)

			const reponse = await patcherSansDroit(request, CHEMIN_TRACKS, TRACK_FORMATION, jeton, {
				position: 0.5,
			})

			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])

			const apres = await relire(request, CHEMIN_TRACKS, TRACK_FORMATION)
			expect(Number(apres.position)).toBe(Number(avant.position))
		})

		test(`archiverTrack — PATCH ${CHEMIN_TRACKS} (archived_at) : 200, zéro ligne, non archivé`, async ({
			request,
		}) => {
			const avant = await relire(request, CHEMIN_TRACKS, TRACK_FORMATION)
			expect(avant.archived_at, 'le track témoin doit rester actif entre deux exécutions').toBeNull()
			const jeton = await jetonDe(compte.adresse)

			const reponse = await patcherSansDroit(request, CHEMIN_TRACKS, TRACK_FORMATION, jeton, {
				archived_at: '2026-08-12T00:00:00Z',
			})

			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])

			const apres = await relire(request, CHEMIN_TRACKS, TRACK_FORMATION)
			expect(apres.archived_at).toBeNull()
		})

		test(`creerChannel — POST ${CHEMIN_CHANNELS} : 403, code 42501, aucune ligne créée`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const slug = `refus-arbo-canal-${compte.role.replace(/_/g, '-')}`
			await request.delete(`${CHEMIN_CHANNELS}?slug=eq.${slug}`, { headers: enTetesService() })

			const reponse = await request.post(CHEMIN_CHANNELS, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: {
					workspace_id: WORKSPACE_SEED,
					track_id: TRACK_CONSEIL,
					workflow_id: WORKFLOW_SEED,
					name: 'Refusé',
					slug,
				},
			})

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code?: string }).code).toBe('42501')

			const controle = await request.get(`${CHEMIN_CHANNELS}?select=id&slug=eq.${slug}`, {
				headers: enTetesService(),
			})
			expect(await controle.json()).toEqual([])
		})

		test(`modifierChannel — PATCH ${CHEMIN_CHANNELS} (nom, workflow) : 200, zéro ligne, ligne inchangée`, async ({
			request,
		}) => {
			const avant = await relire(request, CHEMIN_CHANNELS, CHANNEL_INTER_ENTREPRISES)
			const jeton = await jetonDe(compte.adresse)

			const reponse = await patcherSansDroit(
				request,
				CHEMIN_CHANNELS,
				CHANNEL_INTER_ENTREPRISES,
				jeton,
				{ name: 'Renommé sans droit', workflow_id: WORKFLOW_SEED },
			)

			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])

			const apres = await relire(request, CHEMIN_CHANNELS, CHANNEL_INTER_ENTREPRISES)
			expect(apres.name).toBe(avant.name)
			expect(avant.slug).toBe(CHANNEL_INTER_ENTREPRISES_SLUG)
		})

		test(`deplacerChannel — PATCH ${CHEMIN_CHANNELS} (position) : 200, zéro ligne, position inchangée`, async ({
			request,
		}) => {
			const avant = await relire(request, CHEMIN_CHANNELS, CHANNEL_INTER_ENTREPRISES)
			const jeton = await jetonDe(compte.adresse)

			const reponse = await patcherSansDroit(
				request,
				CHEMIN_CHANNELS,
				CHANNEL_INTER_ENTREPRISES,
				jeton,
				{ position: 0.5 },
			)

			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])

			const apres = await relire(request, CHEMIN_CHANNELS, CHANNEL_INTER_ENTREPRISES)
			expect(Number(apres.position)).toBe(Number(avant.position))
		})

		test(`archiverChannel — PATCH ${CHEMIN_CHANNELS} (archived_at) : 200, zéro ligne, non archivé`, async ({
			request,
		}) => {
			const avant = await relire(request, CHEMIN_CHANNELS, CHANNEL_INTER_ENTREPRISES)
			expect(
				avant.archived_at,
				'le channel témoin doit rester actif entre deux exécutions',
			).toBeNull()
			const jeton = await jetonDe(compte.adresse)

			const reponse = await patcherSansDroit(
				request,
				CHEMIN_CHANNELS,
				CHANNEL_INTER_ENTREPRISES,
				jeton,
				{ archived_at: '2026-08-12T00:00:00Z' },
			)

			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])

			const apres = await relire(request, CHEMIN_CHANNELS, CHANNEL_INTER_ENTREPRISES)
			expect(apres.archived_at).toBeNull()
		})
	})
}
