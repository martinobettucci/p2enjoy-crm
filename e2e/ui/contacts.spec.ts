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

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	expect,
	test,
	type Page,
} from './fixtures'
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

// ================================================================================================
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4g : la MODIFICATION d'un contact
// @verifies docs/SPEC-contacts.md §16.2 (le geste s'ancre sur la fiche, dans le flux),
//           §16.5 (le retour du focus), §16.6 (aucun droit calculé par l'écran),
//           §16.7 (la fiche s'actualise sans relire), §16.9 (cas b, c, e, f, m, o)
// @verifies docs/DESIGN_SYSTEM.md §5.25 (ce formulaire) ; CLAUDE.md §16 (vérification visuelle)
//
// CETTE SUITE ÉCRIT DANS LA BASE, et elle RESTITUE le seed par les GESTES DE L'ÉCRAN, jamais par
// une requête de service : si la restitution empruntait un autre chemin que la modification
// elle-même, un échec du produit laisserait le seed dérivé sans que rien ne le signale. La
// restitution est donc, elle aussi, une preuve que le geste fonctionne.
// ================================================================================================

const FONCTION_SEED_LEO = 'Directeur achats'

test.describe('modification d’un contact (docs/SPEC-contacts.md §16.9)', () => {
	test('cas b, e, f : la fiche s’édite, la zone 1 et le TITRE suivent, puis le seed est restitué', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await expect(page.getByRole('heading', { name: 'Léo Marchand' })).toBeVisible()

		// Cas b : le formulaire s'ouvre PRÉREMPLI, dans le flux du document, et la commande
		// disparaît — les deux s'excluent (§16.5).
		await page.getByTestId('ouvrir-modification-contact').click()
		const formulaire = page.getByTestId('formulaire-modification-contact')
		await expect(formulaire).toBeVisible()
		await expect(page.getByTestId('champ-nom-contact')).toHaveValue('Léo Marchand')
		await expect(page.getByTestId('champ-fonction-contact')).toHaveValue(FONCTION_SEED_LEO)
		await expect(page.getByTestId('ouvrir-modification-contact')).toHaveCount(0)
		// Les deux zones de lecture restent SOUS le formulaire : on corrige en voyant ce que l'on
		// corrige (§16.5). Une modale les recouvrirait.
		await expect(page.getByTestId('tableau-affaires-contact')).toBeVisible()
		await capturer(page, 'fiche-contact-modification-formulaire-1440', UNITE)

		await page.getByTestId('champ-fonction-contact').fill('Directeur général')
		await page.getByTestId('envoyer-modification-contact').click()

		// Cas e : la zone 1 rend la NOUVELLE valeur, et le formulaire se referme.
		await expect(page.getByTestId('formulaire-modification-contact')).toHaveCount(0)
		await expect(page.getByText('Directeur général')).toBeVisible()
		// Cas f : le titre de la route est une DONNÉE, et il suit — vérifié sur le nom.
		await page.getByTestId('ouvrir-modification-contact').click()
		await page.getByTestId('champ-nom-contact').fill('Léo Marchand-Vasseur')
		await page.getByTestId('envoyer-modification-contact').click()
		await expect(page.getByRole('heading', { name: 'Léo Marchand-Vasseur' })).toBeVisible()
		// La zone 2 est INCHANGÉE : aucune colonne du formulaire n'entre dans un rattachement.
		await expect(page.getByTestId('ligne-affaire-contact')).toHaveCount(1)
		await capturer(page, 'fiche-contact-modification-apres-1440', UNITE)

		// LE SEED EST RESTITUÉ PAR LES GESTES DE L'ÉCRAN, et la fiche le confirme.
		await page.getByTestId('ouvrir-modification-contact').click()
		await page.getByTestId('champ-nom-contact').fill('Léo Marchand')
		await page.getByTestId('champ-fonction-contact').fill(FONCTION_SEED_LEO)
		await page.getByTestId('envoyer-modification-contact').click()
		await expect(page.getByRole('heading', { name: 'Léo Marchand' })).toBeVisible()
		await expect(page.getByText(FONCTION_SEED_LEO)).toBeVisible()
	})

	test('cas c : au CLAVIER, « Annuler » rend le focus à la commande d’ouverture', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		const commande = page.getByTestId('ouvrir-modification-contact')
		await commande.focus()
		await page.keyboard.press('Enter')

		// Le focus ENTRE sur le champ du nom : un formulaire qui s'ouvre sans prendre le focus
		// oblige à le chercher au clavier.
		await expect(page.getByTestId('champ-nom-contact')).toBeFocused()
		await page.getByTestId('annuler-modification-contact').focus()
		await page.keyboard.press('Enter')

		// LE FOCUS REVIENT à la commande REMONTÉE (§16.5), et ne retombe pas sur le document —
		// c'est le défaut que la décision 453 a trouvé au carnet, éprouvé ici sur la pile réelle.
		await expect(page.getByTestId('ouvrir-modification-contact')).toBeFocused()
	})

	test('cas m : la LECTRICE voit le geste, envoie, et reçoit le silence DIT, saisie conservée', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(`/contacts/${ID_LEO_UI}`)

		// AUCUNE COMMANDE ÉTEINTE D'AVANCE (§16.6) : la lectrice voit le geste comme tout le monde.
		const commande = page.getByTestId('ouvrir-modification-contact')
		await expect(commande).toBeVisible()
		await expect(commande).toBeEnabled()
		await commande.click()
		await page.getByTestId('champ-fonction-contact').fill('Fonction usurpée')
		await page.getByTestId('envoyer-modification-contact').click()

		// LE SILENCE DU SERVEUR EST DIT : `200` et zéro ligne, que l'écran traduit plutôt que de
		// refermer le formulaire sur une modification qui n'a jamais eu lieu (§16.3).
		const refus = page.getByTestId('refus-modification-contact')
		await expect(refus).toBeVisible()
		// La saisie est CONSERVÉE, et le formulaire reste ouvert.
		await expect(page.getByTestId('champ-fonction-contact')).toHaveValue('Fonction usurpée')
		await expect(page.getByTestId('formulaire-modification-contact')).toBeVisible()
		await capturer(page, 'fiche-contact-modification-sans-effet-1440', UNITE)

		// LE SEED EST INTACT : rien n'a été écrit, et la fiche rechargée le montre.
		await page.reload()
		await expect(page.getByText(FONCTION_SEED_LEO)).toBeVisible()
	})

	test('390 px : le formulaire de modification reste lisible et la page ne défile pas', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await page.getByTestId('ouvrir-modification-contact').click()
		await expect(page.getByTestId('formulaire-modification-contact')).toBeVisible()
		const debordePage = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		)
		expect(debordePage).toBe(false)
		await capturer(page, 'fiche-contact-modification-390', UNITE)
	})
})

// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4h : le RATTACHEMENT d'une affaire
//           depuis la fiche d'un contact
// @verifies docs/SPEC-contacts.md §17.2 (le geste vit DANS la zone des affaires), §17.6 (de quoi
//           il a l'air, et l'écran ne calcule aucun droit), §17.7 (cas b, c, d, f, g, i, m)
// @verifies docs/DESIGN_SYSTEM.md §5.26 (ce geste), §7 (paliers) ; CLAUDE.md §16 (vérification
//           visuelle)
//
// LE SEED EST RESTITUÉ PAR LES GESTES DE L'ÉCRAN, jamais par une requête de service : le
// rattachement posé par le parcours est retiré depuis la fiche de l'AFFAIRE, qui porte le geste de
// détachement (§12.6) — celui que cette page ne livre pas (§17.8). C'est la règle que 4g tient
// déjà, et elle éprouve du même coup le chemin de retour que le §17.8 invoque pour assumer
// l'asymétrie.

/** « Refonte du site vitrine », sur le track « Grands comptes » — aucun contact du seed n'y est. */
const CARD_VITRINE_UI = '5eed0000-0000-4000-8000-0000000000c1'
const TITRE_VITRINE = 'Refonte du site vitrine'
/**
 * « Refonte intranet Ville de Lyon » : la lectrice la LIT et ne peut PAS l'écrire — MESURÉ (§17.4,
 * mesure 19). L'affaire est nommée et non prise au rang, les droits fins de `CRM-012` divergeant
 * d'une affaire à l'autre pour un même profil.
 */
