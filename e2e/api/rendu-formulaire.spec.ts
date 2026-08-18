// @verifies CRM-037 (docs/BACKLOG.md) — l'interface et la garde lisent « renseigné » de la même façon
// @verifies docs/SPEC-form-composer.md §4.3 (tableau de cas partagé), §7.3 (preuves attendues),
//           §6.6 (définition de « renseigné »), §6.7 (la sixième vérification de `move_card`)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves hors interface, jetons réels)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. Le §6.6 confie « renseigné » à
// `app.valeur_de_champ_est_vide(jsonb)` et exige que le rendu de `CRM-037` en donne la **même**
// lecture, « faute de quoi l'interface annoncerait passable une transition que la garde refuse ».
// Deux codes, deux langages, deux processus : l'égalité n'est pas démontrable par relecture.
//
// COMMENT ELLE EST TRANCHÉE. Le tableau de cas vit dans le code de l'interface —
// `webapp/src/lib/valeur-renseignee.ts` —, où le test unitaire l'exerce contre le prédicat
// TypeScript. Ici, **les mêmes valeurs** sont écrites dans de vraies lignes `card_field_values`,
// par la vraie route et avec le jeton réel d'un profil seedé, puis soumises au jugement de
// `move_card`. Les deux lectures sont comparées sur les mêmes valeurs, chacune par son chemin.
//
// POURQUOI LA CARD NE BOUGE JAMAIS. La card `c1` est à `Relance` ; `budget` est `required` à
// `Négociation` et **vide par contrat de seed**. Toute tentative est donc refusée de toute façon,
// et c'est la **liste des clés manquantes** qui porte l'information cherchée : elle nomme le champ
// d'essai lorsque la base juge sa valeur vide, et ne le nomme pas lorsqu'elle la juge renseignée.
// Aucune transition n'aboutit, aucune colonne protégée n'est réécrite, et le seed est rendu intact
// — ce qu'un déplacement réussi ne permettrait pas, `current_step_id` n'étant réécrivable par
// personne depuis `CRM-013`.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { CAS_RENSEIGNE, estRenseigne } from '../../webapp/src/lib/valeur-renseignee'
import { enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_NEGOCIATION = '5eed0000-0000-4000-8000-000000000063'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
const CHAMP_BUDGET = '5eed0000-0000-4000-8000-000000000081'

const CHAMPS = '/rest/v1/form_fields'
const REGLES = '/rest/v1/form_field_rules'
const VALEURS = '/rest/v1/card_field_values'

/** Préfixe des lignes posées par ces scénarios, pour un ménage qui ne touche rien d'autre. */
const PREFIXE = 'tst-crm037-'

type Champ = { id: string; key: string; type: string; position: number }
type Erreur = { code: string; message: string; details: string | null }

let jetonAdmin: string

/**
 * Retire toute ligne posée par ces scénarios.
 *
 * Les valeurs d'abord, puis les champs : supprimer un champ emporte ses règles par cascade
 * (§3.3), mais `card_field_values` porte sa propre clé composite et doit être vidée d'abord.
 * Passe par la clé de service — le produit n'expose aucune suppression de champ (décision 96).
 */
async function menage(requete: APIRequestContext): Promise<void> {
	const restants = await requete.get(`${CHAMPS}?key=like.${PREFIXE}*&select=id`, {
		headers: enTetesService(),
	})
	for (const champ of (await restants.json()) as { id: string }[]) {
		await requete.delete(`${VALEURS}?field_id=eq.${champ.id}`, { headers: enTetesService() })
	}
	await requete.delete(`${CHAMPS}?key=like.${PREFIXE}*`, { headers: enTetesService() })
}

/** Crée un champ d'essai et le rend `required` à l'étape `Négociation`. */
async function poserChampExige(
	requete: APIRequestContext,
	rang: number,
	type: string,
): Promise<Champ> {
	const reponseChamp = await requete.post(CHAMPS, {
		headers: {
			...enTetesService(),
			'Content-Type': 'application/json',
			Prefer: 'return=representation',
		},
		data: {
			workflow_id: WORKFLOW_GLOBAL,
			workspace_id: WORKSPACE_SEED,
			key: `${PREFIXE}${rang}`,
			label: `Champ d’essai ${rang}`,
			type,
			// Position au-delà des neuf champs du seed : la liste des clés manquantes est ordonnée
			// par `position` (§6.7), et le champ d'essai doit donc arriver **après** `budget`.
			position: 100 + rang,
			// `multiselect` exige des choix non vides (§2.4), et la valeur `['choix-a']` du tableau
			// de cas doit s'y trouver, sans quoi `CRM-036` refuserait l'écriture pour une raison
			// sans rapport avec ce qui est mesuré ici.
			options: type === 'multiselect' ? { choices: [{ key: 'choix-a', label: 'Choix A' }] } : {},
		},
	})
	expect(reponseChamp.status(), await reponseChamp.text()).toBe(201)
	const champ = ((await reponseChamp.json()) as Champ[])[0]!

	const reponseRegle = await requete.post(REGLES, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: {
			field_id: champ.id,
			step_id: ETAPE_NEGOCIATION,
			workflow_id: WORKFLOW_GLOBAL,
			workspace_id: WORKSPACE_SEED,
			visibility: 'required',
		},
	})
	expect(reponseRegle.status(), await reponseRegle.text()).toBe(201)
	return champ
}

function deplacer(requete: APIRequestContext, jeton: string, corps: Record<string, unknown>) {
	return requete.post('/rest/v1/rpc/move_card', {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		data: corps,
	})
}

test.beforeAll(async ({ request }) => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	await menage(request)
})
test.afterEach(async ({ request }) => {
	await menage(request)
})

