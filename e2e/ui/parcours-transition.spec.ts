// @verifies CRM-037 (docs/BACKLOG.md) — « transition bloquée → saisie → transition réussie »
// @verifies docs/SPEC-form-composer.md §4 quater (contrat du parcours enchaîné, mesuré), §4 bis
//           (la saisie depuis la fiche), §4 ter (la reprise d'un déplacement refusé), §7.3
// @verifies docs/SPEC-workflow-engine.md §7.9, §7.10 (retour arrière et bandeau de refus)
// @verifies docs/SPEC-permissions-rls.md §7 — la relecture se fait avec le jeton du même profil
// @verifies CLAUDE.md §15 (E2E depuis un état déterministe), §16 (capture observée)
//
// LA PREUVE QUE LES AUTRES NE POUVAIENT PAS FAIRE. `e2e/ui/board.spec.ts` et
// `e2e/ui/formulaire.spec.ts` éprouvent chacun leur geste contre des réponses réseau
// **substituées** — procédé endossé par `docs/DESIGN_SYSTEM.md` §12.5. Une substitution prouve que
// l'écran réagit correctement à une réponse donnée ; elle ne prouve pas que le serveur rend cette
// réponse-là, ni que l'écriture émise par l'écran suffit à lever le refus que la garde oppose.
//
// Ce fichier n'en pose aucune : le navigateur obtient son jeton par le formulaire réel, et chaque
// requête part à la vraie API. Les trois jonctions du §4 quater.1 y sont les seules choses
// vérifiées — la clé nommée par la garde, la ligne écrite dans `card_field_values`, et la
// réussite du second déplacement, relue en base.
//
// La card support est **fabriquée** avec la clé de service et détruite dans un `finally` : le seed
// ne place aucune affaire à l'étape « Signature », et l'y placer appartiendrait à `CRM-046`
// (§4 quater.2). Même motif que la preuve n° 3 de `CRM-014`, qui fabrique son second workspace.

import {
	autoriserErreursConsole,
	ERREUR_RESSOURCE_HTTP,
	expect,
	test,
	type APIRequestContext,
	type Page,
} from './fixtures'
import { randomUUID } from 'node:crypto'
import { URL_API, MOT_DE_PASSE_SEED, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { capturer } from './captures'

const ADMIN = 'admin@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_SIGNATURE = '5eed0000-0000-4000-8000-000000000064'
const ETAPE_REALISATION = '5eed0000-0000-4000-8000-000000000065'
const CHAMP_LIEN_PROPOSITION = '5eed0000-0000-4000-8000-000000000086'

/** Le libellé de la transition `…0074`, celui que le menu du board offre (§7.8 du moteur). */
const TRANSITION = 'Démarrer la réalisation'
/** La CLÉ du champ, celle que la garde met dans `details` et que l'adresse transporte (§4 ter.3). */
const CLE_CHAMP = 'lien-proposition'
/** Son LIBELLÉ, celui que le bandeau de refus affiche à l'utilisateur (§7.10 du moteur). */
const LIBELLE_CHAMP = 'Lien vers la proposition'
const VALEUR = 'https://p2enjoy.test/propositions/parcours-enchaine'

const ROUTE_BOARD = '/tracks/conseil-ia/grands-comptes'

let jetonAdmin: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe(ADMIN)
})

function urlRest(table: string, parametres: Readonly<Record<string, string>> = {}): string {
	const url = new URL(`/rest/v1/${table}`, URL_API)
	for (const [cle, valeur] of Object.entries(parametres)) url.searchParams.set(cle, valeur)
	return url.toString()
}

/** Connexion par le formulaire réel, au clavier — jamais un jeton posé à la main dans l'onglet. */
async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/**
 * Pose une affaire à l'étape « Signature », d'où la transition exige `lien-proposition`.
 *
 * La clé de service contourne la RLS : elle sert à faire EXISTER le support, jamais à prouver un
 * droit. Tous les gestes du parcours passent ensuite par la session réelle de l'administratrice.
 */
async function fabriquerCard(
	request: APIRequestContext,
	idCard: string,
	titre: string,
): Promise<void> {
	const creation = await request.post(urlRest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id: idCard,
			workspace_id: WORKSPACE,
			channel_id: CHANNEL_GRANDS_COMPTES,
			workflow_id: WORKFLOW_GLOBAL,
			current_step_id: ETAPE_SIGNATURE,
			title: titre,
		},
	})
	expect(creation.status(), await creation.text()).toBe(201)
}

