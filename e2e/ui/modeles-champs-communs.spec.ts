// @verifies CRM-112 (docs/BACKLOG.md) — tranche T5 : un champ de l'affaire dans un modèle d'email, sur la pile réelle — la
//           palette qui le propose sous son libellé et l'insère, le modèle relu en base, la prévisualisation qui rend sa
//           valeur, l'archivage du champ refusé en nommant le modèle, la variable inconnue refusée par requête directe
// @verifies docs/SPEC-champs-communs.md §9 (précision T5), §6 ; docs/DESIGN_SYSTEM.md §5.39, §5.86 ; docs/JOURNAL.md
//           décision 842 ; CLAUDE.md §10, §15, §16
//
// Le champ de sonde porte la clé `sonde-112-mt-siret`, l'affaire le titre `tst-crm112-mt`, le modèle le nom `tst-crm112-mt` ;
// la clé de service les pose et les retire après chaque scénario — retrait CONSTATÉ.

import { randomUUID } from 'node:crypto'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { posterAffaire } from '../affaire'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const CLE = 'sonde-112-mt-siret'
const LIBELLE = 'SIRET (sonde modèle)'
const TITRE = 'tst-crm112-mt'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	await request.delete(rest(`mail_templates?name=like.${TITRE}*`), { headers: enTetesService() })
	for (const { id } of await lireService<{ id: string }>(request, `cards?select=id&title=like.${TITRE}*`)) {
		await request.delete(rest(`card_common_field_values?card_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`cards?id=eq.${id}`), { headers: enTetesService() })
	}
	for (const { id } of await lireService<{ id: string }>(request, `card_common_fields?select=id&key=like.sonde-112-mt*`)) {
		await request.delete(rest(`card_common_field_values?field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `mail_templates?select=id&name=like.${TITRE}*`)).toEqual([])
	expect(await lireService(request, `card_common_fields?select=id&key=like.sonde-112-mt*`)).toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

async function poser(request: APIRequestContext): Promise<void> {
	const champ = await request.post(rest('card_common_fields'), {
		headers: { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' },
		data: { workspace_id: ESPACE, key: CLE, label: LIBELLE, type: 'text', options: {} },
	})
	expect(champ.status(), await champ.text()).toBe(201)
	const idChamp = ((await champ.json()) as { id: string }[])[0]?.id
	expect(idChamp, 'le champ de sonde créé').toBeTruthy()
	const idCard = randomUUID()
	const creation = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id: idCard, workspace_id: ESPACE, channel_id: CHANNEL, workflow_id: WORKFLOW, current_step_id: PROSPECTION, title: `${TITRE} affaire` },
	})
	expect(creation.status(), await creation.text()).toBe(201)
	const valeur = await request.post(rest('card_common_field_values'), {
		headers: enTetesService(),
		data: { card_id: idCard, field_id: idChamp, workspace_id: ESPACE, value: '123 456 789 00011' },
	})
	expect(valeur.status(), await valeur.text()).toBe(201)
}

test.use({ viewport: { width: 1440, height: 1000 } })

test('la palette propose le champ, le modèle le cite, la prévisualisation rend sa valeur, l’archivage est refusé', async ({ page, request }) => {
	await poser(request)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/modeles-emails')
	await page.getByTestId('ouvrir-modele').click()
	await page.getByTestId('champ-nom-modele').fill(`${TITRE} relance`)
	await page.getByTestId('champ-objet-modele').fill('Votre dossier')
	await page.getByTestId('champ-corps-modele').fill('Numéro : ')

	// La palette : les natives, puis « Champs de l'affaire » et le champ sous son libellé.
	const champs = page.getByTestId('palette-variables-champs')
	const bouton = champs.locator(`[data-variable="card.field.${CLE}"]`)
	await expect(bouton).toContainText(LIBELLE)
	await expect(bouton).toContainText(`{{card.field.${CLE}}}`)
	await bouton.click()
	await expect(page.getByTestId('champ-corps-modele')).toHaveValue(`Numéro : {{card.field.${CLE}}}`)
	await capturer(page, 'modeles-champs-communs-palette-xl-1440', UNITE)
	await page.getByTestId('valider-modele-email').click()
	await expect(page.getByTestId('fiche-modele-email')).toHaveCount(0)
	await expect
		.poll(async () => (await lireService<{ body_text: string }>(request, `mail_templates?select=body_text&name=eq.${encodeURIComponent(`${TITRE} relance`)}`))[0]?.body_text)
		.toBe(`Numéro : {{card.field.${CLE}}}`)

	// La prévisualisation sur l'affaire de sonde : la valeur du champ.
	await page.getByTestId('ligne-modele-email').filter({ hasText: `${TITRE} relance` }).getByTestId('previsualiser-modele').click()
	await page.getByTestId('champ-affaire-previsualisation').selectOption({ label: `${TITRE} affaire` })
	await page.getByTestId('lancer-previsualisation').click()
	await expect(page.getByTestId('rendu-corps')).toContainText('Numéro : 123 456 789 00011')
	await capturer(page, 'modeles-champs-communs-rendu-xl-1440', UNITE)

	// L'archivage du champ cité est refusé, et le refus nomme le modèle.
	await page.goto('/reglages/champs')
	await page.locator(`[data-champ="${CLE}"]`).getByRole('button', { name: /Archiver le champ/ }).click()
	const confirmation = page.getByTestId('confirmation-archivage-champ-commun')
	await confirmation.getByRole('button', { name: 'Archiver', exact: true }).click()
	await expect(confirmation.getByRole('alert')).toContainText(`Modèle : ${TITRE} relance`)
	// Le refus de la base est le 400 attendu de ce geste.
	autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	await expect(confirmation.getByRole('alert')).toContainText('Ce champ est employé')
	await capturer(page, 'modeles-champs-communs-archivage-xl-1440', UNITE)
})

test('une variable de champ inconnue est refusée par la base, sous le nom de sa colonne : requête directe', async ({ request }) => {
	const reponse = await request.post(rest('mail_templates'), {
		headers: enTetesAuthentifies(await jetonDe(ADMIN)),
		data: { workspace_id: ESPACE, name: `${TITRE} inconnu`, subject: 'Objet', body_text: 'Corps {{card.field.inconnu}}' },
	})
	expect(reponse.status()).toBe(400)
	expect(await reponse.text()).toContain('mail_templates_body_variables')
})
