// @verifies CRM-068 (docs/BACKLOG.md) — tranche T2 : un déplacement refusé faute de points de checklist cochés, sur la vraie pile
// @verifies docs/SPEC-checklists.md §3.4 (le refus `checklist_incomplete` et ses points nommés), §4 (le bandeau du board) ;
//           docs/DESIGN_SYSTEM.md §5.7 quinquies ; CLAUDE.md §10 (la règle est en base), §16 (capture observée)
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
