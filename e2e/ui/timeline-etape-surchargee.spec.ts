// @verifies CRM-044 (docs/BACKLOG.md) — tranche INC-301 : le fil d'activité nomme l'étape franchie comme le board,
//           surcharge comprise, sur session réelle et sans substitution
// @verifies docs/SPEC-cards.md §14.10 (le nom d'une étape est celui que le board affiche ; la preuve de la règle),
//           §14.6 (aucun libellé dans le `payload`), §14.9 i (un `moved` écrit par la vraie RPC `move_card`)
// @verifies docs/INCONSISTENCY_REPORT.md INC-301 ; docs/JOURNAL.md décision 693
// @verifies docs/SPEC-seed.md §9.3 (`…0cc` dans `refonte`, à l'étape *Réalisation*) — l'étape `…065` surcharge
//           « Réalisation » en « Réalisation en cours »
// @verifies CLAUDE.md §8 (aucune trace fabriquée : le `moved` vient du vrai trigger), §15 (E2E), §16 (capture observée)
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.3 : `move_card` désigne le rattachement de l'affaire
//           (docs/SPEC-rattachements.md §5) ; les scénarios nomment l'affaire, `e2e/api/rattachements.ts` donne le rattachement
//
// AUCUNE AFFAIRE DU SEED N'EST DÉPLACÉE. `…0cc` est à *Réalisation*, et aucune arête du workflow global n'y ramène :
// un aller-retour y est impossible. Le scénario fait donc naître sa propre affaire d'essai — préfixe `f00d`, jamais
// `5eed` (INC-061, décision 199) — dans le channel de `…0cc`, à *Signature*, lui donne la valeur que l'arête exige
// sous le jeton de l'administratrice, et lui fait franchir « Démarrer la réalisation » par la vraie RPC. Elle est
// supprimée par son identifiant à la fin, et son absence constatée : la cascade emporte ses événements.

import { connecterAvecLeLabs, expect, test } from './fixtures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { corpsParRattachement } from '../api/rattachements'
import { capturer } from './captures'
import { posterAffaire } from '../affaire'

const ADMIN = 'admin@p2enjoy.test'
const ID_ADMIN = '5eed0000-0000-4000-8000-000000000011'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const CARD_REFERENCE = '5eed0000-0000-4000-8000-0000000000cc'
const ETAPE_SIGNATURE = '5eed0000-0000-4000-8000-000000000064'
const ETAPE_REALISATION = '5eed0000-0000-4000-8000-000000000065'
const CARD_ESSAI = 'f00d0000-0000-4000-8000-0000000003a1'

interface Etape {
	readonly id: string
	readonly label_override: string | null
	readonly noeud: { readonly label: string }
}

