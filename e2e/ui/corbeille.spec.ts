// @verifies CRM-077 (docs/BACKLOG.md) — corbeille et restauration : le parcours d'interface
// @verifies docs/SPEC-corbeille.md §3.4 (le refus nommé), §4.1 (l'adresse), §4.3 (l'auteur
//           inconnu), §4.4 (l'énumération d'une entrée parente), §4.5 (les trois issues),
//           §4.6 (les quatre états), §4.7 (aucun effacement définitif), §5 (lignes « E2E » et
//           « Visuel »), §4 bis (le GESTE de mise à la corbeille et sa confirmation)
// @verifies docs/SPEC-seed.md §10.1 (les trois objets), §10.4 bis (l'affaire `…0cf`)
// @verifies docs/DESIGN_SYSTEM.md §5.16 (cette surface), §7 (paliers), §12.5 (réponse substituée)
// @verifies CLAUDE.md §10 (une règle se prouve sur la vraie base), §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, sur la VRAIE base : aucune fonction interne n'est
// appelée, et chaque effet est CONSTATÉ EN BASE par une relecture, jamais déduit de l'écran. Un
// écran qui afficherait « restauré » sans que la ligne ait changé passerait une preuve qui ne
// regarderait que lui.
//
// L'ÉTAT DE LA BASE EST RENDU INTACT. Le scénario de restauration qui RÉUSSIT remet ensuite le
// track en corbeille par le geste réel de l'administratrice — celui-là même qu'emploie
// `supabase/seed/apply-seed.sh` (docs/SPEC-seed.md §10.2) —, et le `finally` s'exécute même si une
// assertion échoue. Sans cela, la deuxième exécution de cette suite partirait d'un seed différent.

