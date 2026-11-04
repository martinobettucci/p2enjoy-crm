// @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.c : filtrer la vue liste sur une personne, un contact et un fichier, sur la
//           pile réelle — la personne choisie dans la liste des membres, le contact dans le carnet, « Renseigné » et « Vide »
//           pour un fichier ; l'adresse qui les porte
// @verifies docs/SPEC-champs-communs.md §8 (précision T4.c) ; docs/DESIGN_SYSTEM.md §5.92 ; docs/JOURNAL.md décision 839 ;
//           CLAUDE.md §15, §16
//
// Les champs de sonde portent le préfixe `sonde-112-rf`, les affaires le titre `tst-crm112-rf` ; la clé de service les pose
// dans « Grands comptes » et les retire après chaque scénario — retrait CONSTATÉ.

import { randomUUID } from 'node:crypto'
import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { posterAffaire } from '../affaire'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const LISTE = '/tracks/conseil-ia/grands-comptes/liste'
const PREFIXE = 'sonde-112-rf'
const TITRE = 'tst-crm112-rf'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	for (const { id } of await lireService<{ id: string }>(request, `cards?select=id&title=like.${TITRE}*`)) {
		await request.delete(rest(`card_common_field_values?card_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`cards?id=eq.${id}`), { headers: enTetesService() })
	}
	for (const { id } of await lireService<{ id: string }>(request, `card_common_fields?select=id&key=like.${PREFIXE}*`)) {
		await request.delete(rest(`card_common_field_values?field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `card_common_fields?select=id&key=like.${PREFIXE}*`)).toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

/** A : référente Camille, contact 1, un Kbis ; B : référent Driss, contact 2, sans Kbis. */
async function poser(request: APIRequestContext): Promise<{ readonly contacts: readonly { id: string; nom: string }[] }> {
	const reponse = await request.post(rest('card_common_fields'), {
		headers: { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' },
		data: [
			{ workspace_id: ESPACE, key: `${PREFIXE}-referent`, label: 'Référent (sonde)', type: 'user', options: {}, position: 911 },
			{ workspace_id: ESPACE, key: `${PREFIXE}-contact`, label: 'Contact clé (sonde)', type: 'contact', options: {}, position: 912 },
			{ workspace_id: ESPACE, key: `${PREFIXE}-kbis`, label: 'Kbis (sonde)', type: 'file', options: {}, position: 913 },
		],
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const champs = (await reponse.json()) as { id: string; key: string }[]
	const id = (suffixe: string) => champs.find((c) => c.key === `${PREFIXE}-${suffixe}`)?.id ?? ''
	const contacts = await lireService<{ id: string; full_name: string }>(
		request,
		`contacts?select=id,full_name&workspace_id=eq.${ESPACE}&anonymized_at=is.null&order=full_name&limit=2`,
	)
	expect(contacts).toHaveLength(2)
	const affaires = { A: randomUUID(), B: randomUUID() }
	for (const [lettre, idCard] of Object.entries(affaires)) {
		const creation = await posterAffaire(request, rest('cards'), {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: { id: idCard, workspace_id: ESPACE, channel_id: CHANNEL, workflow_id: WORKFLOW, current_step_id: PROSPECTION, title: `${TITRE} ${lettre}` },
		})
		expect(creation.status(), await creation.text()).toBe(201)
	}
	const valeur = (card: string, champ: string, value: unknown) => ({ card_id: card, field_id: champ, workspace_id: ESPACE, value })
	const valeurs = await request.post(rest('card_common_field_values'), {
		headers: enTetesService(),
		data: [
			valeur(affaires.A, id('referent'), CAMILLE),
			valeur(affaires.A, id('contact'), contacts[0]?.id),
			valeur(affaires.A, id('kbis'), 'kbis-a.pdf'),
			valeur(affaires.B, id('referent'), DRISS),
			valeur(affaires.B, id('contact'), contacts[1]?.id),
		],
	})
	expect(valeurs.status(), await valeurs.text()).toBe(201)
	return { contacts: contacts.map((c) => ({ id: c.id, nom: c.full_name })) }
}

async function sondesVisibles(page: Page): Promise<string[]> {
	await expect(page.getByTestId('tableau-liste').or(page.getByTestId('effacer-filtres-vide'))).toBeVisible()
	const titres = await page.getByTestId('ligne-card').getByRole('link').allTextContents()
	return titres.filter((titre) => titre.startsWith(TITRE)).map((titre) => titre.slice(TITRE.length + 1)).sort()
}

test.use({ viewport: { width: 1440, height: 1000 } })

test('une personne, un contact, un fichier : la liste suit, l’adresse les porte', async ({ page, request }) => {
	const { contacts } = await poser(request)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(LISTE)
	await expect.poll(() => sondesVisibles(page)).toEqual(['A', 'B'])
	await page.getByTestId('ouvrir-filtres-communs').click()
	const panneau = page.getByTestId('panneau-filtres-communs')
	const filtre = (suffixe: string) => panneau.locator(`[data-champ="${PREFIXE}-${suffixe}"]`).getByRole('combobox')

	// La personne : Driss, dans la liste des membres.
	await expect(filtre('referent').locator('option', { hasText: 'Driss Lemoine' })).toHaveCount(1)
	await filtre('referent').selectOption({ label: 'Driss Lemoine' })
	await panneau.getByTestId('appliquer-filtres-communs').click()
	await expect(page).toHaveURL(new RegExp(`c\\.${PREFIXE}-referent=${DRISS}`))
	await expect.poll(() => sondesVisibles(page)).toEqual(['B'])

	// Le contact du carnet, à la place : celui de A.
	await filtre('referent').selectOption('')
	await filtre('contact').selectOption(contacts[0]?.id ?? '')
	await panneau.getByTestId('appliquer-filtres-communs').click()
	await expect.poll(() => sondesVisibles(page)).toEqual(['A'])

	// Le fichier : renseigné, puis vide.
	await filtre('contact').selectOption('')
	await filtre('kbis').selectOption({ label: 'Renseigné' })
	await panneau.getByTestId('appliquer-filtres-communs').click()
	await expect.poll(() => sondesVisibles(page)).toEqual(['A'])
	await capturer(page, 'filtres-references-fichier-xl-1440', UNITE)
	await filtre('kbis').selectOption({ label: 'Vide' })
	await panneau.getByTestId('appliquer-filtres-communs').click()
	await expect(page).toHaveURL(new RegExp(`c\\.${PREFIXE}-kbis=vide`))
	await expect.poll(() => sondesVisibles(page)).toEqual(['B'])
})
