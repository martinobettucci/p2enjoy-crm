// @verifies CRM-068 (docs/BACKLOG.md) — tranche T2 : un déplacement refusé faute de points de checklist cochés, sur la vraie pile
// @verifies docs/SPEC-checklists.md §3.4 (le refus `checklist_incomplete` et ses points nommés), §4 (le bandeau du board) ;
//           docs/DESIGN_SYSTEM.md §5.7 quinquies ; CLAUDE.md §10 (la règle est en base), §16 (capture observée)
// @verifies CRM-068 (docs/BACKLOG.md) — tranche T3a : le bloc « Checklist » de la fiche et le compte « n/m » du board, sur
//           le jeu du seed (docs/SPEC-checklists.md §4, §6 ; docs/SPEC-seed.md §28 ; docs/DESIGN_SYSTEM.md §5.70) ;
//           cocher, ajouter, retirer sur une affaire jetable, et le fil qui nomme le cochage
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// UN WORKFLOW JETABLE, ET NON CELUI DU SEED : une exigence posée sur le workflow par défaut bloquerait, le temps de la
// preuve, tout déplacement que d'autres specs jouent sur la même pile. L'affaire naît par la vraie fonction
// `creer_affaire` ; tout est retiré à la fin, par la clé de service.

import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'
import { capturer } from './captures'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const TRACK = { id: '5eed0000-0000-4000-8000-000000000022', slug: 'studio-web' }
const NOEUD_PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOEUD_NEGOCIATION = '5eed0000-0000-4000-8000-000000000043'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function inserer(requete: APIRequestContext, table: string, ligne: Record<string, unknown>): Promise<void> {
	const reponse = await requete.post(rest(table), { headers: enTetesService(), data: ligne })
	expect(reponse.status(), `${table} : ${await reponse.text()}`).toBe(201)
}

test.describe('le board refuse un déplacement dont la checklist n’est pas cochée (docs/SPEC-checklists.md §3.4)', () => {
	test('le bandeau nomme le point à cocher ; coché, le déplacement passe', async ({ page, request }) => {
		const ids = {
			workflow: randomUUID(),
			prospection: randomUUID(),
			negociation: randomUUID(),
			transition: randomUUID(),
			channel: randomUUID(),
			point: randomUUID(),
		}
		const slugChannel = `zz-checklist-${ids.channel.slice(0, 8)}`
		await inserer(request, 'workflows', { id: ids.workflow, workspace_id: ESPACE, name: `ZZ checklist ${ids.workflow.slice(0, 8)}`, scope: 'global', is_default: false })
		try {
			await inserer(request, 'workflow_steps', { id: ids.prospection, workflow_id: ids.workflow, workspace_id: ESPACE, node_id: NOEUD_PROSPECTION, position: 1, is_initial: true })
			await inserer(request, 'workflow_steps', { id: ids.negociation, workflow_id: ids.workflow, workspace_id: ESPACE, node_id: NOEUD_NEGOCIATION, position: 2, is_initial: false })
			await inserer(request, 'workflow_transitions', { id: ids.transition, workflow_id: ids.workflow, workspace_id: ESPACE, from_step_id: ids.prospection, to_step_id: ids.negociation, label: 'Négocier' })
			await inserer(request, 'workflow_step_checklist_items', { id: ids.point, workspace_id: ESPACE, workflow_id: ids.workflow, step_id: ids.prospection, label: 'Décideur identifié', position: 1 })
			await inserer(request, 'workflow_transition_required_checklist_items', { transition_id: ids.transition, step_item_id: ids.point })
			await inserer(request, 'channels', { id: ids.channel, workspace_id: ESPACE, track_id: TRACK.id, name: 'ZZ checklist', slug: slugChannel, workflow_id: ids.workflow, position: 99 })
			const jeton = await jetonDe('admin@p2enjoy.test')
			const creation = await request.post(rest('rpc/creer_affaire'), {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { p_channel: ids.channel, p_titre: 'ZZ affaire à qualifier' },
			})
			expect(creation.status(), await creation.text()).toBe(200)
			const carte = (await creation.json()) as string

			await page.setViewportSize({ width: 1440, height: 900 })
			await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
			await page.goto(`/tracks/${TRACK.slug}/${slugChannel}`)
			const laCarte = page.locator(`[data-testid="carte-card"][data-card="${carte}"]`)
			const negociation = page.locator(`[data-testid="colonne"][data-etape="${ids.negociation}"]`)
			await laCarte.dragTo(negociation)

			const bandeau = page.getByTestId('refus-deplacement')
			await expect(bandeau).toHaveAttribute('data-cle', 'checklist_incomplete')
			await expect(bandeau).toContainText('Ces points de la checklist doivent être cochés avant ce déplacement :')
			await expect(bandeau.getByTestId('points-manquants')).toHaveText('Décideur identifié')
			// Retour arrière : la carte est restée en prospection.
			await expect(page.locator(`[data-testid="colonne"][data-etape="${ids.prospection}"]`).locator(`[data-card="${carte}"]`)).toHaveCount(1)
			// Le refus est un `400` de la base, attendu : la console stricte l'accepte nommément.
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
			await capturer(page, 'board-refus-checklist-1440', 'CRM-068')

			// Le point coché par l'API (l'écran de la fiche vient en T3), le même geste passe.
			const coche = await request.patch(rest(`card_checklist_items?card_id=eq.${carte}&step_item_id=eq.${ids.point}`), {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json', Prefer: 'return=representation' },
				data: { checked: true },
			})
			expect(await coche.json()).toHaveLength(1)
			await page.getByTestId('fermer-refus').click()
			await laCarte.dragTo(negociation)
			await expect(negociation.locator(`[data-card="${carte}"]`)).toHaveCount(1)
			await expect(page.getByTestId('refus-deplacement')).toHaveCount(0)
		} finally {
			const placements = await request.get(rest(`card_placements?workflow_id=eq.${ids.workflow}&select=card_id`), { headers: enTetesService() })
			const cartes = ((await placements.json()) as { card_id: string }[]).map((ligne) => ligne.card_id)
			if (cartes.length > 0) await request.delete(rest(`cards?id=in.(${cartes.join(',')})`), { headers: enTetesService() })
			await request.delete(rest(`channels?id=eq.${ids.channel}`), { headers: enTetesService() })
			await request.delete(rest(`workflows?id=eq.${ids.workflow}`), { headers: enTetesService() })
		}
	})
})

