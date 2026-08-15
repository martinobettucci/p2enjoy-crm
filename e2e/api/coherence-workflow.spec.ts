// @verifies CRM-033 (docs/BACKLOG.md) — cohérence workflow ↔ channel, hors interface
// @verifies docs/SPEC-workflow-engine.md §4.12.6 (contrat d'API, lignes a à m), §4.12.3 (trigger
//           sur channels), §4.12.4 (trigger sur workflows), §4.12.5 (NOT NULL), §4.12.7 (seed)
// @verifies docs/SPEC-channels.md §2.5 (l'écart d'INC-029, soldé)
// @verifies docs/SPEC-permissions-rls.md §7 (la règle s'ajoute aux autorisations, ne les remplace pas)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies docs/INCONSISTENCY_REPORT.md INC-029 (soldée), INC-040 (les deux portes oubliées)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé — et pour
// cause : cette unité ne livre aucun écran (INC-021).
//
// Ils reprennent une à une les treize lignes du tableau de `docs/SPEC-workflow-engine.md` §4.12.6,
// écrit **avant** le code à partir des quatre écritures mesurées sur la base du seed.
//
// TROIS PIÈGES, dont deux hérités et un propre à cette unité :
//
//   * une écriture refusée par la clause `USING` d'une politique ne produit **aucune erreur** :
//     PostgREST rend `200` ou `204` et ne modifie rien. Tout refus d'autorisation relit donc la
//     ligne et la constate **inchangée** (décision 70) ;
//   * un « zéro ligne » sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout.
//     L'état est d'abord constaté avec la clé de service, qui ne sert **jamais** à prouver un
//     refus (décision 50) ;
//   * propre à `CRM-033` : chaque scénario qui déplace un channel ou un workflow **remet l'état du
//     seed** dans un `finally`. Sans cela, un scénario en échec laisserait la base dans un état que
//     les suivants prendraient pour le contrat, et les preuves suivantes seraient vraies pour la
//     mauvaise raison.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Le workflow global par défaut, et les tracks du seed (`docs/SPEC-seed.md` §2). */
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const WORKFLOW_COPIE_NOM = 'Cycle commercial — Conseil IA'
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'

/** `prospection` est du track « Conseil & IA » et suit la copie de portée `track` (§4.12.7). */
const CHANNEL_PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
/** `refonte` est du track « Studio web » et suit le workflow global. */
const CHANNEL_REFONTE = '5eed0000-0000-4000-8000-000000000034'

const CHANNELS = '/rest/v1/channels'
const WORKFLOWS = '/rest/v1/workflows'

type Channel = { id: string; track_id: string; workflow_id: string | null }
type Workflow = { id: string; scope: string; track_id: string | null }

type Erreur = { code: string; message: string }

/**
 * L'identifiant de la copie de portée `track` posée par le seed.
 *
 * Il n'est **pas stable** : `copy_workflow_to_track` le frappe, et le rendre stable supposerait un
 * paramètre ajouté pour le seul confort du seed (`docs/SPEC-seed.md` §2.9). La copie se retrouve
 * donc par sa dérivation et son nom seedé. Une copie utilisateur supplémentaire est légitime et
 * ne doit pas rendre ce résolveur ambigu (docs/JOURNAL.md, décision 300).
 */
async function copieDuSeed(requete: APIRequestContext): Promise<Workflow> {
	const nom = encodeURIComponent(WORKFLOW_COPIE_NOM)
	const reponse = await requete.get(
		`${WORKFLOWS}?select=id,scope,track_id&derived_from_workflow_id=eq.${WORKFLOW_GLOBAL}&name=eq.${nom}`,
		{ headers: enTetesService() },
	)
	expect(reponse.status(), 'la copie du seed doit être lisible').toBe(200)
	const lignes = (await reponse.json()) as Workflow[]
	expect(lignes, 'le nom seedé doit désigner exactement sa copie').toHaveLength(1)
	return lignes[0]!
}

