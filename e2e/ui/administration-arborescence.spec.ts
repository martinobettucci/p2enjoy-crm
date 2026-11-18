// @verifies CRM-075 (docs/BACKLOG.md) — administration des tracks et des channels, parcours d'interface
// @verifies CRM-154 (docs/BACKLOG.md) tranche T3 — « Monter » d'un channel par `reorder_channels` (positions 1 à n
//           constatées en base, l'ordre du seed reposé) ; `?track=` qui déplie le track et pose le focus
//           (docs/SPEC-administration-arborescence.md §15.3)
// @verifies docs/SPEC-administration-arborescence.md §5 (créer et renommer), §6 (réordonner et
//           archiver), §7 (les channels), §3 (adresse et composition)
// @verifies docs/DESIGN_SYSTEM.md §5.13 (cette surface), §7 (paliers), §8 (accessibilité)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
// @verifies INC-254, décision 608 — docs/SPEC-webapp.md §6.3 bis, docs/DESIGN_SYSTEM.md §5.13 : la barre
//           latérale suit chaque geste sur un track — créé, renommé, archivé, désarchivé — sans rechargement
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du
//           SSO, fixture connecterAvecLeLabs (CRM-092 T5) : plus aucun mot de passe du CRM
//
// LES CINQ GESTES — créer, renommer, réordonner, archiver, désarchiver — SONT PROUVÉS DEUX FOIS,
// pour un track puis pour un channel : une fois à la souris, dans le geste le plus naturel qu'un
// administrateur ferait, et une fois entièrement au clavier, focus atteint par `Tab` et jamais par
// `focus()` (même discipline que `e2e/ui/commentaires-gestes.spec.ts`). Aucune fonction interne
// n'est appelée : chaque geste part d'un vrai clic ou d'une vraie frappe.
//
// Le scénario REND le seed à son état initial : il crée ses propres objets, sous des slugs préfixés
// `e2e-arbo-` et `e2e-canal-` qui n'entrent en collision avec aucun slug seedé, et les RETIRE en
// épilogue. L'épilogue passe par la clé de service, en filet de sécurité, indépendamment du point où
// le scénario a pu échouer.
//
// INC-099 — POURQUOI L'ÉPILOGUE SUPPRIME AU LIEU D'ARCHIVER. Il archivait, au motif que « la
// suppression n'existe pas » (docs/SPEC-administration-arborescence.md §12). C'est vrai DU PRODUIT
// — aucun écran, aucune route applicative n'efface un track ni un channel — et cela ne dit rien de
// ce qu'une preuve doit rendre. Une ligne archivée reste une ligne : les quatre scénarios ci-dessous
// laissaient donc DEUX tracks et DEUX channels derrière eux, ce qui rendait rouges les assertions
// 75 et 76 de `supabase/tests/0004_tracks.test.sql` — « le seed pose quatre tracks », `have: 6
// want: 4`, puis « l'un d'eux est archivé », `have: 3 want: 1`. La seconde est décisive : elle ne
// rougirait pas si le résidu n'était pas précisément archivé.
//
// La règle appliquée ici est celle que la décision 362 a rendue pour INC-091, sur `mail_messages` :
// chaque preuve purge ce qu'elle a déposé, dans son propre `finally`. Le geste employé n'est pas
// un mécanisme neuf — `supprimerParSlug` était déjà appelée à l'ENTRÉE de chaque scénario, et par
// la même clé de service ; seule sa place changeait. Le nettoyage d'entrée est conservé : il
// protège du `23505` que laisserait une exécution tuée avant son `finally`.
//
// Ce que cela ne dit pas : la suppression n'est pas ouverte au produit, et aucune assertion de ce
// fichier ne l'exerce comme un geste d'utilisateur. C'est un geste d'exploitation de la preuve sur
// ses PROPRES lignes, jamais sur une ligne seedée — les slugs sont préfixés pour cela.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import type { Locator } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-075'
const ADMIN = 'admin@p2enjoy.test'

