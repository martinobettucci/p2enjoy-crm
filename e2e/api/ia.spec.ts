// @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : la fonction `ia` sur la pile réelle, aux jetons réels
// @verifies docs/SPEC-ia.md §2 (rien dans la configuration), §4 (mode dégradé), §8 (le serveur réel n'est
//           jamais appelé : chaque requête porte l'en-tête du simulateur), §11.1 à §11.4 (asynchrone, qui
//           écrit quoi, routes, verrou, échec) ; docs/SCHEMA.md §9 ter
// @verifies CLAUDE.md §10 (refus prouvés hors interface, avec les jetons réels du commercial et de la
//           lectrice), §15 (effets en base vérifiés)
//
// Tout part du seed et de ses comptes réels, connectés par LeLabs. Les suggestions créées portent un préfixe
// et sont retirées par la clé de service après chaque scénario, retrait CONSTATÉ.

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0]
const BIZDEV = COMPTES_SEED[1]
const VIEWER = COMPTES_SEED[2]
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const PREFIXE = 'Sonde 097'
const IA = `${URL_API}/functions/v1/ia`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`

type Revision = { numero: number; origine: string; consigne: string; defauts: { code: string }[]; proposition: Record<string, unknown> }
type Suggestion = { id: string; statut: string; generation_depuis: string | null; derniere_erreur: string | null }

const simule = (enTetes: Record<string, string>, scenario: string) => ({ ...enTetes, 'x-ia-simulateur': scenario })

/** Les lignes NDJSON du flux (docs/SPEC-ia.md §11.1) : l'identifiant d'abord, l'issue en dernier. */
async function flux(reponse: APIResponse): Promise<Record<string, unknown>[]> {
	expect(reponse.headers()['content-type']).toContain('application/x-ndjson')
	return (await reponse.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
}
const idDe = async (reponse: APIResponse) => (await flux(reponse))[0]?.suggestion_id as string

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

/** La suggestion, relue par la clé de service : l'effet réel, attendu jusqu'à la fin de la génération. */
async function generationFinie(requete: APIRequestContext, id: string): Promise<Suggestion> {
	await expect
		.poll(async () => (await lireService<Suggestion>(requete, `suggestions_ia?id=eq.${id}&select=generation_depuis`))[0]?.generation_depuis, {
			timeout: 20_000,
		})
		.toBeNull()
	return (await lireService<Suggestion>(requete, `suggestions_ia?id=eq.${id}&select=id,statut,generation_depuis,derniere_erreur`))[0] as Suggestion
}

async function creer(requete: APIRequestContext, jeton: string, scenario: string, demande = `${PREFIXE} — un cycle de vente`) {
	return requete.post(`${IA}/suggestions`, {
		headers: simule(enTetesAuthentifies(jeton), scenario),
		data: { workspace_id: ESPACE, portee: 'workflow', demande },
	})
}

test.describe('L’assistant IA — la fonction `ia` (docs/SPEC-ia.md §11)', () => {
	test.afterEach(async ({ request }) => {
		await request.delete(rest(`suggestions_ia?${FILTRE}`), { headers: enTetesService() })
		expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`), 'aucune suggestion de sonde ne doit rester').toEqual([])
	})

	test('l’état : disponible avec le simulateur, clé refusée dite comme telle', async ({ request }) => {
		const disponible = await request.get(`${IA}/etat`, { headers: simule(enTetesAnonymes(), 'valide') })
		expect(await disponible.json()).toEqual({ disponible: true, modele: 'gemma4:e2b' })
		const refusee = await request.get(`${IA}/etat`, { headers: simule(enTetesAnonymes(), 'cle_refusee') })
		expect(await refusee.json()).toEqual({ disponible: false, raison: 'cle_refusee', modele: 'gemma4:e2b' })
	})

	test('l’administratrice demande : 202, puis une révision du modèle en base — clés normalisées, aucun workflow écrit', async ({ request }) => {
		const avant = (await lireService(request, `workflows?select=id&workspace_id=eq.${ESPACE}`)).length
		const reponse = await creer(request, await jetonDe(ADMIN.adresse), 'valide')
		expect(reponse.status(), await reponse.text()).toBe(202)
		const lignes = await flux(reponse)
		const id = lignes[0]?.suggestion_id as string
		expect(lignes.at(-1), 'la dernière ligne porte l’issue').toEqual({ issue: 'revision', defauts: 0 })

		const suggestion = await generationFinie(request, id)
		expect(suggestion).toMatchObject({ statut: 'en_revue', derniere_erreur: null })
		const [revision] = await lireService<Revision>(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=numero,origine,consigne,defauts,proposition`)
		expect(revision).toMatchObject({ numero: 1, origine: 'ia', consigne: `${PREFIXE} — un cycle de vente`, defauts: [] })
		expect(revision?.proposition).toMatchObject({ version: 1, workflow: { nom: "Cycle d'une agence web" } })
		expect((revision?.proposition.etapes as { noeud: string }[]).map((e) => e.noeud)).toEqual(['prise-de-contact', 'maquette', 'gagne-web', 'perdu-web'])
		// Rien dans la configuration avant « Accepter » (docs/SPEC-ia.md §2).
		expect((await lireService(request, `workflows?select=id&workspace_id=eq.${ESPACE}`)).length).toBe(avant)
	})

	test('une proposition incohérente est conservée avec ses défauts ; une sortie hors forme et une clé refusée sont des échecs nommés', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const incoherente = await idDe(await creer(request, jeton, 'incoherente'))
		await generationFinie(request, incoherente)
		const [revision] = await lireService<Revision>(request, `suggestions_ia_revisions?suggestion_id=eq.${incoherente}&select=defauts`)
		expect(revision?.defauts.map((d) => d.code)).toEqual(['etape_initiale', 'transition_etape_absente'])

		for (const [scenario, echec] of [['invalide', 'reponse_invalide'], ['cle_refusee', 'cle_refusee']] as const) {
			const id = await idDe(await creer(request, jeton, scenario))
			expect(await generationFinie(request, id), scenario).toMatchObject({ derniere_erreur: echec })
			expect(await lireService(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=id`), scenario).toEqual([])
		}
	})

	test('le commercial et la lectrice sont refusés PAR LA BASE (403), et rien n’est créé ; sans session, 401', async ({ request }) => {
		for (const compte of [BIZDEV, VIEWER]) {
			const reponse = await creer(request, await jetonDe(compte.adresse), 'valide', `${PREFIXE} — ${compte.role}`)
			expect(reponse.status(), compte.role).toBe(403)
		}
		expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`)).toEqual([])
		const anonyme = await request.post(`${IA}/suggestions`, {
			headers: simule(enTetesAnonymes(), 'valide'),
			data: { workspace_id: ESPACE, portee: 'workflow', demande: `${PREFIXE} — anonyme` },
		})
		expect(anonyme.status()).toBe(401)
	})

	test('rectifier puis revoir : la correction de l’administratrice, puis une révision du modèle qui porte la consigne', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const id = await idDe(await creer(request, jeton, 'valide'))
		await generationFinie(request, id)
		const [premiere] = await lireService<Revision>(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=proposition`)

		// La correction s'écrit par PostgREST, sous la RLS, avec le jeton de l'administratrice.
		const correction = await request.post(rest('suggestions_ia_revisions'), {
			headers: { ...enTetesAuthentifies(jeton), prefer: 'return=minimal' },
			data: { suggestion_id: id, origine: 'correction', proposition: { ...premiere?.proposition, workflow: { nom: 'Refonte corrigée' } } },
		})
		expect(correction.status(), await correction.text()).toBe(201)
		// Un client ne fait pas passer sa révision pour celle du modèle.
		const usurpation = await request.post(rest('suggestions_ia_revisions'), {
			headers: enTetesAuthentifies(jeton),
			data: { suggestion_id: id, origine: 'ia', proposition: { version: 1 } },
		})
		expect(usurpation.status()).toBe(403)

		const revue = await request.post(`${IA}/suggestions/${id}/revue`, {
			headers: simule(enTetesAuthentifies(jeton), 'valide'),
			data: { consigne: 'Ajoute une étape de relance' },
		})
		expect(revue.status()).toBe(202)
		expect((await flux(revue)).at(-1)).toEqual({ issue: 'revision', defauts: 0 })
		await generationFinie(request, id)
		const revisions = await lireService<Revision>(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=numero,origine,consigne&order=numero`)
		expect(revisions.map((r) => `${r.numero}:${r.origine}`)).toEqual(['1:ia', '2:correction', '3:ia'])
		expect(revisions[2]?.consigne).toBe('Ajoute une étape de relance')
	})

	test('une génération en vol refuse une seconde revue (409) ; une suggestion abandonnée est figée (409)', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const id = await idDe(await creer(request, jeton, 'valide'))
		await generationFinie(request, id)
		const revoir = () =>
			request.post(`${IA}/suggestions/${id}/revue`, { headers: simule(enTetesAuthentifies(jeton), 'valide'), data: { consigne: 'Encore' } })

		// Le verrou posé par l'administratrice elle-même, comme le ferait une génération en vol.
		const verrou = await request.patch(rest(`suggestions_ia?id=eq.${id}`), {
			headers: enTetesAuthentifies(jeton),
			data: { generation_depuis: new Date().toISOString() },
		})
		expect(verrou.status()).toBe(204)
		const occupee = await revoir()
		expect([occupee.status(), await occupee.json()]).toEqual([409, { erreur: 'generation_en_cours' }])

		const abandon = await request.patch(rest(`suggestions_ia?id=eq.${id}`), {
			headers: enTetesAuthentifies(jeton),
			data: { statut: 'abandonnee' },
		})
		expect(abandon.status()).toBe(204)
		const figee = await revoir()
		expect([figee.status(), await figee.json()]).toEqual([409, { erreur: 'suggestion_figee' }])

		// Accepter par une mise à jour est refusé : c'est un geste (T2).
		const id2 = await idDe(await creer(request, jeton, 'valide'))
		await generationFinie(request, id2)
		const acceptation = await request.patch(rest(`suggestions_ia?id=eq.${id2}`), {
			headers: enTetesAuthentifies(jeton),
			data: { statut: 'acceptee' },
		})
		expect(acceptation.status()).toBe(403)
	})

	test('la lectrice ne lit aucune suggestion ni révision, même existantes', async ({ request }) => {
		const id = await idDe(await creer(request, await jetonDe(ADMIN.adresse), 'valide'))
		await generationFinie(request, id)
		const jeton = await jetonDe(VIEWER.adresse)
		for (const chemin of [`suggestions_ia?id=eq.${id}&select=id`, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=id`]) {
			const reponse = await request.get(rest(chemin), { headers: enTetesAuthentifies(jeton) })
			expect([reponse.status(), await reponse.json()], chemin).toEqual([200, []])
		}
	})
})
