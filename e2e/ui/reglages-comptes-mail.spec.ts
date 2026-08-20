// @verifies CRM-088 (docs/BACKLOG.md) — écran de configuration des comptes entrants, parcours réel
// @verifies docs/SPEC-mail-subsystem.md §21.2 (l'adresse et sa place dans l'index), §21.3 (les
//           trois lectures), §21.4 (le formulaire et son sélecteur), §21.5 (le mot de passe vide
//           conserve le secret), §21.7 (le refus est une phrase du produit), §21.8 (les états)
// @verifies docs/DESIGN_SYSTEM.md §5.34 (cette surface), §7 (paliers) ; CLAUDE.md §16
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, et l'écran est atteint depuis l'index des réglages, jamais par une
// navigation directe.
//
// LE SEED EST RENDU TEL QU'IL A ÉTÉ REÇU — leçon d'INC-061. Les deux scénarios qui écrivent
// remettent la boîte système dans son état d'origine par le VÉRITABLE chemin d'écriture, celui-là
// même que l'écran emprunte, et non par un `PATCH` direct que la base refuse de toute façon.

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	expect,
	test,
	type Page,
} from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-088'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

/** Le libellé du seed (`docs/SPEC-seed.md` §2.17) — un littéral stable, jamais un identifiant. */
const LABEL_SYSTEME = 'Boîte système du workspace'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/**
 * Remet la boîte système dans l'état du seed, par la fonction d'écriture et le jeton RÉEL de
 * l'administratrice.
 *
 * **PAS AVEC LA CLÉ DE SERVICE, ET C'EST MESURÉ** : `upsert_mail_inbound_account` lit
 * `auth.uid()` en première ligne et refuse `not_authenticated` quand il est nul — ce qui est le
 * cas d'une clé de service, qui n'est le jeton de personne. Une restauration par cette clé échoue
 * donc **en silence** du point de vue du scénario, et le suivant trouve un seed modifié : défaut
 * trouvé en exécutant cette suite, pas à la lecture.
 *
 * `p_password` est OMIS : le secret enregistré doit être conservé, exactement comme l'écran le
 * fait quand son champ reste vide (§21.5). Le passer réécrirait le secret et remettrait l'état à
 * `pending`, ce qui rendrait le seed différent de ce qu'il était.
 */
async function restaurerBoiteSysteme(page: Page): Promise<void> {
	const jeton = await jetonDe(ADMIN)
	const reponse = await page.request.post(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
		headers: enTetesAuthentifies(jeton),
		data: {
			p_workspace_id: WORKSPACE,
			p_label: LABEL_SYSTEME,
			p_imap_host: 'stalwart',
			p_imap_port: 143,
			p_imap_security: 'none',
			p_imap_username: 'systeme@crm.p2enjoy.test',
		},
	})
	// Une restauration qui échoue doit le DIRE : sinon le scénario suivant échouerait sur une
	// cause qui n'est pas la sienne.
	expect(reponse.status(), 'le seed doit être rendu tel qu’il a été reçu').toBe(200)
}

