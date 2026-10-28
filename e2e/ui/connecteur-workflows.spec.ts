// @verifies CRM-118 (docs/BACKLOG.md) — tranches T2.a à T2.d : l'effet des outils de la famille `workflows`, constaté dans
//           la webapp
// @verifies docs/SPEC-mcp.md §9.2 undecies (« une étape ajoutée par un vrai client MCP paraît dans l'éditeur de
//           workflows », crm_workflow_create, crm_workflow_step_add), §5 (sous l'identité de la personne) ;
//           docs/SPEC-workflow-engine.md §7 bis.3 ; CLAUDE.md §16 (captures)
// @verifies docs/SPEC-mcp.md §9.2 undecies T2.b (« un champ exigé par le connecteur bloque un déplacement au board »,
//           crm_transition_required_field_set) ; docs/SPEC-workflow-engine.md §5.7, §7.10 (le bandeau de refus)
// @verifies docs/SPEC-mcp.md §9.2 undecies T2.c (« une restauration par le connecteur remappe une affaire visible au
//           board », crm_workflow_version_publish, crm_workflow_remap_plan, crm_workflow_version_restore) ;
//           docs/SPEC-workflow-engine.md §7 ter.12, §7 ter.13
// @verifies docs/SPEC-mcp.md §9.2 undecies T2.d (« un nœud créé par le connecteur paraît dans le catalogue »,
//           crm_workflow_node_create) ; docs/SPEC-workflow-engine.md §2 bis
// @verifies docs/SPEC-mcp.md §9.2 undecies T2.e (« les mêmes preuves » : un channel dont le connecteur change le workflow
//           montre son affaire à sa destination au board, crm_channel_workflow_change) ; docs/SPEC-workflow-engine.md
//           §7 quinquies.3 ; docs/SPEC-change-channel-workflow.md §2
// @verifies docs/SPEC-mcp.md §9.2 undecies T2.b, les points de checklist d'une étape (« un point ajouté par le connecteur
//           paraît dans l'éditeur », crm_step_checklist_item_add, crm_transition_required_checklist_item_set) ;
//           docs/SPEC-checklists.md §3.4 ; docs/DESIGN_SYSTEM.md §5.70 bis
//
// Un VRAI client MCP crée un workflow et lui ajoute une étape au nom de l'administratrice ; la webapp, sous le même
// compte, montre le workflow et son étape dans l'éditeur. Les cases posées pour la preuve, et le workflow, sont retirés à
// la fin (ses étapes en cascade).