const CARD_INTRANET_UI = '5eed0000-0000-4000-8000-0000000000c4'

/** Retire le rattachement PAR LES GESTES DE L'ÉCRAN, depuis la fiche de l'affaire (§12.6). */
async function detacherDepuisLAffaire(page: Page, nomContact: string): Promise<void> {
	await page.goto(`/tracks/conseil-ia/grands-comptes/cards/${CARD_VITRINE_UI}`)
	const ligne = page.getByTestId('ligne-contact-card').filter({ hasText: nomContact })
	await expect(ligne).toBeVisible()
	await ligne.getByTestId('detacher-contact').click()
	await page.getByTestId('confirmer-detachement').click()
	await expect(page.getByTestId('ligne-contact-card').filter({ hasText: nomContact })).toHaveCount(0)
}

test.describe('rattachement d’une affaire depuis la fiche (docs/SPEC-contacts.md §17.7)', () => {
	test('cas b, d, f et g : le geste rattache, la zone est RELUE, et le seed est restitué', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await expect(page.getByRole('heading', { name: 'Léo Marchand' })).toBeVisible()

		// Cas b : la commande vit DANS la zone des affaires, et l'ouvrir la remplace (§17.2).
		const commande = page.getByTestId('ouvrir-rattachement-affaire')
		await expect(commande).toBeVisible()
		await commande.click()
		const formulaire = page.getByTestId('formulaire-rattachement-affaire')
		await expect(formulaire).toBeVisible()
		await expect(page.getByTestId('ouvrir-rattachement-affaire')).toHaveCount(0)
		// LE TABLEAU RESTE VISIBLE SOUS LE FORMULAIRE : il est précisément ce qui dit à quelles
		// affaires le contact est DÉJÀ rattaché, et une modale le recouvrirait (§5.26).
		await expect(page.getByTestId('tableau-affaires-contact')).toBeVisible()

		// Cas d : l'affaire à laquelle Léo est DÉJÀ rattaché n'est pas offerte, et la seule affaire
		// ARCHIVÉE du seed l'est, avec sa mention.
		const selecteur = page.getByTestId('champ-affaire')
		const libelles = await selecteur.locator('option').allTextContents()
		expect(libelles).not.toContain('Migration ERP Sogexia')
		expect(libelles).toContain(TITRE_VITRINE)
		expect(libelles).toContain('Contrat cadre 2025 (archivée)')
		await capturer(page, 'fiche-contact-rattachement-formulaire-1440', UNITE)

		await selecteur.selectOption(CARD_VITRINE_UI)
		await page.getByTestId('champ-role-affaire').fill('sponsor')
		await page.getByTestId('confirmer-rattachement-affaire').click()

		// Cas f : le formulaire se referme, la commande remonte, et la ZONE EST RELUE — la nouvelle
		// affaire y apparaît avec son rôle et son LIEN, que le sélecteur ne connaissait pas : il ne
		// lit ni track ni channel (§17.3).
		await expect(page.getByTestId('formulaire-rattachement-affaire')).toHaveCount(0)
		const nouvelle = page.getByTestId('ligne-affaire-contact').filter({ hasText: TITRE_VITRINE })
		await expect(nouvelle).toBeVisible()
		await expect(nouvelle).toContainText('sponsor')
		await expect(nouvelle.getByTestId('lien-affaire-contact')).toHaveAttribute(
			'href',
			new RegExp(`/cards/${CARD_VITRINE_UI}$`),
		)
		await capturer(page, 'fiche-contact-rattachement-apres-1440', UNITE)

		// LE SEED EST RESTITUÉ PAR LES GESTES DE L'ÉCRAN (§12.6), jamais par une requête de service.
		await detacherDepuisLAffaire(page, 'Léo Marchand')
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await expect(
			page.getByTestId('ligne-affaire-contact').filter({ hasText: TITRE_VITRINE }),
		).toHaveCount(0)
	})

	test('cas b et c AU CLAVIER : le focus ENTRE dans le sélecteur, et REVIENT à la commande', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_ELISE_UI}`)
		await expect(page.getByRole('heading', { name: 'Élise Fabre' })).toBeVisible()

		// Élise n'a AUCUNE affaire : son état vide GARDE le geste — c'est lui qui le comble, et
		// c'est la révision par livraison du §5.24.
		await expect(page.getByText('Aucune affaire', { exact: true })).toBeVisible()
		const commande = page.getByTestId('ouvrir-rattachement-affaire')
		await expect(commande).toBeVisible()

		await commande.focus()
		await page.keyboard.press('Enter')
		// LE FOCUS ENTRE DANS LE SÉLECTEUR dès qu'il est focalisable — il est désactivé tant que la
		// liste se lit, et un élément désactivé ne le reçoit pas. Le défaut a été trouvé par la
		// preuve unitaire ; ce scénario le tient sur la pile réelle.
		await expect(page.getByTestId('champ-affaire')).toBeFocused()

		// Cas c : « Annuler » remonte la commande ET LUI REND LE FOCUS. Le retour est différé d'un
		// tour de rendu, la commande étant démontée pendant que le formulaire est ouvert.
		await page.getByRole('button', { name: 'Annuler' }).click()
		await expect(page.getByTestId('ouvrir-rattachement-affaire')).toBeFocused()
	})

	test('cas i : la LECTRICE voit le geste, envoie, et reçoit le refus DIT, saisie conservée', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(`/contacts/${ID_LEO_UI}`)

		// AUCUNE COMMANDE ÉTEINTE D'AVANCE (§17.6) : la lectrice voit le geste comme tout le monde.
		const commande = page.getByTestId('ouvrir-rattachement-affaire')
		await expect(commande).toBeVisible()
		await expect(commande).toBeEnabled()
		await commande.click()

		const selecteur = page.getByTestId('champ-affaire')
		await expect(selecteur).toBeEnabled()
		// ELLE CHOISIT UNE AFFAIRE QU'ELLE LIT MAIS NE PEUT PAS ÉCRIRE, et l'affaire est NOMMÉE
		// plutôt que prise au rang : la mesure 19 du §17.4 a montré que la lectrice ÉCRIT sur
		// « Assistant IA support — Nordis » et se voit refuser les autres — les droits fins de
		// `CRM-012` divergent d'une affaire à l'autre pour un MÊME profil. Prendre la première
		// option venue ferait passer ce scénario tantôt par le refus, tantôt par le succès.
		await expect(selecteur.locator(`option[value="${CARD_INTRANET_UI}"]`)).toHaveCount(1)
		await selecteur.selectOption(CARD_INTRANET_UI)
		await page.getByTestId('champ-role-affaire').fill('rôle refusé')
		await page.getByTestId('confirmer-rattachement-affaire').click()

		// LE REFUS EST EXPLICITE, et il est DIT — un vrai `403`, et non le silence de la
		// modification (§17.4, mesure 9). Aucune mention « sans effet » n'a d'objet ici.
		await expect(page.getByTestId('refus-rattachement-affaire')).toBeVisible()
		// La saisie est CONSERVÉE et le formulaire reste ouvert (§5.7 ter).
		await expect(page.getByTestId('champ-role-affaire')).toHaveValue('rôle refusé')
		await expect(page.getByTestId('formulaire-rattachement-affaire')).toBeVisible()
		await capturer(page, 'fiche-contact-rattachement-refus-1440', UNITE)

		// LE REFUS EST DÉCLARÉ, PAS FILTRÉ. Chromium journalise tout `403` réseau dans la console,
		// et la garde de `CRM-007` fait de la console un verdict. Le scénario consomme donc la
		// liste EXACTE des erreurs qu'il vient de provoquer ET d'expliquer à l'utilisateur : un
		// statut, un nombre ou un ordre différent échouerait ici, et toute anomalie postérieure
		// reste dans le verdict final. C'est le mécanisme des refus déjà éprouvés par `CRM-057` et
		// `CRM-076`, employé sans exception nouvelle.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])

		// LE SEED EST INTACT : rien n'a été écrit, et la fiche rechargée le montre. La lectrice ne
		// voit AUCUNE affaire sur Léo — les droits fins lui ferment « Grands comptes » (§15.4), et
		// cette zone vide est l'état vide ORDINAIRE, sans mise en scène du refus.
		await page.reload()
		await expect(page.getByTestId('ligne-affaire-contact')).toHaveCount(0)
	})

	test('390 px : le formulaire de rattachement reste lisible et la page ne défile pas', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await page.getByTestId('ouvrir-rattachement-affaire').click()
		await expect(page.getByTestId('formulaire-rattachement-affaire')).toBeVisible()
		const debordePage = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		)
		expect(debordePage).toBe(false)
		await capturer(page, 'fiche-contact-rattachement-390', UNITE)
	})
})

// =================================================================================================
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4i : le DÉTACHEMENT d'une affaire
//           depuis la fiche d'un contact
// @verifies docs/SPEC-contacts.md §18.4 (la quatrième colonne, la confirmation sur une ligne à
//           elle, l'exclusivité), §18.6 (de quoi le geste a l'air, la relecture dans les trois
//           issues), §18.7 (cas a, b, c, d, f, h, j, m)
// @verifies docs/DESIGN_SYSTEM.md §5.27 (ce geste), §7 (paliers) ; CLAUDE.md §16 (vérification
//           visuelle)
//
// LE SEED EST RESTITUÉ PAR LE GESTE QUE CETTE SOUS-TRANCHE LIVRE, et c'est ce qui l'éprouve le
// mieux : 4h a dû aller chercher le détachement sur la fiche de l'AFFAIRE, faute de l'avoir ici.
// Le parcours rattache depuis la fiche du contact, puis détache DEPUIS LA MÊME PAGE — l'asymétrie
// que le §17.8 assumait est comblée, et la preuve la referme sans jamais toucher la base.

/** Sophie Dupont, rattachée par le seed à « Refonte intranet Ville de Lyon » que la lectrice LIT. */
const ID_SOPHIE_UI = '5eed0000-0000-4000-8000-000000000092'
const TITRE_INTRANET = 'Refonte intranet Ville de Lyon'

test.describe('détachement d’une affaire depuis la fiche (docs/SPEC-contacts.md §18.7)', () => {
	test('cas a, b, d et f : chaque ligne porte sa commande, une seule confirmation, la zone est RELUE', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await expect(page.getByRole('heading', { name: 'Léo Marchand' })).toBeVisible()

		// On pose d'abord un second rattachement PAR LES GESTES DE L'ÉCRAN (4h), pour disposer de
		// DEUX lignes : le cas d — l'exclusivité des confirmations — n'a aucun sens sur une seule.
		await page.getByTestId('ouvrir-rattachement-affaire').click()
		await page.getByTestId('champ-affaire').selectOption(CARD_VITRINE_UI)
		await page.getByTestId('confirmer-rattachement-affaire').click()
		await expect(page.getByTestId('ligne-affaire-contact')).toHaveCount(2)

		// Cas a : LA QUATRIÈME COLONNE porte un en-tête lisible, et CHAQUE ligne sa commande.
		await expect(page.getByRole('columnheader', { name: 'Commandes' })).toBeVisible()
		await expect(page.getByTestId('detacher-affaire-contact')).toHaveCount(2)
		await expect(page.getByTestId('ligne-confirmation-detachement')).toHaveCount(0)

		// Cas b : la confirmation apparaît sur UNE LIGNE À ELLE, sous la sienne, et NOMME l'affaire.
		const commandeERP = page.getByTestId('detacher-affaire-contact').first()
		await commandeERP.click()
		const confirmation = page.getByTestId('confirmation-detachement-affaire')
		await expect(confirmation).toBeVisible()
		await expect(confirmation).toContainText('Migration ERP Sogexia')
		// LE TABLEAU RESTE ENTIER SOUS LA CONFIRMATION : elle vit DANS le flux, jamais en modale.
		await expect(page.getByTestId('ligne-affaire-contact')).toHaveCount(2)
		await capturer(page, 'fiche-contact-detachement-confirmation-1440', UNITE)

		// Cas d : ouvrir la confirmation d'une AUTRE ligne ferme la précédente. Deux questions
		// destructrices simultanées ne diraient pas à laquelle on répond (§18.4).
		const ligneVitrine = page
			.getByTestId('ligne-affaire-contact')
			.filter({ hasText: TITRE_VITRINE })
		await ligneVitrine.getByTestId('detacher-affaire-contact').click()
		await expect(page.getByTestId('ligne-confirmation-detachement')).toHaveCount(1)
		await expect(page.getByTestId('confirmation-detachement-affaire')).toContainText(TITRE_VITRINE)

		// Cas f : le détachement est appliqué, la confirmation se ferme, LA ZONE EST RELUE, la
		// ligne part, et AUCUN message n'est affiché — un succès ne se commente pas.
		await page.getByTestId('confirmer-detachement-affaire').click()
		await expect(page.getByTestId('ligne-affaire-contact')).toHaveCount(1)
		await expect(page.getByTestId('confirmation-detachement-affaire')).toHaveCount(0)
		await expect(page.getByTestId('message-detachement-affaire')).toHaveCount(0)
		await capturer(page, 'fiche-contact-detachement-apres-1440', UNITE)

		// LE SEED EST RENDU INTACT PAR LE GESTE MÊME DE CETTE SOUS-TRANCHE, sans quitter la fiche :
		// c'est le chemin que le §17.8 devait emprunter par la fiche de l'affaire, désormais inutile.
		await page.reload()
		await expect(
			page.getByTestId('ligne-affaire-contact').filter({ hasText: TITRE_VITRINE }),
		).toHaveCount(0)
		await expect(page.getByTestId('ligne-affaire-contact')).toHaveCount(1)
	})

	test('cas b et c AU CLAVIER : le focus ENTRE dans la confirmation, et REVIENT à la commande de SA ligne', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		const commande = page.getByTestId('detacher-affaire-contact').first()
		await expect(commande).toBeVisible()

		await commande.focus()
		await page.keyboard.press('Enter')
		// Le focus ENTRE dans le bouton de confirmation : il peut le faire au montage, la
		// confirmation ne lisant rien et son bouton n'étant jamais désactivé au premier rendu.
		await expect(page.getByTestId('confirmer-detachement-affaire')).toBeFocused()

		// La commande de SA ligne est DÉSACTIVÉE tant que la confirmation est ouverte — commande
		// sans objet, et non garde de droit (§18.4).
		await expect(commande).toBeDisabled()

		// Cas c : « Annuler » démonte la confirmation ET REND LE FOCUS à la commande de sa ligne.
		// Le retour est DIFFÉRÉ d'un tour de rendu : la commande est `disabled` au moment de la
		// fermeture, et un élément désactivé ne reçoit pas le focus.
		await page.getByTestId('annuler-detachement-affaire').click()
		await expect(page.getByTestId('confirmation-detachement-affaire')).toHaveCount(0)
		await expect(commande).toBeFocused()
	})

	test('cas h et m : la LECTRICE voit la commande, confirme, et le SILENCE est dit — la ligne RESTE', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(`/contacts/${ID_SOPHIE_UI}`)
		await expect(page.getByRole('heading', { name: 'Sophie Dupont' })).toBeVisible()

		// Cas m : AUCUNE COMMANDE ÉTEINTE D'AVANCE (§18.6). MESURÉ : la lectrice RÉUSSIT ce geste
		// sur « Assistant IA support — Nordis » et reçoit le silence ici — les droits fins de
		// `CRM-012` divergent d'une affaire à l'autre pour un MÊME profil, et l'écran qui grisrait
		// « parce que lecteur » se tromperait. L'affaire est donc NOMMÉE, jamais prise au rang.
		const ligne = page.getByTestId('ligne-affaire-contact').filter({ hasText: TITRE_INTRANET })
		await expect(ligne).toBeVisible()
		const commande = ligne.getByTestId('detacher-affaire-contact')
		await expect(commande).toBeEnabled()
		await commande.click()
		await page.getByTestId('confirmer-detachement-affaire').click()

		// Cas h : LE SILENCE EST DIT. La clause `USING` a filtré la ligne avant la suppression, et
		// le serveur a rendu `200` avec zéro ligne SANS erreur. Le message n'affirme ni le refus ni
		// la disparition — les deux causes sont indistinguables (§18.3).
		const message = page.getByTestId('message-detachement-affaire')
		await expect(message).toBeVisible()
		await expect(message).toHaveAttribute('role', 'alert')
		await expect(page.getByTestId('confirmation-detachement-affaire')).toHaveCount(0)
		// ET LA LIGNE RESTE, parce que la base l'a gardée. C'est tout le point de l'issue : un
		// retrait optimiste aurait effacé ici une ligne bien vivante, et annoncé un détachement qui
		// n'a pas eu lieu.
		await expect(page.getByTestId('ligne-affaire-contact').filter({ hasText: TITRE_INTRANET })).toBeVisible()
		await capturer(page, 'fiche-contact-detachement-sans-effet-1440', UNITE)

		// AUCUNE ERREUR N'EST DÉCLARÉE À LA GARDE DE CONSOLE, et c'est l'écart avec le refus de 4h :
		// un `200` n'est pas une erreur réseau, et Chromium n'en journalise aucune. La console reste
		// VIERGE sur un refus que l'utilisateur voit pourtant écrit.

		// LE SEED EST INTACT : rien n'a été retiré, et la fiche rechargée le montre.
		await page.reload()
		await expect(page.getByTestId('ligne-affaire-contact').filter({ hasText: TITRE_INTRANET })).toBeVisible()
	})

	test('390 px : la confirmation de détachement reste lisible et la page ne défile pas', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await connecter(page, ADMIN)
		await page.goto(`/contacts/${ID_LEO_UI}`)
		await page.getByTestId('detacher-affaire-contact').first().click()
		await expect(page.getByTestId('confirmation-detachement-affaire')).toBeVisible()
		// Le TABLEAU déborde horizontalement dans son conteneur `.indique-debordement-x` (§12.6),
		// ce qui est son contrat ; la PAGE, elle, ne défile pas.
		const debordePage = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		)
		expect(debordePage).toBe(false)
		await capturer(page, 'fiche-contact-detachement-390', UNITE)
		// On referme sans détacher : ce scénario mesure une mise en page, il n'écrit rien.
		await page.getByTestId('annuler-detachement-affaire').click()
	})
})