/** Le track « Formation » du seed, choisi comme parent des channels de ce dossier : aucun autre
 * scénario de ce fichier ne le modifie, et il ne porte qu'un seul workflow affectable — le
 * global par défaut —, ce qui simplifie la désignation du workflow sans rien inventer. */
const TRACK_FORMATION_NOM = 'Formation'

const CHEMIN_TRACKS = `${URL_API}/rest/v1/tracks`
const CHEMIN_CHANNELS = `${URL_API}/rest/v1/channels`

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await connecterAvecLeLabs(page, email)
}

/**
 * Avance le focus par `Tab` jusqu'à ce que `cible` devienne l'élément actif, ou échoue en le
 * nommant. Jamais de `focus()` programmatique : Chromium ne pose `:focus-visible` que sur un focus
 * réellement atteint par le clavier, et une capture prise après un `focus()` montrerait un bouton
 * sans anneau — l'inverse de ce que `docs/DESIGN_SYSTEM.md` §8 exige.
 */
async function tabVers(page: Page, cible: Locator, max = 80): Promise<void> {
	for (let tentative = 0; tentative < max; tentative++) {
		if (
			await cible
				.evaluate((element: Element) => element === document.activeElement)
				.catch(() => false)
		) {
			return
		}
		await page.keyboard.press('Tab')
	}
	await expect(cible).toBeFocused()
}

/** Les noms des lignes portant une commande « Monter », dans l'ORDRE DU DOM — donc l'ordre affiché. */
async function ordreMonter(portee: Locator): Promise<string[]> {
	const boutons = await portee.getByRole('button', { name: /^Monter / }).all()
	const noms: string[] = []
	for (const bouton of boutons) {
		noms.push(((await bouton.getAttribute('aria-label')) ?? '').replace(/^Monter /, ''))
	}
	return noms
}

/** Le `<ul>` de premier niveau, qui NE PORTE QUE des tracks — jamais les channels d'un track déplié.
 * Il vit dans le conteneur `.indique-debordement-x` du débordement horizontal (§12.6), lui-même
 * enfant direct de la région — d'où `> div > ul` plutôt que `> ul`. */
function listeTracks(page: Page): Locator {
	return page
		.getByRole('region', { name: "Tracks et channels de l'espace de travail" })
		.locator('> div > ul')
}

function listeChannels(page: Page, nomTrack: string): Locator {
	return page.getByRole('list', { name: `Channels du track ${nomTrack}` })
}

/** Purge par slug avec la clé de service (INC-099, règle de la décision 362).
 *
 * Employée DEUX fois par scénario, et pour deux motifs distincts :
 *  - à l'entrée, pour qu'une exécution interrompue ne fasse pas échouer celle-ci sur un `23505` ;
 *  - dans le `finally`, pour que la preuve rende la table dans l'état où elle l'a trouvée, quel que
 *    soit son point d'échec. */
async function supprimerParSlug(
	request: import('@playwright/test').APIRequestContext,
	chemin: string,
	slug: string,
): Promise<void> {
	await request.delete(`${chemin}?slug=eq.${slug}`, { headers: enTetesService() })
}

/** `CRM-154` : « Formation » du seed, parent des channels de ce dossier. */
const TRACK_FORMATION_ID = '5eed0000-0000-4000-8000-000000000023'

/** Les positions des channels actifs de « Formation », dans leur ordre — lues avec la clé de service. */
async function positionsFormation(request: import('@playwright/test').APIRequestContext): Promise<number[]> {
	const reponse = await request.get(
		`${CHEMIN_CHANNELS}?select=id,position&track_id=eq.${TRACK_FORMATION_ID}&archived_at=is.null&deleted_at=is.null&order=position,name`,
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as { position: number }[]).map((ligne) => ligne.position)
}

