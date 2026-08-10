// @verifies CRM-030 (docs/BACKLOG.md) — catalogue de nœuds : lecture, écriture, ordre, archivage
// @verifies docs/SPEC-workflow-engine.md §2.8 (contrat d'API mesuré, lignes a à m), §2.4 (ordre),
//           §2.5 (bornes), §2.6 (archivage), §2.7 (autorisations), §2.9 (seed)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 2, n° 3 et n° 11)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés, obtenus par la véritable route de connexion. Aucun navigateur n'est lancé.
//
// Ils reprennent une à une les treize lignes du tableau de `docs/SPEC-workflow-engine.md` §2.8,
// qui sont des **mesures** et non des prévisions : la spécification a été écrite après les avoir
// observées sur une table sonde, et ces scénarios les rejouent contre la table réelle.
//
// LA LIGNE H EST LA PLUS IMPORTANTE DE CE FICHIER. Une mise à jour refusée par la clause `USING`
// d'une politique ne produit **aucune erreur** : PostgREST rend `200` et un tableau vide, aucune
// ligne n'ayant été vue comme modifiable. Un scénario qui se contenterait de constater l'absence
// d'erreur conclurait que l'écriture a réussi. Chaque refus de mise à jour relit donc la ligne et
// la constate **inchangée**.
//
// Ce que ce fichier ne fait jamais : prouver un refus avec la clé de service. Elle contourne la
// RLS, et ne sert donc qu'à **constater l'état de la base** — indispensable, car un « zéro ligne »
// sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout (décision 50).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Les sept nœuds actifs du seed, dans l'ordre de leur `position` (§2.9). */
const NOEUDS_ACTIFS = [
	'prospection',
	'relance',
	'negociation',
	'signature',
	'realisation',
	'livre',
	'perdu',
]
const NOEUD_ARCHIVE = 'qualification'

const CHEMIN = '/rest/v1/workflow_nodes_catalog'

type Noeud = {
	id: string
	workspace_id: string
	key: string
	label: string
	kind: string
	color: string
	default_probability: string | null
	default_stale_after_days: number | null
	position: number
	archived_at: string | null
}

/**
 * Crée un second workspace avec la clé de service.
 *
 * Il n'existe **aucun** moyen de le créer autrement : aucune politique n'autorise la création d'un
 * workspace par un client, et c'est voulu — `CRM-012` en décidera. Le fait est nommé ici plutôt
 * que masqué, comme `e2e/api/tracks.spec.ts` et `e2e/api/channels.spec.ts` le font déjà.
 */
async function poserWorkspaceB(requete: APIRequestContext, suffixe: string): Promise<string> {
	// Le suffixe complète un UUID : il vaut exactement cinq caractères hexadécimaux, sinon
	// l'identifiant produit est trop court et PostgREST refuse la requête en `400` — un échec qui
	// ressemblerait à un refus d'autorisation sans en être un.
	if (!/^[0-9a-f]{5}$/.test(suffixe)) throw new Error(`suffixe invalide : ${suffixe}`)
	const workspaceId = `d0000000-0000-4000-8000-0000000${suffixe}`

	const ws = await requete.post('/rest/v1/workspaces', {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { id: workspaceId, name: `Workspace ND B ${suffixe}`, slug: `workspace-nd-b-${suffixe}` },
	})
	expect(ws.status(), 'la fixture du workspace B doit être posée').toBeLessThan(300)
	return workspaceId
}

/** Retire ce que le scénario a créé, pour que la base reste conforme au seed. */
async function retirerWorkspaceB(requete: APIRequestContext, workspaceId: string): Promise<void> {
	await requete.delete(`/rest/v1/workspaces?id=eq.${workspaceId}`, { headers: enTetesService() })
}

/** Retire un nœud créé par un scénario. Seule la clé de service en a le privilège. */
async function retirerNoeud(requete: APIRequestContext, cle: string): Promise<void> {
	await requete.delete(`${CHEMIN}?key=eq.${cle}`, { headers: enTetesService() })
}