test.describe('configuration des comptes entrants (docs/SPEC-mail-subsystem.md §21)', () => {
	test('l’administratrice atteint l’écran depuis les réglages et voit ses trois boîtes', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages')

		// L'entrée vit AVANT « État de la messagerie » (§21.2) : on configure une boîte avant d'en
		// superviser la relève. L'ordre est une règle, il se vérifie.
		const entrees = page.getByRole('link')
		const libelles = await entrees.allInnerTexts()
		const rangConfiguration = libelles.findIndex((libelle) =>
			libelle.includes('Comptes de messagerie entrante'),
		)
		const rangEtat = libelles.findIndex((libelle) => libelle.includes('État de la messagerie'))
		expect(rangConfiguration).toBeGreaterThanOrEqual(0)
		expect(rangConfiguration).toBeLessThan(rangEtat)

		await page.getByRole('link', { name: 'Comptes de messagerie entrante' }).click()
		await expect(page).toHaveURL(/\/reglages\/comptes-mail$/)
		await expect(
			page.getByRole('heading', { name: 'Comptes de messagerie entrante' }),
		).toBeVisible()

		await expect(page.getByTestId('ligne-compte-configuration')).toHaveCount(3)
		// La connexion est une donnée technique, le mode de sécurité un MOT (§5.34).
		await expect(page.getByTestId('connexion-compte').first()).toHaveText('stalwart:143')
		await expect(
			page.getByTestId('ligne-compte-configuration').filter({ hasText: 'système' }).getByText('Aucune'),
		).toBeVisible()
		// Les trois comptes du seed n'ont jamais été éprouvés : ils sont « En attente ».
		await expect(page.getByText('En attente').first()).toBeVisible()

		// Le formulaire est REPLIÉ par défaut (§5.34).
		await expect(page.getByTestId('formulaire-compte-mail')).toHaveCount(0)
	})

	test('elle modifie le libellé de la boîte système SANS toucher au mot de passe', async ({
		page,
	}) => {
		try {
			await connecter(page, ADMIN)
			await page.goto('/reglages/comptes-mail')

			const ligneSysteme = page
				.getByTestId('ligne-compte-configuration')
				.filter({ hasText: LABEL_SYSTEME })
			await ligneSysteme.getByTestId('configurer-compte').click()

			const formulaire = page.getByTestId('formulaire-compte-mail')
			await expect(formulaire).toBeVisible()
			// Préremplissage (§21.4) — et le mot de passe reste VIDE, sans point de substitution.
			await expect(page.getByTestId('champ-libelle-compte')).toHaveValue(LABEL_SYSTEME)
			await expect(page.getByTestId('champ-port')).toHaveValue('143')
			await expect(page.getByTestId('champ-mot-de-passe')).toHaveValue('')

			await page.getByTestId('champ-libelle-compte').fill('Boîte système (libellé éprouvé)')
			await page.getByTestId('valider-compte-mail').click()

			// Le succès referme le formulaire et RELIT la liste (§21.8).
			await expect(page.getByTestId('formulaire-compte-mail')).toHaveCount(0)
			await expect(
				page.getByTestId('ligne-compte-configuration').filter({ hasText: 'libellé éprouvé' }),
			).toBeVisible()

			// LA PREUVE QUI COMPTE : le secret n'a pas été touché. Le mot de passe du seed déchiffre
			// toujours, ce qui n'aurait plus été vrai si un champ vide avait été envoyé comme
			// nouveau mot de passe (§21.5).
			const identifiants = await page.request.post(
				`${URL_API}/rest/v1/rpc/mail_inbound_account_credentials`,
				{
					headers: enTetesService(),
					data: {
						p_account_id: await identifiantBoiteSysteme(page),
					},
				},
			)
			expect(identifiants.status()).toBe(200)
			const [ligne] = (await identifiants.json()) as { password: string }[]
			expect(ligne?.password).toBe(MOT_DE_PASSE_SEED)
		} finally {
			await restaurerBoiteSysteme(page)
		}
	})

	test('un port hors bornes est REFUSÉ, et l’écran écrit une phrase du produit', async ({
		page,
	}) => {
		try {
			await connecter(page, ADMIN)
			await page.goto('/reglages/comptes-mail')

			await page
				.getByTestId('ligne-compte-configuration')
				.filter({ hasText: LABEL_SYSTEME })
				.getByTestId('configurer-compte')
				.click()
			await page.getByTestId('champ-port').fill('70000')
			await page.getByTestId('valider-compte-mail').click()

			const refus = page.getByTestId('refus-compte-mail')
			await expect(refus).toBeVisible()
			await expect(refus).toHaveText(/entier compris entre 1 et 65535/)
			// AUCUN CORPS DE SERVEUR À L'ÉCRAN (§21.7) : ni le nom de la contrainte, ni la ligne
			// fautive, qui porte la référence Vault du secret (INC-193).
			await expect(refus).not.toContainText('mail_inbound_accounts')
			await expect(refus).not.toContainText('Failing row')

			// Le refus laisse le formulaire ouvert et n'efface pas la saisie (§21.7).
			await expect(page.getByTestId('formulaire-compte-mail')).toBeVisible()
			await expect(page.getByTestId('champ-port')).toHaveValue('70000')

			await capturer(page, 'comptes-mail-refus-1440', UNITE)

			// Le refus de la base est un `400`, que le navigateur journalise. Il est CONSOMMÉ ici,
			// nommément : la console reste par ailleurs vierge, et ce scénario ne relâche aucun
			// filtre global (docs/SPEC-webapp.md §12.3).
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		} finally {
			await restaurerBoiteSysteme(page)
		}
	})

	test('une lectrice sans boîte voit l’état vide, AVEC le geste qui le comble', async ({ page }) => {
		await connecter(page, VIEWER)
		await page.goto('/reglages/comptes-mail')

		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByText('Aucune boîte configurée')).toBeVisible()
		// L'écart assumé avec l'écran d'état (§5.14), qui n'agit pas : ici la commande est offerte.
		await expect(page.getByTestId('ouvrir-configuration')).toBeVisible()

		await page.getByTestId('ouvrir-configuration').click()
		// Le sélecteur porte la boîte système, que la lectrice peut viser et que la base refusera :
		// l'écran ne calcule aucun droit (§21.4).
		await expect(page.getByTestId('champ-boite')).toBeVisible()
		const options = await page.getByTestId('champ-boite').locator('option').allInnerTexts()
		expect(options.some((option) => option.includes('Boîte système'))).toBe(true)

		await capturer(page, 'comptes-mail-vide-1440', UNITE)
	})
})

/** L'identifiant de la boîte système, lu par la clé de service — jamais recopié d'une exécution. */
async function identifiantBoiteSysteme(page: Page): Promise<string> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne?.id, 'la boîte système du seed doit exister').toBeTruthy()
	return ligne?.id ?? ''
}

// --- Paliers responsive (docs/DESIGN_SYSTEM.md §7) --------------------------------------------
//
// La taille de fenêtre est fixée AVANT le chargement — même patron que `etat-messagerie.spec.ts` :
// la coquille applique son repli de barre latérale au montage, pas en réaction à un
// redimensionnement ultérieur.

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la liste et le formulaire restent lisibles`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto('/reglages/comptes-mail')
			await expect(page.getByTestId('liste-comptes-mail')).toBeVisible()

			await page
				.getByTestId('ligne-compte-configuration')
				.filter({ hasText: LABEL_SYSTEME })
				.getByTestId('configurer-compte')
				.click()
			await expect(page.getByTestId('formulaire-compte-mail')).toBeVisible()

			// La page ne défile JAMAIS horizontalement (§7), formulaire ouvert compris.
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

			await capturer(page, `comptes-mail-${palier.nom}`, UNITE)
		})
	}
})
