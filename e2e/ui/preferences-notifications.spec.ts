// @verifies CRM-064 (docs/BACKLOG.md) — tranche 4 : les préférences, sur session réelle
// @verifies docs/SPEC-notifications.md §42.1 (aucune case pour un canal qui n'existe pas),
//           §43.4 (l'absence de ligne vaut consentement), §44 (couper MASQUE la cloche et son
//           compteur, rétablir les rend), §46.3 (l'écriture par la RPC), §49
// @verifies docs/DESIGN_SYSTEM.md §5.45 (cette surface), §5.7 ter (l'écriture immédiate, le
//           contrôle jamais désactivé), §7 (les quatre paliers), §8 (clavier) ;
//           CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée, et le navigateur obtient son jeton par
// le formulaire réel puis parle à la vraie API.
//
// CE QUE CE FICHIER PROUVE, ET QUE NI LA SUITE UNITAIRE NI LE CONTRAT D'API NE PROUVENT : que le
// geste de l'écran CHANGE CE QUE LA CLOCHE MONTRE. La suite unitaire éprouve le module sans base ;
// le contrat éprouve la base sans écran ; seule cette suite ferme la chaîne — décocher une case
// dans les réglages, puis voir le compteur de l'en-tête disparaître.
//
// LE SEED SORT INTACT. Chaque scénario qui coupe RÉTABLIT dans le même scénario, et une dernière
// assertion le constate : une préférence laissée à faux ferait rougir
// `e2e/ui/notifications.spec.ts`, qui mesure une cloche à « 1 non lue ».

import { request as requetePlaywright } from '@playwright/test'
import { expect, test, type Page } from './fixtures'
import { CLE_SERVICE, MOT_DE_PASSE_SEED, URL_API } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-064'
const BIZDEV = 'bizdev@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const ADRESSE = '/reglages/notifications'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

const laCase = (page: Page) => page.getByRole('checkbox', { name: /Recevoir les mentions/ })

/**
 * Remet la case à « coché » et attend la confirmation de la base.
 *
 * ELLE PASSE PAR L'ÉCRAN, jamais par une requête directe : le geste de remise en état est le même
 * que le geste éprouvé, ce qui évite qu'une suite laisse le produit dans un état qu'aucun
 * utilisateur ne saurait défaire.
 */
async function retablir(page: Page): Promise<void> {
	const cible = laCase(page)
	if (!(await cible.isChecked())) {
		await cible.click()
		await expect(page.getByText('Vous recevrez ces notifications.')).toBeVisible()
	}
	await expect(cible).toBeChecked()
}