/** Remet un channel dans l'état déclaré par le seed. Seule la clé de service en a le privilège. */
/**
 * UN CHANNEL JETABLE, ET LE MOTIF EST `CRM-046`.
 *
 * Trois scénarios de cette suite déplaçaient le workflow de `prospection` : c'était possible tant
 * que ce channel était **vide**. `CRM-046` y a posé deux cards pour que le workflow dérivé cesse
 * d'être inexercé et que la route ne rende plus un board sans colonne peuplée
 * (docs/SPEC-seed.md §9.3), et la clé étrangère composite refuse désormais ce déplacement en `409`
 * — c'est INC-046, et elle doit refuser.
 *
 * LE DÉFAUT N'ÉTAIT PAS SEULEMENT UN ROUGE. La ligne b appelait `remettreChannel` **sans rien
 * asserter** avant son écriture utile : le retour au workflow global échouait en silence, et
 * l'assertion suivante réaffectait une valeur déjà en place. Elle serait restée VERTE sans plus
 * rien prouver. Mesuré en exécutant.
 *
 * Les scénarios opèrent donc sur un channel qu'ils créent et détruisent, vide par construction —
 * même remède que celui appliqué au scénario *l* de `e2e/api/move-card.spec.ts` à `CRM-045`.
 */
const CHANNEL_JETABLE = '5eed0000-0000-4000-8000-0000000000f1'

async function creerChannelJetable(
	requete: APIRequestContext,
	trackId: string,
	workflowId: string,
): Promise<string> {
	const reponse = await requete.post(CHANNELS, {
		headers: {
			...enTetesService(),
			'Content-Type': 'application/json',
			Prefer: 'return=representation,resolution=merge-duplicates',
		},
		data: {
			id: CHANNEL_JETABLE,
			workspace_id: WORKSPACE_SEED,
			track_id: trackId,
			name: 'Channel jetable — cohérence workflow',
			slug: 'jetable-coherence',
			workflow_id: workflowId,
			position: 99,
			archived_at: null,
		},
	})
	expect(reponse.status(), 'le channel jetable doit naître').toBeLessThan(300)
	return CHANNEL_JETABLE
}

async function detruireChannelJetable(requete: APIRequestContext): Promise<void> {
	await requete.delete(`${CHANNELS}?id=eq.${CHANNEL_JETABLE}`, { headers: enTetesService() })
}

async function remettreChannel(
	requete: APIRequestContext,
	id: string,
	trackId: string,
	workflowId: string,
): Promise<void> {
	// L'ordre compte : le workflow d'abord si le channel revient vers un global, le track ensuite.
	// Écrire les deux en une seule requête laisse le trigger juger l'état résultant, ce qui est
	// exactement ce qu'on lui demande.
	await requete.patch(`${CHANNELS}?id=eq.${id}`, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { track_id: trackId, workflow_id: workflowId },
	})
}

test.describe('K0 — le seed est dans l’état que le §4.12.7 déclare', () => {
	// Condition de validité de tout ce qui suit (décision 50). Sans elle, « le workflow track est
	// refusé ailleurs » serait vrai même si aucun workflow track n'existait.
	// RÉVISÉ PAR `CRM-077` : le seed pose deux channels de plus sous le track en corbeille
	// (`docs/SPEC-seed.md` §10). Ce que ce scénario garantit est inchangé — aucun channel sans
	// workflow, et un SEUL suivant la copie de portée `track` —, seul le compte total bouge.
	test('huit channels rattachés, un seul suivant un workflow de portée `track`', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CHANNELS}?select=id,track_id,workflow_id&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const channels = (await reponse.json()) as Channel[]
		expect(channels).toHaveLength(8)
		expect(channels.every((c) => c.workflow_id !== null)).toBe(true)

		const copie = await copieDuSeed(request)
		expect(copie.scope).toBe('track')
		expect(copie.track_id).toBe(TRACK_CONSEIL)

		const surLaCopie = channels.filter((c) => c.workflow_id === copie.id)
		expect(surLaCopie).toHaveLength(1)
		expect(surLaCopie[0]!.id).toBe(CHANNEL_PROSPECTION)
		expect(surLaCopie[0]!.track_id).toBe(TRACK_CONSEIL)
	})
})

