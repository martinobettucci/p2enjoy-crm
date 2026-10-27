// @verifies CRM-077 (docs/BACKLOG.md), dixième tranche — docs/SPEC-corbeille.md §8.4 : une ligne en corbeille n'est lisible que par
//           l'administratrice et l'auteur du retrait (révision des comptes ci-dessous)
// @verifies CRM-093 (docs/BACKLOG.md) — tranche T1 : la capacité d'écriture, lue par la route REST avec les jetons réels
// @verifies docs/SPEC-droits-interface.md §2.1 (deux colonnes calculées : la capacité du rôle ET des droits fins ;
//           aucune ligne de plus que la RLS), §2.2 (les deux capacités de l'espace) ; docs/SPEC-permissions-rls.md §3.3 bis,
//           §7 ; CLAUDE.md §10
//
// La colonne est une AIDE : la règle reste la politique. Ce fichier prouve donc aussi que ce que la colonne annonce
// est ce que la base fait — une affaire annoncée en lecture seule refuse réellement l'écriture, une affaire annoncée
// modifiable l'accepte —, avec les mêmes jetons, sur les droits fins du seed.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { CLE_ANONYME, COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const [ADMIN, BIZDEV, VIEWER] = COMPTES_SEED
const CHANNELS = `${URL_API}/rest/v1/channels`
const CARDS = `${URL_API}/rest/v1/cards`
const PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
const MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'

type Ligne = { id: string; ecriture_permise: boolean }

async function ecrits(request: APIRequestContext, jeton: string): Promise<string[]> {
	const reponse = await request.get(`${CHANNELS}?select=id,ecriture_permise&order=id`, {
		headers: enTetesAuthentifies(jeton),
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
	return ((await reponse.json()) as Ligne[])
		.filter((ligne) => ligne.id.startsWith('5eed') && ligne.ecriture_permise)
		.map((ligne) => ligne.id.slice(-3))
}

async function premiereAffaire(request: APIRequestContext, jeton: string, channel: string): Promise<Ligne & { title: string }> {
	const reponse = await request.get(
		`${CARDS}?select=id,title,ecriture_permise&channel_id=eq.${channel}&archived_at=is.null&deleted_at=is.null&order=id&limit=1`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	const [affaire] = (await reponse.json()) as (Ligne & { title: string })[]
	expect(affaire, `une affaire lisible dans le channel ${channel}`).toBeDefined()
	return affaire!
}

test.describe('la capacité d’écriture lue par l’interface (docs/SPEC-droits-interface.md §2.1)', () => {
	test('par channel : l’administratrice écrit tout, le business developer tout sauf « maintenance », la lectrice « prospection » seul', async ({
		request,
	}) => {
		// RÉVISÉ PAR `CRM-068` T3a (décision 51) : le channel « Checklists » du track `studio-web` (`docs/SPEC-seed.md` §28,
	// décision 755), servi par son propre workflow global, s'ajoute au jeu ; l'objet de l'assertion ne bouge pas.
		expect(await ecrits(request, await jetonDe(ADMIN.adresse))).toEqual(['031', '032', '033', '034', '035', '036', '037', '038', '841'])
		// RÉVISÉ PAR `CRM-077` DIXIÈME TRANCHE (§8.4) : …038 est en corbeille, retiré par l'administratrice, et le business
		// developer ne le lit plus — il n'en reçoit donc aucune capacité.
		expect(await ecrits(request, await jetonDe(BIZDEV.adresse))).toEqual(['031', '032', '033', '034', '036', '037', '841'])
		expect(await ecrits(request, await jetonDe(VIEWER.adresse))).toEqual(['031'])
	})

	test('ce que la colonne annonce est ce que la base fait : lecture seule refusée, modifiable acceptée', async ({ request }) => {
		const jetonLectrice = await jetonDe(VIEWER.adresse)
		const enLecture = await premiereAffaire(request, jetonLectrice, MAINTENANCE)
		expect(enLecture.ecriture_permise).toBe(false)
		const refus = await request.patch(`${CARDS}?id=eq.${enLecture.id}`, {
			headers: { ...enTetesAuthentifies(jetonLectrice), 'Content-Type': 'application/json', Prefer: 'return=representation' },
			data: { title: enLecture.title },
		})
		expect(await refus.json(), 'annoncée en lecture seule, l’affaire n’est pas modifiée').toEqual([])

		const modifiable = await premiereAffaire(request, jetonLectrice, PROSPECTION)
		expect(modifiable.ecriture_permise).toBe(true)
		const accord = await request.patch(`${CARDS}?id=eq.${modifiable.id}`, {
			headers: { ...enTetesAuthentifies(jetonLectrice), 'Content-Type': 'application/json', Prefer: 'return=representation' },
			// Le titre est réécrit à l'identique : l'écriture est réelle, l'affaire est rendue intacte.
			data: { title: modifiable.title },
		})
		expect(((await accord.json()) as { id: string }[]).map((ligne) => ligne.id), 'annoncée modifiable, elle l’est').toEqual([
			modifiable.id,
		])
	})

	test('le business developer : une affaire de « maintenance » est annoncée en lecture seule', async ({ request }) => {
		const affaire = await premiereAffaire(request, await jetonDe(BIZDEV.adresse), MAINTENANCE)
		expect(affaire.ecriture_permise).toBe(false)
	})

	test('par espace : l’administratrice administre et édite, le business developer édite, la lectrice ni l’un ni l’autre', async ({
		request,
	}) => {
		const capacites = async (adresse: string) => {
			const reponse = await request.get(
				`${URL_API}/rest/v1/workspaces?select=administration_permise,edition_permise&id=eq.5eed0000-0000-4000-8000-000000000001`,
				{ headers: enTetesAuthentifies(await jetonDe(adresse)) },
			)
			expect(reponse.status(), await reponse.text()).toBe(200)
			return (await reponse.json()) as { administration_permise: boolean; edition_permise: boolean }[]
		}
		expect(await capacites(ADMIN.adresse)).toEqual([{ administration_permise: true, edition_permise: true }])
		expect(await capacites(BIZDEV.adresse)).toEqual([{ administration_permise: false, edition_permise: true }])
		expect(await capacites(VIEWER.adresse)).toEqual([{ administration_permise: false, edition_permise: false }])
	})

	test('un channel illisible n’est pas rendu, et l’anonyme ne reçoit aucune ligne, sans erreur', async ({ request }) => {
		const lectrice = await request.get(`${CHANNELS}?select=id,ecriture_permise&id=eq.5eed0000-0000-4000-8000-000000000032`, {
			headers: enTetesAuthentifies(await jetonDe(VIEWER.adresse)),
		})
		expect(await lectrice.json()).toEqual([])
		for (const adresse of [CHANNELS, CARDS]) {
			const anonyme = await request.get(`${adresse}?select=id,ecriture_permise&limit=5`, {
				headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${CLE_ANONYME}` },
			})
			expect(anonyme.status(), await anonyme.text()).toBe(200)
			expect(await anonyme.json()).toEqual([])
		}
		// La clé de service traverse la RLS : la colonne y répond `false` faute d'utilisateur — elle ne dit rien de plus.
		const service = await request.get(`${CHANNELS}?select=id,ecriture_permise&id=eq.${PROSPECTION}`, { headers: enTetesService() })
		expect(((await service.json()) as Ligne[])[0]?.ecriture_permise).toBe(false)
	})
})