test.describe('le fil nomme l’étape franchie comme le board (INC-301, sans substitution)', () => {
	test.afterAll(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/cards?id=eq.${CARD_ESSAI}`, { headers: enTetesService() })
		const reste = await request.get(`${URL_API}/rest/v1/cards?id=eq.${CARD_ESSAI}&select=id`, {
			headers: enTetesService(),
		})
		expect(await reste.json(), 'l’affaire d’essai n’a pas été supprimée').toEqual([])
	})

	test('« Signature → Réalisation en cours », la surcharge de l’étape et non le nœud', async ({ page, request }) => {
		test.setTimeout(120_000)
		const jeton = await jetonDe(ADMIN)

		// Le support, relu et non supposé : l'étape d'arrivée SURCHARGE son nœud, et le channel est celui de `…0cc`.
		const etapes = (await (
			await request.get(
				`${URL_API}/rest/v1/workflow_steps?id=in.(${ETAPE_SIGNATURE},${ETAPE_REALISATION})` +
					'&select=id,label_override,noeud:workflow_nodes_catalog(label)',
				{ headers: enTetesAuthentifies(jeton) },
			)
		).json()) as Etape[]
		const signature = etapes.find((e) => e.id === ETAPE_SIGNATURE)!
		const realisation = etapes.find((e) => e.id === ETAPE_REALISATION)!
		const depart = signature.label_override ?? signature.noeud.label
		const arrivee = realisation.label_override
		expect(arrivee, 'l’étape …065 du seed doit porter une surcharge').toBeTruthy()
		expect(arrivee, 'la surcharge doit différer du nœud, sinon la preuve est complaisante').not.toBe(
			realisation.noeud.label,
		)

		const reference = (await (
			await request.get(
				// `CRM-111` T2.4.5 : le channel est celui du rattachement de l'affaire.
				`${URL_API}/rest/v1/card_placements?card_id=eq.${CARD_REFERENCE}` +
					'&select=channel_id,channel:channels!card_placements_channel_fk(slug,track:tracks(slug))',
				{ headers: enTetesAuthentifies(jeton) },
			)
		).json()) as Array<{ channel_id: string; channel: { slug: string; track: { slug: string } } }>
		expect(reference, '…0cc introuvable').toHaveLength(1)
		const { channel_id: channel, channel: lieu } = reference[0]!

		// Naissance de l'affaire d'essai à *Signature*, par la clé de service — comme les cards d'essai de
		// `e2e/api/move-card-to-channel.spec.ts`.
		const creation = await posterAffaire(request, `${URL_API}/rest/v1/cards`, {
			headers: enTetesService(),
			data: {
				id: CARD_ESSAI,
				workspace_id: WORKSPACE,
				channel_id: channel,
				workflow_id: WORKFLOW_GLOBAL,
				current_step_id: ETAPE_SIGNATURE,
				title: 'Affaire d’essai INC-301',
				created_by: ID_ADMIN,
			},
		})
		expect(creation.status(), await creation.text()).toBe(201)

		// La valeur que l'arête « Démarrer la réalisation » exige, sous le jeton de l'administratrice.
		const champ = (await (
			await request.get(
				`${URL_API}/rest/v1/form_fields?workflow_id=eq.${WORKFLOW_GLOBAL}&key=eq.lien-proposition&select=id`,
				{ headers: enTetesAuthentifies(jeton) },
			)
		).json()) as Array<{ id: string }>
		expect(champ, 'champ `lien-proposition` introuvable').toHaveLength(1)
		const valeur = await request.post(`${URL_API}/rest/v1/card_field_values`, {
			headers: enTetesAuthentifies(jeton),
			data: {
				card_id: CARD_ESSAI,
				field_id: champ[0]!.id,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE,
				value: 'https://p2enjoy.fr/propositions/essai-inc-301',
			},
		})
		expect(valeur.status(), await valeur.text()).toBe(201)

		// Le franchissement, par la vraie RPC : c'est le trigger qui écrit le `moved` (§14.5).
		const deplacement = await request.post(`${URL_API}/rest/v1/rpc/move_card`, {
			headers: enTetesAuthentifies(jeton),
			data: await corpsParRattachement(request, { card_id: CARD_ESSAI, to_step_id: ETAPE_REALISATION }),
		})
		expect(deplacement.status(), await deplacement.text()).toBe(200)

		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/tracks/${lieu.track.slug}/${lieu.slug}/cards/${CARD_ESSAI}`)

		const ligne = page.getByRole('listitem').filter({ hasText: 'Étape franchie' })
		await expect(ligne).toHaveCount(1)
		await expect(ligne).toContainText(`${depart} → ${arrivee}`)
		// Non-complaisance : ôtée la phrase attendue, aucune flèche ne vise plus le nom du NŒUD.
		const texte = (await ligne.textContent()) ?? ''
		expect(texte.replace(`→ ${arrivee}`, '')).not.toContain(`→ ${realisation.noeud.label}`)

		await ligne.scrollIntoViewIfNeeded()
		await capturer(page, 'fil-etape-surchargee-1440', 'CRM-044')
	})
})