test.describe('K1 — affectation d’un workflow à un channel (lignes a, b, c)', () => {
	test('ligne a — un workflow **global** est accepté sur n’importe quel channel du workspace', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieDuSeed(request)
		// Le channel naît sur la COPIE, pour que l'écriture qui suit change réellement quelque
		// chose : réaffecter la valeur déjà présente ne prouverait pas que le trigger l'accepte.
		const channel = await creerChannelJetable(request, TRACK_CONSEIL, copie.id)
		try {
			const reponse = await request.patch(`${CHANNELS}?id=eq.${channel}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workflow_id: WORKFLOW_GLOBAL },
			})
			expect(reponse.status()).toBe(204)
		} finally {
			await detruireChannelJetable(request)
		}
	})

	test('ligne a bis — le même déplacement sur `prospection` PEUPLÉ est refusé : INC-046 tient', async ({
		request,
	}) => {
		// Contre-épreuve ajoutée par `CRM-046`. Sans elle, le passage au channel jetable ci-dessus
		// aurait l'air d'un contournement ; il est en réalité la seule façon d'éprouver la règle de
		// `CRM-033` sans buter sur celle de `CRM-040`, qui n'a rien à voir avec elle.
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.patch(`${CHANNELS}?id=eq.${CHANNEL_PROSPECTION}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { workflow_id: WORKFLOW_GLOBAL },
		})
		expect(reponse.status(), 'déplacer le workflow d’un channel peuplé est refusé').toBe(409)

		const relu = await request.get(`${CHANNELS}?select=workflow_id&id=eq.${CHANNEL_PROSPECTION}`, {
			headers: enTetesService(),
		})
		const copie = await copieDuSeed(request)
		expect(((await relu.json()) as { workflow_id: string }[])[0]!.workflow_id).toBe(copie.id)
	})

	test('ligne b — un workflow `track` est accepté sur un channel de **son** track', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieDuSeed(request)

		// RÉVISÉ PAR `CRM-046` : le channel jetable naît sur le workflow GLOBAL, pour que l'écriture
		// qui suit change réellement quelque chose — réaffecter la valeur déjà présente ne
		// prouverait pas que le trigger l'accepte. L'état de départ est ASSERTÉ, et non supposé :
		// c'est ce qui manquait à la rédaction précédente, dont l'appel muet à `remettreChannel`
		// aurait pu échouer sans que rien ne le dise.
		const channel = await creerChannelJetable(request, TRACK_CONSEIL, WORKFLOW_GLOBAL)

		try {
			const depart = await request.get(`${CHANNELS}?select=workflow_id&id=eq.${channel}`, {
				headers: enTetesService(),
			})
			expect(
				((await depart.json()) as Channel[])[0]!.workflow_id,
				'l’état de départ est asserté, pas supposé',
			).toBe(WORKFLOW_GLOBAL)

			const reponse = await request.patch(`${CHANNELS}?id=eq.${channel}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workflow_id: copie.id },
			})
			expect(reponse.status()).toBe(204)

			const relu = await request.get(`${CHANNELS}?select=workflow_id&id=eq.${channel}`, {
				headers: enTetesService(),
			})
			expect(((await relu.json()) as Channel[])[0]!.workflow_id).toBe(copie.id)
		} finally {
			await detruireChannelJetable(request)
		}
	})

	test('ligne c — un workflow `track` est **refusé** sur un channel d’un autre track', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieDuSeed(request)

		const reponse = await request.patch(`${CHANNELS}?id=eq.${CHANNEL_REFONTE}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { workflow_id: copie.id },
		})

		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as Erreur
		expect(corps.code).toBe('23514')
		expect(corps.message).toBe('workflow_hors_track')

		// Et rien n'a bougé : un refus qui laisserait la ligne modifiée ne serait pas un refus.
		const relu = await request.get(`${CHANNELS}?select=workflow_id&id=eq.${CHANNEL_REFONTE}`, {
			headers: enTetesService(),
		})
		expect(((await relu.json()) as Channel[])[0]!.workflow_id).toBe(WORKFLOW_GLOBAL)
	})
})

