// @verifies CRM-033 (docs/BACKLOG.md) — cohérence workflow ↔ channel, les deux preuves d'interface
// @verifies docs/SPEC-workflow-engine.md §4.12.9 (contrat de ces deux preuves), §4.12.2 (la règle),
//           §4.12.3 (le trigger sur `channels`), §4.12.4 (un workflow `track` libre est déplaçable)
// @verifies docs/SPEC-administration-arborescence.md §7.2 (le sélecteur), §9 (les refus)
// @verifies CLAUDE.md §10 (la règle est tenue par la base, jamais par l'écran), §16 (captures)
//
// POURQUOI CE FICHIER EXISTE, ALORS QUE `e2e/api/coherence-workflow.spec.ts` COUVRE DÉJÀ LA RÈGLE.
// Les treize lignes du §4.12.6 établissent que la BASE refuse. Elles ne peuvent rien dire des deux
// endroits où l'ÉCRAN rencontre la règle : ce qu'il propose, et ce qu'il fait d'un refus qu'il n'a
// pas su prévenir. Ce fichier ne rejoue donc aucune de ces treize lignes.
//
// Le §4.12.8 a longtemps porté « Interface : aucune », au motif que la webapp restait un appelant
// anonyme (INC-021). INC-021 est close depuis le 2026-08-07, et l'écran d'affectation existe depuis
// `CRM-075` : le motif est caduc, et ces preuves sont dues.
//
// CE QUE CE FICHIER REND À LA BASE. Le second scénario crée un workflow de portée `track` pour
// jouer la course du §7.2. Il le supprime par la clé de service dans son `finally`, comme
// `e2e/ui/administration-arborescence.spec.ts` le fait de ses tracks et de ses channels depuis
// INC-099 (règle de la décision 362). Le nettoyage est fait AUSSI à l'entrée : une exécution tuée
// avant son `finally` ne doit pas faire échouer la suivante.

import { expect, test, type Page } from './fixtures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'

const UNITE = 'CRM-033'
const ADMIN = 'admin@p2enjoy.test'

/** Les deux tracks du seed qui rendent la règle démontrable — docs/SPEC-seed.md, section tracks.
 *
 * `Conseil & IA` porte la copie de portée `track` posée par `CRM-032` ; `Studio web` n'en porte
 * aucune. Le couple est donc exactement celui dont le §4.12.9.1 a besoin : un track qui voit son
 * propre workflow `track`, et un track qui ne doit PAS voir celui du voisin. */
const TRACK_CONSEIL = 'Conseil & IA'
const TRACK_STUDIO = 'Studio web'

/** Les libellés que le sélecteur rend, tels que `admin.form.workflow.default` les compose. */
const OPTION_VIDE = 'Choisir un workflow…'
const OPTION_GLOBALE = 'Cycle commercial standard (par défaut)'
const OPTION_CONSEIL = 'Cycle commercial — Conseil IA'

const CHEMIN_WORKFLOWS = `${URL_API}/rest/v1/workflows`
const CHEMIN_CHANNELS = `${URL_API}/rest/v1/channels`
const CHEMIN_TRACKS = `${URL_API}/rest/v1/tracks`

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Les libellés du sélecteur de workflow, dans l'ordre du DOM — donc l'ordre affiché. */
async function optionsWorkflow(page: Page): Promise<string[]> {
	return page.getByTestId('formulaire-channel').getByLabel('Workflow').locator('option').allTextContents()
}

/** Ouvre le formulaire de création de channel sous `nomTrack`, depuis l'écran d'administration.
 *
 * La commande « Nouveau channel » est portée par CHAQUE track déplié : deux tracks ouverts en même
 * temps la rendraient ambiguë. La preuve qui en visite deux replie donc le premier avant d'ouvrir
 * le second — geste qu'un administrateur fait, et qui garde la désignation exacte. */
async function ouvrirCreationChannel(page: Page, nomTrack: string): Promise<void> {
	await page.getByRole('button', { name: `Déplier ${nomTrack}` }).click()
	await expect(page.getByRole('list', { name: `Channels du track ${nomTrack}` })).toBeVisible()
	await page.getByRole('button', { name: 'Nouveau channel' }).click()
	await expect(page.getByTestId('formulaire-channel')).toBeVisible()
}

