// @verifies CRM-095 (docs/BACKLOG.md) — tranche T1 : créer une affaire, avec les jetons réels
// @verifies docs/SPEC-cards.md §18.2 (le geste, l'étape initiale, ses refus), §18.5 (ligne API) ;
//           docs/SPEC-permissions-rls.md §4 ; docs/JOURNAL.md décision 609
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors
//           interface, avec le jeton réel)
//
// Tout part du SEED et de ses comptes réels : le commercial crée dans un channel qu'il peut écrire et
// relit l'affaire à l'étape initiale ; la lectrice est refusée sur un channel qu'elle LIT — c'est
// l'écriture qui lui manque, pas la vue ; l'anonyme l'est par le privilège. Les affaires créées sont
// retirées par la clé de service dans un `finally`, et le décompte du channel CONSTATÉ rendu.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const BIZDEV = COMPTES_SEED[1]
const VIEWER = COMPTES_SEED[2]
const TITRE = 'Sonde 095 — affaire créée par l’API'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

const creer = (requete: APIRequestContext, enTetes: Record<string, string>, idChannel: string, titre = TITRE) =>
	requete.post(rest('rpc/creer_affaire'), { headers: enTetes, data: { p_channel: idChannel, p_titre: titre } })

/** Un channel vivant, lu AVEC le jeton donné : ce que cet appelant peut voir, jamais un identifiant figé. */
async function channelLisible(requete: APIRequestContext, jeton: string): Promise<string> {
	const reponse = await requete.get(
		rest('channels?select=id&archived_at=is.null&deleted_at=is.null&order=position&limit=1'),
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(reponse.status()).toBe(200)
	const lignes = (await reponse.json()) as { id: string }[]
	expect(lignes.length, 'le seed doit offrir un channel vivant à cet appelant').toBe(1)
	return lignes[0]?.id ?? ''
}

async function retirerLesSondes(requete: APIRequestContext): Promise<void> {
	await requete.delete(rest(`cards?title=eq.${encodeURIComponent(TITRE)}`), { headers: enTetesService() })
}

test.describe('Créer une affaire (docs/SPEC-cards.md §18.2)', () => {
	test.afterEach(async ({ request }) => {
		await retirerLesSondes(request)
		const restants = await request.get(rest(`cards?select=id&title=eq.${encodeURIComponent(TITRE)}`), {
			headers: enTetesService(),
		})
		expect(await restants.json(), 'aucune affaire de sonde ne doit rester dans le seed').toEqual([])
	})

	test('le commercial crée, et relit l’affaire à l’étape INITIALE de son channel', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		const idChannel = await channelLisible(request, jeton)
		const reponse = await creer(request, enTetesAuthentifies(jeton), idChannel)
		expect(reponse.status(), await reponse.text()).toBe(200)
		const idCarte = (await reponse.json()) as string
		expect(idCarte).toMatch(/^[0-9a-f-]{36}$/)

		// Relue sous les politiques, avec le même jeton : ce que le commercial voit est ce qui est posé.
		const lue = await request.get(
			rest(`cards?id=eq.${idCarte}&select=title,channel_id,workflow_steps!cards_current_step_id_workflow_id_fkey(is_initial)`),
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(lue.status(), await lue.text()).toBe(200)
		expect(await lue.json()).toEqual([
			{ title: TITRE, channel_id: idChannel, workflow_steps: { is_initial: true } },
		])
	})

	test('la lectrice est refusée sur un channel qu’elle LIT, l’anonyme par le privilège, et rien n’est écrit', async ({
		request,
	}) => {
		const jeton = await jetonDe(VIEWER.adresse)
		const idChannel = await channelLisible(request, jeton)
		const lectrice = await creer(request, enTetesAuthentifies(jeton), idChannel)
		expect(lectrice.status(), await lectrice.text()).toBe(403)
		expect(((await lectrice.json()) as { code: string }).code).toBe('42501')

		const anonyme = await creer(request, enTetesAnonymes(), idChannel)
		expect(anonyme.status(), 'le privilège refuse d’abord l’anonyme').toBe(401)

		const ecrites = await request.get(rest(`cards?select=id&title=eq.${encodeURIComponent(TITRE)}`), {
			headers: enTetesService(),
		})
		expect(await ecrites.json()).toEqual([])
	})
})
