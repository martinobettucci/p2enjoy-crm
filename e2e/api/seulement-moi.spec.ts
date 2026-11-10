// @verifies CRM-139 (docs/BACKLOG.md) — « Seulement moi » hors interface, avec les jetons réels : `concerns_me` et
//           `inbox_arborescence(p_only_me)` rendent le seul courrier qui concerne l'appelant, par toutes ses identités
//           personnelles ; jamais celui d'une autre personne ; et jamais un message illisible, filtre ou non
// @verifies docs/SPEC-mail-subsystem.md §27.2, §27.3, §27.6 ; docs/JOURNAL.md décisions 879 et 902 ; CLAUDE.md §10
//
// L'ORACLE EST LU PAR LA CLÉ DE SERVICE, sur les adresses en clair des identités personnelles, sans `concerns_me` : la
// preuve ne se vérifie pas par ce qu'elle éprouve.
//
// CE FICHIER ÉCRIT, ET DÉFAIT : le cas de PLUSIEURS identités est monté par la clé de service (une seconde identité de
// Camille, et une identité prêtée à la lectrice), puis retiré en `afterAll`. Le seed n'en porte qu'une par personne, et
// des preuves en comptent exactement trois (docs/SPEC-mail-subsystem.md §27.5).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = { adresse: 'admin@p2enjoy.test', id: '5eed0000-0000-4000-8000-000000000011' }
const DRISS = { adresse: 'bizdev@p2enjoy.test', id: '5eed0000-0000-4000-8000-000000000012' }
const LECTRICE = { adresse: 'viewer@p2enjoy.test', id: '5eed0000-0000-4000-8000-000000000013' }
/** L'adresse que la preuve prête : celle qui a expédié presque tout le courrier du seed. */
const ADRESSE_PRETEE = 'BizDev@P2Enjoy.test'
const LIBELLE = 'Preuve CRM-139'

type Message = {
	id: string
	card_id: string | null
	from_address: string
	to_addresses: string[] | null
	cc_addresses: string[] | null
	bcc_addresses: string[] | null
}

