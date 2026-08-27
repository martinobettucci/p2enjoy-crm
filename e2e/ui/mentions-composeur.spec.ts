// @verifies CRM-064 (docs/BACKLOG.md) — sous-tranche 3b : le sélecteur de mentions, sur session
//           réelle
// @verifies docs/SPEC-notifications.md §36 (ce que l'écran rend, règle par règle), §36.3 (la liste
//           n'est lue qu'à l'ouverture), §36.4 (les quatre états), §36.5 (le compte),
//           §35.2 (une requête par personne), §35.3 (le commentaire publié n'est jamais retiré),
//           §35.4 (les trois issues), §5.1 (l'éligibilité), §40
// @verifies docs/SPEC-notifications.md §50 (l'état vide du sélecteur, tranché), §50.5 (la
//           destruction est un contrat), §50.6 (les huit points du parcours)
// @verifies docs/DESIGN_SYSTEM.md §5.44 (cette surface), §7 (les quatre paliers), §8 (clavier) ;
//           CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, le navigateur obtient son jeton par le formulaire réel puis parle à la
// vraie API, et la liste du sélecteur vient de `public.mentionnables` sur la vraie base.
//
// LE CROISEMENT EXERCÉ EST CELUI DU SEED, ET IL EST DÉJÀ LÀ (§38) : Farida est éligible sur
// « Maintenance » et ne l'est pas sur « Grands comptes ». Le même écran, ouvert sur deux affaires,
// offre donc deux listes différentes — et c'est ce qui distingue un sélecteur qui applique la règle
// d'un sélecteur qui rend partout les membres du workspace.
//
// LE SEED SORT INTACT : le seul scénario qui écrit publie un commentaire sonde, en mesure l'effet
// jusque dans la cloche du destinataire, puis DÉTRUIT tout ce qu'il a produit avec la clé de
// service. Une dernière assertion le constate.

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	expect,
	test,
	type Page,
} from './fixtures'
import { CLE_SERVICE, MOT_DE_PASSE_SEED, URL_API } from '../api/jetons'
import {
	ADRESSE_CARD_SOLITAIRE,
	ESPACE_SOLITAIRE,
	demonterEspaceSolitaire,
	monterEspaceSolitaire,
} from '../api/espace-solitaire'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-064'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'

/** `…0c1` vit dans « Grands comptes », fermé à Farida ; `…0c5` dans « Maintenance », ouvert à tous. */
const CARD_FERMEE_A_FARIDA = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_OUVERTE_A_TOUS = '5eed0000-0000-4000-8000-0000000000c5'
const ADRESSE_FERMEE = `/tracks/conseil-ia/grands-comptes/cards/${CARD_FERMEE_A_FARIDA}`
const ADRESSE_OUVERTE = `/tracks/studio-web/maintenance/cards/${CARD_OUVERTE_A_TOUS}`

const DRISS = '5eed0000-0000-4000-8000-000000000012'

const COMMANDE = 'Mentionner'
const CAMILLE_NOM = 'Camille Aubert'
const DRISS_NOM = 'Driss Lemoine'
const FARIDA_NOM = 'Farida Nowak'