/**
 * `CRM-154` (§15.5) : la fonction renumérote de 1 à n, si bien que le channel du seed garde la position que le
 * déplacement lui a donnée une fois le channel de la preuve purgé. L'ordre du seed est reposé PAR LA MÊME FONCTION,
 * sur la liste restante, et la preuve rend la base telle qu'elle l'a trouvée.
 */
async function reposerOrdreFormation(request: import('@playwright/test').APIRequestContext): Promise<void> {
	const reponse = await request.get(
		`${CHEMIN_CHANNELS}?select=id&track_id=eq.${TRACK_FORMATION_ID}&archived_at=is.null&deleted_at=is.null&order=position,name`,
		{ headers: enTetesService() },
	)
	const ids = ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
	if (ids.length === 0) return
	await request.post(`${URL_API}/rest/v1/rpc/reorder_channels`, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { p_track_id: TRACK_FORMATION_ID, p_channel_ids: ids },
	})
}

// -------------------------------------------------------------------------------------------
// À la souris
// -------------------------------------------------------------------------------------------

test.describe('les cinq gestes, à la souris (docs/SPEC-administration-arborescence.md §5, §6)', () => {
	test('un administrateur crée, renomme, réordonne, archive et désarchive un TRACK', async ({
		page,
		request,
	}) => {
		const slug = 'e2e-arbo-souris'
		const nom = 'E2E Arbo Souris'
		const nomRenomme = 'E2E Arbo Souris Renommé'
		await supprimerParSlug(request, CHEMIN_TRACKS, slug)

		try {
			await connecter(page)
			// Depuis l'index des réglages, geste réel — pas une navigation directe.
			await page.goto('/reglages')
			await page.getByRole('link', { name: /Arborescence : tracks et channels/ }).click()
			await expect(page).toHaveURL(/\/reglages\/arborescence$/)
			await expect(page.getByRole('heading', { name: "Administration de l'arborescence" })).toBeVisible()

			// --- Créer -------------------------------------------------------------------------
			await page.getByRole('button', { name: 'Nouveau track' }).click()
			const creation = page.getByTestId('formulaire-track')
			await expect(creation).toBeVisible()
			await creation.getByLabel('Nom').fill(nom)
			// Le slug est PROPOSÉ depuis le nom, et cette proposition reste une commodité (§5.1) —
			// vérifiée ici plutôt que retapée : un test qui écraserait toujours la proposition ne
			// prouverait jamais qu'elle a eu lieu.
			await expect(creation.getByLabel('Slug')).toHaveValue(slug)
			await creation.getByRole('button', { name: 'Créer' }).click()
			await expect(creation).toBeHidden()
			await expect(listeTracks(page).getByText(nom, { exact: true })).toBeVisible()
			await expect(listeTracks(page).locator('code', { hasText: slug })).toBeVisible()
			// INC-254 : la barre latérale le liste aussitôt, sans rechargement — la coquille, gardée d'une
			// page de réglages à l'autre, relit ses tracks au signal de l'écriture.
			const barre = page.getByTestId('barre-laterale')
			await expect(barre.getByText(nom, { exact: true })).toBeVisible()

			// --- Renommer ----------------------------------------------------------------------
			await page.getByRole('button', { name: `Modifier ${nom}` }).click()
			const edition = page.getByTestId('formulaire-track')
			await expect(edition).toBeVisible()
			// Le slug ne se modifie pas depuis l'écran (§5.3) : le champ est présent, désactivé.
			await expect(edition.getByLabel('Slug')).toBeDisabled()
			await edition.getByLabel('Nom').fill(nomRenomme)
			await edition.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(edition).toBeHidden()
			await expect(listeTracks(page).getByText(nomRenomme, { exact: true })).toBeVisible()
			await expect(barre.getByText(nomRenomme, { exact: true })).toBeVisible()
			await expect(barre.getByText(nom, { exact: true })).toHaveCount(0)

			// --- Réordonner ----------------------------------------------------------------------
			// Le track créé est en fin de liste active : « Monter » le fait passer devant sa voisine.
			const avant = await ordreMonter(listeTracks(page))
			expect(avant.at(-1)).toBe(nomRenomme)
			const voisine = avant.at(-2)
			await page.getByRole('button', { name: `Monter ${nomRenomme}` }).click()
			await expect
				.poll(async () => ordreMonter(listeTracks(page)))
				.toEqual([...avant.slice(0, -2), nomRenomme, voisine])

			// --- Archiver ------------------------------------------------------------------------
			await page.getByRole('button', { name: `Archiver ${nomRenomme}` }).click()
			const confirmation = page.getByTestId('confirmation-archivage')
			await expect(confirmation).toContainText(`Archiver le track « ${nomRenomme} » ?`)
			await confirmation.getByRole('button', { name: 'Archiver' }).click()
			await expect(confirmation).toBeHidden()
			await expect(listeTracks(page).getByText(nomRenomme, { exact: true })).toHaveCount(0)
			// Archivé, il quitte la barre latérale, qui ne liste que les vivants.
			await expect(barre.getByText(nomRenomme, { exact: true })).toHaveCount(0)

			// --- Désarchiver ---------------------------------------------------------------------
			await page.getByLabel('Afficher les archivés').check()
			const ligneArchivee = listeTracks(page).locator('li', { hasText: nomRenomme })
			await expect(ligneArchivee.getByText('Archivé')).toBeVisible()
			// Une ligne archivée ne garde qu'une commande (§6.4).
			await expect(ligneArchivee.getByRole('button', { name: `Monter ${nomRenomme}` })).toHaveCount(0)
			await ligneArchivee.getByRole('button', { name: `Désarchiver ${nomRenomme}` }).click()
			await expect(ligneArchivee.getByText('Archivé')).toHaveCount(0)
			await expect(ligneArchivee.getByRole('button', { name: `Archiver ${nomRenomme}` })).toBeVisible()
			await expect(barre.getByText(nomRenomme, { exact: true })).toBeVisible()
		} finally {
			await supprimerParSlug(request, CHEMIN_TRACKS, slug)
		}
	})

	test('un administrateur crée, renomme, réordonne, archive et désarchive un CHANNEL', async ({
		page,
		request,
	}) => {
		const slug = 'e2e-canal-souris'
		const nom = 'E2E Canal Souris'
		const nomRenomme = 'E2E Canal Souris Renommé'
		await supprimerParSlug(request, CHEMIN_CHANNELS, slug)

		try {
			await connecter(page)
			await page.goto('/reglages/arborescence')

			await page.getByRole('button', { name: `Déplier ${TRACK_FORMATION_NOM}` }).click()
			const channels = listeChannels(page, TRACK_FORMATION_NOM)
			await expect(channels).toBeVisible()

			// --- Créer -------------------------------------------------------------------------
			await page.getByRole('button', { name: 'Nouveau channel' }).click()
			const creation = page.getByTestId('formulaire-channel')
			await expect(creation).toBeVisible()
			await creation.getByLabel('Nom').fill(nom)
			await expect(creation.getByLabel('Slug')).toHaveValue(slug)
			// Un seul workflow est affectable au track Formation : le global par défaut (§7.2).
			await creation.getByLabel('Workflow').selectOption({ label: 'Cycle commercial standard (par défaut)' })
			await creation.getByRole('button', { name: 'Créer' }).click()
			await expect(creation).toBeHidden()
			await expect(channels.getByText(nom, { exact: true })).toBeVisible()

			// --- Renommer ----------------------------------------------------------------------
			await channels.getByRole('button', { name: `Modifier ${nom}` }).click()
			const edition = page.getByTestId('formulaire-channel')
			await expect(edition).toBeVisible()
			await edition.getByLabel('Nom').fill(nomRenomme)
			await edition.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(edition).toBeHidden()
			await expect(channels.getByText(nomRenomme, { exact: true })).toBeVisible()

			// --- Réordonner ----------------------------------------------------------------------
			const avant = await ordreMonter(channels)
			expect(avant.at(-1)).toBe(nomRenomme)
			const voisine = avant.at(-2)
			await channels.getByRole('button', { name: `Monter ${nomRenomme}` }).click()
			await expect
				.poll(async () => ordreMonter(channels))
				.toEqual([...avant.slice(0, -2), nomRenomme, voisine])
			// `CRM-154` (§15.2) : la base a renuméroté les channels actifs du track de 1 à n — plus d'index fractionnaire.
			expect(await positionsFormation(request)).toEqual(avant.map((_, rang) => rang + 1))

			// --- Archiver ------------------------------------------------------------------------
			await channels.getByRole('button', { name: `Archiver ${nomRenomme}` }).click()
			const confirmation = page.getByTestId('confirmation-archivage')
			await expect(confirmation).toContainText(`Archiver le channel « ${nomRenomme} » ?`)
			await confirmation.getByRole('button', { name: 'Archiver' }).click()
			await expect(confirmation).toBeHidden()
			await expect(channels.getByText(nomRenomme, { exact: true })).toHaveCount(0)

			// --- Désarchiver ---------------------------------------------------------------------
			await page.getByLabel('Afficher les archivés').check()
			const ligneArchivee = channels.locator('li', { hasText: nomRenomme })
			await expect(ligneArchivee.getByText('Archivé')).toBeVisible()
			await ligneArchivee.getByRole('button', { name: `Désarchiver ${nomRenomme}` }).click()
			await expect(ligneArchivee.getByText('Archivé')).toHaveCount(0)
		} finally {
			await supprimerParSlug(request, CHEMIN_CHANNELS, slug)
			await reposerOrdreFormation(request)
		}
	})
})

