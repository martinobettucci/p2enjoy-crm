// @verifies CRM-094 (docs/BACKLOG.md) tranches T2 et T3 — le vrai premier lancement, dans un espace neuf
// @verifies docs/SPEC-onboarding.md §10.1 (six étapes), §10.2 (la pastille : pour qui, où, quand, deux
//           formes, un lien suivi ne la referme pas, re-mesure à chaque page), §10.3 (le geste, son focus,
//           et l'écran ouvert qui se relit), §10.4 (stockage de session), §10.5 (le formulaire de channel
//           sans workflow mène à l'éditeur), §10.6 (preuves E2E et visuelles)
// @verifies docs/SPEC-workflow-engine.md §7 quater (le workflow de départ, relu en base)
// @verifies docs/DESIGN_SYSTEM.md §5.49 (pastille, panneau, réserve, focus, cadre aux paliers), §7
// @verifies docs/JOURNAL.md décisions 606 et 607 ; CLAUDE.md §10 (le rôle décide d'un affichage),
//           §11 (rien hors de la session), §16 (vérification visuelle)
// @verifies CRM-092 (docs/BACKLOG.md) — connexion par la vraie page du SSO (`connecterAvecLeLabs`)
//
// LE DÉFAUT RELEVÉ PAR LE RESPONSABLE EST REJOUÉ TEL QU'IL L'A VÉCU, et c'est ce que ce fichier a de plus
// utile : un espace neuf, un premier track, un channel IMPOSSIBLE faute de workflow — puis la même chose
// avec le guide flottant, jusqu'au premier channel. Rien n'est substitué : l'espace est réellement vide,
// le geste écrit réellement, et l'effet est RELU en base avec la clé de service.
//
// LE MONTAGE est une opération d'exploitation, nommée comme telle (`docs/SPEC-onboarding.md` §8 ter.3) :
// le workspace et l'attente de son administrateur sont posés par la clé de service — aucun écran ne crée
// d'espace —, le compte naît dans le Keycloak de développement, et l'appartenance naît de la VRAIE
// connexion. Tout le reste passe par l'interface, avec le jeton réel du compte.
//
// LE DÉMONTAGE SUPPRIME DANS L'ORDRE, et ce n'est pas une précaution : MESURÉ le 2026-09-28, `channels`
// référence `workflows` et `workflow_steps` référence le catalogue en `ON DELETE RESTRICT`. Supprimer le
// seul workspace laisserait la cascade buter sur l'une ou l'autre selon son ordre. Il CONSTATE ensuite
// que la base est rendue à son unique workspace seedé, sans quoi `demarrage.spec.ts` et le contrôle
// n° 1 de `scripts/verify-seed.sh` rougiraient ailleurs, là où plus rien ne dirait pourquoi.

import type { Request } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { URL_API, enTetesService } from '../api/jetons'
import { creerCompteJetable, supprimerCompte } from '../api/keycloak-dev'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-094'
const ADMIN_SEED = 'admin@p2enjoy.test'
const VIEWER_SEED = 'viewer@p2enjoy.test'
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Identifiant fixe, préfixé `e0940000-…` comme la preuve d'API : une trace interrompue s'écrase. */
const ESPACE = { id: 'e0940000-0000-4000-8000-0000000000d1', slug: 'sonde-094-guide-flottant' } as const
const TRACK = { nom: 'Premier track', slug: 'premier-track' } as const
const CHANNEL = { nom: 'Premier channel', slug: 'premier-channel' } as const

/** La clé de la forme de la pastille, telle que `webapp/src/app/preferences.ts` la nomme (§10.4). */
const CLE_FORME = 'p2enjoy.demarrage.flottant'

type Compte = { readonly adresse: string; readonly sub: string }

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const pastille = (page: Page) => page.getByTestId('pastille-guide-flottant')
const panneau = (page: Page) => page.getByTestId('panneau-guide-flottant')

