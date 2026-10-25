// @verifies CRM-037 (docs/BACKLOG.md) — « captures de chaque étape » : le formulaire conditionnel rendu à chacune
//           des sept étapes du workflow global, sur session réelle
// @verifies docs/SPEC-form-composer.md §4 quinquies (contrat de cette preuve, mesuré), §4.1 (la composition part
//           des champs, jamais des règles), §4.2 (les destinations), §4.4 (« Requis à l'étape <étape> »), §3.1
//           (une règle absente vaut `visible`), §6.6 (« renseigné »), §7.3 (visuel : formulaire à chaque étape)
// @verifies docs/SPEC-seed.md §9.3 — les sept étapes du workflow global portent chacune une affaire active
// @verifies CLAUDE.md §15 (E2E depuis le seed), §16 (une capture par étape, observée)
//
// AUCUNE SUBSTITUTION RÉSEAU, ET AUCUNE ATTENTE ÉCRITE À LA MAIN. `e2e/ui/formulaire.spec.ts` éprouve une étape
// contre une réponse substituée. Ici, la session est réelle, et la composition attendue est RECALCULÉE hors
// interface, à partir des champs, des règles et des valeurs relus par l'API avec le jeton de l'administratrice :
// un écran faux et une attente fausse ne peuvent pas s'accorder par une même erreur de recopie (§4 quinquies, point 2).
//
// La preuve est en lecture seule : elle n'écrit rien et ne fabrique aucune affaire.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { URL_API, enTetesAuthentifies, jetonDe } from '../api/jetons'
import { capturer } from './captures'

const ADMIN = 'admin@p2enjoy.test'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'

/** Une affaire du socle par étape, identifiants stables (§4 quinquies, tableau du support). */
const SUPPORT: ReadonlyArray<{ readonly etape: string; readonly card: string }> = [
	{ etape: '5eed0000-0000-4000-8000-000000000061', card: '5eed0000-0000-4000-8000-0000000000c3' },
	{ etape: '5eed0000-0000-4000-8000-000000000062', card: '5eed0000-0000-4000-8000-0000000000c1' },
	{ etape: '5eed0000-0000-4000-8000-000000000063', card: '5eed0000-0000-4000-8000-0000000000c4' },
	{ etape: '5eed0000-0000-4000-8000-000000000064', card: '5eed0000-0000-4000-8000-0000000000c7' },
	{ etape: '5eed0000-0000-4000-8000-000000000065', card: '5eed0000-0000-4000-8000-0000000000cc' },
	{ etape: '5eed0000-0000-4000-8000-000000000066', card: '5eed0000-0000-4000-8000-0000000000cd' },
	{ etape: '5eed0000-0000-4000-8000-000000000067', card: '5eed0000-0000-4000-8000-0000000000ce' },
]

interface Etape {
	readonly id: string
	readonly position: number
	readonly label_override: string | null
	readonly noeud: { readonly key: string; readonly label: string }
}
interface Champ {
	readonly id: string
	readonly key: string
	readonly position: number
	readonly archived_at: string | null
}
interface Regle {
	readonly field_id: string
	readonly step_id: string
	readonly visibility: 'hidden' | 'visible' | 'required'
}
interface Valeur {
	readonly card_id: string
	readonly field_id: string
	readonly value: unknown
}
interface Affaire {
	readonly id: string
	readonly current_step_id: string
	readonly channel: { readonly slug: string; readonly track: { readonly slug: string } }
}

/** Ce que l'écran doit montrer pour une affaire, recalculé par le §4.1 et le §4.2. */
interface Composition {
	readonly formulaire: readonly string[]
	readonly requis: readonly string[]
	readonly repliee: readonly string[]
	readonly nullePart: readonly string[]
}

let jeton: string

test.beforeAll(async () => {
	jeton = await jetonDe(ADMIN)
})

async function lire<T>(page: Page, table: string, parametres: Readonly<Record<string, string>>): Promise<T[]> {
	const url = new URL(`/rest/v1/${table}`, URL_API)
	for (const [cle, valeur] of Object.entries(parametres)) url.searchParams.set(cle, valeur)
	const reponse = await page.request.get(url.toString(), { headers: enTetesAuthentifies(jeton) })
	expect(reponse.status(), `${table} : ${await reponse.text()}`).toBe(200)
	return (await reponse.json()) as T[]
}

/** « Renseigné » au sens du §6.6 : ni null, ni chaîne de blancs, ni tableau vide. */
function renseigne(valeur: unknown): boolean {
	if (valeur === null || valeur === undefined) return false
	if (typeof valeur === 'string') return valeur.trim() !== ''
	if (Array.isArray(valeur)) return valeur.length > 0
	return true
}

function composer(
	etape: string,
	champs: readonly Champ[],
	regles: readonly Regle[],
	valeurs: ReadonlyMap<string, unknown>,
): Composition {
	const formulaire: string[] = []
	const requis: string[] = []
	const repliee: string[] = []
	const nullePart: string[] = []
	// §4.1 : les CHAMPS du workflow, ordonnés par position ; la règle du couple est cherchée ensuite.
	for (const champ of [...champs].sort((a, b) => a.position - b.position)) {
		const regle = regles.find((r) => r.field_id === champ.id && r.step_id === etape)
		const visibilite = regle?.visibility ?? 'visible'
		const porteValeur = renseigne(valeurs.get(champ.id))
		if (champ.archived_at === null && visibilite !== 'hidden') {
			formulaire.push(champ.key)
			if (visibilite === 'required') requis.push(champ.key)
		} else if (porteValeur) {
			repliee.push(champ.key)
		} else {
			nullePart.push(champ.key)
		}
	}
	return { formulaire, requis, repliee, nullePart }
}