// --- T3a : la fiche et le board, sur le jeu du seed (docs/SPEC-seed.md §28) ---------------------------------------------

const STUDIO = { slug: 'studio-web' }
const CHANNEL_CHECKLISTS = { id: '5eed0000-0000-4000-8000-0000000c6841', slug: 'checklists' }

/** L'affaire du jeu au titre donné, dans le channel « Checklists » — les affaires naissent par `creer_affaire`. */
async function affaireDuJeu(requete: APIRequestContext, titre: string): Promise<string> {
	const reponse = await requete.get(
		rest(`card_placements?select=card_id,affaire:cards!inner(title)&channel_id=eq.${CHANNEL_CHECKLISTS.id}&affaire.title=eq.${encodeURIComponent(titre)}`),
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as { card_id: string }[]
	expect(lignes, `l'affaire « ${titre} » du seed (docs/SPEC-seed.md §28)`).toHaveLength(1)
	return lignes[0]!.card_id
}

test.describe('la checklist d’une affaire — la fiche et le board (docs/DESIGN_SYSTEM.md §5.70)', () => {
	test('la fiche groupe les points par étape, dit qui a coché et ce qui est exigé, et compte', async ({ page, request }) => {
		const vauban = await affaireDuJeu(request, 'Atelier prompt — Lycée Vauban')
		await page.setViewportSize({ width: 1440, height: 1100 })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/tracks/${STUDIO.slug}/${CHANNEL_CHECKLISTS.slug}/cards/${vauban}`)
		const bloc = page.getByTestId('bloc-checklist-card')
		await expect(bloc.getByTestId('checklist-compte')).toHaveText('2 sur 3')
		const courante = bloc.getByTestId('checklist-etape-courante')
		await expect(courante.getByRole('heading', { level: 3 })).toHaveText('Étape Relance')
		await expect(courante.getByTestId('checklist-exige')).toHaveText('Exigé pour passer à Négociation')
		await expect(courante.getByRole('checkbox', { name: 'Proposition envoyée' })).not.toBeChecked()
		const passee = bloc.getByTestId('checklist-etape-passee')
		await expect(passee.getByRole('heading', { level: 3 })).toHaveText('Étape Prospection')
		await expect(passee.getByTestId('checklist-coche-par').first()).toContainText('Coché par Driss Lemoine, le ')
		await expect(bloc.getByTestId('checklist-libres').getByTestId('checklist-point')).toHaveCount(0)
		await bloc.scrollIntoViewIfNeeded()
		await capturer(page, 'fiche-checklist-1440', 'CRM-068')

		// Rechargée à 390 px : un redimensionnement seul laisse le tiroir de navigation ouvert par-dessus la fiche.
		await page.setViewportSize({ width: 390, height: 900 })
		await page.reload()
		await expect(bloc.getByTestId('checklist-compte')).toHaveText('2 sur 3')
		await bloc.scrollIntoViewIfNeeded()
		await capturer(page, 'fiche-checklist-390', 'CRM-068')
	})

	test('le board compte les points de l’étape ; tout coché, la pastille passe en succès ; l’affaire bloquée est refusée', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(`/tracks/${STUDIO.slug}/${CHANNEL_CHECKLISTS.slug}`)
		const carte = (titre: string) => page.getByTestId('carte-card').filter({ hasText: titre })
		await expect(carte('Formation IA — Cerfrance').getByTestId('compte-checklist')).toContainText('1/2')
		await expect(carte('Formation IA — Cerfrance').getByTestId('compte-checklist')).toContainText(
			'1 point coché sur 2 dans cette étape',
		)
		await expect(carte('Atelier prompt — Lycée Vauban').getByTestId('compte-checklist')).toHaveAttribute('data-complet', 'non')
		await expect(carte('Parcours data — Mairie de Rennes')).toHaveCount(1)
		// Négociation n'a pas de point : la carte qui y est ne dit rien de sa checklist (§5.70).
		await expect(carte('Parcours data — Mairie de Rennes').getByTestId('compte-checklist')).toHaveCount(0)
		await capturer(page, 'board-compte-checklist-1440', 'CRM-068')

		await carte('Atelier prompt — Lycée Vauban').dragTo(page.locator('[data-testid="colonne"][data-etape="5eed0000-0000-4000-8000-0000000c6813"]'))
		const bandeau = page.getByTestId('refus-deplacement')
		await expect(bandeau).toHaveAttribute('data-cle', 'checklist_incomplete')
		await expect(bandeau.getByTestId('points-manquants')).toHaveText('Proposition envoyée')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	test('sur une affaire jetable : cocher, décocher, ajouter et retirer un point libre ; le fil nomme le cochage', async ({
		page,
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const creation = await request.post(rest('rpc/creer_affaire'), {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { p_channel: CHANNEL_CHECKLISTS.id, p_titre: `ZZ checklist ${randomUUID().slice(0, 8)}` },
		})
		expect(creation.status(), await creation.text()).toBe(200)
		const carte = (await creation.json()) as string
		try {
			await page.setViewportSize({ width: 1440, height: 1100 })
			await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
			await page.goto(`/tracks/${STUDIO.slug}/${CHANNEL_CHECKLISTS.slug}/cards/${carte}`)
			const bloc = page.getByTestId('bloc-checklist-card')
			await expect(bloc.getByTestId('checklist-compte')).toHaveText('0 sur 2')

			await bloc.getByRole('checkbox', { name: 'Besoin confirmé' }).check()
			await expect(bloc.getByTestId('checklist-compte')).toHaveText('1 sur 2')
			await expect(bloc.getByTestId('checklist-coche-par')).toContainText('Coché par Driss Lemoine, le ')
			// Le fil relit ses événements après le geste : la ligne du cochage, avec le libellé du point.
			await expect(page.getByText('Point de checklist coché')).toBeVisible()

			const champ = bloc.getByLabel('Nouveau point')
			await champ.fill('Préparer la convention de formation')
			await champ.press('Enter')
			await expect(bloc.getByTestId('checklist-libres').getByTestId('checklist-point')).toHaveCount(1)
			await expect(champ).toHaveValue('')
			await expect(champ).toBeFocused()
			await expect(bloc.getByTestId('checklist-compte')).toHaveText('1 sur 3')
			await capturer(page, 'fiche-checklist-gestes-1440', 'CRM-068')

			await bloc.getByRole('button', { name: 'Retirer le point Préparer la convention de formation' }).click()
			await expect(bloc.getByTestId('checklist-libres').getByTestId('checklist-point')).toHaveCount(0)
			await bloc.getByRole('checkbox', { name: 'Besoin confirmé' }).uncheck()
			await expect(bloc.getByTestId('checklist-compte')).toHaveText('0 sur 2')
			await expect(page.getByText('Point de checklist décoché')).toBeVisible()

			// La base a tout tracé : l'auteur et l'heure du cochage, sous le jeton de Driss.
			const fil = await request.get(rest(`card_events?card_id=eq.${carte}&type=like.checklist*&select=type,actor_id`), {
				headers: enTetesService(),
			})
			expect(((await fil.json()) as { type: string }[]).map((e) => e.type).sort()).toEqual([
				'checklist_checked',
				'checklist_unchecked',
			])
		} finally {
			await request.delete(rest(`cards?id=eq.${carte}`), { headers: enTetesService() })
		}
	})

	test('la lectrice lit la checklist, et ses commandes sont éteintes avec le motif de la fiche', async ({ page, request }) => {
		const cerfrance = await affaireDuJeu(request, 'Formation IA — Cerfrance')
		await page.setViewportSize({ width: 1440, height: 1100 })
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto(`/tracks/${STUDIO.slug}/${CHANNEL_CHECKLISTS.slug}/cards/${cerfrance}`)
		const bloc = page.getByTestId('bloc-checklist-card')
		await expect(bloc.getByTestId('checklist-compte')).toHaveText('1 sur 3')
		await expect(bloc.getByRole('checkbox', { name: 'Décideur identifié' })).toBeDisabled()
		await expect(bloc.getByTestId('checklist-retirer')).toBeDisabled()
		await expect(bloc.getByLabel('Nouveau point')).toBeDisabled()
		await expect(bloc.getByRole('checkbox', { name: 'Décideur identifié' })).toHaveAttribute(
			'aria-describedby',
			/fiche-affaire-lecture-seule/,
		)
		await bloc.scrollIntoViewIfNeeded()
		await capturer(page, 'fiche-checklist-lectrice-1440', 'CRM-068')
	})
})