/** Rend la valeur, ou échoue en la NOMMANT.
 *
 * `noUncheckedIndexedAccess` est actif (`tsconfig.json`) : une ligne cherchée dans une réponse
 * d'API est toujours `T | undefined`. Un `!` ferait taire le compilateur sans rien dire au lecteur
 * du rapport ; ce passage explicite transforme l'absence en un échec qui nomme ce qui manque —
 * presque toujours un seed non appliqué. */
function exigerDefini<T>(valeur: T | undefined, nom: string): T {
	expect(valeur, nom).toBeDefined()
	if (valeur === undefined) throw new Error(`${nom} : absent`)
	return valeur
}

/** Referme le bloc d'un track déplié. */
async function replierTrack(page: Page, nomTrack: string): Promise<void> {
	await page.getByRole('button', { name: `Replier ${nomTrack}` }).click()
	await expect(page.getByRole('list', { name: `Channels du track ${nomTrack}` })).toHaveCount(0)
}

// -------------------------------------------------------------------------------------------
// §4.12.9.1 — le sélecteur ne propose QUE les affectables
// -------------------------------------------------------------------------------------------

test.describe('le sélecteur de workflow (docs/SPEC-workflow-engine.md §4.12.9.1)', () => {
	test("un workflow de portée track n'est proposé que sous SON track", async ({ page }) => {
		await connecter(page)
		await page.goto('/reglages/arborescence')
		await expect(page.getByRole('heading', { name: "Administration de l'arborescence" })).toBeVisible()

		// --- Le track qui porte la copie de portée `track` -----------------------------------
		await ouvrirCreationChannel(page, TRACK_CONSEIL)
		// ÉGALITÉ et non présence : « Conseil IA est absent » serait tenu par un sélecteur vide ou
		// cassé (§4.12.9.1). La liste entière est comparée, dans l'ordre `is_default.desc,name`.
		await expect.poll(async () => optionsWorkflow(page)).toEqual([
			OPTION_VIDE,
			OPTION_GLOBALE,
			OPTION_CONSEIL,
		])

		// Aucun défaut n'est présélectionné (§7.2, §4.12.5) : c'est l'option vide qui est retenue.
		await expect(page.getByTestId('formulaire-channel').getByLabel('Workflow')).toHaveValue('')

		// La capture est prise APRÈS le choix du workflow de portée `track`. Un `<select>` natif
		// rend sa liste par le système, hors de la fenêtre : capturé fermé sur l'option vide, il ne
		// montrerait rien de ce que le scénario mesure. Fermé sur l'option CHOISIE, il montre qu'un
		// administrateur peut réellement affecter ce workflow ici (§4.12.9.1).
		await page.getByTestId('formulaire-channel').getByLabel('Workflow').selectOption({ label: OPTION_CONSEIL })
		await capturer(page, 'selecteur-workflow-track-porteur', UNITE)

		await page.getByTestId('formulaire-channel').getByRole('button', { name: 'Annuler' }).click()
		await expect(page.getByTestId('formulaire-channel')).toBeHidden()
		await replierTrack(page, TRACK_CONSEIL)

		// --- Le track voisin, qui ne doit PAS voir le workflow du premier ---------------------
		await ouvrirCreationChannel(page, TRACK_STUDIO)
		await expect.poll(async () => optionsWorkflow(page)).toEqual([OPTION_VIDE, OPTION_GLOBALE])
		// Même geste, et il ne peut mener qu'ailleurs : le seul workflow choisissable ici est le
		// global. La comparaison des deux captures montre la différence que l'égalité mesure.
		await page.getByTestId('formulaire-channel').getByLabel('Workflow').selectOption({ label: OPTION_GLOBALE })
		await capturer(page, 'selecteur-workflow-track-voisin', UNITE)
	})
})

// -------------------------------------------------------------------------------------------
// §4.12.9.2 — le refus tient hors de l'écran : la course du §7.2, reproduite
// -------------------------------------------------------------------------------------------