import { expect, test, type Page } from './fixtures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-077'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** Les trois objets du seed (`docs/SPEC-seed.md` §10.1) et l'affaire née en corbeille. */
const TRACK_CORBEILLE = '5eed0000-0000-4000-8000-000000000025'
const CHANNEL_CORBEILLE = '5eed0000-0000-4000-8000-000000000038'
const NOM_TRACK = 'Legacy 2023'
const NOM_CHANNEL = 'Annexes 2023'
const NOM_CARD = 'Saisie erronée'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Relit `deleted_at` EN BASE, hors interface : c'est la seule preuve d'un effet (`CLAUDE.md` §10). */
async function deletedAt(page: Page, table: string, id: string): Promise<string | null> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/${table}?select=deleted_at&id=eq.${id}`,
		{ headers: enTetesService() },
	)
	expect(reponse.status()).toBe(200)
	const lignes = (await reponse.json()) as { deleted_at: string | null }[]
	expect(lignes, `${table}/${id} doit exister dans le seed`).toHaveLength(1)
	return lignes[0]?.deleted_at ?? null
}

/**
 * Remet le track en corbeille par le GESTE RÉEL de l'administratrice, et non par la clé de service.
 *
 * Le motif est mesuré et écrit au §10.2 de `docs/SPEC-seed.md` : la clé de service ne porte aucune
 * revendication `sub`, `auth.uid()` y est donc nul, et un objet remis en corbeille par elle naîtrait
 * avec un `deleted_by` NUL que le trigger figerait ensuite. La suite rendrait alors un seed
 * subtilement différent de celui qu'elle a trouvé.
 */
async function remettreEnCorbeille(page: Page, jeton: string): Promise<void> {
	const reponse = await page.request.patch(`${URL_API}/rest/v1/tracks?id=eq.${TRACK_CORBEILLE}`, {
		headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
		data: { deleted_at: '2026-07-20T14:30:00+00:00' },
	})
	expect(reponse.status()).toBe(200)
	expect(await reponse.json(), 'la remise en corbeille doit toucher exactement une ligne').toHaveLength(1)
}

test.describe('corbeille (docs/SPEC-corbeille.md §4)', () => {
	test("l'administratrice atteint la corbeille depuis les réglages et lit ses trois entrées", async ({
		page,
	}) => {
		await connecter(page, ADMIN)

		// Depuis l'index des réglages, par un geste réel — pas une navigation directe (§4.1).
		await page.goto('/reglages')
		await page.getByRole('link', { name: 'Corbeille' }).click()
		await expect(page).toHaveURL(/\/reglages\/corbeille$/)
		await expect(page.getByRole('heading', { name: 'Corbeille' })).toBeVisible()

		await expect(page.getByTestId('tableau-corbeille')).toBeVisible()
		await expect(page.getByTestId('ligne-corbeille')).toHaveCount(3)

		// Le type est un MOT, dans sa propre colonne (docs/DESIGN_SYSTEM.md §5.16).
		const ligneTrack = page.getByTestId('ligne-corbeille').filter({ hasText: NOM_TRACK })
		await expect(ligneTrack).toContainText('Track')
		await expect(ligneTrack).toContainText('Camille Aubert')

		// L'ÉNUMÉRATION MESURÉE SUR LA VRAIE BASE : le track retient son channel vivant
		// `dossiers-2023` et l'affaire `…0cf` qu'il porte. Le channel en corbeille sous lui n'est PAS
		// compté — il ne devient pas inaccessible, il l'est déjà (§3.5).
		await expect(ligneTrack.getByText('1 channel')).toBeVisible()
		await expect(ligneTrack.getByText('1 affaire')).toBeVisible()

		// Le channel en corbeille ne retient aucune affaire : la phrase le dit, un blanc se lirait
		// comme une mesure qui n'a pas abouti.
		const ligneChannel = page.getByTestId('ligne-corbeille').filter({ hasText: NOM_CHANNEL })
		await expect(ligneChannel).toContainText('Channel')
		await expect(ligneChannel.getByText('Rien de plus')).toBeVisible()

		// L'AUTEUR INCONNU EST NOMMÉ (§4.3) : l'affaire du seed est née en corbeille sous la clé de
		// service, son `deleted_by` est nul et figé — MESURÉ.
		const ligneCard = page.getByTestId('ligne-corbeille').filter({ hasText: NOM_CARD })
		await expect(ligneCard).toContainText('Affaire')
		await expect(ligneCard.getByText('Auteur inconnu')).toBeVisible()

		// AUCUNE COMMANDE D'EFFACEMENT DÉFINITIF (§4.7) : le §6 n'est pas arbitré.
		await expect(page.getByRole('button', { name: /supprim|effac|vider|définitif/i })).toHaveCount(0)
	})

	test('restaurer un enfant sous parent en corbeille est REFUSÉ, et la base ne bouge pas', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages/corbeille')

		const ligneChannel = page.getByTestId('ligne-corbeille').filter({ hasText: NOM_CHANNEL })
		await ligneChannel.getByTestId('bouton-restaurer').click()

		// Le refus est nommé, et il DIT QUOI RESTAURER D'ABORD (§3.4) — jamais « une erreur est
		// survenue ».
		const refus = page.getByTestId('refus-restauration')
		await expect(refus).toBeVisible()
		await expect(refus).toHaveText("Son parent est lui-même en corbeille : restaurez-le d'abord.")

		// LA GARDE RÉPOND `400`, ET LE NAVIGATEUR LE JOURNALISE. Ce n'est pas une anomalie tue : la
		// liste attendue est EXACTE — un statut, un nombre ou un ordre différent échoue ici —, et
		// l'erreur a été provoquée par le scénario puis expliquée à l'utilisateur à la ligne
		// précédente. Même discipline que le refus `409` d'une étape occupée
		// (`administration-workflows.spec.ts`).
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])

		// LA GARDE EST BACKEND : le channel est TOUJOURS en corbeille, relu hors interface.
		expect(await deletedAt(page, 'channels', CHANNEL_CORBEILLE)).not.toBeNull()
		// La ligne reste dans le tableau : rien n'a été restauré, rien ne disparaît.
		await expect(page.getByTestId('ligne-corbeille')).toHaveCount(3)
	})

	test('restaurer le track RÉUSSIT, la base le confirme, et la corbeille le perd', async ({ page }) => {
		const jeton = await jetonDe(ADMIN)
		await connecter(page, ADMIN)
		await page.goto('/reglages/corbeille')
		try {
			const ligneTrack = page.getByTestId('ligne-corbeille').filter({ hasText: NOM_TRACK })
			await ligneTrack.getByTestId('bouton-restaurer').click()

			await expect(page.getByTestId('corbeille-succes')).toContainText(NOM_TRACK)

			// L'EFFET EST CONSTATÉ EN BASE, et c'est ce qui donne sa valeur au reste : `deleted_at`
			// vaut réellement `NULL` (ligne « E2E » du §5).
			expect(await deletedAt(page, 'tracks', TRACK_CORBEILLE)).toBeNull()

			// La liste est RELUE : l'entrée a quitté la corbeille, et le channel qui restait sous ce
			// track y demeure — restaurer un parent ne restaure pas ses enfants (§3.3).
			await expect(page.getByTestId('ligne-corbeille').filter({ hasText: NOM_TRACK })).toHaveCount(0)
			await expect(page.getByTestId('ligne-corbeille').filter({ hasText: NOM_CHANNEL })).toHaveCount(1)
		} finally {
			await remettreEnCorbeille(page, jeton)
		}
		// Le seed est rendu intact, y compris son audit : `deleted_by` est réécrit par le trigger
		// depuis le jeton réel de l'administratrice.
		expect(await deletedAt(page, 'tracks', TRACK_CORBEILLE)).not.toBeNull()
	})

	test('le parcours complet se fait AU CLAVIER SEUL, jusqu’au refus', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages')

		// Atteindre le lien de la corbeille à la tabulation, sans jamais cliquer.
		const lien = page.getByRole('link', { name: 'Corbeille' })
		await lien.focus()
		await expect(lien).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/reglages\/corbeille$/)

		const commande = page
			.getByTestId('ligne-corbeille')
			.filter({ hasText: NOM_CHANNEL })
			.getByTestId('bouton-restaurer')
		await commande.focus()
		await expect(commande).toBeFocused()
		await page.keyboard.press('Enter')

		// Le refus est annoncé par `role="alert"` : un lecteur d'écran l'entend sans avoir à le
		// chercher (docs/DESIGN_SYSTEM.md §5.16).
		await expect(page.getByRole('alert')).toBeVisible()
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	test('la lectrice voit ce qu’elle peut lire, et pas davantage (§4.2)', async ({ page }) => {
		await connecter(page, VIEWER)
		await page.goto('/reglages/corbeille')

		// MESURÉ : la lectrice lit le track et le channel, mais PAS l'affaire — les droits fins lui
		// ferment son channel. Le compte est celui de l'appelant, jamais un inventaire d'autorité.
		await expect(page.getByTestId('ligne-corbeille')).toHaveCount(2)
		await expect(page.getByTestId('ligne-corbeille').filter({ hasText: NOM_CARD })).toHaveCount(0)
	})
})

// --- Paliers responsive et état vide (docs/DESIGN_SYSTEM.md §7, §11) --------------------------
//
// La taille de fenêtre est fixée AVANT le chargement, même patron que `etat-messagerie.spec.ts` :
// la coquille détermine son repli de barre latérale au montage.

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le tableau de la corbeille reste lisible`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto('/reglages/corbeille')
			await expect(page.getByTestId('tableau-corbeille')).toBeVisible()

			// La page ne défile jamais horizontalement (§7) : c'est le conteneur du tableau qui le
			// fait, avec l'indication de débordement du §12.6.
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

			await capturer(page, `corbeille-${palier.nom}`, UNITE)
		})
	}
})