/**
 * Capture le panneau OUVERT, une fois son fondu d'ouverture terminé (150 ms, docs/DESIGN_SYSTEM.md §5.49).
 * MESURÉ le 2026-09-28 : prise pendant le fondu, la capture montrait un panneau transparent, la page
 * lisible au travers — une image que l'utilisateur ne voit jamais, et qui ferait juger un faux défaut.
 */
async function capturerPanneau(page: Page, nom: string): Promise<void> {
	await panneau(page).evaluate((noeud) =>
		Promise.all(noeud.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined),
	)
	await capturer(page, nom, UNITE)
}

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), `lecture de service ${chemin}`).toBe(200)
	return (await reponse.json()) as T
}

/** Supprime ce que l'espace porte, dans l'ordre que les `RESTRICT` imposent, puis l'espace lui-même. */
async function viderEspace(requete: APIRequestContext): Promise<void> {
	const filtre = `workspace_id=eq.${ESPACE.id}`
	// Les étapes et les transitions partent avec leur workflow (`ON DELETE CASCADE`) ; le catalogue ne
	// peut partir qu'après les étapes qui le référencent.
	for (const table of ['channels', 'tracks', 'workflows', 'workflow_nodes_catalog']) {
		await requete.delete(rest(`${table}?${filtre}`), { headers: enTetesService() })
	}
	await requete.delete(rest(`workspaces?id=eq.${ESPACE.id}`), { headers: enTetesService() })
}

async function monter(requete: APIRequestContext): Promise<Compte> {
	await viderEspace(requete)
	const compte = await creerCompteJetable('flottant', 'Guide', 'Flottant')
	const workspace = await requete.post(rest('workspaces'), {
		headers: enTetesService(),
		data: [{ id: ESPACE.id, name: 'Sonde 094 — guide flottant', slug: ESPACE.slug }],
	})
	expect(workspace.status(), `l'espace neuf doit être créé : ${await workspace.text()}`).toBe(201)
	const attente = await requete.post(rest('workspace_invitations'), {
		headers: enTetesService(),
		data: [{ workspace_id: ESPACE.id, email: compte.adresse, role: 'admin' }],
	})
	expect(attente.status(), 'le compte doit être attendu comme administrateur de son espace').toBe(201)
	return compte
}

async function demonter(requete: APIRequestContext, compte: Compte | null): Promise<void> {
	await viderEspace(requete)
	if (compte !== null) {
		// Le profil est né du `sub` à la connexion : il part avec ses sessions serveur.
		const profil = await requete.delete(rest(`profiles?id=eq.${compte.sub}`), { headers: enTetesService() })
		expect(profil.status(), 'le profil du compte jetable doit être supprimé').toBe(204)
		await supprimerCompte(compte.sub)
	}
	expect(
		await lireService<{ id: string }[]>(requete, 'workspaces?select=id'),
		'la base doit être rendue à son unique workspace seedé (CRM-005)',
	).toEqual([{ id: WORKSPACE_SEED }])
}

/** Avance à la tabulation jusqu'à `cible`, sans souris, et échoue si elle n'est jamais atteinte. */
async function tabulerJusqua(page: Page, cible: ReturnType<Page['getByTestId']>): Promise<void> {
	for (let saut = 0; saut < 120; saut += 1) {
		if (await cible.evaluate((noeud) => noeud === document.activeElement).catch(() => false)) return
		await page.keyboard.press('Tab')
	}
	await expect(cible).toBeFocused()
}

test.describe.configure({ mode: 'serial' })

