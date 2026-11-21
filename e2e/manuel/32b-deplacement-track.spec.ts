// @spec CRM-162 (docs/BACKLOG.md) — tranche T3 : les images de « Déplacer un track vers un autre espace » (docs/manual.md
//       §32.6 bis ; docs/SPEC-manual.md §11.1, §12 ; docs/SPEC-deplacement-track.md §4, §5, §13 ; docs/DESIGN_SYSTEM.md
//       §5.112)
//
// Sabine Roux est la superadministratrice du seed. Le refus vient du seed tel qu'il est : « Formation » vers « Studio
// Lumen » (docs/SPEC-seed.md §54). L'aperçu et le succès se jouent sur des objets jetables — l'espace « Filiale Sud » créé par
// la fonction de la plateforme, Camille son administratrice, et le track « Événements » de l'espace du seed — : un vrai
// déplacement créerait des référentiels à l'arrivée, qui y resteraient (§11 de la spécification), et « Studio Lumen » doit
// rester tel que le seed le pose. Le track revient, puis tout est retiré, même si le test s'arrête avant.

import { type APIRequestContext, expect, test } from '@playwright/test'
import { enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { illustrer } from './illustrer'
import { ADMIN, WORKFLOW_GLOBAL, WORKSPACE_SEED, connecterAvecLeLabs, rest } from './outils'

const CHAPITRE = 'la-plateforme-espaces-membres-et-superadministrateurs'
const SECTION = 'deplacer-un-track-vers-un-autre-espace'
const SABINE = 'plateforme@p2enjoy.test'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const ARRIVEE = { nom: 'Filiale Sud', slug: 'filiale-sud' } as const
const TRACK = { nom: 'Événements', slug: 'evenements' } as const

test.describe.configure({ mode: 'serial' })

let idAffaire = ''

const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })
const rpc = async (requete: APIRequestContext, adresse: string, nom: string, corps: object) =>
	requete.post(rest(`rpc/${nom}`), { headers: json(enTetesAuthentifies(await jetonDe(adresse))), data: corps })
const lire = async <T>(requete: APIRequestContext, chemin: string): Promise<T> =>
	(await (await requete.get(rest(chemin), { headers: enTetesService() })).json()) as T

/** Ramène le track jetable dans l'espace du seed, le retire avec son channel et son affaire, puis retire l'espace jetable. */
async function nettoyer(requete: APIRequestContext): Promise<void> {
	for (const t of await lire<{ id: string; workspace_id: string }[]>(requete, `tracks?slug=eq.${TRACK.slug}&select=id,workspace_id`)) {
		if (t.workspace_id !== WORKSPACE_SEED) {
			await rpc(requete, SABINE, 'move_track', { p_track_id: t.id, p_target_workspace_id: WORKSPACE_SEED, p_confirm_name: TRACK.nom })
		}
		const canaux = await lire<{ id: string }[]>(requete, `channels?track_id=eq.${t.id}&select=id`)
		if (canaux.length > 0) {
			const rattachements = await lire<{ card_id: string }[]>(requete, `card_placements?channel_id=in.(${canaux.map((c) => c.id).join(',')})&select=card_id`)
			const cartes = rattachements.map((r) => r.card_id)
			if (cartes.length > 0) await requete.delete(rest(`cards?id=in.(${cartes.join(',')})`), { headers: enTetesService() })
		}
		await requete.delete(rest(`channels?track_id=eq.${t.id}`), { headers: enTetesService() })
		await requete.delete(rest(`tracks?id=eq.${t.id}`), { headers: enTetesService() })
	}
	const [espace] = await lire<{ id: string }[]>(requete, `workspaces?slug=eq.${ARRIVEE.slug}&select=id`)
	if (espace !== undefined) await rpc(requete, SABINE, 'plateforme_supprimer_espace', { p_id: espace.id, p_slug_confirme: ARRIVEE.slug })
}

test.beforeAll(async ({ request }) => {
	await nettoyer(request)
	const creation = await rpc(request, SABINE, 'plateforme_creer_espace', { p_nom: ARRIVEE.nom, p_slug: ARRIVEE.slug, p_domaine_entrant: null })
	expect(creation.ok(), await creation.text()).toBe(true)
	const [espace] = await lire<{ id: string }[]>(request, `workspaces?slug=eq.${ARRIVEE.slug}&select=id`)
	const membre = await rpc(request, SABINE, 'plateforme_poser_membre', { p_ws: espace!.id, p_user: CAMILLE, p_role: 'admin' })
	expect(membre.ok(), await membre.text()).toBe(true)
	const service = json({ ...enTetesService(), Prefer: 'return=representation' })
	const t = await request.post(rest('tracks'), { headers: service, data: { workspace_id: WORKSPACE_SEED, name: TRACK.nom, slug: TRACK.slug, position: 90 } })
	expect(t.status(), await t.text()).toBe(201)
	const idTrack = ((await t.json()) as { id: string }[])[0]!.id
	const c = await request.post(rest('channels'), {
		headers: service,
		data: { workspace_id: WORKSPACE_SEED, track_id: idTrack, name: 'Salons', slug: 'salons', workflow_id: WORKFLOW_GLOBAL, position: 1 },
	})
	expect(c.status(), await c.text()).toBe(201)
	const idChannel = ((await c.json()) as { id: string }[])[0]!.id
	const affaire = await rpc(request, ADMIN, 'creer_affaire', { p_channel: idChannel, p_titre: 'Salon du numérique — stand 2027' })
	expect(affaire.status(), await affaire.text()).toBe(200)
	idAffaire = (await affaire.json()) as string
})

