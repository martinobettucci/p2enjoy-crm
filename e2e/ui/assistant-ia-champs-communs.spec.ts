// @verifies CRM-112 (docs/BACKLOG.md) — tranche T2.d.3 : les champs communs exigés dans le panneau de suggestion, sur la
//           pile réelle — nommés par les champs de l'espace, « Archivé », une clé inconnue telle quelle ; les défauts
//           que la base écrit ; retirer à la souris et au clavier ; la correction qui garde la liste ; l'acceptation qui
//           pose l'exigence sur le workflow créé, relue en base ; quatre paliers
// @verifies docs/SPEC-ia.md §6.1 (`exigences_communes`), §12.1 (les trois codes), §12.5 (le parcours) ;
//           docs/DESIGN_SYSTEM.md §5.52 ter, §7 (aucun défilement horizontal de la page), §8 (clavier) ; décision 825
// @verifies CLAUDE.md §15 (état déterministe, effets en base relus), §16 (captures observées)
//
// AUCUNE GÉNÉRATION : la suggestion et sa révision sont écrites par l'administratrice elle-même, avec son jeton réel, par
// le chemin d'une correction (`suggestions_ia_revisions`, origine `correction`, docs/SPEC-ia.md §12.2) — la base calcule
// les défauts comme pour toute révision. Les champs communs sont posés de même. Après chaque scénario, la clé de service
// retire le workflow créé, les nœuds ajoutés, les suggestions et les champs de sonde — retrait CONSTATÉ.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const EDITEUR = '/reglages/workflows'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const PREFIXE = 'Sonde 112 UI'
const NOEUDS = ['sonde-112-depart', 'sonde-112-devis', 'sonde-112-gagne']
const CHAMPS = ['sonde-112-siret', 'sonde-112-ancien']

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`
const g = (texte: string) => texte.replace(/« /g, '« ').replace(/ »/g, ' »')

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

test.afterEach(async ({ request }) => {
	const creees = await lireService<{ workflow_cree_id: string | null }>(
		request,
		`suggestions_ia?select=workflow_cree_id&${FILTRE}&workflow_cree_id=not.is.null`,
	)
	for (const { workflow_cree_id } of creees) {
		expect((await request.delete(rest(`workflows?id=eq.${workflow_cree_id}`), { headers: enTetesService() })).status()).toBe(204)
	}
	await request.delete(rest(`workflow_nodes_catalog?workspace_id=eq.${ESPACE}&key=in.(${NOEUDS.join(',')})`), { headers: enTetesService() })
	await request.delete(rest(`suggestions_ia?${FILTRE}`), { headers: enTetesService() })
	await request.delete(rest(`card_common_fields?workspace_id=eq.${ESPACE}&key=in.(${CHAMPS.join(',')})`), { headers: enTetesService() })
	expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`), 'aucune suggestion de sonde ne doit rester').toEqual([])
	expect(await lireService(request, `card_common_fields?select=id&key=in.(${CHAMPS.join(',')})`)).toEqual([])
	expect(await lireService(request, `workflow_nodes_catalog?select=id&key=in.(${NOEUDS.join(',')})`)).toEqual([])
})

/**
 * Deux champs communs — l'un actif, l'autre archivé — et une suggestion dont la révision exige trois champs communs :
 * l'actif, l'archivé et une clé qu'aucun champ ne porte. Tout est écrit avec le jeton de l'administratrice.
 */