test.describe("état vide (docs/DESIGN_SYSTEM.md §12.5)", () => {
	test('« la corbeille est vide » est une phrase, et n’offre aucune action', async ({ page }) => {
		// RÉPONSE SUBSTITUÉE, ET ELLE EST NOMMÉE. Le §12.5 l'admet « pour isoler un état rare » :
		// l'état vide en est un PAR CONSTRUCTION, le seed existant précisément pour démontrer la
		// corbeille (docs/SPEC-seed.md §10). Aucun des trois comptes ne peut donc l'atteindre —
		// MESURÉ. La substitution porte sur les trois lectures et sur rien d'autre : le parcours
		// connecté reste celui des scénarios ci-dessus, qu'elle ne remplace pas.
		await page.route(/\/rest\/v1\/(tracks|channels|cards)\?select=id.*deleted_at=not\.is\.null/, (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
		)
		await connecter(page, ADMIN)
		await page.goto('/reglages/corbeille')

		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByText('La corbeille est vide')).toBeVisible()
		// Un tableau sans ligne n'est PAS un état vide (§4.6).
		await expect(page.getByTestId('tableau-corbeille')).toHaveCount(0)
		// L'écart assumé avec le §5.8 : il n'y a rien à faire d'une corbeille vide.
		await expect(page.getByRole('button', { name: 'Restaurer' })).toHaveCount(0)

		await capturer(page, 'corbeille-etat-vide', UNITE)
	})
})