test.describe('N0 — la table contient réellement des lignes', () => {
	// Condition de validité de tout ce qui suit (décision 50). Sans elle, les « zéro ligne » des
	// scénarios de refus seraient vrais sur une table vide, donc sans valeur probante.
	test('le seed a posé huit nœuds, dont un archivé, et les cinq jetons sont exercés', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CHEMIN}?select=key,kind,color,archived_at,default_stale_after_days` +
				`&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Noeud[]
		expect(lignes).toHaveLength(8)
		expect(lignes.filter((n) => n.archived_at !== null).map((n) => n.key)).toEqual([NOEUD_ARCHIVE])

		// Les trois types sont représentés : sans un `won` et un `lost`, l'analytique de conversion
		// n'aurait aucune donnée de démonstration.
		expect(new Set(lignes.map((n) => n.kind))).toEqual(new Set(['open', 'won', 'lost']))

		// Les cinq jetons du design system sont exercés. Un jeton que rien ne porte n'est jamais
		// mesuré — c'est la leçon du correctif de contraste de `CRM-020`.
		expect(new Set(lignes.map((n) => n.color))).toEqual(
			new Set(['brand', 'success', 'accent', 'danger', 'neutral']),
		)

		// Les deux nœuds terminaux n'ont pas de seuil de relance : une affaire livrée ou perdue
		// n'est pas en retard (§2.5).
		for (const cle of ['livre', 'perdu']) {
			const noeud = lignes.find((n) => n.key === cle)
			expect(noeud?.default_stale_after_days, `${cle} ne doit avoir aucun seuil`).toBeNull()
		}
	})
})

