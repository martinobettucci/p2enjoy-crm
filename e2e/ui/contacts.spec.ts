// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranches 4a et 4b
// @verifies docs/SPEC-contacts.md §10.2 (route de premier niveau et entrée de navigation),
//           §10.4 (la lectrice lit les contacts : la lecture est ouverte à tout membre),
//           §10.5 (données techniques), §10.6 (cas a, b, c, g), §10.7 (aucun geste)
// @verifies docs/SPEC-contacts.md §11.2 (la fiche est atteinte DEPUIS le carnet), §11.5 (le site
//           en lien externe, le domaine en texte), §11.6 (le nom d'organisation est un LIEN),
//           §11.8 (le contact ne mène nulle part), §11.9 (cas a à f, i)
// @verifies docs/DESIGN_SYSTEM.md §5.19 (le carnet), §5.20 (la fiche), §5.9 (tableau),
//           §7 (paliers) ; CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, et la navigation passe par la BARRE LATÉRALE, jamais par un `goto` sur
// l'adresse — c'est l'entrée de navigation du §10.2 qui est en cause autant que l'écran.
//
// Les trois contacts exercés sont ceux du seed, et chacun porte un cas du §10.6 : Léo Marchand
// avec son organisation et son email, Sophie Dupont sans organisation ni fonction, Élise Fabre
// sans email. Le seed est rendu INTACT : cette suite ne fait que lire.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-060'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('carnet de contacts (docs/SPEC-contacts.md §10)', () => {
	test('la barre latérale mène au carnet, qui rend les trois contacts du seed', async ({ page }) => {
		await connecter(page, ADMIN)

		// Cas g du §10.6 : l'entrée existe dans la navigation transverse, et le geste est un CLIC
		// sur elle — pas une navigation directe, qui ne prouverait pas que l'entrée existe.
		await page.getByRole('link', { name: 'Contacts', exact: true }).first().click()
		await expect(page).toHaveURL(/\/contacts$/)
		await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible()

		const tableau = page.getByTestId('tableau-contacts')
		await expect(tableau).toBeVisible()
		await expect(page.getByTestId('ligne-contact')).toHaveCount(3)

		// Les cinq colonnes du §10.5, dans leur ordre.
		await expect(tableau.getByRole('columnheader')).toHaveText([
			'Nom',
			'Organisation',
			'Fonction',
			'Email',
			'Téléphone',
		])

		// Cas a : Léo Marchand, son organisation et son email.
		const ligneLeo = page.getByTestId('ligne-contact').filter({ hasText: 'Léo Marchand' })
		await expect(ligneLeo).toContainText('Sogexia')
		await expect(ligneLeo).toContainText('Directeur achats')
		await expect(ligneLeo.locator('code')).toContainText('leo.marchand@sogexia.example')

		// ASSERTION RÉVISÉE le 2026-08-18 — sous-tranche 4b, docs/SPEC-contacts.md §11.6.
		//
		// Elle exigeait `toHaveCount(0)` : le nom d'organisation devait rester un TEXTE tant que la
		// fiche n'existait pas, un lien sans destination étant mort (§10.7). La sous-tranche 4b
		// LIVRE cette destination : la règle change par livraison, et la preuve est RÉVISÉE avec son
		// motif — jamais retirée, jamais contournée. Ce qu'elle exige devient plus fort : le lien
		// doit exister ET mener à la fiche.
		await expect(ligneLeo.locator('a')).toHaveCount(1)
		await expect(ligneLeo.locator('a')).toHaveAttribute('href', /\/contacts\/organisations\//)
		// Aucun `mailto:` ni `tel:` pour autant : écrire à un contact depuis le carnet n'est
		// spécifié nulle part (§10.5, inchangé).
		await expect(ligneLeo.locator('a[href^="mailto:"]')).toHaveCount(0)
		await expect(ligneLeo.locator('a[href^="tel:"]')).toHaveCount(0)

		await capturer(page, 'carnet-contacts-1440', UNITE)
	})

	test('une donnée absente laisse la cellule VIDE, jamais un tiret — cas b et c du §10.6', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts')
		await expect(page.getByTestId('tableau-contacts')).toBeVisible()

		// Sophie Dupont : aucune organisation, aucune fonction. Les cellules sont VIDES — ni tiret,
		// ni « — », ni « non renseigné » (docs/DESIGN_SYSTEM.md §5.9).
		const cellulesSophie = page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Sophie Dupont' })
			.locator('td')
		await expect(cellulesSophie.nth(1)).toHaveText('')
		await expect(cellulesSophie.nth(2)).toHaveText('')
		// §11.6 : une cellule sans organisation reste VIDE et SANS LIEN — un lien n'apparaît que là
		// où il a une destination.
		await expect(cellulesSophie.nth(1).locator('a')).toHaveCount(0)

		// Élise Fabre : aucun email, mais un téléphone. La quatrième cellule est vide, la cinquième
		// porte sa donnée technique.
		const cellulesElise = page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Élise Fabre' })
			.locator('td')
		await expect(cellulesElise.nth(3)).toHaveText('')
		await expect(cellulesElise.nth(4)).toContainText('+33 6 12 34 56 78')
	})

	test('la lectrice lit le carnet : la lecture est ouverte à tout membre — §10.4', async ({
		page,
	}) => {
		// MESURÉ sur la pile réelle : la lectrice reçoit `200` et les trois lignes. L'écriture lui
		// est fermée en base (§3), mais cette sous-tranche n'en expose aucune — il n'y a donc AUCUN
		// geste à lui refuser, et l'écran est le même que celui de l'administratrice.
		await connecter(page, VIEWER)
		await page.goto('/contacts')
		await expect(page.getByTestId('ligne-contact')).toHaveCount(3)
		// RÉVISÉE PAR LA SOUS-TRANCHE 4e, NON RETIRÉE (mécanisme de la décision 51). Cette assertion
		// exigeait qu'AUCUN geste d'écriture ne soit offert, « à personne » : c'était vrai tant que
		// le §10.7 nommait cette absence comme une limite de 4a. La limite est levée — le carnet
		// porte le geste de création (§14) —, et ce que la preuve exige devient PLUS FORT : la
		// lectrice VOIT la commande, car aucune commande n'est éteinte d'avance selon le rôle
		// (§14.6, docs/DESIGN_SYSTEM.md §5.13). Le refus qui lui est opposé est éprouvé par
		// `e2e/ui/carnet-creation.spec.ts`, sur la pile réelle.
		await expect(page.getByRole('button', { name: 'Nouveau contact' })).toBeVisible()
	})

	test('le carnet est atteignable au CLAVIER seul, et l’entrée courante s’annonce', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		const entree = page.getByRole('link', { name: 'Contacts', exact: true }).first()
		await entree.focus()
		await expect(entree).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/contacts$/)
		// L'entrée ouverte porte `aria-current="page"` : une sélection qui ne s'annonce qu'en teinte
		// n'existe pas pour un lecteur d'écran (docs/DESIGN_SYSTEM.md §8, §12.1).
		await expect(page.getByRole('link', { name: 'Contacts', exact: true }).first()).toHaveAttribute(
			'aria-current',
			'page',
		)
		await expect(page.getByTestId('tableau-contacts')).toBeVisible()
	})
})