async function service<T>(request: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await request.get(`${URL_API}/rest/v1/${chemin}`, { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T
}

/** Les adresses des identités PERSONNELLES d'une personne, lues par la clé de service. */
async function adressesDe(request: APIRequestContext, idPersonne: string): Promise<Set<string>> {
	const lignes = await service<{ from_address: string }[]>(
		request,
		`mail_outbound_identities?select=from_address&owner_id=eq.${idPersonne}`,
	)
	return new Set(lignes.map((l) => l.from_address.trim().toLowerCase()))
}

function concerne(m: Message, adresses: Set<string>): boolean {
	return [...(m.to_addresses ?? []), ...(m.cc_addresses ?? []), ...(m.bcc_addresses ?? []), m.from_address].some((a) =>
		adresses.has(a.trim().toLowerCase()),
	)
}

/** Ce que la personne LIT, sous son jeton, avec ou sans le filtre. */
async function lus(request: APIRequestContext, jeton: string, filtre: boolean): Promise<Message[]> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_messages?select=id,card_id,from_address,to_addresses,cc_addresses,bcc_addresses${filtre ? '&concerns_me=is.true' : ''}`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as Message[]
}

async function arbre(request: APIRequestContext, jeton: string, seulementMoi: boolean) {
	const reponse = await request.post(`${URL_API}/rest/v1/rpc/inbox_arborescence`, {
		headers: enTetesAuthentifies(jeton),
		data: { p_only_me: seulementMoi },
	})
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as { card_id: string | null; nombre: number }[]
}

async function preterIdentite(request: APIRequestContext, idPersonne: string): Promise<void> {
	const reponse = await request.post(`${URL_API}/rest/v1/mail_outbound_identities`, {
		headers: { ...enTetesService(), prefer: 'return=minimal' },
		data: {
			workspace_id: ESPACE,
			owner_id: idPersonne,
			label: LIBELLE,
			smtp_host: 'smtp.exemple.test',
			smtp_port: 587,
			smtp_username: 'preuve-139',
			from_address: ADRESSE_PRETEE,
		},
	})
	expect(reponse.status()).toBe(201)
}

const tries = (messages: Message[]) => messages.map((m) => m.id).sort()

test.describe.configure({ mode: 'serial' })

test.describe('« Seulement moi » : `concerns_me` et `inbox_arborescence(p_only_me)` par les jetons réels', () => {
	test.afterAll(async ({ request }) => {
		const retrait = await request.delete(
			`${URL_API}/rest/v1/mail_outbound_identities?label=eq.${encodeURIComponent(LIBELLE)}`,
			{ headers: enTetesService() },
		)
		expect(retrait.status()).toBe(204)
	})

	test('Camille, une identité : le filtre rend exactement son courrier, que l’oracle trouve par ses adresses', async ({ request }) => {
		const jeton = await jetonDe(CAMILLE.adresse)
		const adresses = await adressesDe(request, CAMILLE.id)
		expect(adresses.size).toBe(1)
		const tout = await lus(request, jeton, false)
		const filtre = await lus(request, jeton, true)
		expect(tries(filtre)).toEqual(tries(tout.filter((m) => concerne(m, adresses))))
		// TÉMOIN : le seed porte du courrier qui la concerne (son envoi de démonstration) et du courrier qui ne la concerne
		// pas (« Candidature spontanée », adressée à la seule boîte système) ; sans les deux, l'égalité ne prouverait rien.
		expect(filtre.length).toBeGreaterThan(0)
		expect(filtre.length).toBeLessThan(tout.length)
	})

	test('les compteurs suivent : « Non classés » et chaque affaire ne comptent que son courrier', async ({ request }) => {
		const jeton = await jetonDe(CAMILLE.adresse)
		const adresses = await adressesDe(request, CAMILLE.id)
		const siens = (await lus(request, jeton, false)).filter((m) => concerne(m, adresses))
		const lignes = await arbre(request, jeton, true)
		for (const ligne of lignes) {
			expect(ligne.nombre, `dossier ${ligne.card_id ?? 'non classés'}`).toBe(
				siens.filter((m) => m.card_id === ligne.card_id).length,
			)
		}
		// « Non classés » est rendu même à zéro, et une affaire sans courrier qui la concerne n'a pas de ligne.
		expect(lignes.some((l) => l.card_id === null)).toBe(true)
		expect(lignes.filter((l) => l.card_id !== null).every((l) => l.nombre > 0)).toBe(true)
		// Sans argument, l'arborescence d'avant.
		const avant = await request.post(`${URL_API}/rest/v1/rpc/inbox_arborescence`, { headers: enTetesAuthentifies(jeton) })
		expect(await avant.json()).toEqual(await arbre(request, jeton, false))
	})

	test('Camille, DEUX identités : le filtre réunit le courrier des deux', async ({ request }) => {
		await preterIdentite(request, CAMILLE.id)
		const jeton = await jetonDe(CAMILLE.adresse)
		const adresses = await adressesDe(request, CAMILLE.id)
		expect(adresses.size).toBe(2)
		const tout = await lus(request, jeton, false)
		const filtre = await lus(request, jeton, true)
		expect(tries(filtre)).toEqual(tries(tout.filter((m) => concerne(m, adresses))))
		// Les deux adresses comptent : la seconde, écrite avec des majuscules, ajoute le courrier qu'elle a expédié.
		const parLaSeule = tout.filter((m) => concerne(m, new Set([CAMILLE.adresse])))
		expect(filtre.length).toBeGreaterThan(parLaSeule.length)
	})

	test('Driss : jamais le courrier de Camille, qu’il lit pourtant', async ({ request }) => {
		const jeton = await jetonDe(DRISS.adresse)
		const adresses = await adressesDe(request, DRISS.id)
		const tout = await lus(request, jeton, false)
		const filtre = await lus(request, jeton, true)
		expect(tries(filtre)).toEqual(tries(tout.filter((m) => concerne(m, adresses))))
		const deCamille = tout.filter((m) => m.from_address === CAMILLE.adresse)
		expect(deCamille.length, 'il lit au moins un envoi de Camille').toBeGreaterThan(0)
		expect(filtre.some((m) => m.from_address === CAMILLE.adresse)).toBe(false)
	})

	test('la lectrice : une adresse qui expédie presque tout le seed ne lui ouvre AUCUN message qu’elle ne lit pas', async ({ request }) => {
		const jeton = await jetonDe(LECTRICE.adresse)
		expect(await lus(request, jeton, true)).toEqual([])
		await preterIdentite(request, LECTRICE.id)
		const tout = await lus(request, jeton, false)
		const filtre = await lus(request, jeton, true)
		// LE FILTRE RESTREINT, IL N'OUVRE RIEN : ce qu'il rend est un sous-ensemble de ce qu'elle lit.
		expect(tries(filtre).every((id) => tout.some((m) => m.id === id))).toBe(true)
		const illisibles = await service<Message[]>(
			request,
			`mail_messages?select=id,card_id,from_address,to_addresses,cc_addresses,bcc_addresses&from_address=eq.bizdev@p2enjoy.test`,
		)
		const nonLus = illisibles.filter((m) => !tout.some((l) => l.id === m.id))
		expect(nonLus.length, 'du courrier de cette adresse lui reste illisible').toBeGreaterThan(0)
		expect(filtre.some((m) => nonLus.some((n) => n.id === m.id))).toBe(false)
	})

	test('l’anonyme n’exécute pas l’arborescence', async ({ request }) => {
		const reponse = await request.post(`${URL_API}/rest/v1/rpc/inbox_arborescence`, {
			headers: enTetesAnonymes(),
			data: { p_only_me: true },
		})
		expect([401, 403]).toContain(reponse.status())
	})
})