// -------------------------------------------------------------------------------------------
// Au clavier — focus atteint par `Tab`, jamais par `focus()`
// -------------------------------------------------------------------------------------------

test.describe('les cinq gestes, au clavier (docs/DESIGN_SYSTEM.md §8, CLAUDE.md §22)', () => {
	test('un administrateur crée, renomme, réordonne, archive et désarchive un TRACK — au clavier', async ({
		page,
		request,
	}) => {
		const slug = 'e2e-arbo-clavier'
		const nom = 'E2E Arbo Clavier'
		const nomRenomme = 'E2E Arbo Clavier Renommé'
		await supprimerParSlug(request, CHEMIN_TRACKS, slug)

		try {
			await connecter(page)
			await page.goto('/reglages/arborescence')
			await expect(page.getByRole('heading', { name: "Administration de l'arborescence" })).toBeVisible()

			// --- Créer -------------------------------------------------------------------------
			await tabVers(page, page.getByRole('button', { name: 'Nouveau track' }))
			await page.keyboard.press('Enter')
			const creation = page.getByTestId('formulaire-track')
			await expect(creation.getByLabel('Nom')).toBeFocused()
			await page.keyboard.type(nom)
			await expect(creation.getByLabel('Slug')).toHaveValue(slug)
			// Nom → Slug → Couleur → Icône → Description → Créer.
			await tabVers(page, creation.getByRole('button', { name: 'Créer' }))
			await page.keyboard.press('Enter')
			await expect(creation).toBeHidden()
			await expect(listeTracks(page).getByText(nom, { exact: true })).toBeVisible()

			// --- Renommer ----------------------------------------------------------------------
			await tabVers(page, page.getByRole('button', { name: `Modifier ${nom}` }))
			await page.keyboard.press('Enter')
			const edition = page.getByTestId('formulaire-track')
			await expect(edition.getByLabel('Nom')).toBeFocused()
			await page.keyboard.press('Control+A')
			await page.keyboard.type(nomRenomme)
			// Nom → Slug(désactivé, sauté par le navigateur) → Couleur → Icône → Description → Enregistrer.
			await tabVers(page, edition.getByRole('button', { name: 'Enregistrer' }))
			await page.keyboard.press('Enter')
			await expect(edition).toBeHidden()
			await expect(listeTracks(page).getByText(nomRenomme, { exact: true })).toBeVisible()

			// --- Réordonner ----------------------------------------------------------------------
			const avant = await ordreMonter(listeTracks(page))
			expect(avant.at(-1)).toBe(nomRenomme)
			const voisine = avant.at(-2)
			await tabVers(page, page.getByRole('button', { name: `Monter ${nomRenomme}` }))
			await page.keyboard.press('Enter')
			await expect
				.poll(async () => ordreMonter(listeTracks(page)))
				.toEqual([...avant.slice(0, -2), nomRenomme, voisine])

			// --- Archiver ------------------------------------------------------------------------
			await tabVers(page, page.getByRole('button', { name: `Archiver ${nomRenomme}` }))
			await page.keyboard.press('Enter')
			const confirmation = page.getByTestId('confirmation-archivage')
			// La confirmation reçoit le focus À L'OUVERTURE (`ConfirmationArchivage`, useEffect) :
			// pas de `Tab` à faire pour l'atteindre.
			await expect(confirmation.getByRole('button', { name: 'Archiver' })).toBeFocused()
			await page.keyboard.press('Enter')
			await expect(confirmation).toBeHidden()
			await expect(listeTracks(page).getByText(nomRenomme, { exact: true })).toHaveCount(0)

			// --- Désarchiver ---------------------------------------------------------------------
			await tabVers(page, page.getByLabel('Afficher les archivés'))
			await page.keyboard.press('Space')
			const ligneArchivee = listeTracks(page).locator('li', { hasText: nomRenomme })
			await expect(ligneArchivee.getByText('Archivé')).toBeVisible()
			await tabVers(page, ligneArchivee.getByRole('button', { name: `Désarchiver ${nomRenomme}` }))
			await page.keyboard.press('Enter')
			await expect(ligneArchivee.getByText('Archivé')).toHaveCount(0)
		} finally {
			await supprimerParSlug(request, CHEMIN_TRACKS, slug)
		}
	})

	test('un administrateur crée, renomme, réordonne, archive et désarchive un CHANNEL — au clavier', async ({
		page,
		request,
	}) => {
		const slug = 'e2e-canal-clavier'
		const nom = 'E2E Canal Clavier'
		const nomRenomme = 'E2E Canal Clavier Renommé'
		await supprimerParSlug(request, CHEMIN_CHANNELS, slug)

		try {
			await connecter(page)
			await page.goto('/reglages/arborescence')

			await tabVers(page, page.getByRole('button', { name: `Déplier ${TRACK_FORMATION_NOM}` }))
			await page.keyboard.press('Enter')
			const channels = listeChannels(page, TRACK_FORMATION_NOM)
			await expect(channels).toBeVisible()

			// --- Créer -------------------------------------------------------------------------
			await tabVers(page, page.getByRole('button', { name: 'Nouveau channel' }))
			await page.keyboard.press('Enter')
			const creation = page.getByTestId('formulaire-channel')
			await expect(creation.getByLabel('Nom')).toBeFocused()
			await page.keyboard.type(nom)
			await expect(creation.getByLabel('Slug')).toHaveValue(slug)
			await creation.getByLabel('Workflow').selectOption({ label: 'Cycle commercial standard (par défaut)' })
			await tabVers(page, creation.getByRole('button', { name: 'Créer' }))
			await page.keyboard.press('Enter')
			await expect(creation).toBeHidden()
			await expect(channels.getByText(nom, { exact: true })).toBeVisible()

			// --- Renommer ----------------------------------------------------------------------
			await tabVers(page, channels.getByRole('button', { name: `Modifier ${nom}` }))
			await page.keyboard.press('Enter')
			const edition = page.getByTestId('formulaire-channel')
			await expect(edition.getByLabel('Nom')).toBeFocused()
			await page.keyboard.press('Control+A')
			await page.keyboard.type(nomRenomme)
			await tabVers(page, edition.getByRole('button', { name: 'Enregistrer' }))
			await page.keyboard.press('Enter')
			await expect(edition).toBeHidden()
			await expect(channels.getByText(nomRenomme, { exact: true })).toBeVisible()

			// --- Réordonner ----------------------------------------------------------------------
			const avant = await ordreMonter(channels)
			expect(avant.at(-1)).toBe(nomRenomme)
			const voisine = avant.at(-2)
			await tabVers(page, channels.getByRole('button', { name: `Monter ${nomRenomme}` }))
			await page.keyboard.press('Enter')
			await expect
				.poll(async () => ordreMonter(channels))
				.toEqual([...avant.slice(0, -2), nomRenomme, voisine])

			// --- Archiver ------------------------------------------------------------------------
			await tabVers(page, channels.getByRole('button', { name: `Archiver ${nomRenomme}` }))
			await page.keyboard.press('Enter')
			const confirmation = page.getByTestId('confirmation-archivage')
			await expect(confirmation.getByRole('button', { name: 'Archiver' })).toBeFocused()
			await page.keyboard.press('Enter')
			await expect(confirmation).toBeHidden()
			await expect(channels.getByText(nomRenomme, { exact: true })).toHaveCount(0)

			// --- Désarchiver ---------------------------------------------------------------------
			await tabVers(page, page.getByLabel('Afficher les archivés'))
			await page.keyboard.press('Space')
			const ligneArchivee = channels.locator('li', { hasText: nomRenomme })
			await expect(ligneArchivee.getByText('Archivé')).toBeVisible()
			await tabVers(page, ligneArchivee.getByRole('button', { name: `Désarchiver ${nomRenomme}` }))
			await page.keyboard.press('Enter')
			await expect(ligneArchivee.getByText('Archivé')).toHaveCount(0)
		} finally {
			await supprimerParSlug(request, CHEMIN_CHANNELS, slug)
			await reposerOrdreFormation(request)
		}
	})
})

