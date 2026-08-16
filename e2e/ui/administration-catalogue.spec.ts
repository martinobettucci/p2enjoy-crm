// @verifies CRM-030 (docs/BACKLOG.md) — administration du catalogue de nœuds, parcours d'interface
// @verifies docs/SPEC-workflow-engine.md §2 bis.2 (l'adresse et l'index), §2 bis.3 (la lecture
//           rapporte AUSSI les archivés), §2 bis.4 (les quatre gestes), §2 bis.5 (les refus
//           mesurés, dont la garde d'archivage), §2 bis.6 (validation de forme), §2 bis.9
//           (lignes « Interface » et « Visuel »)
// @verifies docs/SPEC-workflow-engine.md §2.5 (`0` n'est pas `NULL`), §2.6 (la garde)
// @verifies docs/DESIGN_SYSTEM.md §5.18 (cette surface), §7 (paliers), §8 (accessibilité)
// @verifies CLAUDE.md §10 (la garde est backend, constatée et non simulée), §16 (vérification
//           visuelle), §22 (accessibilité clavier)
//
// LES QUATRE GESTES SONT JOUÉS SUR LA VRAIE BASE, avec le vrai seed et le jeton réel de
// l'administratrice : aucune réponse n'est substituée dans ce fichier, pas même celle du refus.
// Le refus d'archiver un nœud occupé est obtenu en tentant d'archiver `prospection`, sur laquelle
// le seed pose QUATRE affaires actives — c'est ce que `docs/SPEC-workflow-engine.md` §2 bis.9
// exige, et c'est la seule façon de prouver que l'écran traduit un refus qu'il a réellement reçu.
//
// LE SCÉNARIO REND LE CATALOGUE À SON ÉTAT INITIAL. Il crée son propre nœud, sous une clé préfixée
// `e2e-noeud-` qui n'entre en collision avec aucune clé seedée, et le SUPPRIME en épilogue par la
// clé de service — la règle d'INC-099 et de la décision 362 : chaque preuve purge ce qu'elle a
// déposé, dans son propre `finally`, sans quoi `scripts/verify-catalogue.sh` compterait neuf nœuds
// là où le seed en pose huit. La suppression est un geste d'exploitation de la preuve sur SA
// PROPRE ligne : le produit, lui, n'expose aucune suppression (§2.6).
//
// Le nœud `qualification`, seul archivé du seed, sert au rétablissement — puis il est RÉARCHIVÉ à
// la même date, pour que `scripts/verify-catalogue.sh` retrouve son huitième nœud archivé.

import { expect, test, type Page } from './fixtures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-030'
const ADMIN = 'admin@p2enjoy.test'

const CHEMIN_CATALOGUE = `${URL_API}/rest/v1/workflow_nodes_catalog`

/** La clé du nœud que la preuve fabrique, préfixée pour ne heurter aucune clé du seed. */
const CLE_PREUVE = 'e2e-noeud-catalogue'

/** Le nœud du seed occupé par quatre affaires actives — §2 bis.9, ligne « Seed ». */
const NOEUD_OCCUPE = 'Prospection'

/** Le seul nœud archivé du seed, et sa date, que l'épilogue restitue à l'octet près. */
const NOEUD_ARCHIVE = { libelle: 'Qualification', cle: 'qualification', date: '2026-03-01T09:00:00+00:00' }

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Retire les nœuds de preuve. Filet de sécurité, indépendant du point où le scénario a échoué. */
async function purgerNoeudsDePreuve(page: Page): Promise<void> {
	await page.request.delete(`${CHEMIN_CATALOGUE}?key=like.e2e-noeud-*`, {
		headers: enTetesService(),
	})
}

/** Rend au seed son unique nœud archivé, à sa date exacte. */
async function restaurerArchivageDuSeed(page: Page): Promise<void> {
	await page.request.patch(`${CHEMIN_CATALOGUE}?key=eq.${NOEUD_ARCHIVE.cle}`, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { archived_at: NOEUD_ARCHIVE.date },
	})
}