async function preparer(request: APIRequestContext, suffixe: string): Promise<{ demande: string; idSiret: string }> {
	const jeton = await jetonDe(ADMIN)
	const entetes = { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' }
	const champs = await request.post(rest('card_common_fields'), {
		headers: entetes,
		data: [
			{ workspace_id: ESPACE, key: CHAMPS[0], label: 'SIRET de sonde', type: 'text' },
			{ workspace_id: ESPACE, key: CHAMPS[1], label: 'Ancien code de sonde', type: 'text' },
		],
	})
	expect(champs.status(), await champs.text()).toBe(201)
	const [siret] = (await champs.json()) as { id: string }[]
	const archive = await request.patch(rest(`card_common_fields?workspace_id=eq.${ESPACE}&key=eq.${CHAMPS[1]}`), {
		headers: entetes,
		data: { archived_at: new Date().toISOString() },
	})
	expect(archive.status(), await archive.text()).toBe(200)

	const demande = `${PREFIXE} — ${suffixe} : un cycle de devis qui exige le SIRET`
	const suggestion = await request.post(rest('suggestions_ia'), {
		headers: entetes,
		data: { workspace_id: ESPACE, portee: 'workflow', demande },
	})
	expect(suggestion.status(), await suggestion.text()).toBe(201)
	const [creee] = (await suggestion.json()) as { id: string }[]
	const id = creee?.id ?? ''
	const [depart, devis, gagne] = NOEUDS
	const revision = await request.post(rest('suggestions_ia_revisions'), {
		headers: entetes,
		data: {
			suggestion_id: id,
			origine: 'correction',
			proposition: {
				version: 1,
				workflow: { nom: `${PREFIXE} — Devis ${suffixe}` },
				noeuds: [
					{ cle: depart, libelle: 'Premier contact', nature: 'open', probabilite: 10 },
					{ cle: devis, libelle: 'Devis envoyé', nature: 'open', probabilite: 50 },
					{ cle: gagne, libelle: 'Devis signé', nature: 'won', probabilite: 100 },
				],
				etapes: [
					{ noeud: depart, initiale: true, label: null, probability: null },
					{ noeud: devis, initiale: false, label: null, probability: null },
					{ noeud: gagne, initiale: false, label: null, probability: null },
				],
				transitions: [
					{ de: depart, vers: devis, libelle: 'Envoyer le devis', commentaire_requis: false },
					{ de: devis, vers: gagne, libelle: 'Signer', commentaire_requis: false },
				],
				champs: [],
				regles: [],
				exigences: [],
				exigences_communes: [
					{ de: devis, vers: gagne, champ: CHAMPS[0] },
					{ de: devis, vers: gagne, champ: CHAMPS[1] },
					{ de: depart, vers: devis, champ: 'sonde-112-inconnu' },
				],
			},
		},
	})
	expect(revision.status(), await revision.text()).toBe(201)
	return { demande, idSiret: siret?.id ?? '' }
}

async function ouvrir(page: Page, demande: string): Promise<void> {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(EDITEUR)
	await page.getByTestId('ia-suggestions-en-revue').getByRole('button', { name: new RegExp(demande) }).click()
	await expect(page.getByTestId('ia-exigence-commune')).toHaveCount(3)
}

test.describe('Les champs communs exigés dans une suggestion (docs/DESIGN_SYSTEM.md §5.52 ter)', () => {
	test.use({ viewport: { width: 1440, height: 900 } })

	test('relire, retirer à la souris puis au clavier, enregistrer, accepter — l’exigence est posée sur le workflow créé', async ({ page, request }) => {
		const { demande, idSiret } = await preparer(request, 'parcours')
		await ouvrir(page, demande)

		// Les défauts que la BASE a écrits : l'archivé et l'inconnu ne sont pas des champs communs actifs.
		const defauts = page.getByTestId('ia-defauts')
		await expect(defauts.getByRole('heading')).toHaveText('2 défauts empêchent l’acceptation')
		await expect(defauts.getByRole('listitem')).toHaveText([
			g('Une exigence vise « sonde-112-ancien », qui n’est pas un champ commun actif de l’espace.'),
			g('Une exigence vise « sonde-112-inconnu », qui n’est pas un champ commun actif de l’espace.'),
		])

		const section = page.getByTestId('ia-exigences-communes')
		await expect(section.getByRole('heading', { level: 3, name: 'Champs communs exigés' })).toBeVisible()
		const lignes = section.getByTestId('ia-exigence-commune')
		await expect(lignes.nth(0)).toContainText('Devis envoyé vers Devis signé exige le champ commun SIRET de sonde')
		await expect(lignes.nth(1)).toContainText('exige le champ commun Ancien code de sonde')
		await expect(lignes.nth(1)).toContainText('Archivé')
		await expect(lignes.nth(2)).toContainText('Premier contact vers Devis envoyé exige le champ commun sonde-112-inconnu')
		await section.scrollIntoViewIfNeeded()
		await capturer(page, 'ia-champs-communs-xl-1440', UNITE)

		// À la souris : l'exigence de l'archivé.
		await page.getByRole('button', { name: 'Retirer l’exigence du champ commun Ancien code de sonde de Devis envoyé vers Devis signé' }).click()
		await expect(page.getByRole('status').filter({ hasText: 'Exigence retirée.' })).toHaveCount(1)
		await expect(lignes).toHaveCount(2)

		// Au clavier : l'exigence de la clé inconnue, atteinte et retirée sans la souris.
		const retirerInconnu = page.getByRole('button', {
			name: 'Retirer l’exigence du champ commun sonde-112-inconnu de Premier contact vers Devis envoyé',
		})
		await retirerInconnu.focus()
		await expect(retirerInconnu).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(lignes).toHaveCount(1)
		await expect(page.getByTestId('ia-modifie')).toHaveText('Modifications non enregistrées')

		await page.getByRole('button', { name: 'Enregistrer la correction' }).click()
		await expect(page.getByTestId('ia-modifie')).toHaveCount(0)
		await expect(page.getByTestId('ia-defauts')).toHaveCount(0)
		await expect(lignes).toHaveCount(1)

		// La révision enregistrée garde la liste restante — le défaut trouvé à la lecture du code.
		const [suggestion] = await lireService<{ id: string }>(request, `suggestions_ia?select=id&${FILTRE}`)
		const [derniere] = await lireService<{ proposition: { exigences_communes?: unknown[] } }>(
			request,
			`suggestions_ia_revisions?select=proposition&suggestion_id=eq.${suggestion?.id}&order=numero.desc&limit=1`,
		)
		expect(derniere?.proposition.exigences_communes).toEqual([{ de: NOEUDS[1], vers: NOEUDS[2], champ: CHAMPS[0] }])

		await page.getByRole('button', { name: 'Accepter et créer le workflow' }).click()
		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)

		// L'effet réel : la transition « Devis envoyé → Devis signé » du workflow créé exige le SIRET.
		const [acceptee] = await lireService<{ statut: string; workflow_cree_id: string }>(
			request,
			`suggestions_ia?select=statut,workflow_cree_id&${FILTRE}`,
		)
		expect(acceptee?.statut).toBe('acceptee')
		const transitions = await lireService<{ id: string }>(request, `workflow_transitions?select=id&workflow_id=eq.${acceptee?.workflow_cree_id}`)
		const exigees = await lireService<{ common_field_id: string }>(
			request,
			`workflow_transition_required_common_fields?select=common_field_id&transition_id=in.(${transitions.map((t) => t.id).join(',')})`,
		)
		expect(exigees).toEqual([{ common_field_id: idSiret }])
	})

	for (const palier of PALIERS) {
		test(`au palier ${palier.nom} : la section dans le cadre, la page sans défilement de côté`, async ({ page, request }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			const { demande } = await preparer(request, palier.nom)
			await ouvrir(page, demande)
			const section = page.getByTestId('ia-exigences-communes')
			await section.scrollIntoViewIfNeeded()
			for (const ligne of await section.getByTestId('ia-exigence-commune').all()) {
				const boite = await ligne.boundingBox()
				expect(boite, 'la ligne est rendue').not.toBeNull()
				expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
			}
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			await capturer(page, `ia-champs-communs-${palier.nom}`, UNITE)
		})
	}
})