test.describe('CRM-094 — le guide flottant, dans un espace neuf', () => {
	let compte: Compte | null = null

	test.beforeAll(async ({ request }) => {
		compte = await monter(request)
	})
	test.afterAll(async ({ request }) => {
		await demonter(request, compte)
	})

	test('de l’accueil au premier channel : la pastille suit l’administrateur, et le geste débloque le channel', async ({
		page,
		request,
	}) => {
		test.setTimeout(150_000)
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)

		// 1. L'accueil rend le guide DANS la page : la pastille n'y paraît pas, le même contenu y serait
		//    deux fois (§10.2, « Où »). Six étapes, une seule accomplie — par la connexion.
		await page.goto('/')
		await expect(page.getByTestId('guide-demarrage')).toBeVisible()
		await expect(page.getByTestId('progression-demarrage')).toHaveText('1 étape(s) sur 6')
		await expect(page.getByTestId('guide-demarrage').locator('ol > li')).toHaveCount(6)
		await expect(pastille(page)).toHaveCount(0)
		await capturer(page, 'accueil-espace-neuf-1440', UNITE)

		// 2. « Quand on clique, on le perd » : on suit le lien d'une étape — le guide suit, en pastille.
		await page.getByTestId('lien-track').click()
		await expect(page).toHaveURL(/\/reglages\/arborescence$/)
		await expect(pastille(page)).toHaveAccessibleName('Démarrage · 1 sur 6')
		await expect(pastille(page)).toHaveAttribute('aria-expanded', 'false')
		await capturer(page, 'pastille-reduite-1440', UNITE)

		// 3. Ouverte : le panneau au-dessus d'elle, le focus sur son titre, la forme retenue pour la session.
		await pastille(page).click()
		await expect(panneau(page)).toBeVisible()
		await expect(panneau(page).getByRole('heading', { name: 'Démarrage' })).toBeFocused()
		await expect(panneau(page).locator('ol > li')).toHaveCount(6)
		await expect(panneau(page).getByTestId('progression-demarrage')).toHaveText('1 étape(s) sur 6')
		await expect(panneau(page).getByTestId('etape-workflow')).toContainText('À faire')
		expect(await page.evaluate((cle) => globalThis.sessionStorage.getItem(cle), CLE_FORME)).toBe('ouvert')
		await capturerPanneau(page, 'panneau-ouvert-espace-neuf-1440')

		// 4. Non modal : panneau ouvert, la page reste utilisable — le premier track naît par l'écran.
		await page.getByRole('button', { name: 'Nouveau track' }).click()
		const formTrack = page.getByTestId('formulaire-track')
		await formTrack.getByLabel('Nom').fill(TRACK.nom)
		await expect(formTrack.getByLabel('Slug')).toHaveValue(TRACK.slug)
		await formTrack.getByRole('button', { name: 'Créer' }).click()
		await expect(formTrack).toBeHidden()

		// 5. Le défaut d'origine, tel que le responsable l'a vécu : sans workflow, aucun channel ne peut
		//    naître. Le formulaire le dit — et mène désormais à l'éditeur (§10.5).
		await page.getByRole('button', { name: `Déplier ${TRACK.nom}` }).click()
		await page.getByRole('button', { name: 'Nouveau channel' }).click()
		const sansWorkflow = page.getByTestId('formulaire-channel').getByTestId('admin-sans-workflow')
		await expect(sansWorkflow).toBeVisible()
		await expect(page.getByTestId('formulaire-channel').getByLabel('Workflow')).toHaveCount(0)
		await capturerPanneau(page, 'channel-sans-workflow-1440')

		// 6. Le formulaire mène à l'éditeur, et le panneau suit OUVERT — un lien suivi ne le referme pas.
		//    Re-mesuré au changement de page, sans rechargement : le track compte (§10.2).
		await sansWorkflow.getByRole('link', { name: 'Ouvrir l’éditeur de workflows' }).click()
		await expect(page).toHaveURL(/\/reglages\/workflows$/)
		await expect(page.getByText('Aucun workflow dans cet espace de travail')).toBeVisible()
		await expect(panneau(page)).toBeVisible()
		await expect(panneau(page).getByTestId('progression-demarrage')).toHaveText('2 étape(s) sur 6')
		await expect(pastille(page)).toHaveAccessibleName('Démarrage · 2 sur 6')
		await capturerPanneau(page, 'editeur-vide-panneau-ouvert-1440')

		// 7. Le geste, depuis le panneau, PAR-DESSUS l'éditeur (§10.3).
		await panneau(page).getByTestId('creer-workflow-depart').click()
		await expect(panneau(page).getByTestId('etape-workflow')).toContainText('Fait')
		await expect(panneau(page).getByTestId('progression-demarrage')).toHaveText('3 étape(s) sur 6')
		await expect(panneau(page).getByTestId('annonce-demarrage')).toHaveText('Workflow de départ créé')
		await expect(panneau(page).getByTestId('creer-workflow-depart')).toHaveCount(0)
		// Le bouton qui a agi a disparu : le focus est sur le lien de sa ligne, jamais sur le document.
		await expect(panneau(page).getByTestId('lien-workflow')).toBeFocused()
		// L'éditeur, dessous, s'est RELU sans être remonté : le workflow posé est choisi, ses sept étapes
		// rendues (décision 607). Avant, il affirmait encore qu'aucun workflow n'existait.
		await expect(page.getByText('Aucun workflow dans cet espace de travail')).toHaveCount(0)
		await expect(page.getByTestId('ligne-etape')).toHaveCount(7)
		await capturerPanneau(page, 'editeur-relu-apres-geste-1440')

		// L'effet en base, relu par la clé de service : ce que l'écran annonce est ce qui est posé.
		const workflows = await lireService<{ id: string; name: string; is_default: boolean; scope: string }[]>(
			request,
			`workflows?workspace_id=eq.${ESPACE.id}&select=id,name,is_default,scope`,
		)
		expect(workflows).toEqual([expect.objectContaining({ name: 'Cycle commercial', is_default: true, scope: 'global' })])
		const idWorkflow = workflows[0]?.id ?? ''
		expect(await lireService<unknown[]>(request, `workflow_steps?workflow_id=eq.${idWorkflow}&select=id`)).toHaveLength(7)
		expect(await lireService<unknown[]>(request, `workflow_transitions?workflow_id=eq.${idWorkflow}&select=id`)).toHaveLength(11)

		// 8. Le lien « Créer un channel » du panneau ramène à l'arborescence — le panneau toujours ouvert.
		await panneau(page).getByTestId('lien-channel').click()
		await expect(page).toHaveURL(/\/reglages\/arborescence$/)
		await expect(panneau(page)).toBeVisible()
		await expect(panneau(page).getByTestId('progression-demarrage')).toHaveText('3 étape(s) sur 6')

		// 9. Le premier channel NAÎT, sur le workflow posé — ce qui était impossible (décision 606).
		await page.getByRole('button', { name: `Déplier ${TRACK.nom}` }).click()
		await page.getByRole('button', { name: 'Nouveau channel' }).click()
		const creation = page.getByTestId('formulaire-channel')
		await creation.getByLabel('Nom').fill(CHANNEL.nom)
		await expect(creation.getByLabel('Slug')).toHaveValue(CHANNEL.slug)
		await creation.getByLabel('Workflow').selectOption({ label: 'Cycle commercial (par défaut)' })
		await creation.getByRole('button', { name: 'Créer' }).click()
		await expect(creation).toBeHidden()
		await expect(
			page.getByRole('list', { name: `Channels du track ${TRACK.nom}` }).getByText(CHANNEL.nom, { exact: true }),
		).toBeVisible()
		expect(
			await lireService<{ slug: string; workflow_id: string }[]>(
				request,
				`channels?workspace_id=eq.${ESPACE.id}&select=slug,workflow_id`,
			),
		).toEqual([{ slug: CHANNEL.slug, workflow_id: idWorkflow }])

		// 10. Page suivante, sans rechargement : la progression est RE-MESURÉE — le channel compte.
		await panneau(page).getByTestId('lien-messagerie').click()
		await expect(page).toHaveURL(/\/reglages\/messagerie$/)
		await expect(panneau(page).getByTestId('progression-demarrage')).toHaveText('4 étape(s) sur 6')
		await expect(panneau(page).getByTestId('etape-channel')).toContainText('Fait')
		await expect(pastille(page)).toHaveAccessibleName('Démarrage · 4 sur 6')
		await capturerPanneau(page, 'panneau-remesure-1440')

		// 11. Réduire rend le focus à la pastille, et efface la forme ; rien n'a touché `localStorage`.
		await panneau(page).getByTestId('reduire-guide-flottant').click()
		await expect(panneau(page)).toHaveCount(0)
		await expect(pastille(page)).toBeFocused()
		const stockage = await page.evaluate(
			(cle) => ({ forme: globalThis.sessionStorage.getItem(cle), locale: globalThis.localStorage.length }),
			CLE_FORME,
		)
		expect(stockage).toEqual({ forme: null, locale: 0 })
	})

	test('au clavier seul : atteindre la pastille, ouvrir, suivre un lien sans perdre le panneau, refermer', async ({
		page,
	}) => {
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await page.goto('/contacts')
		await expect(pastille(page)).toHaveAccessibleName('Démarrage · 4 sur 6')

		// Du haut du document jusqu'à la pastille, à la tabulation : aucune souris.
		await page.locator('body').press('Tab')
		await tabulerJusqua(page, pastille(page))
		await page.keyboard.press('Enter')
		await expect(panneau(page).getByRole('heading', { name: 'Démarrage' })).toBeFocused()

		// Du titre au lien d'une étape, puis `Entrée` : la page change, le panneau reste.
		await tabulerJusqua(page, panneau(page).getByTestId('lien-track'))
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/reglages\/arborescence$/)
		await expect(panneau(page)).toBeVisible()

		// `Échap` referme, et rend le focus à la pastille (§10.2, docs/DESIGN_SYSTEM.md §5.49).
		await page.keyboard.press('Escape')
		await expect(panneau(page)).toHaveCount(0)
		await expect(pastille(page)).toBeFocused()
		await expect(pastille(page)).toHaveAttribute('aria-expanded', 'false')
	})

	test('les quatre paliers, réduite puis ouverte, sur un écran chargé : cadre, réserve, aucun débordement', async ({
		page,
	}) => {
		test.setTimeout(120_000)
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			// L'éditeur, qui porte désormais le workflow posé et ses sept étapes : un écran CHARGÉ (§10.6).
			await page.goto('/reglages/workflows')
			await expect(page.getByTestId('ligne-etape').first()).toBeVisible()
			await expect(pastille(page)).toHaveAccessibleName('Démarrage · 4 sur 6')

			// Sous `md`, le libellé visible se réduit à « 4/6 » — le nom accessible reste entier.
			const court = pastille(page).getByText('4/6', { exact: true })
			if (palier.largeur < 768) await expect(court).toBeVisible()
			else await expect(court).toBeHidden()

			// Le cadre de la pastille est DANS la fenêtre, des deux côtés (docs/DESIGN_SYSTEM.md §5.43).
			const cadre = await pastille(page).boundingBox()
			expect(cadre, `pastille rendue à ${palier.nom}`).not.toBeNull()
			if (cadre === null) return
			expect(cadre.x, `bord gauche de la pastille à ${palier.nom}`).toBeGreaterThanOrEqual(0)
			expect(cadre.x + cadre.width, `bord droit de la pastille à ${palier.nom}`).toBeLessThanOrEqual(palier.largeur)
			expect(cadre.height, `cible de la pastille à ${palier.nom}`).toBeGreaterThanOrEqual(40)
			// La réserve au bas de la zone principale : la hauteur de la pastille plus son écart au bord.
			const reserve = await page.getByTestId('reserve-guide-flottant').boundingBox()
			expect(reserve?.height, `réserve sous la pastille à ${palier.nom}`).toBe(56)
			await capturer(page, `pastille-reduite-${palier.nom}`, UNITE)

			await pastille(page).click()
			await expect(panneau(page)).toBeVisible()
			const cadrePanneau = await panneau(page).boundingBox()
			expect(cadrePanneau, `panneau rendu à ${palier.nom}`).not.toBeNull()
			if (cadrePanneau === null) return
			expect(cadrePanneau.x, `bord gauche du panneau à ${palier.nom}`).toBeGreaterThanOrEqual(0)
			expect(cadrePanneau.x + cadrePanneau.width, `bord droit du panneau à ${palier.nom}`).toBeLessThanOrEqual(
				palier.largeur,
			)
			expect(cadrePanneau.y, `bord haut du panneau à ${palier.nom}`).toBeGreaterThanOrEqual(0)
			const deborde = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(deborde, `la page ne doit pas défiler horizontalement à ${palier.nom}`).toBe(false)
			await capturerPanneau(page, `panneau-ouvert-${palier.nom}`)
			await panneau(page).getByTestId('reduire-guide-flottant').click()
			await expect(panneau(page)).toHaveCount(0)
		}
	})
})