/**
 * L'horodatage d'archivage d'une ligne relue, ou un échec qui NOMME l'absence de ligne.
 *
 * Un `[0]!` passerait le typage sans rien dire le jour où la lecture rend un tableau vide —
 * c'est-à-dire précisément le cas qu'une relecture existe pour attraper.
 */
function archivageDe(lignes: readonly { archived_at: string | null }[]): string | null {
	const [ligne] = lignes
	if (ligne === undefined) throw new Error('la ligne relue est introuvable')
	return ligne.archived_at
}

async function ouvrirCatalogue(page: Page): Promise<void> {
	await page.goto('/reglages/catalogue')
	await expect(page.getByTestId('liste-catalogue')).toBeVisible()
}

test.describe('Administration du catalogue de nœuds — CRM-030', () => {
	test.beforeEach(async ({ page }) => {
		await purgerNoeudsDePreuve(page)
	})

	test("la liste rapporte les huit nœuds du seed, l'archivé compris et à sa place (§2 bis.3)", async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirCatalogue(page)

		const lignes = page.getByTestId('ligne-noeud')
		await expect(lignes).toHaveCount(8)
		// L'ordre est celui de `position` : `prospection` d'abord, `qualification` — archivée — en
		// dernier. Un filtre `archived_at=is.null` la ferait disparaître, et son rétablissement
		// deviendrait introuvable : c'est l'écart avec la lecture 3 du §7 bis.3.
		await expect(lignes.first()).toContainText(NOEUD_OCCUPE)
		const archivee = page.locator('[data-testid="ligne-noeud"][data-noeud="qualification"]')
		await expect(archivee.getByTestId('pilule-archive')).toBeVisible()
		// La pilule « Archivé » est un MOT, pas une teinte (docs/DESIGN_SYSTEM.md §5.18).
		await expect(archivee.getByTestId('pilule-archive')).toHaveText('Archivé')

		// Le type est écrit en toutes lettres sur chaque ligne, jamais porté par la couleur.
		const perdu = page.locator('[data-testid="ligne-noeud"][data-noeud="perdu"]')
		await expect(perdu.getByTestId('type-noeud')).toHaveText('Perdu')
		// `perdu` porte une probabilité de 0 % — la valeur qui prouve que `0` n'est pas l'absence
		// (§2.5) — et AUCUN seuil de relance, dont la cellule reste vide.
		await expect(perdu.getByTestId('probabilite-noeud')).toHaveText('0 %')
		await expect(perdu.getByTestId('seuil-noeud')).toHaveCount(0)

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await capturer(page, `catalogue-liste-${palier.nom}`, UNITE)
		}
	})

	test("l'index des réglages y mène, et l'écran porte son titre (§2 bis.2)", async ({ page }) => {
		await connecter(page)
		await page.goto('/reglages')
		await page.getByRole('link', { name: 'Catalogue de nœuds' }).click()
		await expect(page).toHaveURL(/\/reglages\/catalogue$/)
		await expect(page.getByRole('heading', { name: 'Catalogue de nœuds' })).toBeVisible()
	})

	test('créer un nœud à la souris, puis le modifier au clavier (§2 bis.4)', async ({ page }) => {
		try {
			await connecter(page)
			await ouvrirCatalogue(page)

			await page.getByTestId('ouvrir-creation-noeud').click()
			const formulaire = page.getByTestId('formulaire-noeud')
			await expect(formulaire).toBeVisible()
			// Ouvrir un formulaire déplace le focus dans son premier champ (§5.13).
			await expect(formulaire.getByTestId('champ-libelle')).toBeFocused()

			await formulaire.getByTestId('champ-libelle').fill('Nœud de preuve')
			// La clé est PROPOSÉE depuis le libellé, puis corrigée à la main : commodité, jamais
			// garantie (§2 bis.6).
			// MESURÉ, et ce n'est pas ce qu'on attendrait : la proposition rend `n-ud-de-preuve`.
			// `proposerSlug` décompose en NFD et retire les diacritiques ; la LIGATURE « œ » n'est pas
			// décomposable, elle n'est donc pas translittérée et tombe dans le remplacement générique.
			// C'est le comportement écrit au §5.1 de `docs/SPEC-administration-arborescence.md` — « ce
			// qui n'est pas décomposable n'est pas translittéré » —, et la conséquence est que la
			// proposition est inutilisable pour tout libellé français portant « œ », à commencer par
			// « nœud ». La preuve le CONSTATE plutôt que de choisir un libellé qui l'éviterait ; le
			// champ reste modifiable, ce qui est précisément pourquoi la proposition n'est qu'une
			// commodité. Consigné en INC-126.
			await expect(formulaire.getByTestId('champ-cle')).toHaveValue('n-ud-de-preuve')
			await formulaire.getByTestId('champ-cle').fill(CLE_PREUVE)
			await formulaire.getByTestId('champ-type').selectOption('open')
			await formulaire.getByTestId('champ-couleur').selectOption('accent')
			await formulaire.getByTestId('champ-probabilite').fill('35')
			// Le seuil reste VIDE : il doit arriver en base à `NULL`, jamais à `0` (§2.5).
			await formulaire.getByTestId('valider-noeud').click()

			const ligne = page.locator(`[data-testid="ligne-noeud"][data-noeud="${CLE_PREUVE}"]`)
			await expect(ligne).toBeVisible()
			await expect(ligne.getByTestId('probabilite-noeud')).toHaveText('35 %')
			await expect(ligne.getByTestId('seuil-noeud')).toHaveCount(0)

			// L'EFFET EST CONSTATÉ EN BASE, pas seulement à l'écran : un rendu optimiste passerait
			// cette assertion sans qu'aucune ligne n'existe.
			const enBase = await page.request.get(
				`${CHEMIN_CATALOGUE}?key=eq.${CLE_PREUVE}&select=label,kind,color,default_probability,default_stale_after_days,position`,
				{ headers: enTetesService() },
			)
			const [creeEnBase] = (await enBase.json()) as {
				label: string
				kind: string
				color: string
				default_probability: string | null
				default_stale_after_days: number | null
				position: string
			}[]
			expect(creeEnBase).toBeDefined()
			expect(creeEnBase?.label).toBe('Nœud de preuve')
			expect(creeEnBase?.color).toBe('accent')
			expect(Number(creeEnBase?.default_probability)).toBe(35)
			// LE CHAMP LAISSÉ VIDE VAUT `NULL`. C'est l'assertion que ce scénario existe pour tenir :
			// un `Number('')` valant `0`, une régression écrirait « 0 jour » — un seuil qui
			// signalerait toute affaire dès son arrivée (§2.5).
			expect(creeEnBase?.default_stale_after_days).toBeNull()
			// La position est attribuée par le trigger : le nœud est en fin de liste (§2.4).
			expect(Number(creeEnBase?.position)).toBeGreaterThan(8)

			// --- La modification, entièrement au clavier -------------------------------------
			await ligne.getByTestId('modifier-noeud').click()
			const edition = ligne.getByTestId('formulaire-noeud')
			await expect(edition.getByTestId('champ-libelle')).toBeFocused()
			// La clé N'EST PAS un champ sur un nœud existant : elle est une PHRASE (§5.18).
			await expect(edition.getByTestId('champ-cle')).toHaveCount(0)
			await expect(edition.getByTestId('phrase-cle')).toContainText(CLE_PREUVE)

			await page.keyboard.press('Control+a')
			await page.keyboard.type('Nœud renommé au clavier')
			await page.keyboard.press('Enter')

			await expect(ligne.getByTestId('pilule-noeud')).toHaveText('Nœud renommé au clavier')
			const relu = await page.request.get(
				`${CHEMIN_CATALOGUE}?key=eq.${CLE_PREUVE}&select=key,label`,
				{ headers: enTetesService() },
			)
			const [reluEnBase] = (await relu.json()) as { key: string; label: string }[]
			expect(reluEnBase?.label).toBe('Nœud renommé au clavier')
			// LA CLÉ N'A PAS BOUGÉ : l'écran ne l'expose pas, et la modification ne l'écrit pas (§2.1).
			expect(reluEnBase?.key).toBe(CLE_PREUVE)
		} finally {
			await purgerNoeudsDePreuve(page)
		}
	})

	test("archiver le nœud de preuve, puis le rétablir — l'aller et le retour (§2 bis.4)", async ({
		page,
	}) => {
		try {
			await page.request.post(CHEMIN_CATALOGUE, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: {
					workspace_id: '5eed0000-0000-4000-8000-000000000001',
					key: CLE_PREUVE,
					label: 'Nœud archivable',
					kind: 'open',
					color: 'neutral',
				},
			})

			await connecter(page)
			await ouvrirCatalogue(page)
			const ligne = page.locator(`[data-testid="ligne-noeud"][data-noeud="${CLE_PREUVE}"]`)

			await ligne.getByTestId('archiver-noeud').click()
			// La confirmation vit dans le FLUX du document, jamais en modale (§5.13), et nomme le nœud.
			await expect(ligne.getByTestId('confirmation-archivage')).toContainText('Nœud archivable')
			await ligne.getByTestId('confirmer-archivage').click()

			await expect(ligne.getByTestId('pilule-archive')).toBeVisible()
			const apres = await page.request.get(
				`${CHEMIN_CATALOGUE}?key=eq.${CLE_PREUVE}&select=archived_at`,
				{ headers: enTetesService() },
			)
			expect(archivageDe((await apres.json()) as { archived_at: string | null }[])).not.toBeNull()

			// --- Le retour : AUCUNE confirmation, le geste qui répare n'en demande pas (§5.18) ---
			await ligne.getByTestId('desarchiver-noeud').click()
			await expect(ligne.getByTestId('pilule-archive')).toHaveCount(0)
			const rendu = await page.request.get(
				`${CHEMIN_CATALOGUE}?key=eq.${CLE_PREUVE}&select=archived_at`,
				{ headers: enTetesService() },
			)
			expect(archivageDe((await rendu.json()) as { archived_at: string | null }[])).toBeNull()
		} finally {
			await purgerNoeudsDePreuve(page)
		}
	})

	test("le refus d'archiver un nœud occupé est REÇU de la base, avec son compte (§2 bis.5)", async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirCatalogue(page)

		const ligne = page.locator('[data-testid="ligne-noeud"][data-noeud="prospection"]')
		// LA COMMANDE N'EST PAS ÉTEINTE D'AVANCE (§5.18) : l'écran ne mesure pas l'occupation, la
		// base la mesure. Une commande grisée ferait passer une règle de la base pour une décision
		// d'interface (`CLAUDE.md` §10).
		await expect(ligne.getByTestId('archiver-noeud')).toBeEnabled()
		await ligne.getByTestId('archiver-noeud').click()
		await ligne.getByTestId('confirmer-archivage').click()

		const alerte = ligne.getByTestId('refus-catalogue')
		await expect(alerte).toBeVisible()
		// LE NOMBRE VIENT DU MESSAGE DE LA BASE, jamais d'un comptage d'écran : le seed pose quatre
		// affaires actives sur ce nœud, et une cinquième les ferait toutes deux changer ensemble.
		await expect(alerte).toContainText('4 affaires en cours')
		await expect(alerte).toContainText('déplacez-les')

		// LA LIGNE EST RELUE : le refus n'a rien archivé, et une preuve qui se contenterait de
		// l'alerte ne dirait pas si la base a cédé.
		const relu = await page.request.get(
			`${CHEMIN_CATALOGUE}?key=eq.prospection&select=archived_at`,
			{ headers: enTetesService() },
		)
		expect(archivageDe((await relu.json()) as { archived_at: string | null }[])).toBeNull()

		await capturer(page, 'catalogue-refus-occupe-1440', UNITE)

		// LE `403` DE LA GARDE EST LA SEULE ERREUR CONSOLE DE CE SCÉNARIO, et elle est consommée
		// nommément : Chromium journalise toute réponse d'échec au chargement d'une ressource. La
		// filtrer globalement masquerait les autres ; l'autoriser ici dit exactement ce que le
		// scénario vient de provoquer et d'expliquer à l'utilisateur.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
	})

	test('rétablir le nœud archivé du seed, puis le rendre à son état exact (§2 bis.4)', async ({
		page,
	}) => {
		try {
			await connecter(page)
			await ouvrirCatalogue(page)
			const ligne = page.locator('[data-testid="ligne-noeud"][data-noeud="qualification"]')

			await ligne.getByTestId('desarchiver-noeud').click()
			await expect(ligne.getByTestId('pilule-archive')).toHaveCount(0)
			// Le rétablissement rend le nœud MODIFIABLE : la commande réapparaît, ce qui prouve que
			// l'écran lit bien l'état et non un souvenir.
			await expect(ligne.getByTestId('modifier-noeud')).toBeVisible()

			const relu = await page.request.get(
				`${CHEMIN_CATALOGUE}?key=eq.${NOEUD_ARCHIVE.cle}&select=archived_at`,
				{ headers: enTetesService() },
			)
			expect(archivageDe((await relu.json()) as { archived_at: string | null }[])).toBeNull()
		} finally {
			// SANS CETTE RESTITUTION, `scripts/verify-catalogue.sh` rougirait sur son quatrième
			// contrôle — « huit nœuds, dont un archivé » —, et rien dans cette suite ne dirait
			// pourquoi.
			await restaurerArchivageDuSeed(page)
		}
	})

	test('la forme est validée avant l\'aller-retour, sans remplacer aucune garde (§2 bis.6)', async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirCatalogue(page)
		await page.getByTestId('ouvrir-creation-noeud').click()
		const formulaire = page.getByTestId('formulaire-noeud')

		// Libellé vide : rien à envoyer.
		await expect(formulaire.getByTestId('valider-noeud')).toBeDisabled()

		await formulaire.getByTestId('champ-libelle').fill('Essai de forme')
		await expect(formulaire.getByTestId('valider-noeud')).toBeEnabled()

		// Une clé hors du motif du §2.3 — la contrainte `key_check` la refuserait ; l'écran
		// l'annonce d'abord.
		await formulaire.getByTestId('champ-cle').fill('Mauvaise Clé')
		await expect(formulaire.getByTestId('valider-noeud')).toBeDisabled()
		await formulaire.getByTestId('champ-cle').fill('essai-de-forme')
		await expect(formulaire.getByTestId('valider-noeud')).toBeEnabled()

		// Les bornes du §2.5, dans les deux sens.
		await formulaire.getByTestId('champ-probabilite').fill('100.01')
		await expect(formulaire.getByTestId('valider-noeud')).toBeDisabled()
		await formulaire.getByTestId('champ-probabilite').fill('100')
		await expect(formulaire.getByTestId('valider-noeud')).toBeEnabled()

		// `0` jour signalerait toute affaire dès son arrivée : la contrainte est `x > 0`.
		await formulaire.getByTestId('champ-seuil').fill('0')
		await expect(formulaire.getByTestId('valider-noeud')).toBeDisabled()
		await formulaire.getByTestId('champ-seuil').fill('')
		await expect(formulaire.getByTestId('valider-noeud')).toBeEnabled()

		await capturer(page, 'catalogue-formulaire-1440', UNITE)
	})
})
