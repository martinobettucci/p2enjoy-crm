// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 2, sous-tranche 2b : L'ÉCRAN
// @verifies docs/SPEC-modeles-emails.md §9.3 (le guichet public et la mesure qui l'impose), §9.9
//           (les quatre lignes du contrat d'API), §2.4 (les douze variables et leur source)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus se mesure hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve avec le jeton réel du profil)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0055_guichet_variables_modeles.test.sql`
// prouve la forme du guichet EN BASE, sous des rôles endossés. Rien n'y garantit que la pile le
// rende par la vraie route : une fonction absente du cache de schéma rendrait `404 / PGRST202`, un
// privilège mal posé rendrait `200` là où le contrat annonce `401`, et la suite pgTAP resterait
// verte dans les deux cas. C'est exactement le défaut que la décision 504 a mesuré sur la
// migration 53, et il ne se redécouvre pas.
//
// CE FICHIER N'ÉCRIT RIEN. Le guichet ne lit aucune table et n'a aucun effet : le seed est intact
// par construction, et aucun nettoyage n'est nécessaire.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const GUICHET = '/rest/v1/rpc/mail_template_variables'

/**
 * Les douze variables du §2.4, écrites ICI À LA MAIN et non lues depuis le produit.
 *
 * C'est délibéré : une preuve qui lirait la liste depuis la même source que l'implémentation ne
 * prouverait que sa propre cohérence. Écrite ici, elle fige le contrat que le chapitre annonce, et
 * une variable retirée du §2.4 sans être retirée du chapitre fera rougir cette ligne.
 */
const VARIABLES_ATTENDUES = [
	'card.amount',
	'card.channel',
	'card.currency',
	'card.next_action',
	'card.next_action_at',
	'card.step',
	'card.title',
	'contact.email',
	'contact.full_name',
	'contact.organization',
	'identity.from_address',
	'identity.from_name',
] as const

test.describe('CRM-063 §9.9 — contrat du guichet des variables de modèle', () => {
	// LIGNE 1 — le refus de l'anonyme est un `401` de PRIVILÈGE, et non un `200 []`.
	//
	// La distinction n'est pas cosmétique : la LECTURE de `mail_templates` rend bien `200 []` à
	// l'anonyme (§2.7 ligne 1), sa politique étant ouverte `to anon` et FILTRANT. Ici la fonction
	// n'est pas exécutable du tout. Confondre les deux masquerait la disparition de l'un des deux
	// remparts.
	test('a — un appelant anonyme est refusé par le PRIVILÈGE', async ({ request }) => {
		const reponse = await request.post(GUICHET, { headers: enTetesAnonymes(), data: {} })

		expect(reponse.status()).toBe(401)
		const corps = (await reponse.json()) as { code?: string }
		expect(corps.code).toBe('42501')
	})

	// LIGNES 2 ET 3 — la liste ne dépend pas du rôle, et la lectrice l'obtient.
	//
	// C'est ce qui rend la palette de l'écran utilisable par tout le monde : la lectrice ne peut pas
	// écrire de modèle, mais l'écran ne calcule aucun droit et n'éteint aucune commande — c'est la
	// base qui refuse l'écriture, pas la palette qui se dérobe.
	test('b — la lectrice et l’administratrice reçoivent la MÊME liste', async ({ request }) => {
		const jetonLectrice = await jetonDe('viewer@p2enjoy.test')
		const jetonAdmin = await jetonDe('admin@p2enjoy.test')

		const parLaLectrice = await request.post(GUICHET, {
			headers: enTetesAuthentifies(jetonLectrice),
			data: {},
		})
		const parLAdmin = await request.post(GUICHET, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {},
		})

		expect(parLaLectrice.status()).toBe(200)
		expect(parLAdmin.status()).toBe(200)
		const listeLectrice = (await parLaLectrice.json()) as string[]
		const listeAdmin = (await parLAdmin.json()) as string[]
		expect(listeLectrice).toEqual(listeAdmin)
	})

	// LIGNE 4 — la comparaison au §2.4, NOM À NOM et jamais par le cardinal.
	//
	// Une assertion sur « douze » resterait verte sur douze mauvais noms, et c'est précisément le
	// défaut contre lequel le §3 écrit la liste une seule fois.
	test('c — les douze noms du §2.4, un à un et dans l’ordre trié', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.post(GUICHET, {
			headers: enTetesAuthentifies(jeton),
			data: {},
		})

		expect(reponse.status()).toBe(200)
		const liste = (await reponse.json()) as string[]
		expect(liste).toEqual([...VARIABLES_ATTENDUES])
	})

	// LE GUICHET DÉLÈGUE, ET LA PREUVE LE CONSTATE PAR LE PRODUIT.
	//
	// Un modèle dont TOUTES les variables viennent de cette liste doit être ACCEPTÉ par la
	// contrainte de la migration `0055`, qui appelle `app.mail_template_variables()`. Si le guichet
	// cessait de déléguer et rendait une liste figée, cette écriture serait refusée — et c'est le
	// seul contrôle qui relie les deux fonctions par le comportement du produit plutôt que par une
	// égalité de catalogue.
	test('d — un modèle bâti depuis la liste du guichet est ACCEPTÉ par la contrainte', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const parLeGuichet = await request.post(GUICHET, {
			headers: enTetesAuthentifies(jeton),
			data: {},
		})
		const variables = (await parLeGuichet.json()) as string[]
		const gabarit = variables.map((variable) => `{{${variable}}}`).join(' ')

		const cree = await request.post('/rest/v1/mail_templates', {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: {
				workspace_id: '5eed0000-0000-4000-8000-000000000001',
				name: 'preuve-api-guichet-0063',
				subject: gabarit,
				body_text: gabarit,
			},
		})

		expect(cree.status()).toBe(201)
		const [ligne] = (await cree.json()) as { id: string }[]
		expect(ligne).toBeDefined()

		// LE SEED EST RENDU INTACT : la ligne créée est retirée, et le compte relu.
		const retire = await request.delete(
			`/rest/v1/mail_templates?id=eq.${ligne?.id ?? ''}`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(retire.status()).toBe(204)

		const restants = await request.get(
			'/rest/v1/mail_templates?select=id&name=like.preuve-api-guichet-*',
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(((await restants.json()) as unknown[]).length).toBe(0)
	})
})