test.describe('CRM-094 — à qui la pastille ne paraît pas', () => {
	/**
	 * Les comptages DU GUIDE : des `HEAD` sur ses six tables (`webapp/src/lib/demarrage.ts`).
	 *
	 * Deux pièges MESURÉS le 2026-09-28, et le compteur est écrit contre chacun. La cloche compte elle
	 * aussi en `HEAD`, sur `notifications` : le filtre nomme donc les tables, pas la seule méthode. Et
	 * la connexion aboutit sur l'accueil, dont le guide DANS la page mesure ces mêmes tables : une réponse
	 * tardive de l'accueil — `cards`, la plus lente — arrivait après la pose du compteur. Il compte donc
	 * les requêtes ÉMISES après sa pose, et seulement leurs réponses, l'accueil s'étant tu d'abord.
	 */
	const TABLES_DU_GUIDE = /\/rest\/v1\/(workspaces|tracks|workflows|channels|cards|mail_inbound_accounts)\?/
	async function compterMesures(page: Page): Promise<{ readonly emises: () => number; readonly rendues: () => number }> {
		await page.waitForLoadState('networkidle')
		const emises = new Set<Request>()
		let rendues = 0
		page.on('request', (requete) => {
			if (requete.method() === 'HEAD' && TABLES_DU_GUIDE.test(requete.url())) emises.add(requete)
		})
		// `response` et non `requestfinished` : MESURÉ, ce dernier ne part pas pour ces `HEAD` sans corps.
		page.on('response', (reponse) => {
			if (emises.has(reponse.request())) rendues += 1
		})
		return { emises: () => emises.size, rendues: () => rendues }
	}

	test('la lectrice : aucune pastille, et AUCUNE mesure émise pour elle', async ({ page }) => {
		// Le rôle rendu par la base décide d'un affichage (§10.2) : la lectrice garde le guide dans la page
		// et dans les réglages, sans pastille — et la coquille ne mesure rien qu'elle n'afficherait pas.
		await connecterAvecLeLabs(page, VIEWER_SEED)
		const mesures = await compterMesures(page)
		const role = page.waitForResponse((reponse) => reponse.url().includes('/rest/v1/rpc/mon_role_espace'))
		await page.goto('/contacts')
		expect((await role).status()).toBe(200)
		await page.waitForLoadState('networkidle')
		await expect(pastille(page)).toHaveCount(0)
		expect(mesures.emises(), 'aucun comptage du guide pour un rôle qui ne voit pas la pastille').toBe(0)
	})

	test('l’administratrice du seed : six étapes accomplies, la pastille ne paraît pas', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN_SEED)
		const mesures = await compterMesures(page)
		await page.goto('/contacts')
		// Les six comptages rendus, tous accomplis : rien n'est rendu — ni pendant, ni après (§10.2, « Quand »).
		await expect.poll(() => mesures.rendues(), { timeout: 30_000 }).toBe(6)
		await page.waitForLoadState('networkidle')
		await expect(pastille(page)).toHaveCount(0)
		// Une seule mesure : le rôle résolu rend le guide actif, et il ne relance pas ce qui part déjà.
		expect(mesures.emises()).toBe(6)
	})
})
