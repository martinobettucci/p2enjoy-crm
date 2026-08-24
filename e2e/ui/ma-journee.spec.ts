// @verifies CRM-061 (docs/BACKLOG.md) — tranche 1 : l'écran « Ma journée », sur session réelle
// @verifies docs/SPEC-cards.md §17.2 (l'adresse porte la portée), §17.5 (les trois sections),
//           §17.6 (ce que chaque ligne rend), §17.8 (états), §17.9 (accessibilité et clavier),
//           §17.11 (preuves attendues), §17.12 (ce que le seed démontre)
// @verifies docs/SPEC-seed.md §13.5 (le contrat des échéances, lignes a à e)
// @verifies docs/DESIGN_SYSTEM.md §5.36 (cette surface), §7 (les quatre paliers) ;
//           CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée, et la navigation passe par la BARRE
// LATÉRALE — c'est l'entrée du §17.2 qui est en cause autant que l'écran, et elle ne menait nulle
// part avant cette tranche.
//
// Les affaires exercées sont celles du seed, et chacune porte une ligne du contrat de
// `docs/SPEC-seed.md` §13.5 : « Audit sécurité applicative » en retard, « Formation Data & IA »
// aujourd'hui, « Hébergement infogéré » à venir, « Cadrage data » endormie et donc absente.
//
// LE SEED SORT INTACT : cette suite ne fait que lire.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-061'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** Les trois affaires du contrat du §13.5, désignées par leur titre — ce que l'écran rend. */
const EN_RETARD = 'Audit sécurité applicative'
const AUJOURDHUI = 'Formation Data & IA — promo 2026'
const A_VENIR = 'Hébergement infogéré — Éditions Bertrand'
/** L'affaire ENDORMIE, dont l'échéance tombe dans l'horizon et qui n'est donc rendue nulle part. */
const ENDORMIE = 'Cadrage data — Groupe Vallier'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('« Ma journée » (docs/SPEC-cards.md §17)', () => {
	test('la barre latérale mène à l’écran, et les trois sections du seed sont rendues', async ({
		page,
	}) => {
		await connecter(page, ADMIN)

		// LE GESTE EST UN CLIC SUR L'ENTRÉE, pas une navigation directe : c'est l'entrée elle-même
		// qui est en cause, et elle rendait un état vide inconditionnel depuis `CRM-007`.
		await page.getByRole('link', { name: 'Ma journée', exact: true }).first().click()
		await expect(page).toHaveURL(/\/ma-journee$/)
		await expect(page.getByRole('heading', { name: 'Ma journée' })).toBeVisible()

		// Les trois sections du §13.5, dans leur ordre, chacune peuplée.
		const sections = page.getByTestId('section-journee')
		await expect(sections).toHaveCount(3)
		await expect(sections.nth(0)).toHaveAttribute('data-section', 'retard')
		await expect(sections.nth(1)).toHaveAttribute('data-section', 'aujourdhui')
		await expect(sections.nth(2)).toHaveAttribute('data-section', 'avenir')

		await expect(sections.nth(0)).toContainText(EN_RETARD)
		await expect(sections.nth(1)).toContainText(AUJOURDHUI)
		await expect(sections.nth(2)).toContainText(A_VENIR)

		// Le compte est ÉCRIT, jamais laissé à deviner (§17.9).
		await expect(page.getByTestId('compte-section').first()).toHaveText('(1)')
	})

	test('la teinte de retard porte sur l’ÉCHÉANCE, et la ligne ne la porte pas', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/ma-journee')
		const sectionRetard = page.getByTestId('section-journee').first()
		const echeance = sectionRetard.getByTestId('echeance-journee').first()
		await expect(echeance).toBeVisible()
		// La teinte est celle du §5.36 : une affaire en retard est un travail à faire, pas une
		// erreur, et le §1 est tenu par le titre de la section, écrit en toutes lettres.
		await expect(echeance).toHaveClass(/bg-danger-soft/)
		await expect(sectionRetard.getByTestId('ligne-journee').first()).not.toHaveClass(/danger/)
		await expect(sectionRetard.getByRole('heading')).toContainText('En retard')
	})

	test('le titre d’une affaire mène à sa fiche, et l’adresse porte ses deux slugs', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/ma-journee')
		const ligne = page.getByTestId('ligne-journee').filter({ hasText: EN_RETARD }).first()
		await ligne.getByTestId('lien-affaire-journee').click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes\/cards\//)
		// L'assertion est PORTÉE PAR L'EN-TÊTE DE LA FICHE, et non par la page : le titre d'une
		// affaire y paraît deux fois — dans le fil d'Ariane de la coquille et dans l'en-tête (§5.3
		// bis) —, et un sélecteur de page entière échouerait en mode strict sans rien dire du
		// produit. C'est la règle du §5.15, « une assertion sur un libellé se scope au bloc ».
		await expect(
			page.getByTestId('entete-card').getByRole('heading', { name: EN_RETARD }),
		).toBeVisible()
	})

	test('la pilule « Track › Channel » ouvre réellement le channel', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/ma-journee')
		const ligne = page.getByTestId('ligne-journee').filter({ hasText: EN_RETARD }).first()
		// Le §5.29 définit cette pilule comme « l'ouverture du channel au clic » ; la réemployer
		// « sans copie » veut dire l'employer ENTIÈRE, destination comprise.
		await ligne.getByTestId('pilule-situation').click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes$/)
	})

	test('la bascule de portée change l’adresse ET le contenu, et la lectrice voit MOINS', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/ma-journee')
		// LE COMPTE EST LU APRÈS LE RENDU, jamais pendant : `count()` ne s'attend pas lui-même, et
		// une lecture émise à l'ouverture rendrait zéro sans rien dire du produit. Attendre la
		// première section est l'assertion qui donne son sens au compte qui suit.
		await expect(page.getByTestId('section-journee').first()).toBeVisible()
		const miennes = await page.getByTestId('ligne-journee').count()
		expect(miennes).toBeGreaterThan(0)

		await page.getByTestId('lien-portee').filter({ hasText: 'Tout l’espace' }).click()
		await expect(page).toHaveURL(/\/ma-journee\?qui=tous$/)
		// L'ATTENTE PORTE SUR LE SIGNAL QUE VOIT L'UTILISATEUR, ET C'EST UNE CORRECTION MESURÉE LE
		// 2026-08-24.
		//
		// Elle était écrite `not.toHaveCount(miennes)`, et ce garde-fou ACCEPTE l'état transitoire :
		// entre le clic et la réponse, l'écran rend ses squelettes, donc ZÉRO ligne — et zéro est
		// bien différent de trois. L'assertion passait donc immédiatement, et le `count()` suivant
		// lisait le zéro du chargement. Isolé, l'écran répond assez vite pour que le cas ne se
		// produise pas ; en campagne complète, sur un hôte chargé, il s'est produit : « Expected:
		// > 3, Received: 0 » — une portée élargie rendant MOINS que la portée personnelle, ce qui
		// est logiquement impossible et ne disait donc rien du produit.
		//
		// Le remède n'est ni une temporisation ni un délai relevé (`CLAUDE.md` §18) : c'est
		// d'attendre le signal de réussite que l'utilisateur voit, comme le §7.2 de
		// `docs/SPEC-test-harness.md` l'exige déjà d'une écriture. Ici, c'est la région live du
		// §17.9 : elle n'est rendue QUE dans l'état « prêt », et son message NOMME la portée
		// affichée. La voir annoncer « Tout l'espace de travail » est la preuve que la nouvelle
		// liste est rendue, et pas seulement que l'ancienne a disparu.
		await expect(page.getByRole('status', { name: 'Contenu de la journée' })).toHaveText(
			/^Tout l’espace de travail : \d+ affaire\(s\) à échéance\.$/,
		)
		const toutes = await page.getByTestId('ligne-journee').count()
		// Le filtre par responsable RETRANCHE, il n'ajoute jamais (§17.7 ligne d).
		expect(toutes).toBeGreaterThan(miennes)

		// `aria-current` désigne la SEULE portée ouverte — posé à la main, `NavLink` le poserait sur
		// les deux, les deux entrées partageant leur chemin (§5.36).
		await expect(
			page.getByTestId('lien-portee').filter({ hasText: 'Tout l’espace' }),
		).toHaveAttribute('aria-current', 'page')
		await expect(
			page.getByTestId('lien-portee').filter({ hasText: 'Mes affaires' }),
		).not.toHaveAttribute('aria-current', 'page')

		// L'AFFAIRE ENDORMIE N'EST RENDUE PAR AUCUNE DES DEUX PORTÉES (§17.4), bien que son
		// échéance tombe dans l'horizon : c'est le filtre, et non un hasard de date. La preuve
		// d'API porte la contre-épreuve qui l'établit.
		await expect(page.getByTestId('ligne-journee').filter({ hasText: ENDORMIE })).toHaveCount(0)
	})

	test('la lectrice ouvre le même écran et y voit moins d’affaires que l’administratrice', async ({
		page,
		browser,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/ma-journee?qui=tous')
		await expect(page.getByTestId('section-journee').first()).toBeVisible()
		const vuesParAdmin = await page.getByTestId('ligne-journee').count()

		const contexte = await browser.newContext()
		const pageLectrice = await contexte.newPage()
		try {
			await connecter(pageLectrice, VIEWER)
			await pageLectrice.goto('/ma-journee?qui=tous')
			// La lectrice atteint l'écran : la lecture est ouverte à tout membre, et le track qui lui
			// est fermé retire ses affaires SANS qu'aucune mention ne les nomme (§17.7 ligne b).
			await expect(pageLectrice.getByTestId('portee-journee')).toBeVisible()
			await expect(pageLectrice.getByTestId('section-journee').first()).toBeVisible()
			const vuesParLectrice = await pageLectrice.getByTestId('ligne-journee').count()
			expect(vuesParLectrice).toBeLessThan(vuesParAdmin)
			await expect(
				pageLectrice.getByTestId('ligne-journee').filter({ hasText: EN_RETARD }),
			).toHaveCount(0)
			await expect(pageLectrice.getByText(EN_RETARD)).toHaveCount(0)
		} finally {
			await contexte.close()
		}
	})

	test('le parcours CLAVIER atteint l’entrée, l’écran, la bascule et une affaire', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/ma-journee')
		await expect(page.getByTestId('section-journee').first()).toBeVisible()

		// La bascule est atteignable au clavier et s'active par `Entrée` — c'est un lien, et un lien
		// s'active ainsi (§5.36, §12.1).
		const versTous = page.getByTestId('lien-portee').filter({ hasText: 'Tout l’espace' })
		await versTous.focus()
		await expect(versTous).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/qui=tous/)

		// Le titre d'une affaire est atteignable et s'active de même : le titre EST le libellé du
		// lien, sans `aria-label` qui le remplacerait (§17.9).
		const lien = page
			.getByTestId('ligne-journee')
			.filter({ hasText: EN_RETARD })
			.first()
			.getByTestId('lien-affaire-journee')
		await lien.focus()
		await expect(lien).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/cards\//)
	})

	test('une adresse portant une portée INCONNUE ouvre le défaut, sans aucune erreur', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		// La liste est close (§17.2) : une adresse tapée à la main n'est pas une panne.
		await page.goto('/ma-journee?qui=couleur_preferee')
		await expect(
			page.getByTestId('lien-portee').filter({ hasText: 'Mes affaires' }),
		).toHaveAttribute('aria-current', 'page')
		await expect(page.getByTestId('section-journee').first()).toBeVisible()
	})

	// LE PALIER EST POSÉ AVANT LA CONNEXION, ET UN TEST PAR PALIER — c'est le patron de
	// `contacts.spec.ts`, et ce n'est pas une commodité : redimensionner une page DÉJÀ montée fait
	// franchir les ruptures du §7 en cours de session, et la barre latérale se déploie en tiroir
	// OUVERT sur la capture. Observé le 2026-08-21 sur `ma-journee-md-900.jpg`, où le tiroir
	// recouvrait la moitié de l'écran, là où la capture de référence de `CRM-060` au même palier
	// montre le tiroir fermé. La capture doit montrer l'état d'ARRIVÉE, pas celui d'un
	// redimensionnement.
	for (const palier of PALIERS) {
		test(`${palier.nom} : les sections restent lisibles et la page ne défile pas horizontalement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto('/ma-journee?qui=tous')
			await expect(page.getByTestId('section-journee').first()).toBeVisible()
			// Le §7 sans exception : la ligne se replie sous `md`, et la page ne défile jamais.
			const deborde = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(deborde).toBe(false)
			await capturer(page, `ma-journee-${palier.nom}`, UNITE)
		})
	}

	test('les DEUX états vides sont atteints SANS aucune substitution, en visiteur anonyme', async ({
		page,
	}) => {
		// AUCUN PROFIL DU SEED N'A DE JOURNÉE VIDE — mesuré : Camille 3, Driss 3, Farida 1 dans
		// l'horizon. Le seul état vide que la pile réelle produise sans rien écrire est donc celui
		// du visiteur SANS session, et il produit les DEUX : sous « mes affaires », la portée n'a
		// aucun sujet et la lecture n'est même pas émise (§17.3) ; sous « tout l'espace de travail »,
		// la RLS ne consent aucune ligne et rend `200` et `[]` (§17.7 ligne c).
		//
		// C'est une donnée RÉELLE et un parcours réel, jamais une réponse substituée
		// (`docs/DESIGN_SYSTEM.md` §12.5) : l'état vide de cette adresse en visiteur anonyme est
		// d'ailleurs déjà ce que `docs/SPEC-manual.md` §7 capture, et cette tranche ne le change pas.
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/ma-journee')

		const vide = page.getByTestId('etat-vide')
		await expect(vide).toBeVisible()
		await expect(vide).toContainText('Aucune échéance dans votre journée')
		const elargir = page.getByTestId('elargir-portee')
		await expect(elargir).toBeVisible()
		await capturer(page, 'ma-journee-vide-moi-1440', UNITE)

		// L'action fait ce qu'elle promet, et mène au SECOND vide, qui n'en porte AUCUNE : il n'y a
		// rien à élargir, et un bouton y serait un chemin vers nulle part (§17.8).
		await elargir.click()
		await expect(page).toHaveURL(/qui=tous/)
		await expect(page.getByTestId('etat-vide')).toContainText('Aucune échéance dans les 7')
		await expect(page.getByTestId('elargir-portee')).toHaveCount(0)
		// La bascule RESTE rendue sur un écran vide : elle est la cause possible de ce vide.
		await expect(page.getByTestId('lien-portee')).toHaveCount(2)
		await capturer(page, 'ma-journee-vide-tous-1440', UNITE)
	})
})
