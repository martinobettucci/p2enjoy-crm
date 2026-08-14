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
import {
	CLE_SERVICE,
	MOT_DE_PASSE_SEED,
	URL_API,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from '../api/jetons'
import { capturer } from './captures'

const CARD = '5eed0000-0000-4000-8000-0000000000c2'
const ADRESSE = `/tracks/conseil-ia/grands-comptes/cards/${CARD}`
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'

/** Les deux identifiants de profil du seed dont ce fichier a besoin — `docs/SPEC-seed.md` §2.3. */
const PROFIL_CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const PROFIL_DRISS = '5eed0000-0000-4000-8000-000000000012'

/** La card du seed qui porte le commentaire RETIRÉ PAR LA MODÉRATION — `…0d4` sur `…0c4`. */
const CARD_MODEREE = '5eed0000-0000-4000-8000-0000000000c4'
const ADRESSE_MODEREE = `/tracks/studio-web/refonte/cards/${CARD_MODEREE}`

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

type LigneCommentaire = {
	readonly id: string
	readonly body: string
	readonly edited_at: string | null
	readonly deleted_at: string | null
	readonly deleted_by: string | null
	readonly author_id: string | null
}

async function connecter(page: Page, adresse = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(adresse)
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
		`${URL_API}/rest/v1/card_comments?card_id=eq.${CARD}` +
			'&select=id,body,edited_at,deleted_at,deleted_by,author_id',
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

// @verifies CRM-043 (docs/BACKLOG.md) — le geste de MODÉRATION, INC-072
// @verifies docs/SPEC-cards.md §13.6 (l'admin supprime, ne modifie pas ; `deleted_by` audite),
//           §13.10 (à qui le geste est offert), §13.11 (le seed démontre le retrait)
// @verifies docs/DESIGN_SYSTEM.md §5.10 (action de modération, confirmation distincte)
// @verifies docs/JOURNAL.md décision 376
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE ICI NON PLUS. Le commentaire du tiers est écrit par le JETON RÉEL
// de Driss Lemoine — la politique d'insertion exige `author_id = auth.uid()`, la clé de service
// n'aurait donc pas produit un propos d'autrui crédible —, retiré par la session réelle de Camille
// Aubert depuis l'écran, et l'effet est relu par l'API avec la clé de service.
test.describe('la modération, sur la vraie base (INC-072)', () => {
	/** Publie un commentaire AVEC LE JETON DE DRISS, et rend son identifiant et son texte. */
	async function publierCommeDriss(
		request: import('@playwright/test').APIRequestContext,
	): Promise<{ id: string; texte: string }> {
		const texte = `Propos d’un tiers ${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
		const jeton = await jetonDe(BIZDEV)
		const reponse = await request.post(`${URL_API}/rest/v1/card_comments`, {
			headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
			data: { card_id: CARD, workspace_id: WORKSPACE, body: texte },
		})
		expect(reponse.status(), 'un business_developer peut écrire sur ce channel').toBe(201)
		const [ligne] = (await reponse.json()) as LigneCommentaire[]
		expect(ligne?.author_id, 'la ligne porte bien Driss pour auteur').toBe(PROFIL_DRISS)
		return { id: ligne?.id ?? '', texte }
	}

	test('Camille retire le propos d’un tiers, et la base nomme le modérateur', async ({
		page,
		request,
	}) => {
		let id: string | undefined
		try {
			await page.setViewportSize({ width: 1440, height: 900 })
			const { id: idPublie, texte } = await publierCommeDriss(request)
			id = idPublie

			await connecter(page, ADMIN)
			await page.goto(ADRESSE)
			const carte = page.getByTestId('commentaire').filter({ hasText: texte })
			await expect(carte).toBeVisible()

			// UNE SEULE ACTION, ET C'EST TOUTE LA RÈGLE (§13.6). « Modifier » n'est pas rendu :
			// réécrire le propos d'autrui est une falsification, que le trigger refuse par
			// `comment_moderation_limitee`.
			await expect(carte.getByTestId('actions-moderation')).toHaveCount(1)
			await expect(carte.getByRole('button', { name: 'Modifier' })).toHaveCount(0)

			// LA RÈGLE LA PLUS VISIBLE DE L'UNITÉ ÉTAIT LA SEULE QUE PERSONNE NE REGARDAIT
			// (décision 379, `CLAUDE.md` §16). Les deux assertions ci-dessus la tiennent, mais
			// aucune capture ne la montrait : la suivante est prise APRÈS le clic, au moment où la
			// confirmation a déjà pris la place du corps (§5.10). L'état qui porte la règle — une
			// action et une seule sur le commentaire d'un tiers — n'existait donc dans aucun
			// dossier de captures. Celle-ci le fixe, et elle est prise AVANT le clic pour cette
			// raison précise : une forme qu'aucune capture ne montre n'est pas vérifiée
			// visuellement, elle est seulement affirmée.
			//
			// LE SURVOL N'EST PAS UN CONFORT DE MISE EN SCÈNE, IL EST LA CONDITION DE LA PREUVE, et
			// la première version de cette capture l'a appris en ne montrant RIEN : les actions
			// sont rendues `opacity-0` et révélées par `group-hover` ou `group-focus-within`
			// (docs/DESIGN_SYSTEM.md §5.10). Sans survol, la capture fixait une rangée vide et
			// prouvait le contraire de ce qu'elle prétend — défaut vu sur la capture, et sur elle
			// seule. Le survol place donc l'écran dans le seul état où la règle est VISIBLE.
			await carte.scrollIntoViewIfNeeded()
			await carte.hover()

			// `toBeVisible()` NE SUFFIT PAS ICI, et la deuxième version de la capture l'a appris à
			// son tour : pour Playwright, un élément `opacity-0` occupant une surface EST visible.
			// L'assertion passait donc pendant le fondu, et la capture fixait un « Supprimer »
			// à demi transparent — lisible pour la machine, délavé pour l'œil. On attend donc que
			// l'opacité RÉELLEMENT CALCULÉE atteigne 1. C'est une OBSERVATION de l'état de l'écran,
			// et non une temporisation arbitraire, que `CLAUDE.md` §18 proscrit : rien n'est attendu
			// pendant une durée choisie, c'est la fin du fondu qui est constatée.
			const actions = carte.getByTestId('actions-moderation')
			await expect
				.poll(() => actions.evaluate((noeud) => getComputedStyle(noeud).opacity))
				.toBe('1')
			await expect(carte.getByRole('button', { name: 'Supprimer' })).toBeVisible()
			await capturer(page, 'moderation-actions-1440', 'CRM-043')

			await carte.getByRole('button', { name: 'Supprimer' }).click()

			// La confirmation est DISTINCTE de celle de l'auteur, et nomme la trace nominative.
			await expect(page.getByTestId('confirmation-moderation')).toBeVisible()
			await expect(page.getByTestId('confirmation-suppression')).toHaveCount(0)
			// LA CARTE N'EST PLUS RETROUVABLE PAR SON TEXTE, et c'est le comportement voulu : la
			// confirmation PREND LA PLACE du corps (docs/DESIGN_SYSTEM.md §5.10). Réutiliser
			// `carte`, filtrée par `hasText`, attendrait indéfiniment un texte qui n'est plus
			// rendu — défaut trouvé en exécutant la preuve, pas à la lecture. On amène donc la
			// confirmation elle-même dans le cadre.
			await page.getByTestId('confirmation-moderation').scrollIntoViewIfNeeded()
			await capturer(page, 'moderation-confirmation-1440', 'CRM-043')

			// §6 : le premier clic DEMANDE. La base est relue pour le prouver.
			expect((await relire(request, texte))?.deleted_at).toBeNull()

			await page.getByRole('button', { name: 'Retirer définitivement' }).click()

			// La pierre tombale dit qu'un TIERS est intervenu — la mention diffère de celle d'une
			// suppression par l'auteur, et elle vient de la donnée.
			await expect(
				page.getByTestId('commentaire').getByText('Commentaire retiré par la modération'),
			).toBeVisible()
			await capturer(page, 'moderation-pierre-tombale-1440', 'CRM-043')

			const parId = await request.get(
				`${URL_API}/rest/v1/card_comments?id=eq.${id}` +
					'&select=id,body,edited_at,deleted_at,deleted_by,author_id',
				{ headers: enTetesService() },
			)
			const [ligne] = (await parId.json()) as LigneCommentaire[]
			expect(ligne?.deleted_at, 'la pierre tombale est posée').not.toBeNull()
			expect(ligne?.body, 'le corps est DÉTRUIT, pas caché').toBe('')
			// L'AUDIT : le retrait est nominatif, et il n'est pas celui de l'auteur.
			expect(ligne?.deleted_by, 'le modérateur est relevé par le trigger').toBe(PROFIL_CAMILLE)
			expect(ligne?.author_id, 'l’auteur reste Driss').toBe(PROFIL_DRISS)
			expect(ligne?.deleted_by).not.toBe(ligne?.author_id)
			// La modération ne falsifie rien : `edited_at` reste vierge.
			expect(ligne?.edited_at, 'un retrait ne « modifie » pas le propos').toBeNull()
		} finally {
			await effacer(request, id)
		}
	})

	// MESURÉ sur la pile : un `business_developer` qui tenterait le `PATCH` reçoit `200` et zéro
	// ligne. L'écran ne lui offre donc rien — une commande morte serait pire que rien (§5.10).
	test('un business_developer ne se voit offrir AUCUNE action sur le propos d’un tiers', async ({
		page,
		request,
	}) => {
		let id: string | undefined
		try {
			await page.setViewportSize({ width: 1440, height: 900 })
			// Le propos est celui de CAMILLE cette fois : Driss doit être un tiers vis-à-vis de lui.
			const texte = `Propos de l’administratrice ${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
			const jeton = await jetonDe(ADMIN)
			const reponse = await request.post(`${URL_API}/rest/v1/card_comments`, {
				headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
				data: { card_id: CARD, workspace_id: WORKSPACE, body: texte },
			})
			expect(reponse.status()).toBe(201)
			const [publie] = (await reponse.json()) as LigneCommentaire[]
			id = publie?.id

			await connecter(page, BIZDEV)
			await page.goto(ADRESSE)
			const carte = page.getByTestId('commentaire').filter({ hasText: texte })
			await expect(carte).toBeVisible()

			await expect(carte.getByTestId('actions-moderation')).toHaveCount(0)
			await expect(carte.getByRole('button', { name: 'Supprimer' })).toHaveCount(0)
			await expect(carte.getByRole('button', { name: 'Modifier' })).toHaveCount(0)

			// LA RÈGLE EST AILLEURS, ET ON LE PROUVE SANS L'INTERFACE (`CLAUDE.md` §10) : le même
			// geste, tenté avec le jeton réel de Driss, rend `200` et ZÉRO ligne.
			const tentative = await request.patch(`${URL_API}/rest/v1/card_comments?id=eq.${id}`, {
				headers: {
					...enTetesAuthentifies(await jetonDe(BIZDEV)),
					Prefer: 'return=representation',
				},
				data: { body: '', deleted_at: '2026-01-01T00:00:00Z' },
			})
			expect(tentative.status(), 'le `USING` filtre : ni erreur, ni effet').toBe(200)
			expect((await tentative.json()) as unknown[], 'aucune ligne touchée').toHaveLength(0)
			expect((await relire(request, texte))?.deleted_at, 'le propos est intact').toBeNull()
		} finally {
			await effacer(request, id)
		}
	})

	// LE SEED DÉMONTRE LA MODÉRATION, ET L'ÉCRAN LE MONTRE — §13.11, décision 376. Sans cette
	// preuve, la modération du seed serait invisible depuis le produit, et la colonne d'audit ne
	// serait lue par personne.
	test('le commentaire retiré du seed se lit comme tel dans le fil', async ({ page, request }) => {
		await page.setViewportSize({ width: 1440, height: 900 })

		// L'état de la base est lu D'ABORD : si le seed n'avait pas modéré `…0d4`, l'assertion
		// d'écran serait rouge sans qu'on sache pourquoi.
		const reponse = await request.get(
			`${URL_API}/rest/v1/card_comments?id=eq.5eed0000-0000-4000-8000-0000000000d4` +
				'&select=id,body,edited_at,deleted_at,deleted_by,author_id',
			{ headers: enTetesService() },
		)
		const [ligne] = (await reponse.json()) as LigneCommentaire[]
		expect(ligne?.deleted_by, 'le seed retire `…0d4` avec le jeton de Camille').toBe(PROFIL_CAMILLE)
		expect(ligne?.author_id, 'l’auteur du propos est Driss').toBe(PROFIL_DRISS)

		await connecter(page, ADMIN)
		await page.goto(ADRESSE_MODEREE)
		await expect(
			page.getByTestId('commentaire').getByText('Commentaire retiré par la modération'),
		).toBeVisible()
		// §13.13, point 7 : l'écran dit qu'un tiers est intervenu, jamais qui.
		await expect(page.getByTestId('commentaire').getByText('Camille Aubert')).toHaveCount(0)
		await capturer(page, 'moderation-seed-1440', 'CRM-043')
	})
})

test('la clé de service employée par ce fichier n’est pas la clé anonyme', () => {
	// Sans cette garde, les relectures « par l'API » pourraient mesurer exactement ce que l'écran
	// mesure déjà, et l'ensemble du fichier deviendrait tautologique.
	expect(CLE_SERVICE).not.toBe(enTetesService()['apikey'] === CLE_SERVICE ? '' : CLE_SERVICE)
	expect(enTetesService()['apikey']).toBe(CLE_SERVICE)
})
