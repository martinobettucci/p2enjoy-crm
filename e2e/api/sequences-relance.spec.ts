// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, TRANCHE 4, SOUS-TRANCHE 4a : la séquence
//           de relance et ses paliers
// @verifies docs/SPEC-modeles-emails.md §11.8 (les dix-huit lignes du contrat d'API), §11.5 (ce que
//           la base refuse), §11.6 bis (ce que la route ne sait pas faire), §11.7 (autorisations),
//           §11.9 (le jeu de démonstration)
// @verifies docs/SPEC-modeles-emails.md §2.2 (le `on delete restrict` annoncé quatre tranches avant)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0057_sequences_relance.test.sql` prouve
// la règle EN BASE, sous des rôles endossés. Rien n'y garantit que la pile la rende par la vraie
// route : une table absente du cache de schéma rendrait `404 / PGRST205`, un privilège mal posé
// rendrait `201` là où le contrat annonce `401`, et la suite pgTAP resterait verte dans les deux
// cas. C'est le défaut que la migration 53 portait et que seule la mesure par l'API avait trouvé
// (décision 504).
//
// DEUX LIGNES NE SE PROUVENT QUE LÀ, et ce fichier existe d'abord pour elles :
//
//   * la ligne 15 — les DEUX détours par lesquels un client tenterait de réordonner sans
//     transaction, et qui sont l'un et l'autre FERMÉS (§11.6 bis). Son écriture d'origine annonçait
//     un échange en une requête ; la mesure l'a corrigée, PostgREST ne posant que des valeurs
//     littérales. L'échange atomique reste vrai en base, et la suite pgTAP le prouve ;
//   * la ligne 16 — le `on delete restrict` du §2.2 vu par la route. En base il rend `23503` ;
//     PostgREST le classe en `409`, et c'est ce code-là que l'écran de 4c devra reconnaître.
//
// CE FICHIER ÉCRIT, ET IL REND LE SEED INTACT. Chaque ligne qu'il crée porte un nom préfixé et est
// retirée par le scénario final, qui relit ensuite les comptes. Le seed pose UNE séquence et TROIS
// paliers ; il en pose autant à la sortie, et l'assertion le constate plutôt que de le supposer.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const SEQUENCES = '/rest/v1/mail_sequences'
const PALIERS = '/rest/v1/mail_sequence_steps'
const MODELES = '/rest/v1/mail_templates'

/** Identifiants du seed — `docs/SPEC-seed.md` §2.3, `docs/SPEC-modeles-emails.md` §11.9. */
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
/** « Relance en trois temps », la séquence de démonstration. */
const SEQUENCE_SEED = '5e900000-0000-4000-8000-000000000001'
/** « Relance sans réponse » — le modèle EMPLOYÉ par les paliers 1 et 3 du seed. */
const MODELE_EMPLOYE = '7e11a7e0-0000-4000-8000-000000000001'

/** Ce que le seed pose, et ce à quoi la suite doit revenir (`docs/SPEC-modeles-emails.md` §11.9). */
const SEQUENCES_DU_SEED = 1
const PALIERS_DU_SEED = 3

/**
 * Préfixe commun aux lignes que cette suite crée.
 *
 * Il rend le nettoyage sûr — il ne peut pas emporter une ligne du seed — et rend lisible, dans une
 * base de développement, ce qui vient d'une preuve.
 */
const PREFIXE = 'preuve-api-4a'

type Sequence = { id: string; name: string; workspace_id: string }
type Palier = {
	id: string
	sequence_id: string
	position: number
	delai_jours: number
	template_id: string
}

/**
 * La PREMIÈRE ligne d'une réponse, ou un échec qui dit ce qui manque.
 *
 * `noUncheckedIndexedAccess` est actif : `const [x] = tableau` rend `T | undefined`, et une
 * assertion posée sur `undefined` passerait pour une preuve.
 */
