// @verifies CRM-136 (docs/BACKLOG.md) — tranche T3 : sur le VRAI Stalwart de développement — le panneau « Dossiers relevés »
//           liste les dossiers réels de la boîte de Camille, on coche « Sent Items », on enregistre, `watch_folders` est relu
//           en base et une VRAIE relève relève un dossier de plus ; au clavier, le focus entre sur la première case et revient
//           à la commande ; le formulaire règle l'historique ; une identité reçoit un plafond puis revient à « aucun plafond » ;
//           captures aux quatre paliers ; chaque colonne que le formulaire d'identité écrit est rendue et relue (défaut
//           de la campagne du 2026-11-11)
// @verifies docs/SPEC-mail-subsystem.md §25.3 à §25.6, §25.9 (ligne « E2E ui ») ; docs/DESIGN_SYSTEM.md §5.99 ; CLAUDE.md §15,
//           §16
//
// LA GARDE DE 30 SECONDES DU TEST DE CONNEXION (§23.3) est levée entre deux ouvertures du panneau en remettant
// `last_checked_at` à son état d'avant par la clé de service : la preuve ne mesure pas la garde — `e2e/api/tester-connexion`
// le fait —, elle mesure le panneau. Chaque réglage touché est rendu dans son état d'avant, même en cas d'échec.

import { execFileSync } from 'node:child_process'
import type { APIRequestContext, Page } from '@playwright/test'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'
import { conteneur } from '../conteneur'

const UNITE = 'CRM-136'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