import type { Browser } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { autoriserErreursConsole, connecterAvecLeLabs, ERREUR_RESSOURCE_HTTP, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'
import { posterAffaire } from '../affaire'

const UNITE = 'CRM-118'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = { adresse: 'admin@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000011' }
const PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOM = 'E2E MCP workflow'
// T2.e : le workflow d'arrivée du changement, retiré à la fin comme le premier.
const NOM_ARRIVEE = 'E2E MCP workflow arrivée'
const ETAPE = 'E2E Étape MCP'
const CASES: readonly [string, string][] = [
	['workflows', 'consulter'],
	['workflows', 'ajouter'],
	['workflows', 'modifier'],
]
// T2.b : la transition « Relancer » (Prospection → Relance) du workflow par défaut, qui n'exige rien dans le seed, et le
// champ « Date de signature prévue », exigé seulement à « Signature » ; une affaire jetable à « Prospection ».
const WORKFLOW_DEFAUT = '5eed0000-0000-4000-8000-000000000051'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const TRANSITION_RELANCER = '5eed0000-0000-4000-8000-000000000071'
const CHAMP_DATE_SIGNATURE = '5eed0000-0000-4000-8000-000000000083'
// T2.c : un channel jetable du track « Conseil & IA », servi par le workflow de la preuve.
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const SLUG_REMAP = 'e2e-mcp-remap'
// T2.d : un nœud jamais employé, retiré à la fin.
const CLE_NOEUD = 'e2e-mcp-noeud'
const NOEUDS = {
	prospection: '5eed0000-0000-4000-8000-000000000041',
	relance: '5eed0000-0000-4000-8000-000000000042',
	negociation: '5eed0000-0000-4000-8000-000000000043',
}
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function retirer(request: APIRequestContext): Promise<void> {
	for (const [famille, action] of CASES) {
		await request.delete(rest(`mcp_droits?sub=eq.${CAMILLE.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
	const canaux = await request.get(rest(`channels?track_id=eq.${TRACK_CONSEIL}&slug=eq.${SLUG_REMAP}&select=id`), { headers: enTetesService() })
	for (const { id } of (await canaux.json()) as { id: string }[]) {
		// `CRM-111` T2.4.5 : le channel d'une affaire est celui de son rattachement.
		const cartes = await request.get(rest(`card_placements?channel_id=eq.${id}&select=id:card_id`), { headers: enTetesService() })
		for (const carte of (await cartes.json()) as { id: string }[]) {
			await request.delete(rest(`card_field_values?card_id=eq.${carte.id}`), { headers: enTetesService() })
			await request.delete(rest(`cards?id=eq.${carte.id}`), { headers: enTetesService() })
		}
		await request.delete(rest(`channels?id=eq.${id}`), { headers: enTetesService() })
	}
	await request.delete(rest(`workflow_nodes_catalog?workspace_id=eq.${ESPACE}&key=eq.${CLE_NOEUD}`), { headers: enTetesService() })
	for (const nom of [NOM, NOM_ARRIVEE]) {
		await request.delete(rest(`workflows?workspace_id=eq.${ESPACE}&name=eq.${encodeURIComponent(nom)}`), {
			headers: enTetesService(),
		})
	}
	await request.delete(rest(`workflow_transition_required_fields?transition_id=eq.${TRANSITION_RELANCER}&field_id=eq.${CHAMP_DATE_SIGNATURE}`), {
		headers: enTetesService(),
	})
}

test.beforeEach(async ({ request }) => {
	await retirer(request)
	const pose = await request.post(rest('mcp_droits'), {
		headers: { ...enTetesService(), prefer: 'return=minimal' },
		data: CASES.map(([famille, action]) => ({ sub: CAMILLE.sub, workspace_id: ESPACE, famille, action })),
	})
	expect(pose.status()).toBe(201)
})

test.afterEach(async ({ request }) => retirer(request))

/** Un vrai client MCP connecté au nom de la personne, dans un autre contexte de navigateur que la webapp. */
async function sessionDe(browser: Browser, adresse: string): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve des workflows du connecteur')
		await page.goto(autorisation.url)
		await page.getByRole('button', { name: 'Allow Access' }).click()
		await expect(page.locator('#kc-form-login')).toBeVisible()
		await page.locator('#username').fill(adresse)
		await page.locator('#password').fill(MOT_DE_PASSE_SEED)
		const retour = page.waitForRequest((r) => r.url().startsWith(RETOUR_CLIENT), { timeout: 20_000 })
		await page.locator('#kc-login').click()
		const code = new URL((await retour).url()).searchParams.get('code') ?? ''
		const session = new SessionMcp((await echangerCode(autorisation, code)).access_token)
		await session.ouvrir()
		return session
	} finally {
		await contexte.close()
	}
}

test('une étape ajoutée par le connecteur paraît dans l’éditeur de workflows', async ({ page, browser }) => {
	const session = await sessionDe(browser, CAMILLE.adresse)
	const creation = await session.appeler('tools/call', {
		name: 'crm_workflow_create',
		arguments: { workspace: 'p2enjoy', name: NOM },
	})
	expect(creation.isError ?? false, JSON.stringify(creation)).toBe(false)
	const workflow = creation.structuredContent.workflow.id as string
	const ajout = await session.appeler('tools/call', {
		name: 'crm_workflow_step_add',
		arguments: { workflow_id: workflow, node_id: PROSPECTION, label: ETAPE },
	})
	expect(ajout.isError ?? false, JSON.stringify(ajout)).toBe(false)

	await connecterAvecLeLabs(page, CAMILLE.adresse)
	await page.goto('/reglages/workflows')
	await expect(page.getByRole('heading', { name: 'Éditeur de workflows' })).toBeVisible()
	const choix = page.getByRole('button', { name: new RegExp(`^${NOM}`, 'u') })
	await expect(choix).toBeVisible()
	await choix.click()
	await expect(choix).toHaveAttribute('aria-current', 'true')
	await expect(page.getByTestId('ligne-etape')).toHaveCount(1)
	await expect(page.getByTestId('ligne-etape').first()).toContainText(ETAPE)
	await capturer(page, 'connecteur-workflow-editeur-1440', UNITE)
})

test('un champ exigé par le connecteur bloque le déplacement au board, et le bandeau le nomme', async ({ page, browser, request }) => {
	const idCard = randomUUID()
	const titre = `E2E MCP exigence ${idCard.slice(0, 8)}`
	const creation = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id: idCard, workspace_id: ESPACE, channel_id: CHANNEL_GRANDS_COMPTES, workflow_id: WORKFLOW_DEFAUT,
			current_step_id: ETAPE_PROSPECTION, title: titre,
		},
	})
	expect(creation.status(), await creation.text()).toBe(201)
	try {
		const session = await sessionDe(browser, CAMILLE.adresse)
		const exigence = await session.appeler('tools/call', {
			name: 'crm_transition_required_field_set',
			arguments: { transition_id: TRANSITION_RELANCER, field_id: CHAMP_DATE_SIGNATURE, required: true },
		})
		expect(exigence.isError ?? false, JSON.stringify(exigence)).toBe(false)

		await connecterAvecLeLabs(page, CAMILLE.adresse)
		await page.goto('/tracks/conseil-ia/grands-comptes')
		const carte = page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)
		await expect(carte).toContainText(titre)
		await carte.getByRole('button', { name: `Actions ${titre}` }).click()
		await carte.getByRole('button', { name: 'Relancer' }).click()
		const refus = page.getByTestId('refus-deplacement')
		await expect(refus).toHaveAttribute('data-cle', 'missing_required_fields')
		await expect(page.getByTestId('champs-manquants')).toContainText('Date de signature prévue')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await expect(page.locator(`[data-testid="colonne"][data-etape="${ETAPE_PROSPECTION}"] [data-card="${idCard}"]`)).toHaveCount(1)
		await capturer(page, 'connecteur-exigence-refus-1440', UNITE)

		// Le connecteur lève l'exigence : le même déplacement passe.
		const levee = await session.appeler('tools/call', {
			name: 'crm_transition_required_field_set',
			arguments: { transition_id: TRANSITION_RELANCER, field_id: CHAMP_DATE_SIGNATURE, required: false },
		})
		expect(levee.isError ?? false, JSON.stringify(levee)).toBe(false)
		await page.reload()
		await carte.getByRole('button', { name: `Actions ${titre}` }).click()
		await carte.getByRole('button', { name: 'Relancer' }).click()
		await expect(page.locator(`[data-testid="colonne"][data-etape="5eed0000-0000-4000-8000-000000000062"] [data-card="${idCard}"]`)).toHaveCount(1)
	} finally {
		await request.delete(rest(`card_field_values?card_id=eq.${idCard}`), { headers: enTetesService() })
		await request.delete(rest(`cards?id=eq.${idCard}`), { headers: enTetesService() })
	}
})

test('une restauration par le connecteur remappe une affaire, et le board la montre à sa nouvelle étape', async ({ page, browser, request }) => {
	const session = await sessionDe(browser, CAMILLE.adresse)
	const outil = async (name: string, args: Record<string, unknown>) => {
		const resultat = await session.appeler('tools/call', { name, arguments: args })
		expect(resultat.isError ?? false, `${name} ${JSON.stringify(resultat)}`).toBe(false)
		return resultat.structuredContent
	}
	const workflow = (await outil('crm_workflow_create', { workspace: 'p2enjoy', name: NOM })).workflow.id as string
	const prospection = (await outil('crm_workflow_step_add', { workflow_id: workflow, node_id: NOEUDS.prospection })).step.id as string
	const relance = (await outil('crm_workflow_step_add', { workflow_id: workflow, node_id: NOEUDS.relance })).step.id as string
	await outil('crm_workflow_step_update', { step_id: prospection, make_initial: true })
	await outil('crm_workflow_transition_add', { workflow_id: workflow, from_step_id: prospection, to_step_id: relance })
	const v1 = (await outil('crm_workflow_version_publish', { workflow_id: workflow, note: 'Deux étapes' })).version.id as string
	const negociation = (await outil('crm_workflow_step_add', { workflow_id: workflow, node_id: NOEUDS.negociation })).step.id as string
	await outil('crm_workflow_transition_add', { workflow_id: workflow, from_step_id: relance, to_step_id: negociation })

	const canal = await request.post(rest('channels'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { workspace_id: ESPACE, track_id: TRACK_CONSEIL, workflow_id: workflow, name: 'E2E MCP remap', slug: SLUG_REMAP },
	})
	expect(canal.status(), await canal.text()).toBe(201)
	const idChannel = ((await canal.json()) as { id: string }[])[0]?.id ?? ''
	const idCard = randomUUID()
	const titre = `E2E MCP remap ${idCard.slice(0, 8)}`
	const carte = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id: idCard, workspace_id: ESPACE, channel_id: idChannel, workflow_id: workflow, current_step_id: negociation, title: titre },
	})
	expect(carte.status(), await carte.text()).toBe(201)

	// Sans instruction, le plan n'est pas applicable : l'affaire de « Négociation » n'a pas de destination.
	const plan = await outil('crm_workflow_remap_plan', { version_id: v1 })
	expect(plan.plan.ready).toBe(false)
	const pret = await outil('crm_workflow_remap_plan', { version_id: v1, step_overrides: [{ from_step_id: negociation, to_step_id: relance }] })
	expect(pret.plan.ready).toBe(true)
	await outil('crm_workflow_version_restore', { version_id: v1, step_overrides: [{ from_step_id: negociation, to_step_id: relance }] })

	await connecterAvecLeLabs(page, CAMILLE.adresse)
	await page.goto(`/tracks/conseil-ia/${SLUG_REMAP}`)
	await expect(page.getByTestId('colonne')).toHaveCount(2)
	await expect(page.locator(`[data-testid="colonne"][data-etape="${relance}"] [data-card="${idCard}"]`)).toHaveCount(1)
	await expect(page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)).toContainText(titre)
	await capturer(page, 'connecteur-restauration-board-1440', UNITE)
})

test('un nœud créé par le connecteur paraît dans le catalogue, avec son type en toutes lettres', async ({ page, browser }) => {
	const session = await sessionDe(browser, CAMILLE.adresse)
	const creation = await session.appeler('tools/call', {
		name: 'crm_workflow_node_create',
		arguments: { workspace: 'p2enjoy', key: CLE_NOEUD, label: 'E2E nœud MCP', kind: 'won', color: 'success', default_probability: 100 },
	})
	expect(creation.isError ?? false, JSON.stringify(creation)).toBe(false)

	await connecterAvecLeLabs(page, CAMILLE.adresse)
	await page.goto('/reglages/catalogue')
	await expect(page.getByTestId('liste-catalogue')).toBeVisible()
	const ligne = page.locator(`[data-testid="ligne-noeud"][data-noeud="${CLE_NOEUD}"]`)
	await expect(ligne).toContainText('E2E nœud MCP')
	await expect(ligne.getByTestId('type-noeud')).toHaveText('Gagné')
	await expect(ligne.getByTestId('probabilite-noeud')).toHaveText('100 %')
	await ligne.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-noeud-catalogue-1440', UNITE)
})

test('un channel dont le connecteur change le workflow montre son affaire à sa destination au board', async ({ page, browser, request }) => {
	const session = await sessionDe(browser, CAMILLE.adresse)
	const outil = async (name: string, args: Record<string, unknown>) => {
		const resultat = await session.appeler('tools/call', { name, arguments: args })
		expect(resultat.isError ?? false, `${name} ${JSON.stringify(resultat)}`).toBe(false)
		return resultat.structuredContent
	}
	const depart = (await outil('crm_workflow_create', { workspace: 'p2enjoy', name: NOM })).workflow.id as string
	const relance = (await outil('crm_workflow_step_add', { workflow_id: depart, node_id: NOEUDS.relance })).step.id as string
	await outil('crm_workflow_step_update', { step_id: relance, make_initial: true })
	const arrivee = (await outil('crm_workflow_create', { workspace: 'p2enjoy', name: NOM_ARRIVEE })).workflow.id as string
	const prospection = (await outil('crm_workflow_step_add', { workflow_id: arrivee, node_id: NOEUDS.prospection })).step.id as string
	const negociation = (await outil('crm_workflow_step_add', { workflow_id: arrivee, node_id: NOEUDS.negociation })).step.id as string
	await outil('crm_workflow_step_update', { step_id: prospection, make_initial: true })

	const canal = await request.post(rest('channels'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { workspace_id: ESPACE, track_id: TRACK_CONSEIL, workflow_id: depart, name: 'E2E MCP changement', slug: SLUG_REMAP },
	})
	expect(canal.status(), await canal.text()).toBe(201)
	const idChannel = ((await canal.json()) as { id: string }[])[0]?.id ?? ''
	const idCard = randomUUID()
	const titre = `E2E MCP changement ${idCard.slice(0, 8)}`
	const carte = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id: idCard, workspace_id: ESPACE, channel_id: idChannel, workflow_id: depart, current_step_id: relance, title: titre },
	})
	expect(carte.status(), await carte.text()).toBe(201)

	// Rien n'est deviné : sans destination pour « Relance », le CRM refuse et l'outil nomme l'étape.
	const refus = await session.appeler('tools/call', {
		name: 'crm_channel_workflow_change',
		arguments: { channel_id: idChannel, workflow_id: arrivee, step_mapping: [] },
	})
	expect(refus.isError).toBe(true)
	expect(JSON.stringify(refus.content)).toContain('step_mapping_incomplete')
	const change = await outil('crm_channel_workflow_change', {
		channel_id: idChannel, workflow_id: arrivee, step_mapping: [{ from_step_id: relance, to_step_id: negociation }],
	})
	expect(change.placements_moved).toBe(1)

	await connecterAvecLeLabs(page, CAMILLE.adresse)
	await page.goto(`/tracks/conseil-ia/${SLUG_REMAP}`)
	await expect(page.getByTestId('colonne')).toHaveCount(2)
	await expect(page.locator(`[data-testid="colonne"][data-etape="${negociation}"] [data-card="${idCard}"]`)).toHaveCount(1)
	await expect(page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)).toContainText(titre)
	await capturer(page, 'connecteur-changement-workflow-board-1440', UNITE)
})

test('un point de checklist ajouté et exigé par le connecteur paraît dans l’éditeur de workflows', async ({ page, browser }) => {
	const session = await sessionDe(browser, CAMILLE.adresse)
	const outil = async (name: string, args: Record<string, unknown>) => {
		const resultat = await session.appeler('tools/call', { name, arguments: args })
		expect(resultat.isError ?? false, `${name} ${JSON.stringify(resultat)}`).toBe(false)
		return resultat.structuredContent
	}
	const workflow = (await outil('crm_workflow_create', { workspace: 'p2enjoy', name: NOM })).workflow.id as string
	const depart = (await outil('crm_workflow_step_add', { workflow_id: workflow, node_id: NOEUDS.prospection })).step.id as string
	const arrivee = (await outil('crm_workflow_step_add', { workflow_id: workflow, node_id: NOEUDS.relance })).step.id as string
	const arete = (await outil('crm_workflow_transition_add', { workflow_id: workflow, from_step_id: depart, to_step_id: arrivee }))
		.transition.id as string
	const point = (await outil('crm_step_checklist_item_add', { step_id: depart, label: 'Point ajouté par le connecteur' }))
		.checklist_item.id as string
	await outil('crm_transition_required_checklist_item_set', { transition_id: arete, item_id: point, required: true })

	await connecterAvecLeLabs(page, CAMILLE.adresse)
	await page.goto('/reglages/workflows')
	const choix = page.getByRole('button', { name: new RegExp(`^${NOM}`, 'u') })
	await choix.click()
	await expect(choix).toHaveAttribute('aria-current', 'true')
	const bloc = page.getByTestId('bloc-checklists-etapes')
	await expect(bloc.getByTestId('checklist-point-etape')).toHaveCount(1)
	await expect(bloc.getByTestId('checklist-point-etape').first()).toContainText('Point ajouté par le connecteur')
	// L'exigence posée par le connecteur se lit sous sa transition, dans le bloc des exigences.
	await expect(page.getByText('Point ajouté par le connecteur')).toHaveCount(2)
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-checklist-editeur-1440', UNITE)
})