// --- Le GESTE de mise à la corbeille — CRM-077 §4 bis -----------------------------------------
//
// L'ALLER-RETOUR COMPLET EST PROUVÉ SUR LA VRAIE BASE : un track créé pour la preuve est retiré
// DEPUIS L'ÉCRAN d'administration, constaté en base, retrouvé dans la corbeille, puis restauré
// depuis elle. Aucun des deux écrans n'est cru sur parole — chaque effet est relu hors interface.
//
// La preuve crée ses PROPRES objets sous un slug préfixé `e2e-geste-`, et les supprime dans son
// `finally` avec la clé de service : c'est la règle d'INC-099, et elle interdit de laisser derrière
// soi une ligne que les comptes figés du seed dénonceraient (`0004_tracks.test.sql`).

const CHEMIN_TRACKS = `${URL_API}/rest/v1/tracks`
const CHEMIN_CHANNELS = `${URL_API}/rest/v1/channels`
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'

async function supprimerParSlug(page: Page, chemin: string, slug: string): Promise<void> {
	await page.request.delete(`${chemin}?slug=eq.${slug}`, { headers: enTetesService() })
}

/** Crée un track jetable ACTIF, et rend son identifiant. */
async function creerTrackJetable(page: Page, slug: string, nom: string): Promise<string> {
	const reponse = await page.request.post(CHEMIN_TRACKS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { workspace_id: WORKSPACE_SEED, name: nom, slug, color: 'neutral', icon: 'folder' },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

test.describe('le geste de mise à la corbeille (docs/SPEC-corbeille.md §4 bis)', () => {
	test('un track est retiré depuis l’administration, constaté en base, et retrouvé dans la corbeille', async ({
		page,
	}) => {
		const slugTrack = 'e2e-geste-track'
		const nomTrack = 'E2E Geste Track'
		const slugChannel = 'e2e-geste-canal'
		await supprimerParSlug(page, CHEMIN_CHANNELS, slugChannel)
		await supprimerParSlug(page, CHEMIN_TRACKS, slugTrack)

		try {
			const idTrack = await creerTrackJetable(page, slugTrack, nomTrack)
			// UN ENFANT VIVANT, pour que l'énumération de la confirmation ait quelque chose à dire :
			// sans lui, la capture montrerait « Aucun objet ne devient inaccessible » et la ligne
			// « Visuel » du §5 — « la confirmation portant l'énumération » — resterait sans sujet.
			const cree = await page.request.post(CHEMIN_CHANNELS, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					track_id: idTrack,
					workflow_id: WORKFLOW_GLOBAL,
					name: 'E2E Geste Canal',
					slug: slugChannel,
				},
			})
			expect(cree.status(), await cree.text()).toBe(201)

			await connecter(page, ADMIN)
			await page.goto('/reglages')
			await page.getByRole('link', { name: /Arborescence : tracks et channels/ }).click()
			await expect(page).toHaveURL(/\/reglages\/arborescence$/)
			await expect(
				page
					.getByRole('region', { name: "Tracks et channels de l'espace de travail" })
					.getByText(nomTrack, { exact: true }),
			).toBeVisible()

			// --- La confirmation, et son énumération -------------------------------------------
			await page.getByRole('button', { name: `Mettre ${nomTrack} à la corbeille` }).click()
			const confirmation = page.getByTestId('confirmation-corbeille')
			await expect(confirmation).toContainText(`Mettre le track « ${nomTrack} » à la corbeille ?`)
			// Le compte VIENT DE LA BASE : un channel vivant, aucune affaire — et « 1 channel » au
			// singulier, deux clés distinctes du catalogue.
			await expect(confirmation).toContainText('1 channel')
			await expect(confirmation).not.toContainText('affaire')

			// LA CONFIRMATION TIENT ENTIÈREMENT DANS LE CHAMP au palier de référence, et c'est ce
			// contrôle qui a trouvé un vrai défaut : la liste porte `min-w-max` pour son débordement
			// horizontal (§12.6), donc un paragraphe non borné ne se replie JAMAIS. Le corps de cette
			// confirmation, plus long que celui de l'archivage, élargissait la liste et sortait de
			// l'écran. La borne de largeur du composant est vérifiée ici plutôt que supposée.
			const boite = await confirmation.boundingBox()
			expect(boite!.x + boite!.width, 'la confirmation ne sort pas du champ').toBeLessThanOrEqual(
				page.viewportSize()!.width,
			)
			await capturer(page, 'corbeille-geste-confirmation', UNITE)

			// RIEN N'EST ÉCRIT AVANT LA CONFIRMATION, et c'est relu en base plutôt que supposé.
			expect(await deletedAt(page, 'tracks', idTrack)).toBeNull()

			await confirmation.getByRole('button', { name: 'Mettre à la corbeille' }).click()
			await expect(confirmation).toBeHidden()

			// --- L'effet, constaté EN BASE ------------------------------------------------------
			await expect
				.poll(async () => deletedAt(page, 'tracks', idTrack))
				.not.toBeNull()
			// L'enfant n'est PAS horodaté (§3.3) : c'est l'énumération qui le comptait, pas une
			// descente de l'horodatage.
			const enfants = await page.request.get(
				`${CHEMIN_CHANNELS}?select=deleted_at&track_id=eq.${idTrack}`,
				{ headers: enTetesService() },
			)
			expect((await enfants.json()) as unknown[]).toEqual([{ deleted_at: null }])

			// --- L'écran d'administration ne le montre plus (§4 bis.2) --------------------------
			//
			// L'ASSERTION PORTE SUR LA RÉGION D'ADMINISTRATION, PAS SUR LA PAGE. La barre latérale,
			// elle, garde le track jusqu'au prochain chargement : elle lit sa propre copie dans
			// `AppShell`, qu'aucune écriture de cet écran ne rafraîchit. C'est INC-120, MESURÉ à
			// l'identique sur l'ARCHIVAGE de `CRM-075` — donc antérieur à cette tranche, et laissé
			// inchangé. Assertir la page entière aurait rendu cette preuve rouge pour un défaut
			// étranger, et l'aurait fait relâcher plus tard sans que personne sache pourquoi.
			const administration = page.getByRole('region', {
				name: "Tracks et channels de l'espace de travail",
			})
			await expect(administration.getByText(nomTrack, { exact: true })).toHaveCount(0)
			// …et la case « Afficher les archivés » ne le ramène pas : il n'est pas archivé (§3.1).
			await page.getByLabel(/Afficher les archivés/).check()
			await expect(administration.getByText(nomTrack, { exact: true })).toHaveCount(0)

			// --- Il est dans la corbeille, avec son auteur --------------------------------------
			await page.goto('/reglages/corbeille')
			const ligne = page.getByRole('row', { name: new RegExp(nomTrack) })
			await expect(ligne).toBeVisible()
			await expect(ligne).toContainText('Track')
			// L'auteur est celui du GESTE, écrit par le trigger : jamais « Auteur inconnu » ici.
			await expect(ligne).not.toContainText('Auteur inconnu')

			// --- Et il se restaure, ce qui referme l'aller-retour --------------------------------
			await ligne.getByRole('button', { name: `Restaurer ${nomTrack}` }).click()
			await expect.poll(async () => deletedAt(page, 'tracks', idTrack)).toBeNull()
		} finally {
			await supprimerParSlug(page, CHEMIN_CHANNELS, slugChannel)
			await supprimerParSlug(page, CHEMIN_TRACKS, slugTrack)
		}
	})

	test('le geste se fait AU CLAVIER SEUL, de la commande à la confirmation', async ({ page }) => {
		const slug = 'e2e-geste-clavier'
		const nom = 'E2E Geste Clavier'
		await supprimerParSlug(page, CHEMIN_TRACKS, slug)

		try {
			const id = await creerTrackJetable(page, slug, nom)
			await connecter(page, ADMIN)
			await page.goto('/reglages/arborescence')
			// Portée limitée à la région d'administration : la barre latérale rend le même nom, et
			// c'est celui de l'écran qui nous intéresse ici (voir INC-120 plus bas).
			await expect(
				page
					.getByRole('region', { name: "Tracks et channels de l'espace de travail" })
					.getByText(nom, { exact: true }),
			).toBeVisible()

			// Le focus est atteint par `Tab`, jamais par `focus()` : Chromium ne pose
			// `:focus-visible` que sur un focus réellement clavier (docs/DESIGN_SYSTEM.md §8).
			const commande = page.getByRole('button', { name: `Mettre ${nom} à la corbeille` })
			for (let tentative = 0; tentative < 120; tentative++) {
				if (await commande.evaluate((element) => element === document.activeElement)) break
				await page.keyboard.press('Tab')
			}
			await expect(commande).toBeFocused()
			await page.keyboard.press('Enter')

			// OUVRIR LA CONFIRMATION DÉPLACE LE FOCUS SUR SA PREMIÈRE COMMANDE (§5.13) : la valider
			// se fait donc sans un seul `Tab` de plus.
			const confirmation = page.getByTestId('confirmation-corbeille')
			await expect(confirmation).toBeVisible()
			await expect(confirmation.getByRole('button', { name: 'Mettre à la corbeille' })).toBeFocused()
			await page.keyboard.press('Enter')

			await expect.poll(async () => deletedAt(page, 'tracks', id)).not.toBeNull()
		} finally {
			await supprimerParSlug(page, CHEMIN_TRACKS, slug)
		}
	})

	test('un channel se retire depuis son track déplié, sans emporter son track', async ({ page }) => {
		const slugTrack = 'e2e-geste-parent'
		const slugChannel = 'e2e-geste-enfant'
		const nomTrack = 'E2E Geste Parent'
		const nomChannel = 'E2E Geste Enfant'
		await supprimerParSlug(page, CHEMIN_CHANNELS, slugChannel)
		await supprimerParSlug(page, CHEMIN_TRACKS, slugTrack)

		try {
			const idTrack = await creerTrackJetable(page, slugTrack, nomTrack)
			const cree = await page.request.post(CHEMIN_CHANNELS, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					track_id: idTrack,
					workflow_id: WORKFLOW_GLOBAL,
					name: nomChannel,
					slug: slugChannel,
				},
			})
			const idChannel = ((await cree.json()) as { id: string }[])[0]!.id

			await connecter(page, ADMIN)
			await page.goto('/reglages/arborescence')
			await page.getByRole('button', { name: `Déplier ${nomTrack}` }).click()
			await page.getByRole('button', { name: `Mettre ${nomChannel} à la corbeille` }).click()

			const confirmation = page.getByTestId('confirmation-corbeille')
			await expect(confirmation).toContainText(`Mettre le channel « ${nomChannel} » à la corbeille ?`)
			// Un channel sans affaire : la confirmation le DIT, plutôt que d'afficher « 0 affaire ».
			await expect(confirmation).toContainText('Aucun objet ne devient inaccessible.')
			await confirmation.getByRole('button', { name: 'Mettre à la corbeille' }).click()

			await expect.poll(async () => deletedAt(page, 'channels', idChannel)).not.toBeNull()
			expect(await deletedAt(page, 'tracks', idTrack)).toBeNull()
			await expect(
				page
					.getByRole('region', { name: "Tracks et channels de l'espace de travail" })
					.getByText(nomChannel, { exact: true }),
			).toHaveCount(0)
		} finally {
			await supprimerParSlug(page, CHEMIN_CHANNELS, slugChannel)
			await supprimerParSlug(page, CHEMIN_TRACKS, slugTrack)
		}
	})
})

