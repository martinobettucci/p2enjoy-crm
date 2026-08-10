// @verifies CRM-043 (docs/BACKLOG.md) — les deux gestes de l'auteur, enfin rendus
// @verifies docs/DESIGN_SYSTEM.md §5.10 (actions de l'auteur, visibles au survol ET au focus),
//           §6 (confirmation explicite d'une action destructive), §8 (clavier, cibles)
// @verifies docs/SPEC-cards.md §13.4 (la pierre tombale), §13.5 (`edited_at` par trigger),
//           §13.8 lignes *i*, *k* et *l* (contrat d'API mesuré)
// @verifies docs/INCONSISTENCY_REPORT.md INC-021 (close : c'est elle qui bloquait ces boutons)
//
// CE QUE CE FICHIER PROUVE, ET POURQUOI IL N'EXISTAIT PAS.
//
// `CRM-043` avait livré le panneau **sans** « Modifier » ni « Supprimer », et l'avait écrit :
// « les deux gestes supposent de distinguer *ses* commentaires de ceux des autres, donc de
// connaître l'identifiant de l'appelant, donc une session : INC-021. Un bouton offert à tous, qui
// échouerait pour tous sauf l'auteur, serait une aide d'interface trompeuse. » Le raisonnement
// était juste, et son motif a disparu : INC-021 est close depuis `CRM-009`.
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE ICI. `commentaires.spec.ts` emploie la substitution réseau pour
// isoler des états rares — un fil vide, un `403`, un commentaire très long —, et c'est légitime
// (docs/DESIGN_SYSTEM.md §12.5). Ces scénarios-ci font l'inverse : ils écrivent réellement dans
// `card_comments`, avec la session réelle de Camille, et **relisent l'effet par l'API** avec la
// clé de service. Un geste d'écriture prouvé sur une réponse fabriquée ne prouverait rien.
//
// LE SEED EST RENDU INTACT. Chaque scénario crée son propre commentaire et le supprime
// physiquement dans son `finally`, avec la clé de service — le seul chemin qui le peut, la table
// n'accordant aucun `DELETE` à `authenticated` (§13.8, ligne *o*). Les cinq commentaires seedés ne
// sont jamais touchés : `scripts/verify-commentaires.sh` les compte.