// =================================================================================================
// R0 — l'état de départ, constaté avec la clé de service
// =================================================================================================
// Sans ce bloc, le refus mesuré plus bas pourrait venir d'autre chose que de ce qui est mesuré
// (décision 50).

test.describe('R0 — état de départ', () => {
	test('`budget` de `c1` est vide, et `c1` n’est pas à `Négociation`', async ({ request }) => {
		const valeur = await request.get(
			`${VALEURS}?card_id=eq.${CARD_C1}&field_id=eq.${CHAMP_BUDGET}&select=value`,
			{ headers: enTetesService() },
		)
		expect(((await valeur.json()) as { value: unknown }[])[0]?.value).toBeNull()

		const card = await request.get(`/rest/v1/cards?id=eq.${CARD_C1}&select=current_step_id`, {
			headers: enTetesService(),
		})
		expect(((await card.json()) as { current_step_id: string }[])[0]?.current_step_id).not.toBe(
			ETAPE_NEGOCIATION,
		)
	})

	test('sans champ d’essai, le refus ne nomme que `budget`', async ({ request }) => {
		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C1,
			to_step_id: ETAPE_NEGOCIATION,
		})
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.message).toBe('missing_required_fields')
		expect(
			erreur.details,
			'CONDITION DE VALIDITÉ : si la liste nommait déjà autre chose, les scénarios suivants ' +
				'ne pourraient rien conclure de la présence du champ d’essai',
		).toBe('budget')
	})
})

// =================================================================================================
// R1 — les douze cas du tableau partagé, jugés par la base
// =================================================================================================

test.describe('R1 — la base et l’interface lisent « renseigné » de la même façon', () => {
	CAS_RENSEIGNE.forEach((cas, rang) => {
		test(`${cas.nom} → ${cas.renseigne ? 'renseigné' : 'vide'} des deux côtés`, async ({
			request,
		}) => {
			const champ = await poserChampExige(request, rang, cas.type)

			// L'écriture passe par la **vraie route**, avec le jeton réel de l'administratrice : une
			// valeur posée à la clé de service ne prouverait pas qu'un utilisateur peut l'écrire.
			const ecriture = await request.post(VALEURS, {
				headers: {
					...enTetesAuthentifies(jetonAdmin),
					'Content-Type': 'application/json',
					Prefer: 'resolution=merge-duplicates',
				},
				data: {
					card_id: CARD_C1,
					field_id: champ.id,
					// `workflow_id` est la charnière des clés composites de la table (§6.3), et non
					// une commodité : sans lui, l'insertion est refusée en `23502`. MESURÉ.
					workflow_id: WORKFLOW_GLOBAL,
					workspace_id: WORKSPACE_SEED,
					value: cas.valeur,
				},
			})
			expect(
				ecriture.status(),
				`la valeur doit être ÉCRITE pour être jugée : ${await ecriture.text()}`,
			).toBe(201)

			// La ligne est relue : une écriture acceptée ne prouve pas que la valeur est celle-là.
			const relecture = await request.get(
				`${VALEURS}?card_id=eq.${CARD_C1}&field_id=eq.${champ.id}&select=value`,
				{ headers: enTetesService() },
			)
			const enBase = ((await relecture.json()) as { value: unknown }[])[0]
			expect(enBase, 'la ligne existe réellement').toBeDefined()

			const reponse = await deplacer(request, jetonAdmin, {
				card_id: CARD_C1,
				to_step_id: ETAPE_NEGOCIATION,
			})
			expect(reponse.status(), 'le refus tombe de toute façon : `budget` est vide').toBe(400)
			const erreur = (await reponse.json()) as Erreur
			expect(erreur.message).toBe('missing_required_fields')

			const cles = (erreur.details ?? '').split(', ')
			const jugeeVideParLaBase = cles.includes(champ.key)

			expect(
				jugeeVideParLaBase,
				`app.valeur_de_champ_est_vide juge « ${cas.nom} » ${jugeeVideParLaBase ? 'vide' : 'renseignée'} ` +
					`; docs/SPEC-form-composer.md §6.6 dit ${cas.renseigne ? 'renseignée' : 'vide'}`,
			).toBe(!cas.renseigne)

			expect(
				estRenseigne(cas.valeur),
				'ET LA LECTURE TYPESCRIPT DIT LA MÊME CHOSE, sur la même valeur : c’est l’égalité ' +
					'que docs/SPEC-form-composer.md §4.3 exige, et elle est mesurée, pas déclarée',
			).toBe(!jugeeVideParLaBase)
		})
	})
})

// =================================================================================================
// R2 — ce que le rendu écarte, la garde l'écarte aussi
// =================================================================================================
// Le §4.2 range un champ **archivé** hors du formulaire ; le §6.7 pose que la garde ne l'exige pas
// davantage. Les deux règles se répondent, et rien ne les tenait ensemble.

test.describe('R2 — un champ archivé n’est ni affiché ni exigé', () => {
	test('archivé et vide, il ne figure pas dans la liste des clés manquantes', async ({
		request,
	}) => {
		const champ = await poserChampExige(request, 90, 'text')
		const archivage = await request.patch(`${CHAMPS}?id=eq.${champ.id}`, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { archived_at: new Date().toISOString() },
		})
		expect(archivage.status()).toBe(204)

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C1,
			to_step_id: ETAPE_NEGOCIATION,
		})
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(
			(erreur.details ?? '').split(', '),
			'le rendu l’écarte du formulaire (§4.2), la garde ne l’exige pas (§6.7) : les deux ' +
				'lectures se répondent',
		).not.toContain(champ.key)
	})
})