// --- Paliers responsive (docs/DESIGN_SYSTEM.md §7) --------------------------------------------
//
// La taille de fenêtre est fixée AVANT le chargement — même patron que `etat-messagerie.spec.ts`
// et `board.spec.ts` : la coquille détermine son repli de barre latérale au montage.

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le carnet reste lisible et la page ne défile pas horizontalement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto('/contacts')
			await expect(page.getByTestId('tableau-contacts')).toBeVisible()

			// §7 : c'est le CONTENEUR du tableau qui défile, jamais la page — même garantie que le
			// board et la vue liste, portée par `.indique-debordement-x` (§12.6).
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(debordePage, 'la page ne doit jamais défiler horizontalement').toBe(false)

			await capturer(page, `carnet-contacts-${palier.nom}`, UNITE)
		})
	}
})

test('l’état vide du carnet est rendu SANS action — cas f du §10.6', async ({ page }) => {
	// Sans session, la RLS ne consent aucune ligne : `200` et `[]`, mesuré. C'est l'état vide
	// ordinaire, et il n'offre AUCUNE action — le carnet ne livre aucun geste de création (§10.7),
	// et un bouton vers nulle part serait une commande morte (docs/DESIGN_SYSTEM.md §5.16).
	await page.goto('/contacts')
	await expect(page.getByTestId('etat-vide')).toBeVisible()
	await capturer(page, 'carnet-contacts-vide-1440', UNITE)
})