test.describe('K2 — déplacement d’un channel (lignes d, e)', () => {
	test('ligne d — déplacer un channel qui suit un workflow `track` est refusé', async ({
		request,
	}) => {
		// LA PREUVE QUI JUSTIFIE `track_id` PARMI LES COLONNES SURVEILLÉES. L'écriture ne mentionne
		// pas `workflow_id` : un trigger qui ne se réveillerait que pour elle laisserait passer.
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieDuSeed(request)
		try {
			await remettreChannel(request, CHANNEL_PROSPECTION, TRACK_CONSEIL, copie.id)

			const reponse = await request.patch(`${CHANNELS}?id=eq.${CHANNEL_PROSPECTION}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { track_id: TRACK_STUDIO },
			})

			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as Erreur
			expect(corps.code).toBe('23514')
			expect(corps.message).toBe('workflow_hors_track')

			const relu = await request.get(`${CHANNELS}?select=track_id&id=eq.${CHANNEL_PROSPECTION}`, {
				headers: enTetesService(),
			})
			expect(((await relu.json()) as Channel[])[0]!.track_id).toBe(TRACK_CONSEIL)
		} finally {
			await remettreChannel(request, CHANNEL_PROSPECTION, TRACK_CONSEIL, copie.id)
		}
	})

	test('ligne e — le même déplacement est accepté lorsque le workflow est **global**', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		try {
			const reponse = await request.patch(`${CHANNELS}?id=eq.${CHANNEL_REFONTE}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { track_id: TRACK_CONSEIL },
			})
			expect(reponse.status()).toBe(204)
		} finally {
			await remettreChannel(request, CHANNEL_REFONTE, TRACK_STUDIO, WORKFLOW_GLOBAL)
		}
	})
})

test.describe('K3 — création d’un channel (lignes f, g, h)', () => {
	test('ligne f — créer un channel **sans** `workflow_id` est refusé : INC-029 est soldée', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHANNELS, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: TRACK_STUDIO,
				name: 'Sans workflow',
				slug: 'k3-sans-workflow',
			},
		})

		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).code).toBe('23502')
	})

	test('ligne g — créer un channel avec un workflow **global** est accepté', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHANNELS, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: TRACK_STUDIO,
				workflow_id: WORKFLOW_GLOBAL,
				name: 'K3 global',
				slug: 'k3-global',
			},
		})

		expect(reponse.status()).toBe(201)
		const [cree] = (await reponse.json()) as Channel[]
		expect(cree?.workflow_id).toBe(WORKFLOW_GLOBAL)
		await request.delete(`${CHANNELS}?id=eq.${cree?.id}`, { headers: enTetesService() })
	})

	test('ligne h — créer un channel avec un workflow `track` étranger est refusé', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieDuSeed(request)
		const reponse = await request.post(CHANNELS, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: TRACK_STUDIO,
				workflow_id: copie.id,
				name: 'K3 étranger',
				slug: 'k3-etranger',
			},
		})

		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('workflow_hors_track')

		// Aucune ligne ne subsiste : constaté avec la clé de service, un refus qui laisserait la
		// ligne serait pire qu'une acceptation, il la cacherait.
		const reste = await request.get(`${CHANNELS}?select=id&slug=eq.k3-etranger`, {
			headers: enTetesService(),
		})
		expect((await reste.json()) as Channel[]).toHaveLength(0)
	})
})