test.describe('paliers responsive de la confirmation du geste (docs/DESIGN_SYSTEM.md §7)', () => {
	// LA TAILLE DE FENÊTRE EST FIXÉE AVANT LE CHARGEMENT, comme pour le tableau ci-dessus et comme
	// `etat-messagerie.spec.ts` : la coquille décide de son repli de barre latérale AU MONTAGE. Une
	// première version redimensionnait la fenêtre après coup, dans le scénario de l'aller-retour, et
	// les captures montraient un tiroir laissé ouvert par le redimensionnement — un artefact de la
	// preuve, pas un état du produit. Trouvé en REGARDANT les captures (`CLAUDE.md` §16).
	for (const palier of PALIERS) {
		test(`${palier.nom} : la confirmation du geste reste lisible`, async ({ page }) => {
			const slug = `e2e-geste-palier-${palier.largeur}`
			const nom = `E2E Geste ${palier.nom}`
			await supprimerParSlug(page, CHEMIN_TRACKS, slug)
			try {
				await creerTrackJetable(page, slug, nom)
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				await connecter(page, ADMIN)
				await page.goto('/reglages/arborescence')
				await page.getByRole('button', { name: `Mettre ${nom} à la corbeille` }).click()
				await expect(page.getByTestId('confirmation-corbeille')).toBeVisible()

				const debordePage = await page.evaluate(
					() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
				)
				expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

				await capturer(page, `corbeille-geste-confirmation-${palier.nom}`, UNITE)
			} finally {
				await supprimerParSlug(page, CHEMIN_TRACKS, slug)
			}
		})
	}
})
