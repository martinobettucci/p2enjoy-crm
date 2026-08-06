// @verifies CRM-045 (docs/BACKLOG.md) — déplacement d'une card entre channels, hors interface
// @verifies docs/SPEC-workflow-engine.md §6.2 (valeur de retour), §6.4 (les huit vérifications),
//           §6.5 (effets), §6.6 (réponses de formulaire), §6.7 (l'événement), §6.8 (privilèges),
//           §6.9 (contrat d'API, seize lignes), §6.13 (preuves attendues)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves hors interface, jetons réels ; preuves de
//           refus n° 1 et n° 5)
// @verifies docs/SPEC-cards.md §14.4 (neuf types), §14.6 (payload), §5 (« active »)
// @verifies docs/SPEC-seed.md §2.16 (aller-retour de channel)
// @verifies docs/JOURNAL.md décisions 213 à 218
// @verifies CLAUDE.md §8 (aucune trace fabriquée), §10 (toute règle d'accès se prouve hors
//           interface, avec le jeton réel du profil concerné)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La suite pgTAP prouve les mêmes règles **dans la
// base**, avec `set local role` : elle ne traverse ni PostgREST, ni Kong, ni GoTrue. Or les huit
// refus du §6.4 sont spécifiés avec leur **code HTTP**, et un `SQLSTATE` n'est pas un code HTTP.
// Seule la pile réelle peut établir que `P0001` rend `400`, que `42501` rend `403`, et que le
// même `42501` rend `401` à un appelant sans jeton (§4.4).
//
// IL ÉCRIT, ET IL NETTOIE. Les scénarios *k*, *m* et *n* déplacent réellement des cards du seed ;
// chacun les REND à leur channel d'origine, par la même RPC, de sorte que l'état seedé soit
// inchangé à la fin. Le scénario *m* — la destruction des réponses de formulaire — ne peut PAS
// être rendu : une réponse détruite ne renaît pas. Il opère donc sur une **card d'essai**, créée
// et détruite par ce fichier, dont l'identifiant porte le préfixe `f00d` et jamais `5eed`
// (INC-061, décision 199).

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const RPC = '/rest/v1/rpc/move_card_to_channel'
const CARDS = '/rest/v1/cards'
const EVENEMENTS = '/rest/v1/card_events'
const VALEURS = '/rest/v1/card_field_values'

/** Identifiants du seed, mesurés en base le 2026-08-06 (docs/SPEC-seed.md). */
const CARD_GRANDS_COMPTES = '5eed0000-0000-4000-8000-0000000000c1' // 2 réponses
const CARD_MAINTENANCE = '5eed0000-0000-4000-8000-0000000000c5' // AUCUNE réponse
const CARD_INTER = '5eed0000-0000-4000-8000-0000000000c6' // channel 36, visible du viewer
const CARD_ARCHIVEE = '5eed0000-0000-4000-8000-0000000000c8'
const CARD_CORBEILLE = '5eed0000-0000-4000-8000-0000000000c9'

const CHANNEL_PROSPECTION = '5eed0000-0000-4000-8000-000000000031' // workflow DÉRIVÉ
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const CHANNEL_APPELS_OFFRES = '5eed0000-0000-4000-8000-000000000033'
const CHANNEL_MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'

const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_QUALIFICATION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const ADMIN = '5eed0000-0000-4000-8000-000000000011'

/** Les cards d'essai de ce fichier. Préfixe `f00d`, jamais `5eed` : INC-061 en sens inverse. */
const CARD_ESSAI = 'f00d0000-0000-4000-8000-0000000000e5'
const CARD_ESSAI_L = 'f00d0000-0000-4000-8000-0000000000e6'

/** Un channel qui n'existe pas, et un identifiant de card qui n'existe pas. */
const CHANNEL_FANTOME = '00000000-0000-4000-8000-00000000beef'
const CARD_FANTOME = '00000000-0000-4000-8000-00000000dead'

type Refus = { message?: string; details?: string; code?: string }

