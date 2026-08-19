// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranches 4a et 4b
// @verifies docs/SPEC-contacts.md §10.2 (route de premier niveau et entrée de navigation),
//           §10.4 (la lectrice lit les contacts : la lecture est ouverte à tout membre),
//           §10.5 (données techniques), §10.6 (cas a, b, c, g), §10.7 (aucun geste)
// @verifies docs/SPEC-contacts.md §11.2 (la fiche est atteinte DEPUIS le carnet), §11.5 (le site
//           en lien externe, le domaine en texte), §11.6 (le nom d'organisation est un LIEN),
//           §11.9 (cas a à f, i)
// @verifies docs/SPEC-contacts.md §15.2 (la fiche de contact est atteinte DEPUIS le carnet),
//           §15.5 (l'organisation et l'affaire en liens), §15.6 (deux surfaces gagnent leur
//           destination), §15.9 (cas a, b, c, e, h, i, m, n, o)
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
		//
		// ASSERTION RÉVISÉE UNE SECONDE FOIS le 2026-08-19 — sous-tranche 4f, §15.6, et pour la
		// raison exacte qui l'avait révisée la première : le nom du CONTACT devait rester un texte
		// tant que sa fiche n'existait pas (§11.8). 4f livre cette destination, et la ligne porte
		// donc DEUX liens. Chacun est vérifié par sa destination et non par son rang.
		await expect(ligneLeo.locator('a')).toHaveCount(2)
		await expect(ligneLeo.getByTestId('lien-contact')).toHaveAttribute(
			'href',
			/^\/contacts\/[0-9a-f-]{36}$/,
		)
		await expect(ligneLeo.getByTestId('lien-organisation')).toHaveAttribute(
			'href',
			/\/contacts\/organisations\//,
		)
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

		// ASSERTION RÉVISÉE le 2026-08-19 — sous-tranche 4f, §15.6. Elle exigeait `toHaveCount(0)` :
		// il n'existait pas de fiche de contact, et un lien y aurait été mort (§11.8). La
		// sous-tranche 4f livre cette destination ; la preuve est révisée avec son motif, jamais
		// retirée, et ce qu'elle exige devient plus fort — le lien doit mener à la bonne fiche.
		await expect(page.getByTestId('ligne-contact-organisation').locator('a')).toHaveCount(1)
		await expect(page.getByTestId('lien-contact-organisation')).toHaveAttribute(
			'href',
			'/contacts/5eed0000-0000-4000-8000-000000000091',
		)

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

// ----------------------------------------------------------------------------------------------
// Sous-tranche 4f — LA FICHE D'UN CONTACT (docs/SPEC-contacts.md §15)
// ----------------------------------------------------------------------------------------------

const ID_LEO_UI = '5eed0000-0000-4000-8000-000000000091'
const ID_ELISE_UI = '5eed0000-0000-4000-8000-000000000093'