test.describe('le formulaire à chaque étape du workflow global, sans substitution (§4 quinquies)', () => {
	test('sept étapes, sept affaires : l’écran rend la composition que les règles relues imposent', async ({ page }) => {
		test.setTimeout(180_000)

		const [etapes, champs, regles, valeurs, affaires] = await Promise.all([
			lire<Etape>(page, 'workflow_steps', {
				workflow_id: `eq.${WORKFLOW_GLOBAL}`,
				select: 'id,position,label_override,noeud:workflow_nodes_catalog(key,label)',
				order: 'position',
			}),
			lire<Champ>(page, 'form_fields', {
				workflow_id: `eq.${WORKFLOW_GLOBAL}`,
				select: 'id,key,position,archived_at',
			}),
			lire<Regle>(page, 'form_field_rules', {
				workflow_id: `eq.${WORKFLOW_GLOBAL}`,
				select: 'field_id,step_id,visibility',
			}),
			lire<Valeur>(page, 'card_field_values', {
				card_id: `in.(${SUPPORT.map((s) => s.card).join(',')})`,
				select: 'card_id,field_id,value',
			}),
			lire<Affaire>(page, 'cards', {
				id: `in.(${SUPPORT.map((s) => s.card).join(',')})`,
				// Deux clés composites mènent de `cards` à `channels` (workflow et workspace) : la relation est nommée.
				select: 'id,current_step_id,channel:channels!cards_channel_id_workspace_id_fkey(slug,track:tracks(slug))',
			}),
		])

		// Le support est celui que la spécification a mesuré : sept étapes, une affaire active à chacune.
		expect(etapes.map((e) => e.id)).toEqual(SUPPORT.map((s) => s.etape))
		for (const { etape, card } of SUPPORT) {
			expect(affaires.find((a) => a.id === card)?.current_step_id, `étape de ${card}`).toBe(etape)
		}

		const compositions: Composition[] = []
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, ADMIN)

		for (const { etape: idEtape, card } of SUPPORT) {
			const etape = etapes.find((e) => e.id === idEtape)!
			const libelle = etape.label_override ?? etape.noeud.label
			const affaire = affaires.find((a) => a.id === card)!
			const valeursCard = new Map(valeurs.filter((v) => v.card_id === card).map((v) => [v.field_id, v.value]))
			const attendu = composer(idEtape, champs, regles, valeursCard)
			compositions.push(attendu)

			await page.goto(`/tracks/${affaire.channel.track.slug}/${affaire.channel.slug}/cards/${card}`)
			const formulaire = page.getByTestId('formulaire-card')
			await expect(formulaire).toBeVisible()
			await expect(formulaire.locator('header p')).toHaveText(`Étape courante : ${libelle}`)

			// Les champs du formulaire, DANS L'ORDRE de position (§4.2).
			const rendus = formulaire.locator('[data-testid^="champ-"]')
			await expect(rendus).toHaveCount(attendu.formulaire.length)
			const cles = await rendus.evaluateAll((blocs) =>
				blocs.map((bloc) => (bloc.getAttribute('data-testid') ?? '').replace(/^champ-/, '')),
			)
			expect(cles, `formulaire de ${libelle}`).toEqual(attendu.formulaire)

			// La mention du §4.4, sur exactement les champs exigés, et elle nomme l'étape courante.
			const mentions = formulaire.locator('[data-testid^="requis-"]')
			await expect(mentions).toHaveCount(attendu.requis.length)
			for (const cle of attendu.requis) {
				await expect(page.getByTestId(`requis-${cle}`)).toHaveText(`Requis à l'étape ${libelle}`)
			}

			// La section repliée : exactement les champs attendus, ou absente.
			const repliee = page.getByTestId('autres-etapes')
			if (attendu.repliee.length === 0) {
				await expect(repliee).toHaveCount(0)
			} else {
				await repliee.locator('summary').click()
				const autres = await repliee
					.locator('[data-testid^="autre-"]')
					.evaluateAll((blocs) =>
						blocs.map((bloc) => (bloc.getAttribute('data-testid') ?? '').replace(/^autre-/, '')),
					)
				expect(autres, `section repliée de ${libelle}`).toEqual(attendu.repliee)
			}
			// Un champ rendu nulle part n'apparaît ni au formulaire ni dans la section repliée.
			for (const cle of attendu.nullePart) {
				await expect(page.getByTestId(`champ-${cle}`)).toHaveCount(0)
				await expect(page.getByTestId(`autre-${cle}`)).toHaveCount(0)
			}

			// La capture montre le FORMULAIRE, titre en haut : ouvrir la section repliée fait défiler la page, et
			// laissait l'en-tête coupé et la section hors du cadre.
			await formulaire.evaluate((element) => element.scrollIntoView({ block: 'start' }))
			await capturer(page, `formulaire-etape-${etape.noeud.key}-1440`, 'CRM-037')
		}

		// Non-complaisance (§4 quinquies, point 4) : les sept étapes exercent les trois destinations et l'exigence.
		expect(compositions.some((c) => c.requis.length > 0), 'une étape au moins exige un champ').toBe(true)
		expect(compositions.some((c) => c.repliee.length > 0), 'une étape au moins replie un champ').toBe(true)
		expect(compositions.some((c) => c.nullePart.length > 0), 'une étape au moins ne rend pas un champ').toBe(true)
	})
})