test.afterAll(async ({ request }) => {
	await nettoyer(request)
})

const ligne = (page: import('@playwright/test').Page, nom: string) => page.getByTestId('ligne-track').filter({ hasText: nom })
const bloc = (page: import('@playwright/test').Page) => page.getByTestId('bloc-deplacement')

async function ouvrir(page: import('@playwright/test').Page, track: string, arrivee: string): Promise<void> {
	await ligne(page, track).getByRole('button', { name: `Déplacer le track ${track} vers un autre espace` }).click()
	await bloc(page).getByLabel('Espace d’arrivée').selectOption({ label: arrivee })
	await expect(bloc(page).getByTestId('apercu-deplacement')).toBeVisible()
}

test('le bloc « Tracks », un déplacement refusé, l’aperçu, puis le déplacement fait', async ({ page }) => {
	await connecterAvecLeLabs(page, SABINE)
	await page.goto('/plateforme/espaces/p2enjoy')
	const tracks = page.getByTestId('bloc-tracks')
	await expect(ligne(page, TRACK.nom)).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: SECTION, nom: 'tracks', cibles: [tracks] })

	// Le seed : « Formation » ne part pas pour « Studio Lumen » — Driss n'y est pas membre, et « Budget du client » y est un texte.
	await ouvrir(page, 'Formation', 'Studio Lumen')
	const refus = bloc(page).getByTestId('refus-deplacement')
	await expect(refus).toContainText('Personnes qui ne sont pas membres de Studio Lumen')
	await expect(refus).toContainText('Budget du client')
	await expect(bloc(page).getByTestId('confirmer-deplacement')).toHaveCount(0)
	await illustrer(page, { chapitre: CHAPITRE, section: SECTION, nom: 'refus-deplacement', cibles: [refus] })
	await bloc(page).getByRole('button', { name: 'Annuler' }).click()

	await ouvrir(page, TRACK.nom, ARRIVEE.nom)
	await bloc(page).getByTestId('saisie-nom-track').fill(TRACK.nom)
	await expect(bloc(page).getByTestId('confirmer-deplacement')).toBeEnabled()
	// Le bloc entier dépasse la fenêtre : l'aperçu d'une part, la saisie du nom et la commande d'autre part.
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: SECTION,
		nom: 'apercu-deplacement',
		cibles: [
			bloc(page).getByText('Espace d’arrivée', { exact: true }),
			bloc(page).getByLabel('Espace d’arrivée'),
			bloc(page).getByTestId('apercu-deplacement'),
		],
	})
	// La commande est centrée : amenée seule dans la vue, elle se collerait au bord bas de la fenêtre.
	await bloc(page).getByTestId('confirmer-deplacement').evaluate((e) => e.scrollIntoView({ block: 'center' }))
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: SECTION,
		nom: 'saisie-nom-track',
		cibles: [
			bloc(page).getByText('Saisissez le nom du track pour confirmer'),
			bloc(page).getByTestId('saisie-nom-track'),
			bloc(page).getByTestId('confirmer-deplacement'),
		],
	})

	await bloc(page).getByTestId('confirmer-deplacement').click()
	const message = page.getByTestId('message-tracks')
	await expect(message).toContainText(`Track « ${TRACK.nom} » déplacé vers ${ARRIVEE.nom}.`)
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: SECTION,
		nom: 'deplacement-fait',
		cibles: [message, message.getByRole('link', { name: `Ouvrir la fiche de ${ARRIVEE.nom}` })],
	})

	await page.goto('/plateforme/journal')
	const geste = page.getByTestId('ligne-journal').filter({ hasText: `« ${TRACK.nom} »` }).first()
	await expect(geste).toContainText('Track déplacé')
	await illustrer(page, { chapitre: CHAPITRE, section: SECTION, nom: 'journal-deplacement', cibles: [geste] })
})

// Un autre compte, une autre page : l'affaire n'est lue que de ses membres — Camille, à l'arrivée.
test('l’historique de l’affaire déplacée', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/${ARRIVEE.slug}/tracks/${TRACK.slug}/salons/cards/${idAffaire}`)
	const evenement = page.getByText('Déplacée avec son track')
	await expect(evenement).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: SECTION, nom: 'historique-deplacement', cibles: [evenement] })
})