const ENTETES_SERVICE = { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` }

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('Le sélecteur n’offre que des personnes éligibles (§5.1, §36)', () => {
	test('sur « Grands comptes », la lectrice n’est PAS offerte — et l’appelante non plus', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(ADRESSE_FERMEE)

		// LA LISTE N'EST PAS LÀ TANT QUE LE SÉLECTEUR N'EST PAS OUVERT (§36.3).
		await expect(page.getByRole('checkbox', { name: DRISS_NOM })).toHaveCount(0)

		await page.getByRole('button', { name: COMMANDE }).click()
		await expect(page.getByRole('checkbox', { name: DRISS_NOM })).toBeVisible()
		// Farida est écartée par l'ÉLIGIBILITÉ, Camille par la règle de l'auto-mention (§34.3).
		await expect(page.getByRole('checkbox', { name: FARIDA_NOM })).toHaveCount(0)
		await expect(page.getByRole('checkbox', { name: CAMILLE_NOM })).toHaveCount(0)
	})

	test('sur « Maintenance », la MÊME lectrice EST offerte : la liste suit l’affaire', async ({
		page,
	}) => {
		// C'EST CE SCÉNARIO QUI REND LE PRÉCÉDENT PROBANT. Sans lui, un sélecteur qui n'offrirait
		// jamais Farida — par un filtre en dur, par exemple — passerait le premier.
		await connecter(page, ADMIN)
		await page.goto(ADRESSE_OUVERTE)
		await page.getByRole('button', { name: COMMANDE }).click()

		await expect(page.getByRole('checkbox', { name: DRISS_NOM })).toBeVisible()
		await expect(page.getByRole('checkbox', { name: FARIDA_NOM })).toBeVisible()
		await expect(page.getByRole('checkbox', { name: CAMILLE_NOM })).toHaveCount(0)
	})

	test('le compte des personnes cochées survit au repli du sélecteur (§36.5)', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto(ADRESSE_OUVERTE)
		await page.getByRole('button', { name: COMMANDE }).click()
		await page.getByRole('checkbox', { name: FARIDA_NOM }).check()

		const avecCompte = page.getByRole('button', { name: 'Mentionner (1)' })
		await expect(avecCompte).toBeVisible()
		await avecCompte.click()
		// Repliée, la commande porte toujours le compte : un auteur qui replie ne saurait plus,
		// sinon, qui son commentaire mentionne.
		await expect(page.getByRole('checkbox', { name: FARIDA_NOM })).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Mentionner (1)' })).toBeVisible()
	})
})

test.describe('L’ÉTAT VIDE : seul lecteur de son affaire (§36.4, §50)', () => {
	// CE QUE CE BLOC AJOUTE, ET POURQUOI IL N'EXISTAIT PAS. Le §36.4 décrit quatre états du
	// sélecteur ; trois étaient éprouvés à l'écran, le quatrième ne l'était que par la suite
	// unitaire — aucune affaire du seed ne laisse son lecteur seul, l'administratrice les lisant
	// toutes. Le §39 point 4 nommait l'écart ; le §50 le referme par un chemin déterministe
	// (`CLAUDE.md` §15) plutôt qu'en étendant le jeu de démonstration.
	//
	// LE MONTAGE ET LE DÉMONTAGE ENCADRENT CHAQUE SCÉNARIO, et ce n'est pas de l'hygiène : laissé
	// en base, l'espace jetable rend ROUGE `e2e/ui/demarrage.spec.ts`, qui assère à juste titre que
	// la base ne porte qu'un espace (§50.5, mesuré). Le démontage constate l'état rendu.
	test.beforeEach(async ({ page }) => {
		await monterEspaceSolitaire(page.request)
	})

	test.afterEach(async ({ page }) => {
		await demonterEspaceSolitaire(page.request)
	})

	test('le sélecteur dit que personne d’autre ne lit l’affaire, et n’offre AUCUNE action', async ({
		page,
	}) => {
		await connecter(page, BIZDEV)
		await page.goto(ADRESSE_CARD_SOLITAIRE)

		// *a* — LA FICHE S'OUVRE VRAIMENT. Sans ce point, un échec de route se lirait comme un état
		// vide : une page qui n'affiche rien n'affiche pas non plus de cases à cocher.
		await expect(page.getByTestId('entete-card').getByRole('heading')).toHaveText(
			ESPACE_SOLITAIRE.titreCard,
		)

		// *e* — LA COMMANDE PORTE « Mentionner », SANS COMPTE (§36.5) : à zéro case cochée, il n'y
		// a rien à compter, et un « (0) » ferait croire à une liste dont on aurait tout décoché.
		await expect(page.getByRole('button', { name: COMMANDE, exact: true })).toBeVisible()
		await page.getByRole('button', { name: COMMANDE }).click()

		const liste = page.locator('#mentions-liste')
		await expect(liste).toBeVisible()

		// *b* — LE MESSAGE DE L'ÉTAT VIDE, celui que le §36.4 et le §5.44 du design system
		// promettent depuis la livraison de la sous-tranche.
		await expect(liste).toContainText('Personne d’autre ne peut lire cette affaire.')

		// *c* — ZÉRO CASE. Sans ce point, un message rendu AU-DESSUS d'une liste peuplée passerait
		// le précédent : c'est la différence entre « l'écran dit qu'il n'y a personne » et « il n'y
		// a personne ».
		await expect(liste.getByRole('checkbox')).toHaveCount(0)

		// *d* — ZÉRO BOUTON. Le §36.4 exige « sans action » : l'état vide n'est pas une erreur, il
		// n'offre donc PAS l'action de reprise du §5.8. Un bouton « Réessayer » ici enseignerait
		// qu'être seul est une panne dont on pourrait revenir.
		await expect(liste.getByRole('button')).toHaveCount(0)

		// *f* — LE COMPOSEUR RESTE PUBLIABLE (§36.6) : mentionner est facultatif, et l'être seul ne
		// ferme pas le fil de l'affaire.
		await page.getByLabel('Votre commentaire').fill('Seul à bord.')
		await expect(page.getByRole('button', { name: 'Publier' })).toBeEnabled()

		// *h* — LA CAPTURE, produite ET observée (`CLAUDE.md` §16). Le §40 promet « liste peuplée
		// et liste vide » ; la seconde manquait. La liste est amenée dans le cadre avant la prise,
		// leçon de la capture du refus partiel qui montrait le bas de la fiche.
		await liste.scrollIntoViewIfNeeded()
		await capturer(page, 'mentions-liste-vide-1440', UNITE)

		// *g* — LA CONSOLE EST VIERGE, et c'est la fixture du projet qui le juge à la fermeture de
		// la page : `200 []` est un état NORMAL du produit, pas un refus. Rien n'est donc consommé
		// par `autoriserErreursConsole` ici, à la différence du scénario de refus partiel.
	})
})

test.describe('Le parcours complet : mentionner, et voir la cloche du destinataire (§35)', () => {
	test('publier en mentionnant Driss remplit SA boîte, et le seed sort intact', async ({
		page,
		browser,
	}) => {
		const corps = `Sonde 3b — ${test.info().testId}`
		let idCommentaire: string | null = null

		try {
			await connecter(page, ADMIN)
			await page.goto(ADRESSE_FERMEE)

			// LE PARCOURS EST CELUI D'UN UTILISATEUR : écrire, ouvrir, cocher, publier.
			await page.getByLabel('Votre commentaire').fill(corps)
			await page.getByRole('button', { name: COMMANDE }).click()
			await page.getByRole('checkbox', { name: DRISS_NOM }).check()
			await page.getByRole('button', { name: 'Publier' }).click()

			// Le commentaire paraît dans le fil, et le brouillon est vidé.
			await expect(page.getByText(corps)).toBeVisible()
			await expect(page.getByLabel('Votre commentaire')).toHaveValue('')
			// AUCUNE ALERTE : toutes les mentions sont passées (§35.4, première issue).
			await expect(page.getByTestId('mentions-refusees')).toHaveCount(0)
			// Le sélecteur est remis à zéro : rien ne reste à faire.
			await expect(page.getByRole('button', { name: COMMANDE })).toBeVisible()

			// L'EFFET BACKEND EST MESURÉ, PAS SUPPOSÉ. La mention existe, et elle a produit la
			// notification — c'est toute la chaîne de `CRM-064`, éprouvée de bout en bout.
			const commentaires = await page.request.get(
				`${URL_API}/rest/v1/card_comments?body=eq.${encodeURIComponent(corps)}&select=id`,
				{ headers: ENTETES_SERVICE },
			)
			const lignes = (await commentaires.json()) as Array<{ id: string }>
			expect(lignes).toHaveLength(1)
			idCommentaire = lignes[0]!.id

			const mentions = await page.request.get(
				`${URL_API}/rest/v1/card_comment_mentions?comment_id=eq.${idCommentaire}&select=profile_id`,
				{ headers: ENTETES_SERVICE },
			)
			expect(await mentions.json()).toEqual([{ profile_id: DRISS }])

			// LA CLOCHE DU DESTINATAIRE LE VOIT, dans une session RÉELLEMENT distincte : c'est ce
			// qui rend la chaîne complète, et non seulement la ligne en base.
			const contexte = await browser.newContext()
			const pageDriss = await contexte.newPage()
			try {
				await connecter(pageDriss, BIZDEV)
				// Driss portait UNE notification non lue avant cette publication ; il en porte DEUX.
				await expect(pageDriss.getByTestId('cloche-notifications')).toHaveAttribute(
					'aria-label',
					/2/,
				)
			} finally {
				await contexte.close()
			}
		} finally {
			// LE SEED SORT INTACT (décision 501). L'ordre compte : la notification ne porte aucune
			// clé étrangère vers la mention (§14.4), donc rien ne la supprimerait en cascade.
			if (idCommentaire !== null) {
				await page.request.delete(
					`${URL_API}/rest/v1/notifications?payload->>comment_id=eq.${idCommentaire}`,
					{ headers: ENTETES_SERVICE },
				)
				await page.request.delete(
					`${URL_API}/rest/v1/card_comment_mentions?comment_id=eq.${idCommentaire}`,
					{ headers: ENTETES_SERVICE },
				)
				await page.request.delete(`${URL_API}/rest/v1/card_comments?id=eq.${idCommentaire}`, {
					headers: ENTETES_SERVICE,
				})
			}
			const restants = await page.request.get(`${URL_API}/rest/v1/card_comments?select=id`, {
				headers: ENTETES_SERVICE,
			})
			expect((await restants.json()) as unknown[]).toHaveLength(5)
		}
	})

	test('le sélecteur n’exige rien : publier sans mention reste le geste ordinaire (§36.6)', async ({
		page,
	}) => {
		const corps = `Sonde 3b sans mention — ${test.info().testId}`
		try {
			await connecter(page, ADMIN)
			await page.goto(ADRESSE_FERMEE)
			await page.getByLabel('Votre commentaire').fill(corps)
			// Le bouton est actif sans qu'aucune personne ne soit choisie : mentionner est
			// facultatif, et le composeur reste celui que `CRM-043` a livré.
			await expect(page.getByRole('button', { name: 'Publier' })).toBeEnabled()
			await page.getByRole('button', { name: 'Publier' }).click()

			await expect(page.getByText(corps)).toBeVisible()
			await expect(page.getByTestId('mentions-refusees')).toHaveCount(0)
		} finally {
			await page.request.delete(
				`${URL_API}/rest/v1/card_comments?body=eq.${encodeURIComponent(corps)}`,
				{ headers: ENTETES_SERVICE },
			)
		}
	})
})

test.describe('Le refus partiel, et le clavier (§35.4, §8)', () => {
	test('le commentaire RESTE publié, et l’alerte NOMME la personne non mentionnée', async ({
		page,
	}) => {
		const corps = `Sonde 3b refus — ${test.info().testId}`
		try {
			await connecter(page, ADMIN)

			// LE REFUS EST PROVOQUÉ PAR SUBSTITUTION DE LA RÉPONSE, ET LE MOTIF EST ÉCRIT. Le
			// produit rend ce cas RARE par construction : le sélecteur n'offre que des personnes
			// éligibles (§34), si bien qu'un refus réel demande que le droit du destinataire tombe
			// ENTRE la lecture de la liste et l'envoi. Le reproduire par la vraie route exigerait de
			// modifier les droits d'un profil du seed pendant le scénario — une écriture qui
			// laisserait le seed en équilibre instable si le scénario échouait au mauvais instant.
			//
			// CE QUI EST SUBSTITUÉ EST LA RÉPONSE DU SERVEUR, JAMAIS LE COMPORTEMENT DE L'ÉCRAN : le
			// corps rendu est celui que la ligne *ae* du contrat d'API MESURE sur la vraie pile, au
			// code et au symbole près. Ce que ce scénario éprouve est donc bien le produit — sa
			// traduction du refus et son écart de comportement avec un refus de publication.
			await page.route('**/rest/v1/card_comment_mentions*', async (route) => {
				if (route.request().method() !== 'POST') return await route.fallback()
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({
						code: 'P0001',
						message: 'mention_destinataire_sans_acces',
						details: 'Une mention ne désigne que quelqu’un qui peut lire cette affaire.',
						hint: null,
					}),
				})
			})

			await page.goto(ADRESSE_FERMEE)
			await page.getByLabel('Votre commentaire').fill(corps)
			await page.getByRole('button', { name: COMMANDE }).click()
			await page.getByRole('checkbox', { name: DRISS_NOM }).check()
			await page.getByRole('button', { name: 'Publier' }).click()

			const alerte = page.getByTestId('mentions-refusees')
			await expect(alerte).toBeVisible()
			await expect(alerte).toContainText(DRISS_NOM)
			await expect(alerte).toContainText('ne peut pas lire cette affaire')

			// LE COMMENTAIRE EST PUBLIÉ, ET IL LE RESTE (§35.3) : c'est ce qui distingue cette
			// troisième issue d'un refus de publication.
			await expect(page.getByText(corps)).toBeVisible()
			// LE BROUILLON EST VIDÉ — écart assumé avec le refus de publication, qui le conserve.
			await expect(page.getByLabel('Votre commentaire')).toHaveValue('')
			// La personne refusée reste cochée : ce qui reste coché est ce qu'il reste à faire.
			await expect(page.getByRole('checkbox', { name: DRISS_NOM })).toBeChecked()

			// L'ALERTE EST AMENÉE DANS LE CADRE AVANT LA CAPTURE, ET C'EST UN DÉFAUT DE PREUVE
			// TROUVÉ EN REGARDANT L'IMAGE (`CLAUDE.md` §16). La première capture montrait le bas de
			// la fiche : la fenêtre n'avait pas suivi le composeur, et l'image ne portait AUCUN des
			// éléments qu'elle prétendait attester. Une capture qui ne montre pas ce qu'elle
			// prouve ne prouve rien.
			await alerte.scrollIntoViewIfNeeded()
			await capturer(page, 'mentions-refus-partiel-1440', UNITE)

			// LE REFUS LAISSE UNE ERREUR DE RESSOURCE DANS LA CONSOLE, et elle est DÉCLARÉE plutôt
			// que filtrée : le scénario vient de la provoquer et l'écran vient de l'expliquer à
			// l'utilisateur. Une seule, celle du `400` du refus — un nombre ou un statut différent
			// ferait rougir ici (`CRM-007`).
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		} finally {
			await page.unrouteAll({ behavior: 'ignoreErrors' })
			await page.request.delete(
				`${URL_API}/rest/v1/card_comments?body=eq.${encodeURIComponent(corps)}`,
				{ headers: ENTETES_SERVICE },
			)
		}
	})

	test('le sélecteur s’ouvre, se coche et se publie AU CLAVIER, sans aucune souris', async ({
		page,
	}) => {
		const corps = `Sonde 3b clavier — ${test.info().testId}`
		try {
			await connecter(page, ADMIN)
			await page.goto(ADRESSE_FERMEE)

			await page.getByLabel('Votre commentaire').focus()
			await page.keyboard.type(corps)
			// Le sélecteur est SUR LE CHEMIN du clavier, entre la saisie et la publication (§5.44).
			await page.keyboard.press('Tab')
			await expect(page.getByRole('button', { name: COMMANDE })).toBeFocused()
			await page.keyboard.press('Enter')
			await page.keyboard.press('Tab')
			await expect(page.getByRole('checkbox', { name: DRISS_NOM })).toBeFocused()
			await page.keyboard.press('Space')
			await expect(page.getByRole('checkbox', { name: DRISS_NOM })).toBeChecked()
			await page.keyboard.press('Tab')
			await expect(page.getByRole('button', { name: 'Publier' })).toBeFocused()
			await page.keyboard.press('Enter')

			await expect(page.getByText(corps)).toBeVisible()
		} finally {
			const commentaires = await page.request.get(
				`${URL_API}/rest/v1/card_comments?body=eq.${encodeURIComponent(corps)}&select=id`,
				{ headers: ENTETES_SERVICE },
			)
			for (const ligne of (await commentaires.json()) as Array<{ id: string }>) {
				await page.request.delete(
					`${URL_API}/rest/v1/notifications?payload->>comment_id=eq.${ligne.id}`,
					{ headers: ENTETES_SERVICE },
				)
				await page.request.delete(
					`${URL_API}/rest/v1/card_comment_mentions?comment_id=eq.${ligne.id}`,
					{ headers: ENTETES_SERVICE },
				)
				await page.request.delete(`${URL_API}/rest/v1/card_comments?id=eq.${ligne.id}`, {
					headers: ENTETES_SERVICE,
				})
			}
		}
	})
})

test.describe('Vérification visuelle aux quatre paliers (CLAUDE.md §16)', () => {
	for (const palier of PALIERS) {
		test(`le sélecteur déplié tient dans son cadre à ${palier.nom}`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto(ADRESSE_OUVERTE)
			await page.getByRole('button', { name: COMMANDE }).click()
			const liste = page.locator('#mentions-liste')
			await expect(liste).toBeVisible()

			// LE CADRE EST MESURÉ DES DEUX CÔTÉS, et c'est la leçon de la tranche 3a : une preuve
			// qui n'observerait que `scrollWidth > clientWidth` ne verrait pas un débordement à
			// GAUCHE, une coordonnée négative n'engendrant aucun défilement.
			const cadre = await liste.boundingBox()
			expect(cadre).not.toBeNull()
			expect(cadre!.x).toBeGreaterThanOrEqual(0)
			expect(cadre!.x + cadre!.width).toBeLessThanOrEqual(palier.largeur + 1)

			await capturer(page, `mentions-selecteur-${palier.nom}`, UNITE)
		})
	}
})