test.describe('le refus quand la liste est périmée (docs/SPEC-workflow-engine.md §4.12.9.2)', () => {
	test("un workflow déplacé sous le formulaire ouvert fait refuser la création par la base", async ({
		page,
		request,
	}) => {
		const slugChannel = 'e2e-course-workflow'
		const nomChannel = 'E2E Course Workflow'
		const nomWorkflow = 'E2E Course — workflow de track'

		/** Purge d'entrée ET de sortie : une exécution tuée avant son `finally` ne doit pas faire
		 * échouer celle-ci sur un `23505`, ni laisser une ligne derrière elle (INC-099). */
		const purger = async (): Promise<void> => {
			await request.delete(`${CHEMIN_CHANNELS}?slug=eq.${slugChannel}`, { headers: enTetesService() })
			await request.delete(`${CHEMIN_WORKFLOWS}?name=eq.${encodeURIComponent(nomWorkflow)}`, {
				headers: enTetesService(),
			})
		}
		await purger()

		try {
			// --- Le workflow `track` de la course, posé sur Studio web -------------------------
			const tracks = await request.get(
				`${CHEMIN_TRACKS}?select=id,workspace_id,name&name=in.(${encodeURIComponent(
					`"${TRACK_STUDIO}","${TRACK_CONSEIL}"`,
				)})`,
				{ headers: enTetesService() },
			)
			expect(tracks.status(), 'les deux tracks du seed sont lisibles').toBe(200)
			const lignes = (await tracks.json()) as ReadonlyArray<{
				id: string
				workspace_id: string
				name: string
			}>
			const studio = exigerDefini(
				lignes.find((ligne) => ligne.name === TRACK_STUDIO),
				`le track « ${TRACK_STUDIO} » du seed`,
			)
			const conseil = exigerDefini(
				lignes.find((ligne) => ligne.name === TRACK_CONSEIL),
				`le track « ${TRACK_CONSEIL} » du seed`,
			)

			const creation = await request.post(CHEMIN_WORKFLOWS, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workspace_id: studio.workspace_id,
					track_id: studio.id,
					name: nomWorkflow,
					scope: 'track',
					is_default: false,
				},
			})
			expect(creation.status(), 'le workflow de la course est créé').toBe(201)
			const [ligneCreee] = (await creation.json()) as ReadonlyArray<{ id: string }>
			const workflow = exigerDefini(ligneCreee, 'la représentation du workflow créé')

			// --- L'administrateur le voit, et le choisit --------------------------------------
			await connecter(page)
			await page.goto('/reglages/arborescence')
			await ouvrirCreationChannel(page, TRACK_STUDIO)
			const formulaire = page.getByTestId('formulaire-channel')
			await expect.poll(async () => optionsWorkflow(page)).toEqual([
				OPTION_VIDE,
				OPTION_GLOBALE,
				nomWorkflow,
			])
			await formulaire.getByLabel('Nom').fill(nomChannel)
			await expect(formulaire.getByLabel('Slug')).toHaveValue(slugChannel)
			await formulaire.getByLabel('Workflow').selectOption({ label: nomWorkflow })

			// --- Le workflow change de track SOUS le formulaire ouvert -------------------------
			// Écriture ACCEPTÉE, et c'est le §4.12.4 qui l'exige : « un workflow `track` sans aucun
			// channel change de track librement ». La liste affichée devient périmée — l'état exact
			// que la course du §7.2 produit, obtenu sans rien simuler.
			const deplacement = await request.patch(`${CHEMIN_WORKFLOWS}?id=eq.${workflow.id}`, {
				headers: enTetesService(),
				data: { track_id: conseil.id },
			})
			expect(
				deplacement.status(),
				'un workflow `track` libre change de track librement (§4.12.4)',
			).toBe(204)

			// --- L'envoi est refusé par la base, pas par l'écran --------------------------------
			await formulaire.getByRole('button', { name: 'Créer' }).click()
			const refus = page.getByTestId('admin-refus')
			await expect(refus).toBeVisible()
			await expect(refus).toHaveText("Ce workflow n'est pas affectable à ce track.")
			// Le formulaire RESTE ouvert : le refus se lit près du champ qui l'a causé (§9).
			await expect(formulaire).toBeVisible()
			await capturer(page, 'refus-workflow-hors-track', UNITE)

			// La règle est tenue par la base : aucune ligne n'a été écrite (CLAUDE.md §10).
			const relecture = await request.get(`${CHEMIN_CHANNELS}?slug=eq.${slugChannel}&select=id`, {
				headers: enTetesService(),
			})
			expect(relecture.status()).toBe(200)
			expect(
				await relecture.json(),
				'aucun channel n’est créé, le trigger ayant refusé l’écriture',
			).toEqual([])

			// Le `400` que PostgREST rend est la seule erreur console, et le scénario vient de
			// l'expliquer à l'utilisateur : il est consommé nommément, jamais filtré globalement.
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		} finally {
			await purger()
		}
	})
})