type Boite = { id: string; watch_folders: string[]; backfill_months: number; last_checked_at: string | null }

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function boiteDe(request: APIRequestContext, proprietaire: string): Promise<Boite> {
	const reponse = await request.get(rest(`mail_inbound_accounts?select=id,watch_folders,backfill_months,last_checked_at&owner_id=eq.${proprietaire}`), {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as Boite[])[0]!
}

const remettre = (request: APIRequestContext, boite: Boite, champs: Partial<Boite>) =>
	request.patch(rest(`mail_inbound_accounts?id=eq.${boite.id}`), { headers: { ...enTetesService(), Prefer: 'return=minimal' }, data: champs })

/** La VRAIE relève, par la route interne `/poll` du service : rend le nombre de dossiers relevés. */
function releverDossiers(idBoite: string): number {
	const sortie = execFileSync(
		'docker',
		[
			'exec',
			'-e',
			`COMPTE=${idBoite}`,
			conteneur('mail-sync'),
			'python',
			'-c',
			`
import json, os, urllib.request
requete = urllib.request.Request(
    "http://127.0.0.1:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll", data=b"", method="POST",
    headers={"Authorization": "Bearer " + os.environ["MAIL_SYNC_INTERNAL_TOKEN"]})
print(json.loads(urllib.request.urlopen(requete, timeout=120).read())["folders"])
`,
		],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	)
	return Number(sortie.trim())
}

const ligneDe = (page: Page, id: string) => page.locator(`[data-testid="ligne-compte-configuration"][data-compte="${id}"]`)

test.use({ viewport: { width: 1440, height: 900 } })

test('à la souris : les vrais dossiers de la boîte, « Sent Items » coché, enregistré, et relevé pour de vrai', async ({ page, request }) => {
	test.setTimeout(120_000)
	const avant = await boiteDe(request, CAMILLE)
	try {
		await remettre(request, avant, { last_checked_at: null })
		expect(releverDossiers(avant.id)).toBe(avant.watch_folders.length)
		await remettre(request, avant, { last_checked_at: null })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/comptes-mail')
		const commande = ligneDe(page, avant.id).getByTestId('dossiers-compte')
		await expect(commande).toHaveAccessibleName('Dossiers relevés de Boîte de Camille Aubert')
		await commande.click()
		await expect(commande).toHaveAttribute('aria-expanded', 'true')
		const panneau = page.getByTestId('panneau-dossiers-releves')
		const cases = panneau.getByTestId('case-dossier')
		// MESURÉ sur le Stalwart de développement (§25.8) : cinq dossiers, dans l'ordre du serveur.
		await expect(cases).toHaveCount(5)
		await expect(cases.first()).toBeFocused()
		const noms = await cases.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-dossier')))
		expect(noms).toEqual(['Deleted Items', 'Drafts', 'INBOX', 'Junk Mail', 'Sent Items'])
		await expect(panneau.getByLabel('INBOX', { exact: true })).toBeChecked()
		await expect(panneau.getByLabel('Junk Mail', { exact: true })).toBeChecked()
		await panneau.getByLabel('Sent Items', { exact: true }).check()
		await capturer(page, 'dossiers-releves-xl-1440', UNITE)
		await panneau.getByTestId('enregistrer-dossiers').click()
		await expect(panneau).toHaveCount(0)
		await expect(commande).toBeFocused()
		await expect(page.getByRole('status').filter({ hasText: 'Dossiers relevés enregistrés' })).toHaveCount(1)
		// CONSTATÉ EN BASE, dans l'ordre affiché, puis par une VRAIE relève : un dossier de plus est relevé.
		expect((await boiteDe(request, CAMILLE)).watch_folders).toEqual(['INBOX', 'Junk Mail', 'Sent Items'])
		expect(releverDossiers(avant.id)).toBe(3)
	} finally {
		await remettre(request, avant, { watch_folders: avant.watch_folders, last_checked_at: avant.last_checked_at })
	}
})

test('au clavier : le panneau s’ouvre, l’espace coche, `Échap` referme sans rien écrire et rend le focus', async ({ page, request }) => {
	const avant = await boiteDe(request, DRISS)
	try {
		await remettre(request, avant, { last_checked_at: null })
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto('/reglages/comptes-mail')
		const commande = ligneDe(page, avant.id).getByTestId('dossiers-compte')
		await commande.focus()
		await page.keyboard.press('Enter')
		const premiere = page.getByTestId('case-dossier').first()
		await expect(premiere).toBeFocused()
		await page.keyboard.press('Space')
		await expect(premiere).toBeChecked()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('panneau-dossiers-releves')).toHaveCount(0)
		await expect(commande).toBeFocused()
		expect((await boiteDe(request, DRISS)).watch_folders).toEqual(avant.watch_folders)
	} finally {
		await remettre(request, avant, { last_checked_at: avant.last_checked_at })
	}
})

test('le formulaire de la boîte règle l’historique', async ({ page, request }) => {
	const avant = await boiteDe(request, CAMILLE)
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/comptes-mail')
		await ligneDe(page, avant.id).getByTestId('configurer-compte').click()
		const champ = page.getByTestId('champ-historique')
		await expect(champ).toHaveValue(String(avant.backfill_months))
		await expect(page.getByText('0 relève le courrier reçu depuis le branchement de la boîte')).toBeVisible()
		await champ.fill('6')
		await capturer(page, 'historique-formulaire-xl-1440', UNITE)
		await page.getByTestId('valider-compte-mail').click()
		await expect(page.getByTestId('formulaire-compte-mail')).toHaveCount(0)
		expect((await boiteDe(request, CAMILLE)).backfill_months).toBe(6)
		// Une saisie hors de la borne est envoyée, et la base refuse : la phrase du dictionnaire. Le `400` de PostgREST est
		// la réponse attendue, que le navigateur journalise : la preuve le consomme après l'avoir constaté.
		await ligneDe(page, avant.id).getByTestId('configurer-compte').click()
		await page.getByTestId('champ-historique').fill('121')
		await page.getByTestId('valider-compte-mail').click()
		await expect(page.getByTestId('refus-compte-mail')).toHaveText('L’historique doit être un nombre entier de mois, de 0 à 120.')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	} finally {
		await remettre(request, avant, { backfill_months: avant.backfill_months })
	}
})

