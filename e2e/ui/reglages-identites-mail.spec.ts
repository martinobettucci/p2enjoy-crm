// @verifies CRM-089 (docs/BACKLOG.md) — écran des identités sortantes SMTP, parcours réel
// @verifies docs/SPEC-mail-subsystem.md §22.2 (l'adresse et sa place dans l'index), §22.3 (les
//           trois lectures), §22.4 (changer l'adresse déclare une seconde identité), §22.5 (le
//           formulaire et son sélecteur), §22.6 (le mot de passe vide conserve le secret), §22.8
//           (le refus est une phrase du produit), §22.9 (les états)
// @verifies docs/DESIGN_SYSTEM.md §5.35 (cette surface), §7 (paliers) ; CLAUDE.md §16
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, et l'écran est atteint depuis l'index des réglages, jamais par une
// navigation directe.
//
// LE SEED EST RENDU TEL QU'IL A ÉTÉ REÇU — leçon d'INC-061. Les scénarios qui écrivent remettent
// l'identité de Driss dans son état d'origine par le VÉRITABLE chemin d'écriture, celui-là même
// que l'écran emprunte, et avec le jeton RÉEL de son propriétaire — jamais avec la clé de
// service, qui n'est le jeton de personne et que la fonction refuse en `not_authenticated`
// (défaut trouvé en exécutant la suite jumelle, `CRM-088`).

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	expect,
	test,
	type Page,
} from './fixtures'
import {
	MOT_DE_PASSE_SEED,
	URL_API,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-089'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

/** Les libellés du seed (`docs/SPEC-seed.md` §2.18) — des littéraux stables, jamais des identifiants. */
const LABEL_DRISS = 'Envoi de Driss Lemoine'
const ADRESSE_DRISS = 'contact@p2enjoy.test'

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
 * Remet l'identité de Driss dans l'état du seed, par la fonction d'écriture et son jeton RÉEL.
 *
 * `p_password` est OMIS : le secret enregistré doit être conservé, exactement comme l'écran le
 * fait quand son champ reste vide (§22.6). Le passer réécrirait le secret et remettrait l'état à
 * `pending`, ce qui rendrait le seed différent de ce qu'il était.
 *
 * `p_from_name` est envoyé VIDE ici, puis remis à `null` par la clé de service : la fonction
 * n'accepte que des valeurs, et seule une écriture directe peut rendre la colonne nulle comme le
 * seed la laisse.
 */
async function restaurerIdentiteDriss(page: Page): Promise<void> {
	const jeton = await jetonDe(BIZDEV)
	const reponse = await page.request.post(
		`${URL_API}/rest/v1/rpc/upsert_mail_outbound_identity`,
		{
			headers: enTetesAuthentifies(jeton),
			data: {
				p_workspace_id: WORKSPACE,
				p_label: LABEL_DRISS,
				p_smtp_host: 'stalwart',
				p_smtp_port: 587,
				p_smtp_security: 'none',
				p_smtp_username: BIZDEV,
				p_from_address: ADRESSE_DRISS,
				p_owner_id: DRISS,
				p_is_default: true,
			},
		},
	)
	// Une restauration qui échoue doit le DIRE : sinon le scénario suivant échouerait sur une
	// cause qui n'est pas la sienne.
	expect(reponse.status(), 'le seed doit être rendu tel qu’il a été reçu').toBe(200)

	// Toute identité SURNUMÉRAIRE est retirée : un scénario qui change l'adresse en déclare une
	// seconde (§22.4), et la laisser fausserait la lecture du scénario suivant.
	await page.request.delete(
		`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}&from_address=neq.${ADRESSE_DRISS}`,
		{ headers: enTetesService() },
	)
	await page.request.patch(
		`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}`,
		{ headers: enTetesService(), data: { from_name: null } },
	)
}

test.describe('configuration des identités sortantes (docs/SPEC-mail-subsystem.md §22)', () => {
	test('l’administratrice atteint l’écran depuis les réglages et voit les deux identités', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages')

		// L'entrée vit APRÈS « Comptes de messagerie entrante » et AVANT « État de la messagerie »
		// (§22.2) : on reçoit avant d'expédier, et on configure avant de superviser. L'ordre est une
		// règle, il se vérifie.
		const libelles = await page.getByRole('link').allInnerTexts()
		const rangComptes = libelles.findIndex((libelle) =>
			libelle.includes('Comptes de messagerie entrante'),
		)
		const rangIdentites = libelles.findIndex((libelle) => libelle.includes('Identités d’expédition'))
		const rangEtat = libelles.findIndex((libelle) => libelle.includes('État de la messagerie'))
		expect(rangIdentites).toBeGreaterThanOrEqual(0)
		expect(rangComptes).toBeLessThan(rangIdentites)
		expect(rangIdentites).toBeLessThan(rangEtat)

		await page.getByRole('link', { name: 'Identités d’expédition' }).click()
		await expect(page).toHaveURL(/\/reglages\/identites-mail$/)
		await expect(page.getByRole('heading', { name: 'Identités d’expédition' })).toBeVisible()

		await expect(page.getByTestId('ligne-identite-mail')).toHaveCount(2)
		// L'ADRESSE EST EN TÊTE (§5.35), et le cas d'usage du §2.2 est enfin VISIBLE : Driss
		// expédie depuis `contact@`, alors qu'il reçoit sur `bizdev@`.
		await expect(
			page.getByTestId('expediteur-identite').filter({ hasText: ADRESSE_DRISS }),
		).toBeVisible()
		// La connexion est une donnée technique, le mode de sécurité un MOT (§5.35).
		await expect(page.getByTestId('connexion-identite').first()).toHaveText('stalwart:587')
		// Les deux identités du seed n'ont jamais été éprouvées : elles sont « En attente ».
		await expect(page.getByText('En attente').first()).toBeVisible()
		// Les deux sont par défaut, chacune pour son propriétaire — l'index unique est PARTIEL.
		await expect(page.getByText('Par défaut')).toHaveCount(2)

		// Le formulaire est REPLIÉ par défaut (§5.35, §5.23).
		await expect(page.getByTestId('formulaire-identite-mail')).toHaveCount(0)

		await capturer(page, 'identites-mail-liste-1440', UNITE)
	})

	test('elle modifie le libellé SANS toucher au mot de passe, et la liste est relue', async ({
		page,
	}) => {
		try {
			await connecter(page, ADMIN)
			await page.goto('/reglages/identites-mail')

			const ligne = page.getByTestId('ligne-identite-mail').filter({ hasText: ADRESSE_DRISS })
			await ligne.getByTestId('configurer-identite').click()

			const formulaire = page.getByTestId('formulaire-identite-mail')
			await expect(formulaire).toBeVisible()
			// Préremplissage (§22.5) — et le mot de passe reste VIDE, sans point de substitution.
			await expect(page.getByTestId('champ-libelle-identite')).toHaveValue(LABEL_DRISS)
			await expect(page.getByTestId('champ-adresse-expedition')).toHaveValue(ADRESSE_DRISS)
			await expect(page.getByTestId('champ-port-smtp')).toHaveValue('587')
			await expect(page.getByTestId('champ-mot-de-passe-smtp')).toHaveValue('')
			// L'avertissement du §22.4 ne paraît QUE sur une identité existante.
			await expect(formulaire).toContainText('déclare une seconde')

			await capturer(page, 'identites-mail-formulaire-1440', UNITE)

			await page.getByTestId('champ-libelle-identite').fill('Envoi de Driss (libellé éprouvé)')
			await page.getByTestId('champ-nom-expediteur').fill('Driss Lemoine')
			await page.getByTestId('valider-identite-mail').click()

			// Le succès referme le formulaire et RELIT la liste (§22.9).
			await expect(page.getByTestId('formulaire-identite-mail')).toHaveCount(0)
			await expect(
				page.getByTestId('ligne-identite-mail').filter({ hasText: 'libellé éprouvé' }),
			).toBeVisible()
			// LE NOM D'EXPÉDITEUR EST RENDU `Nom <adresse>` (§5.35), et il vient d'être écrit.
			await expect(
				page.getByTestId('expediteur-identite').filter({ hasText: 'Driss Lemoine <' }),
			).toBeVisible()

			// LA PREUVE QUI COMPTE : le secret n'a pas été touché. Le mot de passe du seed déchiffre
			// toujours, ce qui n'aurait plus été vrai si un champ vide avait été envoyé comme
			// nouveau mot de passe (§22.6).
			const identifiants = await page.request.post(
				`${URL_API}/rest/v1/rpc/mail_outbound_identity_credentials`,
				{ headers: enTetesService(), data: { p_identity_id: await identifiantDriss(page) } },
			)
			expect(identifiants.status()).toBe(200)
			const [ligneSecret] = (await identifiants.json()) as { password: string }[]
			expect(ligneSecret?.password).toBe(MOT_DE_PASSE_SEED)
		} finally {
			await restaurerIdentiteDriss(page)
		}
	})

	// LE COMPORTEMENT QUE L'ÉCRAN NOMME AU LIEU DE L'INTERDIRE (§22.4), éprouvé de bout en bout :
	// l'utilisateur change l'adresse, valide, et VOIT deux lignes. C'est la relecture qui le rend
	// visible ; une liste complétée localement n'en aurait montré qu'une.
	test('changer l’adresse d’expédition fait apparaître une SECONDE identité', async ({ page }) => {
		try {
			await connecter(page, BIZDEV)
			await page.goto('/reglages/identites-mail')
			await expect(page.getByTestId('ligne-identite-mail')).toHaveCount(1)

			await page.getByTestId('configurer-identite').click()
			await page.getByTestId('champ-adresse-expedition').fill('devis@p2enjoy.test')
			await page.getByTestId('champ-mot-de-passe-smtp').fill(MOT_DE_PASSE_SEED)
			await page.getByTestId('valider-identite-mail').click()

			await expect(page.getByTestId('ligne-identite-mail')).toHaveCount(2)
			await expect(
				page.getByTestId('expediteur-identite').filter({ hasText: 'devis@p2enjoy.test' }),
			).toBeVisible()
			await expect(
				page.getByTestId('expediteur-identite').filter({ hasText: ADRESSE_DRISS }),
			).toBeVisible()
			// LE DÉFAUT S'EST DÉPLACÉ, et il n'y en a jamais eu aucun : une seule pilule.
			await expect(page.getByText('Par défaut')).toHaveCount(1)
		} finally {
			await restaurerIdentiteDriss(page)
		}
	})

	test('une adresse d’expédition non conforme est REFUSÉE, et l’écran écrit une phrase du produit', async ({
		page,
	}) => {
		try {
			await connecter(page, ADMIN)
			await page.goto('/reglages/identites-mail')

			await page
				.getByTestId('ligne-identite-mail')
				.filter({ hasText: ADRESSE_DRISS })
				.getByTestId('configurer-identite')
				.click()
			await page.getByTestId('champ-adresse-expedition').fill('pas-une-adresse')
			// LE MOT DE PASSE EST SAISI, ET C'EST INDISPENSABLE — mesuré le 2026-08-21. L'adresse
			// fait partie de la CLÉ : une adresse que la base ne reconnaît pas fait de l'appel une
			// DÉCLARATION, et la fonction vérifie `password_required` AVANT d'insérer. Sans mot de
			// passe, le refus obtenu serait celui du mot de passe manquant, jamais celui de
			// l'adresse — et ce scénario croirait éprouver la contrainte qu'il n'atteint pas
			// (§22.4, §22.7).
			await page.getByTestId('champ-mot-de-passe-smtp').fill(MOT_DE_PASSE_SEED)
			await page.getByTestId('valider-identite-mail').click()

			const refus = page.getByTestId('refus-identite-mail')
			await expect(refus).toBeVisible()
			await expect(refus).toHaveText(/adresse électronique/)
			// AUCUN CORPS DE SERVEUR À L'ÉCRAN (§22.8) : ni le nom de la contrainte, ni la ligne
			// fautive, qui porte la référence Vault du secret (INC-193).
			await expect(refus).not.toContainText('mail_outbound_identities')
			await expect(refus).not.toContainText('Failing row')
			await expect(refus).not.toContainText('check constraint')

			// Le refus laisse le formulaire ouvert et n'efface pas la saisie (§22.8).
			await expect(page.getByTestId('formulaire-identite-mail')).toBeVisible()
			await expect(page.getByTestId('champ-adresse-expedition')).toHaveValue('pas-une-adresse')

			await capturer(page, 'identites-mail-refus-1440', UNITE)

			// Le refus de la base est un `400`, que le navigateur journalise. Il est CONSOMMÉ ici,
			// nommément : la console reste par ailleurs vierge, et ce scénario ne relâche aucun
			// filtre global (docs/SPEC-webapp.md §12.3).
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		} finally {
			await restaurerIdentiteDriss(page)
		}
	})

	test('une lectrice sans identité voit l’état vide, AVEC le geste qui le comble', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto('/reglages/identites-mail')

		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByText('Aucune identité d’expédition')).toBeVisible()
		// L'écart assumé avec l'écran d'état (§5.14), qui n'agit pas : ici la commande est offerte.
		await expect(page.getByTestId('ouvrir-identite')).toBeVisible()

		await page.getByTestId('ouvrir-identite').click()
		// Le sélecteur porte l'entrée de SERVICE, que la lectrice peut viser et que la base
		// refusera : l'écran ne calcule aucun droit (§22.5, mesuré §22.7).
		const options = await page.getByTestId('champ-identite-visee').locator('option').allInnerTexts()
		expect(options.some((option) => option.includes('Nouvelle identité de service'))).toBe(true)
		expect(options.some((option) => option.includes('Nouvelle identité personnelle'))).toBe(true)

		await capturer(page, 'identites-mail-vide-1440', UNITE)
	})
})

/** L'identifiant de l'identité de Driss, lu par la clé de service — jamais recopié d'une exécution. */
async function identifiantDriss(page: Page): Promise<string> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/mail_outbound_identities?owner_id=eq.${DRISS}&select=id`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne?.id, 'l’identité de Driss du seed doit exister').toBeTruthy()
	return ligne?.id ?? ''
}

// --- Paliers responsive (docs/DESIGN_SYSTEM.md §7) --------------------------------------------
//
// La taille de fenêtre est fixée AVANT le chargement — même patron que la suite jumelle : la
// coquille applique son repli de barre latérale au montage, pas en réaction à un redimensionnement
// ultérieur.

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la liste et le formulaire restent lisibles`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto('/reglages/identites-mail')
			await expect(page.getByTestId('liste-identites-mail')).toBeVisible()

			await page
				.getByTestId('ligne-identite-mail')
				.filter({ hasText: ADRESSE_DRISS })
				.getByTestId('configurer-identite')
				.click()
			await expect(page.getByTestId('formulaire-identite-mail')).toBeVisible()

			// La page ne défile JAMAIS horizontalement (§7), formulaire ouvert compris.
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

			await capturer(page, `identites-mail-${palier.nom}`, UNITE)
		})
	}
})