test.describe('K4 — le trigger se tait là où la base parle mieux (ligne i)', () => {
	// RÉVISÉ À `CRM-040`, et non retiré — mécanisme de la décision 51.
	//
	// Ce scénario constatait qu'un workflow introuvable était refusé par
	// `channels_workflow_id_workspace_id_fkey`, en `23503` / `409`. `CRM-040` a posé sur `cards` une
	// clé composite `(channel_id, workflow_id) → channels (id, workflow_id)` : dès qu'un channel
	// porte une card, c'est ELLE qui parle la première, avec le même `SQLSTATE` et le même statut.
	//
	// Le refus est donc INCHANGÉ dans sa nature ; seule la contrainte qui le prononce a changé, et
	// la conséquence — un channel occupé ne change plus de workflow — est **la règle non décidée**
	// d'INC-046, arbitrage attendu. `CHANNEL_REFONTE` porte une card du seed
	// (docs/SPEC-cards.md §9), et ce scénario le documente plutôt que de choisir un channel vide
	// pour retrouver l'ancien message : le contourner masquerait précisément ce qu'il faut voir.
	test('ligne i — un workflow **introuvable** est refusé par une clé étrangère, en 409', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.patch(`${CHANNELS}?id=eq.${CHANNEL_REFONTE}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { workflow_id: '00000000-0000-4000-8000-00000000dead' },
		})

		expect(reponse.status()).toBe(409)
		const corps = (await reponse.json()) as Erreur
		expect(corps.code).toBe('23503')
		// INC-046 : sur un channel OCCUPÉ, c'est la clé de `cards` qui refuse d'abord.
		expect(corps.message).toContain('cards_channel_id_workflow_id_fkey')
	})

	// Le refus d'origine — celui de `CRM-033` — reste prouvé, sur un channel que le seed laisse
	// VIDE de cards. Sans ce second scénario, la preuve de `CRM-033` disparaîtrait derrière celle
	// de `CRM-040`, et l'on ne saurait plus si `channels_workflow_id_workspace_id_fkey` tient
	// encore.
	test('ligne i bis — sur un channel SANS card, c’est bien la clé de `channels` qui refuse', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const vides = await request.get(`${CHANNELS}?select=id&slug=eq.appels-offres`, {
			headers: enTetesService(),
		})
		const [channel] = (await vides.json()) as Channel[]

		// Constaté, non supposé : ce channel doit être vide de cards pour que la preuve porte.
		const cards = await request.get(`/rest/v1/cards?select=id&channel_id=eq.${channel!.id}`, {
			headers: enTetesService(),
		})
		expect(await cards.json()).toHaveLength(0)

		const reponse = await request.patch(`${CHANNELS}?id=eq.${channel!.id}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { workflow_id: '00000000-0000-4000-8000-00000000dead' },
		})

		expect(reponse.status()).toBe(409)
		const corps = (await reponse.json()) as Erreur
		expect(corps.code).toBe('23503')
		expect(corps.message).toContain('channels_workflow_id_workspace_id_fkey')
	})
})