// -------------------------------------------------------------------------------------------
// Paliers responsive (docs/DESIGN_SYSTEM.md §7) — même patron que `e2e/ui/etat-messagerie.spec.ts`
// -------------------------------------------------------------------------------------------

test.describe('CRM-154 : l’adresse `?track=` (docs/SPEC-administration-arborescence.md §15.3)', () => {
	test('ouvre l’écran sur le track : déplié, focus sur son dépliage, le paramètre retiré', async ({ page }) => {
		await connecter(page)
		await page.goto(`/reglages/arborescence?track=${TRACK_FORMATION_ID}`)
		const replier = page.getByRole('button', { name: `Replier ${TRACK_FORMATION_NOM}` })
		await expect(replier).toHaveAttribute('aria-expanded', 'true')
		await expect(listeChannels(page, TRACK_FORMATION_NOM)).toBeVisible()
		await expect(replier).toBeFocused()
		await expect(page).toHaveURL(/\/reglages\/arborescence$/)
	})

	test('un track inconnu : rien ne s’ouvre, le paramètre quitte l’adresse', async ({ page }) => {
		await connecter(page)
		await page.goto('/reglages/arborescence?track=5eed0000-0000-4000-8000-0000000000ff')
		await expect(page.getByRole('button', { name: `Déplier ${TRACK_FORMATION_NOM}` })).toBeVisible()
		await expect(page).toHaveURL(/\/reglages\/arborescence$/)
		// Dans la région de l'arborescence : « Replier la barre latérale » n'est pas un track.
		await expect(
			page.getByRole('region', { name: "Tracks et channels de l'espace de travail" }).getByRole('button', { name: /^Replier / }),
		).toHaveCount(0)
	})
})

test.describe('paliers responsive', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : l'arborescence reste lisible`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			await page.goto('/reglages/arborescence')
			await expect(page.getByRole('heading', { name: "Administration de l'arborescence" })).toBeVisible()
			await expect(listeTracks(page)).toBeVisible()

			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

			await capturer(page, `arborescence-${palier.nom}`, UNITE)
		})
	}
})