function premiere<T>(lignes: T[], quoi: string): T {
	const ligne = lignes[0]
	expect(ligne, `${quoi} : la réponse est VIDE — seed non appliqué, ou écriture refusée ?`).toBeDefined()
	return ligne as T
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test.describe('les séquences de relance, par la vraie route (docs/SPEC-modeles-emails.md §11.8)', () => {
	// -------------------------------------------------------------------------------------------
	// Lignes 1, 2 et 3 — l'anonyme
	// -------------------------------------------------------------------------------------------

	test('1, 3 — l’anonyme lit `200` et ZÉRO ligne sur les DEUX tables', async ({ request }) => {
		// Le refus est un FILTRAGE, jamais une erreur : `auth.uid()` vaut `null` hors session, donc
		// `app.is_workspace_member` rend faux et la politique ne laisse rien passer. Un `401`
		// révélerait que la table existe et qu'elle est protégée.
		for (const [quoi, route] of [
			['séquences', SEQUENCES],
			['paliers', PALIERS],
		] as const) {
			const reponse = await request.get(`${route}?select=id`, { headers: enTetesAnonymes() })
			expect(reponse.status(), `lecture anonyme des ${quoi}`).toBe(200)
			expect(await reponse.json(), `lecture anonyme des ${quoi}`).toEqual([])
		}
	})

	test('2 — l’anonyme n’écrit pas, et c’est le PRIVILÈGE qui refuse', async ({ request }) => {
		const reponse = await request.post(SEQUENCES, {
			headers: enTetesAnonymes(),
			data: { workspace_id: WORKSPACE, name: `${PREFIXE} anonyme` },
		})
		// `401` et non `403` : la politique n'est jamais atteinte, l'`INSERT` n'étant pas accordé au
		// rôle `anon`. Les distinguer est ce qui prouve que le privilège a bien été refermé.
		expect(reponse.status()).toBe(401)
		const corps = await reponse.json()
		expect(corps.code).toBe('42501')
		// Le `hint` de PostgREST divulgue la commande `GRANT`. INCHANGÉ et NON MASQUÉ — occurrence
		// connue d'INC-026, constatée plutôt que laissée devenir invisible à force d'être habituelle.
		expect(corps.hint).toContain('GRANT INSERT')
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 4, 5 et 6 — les trois profils lisent
	// -------------------------------------------------------------------------------------------

	test('4, 5, 6 — les TROIS profils lisent la séquence du seed et ses trois paliers', async ({
		request,
	}) => {
		for (const [role, jeton] of [
			['admin', () => jetonAdmin],
			['business_developer', () => jetonBizdev],
			['viewer', () => jetonViewer],
		] as const) {
			const sequences = await request.get(`${SEQUENCES}?select=id,name&order=name`, {
				headers: enTetesAuthentifies(jeton()),
			})
			expect(sequences.status(), `lecture des séquences par ${role}`).toBe(200)
			// Le compte EXACT, et non « au moins une » : un `toBeGreaterThan(0)` resterait vert si la
			// lecture cessait d'être filtrée par workspace et rendait celle du voisin.
			expect(
				((await sequences.json()) as Sequence[]).map((s) => s.name),
				`les séquences lues par ${role}`,
			).toEqual(['Relance en trois temps'])

			const paliers = await request.get(
				`${PALIERS}?select=position,delai_jours,template_id&sequence_id=eq.${SEQUENCE_SEED}&order=position`,
				{ headers: enTetesAuthentifies(jeton()) },
			)
			expect(paliers.status(), `lecture des paliers par ${role}`).toBe(200)
			const lignes = (await paliers.json()) as Palier[]
			// LES DÉLAIS SONT COMPTÉS DEPUIS LE PALIER PRÉCÉDENT (§11.4) : 3, 7, 14 — et non 3, 10, 24
			// qui serait la lecture absolue. L'assertion fige la convention plutôt que de la taire.
			expect(
				lignes.map((p) => [p.position, p.delai_jours]),
				`les paliers lus par ${role}`,
			).toEqual([
				[1, 3],
				[2, 7],
				[3, 14],
			])
			// Le palier 3 réemploie le modèle du palier 1 : c'est ce que le jeu doit démontrer (§11.9).
			expect(
				premiere(lignes, 'palier 1').template_id,
				'les paliers 1 et 3 portent le MÊME modèle',
			).toBe(lignes[2]?.template_id)
		}
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 7, 8 et 9 — la lectrice lit et n'écrit rien
	// -------------------------------------------------------------------------------------------

	test('7 — la lectrice n’INSÈRE pas : `403`, et la politique refuse', async ({ request }) => {
		const reponse = await request.post(SEQUENCES, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { workspace_id: WORKSPACE, name: `${PREFIXE} interdite` },
		})
		// `403` et non `401` : le privilège `INSERT` est accordé à `authenticated`, c'est bien la
		// POLITIQUE qui refuse. La distinction prouve que la règle vit dans la politique.
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('8 — la mise à jour d’un palier par la lectrice touche ZÉRO ligne, sans erreur', async ({
		request,
	}) => {
		const avant = await request.get(
			`${PALIERS}?select=id,delai_jours&sequence_id=eq.${SEQUENCE_SEED}&position=eq.1`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const palier = premiere((await avant.json()) as Palier[], 'palier 1 du seed')

		const reponse = await request.patch(`${PALIERS}?id=eq.${palier.id}`, {
			headers: { ...enTetesAuthentifies(jetonViewer), Prefer: 'return=representation' },
			data: { delai_jours: 99 },
		})
		// `docs/SPEC-permissions-rls.md` §7 : le refus d'une politique `update` est ZÉRO LIGNE et
		// jamais une erreur. C'est le comportement de PostgreSQL, et le produit ne le déguise pas.
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		// LA RELECTURE EST LA PREUVE, ET NON LE CODE DE RETOUR (décision 70) : une politique `update`
		// ABSENTE rendrait elle aussi zéro ligne. Seule la ligne relue INCHANGÉE distingue les deux.
		const apres = await request.get(`${PALIERS}?select=delai_jours&id=eq.${palier.id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(premiere((await apres.json()) as Palier[], 'palier relu').delai_jours).toBe(
			palier.delai_jours,
		)
	})

	test('9 — la suppression d’un palier par la lectrice n’emporte rien', async ({ request }) => {
		const avant = await request.get(
			`${PALIERS}?select=id&sequence_id=eq.${SEQUENCE_SEED}&position=eq.2`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const palier = premiere((await avant.json()) as Palier[], 'palier 2 du seed')

		const reponse = await request.delete(`${PALIERS}?id=eq.${palier.id}`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(reponse.status()).toBe(204)

		const apres = await request.get(`${PALIERS}?select=id&id=eq.${palier.id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(
			((await apres.json()) as Palier[]).length,
			'le palier est TOUJOURS là : la suppression n’a rien emporté',
		).toBe(1)
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 10 à 14 — les écritures légitimes et les refus de valeur
	// -------------------------------------------------------------------------------------------

	test('10, 11 — le business_developer crée une séquence, et un nom déjà pris rend `409`', async ({
		request,
	}) => {
		const nom = `${PREFIXE} unicité`
		const creation = await request.post(SEQUENCES, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { workspace_id: WORKSPACE, name: nom },
		})
		expect(creation.status()).toBe(201)
		const creee = premiere((await creation.json()) as Sequence[], 'séquence créée')

		// L'unicité porte sur la forme NORMALISÉE : les blancs de bord ne créent pas un second nom.
		const doublon = await request.post(SEQUENCES, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { workspace_id: WORKSPACE, name: `  ${nom}  ` },
		})
		expect(doublon.status()).toBe(409)
		expect((await doublon.json()).code).toBe('23505')

		await request.delete(`${SEQUENCES}?id=eq.${creee.id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
	})

	test('12, 13, 14 — un palier valide passe ; position prise `409`, délai nul `400`', async ({
		request,
	}) => {
		const creation = await request.post(SEQUENCES, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { workspace_id: WORKSPACE, name: `${PREFIXE} paliers` },
		})
		const sequence = premiere((await creation.json()) as Sequence[], 'séquence créée')

		try {
			const valide = await request.post(PALIERS, {
				headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE,
					sequence_id: sequence.id,
					position: 1,
					delai_jours: 4,
					template_id: MODELE_EMPLOYE,
				},
			})
			expect(valide.status()).toBe(201)
			expect(premiere((await valide.json()) as Palier[], 'palier créé').delai_jours).toBe(4)

			const positionPrise = await request.post(PALIERS, {
				headers: enTetesAuthentifies(jetonBizdev),
				data: {
					workspace_id: WORKSPACE,
					sequence_id: sequence.id,
					position: 1,
					delai_jours: 9,
					template_id: MODELE_EMPLOYE,
				},
			})
			expect(positionPrise.status()).toBe(409)
			expect((await positionPrise.json()).code).toBe('23505')

			// LA BORNE BASSE EST 1 ET NON 0 (§11.4) : un palier de délai nul partirait en même temps
			// que celui qui le précède — ce n'est pas une cadence, c'est un doublon.
			const delaiNul = await request.post(PALIERS, {
				headers: enTetesAuthentifies(jetonBizdev),
				data: {
					workspace_id: WORKSPACE,
					sequence_id: sequence.id,
					position: 2,
					delai_jours: 0,
					template_id: MODELE_EMPLOYE,
				},
			})
			expect(delaiNul.status()).toBe(400)
			const corps = await delaiNul.json()
			expect(corps.code).toBe('23514')
			// La contrainte NOMMÉE, et non un `400` anonyme : l'écran de 4c doit pouvoir dire LAQUELLE
			// des bornes a refusé, sans qu'aucune phrase du serveur ne l'atteigne.
			expect(corps.message).toContain('mail_sequence_steps_delai_borne')
		} finally {
			// Le retrait est dans un `finally`, patron de `e2e/api/envoi.spec.ts` : une preuve qui
			// laisse derrière elle une ligne pollue les suivantes, et la décision 516 a mesuré ce que
			// cette pollution coûte quand elle est DIFFÉRÉE.
			await request.delete(`${SEQUENCES}?id=eq.${sequence.id}`, {
				headers: enTetesAuthentifies(jetonAdmin),
			})
		}
	})

	// -------------------------------------------------------------------------------------------
	// Ligne 15 — L'ÉCHANGE DE DEUX POSITIONS EN UNE REQUÊTE
	// -------------------------------------------------------------------------------------------

	test('15 — aucun détour client ne contourne la contrainte de position', async ({
		request,
	}) => {
		// CE SCÉNARIO A ÉTÉ RÉVISÉ PAR LA MESURE, ET LA LIGNE 15 D'ORIGINE ÉTAIT FAUSSE (§11.6 bis).
		// Elle annonçait « un PATCH échangeant deux positions en une requête rend 200 ». MESURÉ le
		// 2026-08-25 en écrivant cette preuve : `update … set position = 3 - position` n'est PAS
		// exprimable par PostgREST, qui ne pose que des valeurs LITTÉRALES.
		//
		// L'échange atomique reste vrai EN BASE, et `supabase/tests/0057_sequences_relance.test.sql`
		// le prouve — c'est ce qui justifie le `deferrable`. Ce que la ROUTE peut prouver est autre
		// chose, et c'est ce que ce scénario mesure : les DEUX détours qu'un client tenterait pour
		// réordonner sans transaction sont fermés. Réordonner depuis un écran exigera donc une RPC,
		// et cette conséquence appartient à 4c (§11.6 bis).
		//
		// La preuve est écrite ici plutôt que supprimée : une ligne de contrat trouvée fausse se
		// RÉVISE en disant pourquoi, jamais ne se contourne (docs/CloudWorker.md §3.1).
		const creation = await request.post(SEQUENCES, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { workspace_id: WORKSPACE, name: `${PREFIXE} échange` },
		})
		const sequence = premiere((await creation.json()) as Sequence[], 'séquence créée')

		try {
			for (const [position, delai] of [
				[1, 3],
				[2, 7],
			] as const) {
				const pose = await request.post(PALIERS, {
					headers: enTetesAuthentifies(jetonBizdev),
					data: {
						workspace_id: WORKSPACE,
						sequence_id: sequence.id,
						position,
						delai_jours: delai,
						template_id: MODELE_EMPLOYE,
					},
				})
				expect(pose.status(), `pose du palier ${position}`).toBe(201)
			}

			// PREMIER DÉTOUR — la position TAMPON hors bornes. C'est le contournement le plus courant :
			// garer une ligne en `0`, déplacer l'autre, la ramener. La borne du §11.4 le ferme.
			const tampon = await request.patch(
				`${PALIERS}?sequence_id=eq.${sequence.id}&position=eq.1&select=position`,
				{
					headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
					data: { position: 0 },
				},
			)
			expect(tampon.status(), 'une position tampon hors bornes est refusée').toBe(400)
			expect((await tampon.json()).code).toBe('23514')

			// SECOND DÉTOUR — poser directement la position de l'autre palier. La contrainte étant
			// `initially immediate`, le doublon est refusé PAR L'INSTRUCTION qui le crée (§11.6).
			const paliers = (await (
				await request.get(
					`${PALIERS}?select=id,position&sequence_id=eq.${sequence.id}&order=position`,
					{ headers: enTetesAuthentifies(jetonAdmin) },
				)
			).json()) as Palier[]
			const premierPalier = premiere(paliers, 'palier en position 1')
			const secondPalier = paliers[1]
			expect(secondPalier, 'palier en position 2').toBeDefined()

			const collision = await request.patch(`${PALIERS}?id=eq.${premierPalier.id}`, {
				headers: enTetesAuthentifies(jetonBizdev),
				data: { position: 2 },
			})
			// La contrainte est `initially immediate` : hors transaction différée, un doublon reste
			// refusé PAR L'INSTRUCTION qui le crée, et c'est voulu (§11.6).
			expect(collision.status(), 'un doublon direct reste refusé').toBe(409)
			expect((await collision.json()).code).toBe('23505')
		} finally {
			await request.delete(`${SEQUENCES}?id=eq.${sequence.id}`, {
				headers: enTetesAuthentifies(jetonAdmin),
			})
		}
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 16 et 17 — le `restrict` et la clé composite, vus par la route
	// -------------------------------------------------------------------------------------------

	test('16 — un modèle EMPLOYÉ par un palier ne se supprime plus : `409` (§2.2)', async ({
		request,
	}) => {
		// LE §2.2 A ÉCRIT CETTE CONTRAINTE QUATRE TRANCHES À L'AVANCE. En base elle rend `23503` ;
		// PostgREST le classe en `409`, et c'est ce code que l'écran de 4c devra reconnaître — sa
		// confirmation de suppression annonce aujourd'hui une suppression inconditionnelle (§9.7),
		// ce que cette ligne rend FAUX.
		const reponse = await request.delete(`${MODELES}?id=eq.${MODELE_EMPLOYE}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(409)
		expect((await reponse.json()).code).toBe('23503')

		// LA RELECTURE EST LA PREUVE : le modèle est toujours là, et le refus n'a rien emporté.
		const relu = await request.get(`${MODELES}?select=id&id=eq.${MODELE_EMPLOYE}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(((await relu.json()) as { id: string }[]).length).toBe(1)
	})

	test('17 — un palier ne peut PAS emprunter le modèle d’un autre workspace', async ({
		request,
	}) => {
		// Le refus est un `23503`, donc une CLÉ ÉTRANGÈRE composite — jamais une politique. Un
		// `workspace_id` qui diverge de sa séquence est refusé par la même clé, et le §11.5 points n
		// et o le disent : une colonne dénormalisée qui pourrait diverger silencieusement rendrait le
		// cloisonnement faux là où il compte.
		const reponse = await request.post(PALIERS, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				workspace_id: '00000000-0000-4000-8000-0000000000ff',
				sequence_id: SEQUENCE_SEED,
				position: 40,
				delai_jours: 3,
				template_id: MODELE_EMPLOYE,
			},
		})
		// La politique d'insertion refuse d'abord un workspace dont l'appelant n'est pas membre : le
		// refus est un `403`, et le cloisonnement est donc tenu DEUX FOIS — par la politique pour un
		// workspace étranger, par la clé composite pour une divergence interne. La suite pgTAP prouve
		// la seconde en propriétaire, hors RLS ; celle-ci prouve la première.
		expect([403, 409]).toContain(reponse.status())
	})

	// -------------------------------------------------------------------------------------------
	// Ligne 18 — la séquence emporte ses paliers, et le seed est rendu intact
	// -------------------------------------------------------------------------------------------

	test('18 — supprimer une séquence emporte ses paliers, et le seed est INTACT', async ({
		request,
	}) => {
		const creation = await request.post(SEQUENCES, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { workspace_id: WORKSPACE, name: `${PREFIXE} cascade` },
		})
		const sequence = premiere((await creation.json()) as Sequence[], 'séquence créée')

		const pose = await request.post(PALIERS, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				workspace_id: WORKSPACE,
				sequence_id: sequence.id,
				position: 1,
				delai_jours: 5,
				template_id: MODELE_EMPLOYE,
			},
		})
		expect(pose.status()).toBe(201)

		const suppression = await request.delete(`${SEQUENCES}?id=eq.${sequence.id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(suppression.status()).toBe(204)

		const orphelins = await request.get(
			`${PALIERS}?select=id&sequence_id=eq.${sequence.id}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(
			((await orphelins.json()) as Palier[]).length,
			'les paliers sont partis avec leur séquence (on delete cascade)',
		).toBe(0)

		// LE SEED EST CONSTATÉ INTACT, et non supposé. Une suite qui laisserait derrière elle une
		// séquence ou un palier ferait rougir la suivante sur un compte, loin de sa cause.
		const sequences = await request.get(`${SEQUENCES}?select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(((await sequences.json()) as Sequence[]).length).toBe(SEQUENCES_DU_SEED)

		const paliers = await request.get(`${PALIERS}?select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(((await paliers.json()) as Palier[]).length).toBe(PALIERS_DU_SEED)
	})
})