async function detruireCard(request: APIRequestContext, idCard: string): Promise<void> {
	// L'ordre importe : `card_field_values` porte une clé étrangère vers la card.
	await request.delete(urlRest('card_field_values', { card_id: `eq.${idCard}` }), {
		headers: enTetesService(),
	})
	await request.delete(urlRest('cards', { id: `eq.${idCard}` }), { headers: enTetesService() })
}

test.describe('le parcours enchaîné, sans aucune substitution réseau (§4 quater)', () => {
	test('refus, reprise, saisie, second déplacement : la base porte la nouvelle étape', async ({
		page,
		request,
	}) => {
		const idCard = randomUUID()
		const titre = `tst-crm037 parcours ${idCard.slice(0, 8)}`
		await fabriquerCard(request, idCard, titre)

		try {
			await page.setViewportSize({ width: 1440, height: 900 })
			await connecter(page)
			await page.goto(ROUTE_BOARD)

			// 2. La card fabriquée est là, dans la colonne « Signature ».
			const carte = page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)
			await expect(carte).toContainText(titre)
			const colonneSignature = page.locator(
				`[data-testid="colonne"][data-etape="${ETAPE_SIGNATURE}"]`,
			)
			await expect(colonneSignature.locator(`[data-card="${idCard}"]`)).toHaveCount(1)

			// 3. Le déplacement est REFUSÉ par la garde, et le refus vient du serveur.
			await carte.getByRole('button', { name: `Déplacer ${titre}` }).click()
			await carte.getByRole('button', { name: TRANSITION }).click()

			const refus = page.getByTestId('refus-deplacement')
			await expect(refus).toBeVisible()
			await expect(refus).toHaveAttribute('data-cle', 'missing_required_fields')
			// Le LIBELLÉ à l'écran, la CLÉ dans l'adresse : les deux sont vérifiés, et ils diffèrent.
			await expect(page.getByTestId('champs-manquants')).toContainText(LIBELLE_CHAMP)

			// 4. Retour arrière : l'affaire n'a pas bougé de sa colonne (§7.9 du moteur).
			await expect(colonneSignature.locator(`[data-card="${idCard}"]`)).toHaveCount(1)
			await expect(
				page.locator(`[data-testid="colonne"][data-etape="${ETAPE_REALISATION}"]`)
					.locator(`[data-card="${idCard}"]`),
			).toHaveCount(0)
			// Le `400` du refus est la SEULE erreur console que ce parcours admet, et elle est
			// consommée là où elle est provoquée (§4 quater.4).
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])

			await capturer(page, 'parcours-refus-1440', 'CRM-037')

			// 5. La reprise est suivie AU CLIC, comme un utilisateur le ferait.
			const reprise = page.getByTestId('reprendre-saisie')
			await expect(reprise).toBeVisible()
			await reprise.click()
			await expect(page).toHaveURL(new RegExp(`/cards/${idCard}\\?exiges=${CLE_CHAMP}$`))

			// 6. La fiche rend le champ exigé, il porte le focus, sa mention est visible.
			const bloc = page.getByTestId(`champ-${CLE_CHAMP}`)
			await expect(bloc).toBeVisible()
			await expect(bloc).toHaveAttribute('data-exige', 'true')
			await expect(page.getByTestId(`exige-${CLE_CHAMP}`)).toBeVisible()
			const controle = page.locator(`#champ-${CLE_CHAMP}`)
			await expect(controle).toBeFocused()
			await expect(controle).toBeEditable()

			// 7. La valeur est saisie AU CLAVIER, et l'écriture part à la perte du focus (§4 bis.3).
			await page.keyboard.type(VALEUR)
			await page.keyboard.press('Tab')
			const etat = page.getByTestId(`etat-${CLE_CHAMP}`)
			await expect(etat).toContainText('Enregistré')

			await capturer(page, 'parcours-saisie-session-reelle-1440', 'CRM-037')

			// 8. RELECTURE HORS INTERFACE, avec le jeton du même profil : un affichage confirmé
			//    n'est pas une écriture confirmée (§4 quater.4).
			const valeurEcrite = await request.get(
				urlRest('card_field_values', {
					card_id: `eq.${idCard}`,
					field_id: `eq.${CHAMP_LIEN_PROPOSITION}`,
					select: 'field_id,value',
				}),
				{ headers: enTetesAuthentifies(jetonAdmin) },
			)
			expect(valeurEcrite.status(), await valeurEcrite.text()).toBe(200)
			expect(await valeurEcrite.json()).toEqual([
				{ field_id: CHAMP_LIEN_PROPOSITION, value: VALEUR },
			])

			// 9. Retour au board, le même geste est rejoué — et il RÉUSSIT.
			await page.goto(ROUTE_BOARD)
			const carteApres = page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)
			await carteApres.getByRole('button', { name: `Déplacer ${titre}` }).click()
			await carteApres.getByRole('button', { name: TRANSITION }).click()

			// La colonne bouge de façon optimiste ; la région live n'annonce qu'après la réponse
			// réelle de `move_card` (docs/SPEC-test-harness.md §7.2).
			await expect(page.getByRole('status', { name: 'Annonces du board' })).toHaveText(
				'Affaire déplacée vers Réalisation en cours',
			)
			await expect(page.getByTestId('refus-deplacement')).toHaveCount(0)

			// 10. Et la base porte la nouvelle étape, relue hors interface.
			const relecture = await request.get(
				urlRest('cards', { id: `eq.${idCard}`, select: 'id,current_step_id' }),
				{ headers: enTetesAuthentifies(jetonAdmin) },
			)
			expect(relecture.status(), await relecture.text()).toBe(200)
			expect(await relecture.json()).toEqual([{ id: idCard, current_step_id: ETAPE_REALISATION }])

			// La colonne d'arrivée est hors de la fenêtre : le board défile horizontalement. La
			// capture doit montrer l'affaire À SA NOUVELLE PLACE, sinon elle ne montre qu'un vide.
			const colonneArrivee = page.locator(
				`[data-testid="colonne"][data-etape="${ETAPE_REALISATION}"]`,
			)
			await colonneArrivee.scrollIntoViewIfNeeded()
			await expect(colonneArrivee.locator(`[data-card="${idCard}"]`)).toContainText(titre)
			await capturer(page, 'parcours-transition-reussie-1440', 'CRM-037')
		} finally {
			await detruireCard(request, idCard)
		}
	})

	test('la garde lit la VALEUR, pas la ligne : présente mais vide, le refus revient à l’identique', async ({
		page,
		request,
	}) => {
		// Contre-épreuve du scénario ci-dessus. Sans elle, le seul passage sur la fiche pourrait
		// passer pour la cause de la réussite (§4 quater.3 bis).
		const idCard = randomUUID()
		const titre = `tst-crm037 vide ${idCard.slice(0, 8)}`
		await fabriquerCard(request, idCard, titre)

		try {
			// MESURÉ, ligne *g* du §4 quater.3 bis : sur un champ `url`, la chaîne vide n'est pas
			// exprimable — la validation de `CRM-036` la refuse AVANT la garde. « Vide » s'écrit
			// donc `null`. Le constat est figé ici plutôt que redécouvert.
			const chaineVide = await request.post(
				urlRest('card_field_values', { on_conflict: 'card_id,field_id' }),
				{
					headers: {
						...enTetesAuthentifies(jetonAdmin),
						Prefer: 'resolution=merge-duplicates',
					},
					data: {
						card_id: idCard,
						workspace_id: WORKSPACE,
						workflow_id: WORKFLOW_GLOBAL,
						field_id: CHAMP_LIEN_PROPOSITION,
						value: '',
					},
				},
			)
			expect(chaineVide.status()).toBe(400)
			expect(await chaineVide.json()).toMatchObject({
				code: 'P0001',
				message: 'invalid_field_value',
			})

			// Lignes *e* et *f* : la ligne EXISTE, sa valeur est vide, et la garde refuse quand même.
			const ecriture = await request.post(
				urlRest('card_field_values', { on_conflict: 'card_id,field_id' }),
				{
					headers: {
						...enTetesAuthentifies(jetonAdmin),
						Prefer: 'resolution=merge-duplicates,return=representation',
					},
					data: {
						card_id: idCard,
						workspace_id: WORKSPACE,
						workflow_id: WORKFLOW_GLOBAL,
						field_id: CHAMP_LIEN_PROPOSITION,
						value: null,
					},
				},
			)
			expect(ecriture.status(), await ecriture.text()).toBe(201)
			expect(await ecriture.json()).toMatchObject([{ value: null }])

			await connecter(page)
			await page.goto(ROUTE_BOARD)
			const carte = page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)
			await carte.getByRole('button', { name: `Déplacer ${titre}` }).click()
			await carte.getByRole('button', { name: TRANSITION }).click()

			const refus = page.getByTestId('refus-deplacement')
			await expect(refus).toBeVisible()
			await expect(refus).toHaveAttribute('data-cle', 'missing_required_fields')
			await expect(page.getByTestId('champs-manquants')).toContainText(LIBELLE_CHAMP)
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])

			const relecture = await request.get(
				urlRest('cards', { id: `eq.${idCard}`, select: 'current_step_id' }),
				{ headers: enTetesAuthentifies(jetonAdmin) },
			)
			expect(await relecture.json()).toEqual([{ current_step_id: ETAPE_SIGNATURE }])
		} finally {
			await detruireCard(request, idCard)
		}
	})
})