test.describe('CRM-045 — le déplacement entre channels, hors interface', () => {
	let jetonAdmin = ''
	let jetonBizdev = ''
	let jetonViewer = ''
	/** Première étape du workflow DÉRIVÉ : tirée au hasard par `copy_workflow_to_track`, donc LUE. */
	let etapeDerivee = ''

	test.beforeAll(async ({ request }) => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')

		const channel = await request.get(
			`${URL_API}/rest/v1/channels?id=eq.${CHANNEL_PROSPECTION}&select=workflow_id`,
			{ headers: enTetesService() },
		)
		const channels = (await channel.json()) as Array<{ workflow_id: string }>
		const derive = channels[0]?.workflow_id
		expect(derive, 'le channel `prospection` ne suit pas un workflow distinct du global').not.toBe(
			WORKFLOW_GLOBAL,
		)
		expect(derive, 'le channel `prospection` est introuvable').toBeTruthy()

		const etapes = await request.get(
			`${URL_API}/rest/v1/workflow_steps?workflow_id=eq.${derive}` +
				'&select=id&order=position.asc&limit=1',
			{ headers: enTetesService() },
		)
		const lignes = (await etapes.json()) as Array<{ id: string }>
		etapeDerivee = lignes[0]?.id ?? ''
		expect(etapeDerivee, 'l’étape initiale du workflow dérivé est introuvable').toBeTruthy()
	})

	test.afterAll(async ({ request }) => {
		for (const essai of [CARD_ESSAI, CARD_ESSAI_L]) {
			await request.delete(`${URL_API}${CARDS}?id=eq.${essai}`, { headers: enTetesService() })
			const reste = await request.get(`${URL_API}${CARDS}?id=eq.${essai}&select=id`, {
				headers: enTetesService(),
			})
			expect(await reste.json(), `la card d’essai ${essai.slice(-2)} n’a pas été nettoyée`)
				.toEqual([])
		}
	})

	/** Crée une card d'essai portant UNE réponse de formulaire réelle, par le vrai chemin. */
	async function cardDEssaiAvecReponse(
		request: import('@playwright/test').APIRequestContext,
		id: string,
	): Promise<void> {
		const creation = await request.post(`${URL_API}${CARDS}`, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				id,
				workspace_id: WORKSPACE,
				channel_id: CHANNEL_GRANDS_COMPTES,
				workflow_id: WORKFLOW_GLOBAL,
				current_step_id: ETAPE_RELANCE,
				title: `Card d’essai CRM-045 ${id.slice(-2)}`,
				created_by: ADMIN,
			},
		})
		expect(creation.status(), await creation.text()).toBe(201)

		// LE CHAMP EST CHOISI PAR SON TYPE, ET NON PRIS AU HASARD — défaut trouvé en exécutant : le
		// premier champ du workflow global est `budget`, de type `money`, et la validation de
		// `CRM-036` refuse à juste titre une chaîne (`invalid_field_value`). Une preuve qui
		// contourne une validation ne prouve rien ; elle lui obéit.
		const champ = await request.get(
			`${URL_API}/rest/v1/form_fields?workflow_id=eq.${WORKFLOW_GLOBAL}` +
				'&type=eq.textarea&select=id&limit=1',
			{ headers: enTetesService() },
		)
		const champs = (await champ.json()) as Array<{ id: string }>
		const champId = champs[0]?.id
		expect(champId, 'aucun champ `textarea` dans le workflow global').toBeTruthy()

		const valeur = await request.post(`${URL_API}${VALEURS}`, {
			headers: enTetesService(),
			data: {
				card_id: id,
				field_id: champId,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE,
				value: '"essai"',
			},
		})
		expect(valeur.status(), await valeur.text()).toBe(201)
	}

	// --- a, b : le privilège, et le cloisonnement ----------------------------------------------

	test('a — sans jeton : 401, et le refus vient du PRIVILÈGE avant toute vérification', async ({
		request,
	}) => {
		// MESURÉ (§4.4) : PostgREST traite l'absence de droit d'un appelant NON AUTHENTIFIÉ comme
		// une invitation à s'authentifier — `401`, non `403`. Le refus est donc double, privilège
		// puis vérification 3.1, et le premier suffit.
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAnonymes(),
			data: { card_id: CARD_GRANDS_COMPTES, to_channel_id: CHANNEL_APPELS_OFFRES },
		})
		expect(reponse.status()).toBe(401)
		expect(((await reponse.json()) as Refus).code).toBe('42501')
	})

	test('b — le viewer, sur une card qu’il ne VOIT pas : card_not_found, jamais forbidden', async ({
		request,
	}) => {
		// La clé de service ÉTABLIT que la card existe avant qu'on affirme qu'elle est introuvable
		// (décision 50). Sans elle, `card_not_found` serait vrai sur une base vide.
		const service = await request.get(
			`${URL_API}${CARDS}?id=eq.${CARD_GRANDS_COMPTES}&select=id`,
			{ headers: enTetesService() },
		)
		expect((await service.json()).length).toBe(1)

		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { card_id: CARD_GRANDS_COMPTES, to_channel_id: CHANNEL_APPELS_OFFRES },
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Refus).message).toBe('card_not_found')
	})

	// --- c : le refus n° 1, sur une card VISIBLE ------------------------------------------------

	test('c — le viewer, sur une card qu’il VOIT : forbidden, 403 — preuve de refus n° 1', async ({
		request,
	}) => {
		// LE MÊME PROFIL que le scénario *b*, et c'est le point : l'écart entre `card_not_found` et
		// `forbidden` vient de la RÈGLE, non du profil.
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { card_id: CARD_INTER, to_channel_id: CHANNEL_APPELS_OFFRES },
		})
		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as Refus
		expect(corps.message).toBe('forbidden')
		expect(corps.code).toBe('42501')
	})

	// --- d, e : la card doit exister et être ACTIVE ---------------------------------------------

	test('d — card inexistante : card_not_found, 400', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_FANTOME, to_channel_id: CHANNEL_APPELS_OFFRES },
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Refus).message).toBe('card_not_found')
	})

	test('e — card archivée, puis card en corbeille : traitées comme ABSENTES', async ({
		request,
	}) => {
		for (const card of [CARD_ARCHIVEE, CARD_CORBEILLE]) {
			const reponse = await request.post(`${URL_API}${RPC}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { card_id: card, to_channel_id: CHANNEL_APPELS_OFFRES },
			})
			expect(reponse.status(), `card ${card.slice(-2)}`).toBe(400)
			expect(((await reponse.json()) as Refus).message).toBe('card_not_found')
		}
	})

	// --- f, g : le channel cible ----------------------------------------------------------------

	test('f — channel cible inexistant : channel_not_found, et non forbidden', async ({
		request,
	}) => {
		// Sans cette règle la fonction serait un ORACLE D'EXISTENCE de channels, interrogeable
		// identifiant par identifiant par quiconque possède une card à déplacer (§6.4).
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_GRANDS_COMPTES, to_channel_id: CHANNEL_FANTOME },
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Refus).message).toBe('channel_not_found')
	})

	test('g — droit d’écriture exigé sur le channel CIBLE aussi', async ({ request }) => {
		// Le bizdev ÉCRIT sur `inter-entreprises` (36) et est rétrogradé en LECTURE sur
		// `maintenance` (35) par un droit fin de channel. Il sort donc la card de 36 et ne peut pas
		// la poser dans 35 : rien d'autre que la vérification n° 4 ne produit ce refus.
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { card_id: CARD_INTER, to_channel_id: CHANNEL_MAINTENANCE },
		})
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Refus).message).toBe('forbidden')
	})

	// --- h, i, j : les vérifications de forme ---------------------------------------------------

	test('h — channel cible = channel courant : same_channel', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_GRANDS_COMPTES, to_channel_id: CHANNEL_GRANDS_COMPTES },
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Refus).message).toBe('same_channel')
	})

	test('i — workflow différent et to_step_id nul : step_mapping_required', async ({ request }) => {
		// LE « REMAPPAGE OBLIGATOIRE » DE LA DEFINITION OF DONE. La fonction ne choisit AUCUNE étape
		// par défaut, bien que les deux workflows du seed portent les sept mêmes nœuds.
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_MAINTENANCE, to_channel_id: CHANNEL_PROSPECTION },
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Refus).message).toBe('step_mapping_required')
	})

	test('j — étape d’un AUTRE workflow : step_not_in_workflow', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				card_id: CARD_MAINTENANCE,
				to_channel_id: CHANNEL_PROSPECTION,
				to_step_id: ETAPE_QUALIFICATION,
			},
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Refus).message).toBe('step_not_in_workflow')
	})

	// --- k, l : les réponses de formulaire ------------------------------------------------------

	test('k — réponses présentes et discard faux : field_values_would_be_lost, refus CHIFFRÉ', async ({
		request,
	}) => {
		const service = await request.get(
			`${URL_API}${VALEURS}?card_id=eq.${CARD_GRANDS_COMPTES}&select=field_id`,
			{ headers: enTetesService() },
		)
		const nombre = ((await service.json()) as unknown[]).length
		expect(nombre, 'la card d’appui ne porte aucune réponse : le scénario ne prouverait rien')
			.toBeGreaterThan(0)

		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				card_id: CARD_GRANDS_COMPTES,
				to_channel_id: CHANNEL_PROSPECTION,
				to_step_id: etapeDerivee,
			},
		})
		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as Refus
		expect(corps.message).toBe('field_values_would_be_lost')
		// LE REFUS PORTE LE NOMBRE, et ce n'est pas décoratif : l'appelant doit savoir ce qu'il
		// s'apprête à détruire avant de poser `discard_field_values` (décision 216).
		expect(corps.details).toContain(String(nombre))

		// Et RIEN n'a bougé : le refus est un refus, pas une destruction suivie d'une erreur.
		const apres = await request.get(
			`${URL_API}${VALEURS}?card_id=eq.${CARD_GRANDS_COMPTES}&select=field_id`,
			{ headers: enTetesService() },
		)
		expect(((await apres.json()) as unknown[]).length).toBe(nombre)
	})

	test('l — workflow IDENTIQUE : étape conservée, réponses CONSERVÉES', async ({ request }) => {
		// SUR UNE CARD D'ESSAI, ET NON SUR LE SEED — GARDE-FOU DE `CRM-034` DÉCLENCHÉ, ET IL AVAIT
		// RAISON. Ce scénario opérait d'abord un aller-retour sur `…0c1`, et
		// `e2e/api/move-card.spec.ts` a échoué : il asserte que le rang maximal de la colonne
		// `(grands-comptes, relance)` vaut 2, et il valait 3.
		//
		// LE MOTIF N'EST PAS UN DÉFAUT DU PRODUIT, C'EST LE PRODUIT. `position` est TOUJOURS
		// recalculée en fin de colonne d'arrivée (§6.5) : un aller-retour rend le channel, le
		// workflow et l'étape, jamais le rang. C'est la limite que `CRM-044` nommait déjà pour
		// `move_card` (docs/SPEC-cards.md §14.11), et elle vaut ici pour la même raison.
		//
		// Une preuve qui perturbe l'état seedé rend une autre preuve DÉPENDANTE DE L'ORDRE
		// D'EXÉCUTION. Elle opère donc sur une card qu'elle crée et qu'elle détruit.
		await cardDEssaiAvecReponse(request, CARD_ESSAI_L)

		const avant = await request.get(
			`${URL_API}${CARDS}?id=eq.${CARD_ESSAI_L}&select=current_step_id,entered_step_at`,
			{ headers: enTetesService() },
		)
		const etatsAvant = (await avant.json()) as Array<{
			current_step_id: string
			entered_step_at: string
		}>
		const etatAvant = etatsAvant[0]
		expect(etatAvant, 'la card d’essai n’a pas été relue').toBeDefined()
		if (!etatAvant) return

		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_ESSAI_L, to_channel_id: CHANNEL_APPELS_OFFRES },
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		const card = (await reponse.json()) as {
			channel_id: string
			current_step_id: string
			entered_step_at: string
		}
		expect(card.channel_id).toBe(CHANNEL_APPELS_OFFRES)
		expect(card.current_step_id, 'l’étape devait être CONSERVÉE').toBe(etatAvant.current_step_id)
		// DÉCISION 217 : à étape constante, l'horodatage d'entrée n'est PAS réécrit. Un changement
		// de dossier ne fait entrer la card nulle part.
		expect(card.entered_step_at, '`entered_step_at` a été réécrite sans changement d’étape').toBe(
			etatAvant.entered_step_at,
		)

		// LA VÉRIFICATION N° 8 NE S'APPLIQUE PAS À WORKFLOW IDENTIQUE : la card portait une réponse,
		// `discard_field_values` valait `false`, et le déplacement est passé sans rien détruire.
		const valeurs = await request.get(`${URL_API}${VALEURS}?card_id=eq.${CARD_ESSAI_L}&select=field_id`, {
			headers: enTetesService(),
		})
		expect(((await valeurs.json()) as unknown[]).length, 'les réponses ont été détruites à tort')
			.toBe(1)

		await request.delete(`${URL_API}${CARDS}?id=eq.${CARD_ESSAI_L}`, { headers: enTetesService() })
	})

	// --- m : la destruction assumée, sur une card d'essai ---------------------------------------

	test('m — discard vrai : les réponses sont DÉTRUITES, la mémoire SURVIT', async ({ request }) => {
		// SUR UNE CARD D'ESSAI, et non sur le seed : une réponse détruite ne renaît pas au retour,
		// et le seed cesserait d'être convergent (docs/SPEC-seed.md §2.16).
		await cardDEssaiAvecReponse(request, CARD_ESSAI)

		const traces = await request.get(
			`${URL_API}${EVENEMENTS}?card_id=eq.${CARD_ESSAI}&type=eq.field_changed&select=id`,
			{ headers: enTetesService() },
		)
		const nombreTraces = ((await traces.json()) as unknown[]).length
		expect(nombreTraces, 'aucun `field_changed` n’a été produit').toBeGreaterThan(0)

		const deplacement = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				card_id: CARD_ESSAI,
				to_channel_id: CHANNEL_PROSPECTION,
				to_step_id: etapeDerivee,
				discard_field_values: true,
			},
		})
		expect(deplacement.status(), await deplacement.text()).toBe(200)

		const restantes = await request.get(
			`${URL_API}${VALEURS}?card_id=eq.${CARD_ESSAI}&select=field_id`,
			{ headers: enTetesService() },
		)
		expect(await restantes.json(), 'les réponses n’ont pas été détruites').toEqual([])

		// LA MÉMOIRE SURVIT À LA DONNÉE : la suppression porte sur `card_field_values`, jamais sur
		// `card_events` — que rien ne peut supprimer (§6.6).
		const apres = await request.get(
			`${URL_API}${EVENEMENTS}?card_id=eq.${CARD_ESSAI}&type=eq.field_changed&select=id`,
			{ headers: enTetesService() },
		)
		expect(
			((await apres.json()) as unknown[]).length,
			'les `field_changed` ont disparu avec les réponses',
		).toBe(nombreTraces)

		// LA CARD D'ESSAI EST RETIRÉE ICI, ET NON SEULEMENT DANS `afterAll` — défaut trouvé en
		// exécutant : elle repose désormais dans `prospection`, et le scénario *q* y vérifie
		// qu'aucune card ne demeure. Un nettoyage différé aurait fait échouer une assertion vraie.
		// `afterAll` le refait, et le constate : supprimer deux fois est sans effet.
		await request.delete(`${URL_API}${CARDS}?id=eq.${CARD_ESSAI}`, { headers: enTetesService() })
	})

	// --- n, p : le succès, ses effets, et l'événement --------------------------------------------

	test('n — succès : objet JSON UNIQUE, trois colonnes à jour, et retour', async ({ request }) => {
		const aller = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				card_id: CARD_MAINTENANCE,
				to_channel_id: CHANNEL_PROSPECTION,
				to_step_id: etapeDerivee,
			},
		})
		expect(aller.status()).toBe(200)

		const card = await aller.json()
		// MESURÉ : une fonction rendant un type composite est rendue par PostgREST comme un OBJET,
		// non comme un tableau — le client obtient tout en une requête, sans relecture (§6.2).
		expect(Array.isArray(card), 'PostgREST a rendu un tableau, non un objet').toBe(false)
		expect(card.channel_id).toBe(CHANNEL_PROSPECTION)
		expect(card.current_step_id).toBe(etapeDerivee)
		expect(card.workflow_id, 'le workflow doit être DÉRIVÉ du channel, jamais fourni').not.toBe(
			WORKFLOW_GLOBAL,
		)

		const retour = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				card_id: CARD_MAINTENANCE,
				to_channel_id: CHANNEL_MAINTENANCE,
				to_step_id: ETAPE_QUALIFICATION,
			},
		})
		expect(retour.status()).toBe(200)
		const rendue = (await retour.json()) as { channel_id: string; workflow_id: string }
		expect(rendue.channel_id).toBe(CHANNEL_MAINTENANCE)
		expect(rendue.workflow_id).toBe(WORKFLOW_GLOBAL)
	})

	test('p — un channel_changed de plus, AUCUN moved, et six clés de payload', async ({
		request,
	}) => {
		const lire = async (type: string) => {
			const reponse = await request.get(
				`${URL_API}${EVENEMENTS}?card_id=eq.${CARD_MAINTENANCE}&type=eq.${type}` +
					'&select=payload,actor_id&order=created_at.desc',
				{ headers: enTetesService() },
			)
			return (await reponse.json()) as Array<{
				payload: Record<string, unknown>
				actor_id: string | null
			}>
		}

		const avant = (await lire('channel_changed')).length
		const movedAvant = (await lire('moved')).length

		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				card_id: CARD_MAINTENANCE,
				to_channel_id: CHANNEL_APPELS_OFFRES,
				to_step_id: ETAPE_RELANCE,
			},
		})
		expect(reponse.status()).toBe(200)

		const apres = await lire('channel_changed')
		expect(apres.length, 'aucun `channel_changed` n’a été écrit').toBe(avant + 1)

		// LE CŒUR DE LA DÉCISION 215 : la card a changé d'ÉTAPE en même temps que de channel, et
		// aucun `moved` n'est né. `moved` signifie « la card a franchi une arête du graphe » ; elle
		// n'en a franchi aucune.
		expect((await lire('moved')).length, 'un `moved` parasite accompagne le déplacement').toBe(
			movedAvant,
		)

		const dernier = apres[0]
		expect(dernier, 'le dernier `channel_changed` est introuvable').toBeDefined()
		if (!dernier) return
		const { payload, actor_id } = dernier
		expect(Object.keys(payload).sort()).toEqual([
			'from_channel_id',
			'from_step_id',
			'from_workflow_id',
			'to_channel_id',
			'to_step_id',
			'to_workflow_id',
		])
		expect(payload.from_channel_id).toBe(CHANNEL_MAINTENANCE)
		expect(payload.to_channel_id).toBe(CHANNEL_APPELS_OFFRES)
		expect(payload.from_step_id).toBe(ETAPE_QUALIFICATION)
		expect(payload.to_step_id).toBe(ETAPE_RELANCE)
		// L'ACTEUR EST UN PROFIL RÉEL : l'appel passe par le jeton de l'administratrice, et
		// `auth.uid()` le rend malgré le `SECURITY DEFINER` (décision 206).
		expect(actor_id, 'l’acteur du déplacement n’est pas nommé').toBe(ADMIN)

		// Retour, pour que l'état du seed soit inchangé.
		const retour = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				card_id: CARD_MAINTENANCE,
				to_channel_id: CHANNEL_MAINTENANCE,
				to_step_id: ETAPE_QUALIFICATION,
			},
		})
		expect(retour.status()).toBe(200)
	})

	// --- o : la garde n'est pas contournable — preuve de refus n° 5 ------------------------------

	test('o — PATCH direct de cards.channel_id par authenticated : 403, la garde tient', async ({
		request,
	}) => {
		// **PREUVE DE REFUS N° 5** de docs/SPEC-permissions-rls.md §7, reconduite sur `channel_id`.
		// LE POINT DE LA DÉCISION 214 : ce refus ne vient PAS de cette unité. `CRM-013` avait fermé
		// la colonne « par voie de conséquence », et la garde était donc close avant d'exister.
		const reponse = await request.patch(
			`${URL_API}${CARDS}?id=eq.${CARD_MAINTENANCE}`,
			{
				headers: enTetesAuthentifies(jetonAdmin),
				data: { channel_id: CHANNEL_APPELS_OFFRES },
			},
		)
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Refus).code).toBe('42501')

		// Et la ligne est relue INCHANGÉE : le refus n'est pas seulement un code de retour.
		const relue = await request.get(
			`${URL_API}${CARDS}?id=eq.${CARD_MAINTENANCE}&select=channel_id`,
			{ headers: enTetesService() },
		)
		const lignes = (await relue.json()) as Array<{ channel_id: string }>
		expect(lignes[0]?.channel_id).toBe(CHANNEL_MAINTENANCE)
	})

	test('o bis — le même PATCH sur workflow_id : refusé lui aussi', async ({ request }) => {
		const reponse = await request.patch(`${URL_API}${CARDS}?id=eq.${CARD_MAINTENANCE}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workflow_id: WORKFLOW_GLOBAL },
		})
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Refus).code).toBe('42501')
	})

	// --- q : le seed, et ce qu'il démontre ------------------------------------------------------

	// RÉVISÉ PAR `CRM-046` (décision 51), ET LE GARDE-FOU TOURNE AU LIEU DE DISPARAÎTRE.
	//
	// `CRM-045` figeait ici « `prospection` reste VIDE au repos » : c'était la conséquence mesurée
	// d'INC-046, le seed y repointant le workflow deux fois par exécution. `CRM-046` a cessé ces
	// écritures — convergence par état, décision 221 — et y a posé deux cards sur le workflow
	// DÉRIVÉ (docs/SPEC-seed.md §9.2 et §9.3).
	//
	// INC-046 N'EST PAS LEVÉE, et ce qui la prouve n'est plus un vide : c'est le REFUS opposé au
	// geste qu'elle interdit, mesuré ci-dessous en `409`. Une assertion de refus prouve la règle ;
	// une assertion de vide ne prouvait que l'absence d'occasion de l'enfreindre.
	test('q — le seed a produit deux channel_changed, et `prospection` porte ses deux cards dérivées', async ({
		request,
	}) => {
		const evenements = await request.get(
			`${URL_API}${EVENEMENTS}?card_id=eq.${CARD_MAINTENANCE}&type=eq.channel_changed&select=id`,
			{ headers: enTetesService() },
		)
		expect(
			((await evenements.json()) as unknown[]).length,
			'l’aller-retour du seed n’a pas eu lieu',
		).toBeGreaterThanOrEqual(2)

		const restantes = await request.get(
			`${URL_API}${CARDS}?channel_id=eq.${CHANNEL_PROSPECTION}&select=id,workflow_id`,
			{ headers: enTetesService() },
		)
		const cards = (await restantes.json()) as { id: string; workflow_id: string }[]
		expect(cards.length, '`prospection` porte les deux cards du §9.3').toBe(2)

		// Elles suivent le workflow de leur channel — la lecture n° 1 d'INC-046 — et ce workflow est
		// bien la COPIE, jamais le global.
		const channel = await request.get(
			`${URL_API}/rest/v1/channels?id=eq.${CHANNEL_PROSPECTION}&select=workflow_id`,
			{ headers: enTetesService() },
		)
		const workflowDuChannel = ((await channel.json()) as { workflow_id: string }[])[0]!.workflow_id
		expect(cards.every((carte) => carte.workflow_id === workflowDuChannel)).toBe(true)
		expect(workflowDuChannel).not.toBe(WORKFLOW_GLOBAL)

		// LA PREUVE QUE LA RÈGLE TIENT : le geste qu'INC-046 interdit est refusé, ici et maintenant.
		const interdit = await request.patch(
			`${URL_API}/rest/v1/channels?id=eq.${CHANNEL_PROSPECTION}`,
			{ headers: enTetesService(), data: { workflow_id: WORKFLOW_GLOBAL } },
		)
		expect(
			interdit.status(),
			'déplacer le workflow d’un channel peuplé reste refusé — INC-046',
		).toBe(409)
	})
})