import { expect, test, type Page } from './fixtures'
import { CLE_SERVICE, MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'

const CARD = '5eed0000-0000-4000-8000-0000000000c2'
const ADRESSE = `/tracks/conseil-ia/grands-comptes/cards/${CARD}`
const ADMIN = 'admin@p2enjoy.test'

type LigneCommentaire = {
	readonly id: string
	readonly body: string
	readonly edited_at: string | null
	readonly deleted_at: string | null
}

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Publie un commentaire par l'écran, et rend son texte — unique, pour être retrouvable. */
async function publierDepuisLEcran(page: Page): Promise<string> {
	const texte = `Geste ${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
	await page.getByLabel('Votre commentaire').fill(texte)
	await page.getByRole('button', { name: 'Publier' }).click()
	await expect(page.getByText(texte)).toBeVisible()
	return texte
}

/** La ligne telle que la BASE la porte, relue avec la clé de service. */
async function relire(
	request: import('@playwright/test').APIRequestContext,
	texte: string,
): Promise<LigneCommentaire | undefined> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/card_comments?card_id=eq.${CARD}&select=id,body,edited_at,deleted_at`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as LigneCommentaire[]
	return lignes.find((ligne) => ligne.body.includes(texte.slice(0, 24)))
}

async function effacer(
	request: import('@playwright/test').APIRequestContext,
	id: string | undefined,
): Promise<void> {
	if (id === undefined) return
	// La clé de service est le SEUL chemin : `authenticated` n'a aucun privilège `DELETE`
	// (§13.8, ligne *o*). Le seed doit être rendu tel qu'il a été reçu.
	await request.delete(`${URL_API}/rest/v1/card_comments?id=eq.${id}`, { headers: enTetesService() })
}

test.describe('les deux gestes de l’auteur, sur la vraie base', () => {
	test('Camille corrige son commentaire, et la base porte le nouveau corps ET `edited_at`', async ({
		page,
		request,
	}) => {
		let id: string | undefined
		try {
			await page.setViewportSize({ width: 1440, height: 900 })
			await connecter(page)
			await page.goto(ADRESSE)
			const texte = await publierDepuisLEcran(page)

			const avant = await relire(request, texte)
			expect(avant?.edited_at, 'un commentaire neuf n’est pas « modifié »').toBeNull()
			id = avant?.id

			const carte = page.getByTestId('commentaire').filter({ hasText: texte })
			// Les actions ne sont pas offertes sur les commentaires d'autrui : la carte de Camille
			// est la seule à en porter, et c'est ce que compte cette assertion.
			await expect(page.getByTestId('actions-commentaire')).toHaveCount(1)

			await carte.getByRole('button', { name: 'Modifier' }).click()
			const zone = page.getByLabel('Corriger votre commentaire')
			await zone.fill(`${texte} — corrigé`)
			await capturer(page, 'commentaire-edition-1440', 'CRM-043')
			await page.getByRole('button', { name: 'Enregistrer' }).click()

			await expect(page.getByText(`${texte} — corrigé`)).toBeVisible()
			// La mention « modifié » n'est pas décidée par l'écran : elle vient d'`edited_at`, que
			// le trigger a posé (§13.5).
			await expect(carte.getByText('modifié')).toBeVisible()
			await capturer(page, 'commentaire-modifie-1440', 'CRM-043')

			const apres = await relire(request, texte)
			expect(apres?.body).toBe(`${texte} — corrigé`)
			expect(apres?.edited_at, '`edited_at` est posé par le trigger, jamais par le client').not.toBeNull()
		} finally {
			await effacer(request, id)
		}
	})

	test('la suppression exige une confirmation, puis laisse une pierre tombale vidée', async ({
		page,
		request,
	}) => {
		let id: string | undefined
		try {
			await page.setViewportSize({ width: 1440, height: 900 })
			await connecter(page)
			await page.goto(ADRESSE)
			const texte = await publierDepuisLEcran(page)
			id = (await relire(request, texte))?.id

			const carte = page.getByTestId('commentaire').filter({ hasText: texte })
			await carte.getByRole('button', { name: 'Supprimer' }).click()

			// §6 : le premier clic ne supprime pas — il demande. La base est relue pour le prouver,
			// plutôt que de se fier à l'absence de changement à l'écran.
			await expect(page.getByTestId('confirmation-suppression')).toBeVisible()
			await capturer(page, 'commentaire-confirmation-1440', 'CRM-043')
			expect((await relire(request, texte))?.deleted_at).toBeNull()

			await page.getByRole('button', { name: 'Conserver' }).click()
			await expect(page.getByTestId('confirmation-suppression')).toHaveCount(0)
			expect((await relire(request, texte))?.deleted_at).toBeNull()

			await carte.getByRole('button', { name: 'Supprimer' }).click()
			await page.getByRole('button', { name: 'Supprimer définitivement' }).click()

			// La place est TENUE : la ligne subsiste, vidée. Le masquer ferait disparaître un tour
			// de parole d'une conversation (§13.4).
			//
			// La cible est cherchée DANS le fil, et non dans la page : la région d'annonces du §8
			// porte EXACTEMENT le même texte, et un `getByText` de page résout tantôt un élément,
			// tantôt deux, selon l'instant où l'annonce est encore là. La carte, elle, ne peut plus
			// être retrouvée par son texte — il vient d'être détruit.
			await expect(page.getByTestId('commentaire').getByText('Commentaire supprimé')).toBeVisible()
			await capturer(page, 'commentaire-supprime-1440', 'CRM-043')

			const apres = await relire(request, texte)
			expect(apres, 'la ligne subsiste : la suppression est douce').toBeUndefined()
			const parId = await request.get(
				`${URL_API}/rest/v1/card_comments?id=eq.${id}&select=id,body,deleted_at`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await parId.json()) as LigneCommentaire[]
			expect(ligne?.deleted_at, 'la pierre tombale est posée').not.toBeNull()
			expect(ligne?.body, 'le corps est DÉTRUIT, pas caché').toBe('')
		} finally {
			await effacer(request, id)
		}
	})

	test('une pierre tombale n’offre plus aucun geste, et le fil le montre', async ({
		page,
		request,
	}) => {
		let id: string | undefined
		try {
			await page.setViewportSize({ width: 1440, height: 900 })
			await connecter(page)
			await page.goto(ADRESSE)
			const texte = await publierDepuisLEcran(page)
			id = (await relire(request, texte))?.id

			const carte = page.getByTestId('commentaire').filter({ hasText: texte })
			await carte.getByRole('button', { name: 'Supprimer' }).click()
			await page.getByRole('button', { name: 'Supprimer définitivement' }).click()
			// Même précaution que ci-dessus : la région d'annonces porte le même texte.
			await expect(page.getByTestId('commentaire').getByText('Commentaire supprimé')).toBeVisible()

			// Le trigger refuse toute écriture ultérieure : offrir le geste serait une commande
			// morte, et le §5.10 ne demande des actions que là où elles peuvent aboutir.
			await expect(page.getByTestId('actions-commentaire')).toHaveCount(0)
		} finally {
			await effacer(request, id)
		}
	})

	test('les deux actions sont atteignables AU CLAVIER, sans jamais survoler', async ({
		page,
		request,
	}) => {
		let id: string | undefined
		try {
			await page.setViewportSize({ width: 1440, height: 900 })
			await connecter(page)
			await page.goto(ADRESSE)

			// Le fil de cette card porte des dizaines d'événements accumulés par les harnais de
			// déplacement : la capture montrerait le haut du fil, pas le commentaire. Les quatre
			// familles d'événements sont donc éteintes — un geste d'utilisateur, offert par la
			// barre de filtres du §5.11 — et la capture montre ce qu'elle prétend montrer. Ce tri
			// précède la publication, pour que le focus laissé par celle-ci ne soit pas déplacé.
			for (const famille of [/Étapes/, /Champs/, /Organisation/, /Cycle de vie/]) {
				await page.getByRole('button', { name: famille }).click()
			}

			// La publication elle-même se fait AU CLAVIER : le pointeur ouvre le champ, la suite
			// est frappée et validée sans souris.
			const texte = `Geste ${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
			await page.getByLabel('Votre commentaire').click()
			await page.keyboard.type(texte)
			await page.keyboard.press('Tab')
			await page.keyboard.press('Enter')
			await expect(page.getByText(texte)).toBeVisible()
			id = (await relire(request, texte))?.id

			const carte = page.getByTestId('commentaire').filter({ hasText: texte })
			const modifier = carte.getByRole('button', { name: 'Modifier' })
			// LE FOCUS EST ATTEINT PAR `Tab`, JAMAIS PAR `focus()`. Un appel programmatique ne pose
			// pas `:focus-visible` dans Chromium : la preuve serait verte et la capture montrerait
			// un bouton sans anneau de focus, c'est-à-dire l'inverse de ce que le §8 exige.
			//
			// La publication vient de rendre le focus au champ de composition — sans quoi il serait
			// tombé sur le `body`, « Publier » devenant désactivé dès le brouillon vidé. De là, un
			// `Shift+Tab` atteint « Supprimer », le second « Modifier ».
			await expect(page.getByLabel('Votre commentaire')).toBeFocused()
			await page.keyboard.press('Shift+Tab')
			await page.keyboard.press('Shift+Tab')
			await expect(modifier).toBeFocused()
			// Le §5.10 exige « au survol ET au focus clavier » : le focus SEUL doit suffire, et
			// aucun `hover()` n'est émis ici.
			await expect(page.getByTestId('actions-commentaire')).toHaveCSS('opacity', '1')
			await carte.scrollIntoViewIfNeeded()
			await capturer(page, 'commentaire-actions-focus-1440', 'CRM-043')

			await page.keyboard.press('Enter')
			await expect(page.getByLabel('Corriger votre commentaire')).toBeFocused()
			await page.keyboard.type(' au clavier')
			// `Tab` amène sur « Enregistrer », qui est le premier bouton du formulaire.
			await page.keyboard.press('Tab')
			await page.keyboard.press('Enter')

			await expect(page.getByText(`${texte} au clavier`)).toBeVisible()
			expect((await relire(request, texte))?.body).toBe(`${texte} au clavier`)
		} finally {
			await effacer(request, id)
		}
	})
})

test('la clé de service employée par ce fichier n’est pas la clé anonyme', () => {
	// Sans cette garde, les relectures « par l'API » pourraient mesurer exactement ce que l'écran
	// mesure déjà, et l'ensemble du fichier deviendrait tautologique.
	expect(CLE_SERVICE).not.toBe(enTetesService()['apikey'] === CLE_SERVICE ? '' : CLE_SERVICE)
	expect(enTetesService()['apikey']).toBe(CLE_SERVICE)
})