/**
 * CHAQUE COLONNE QUE LE FORMULAIRE ÉCRIT (`webapp/src/lib/mail-identites.ts`, §22.5) : le formulaire envoie toujours
 * `p_from_name` et `p_signature_text`, même vides, si bien qu'un enregistrement fait passer un `null` du seed à `''`.
 * Défaut trouvé par la campagne complète du 2026-11-11 : seul le quota était rendu, et `from_name` restait `''`, ce qui
 * rougissait `e2e/api/rendu-modeles-emails.spec.ts` et le chapitre 14-16 du manuel. Le mot de passe n'est pas écrit (champ
 * laissé vide).
 */
const COLONNES_FORMULAIRE =
	'label,smtp_host,smtp_port,smtp_security,smtp_username,from_address,from_name,signature_text,is_default,daily_quota'
type IdentiteFormulaire = Record<string, unknown> & { id: string; daily_quota: number | null }

test('une identité reçoit un plafond, puis revient à « aucun plafond »', async ({ page, request }) => {
	const lire = async () =>
		((await (
			await request.get(rest(`mail_outbound_identities?select=id,${COLONNES_FORMULAIRE}&owner_id=eq.${CAMILLE}&is_default=is.true`), {
				headers: enTetesService(),
			})
		).json()) as IdentiteFormulaire[])[0]!
	const avant = await lire()
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/identites-mail')
		const ligne = page.getByTestId('ligne-identite-mail').filter({ hasText: 'admin@p2enjoy.test' })
		await ligne.getByTestId('configurer-identite').click()
		const champ = page.getByTestId('champ-quota-identite')
		await expect(champ).toHaveValue('')
		await expect(page.getByText('Vide : aucun plafond.', { exact: false })).toBeVisible()
		await champ.fill('150')
		await capturer(page, 'quota-identite-xl-1440', UNITE)
		await page.getByTestId('valider-identite-mail').click()
		await expect(page.getByTestId('formulaire-identite-mail')).toHaveCount(0)
		expect((await lire()).daily_quota).toBe(150)
		await ligne.getByTestId('configurer-identite').click()
		await expect(page.getByTestId('champ-quota-identite')).toHaveValue('150')
		await page.getByTestId('champ-quota-identite').fill('')
		await page.getByTestId('valider-identite-mail').click()
		await expect(page.getByTestId('formulaire-identite-mail')).toHaveCount(0)
		expect((await lire()).daily_quota).toBeNull()
	} finally {
		const { id, ...colonnes } = avant
		await request.patch(rest(`mail_outbound_identities?id=eq.${id}`), {
			headers: { ...enTetesService(), Prefer: 'return=minimal' },
			data: colonnes,
		})
		// LE RETRAIT EST CONSTATÉ : l'identité du seed est relue telle qu'avant, `from_name` nul compris.
		expect(await lire(), 'l’identité du seed est rendue à son état d’avant').toEqual(avant)
	}
})

test.describe('les quatre paliers', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : le panneau tient, la page ne défile pas horizontalement`, async ({ page, request }) => {
			const avant = await boiteDe(request, CAMILLE)
			try {
				await remettre(request, avant, { last_checked_at: null })
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				await connecterAvecLeLabs(page, ADMIN)
				await page.goto('/reglages/comptes-mail')
				await ligneDe(page, avant.id).getByTestId('dossiers-compte').click()
				await expect(page.getByTestId('case-dossier')).toHaveCount(5)
				await page.getByTestId('panneau-dossiers-releves').scrollIntoViewIfNeeded()
				await capturer(page, `dossiers-releves-${palier.nom}`, UNITE)
				const largeurs = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
				expect(largeurs[0], 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(largeurs[1]!)
			} finally {
				await remettre(request, avant, { last_checked_at: avant.last_checked_at })
			}
		})
	}
})