test.describe("fiche d'un contact (docs/SPEC-contacts.md §15)", () => {
	test('le carnet mène à la fiche, qui rend le contact, son organisation et SES AFFAIRES', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts')
		await expect(page.getByTestId('tableau-contacts')).toBeVisible()

		// Cas m du §15.9 : le geste est un CLIC sur le nom du contact, pas un `goto`.
		await page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Léo Marchand' })
			.getByTestId('lien-contact')
			.click()
		await expect(page).toHaveURL(new RegExp(`/contacts/${ID_LEO_UI}$`))

		// Cas a : le NOM DU CONTACT est le titre de la route — une donnée portée par la coquille
		// (§15.2). C'est la seule preuve qui l'éprouve : les preuves unitaires montent le contenu
		// sans coquille.
		await expect(page.getByRole('heading', { name: 'Léo Marchand' })).toBeVisible()

		const caracteristiques = page.getByTestId('caracteristiques-contact')
		await expect(caracteristiques).toContainText('Directeur achats')
		await expect(caracteristiques).toContainText('leo.marchand@sogexia.example')

		// Cas c : l'organisation est un LIEN vers sa fiche, et le seul lien de ce bloc.
		await expect(caracteristiques.locator('a')).toHaveCount(1)
		await expect(page.getByTestId('lien-organisation-contact')).toHaveAttribute(
			'href',
			'/contacts/organisations/5eed0000-0000-4000-8000-000000000081',
		)

		// TROIS colonnes, et non davantage : le track et le channel sont dans l'adresse de
		// l'affaire, et les répéter en colonnes remplirait la ligne (§15.5).
		const affaires = page.getByTestId('tableau-affaires-contact')
		await expect(affaires).toBeVisible()
		await expect(affaires.getByRole('columnheader')).toHaveText([
			'Affaire',
			'Rôle dans l’affaire',
			'État',
		])
		await expect(page.getByTestId('ligne-affaire-contact')).toHaveCount(1)
		await expect(page.getByTestId('ligne-affaire-contact')).toContainText('Migration ERP Sogexia')
		// Le rôle DU RATTACHEMENT, distinct de la fonction rendue en zone 1 (§15.3).
		await expect(page.getByTestId('ligne-affaire-contact')).toContainText('decideur')
		// L'affaire du seed est active : aucune pilule d'archive.
		await expect(page.getByTestId('pilule-affaire-archivee')).toHaveCount(0)

		await capturer(page, 'fiche-contact-1440', UNITE)
	})

	test('le titre d’une affaire MÈNE RÉELLEMENT à cette affaire — §15.5', async ({ page }) => {
		// Le lien n'est pas vérifié par son seul `href` : il est SUIVI, et l'affaire s'ouvre. C'est
		// la différence entre une adresse bien formée et une destination qui existe — l'adresse est
		// construite à partir de slugs embarqués, et une erreur de clé étrangère la rendrait
		// plausible mais fausse (§15.3).
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await page.getByTestId('lien-affaire-contact').click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes\/cards\/[0-9a-f-]{36}$/)
		// Le titre est porté DEUX fois — par la coquille et par l'entête de la card. On désigne
		// celui de la card : c'est lui qui prouve que l'affaire elle-même est ouverte, et non
		// seulement que la route a changé de titre.
		await expect(
			page.getByTestId('entete-card').getByRole('heading', { name: 'Migration ERP Sogexia' }),
		).toBeVisible()
	})

	test('un contact SANS affaire rend l’état vide, sans action — cas e du §15.9', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_ELISE_UI}`)
		await expect(page.getByRole('heading', { name: 'Élise Fabre' })).toBeVisible()
		await expect(page.getByTestId('tableau-affaires-contact')).toHaveCount(0)
		// Le titre de l'état vide, et non un `getByText` : « aucune affaire » figure aussi dans son
		// corps, et la correspondance par sous-chaîne en désignerait deux.
		await expect(page.getByRole('heading', { name: 'Aucune affaire' })).toBeVisible()
		// Les caractéristiques restent rendues : l'absence d'affaire n'efface pas le contact.
		await expect(page.getByTestId('caracteristiques-contact')).toContainText("Cheffe d'atelier")
		await capturer(page, 'fiche-contact-sans-affaire-1440', UNITE)
	})

	test('la fiche d’organisation mène elle aussi à la fiche du contact — cas n du §15.6', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts/organisations/5eed0000-0000-4000-8000-000000000081')
		await page.getByTestId('lien-contact-organisation').click()
		await expect(page).toHaveURL(new RegExp(`/contacts/${ID_LEO_UI}$`))
		await expect(page.getByRole('heading', { name: 'Léo Marchand' })).toBeVisible()
	})

	test('un identifiant inconnu et un identifiant MAL FORMÉ rendent le même écran — cas h et i', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts/00000000-0000-4000-8000-000000000000')
		await expect(page.getByText('Contact introuvable')).toBeVisible()
		await expect(page.getByRole('link', { name: 'Revenir au carnet' })).toBeVisible()
		await capturer(page, 'fiche-contact-introuvable-1440', UNITE)

		// L'identifiant mal formé n'émet AUCUNE requête (§15.4) : l'écran est pourtant le même,
		// délibérément — trois absences, un seul écran.
		await page.goto('/contacts/pas-un-uuid')
		await expect(page.getByText('Contact introuvable')).toBeVisible()
	})

	test('LA LECTRICE voit le contact mais AUCUNE affaire fermée à son track — cas o du §15.9', async ({
		page,
	}) => {
		// LA MESURE DÉCISIVE DU §15.4, éprouvée à l'écran. Le track « Conseil IA » est fermé à la
		// lectrice : la zone des affaires rend l'état vide ordinaire, sans mise en scène du refus.
		// L'écran ne calcule aucun droit — c'est le backend qui a retiré la ligne.
		await connecter(page, VIEWER)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await expect(page.getByRole('heading', { name: 'Léo Marchand' })).toBeVisible()
		await expect(page.getByTestId('caracteristiques-contact')).toContainText('Directeur achats')
		await expect(page.getByTestId('tableau-affaires-contact')).toHaveCount(0)
		await expect(page.getByRole('heading', { name: 'Aucune affaire' })).toBeVisible()

		// Sur Sophie, dont l'affaire vit dans un track qui lui est ouvert, l'affaire EST rendue :
		// sans ce second volet, l'état vide ci-dessus pourrait venir d'un écran cassé.
		await page.goto('/contacts/5eed0000-0000-4000-8000-000000000092')
		await expect(page.getByTestId('ligne-affaire-contact')).toHaveCount(1)
		await expect(page.getByTestId('ligne-affaire-contact')).toContainText(
			'Refonte intranet Ville de Lyon',
		)
	})

	test('sans session, la fiche rend « introuvable » — un refus est zéro ligne, jamais une erreur', async ({
		page,
	}) => {
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await expect(page.getByText('Contact introuvable')).toBeVisible()
	})

	test('la fiche est atteignable au CLAVIER seul depuis le carnet', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts')
		const lien = page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Léo Marchand' })
			.getByTestId('lien-contact')
		await lien.focus()
		await expect(lien).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('heading', { name: 'Léo Marchand' })).toBeVisible()
		await expect(page.getByTestId('tableau-affaires-contact')).toBeVisible()
	})

	for (const palier of PALIERS) {
		test(`${palier.nom} : la fiche de contact reste lisible et la page ne défile pas horizontalement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto(`/contacts/${ID_LEO_UI}`)
			await expect(page.getByTestId('tableau-affaires-contact')).toBeVisible()

			// §7 : c'est le CONTENEUR du tableau qui défile, jamais la page (§12.6).
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(debordePage).toBe(false)
			await capturer(page, `fiche-contact-${palier.largeur}`, UNITE)
		})
	}
})