test.describe('N1 — lecture (docs/SPEC-workflow-engine.md §2.8, lignes a, b, c, l)', () => {
	test('ligne c — PREUVE DE REFUS N° 11 : l’anonyme ne lit aucun nœud', async ({ request }) => {
		const reponse = await request.get(`${CHEMIN}?select=*`, { headers: enTetesAnonymes() })

		// Le refus se manifeste par zéro ligne, **pas** par une erreur : les deux formes sont
		// vérifiées séparément (docs/SPEC-permissions-rls.md §7, dernier paragraphe).
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	for (const compte of COMPTES_SEED) {
		test(`lignes a et b — ${compte.role} lit le catalogue de son workspace`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const reponse = await request.get(`${CHEMIN}?select=key`, {
				headers: enTetesAuthentifies(jeton),
			})

			expect(reponse.status()).toBe(200)
			const lignes = (await reponse.json()) as Noeud[]
			// Les huit, archivé compris : c'est le **filtre du sélecteur** qui masque l'archivé, pas
			// la politique de lecture. Un administrateur doit pouvoir désarchiver.
			expect(lignes).toHaveLength(8)
			// Lire n'exige pas d'écrire : le `viewer` voit ce que voit l'administrateur.
			expect(lignes.map((n) => n.key)).toContain(NOEUD_ARCHIVE)
		})
	}

	test('la requête d’un sélecteur de nœuds rend l’ordre du catalogue, sans l’archivé', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const reponse = await request.get(
			`${CHEMIN}?select=key,position&workspace_id=eq.${WORKSPACE_SEED}` +
				'&archived_at=is.null&order=position,label',
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Noeud[]
		expect(lignes.map((n) => n.key)).toEqual(NOEUDS_ACTIFS)
		expect(lignes.map((n) => Number(n.position))).toEqual([1, 2, 3, 4, 5, 6, 7])
	})

	test('ligne l — PREUVE DE REFUS N° 3 : aucun nœud d’un autre workspace', async ({ request }) => {
		const workspaceB = await poserWorkspaceB(request, 'b0001')
		try {
			// La ligne de B est d'abord **constatée présente** avec la clé de service. Sans cela, le
			// « zéro ligne » de l'appelant de A serait vrai sur un workspace vide (décision 50).
			const pose = await request.post(CHEMIN, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { workspace_id: workspaceB, key: 'noeud-de-b', label: 'Nœud de B', position: 1 },
			})
			expect(pose.status(), 'la fixture du nœud de B doit être posée').toBeLessThan(300)

			const controle = await request.get(`${CHEMIN}?select=key&workspace_id=eq.${workspaceB}`, {
				headers: enTetesService(),
			})
			expect((await controle.json()) as Noeud[]).toHaveLength(1)

			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.get(`${CHEMIN}?select=key&workspace_id=eq.${workspaceB}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])
		} finally {
			await retirerWorkspaceB(request, workspaceB)
		}
	})
})

test.describe('N2 — écriture réservée aux administrateurs (lignes d, e, f, m)', () => {
	for (const compte of COMPTES_SEED.filter((c) => c.role !== 'admin')) {
		test(`lignes e et f — ${compte.role} ne crée aucun nœud : 403, code 42501`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const cle = `refus-${compte.role.replace(/_/g, '-')}`
			const reponse = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: WORKSPACE_SEED, key: cle, label: 'Refusé' },
			})

			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code: string }).code).toBe('42501')

			// Le refus n'a rien laissé derrière lui : constaté avec la clé de service, qui contourne
			// la RLS — sans quoi l'absence de ligne pourrait n'être qu'un refus de lecture.
			const controle = await request.get(`${CHEMIN}?select=key&key=eq.${cle}`, {
				headers: enTetesService(),
			})
			expect(await controle.json()).toEqual([])
		})
	}

	test('lignes d et m — l’administrateur crée un nœud, `position` attribuée par le trigger', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const cle = `api-cree-${Date.now()}`
		try {
			const reponse = await request.post(CHEMIN, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				// `position` est **omise** : c'est le trigger qui doit la renseigner. Le type généré
				// l'exige pourtant à l'insertion, écart figé par INC-027 — le générateur ignore les
				// triggers. La requête est ici formée à la main, hors du type.
				data: { workspace_id: WORKSPACE_SEED, key: cle, label: 'Créé par l’API' },
			})

			expect(reponse.status()).toBe(201)
			const [cree] = (await reponse.json()) as Noeud[]
			// Le seed occupe les positions 1 à 8 : la suivante est 9.
			expect(Number(cree?.position)).toBe(9)
			// Les défauts de colonne s'appliquent : `open` et `neutral`, jamais `brand`.
			expect(cree?.kind).toBe('open')
			expect(cree?.color).toBe('neutral')
			expect(cree?.archived_at).toBeNull()
		} finally {
			await retirerNoeud(request, cle)
		}
	})

	test('ligne k — un administrateur ne crée rien dans un workspace dont il n’est pas membre', async ({
		request,
	}) => {
		const workspaceB = await poserWorkspaceB(request, 'b0002')
		try {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: workspaceB, key: 'intrusion', label: 'Intrusion' },
			})
			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code: string }).code).toBe('42501')

			const controle = await request.get(`${CHEMIN}?select=key&key=eq.intrusion`, {
				headers: enTetesService(),
			})
			expect(await controle.json()).toEqual([])
		} finally {
			await retirerWorkspaceB(request, workspaceB)
		}
	})
})

test.describe('N3 — mise à jour et archivage (lignes g, h, j)', () => {
	test('ligne g — l’administrateur archive puis désarchive un nœud', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const cle = `api-archive-${Date.now()}`
		try {
			const creation = await request.post(CHEMIN, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: { workspace_id: WORKSPACE_SEED, key: cle, label: 'À archiver' },
			})
			expect(creation.status()).toBe(201)

			const archivage = await request.patch(`${CHEMIN}?key=eq.${cle}`, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: { archived_at: '2026-05-01T09:00:00Z' },
			})
			expect(archivage.status()).toBe(200)
			const [archive] = (await archivage.json()) as Noeud[]
			expect(archive?.archived_at).not.toBeNull()

			// L'archivage est **réversible** : c'est une suppression douce, pas une suppression.
			const retour = await request.patch(`${CHEMIN}?key=eq.${cle}`, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: { archived_at: null },
			})
			expect(retour.status()).toBe(200)
			expect(((await retour.json()) as Noeud[])[0]?.archived_at).toBeNull()
		} finally {
			await retirerNoeud(request, cle)
		}
	})

	for (const compte of COMPTES_SEED.filter((c) => c.role !== 'admin')) {
		test(`ligne h — ${compte.role} n’archive rien : 200, aucune ligne touchée`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const reponse = await request.patch(`${CHEMIN}?key=eq.prospection`, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: { archived_at: '2026-05-01T09:00:00Z', label: 'Renommé de force' },
			})

			// LE POINT DÉCISIF. Le refus ne lève **aucune erreur** : la clause `USING` rend la ligne
			// invisible à l'ordre `UPDATE`, qui réussit sur zéro ligne. Attendre un `403` ici serait
			// faux — et attendre seulement « pas d'erreur » ne prouverait rien.
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])

			// Ce qui prouve le refus est l'état de la ligne, relu avec la clé de service.
			const controle = await request.get(
				`${CHEMIN}?select=key,label,archived_at&key=eq.prospection`,
				{ headers: enTetesService() },
			)
			const [noeud] = (await controle.json()) as Noeud[]
			expect(noeud?.archived_at, 'le nœud du seed doit rester actif').toBeNull()
			expect(noeud?.label, 'et garder son libellé').toBe('Prospection')
		})
	}

	test('PREUVE DE REFUS N° 2 — un business_developer ne modifie pas le vocabulaire', async ({
		request,
	}) => {
		// `docs/SPEC-permissions-rls.md` §7, scénario n° 2 : « business_developer tente de modifier
		// un workflow → refus ». Le catalogue de nœuds est la première table de la famille des
		// workflows que le produit livre ; la preuve y est acquise à ce niveau, les tables
		// `workflows`, `workflow_steps` et `workflow_transitions` restant dues par `CRM-031`.
		const jeton = await jetonDe(COMPTES_SEED[1].adresse)
		const reponse = await request.patch(`${CHEMIN}?key=eq.negociation`, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { default_probability: 99 },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		const controle = await request.get(
			`${CHEMIN}?select=key,default_probability&key=eq.negociation`,
			{ headers: enTetesService() },
		)
		const [noeud] = (await controle.json()) as Noeud[]
		expect(Number(noeud?.default_probability), 'la probabilité du seed est intacte').toBe(50)
	})

	test('ligne j — le `WITH CHECK` interdit de déplacer un nœud vers un autre workspace', async ({
		request,
	}) => {
		const workspaceB = await poserWorkspaceB(request, 'b0003')
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const cle = `api-deplace-${Date.now()}`
		try {
			const creation = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: WORKSPACE_SEED, key: cle, label: 'À déplacer' },
			})
			expect(creation.status()).toBe(201)

			// Ici le refus **est** une erreur, et non un zéro ligne : la ligne est visible par le
			// `USING` — l'appelant est administrateur de A — et c'est le `WITH CHECK` qui refuse la
			// ligne d'arrivée. Les deux formes de refus coexistent sur la même politique, et c'est
			// exactement ce qui rend la ligne h difficile à voir.
			const reponse = await request.patch(`${CHEMIN}?key=eq.${cle}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: workspaceB },
			})
			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as { code: string }).code).toBe('42501')

			const controle = await request.get(`${CHEMIN}?select=workspace_id&key=eq.${cle}`, {
				headers: enTetesService(),
			})
			expect(((await controle.json()) as Noeud[])[0]?.workspace_id).toBe(WORKSPACE_SEED)
		} finally {
			await retirerNoeud(request, cle)
			await retirerWorkspaceB(request, workspaceB)
		}
	})
})