// --- Sous-tranche 4b — LA FICHE D'ORGANISATION (docs/SPEC-contacts.md §11) --------------------
//
// LE PARCOURS PART DU CARNET, comme celui d'un utilisateur réel : la fiche n'a aucune entrée de
// navigation propre, et c'est le lien du §11.6 qui y mène. Naviguer directement à l'adresse ne
// prouverait pas que ce chemin existe.
//
// Les trois organisations exercées sont celles du seed, et chacune porte un cas du §11.9 :
// Sogexia avec son domaine, son site web et son contact ; Studio Meunier sans domaine ni site ;
// Comptoir Vasseur sans aucun contact. Le seed est rendu INTACT : cette suite ne fait que lire.

test.describe("fiche d'organisation (docs/SPEC-contacts.md §11)", () => {
	test('le carnet mène à la fiche, qui rend le nom, ses caractéristiques et ses contacts', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts')
		await expect(page.getByTestId('tableau-contacts')).toBeVisible()

		// Cas i du §11.9 : le geste est un CLIC sur le nom d'organisation, pas un `goto`.
		await page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Léo Marchand' })
			.getByTestId('lien-organisation')
			.click()
		await expect(page).toHaveURL(/\/contacts\/organisations\/[0-9a-f-]{36}$/)

		// Cas a : le NOM DE L'ORGANISATION est le titre de la route — une donnée portée par la
		// coquille (§11.2). C'est la seule preuve qui l'éprouve : les preuves unitaires montent le
		// contenu sans coquille.
		await expect(page.getByRole('heading', { name: 'Sogexia' })).toBeVisible()

		const contacts = page.getByTestId('tableau-contacts-organisation')
		await expect(contacts).toBeVisible()
		await expect(page.getByTestId('ligne-contact-organisation')).toHaveCount(1)
		// QUATRE colonnes, et non les cinq du carnet : « Organisation » y répéterait le titre de la
		// page à chaque ligne (§11.5).
		await expect(contacts.getByRole('columnheader')).toHaveText([
			'Nom',
			'Fonction',
			'Email',
			'Téléphone',
		])
		await expect(page.getByTestId('ligne-contact-organisation')).toContainText('Léo Marchand')

		// Cas c : le site web est un LIEN externe annoncé ; le domaine reste un TEXTE.
		const site = page.getByTestId('lien-site-organisation')
		await expect(site).toHaveAttribute('href', 'https://www.sogexia.example')
		await expect(site).toHaveAttribute('target', '_blank')
		await expect(site).toHaveAttribute('rel', /noopener/)
		await expect(site).toHaveAttribute('rel', /noreferrer/)
		const caracteristiques = page.getByTestId('caracteristiques-organisation')
		await expect(caracteristiques).toContainText('sogexia.example')
		// Un SEUL lien dans le bloc : le domaine n'en est pas un (§11.5).
		await expect(caracteristiques.locator('a')).toHaveCount(1)

		// §11.8 : le nom d'un contact ne mène nulle part — il n'existe pas de fiche de contact, et
		// un lien y serait mort.
		await expect(page.getByTestId('ligne-contact-organisation').locator('a')).toHaveCount(0)

		await capturer(page, 'fiche-organisation-1440', UNITE)
	})

	test('une organisation sans domaine ni site laisse ses valeurs VIDES — cas b du §11.9', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts')
		await page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Élise Fabre' })
			.getByTestId('lien-organisation')
			.click()
		await expect(page.getByRole('heading', { name: 'Studio Meunier' })).toBeVisible()

		// Les deux LIBELLÉS restent rendus, les deux VALEURS sont vides : c'est la donnée qui
		// manque, pas le champ (§11.5, docs/DESIGN_SYSTEM.md §5.9).
		const caracteristiques = page.getByTestId('caracteristiques-organisation')
		await expect(caracteristiques).toContainText('Domaine')
		await expect(caracteristiques).toContainText('Site web')
		await expect(caracteristiques.locator('dd').nth(0)).toHaveText('')
		await expect(caracteristiques.locator('dd').nth(1)).toHaveText('')
		await expect(page.getByTestId('lien-site-organisation')).toHaveCount(0)
		// Son unique contact est bien là : l'organisation n'est pas vide, seules ses valeurs le sont.
		await expect(page.getByTestId('ligne-contact-organisation')).toHaveCount(1)
	})

	test('une organisation SANS CONTACT rend l’état vide, sans action — cas d du §11.9', async ({
		page,
	}) => {
		// « Comptoir Vasseur », seedée par cette sous-tranche : c'est la SEULE donnée qui exerce cet
		// état. Elle n'a aucun contact, donc aucune ligne du carnet ne mène à elle : son adresse est
		// ici le seul chemin, et c'est une limite assumée du §11.8 (aucune liste d'organisations).
		await connecter(page, ADMIN)
		await page.goto('/contacts/organisations/5eed0000-0000-4000-8000-000000000083')
		await expect(page.getByRole('heading', { name: 'Comptoir Vasseur' })).toBeVisible()

		// Les caractéristiques RESTENT rendues : l'organisation existe, seuls ses contacts manquent.
		await expect(page.getByTestId('caracteristiques-organisation')).toContainText(
			'comptoir-vasseur.example',
		)
		await expect(page.getByTestId('tableau-contacts-organisation')).toHaveCount(0)
		const vide = page.getByTestId('etat-vide')
		await expect(vide).toBeVisible()
		// Aucune action : cette surface ne livre aucun geste de création (§11.8).
		await expect(vide.locator('button')).toHaveCount(0)
		await expect(vide.locator('a')).toHaveCount(0)

		await capturer(page, 'fiche-organisation-sans-contact-1440', UNITE)
	})

	test('un identifiant inconnu et un identifiant MAL FORMÉ rendent le même écran — cas e et f', async ({
		page,
	}) => {
		// Le même écran pour les deux est DÉLIBÉRÉ : les distinguer renseignerait un appelant sans
		// droit sur l'EXISTENCE d'une organisation (docs/SPEC-permissions-rls.md §7). Le cas f les
		// rejoint parce qu'un `400` mènerait à une reprise qui ne pourrait jamais aboutir (§11.4).
		await connecter(page, ADMIN)

		for (const adresse of [
			'/contacts/organisations/00000000-0000-4000-8000-000000000000',
			'/contacts/organisations/pas-un-uuid',
		]) {
			await page.goto(adresse)
			await expect(page.getByText('Organisation introuvable')).toBeVisible()
			// Le retour au carnet est offert : un écran d'impasse laisserait l'utilisateur bloqué.
			const retour = page.getByRole('link', { name: 'Revenir au carnet' })
			await expect(retour).toHaveAttribute('href', '/contacts')
		}

		await capturer(page, 'fiche-organisation-introuvable-1440', UNITE)
	})

	test('la fiche est atteignable au CLAVIER seul depuis le carnet', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts')
		const lien = page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Léo Marchand' })
			.getByTestId('lien-organisation')
		await lien.focus()
		await expect(lien).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('heading', { name: 'Sogexia' })).toBeVisible()
		await expect(page.getByTestId('tableau-contacts-organisation')).toBeVisible()
	})

	test('la lectrice lit la fiche : la lecture est ouverte à tout membre — §11.4', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto('/contacts/organisations/5eed0000-0000-4000-8000-000000000081')
		await expect(page.getByRole('heading', { name: 'Sogexia' })).toBeVisible()
		await expect(page.getByTestId('ligne-contact-organisation')).toHaveCount(1)
	})

	test('sans session, la fiche rend « introuvable » — un refus est zéro ligne, jamais une erreur', async ({
		page,
	}) => {
		// MESURÉ : un appelant anonyme reçoit `200` et `[]` sur une organisation qui EXISTE. L'écran
		// est donc le même que celui d'un identifiant inconnu, et c'est exactement ce que le §7 de
		// docs/SPEC-permissions-rls.md exige.
		await page.goto('/contacts/organisations/5eed0000-0000-4000-8000-000000000081')
		await expect(page.getByText('Organisation introuvable')).toBeVisible()
	})

	for (const palier of PALIERS) {
		test(`${palier.nom} : la fiche reste lisible et la page ne défile pas horizontalement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto('/contacts/organisations/5eed0000-0000-4000-8000-000000000081')
			await expect(page.getByTestId('tableau-contacts-organisation')).toBeVisible()

			// §7 : c'est le CONTENEUR du tableau qui défile, jamais la page (§12.6).
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(debordePage, 'la page ne doit jamais défiler horizontalement').toBe(false)

			await capturer(page, `fiche-organisation-${palier.nom}`, UNITE)
		})
	}
})