test.describe('K5 — les portes qu’aucun trigger sur channels ne voyait (lignes j, k, l)', () => {
	test('ligne j — déplacer un workflow `track` **occupé** vers un autre track est refusé', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieDuSeed(request)
		await remettreChannel(request, CHANNEL_PROSPECTION, TRACK_CONSEIL, copie.id)

		const reponse = await request.patch(`${WORKFLOWS}?id=eq.${copie.id}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { track_id: TRACK_STUDIO },
		})

		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as Erreur
		expect(corps.code).toBe('23514')
		expect(corps.message).toBe('workflow_portee_occupee')

		const relu = await request.get(`${WORKFLOWS}?select=track_id&id=eq.${copie.id}`, {
			headers: enTetesService(),
		})
		expect(((await relu.json()) as Workflow[])[0]!.track_id).toBe(TRACK_CONSEIL)
	})

	test('ligne k — faire basculer de `global` à `track` un workflow **occupé** est refusé', async ({
		request,
	}) => {
		// LA PLUS DOMMAGEABLE DES QUATRE : elle invaliderait d'un seul `UPDATE` le rattachement de
		// tous les channels qui suivent le workflow par défaut.
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.patch(`${WORKFLOWS}?id=eq.${WORKFLOW_GLOBAL}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { scope: 'track', track_id: TRACK_CONSEIL },
		})

		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('workflow_portee_occupee')

		const relu = await request.get(`${WORKFLOWS}?select=scope,track_id&id=eq.${WORKFLOW_GLOBAL}`, {
			headers: enTetesService(),
		})
		const apres = ((await relu.json()) as Workflow[])[0]!
		expect(apres.scope).toBe('global')
		expect(apres.track_id).toBeNull()
	})

	test('ligne l — un workflow `track` **libre** change de track : la règle protège des rattachements', async ({
		request,
	}) => {
		// RÉVISÉ PAR `CRM-046`. Le scénario libérait `prospection` pour rendre la copie « libre » ;
		// ce channel porte désormais des cards et ne peut plus être libéré (INC-046). La copie du
		// seed n'est donc plus jamais libre, et un workflow `track` libre doit être FABRIQUÉ pour
		// que la propriété reste éprouvée — elle n'a pas cessé d'être vraie, elle a cessé d'être
		// servie par le seed.
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const source = await copieDuSeed(request)
		let copieLibre: string | null = null
		try {
			const creation = await request.post('/rest/v1/rpc/copy_workflow_to_track', {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: {
					workflow_id: WORKFLOW_GLOBAL,
					track_id: TRACK_CONSEIL,
					new_name: 'Copie libre — ligne l',
				},
			})
			expect(creation.status(), 'la copie libre naît de la vraie fonction du produit').toBe(200)
			copieLibre = (await creation.json()) as string
			expect(copieLibre).not.toBe(source.id)

			// Aucun channel ne la suit : elle est libre par construction, et non parce qu'on a
			// détaché quelque chose.
			const occupants = await request.get(`${CHANNELS}?select=id&workflow_id=eq.${copieLibre}`, {
				headers: enTetesService(),
			})
			expect(((await occupants.json()) as { id: string }[]).length).toBe(0)

			const reponse = await request.patch(`${WORKFLOWS}?id=eq.${copieLibre}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { track_id: TRACK_STUDIO },
			})
			expect(reponse.status()).toBe(204)
		} finally {
			if (copieLibre !== null) {
				await request.delete(`${WORKFLOWS}?id=eq.${copieLibre}`, { headers: enTetesService() })
			}
		}
	})
})

test.describe('K6 — la règle s’ajoute aux autorisations, elle ne les remplace pas (ligne m)', () => {
	test('ligne m — un `business_developer` est refusé **avant** la règle, par la politique', async ({
		request,
	}) => {
		// Le point n'est pas une redite. Si la nouvelle règle s'appliquait avant l'autorisation, un
		// refus de rôle deviendrait un refus d'intégrité — et apprendrait au demandeur ce que
		// contient une base qu'il n'a pas le droit d'écrire.
		const jeton = await jetonDe(COMPTES_SEED[1].adresse)
		const copie = await copieDuSeed(request)

		// Une écriture que la règle refuserait aussi : elle doit être arrêtée par la politique.
		const reponse = await request.patch(`${CHANNELS}?id=eq.${CHANNEL_REFONTE}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { workflow_id: copie.id },
		})

		// La politique refuse par le `USING`, qui ne lève **aucune erreur** : la mise à jour porte
		// sur zéro ligne (décision 70). Le refus se constate donc en relisant la ligne.
		expect(reponse.status()).toBe(204)
		const relu = await request.get(`${CHANNELS}?select=workflow_id&id=eq.${CHANNEL_REFONTE}`, {
			headers: enTetesService(),
		})
		expect(((await relu.json()) as Channel[])[0]!.workflow_id).toBe(WORKFLOW_GLOBAL)
	})

	test('et il ne crée aucun channel, workflow valide ou non', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[1].adresse)
		const reponse = await request.post(CHANNELS, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: TRACK_STUDIO,
				workflow_id: WORKFLOW_GLOBAL,
				name: 'K6 bizdev',
				slug: 'k6-bizdev',
			},
		})

		expect(reponse.status()).toBe(403)
		const reste = await request.get(`${CHANNELS}?select=id&slug=eq.k6-bizdev`, {
			headers: enTetesService(),
		})
		expect((await reste.json()) as Channel[]).toHaveLength(0)
	})
})