test.describe('N4 — aucune suppression physique (ligne i)', () => {
	test('ligne i — `DELETE` est refusé même à un administrateur, dès le privilège', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.delete(`${CHEMIN}?key=eq.prospection`, {
			headers: enTetesAuthentifies(jeton),
		})

		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as { code: string; message: string; hint: string | null }
		// Le refus vient du **privilège**, non d'une politique : aucun `DELETE` n'est accordé, donc
		// aucune politique n'est même évaluée.
		expect(corps.code).toBe('42501')
		expect(corps.message).toContain('permission denied')

		// INC-026, constaté et non masqué : PostgREST divulgue dans son `hint` la commande `GRANT`
		// qui lèverait le refus. Comportement de la version épinglée, portée transverse. L'assertion
		// le **fige** : si une version future cessait de le faire, elle deviendrait rouge et
		// l'entrée pourrait être close.
		expect(corps.hint).toContain('GRANT DELETE')

		const controle = await request.get(`${CHEMIN}?select=key&key=eq.prospection`, {
			headers: enTetesService(),
		})
		expect(((await controle.json()) as Noeud[])[0]?.key).toBe('prospection')
	})
})

test.describe('N5 — bornes des valeurs, éprouvées par l’API', () => {
	// Les contraintes sont prouvées en base par la suite pgTAP. Ce qui est vérifié ici est que le
	// refus **traverse PostgREST** au lieu d'être avalé ou transformé en succès silencieux.
	const casRefuses = [
		{ nom: 'une clé en majuscules', charge: { key: 'MajusculeAPI', label: 'M' } },
		{ nom: 'un libellé blanc', charge: { key: 'libelle-blanc-api', label: '   ' } },
		{ nom: 'un `kind` inconnu', charge: { key: 'kind-faux-api', label: 'K', kind: 'inconnu' } },
		{
			nom: 'un hexadécimal comme couleur',
			charge: { key: 'couleur-hex-api', label: 'C', color: '#ff0000' },
		},
		{
			nom: 'une probabilité supérieure à 100',
			charge: { key: 'proba-haute-api', label: 'P', default_probability: 100.01 },
		},
		{
			nom: 'un seuil de relance de zéro jour',
			charge: { key: 'seuil-zero-api', label: 'S', default_stale_after_days: 0 },
		},
	]

	for (const cas of casRefuses) {
		test(`${cas.nom} est refusé en 400, code 23514`, async ({ request }) => {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const reponse = await request.post(CHEMIN, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: WORKSPACE_SEED, ...cas.charge },
			})
			expect(reponse.status()).toBe(400)
			expect(((await reponse.json()) as { code: string }).code).toBe('23514')

			const controle = await request.get(`${CHEMIN}?select=key&key=eq.${cas.charge.key}`, {
				headers: enTetesService(),
			})
			expect(await controle.json()).toEqual([])
		})
	}

	test('la même clé deux fois dans le même workspace est refusée en 409', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHEMIN, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { workspace_id: WORKSPACE_SEED, key: 'prospection', label: 'Doublon' },
		})
		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as { code: string }).code).toBe('23505')
	})

	test('`numeric(5,2)` arrondit avant la contrainte : 99.999 est accepté et vaut 100.00', async ({
		request,
	}) => {
		// Comportement MESURÉ pendant la spécification (§2.5, décision 68). Il est figé ici parce
		// qu'un lecteur pressé le prendrait pour un défaut, et « corrigerait » la contrainte.
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const cle = `api-arrondi-${Date.now()}`
		try {
			const reponse = await request.post(CHEMIN, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: { workspace_id: WORKSPACE_SEED, key: cle, label: 'Arrondi', default_probability: 99.999 },
			})
			expect(reponse.status()).toBe(201)
			expect(Number(((await reponse.json()) as Noeud[])[0]?.default_probability)).toBe(100)
		} finally {
			await retirerNoeud(request, cle)
		}
	})
})