test.describe('L’écran des préférences (docs/DESIGN_SYSTEM.md §5.45)', () => {
	/**
	 * ÉTAT DE DÉPART DÉTERMINISTE, ET C'EST UN DÉFAUT PAYÉ.
	 *
	 * Écrite sans cette garde, la suite a été VERTE scénario par scénario et ROUGE en série : un
	 * premier échec avait laissé la préférence de Driss à faux, et les trois scénarios suivants
	 * mesuraient alors une cloche vide sans que rien ne dise pourquoi. Une preuve dont l'état de
	 * départ dépend de l'issue de la précédente ne part pas d'un état déterministe
	 * (`CLAUDE.md` §15), et son verdict rouge n'apprend rien.
	 *
	 * **LA REMISE EN ÉTAT PASSE PAR LA CLÉ DE SERVICE, ET LE GESTE ÉPROUVÉ PAR L'ÉCRAN.** Les deux
	 * ne se confondent pas : le `DELETE` est refusé à tout client (§46.2), si bien qu'un navigateur
	 * ne PEUT PAS rendre la table à son état vide — il ne sait que recocher. C'est le même partage
	 * que dans `e2e/api/preferences-notifications.spec.ts`, et c'est ce qui permet à chaque
	 * scénario de partir de l'état d'un compte neuf : AUCUNE ligne (§43.4, §48 bis).
	 */
	test.beforeEach(async () => {
		const contexte = await requetePlaywright.newContext({ baseURL: URL_API })
		try {
			const reponse = await contexte.delete(
				`${URL_API}/rest/v1/notification_preferences?type=eq.mention`,
				{ headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` } },
			)
			expect([200, 204]).toContain(reponse.status())
		} finally {
			await contexte.dispose()
		}
	})

	// L'ÉCRAN EST ATTEIGNABLE DEPUIS L'INDEX DES RÉGLAGES, et il y vient EN DERNIER : toutes les
	// entrées au-dessus administrent l'instance, celle-ci règle le compte de qui la regarde.
	test('l’index des réglages y mène, et l’entrée vient en dernier', async ({ page }) => {
		await connecter(page, BIZDEV)
		await page.goto('/reglages')

		const lien = page.getByRole('link', { name: /Notifications : ce que vous recevez/ })
		await expect(lien).toBeVisible()

		// L'ORDRE EST UNE RÈGLE, PAS UN RESTE : le lien des préférences est le DERNIER de la liste
		// des sections. Une entrée insérée demain APRÈS lui mélangerait deux natures d'écran — les
		// sections d'administration et le réglage du compte —, et cette assertion le verrait.
		const sections = page.getByRole('listitem')
		const dernier = sections.last()
		await expect(dernier).toContainText('Notifications : ce que vous recevez')

		await lien.click()
		await expect(page.getByRole('heading', { name: 'Notifications', level: 2 })).toBeVisible()
	})

	// L'ABSENCE DE LIGNE VAUT CONSENTEMENT (§43.4), et le seed n'en pose AUCUNE (§48 bis). L'état
	// vu ici est donc celui d'un compte neuf — c'est-à-dire de tout le monde en production.
	test('la case est COCHÉE par défaut, et il n’y a aucune case pour un canal qui n’existe pas', async ({
		page,
	}) => {
		await connecter(page, BIZDEV)
		await page.goto(ADRESSE)

		await expect(laCase(page)).toBeChecked()

		// AUCUNE CASE POUR UN CANAL QUI N'EXISTE PAS (§42.1) : ni email, ni résumé quotidien. Une
		// case qui ne commande rien serait une promesse fausse — l'utilisateur croirait avoir
		// demandé un email.
		await expect(page.getByRole('checkbox')).toHaveCount(1)
		await expect(page.getByText(/email/i)).toHaveCount(0)
		await expect(page.getByText(/résumé quotidien/i)).toHaveCount(0)

		// AUCUN BOUTON D'ENREGISTREMENT (§5.7 ter) : un réglage à une seule valeur n'a rien à valider.
		await expect(page.getByRole('button', { name: /Enregistrer/i })).toHaveCount(0)
	})

	// C'EST LE SCÉNARIO QUI FERME LA CHAÎNE, ET LE SEUL QUI LA FERME. Il part du geste de l'écran
	// et va jusqu'à ce que l'en-tête montre — deux surfaces qui ne se connaissent pas, reliées
	// uniquement par la politique de lecture.
	test('décocher fait DISPARAÎTRE le compteur de la cloche, recocher le fait revenir', async ({
		page,
	}) => {
		await connecter(page, BIZDEV)

		// L'ÉTAT DE DÉPART EST MESURÉ, PAS SUPPOSÉ : Driss porte UNE non-lue (§48 bis).
		await expect(page.getByTestId('compteur-notifications')).toHaveText('1')

		await page.goto(ADRESSE)
		await laCase(page).click()
		await expect(page.getByText('Ces notifications ne vous seront plus montrées.')).toBeVisible()
		await expect(laCase(page)).not.toBeChecked()

		// LE COMPTEUR DE L'EN-TÊTE TOMBE, et c'est la politique qui l'a fait — aucune ligne de
		// l'écran des réglages ne connaît la cloche.
		await expect(page.getByTestId('compteur-notifications')).toHaveCount(0)
		await expect(page.getByTestId('cloche-notifications')).toHaveAccessibleName(
			'Notifications — aucune non lue',
		)

		await laCase(page).click()
		await expect(page.getByText('Vous recevrez ces notifications.')).toBeVisible()

		// RÉTABLIR REND L'ÉTAT D'AVANT, non lu : c'est la raison d'être du filtrage à la lecture
		// (§44). Filtré à la production, ce scénario ne rendrait RIEN.
		await expect(page.getByTestId('compteur-notifications')).toHaveText('1')
	})

	// LE PANNEAU LUI-MÊME SE VIDE, et pas seulement le compteur : la liste lit la même table sous
	// la même politique.
	test('le panneau de la cloche se vide aussi, puis se remplit à nouveau', async ({ page }) => {
		await connecter(page, BIZDEV)
		await page.goto(ADRESSE)
		await laCase(page).click()
		await expect(page.getByText('Ces notifications ne vous seront plus montrées.')).toBeVisible()

		await page.getByTestId('cloche-notifications').click()
		const panneau = page.getByTestId('panneau-notifications')
		await expect(panneau).toBeVisible()
		// L'ÉTAT VIDE DU PANNEAU EST CELUI D'UNE BOÎTE SAINE, jamais une panne : c'est le §26.7,
		// et couper ne change pas sa nature.
		await expect(panneau.getByRole('listitem')).toHaveCount(0)
		await page.keyboard.press('Escape')

		await retablir(page)
		await page.getByTestId('cloche-notifications').click()
		await expect(page.getByTestId('panneau-notifications').getByRole('listitem')).toHaveCount(1)
		await page.keyboard.press('Escape')
	})

	// LE CLAVIER DE BOUT EN BOUT (§8), ET LE FOCUS QUI RESTE. C'est la conséquence directe de la
	// règle du §5.7 ter qui refuse de désactiver le contrôle : une case qui perdrait le focus en
	// se réactivant obligerait à retabuler pour se corriger.
	test('la case se bascule au clavier, et le focus NE LA QUITTE PAS pendant l’écriture', async ({
		page,
	}) => {
		await connecter(page, BIZDEV)
		await page.goto(ADRESSE)

		const cible = laCase(page)
		await cible.focus()
		await expect(cible).toBeFocused()

		await page.keyboard.press('Space')
		await expect(page.getByText('Ces notifications ne vous seront plus montrées.')).toBeVisible()

		// LE FOCUS EST TOUJOURS SUR LA CASE, et elle n'a jamais été désactivée. Les deux
		// assertions disent la même règle par ses deux bouts.
		await expect(cible).toBeFocused()
		await expect(cible).toBeEnabled()

		await page.keyboard.press('Space')
		await expect(page.getByText('Vous recevrez ces notifications.')).toBeVisible()
		await expect(cible).toBeFocused()
	})

	// L'ÉCRAN EST OUVERT AUX TROIS PROFILS, et c'est le PREMIER de `/reglages` dans ce cas (§5.45).
	// La lectrice n'a aucune notification : son écran est identique, ce qui est exact — une
	// préférence ne dépend pas de l'état de la boîte.
	test('la lectrice ouvre le même écran, alors que sa boîte est vide', async ({ page }) => {
		await connecter(page, VIEWER)
		await page.goto(ADRESSE)

		await expect(laCase(page)).toBeChecked()
		await expect(page.getByTestId('compteur-notifications')).toHaveCount(0)
	})

	// LES CAPTURES SONT PRISES AUX QUATRE PALIERS, DANS LES DEUX ÉTATS DE LA CASE : c'est le seul
	// changement visible de l'écran, et une capture d'un seul état ne montrerait pas ce que la
	// livraison fait. Elles montrent AUSSI la cloche, qui perd son compteur — la chaîne entière
	// tient dans l'image.
	//
	// LA FENÊTRE EST POSÉE AVANT LA NAVIGATION, ET C'EST UN DÉFAUT DE PREUVE TROUVÉ EN REGARDANT
	// L'IMAGE (`CLAUDE.md` §16). Écrites en une seule boucle qui redimensionnait une page déjà
	// rendue, les captures attrapaient la barre latérale À MI-CHEMIN de son repliage : pilules
	// fantômes, libellés absents, contenu décalé et titre coupé. L'image n'attestait alors pas
	// l'écran qu'elle prétendait montrer. Poser la fenêtre d'abord supprime la transition au lieu
	// de l'attendre — c'est la règle que `notifications.spec.ts` suit déjà, et aucune temporisation
	// n'est ajoutée (`CLAUDE.md` §18).
	for (const palier of PALIERS) {
		test(`captures au palier ${palier.nom}, case cochée puis décochée`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, BIZDEV)
			await page.goto(ADRESSE)
			await expect(laCase(page)).toBeChecked()
			await capturer(page, `preferences-notifications-cochee-${palier.nom}`, UNITE)

			await laCase(page).click()
			await expect(page.getByText('Enregistré')).toBeVisible()
			await capturer(page, `preferences-notifications-decochee-${palier.nom}`, UNITE)

			// AUCUN DÉBORDEMENT HORIZONTAL, ET LA MESURE PORTE SUR LES DEUX CÔTÉS. La leçon de la
			// sous-tranche 3a : `scrollWidth > clientWidth` ne voit qu'un débordement à DROITE, une
			// coordonnée négative n'engendrant aucun défilement.
			const debordement = await page.evaluate(() => ({
				droite: document.documentElement.scrollWidth > document.documentElement.clientWidth,
				gauche: document.documentElement.scrollLeft < 0,
			}))
			expect(debordement.droite, `débordement à droite au palier ${palier.nom}`).toBe(false)
			expect(debordement.gauche, `débordement à gauche au palier ${palier.nom}`).toBe(false)

			await retablir(page)
		})
	}

	// LE SEED SORT INTACT — décision 501. Une préférence laissée à faux ferait rougir
	// `e2e/ui/notifications.spec.ts`, qui mesure une cloche à « 1 non lue », et la cause serait
	// introuvable depuis ce fichier-là.
	test('le produit est rendu dans l’état où il a été trouvé', async ({ page }) => {
		await connecter(page, BIZDEV)
		await page.goto(ADRESSE)
		await retablir(page)
		await expect(page.getByTestId('compteur-notifications')).toHaveText('1')
	})
})
