// @verifies CRM-160 (docs/BACKLOG.md) — l'oracle ajoute les deux règles d'une réponse reçue dans une affaire : qui a écrit
//           dans le fil (i), le responsable d'un rattachement non archivé (ii) ; la réponse seedée du §53 concerne Camille
//           et Driss, pas la lectrice, et le dossier de Vertuo la compte (docs/SPEC-mail-subsystem.md §27.7 ;
//           docs/SPEC-seed.md §53 ; décisions 959 et 960)
// @verifies CRM-156 (docs/BACKLOG.md) — tranche T5 : l'oracle de « Seulement moi » ajoute la voie du transfert (décision 51 ;
//           docs/SPEC-mail-subsystem.md §32.7 ; docs/SPEC-seed.md §49)
// @verifies CRM-144 (docs/BACKLOG.md) — tranche T5 : les deux identités de démonstration de Camille comptées
//           (docs/SPEC-seed.md §42 ; décision 913)
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
	workspace_id: string
	card_id: string | null
	direction: string
	rfc822_message_id: string
	references_ids: string[] | null
	from_address: string
	to_addresses: string[] | null
	cc_addresses: string[] | null
	bcc_addresses: string[] | null
}

const COLONNES = 'id,workspace_id,card_id,direction,rfc822_message_id,references_ids,from_address,to_addresses,cc_addresses,bcc_addresses'
/** La réponse du seed §53, adressée à la seule adresse de Vertuo, dans le fil de l'envoi de Camille. */
const REPONSE_AFFAIRE = '<seed-reponse-affaire@p2enjoy.test>'
const VERTUO = '5eed0000-0000-4000-8000-00000000d012'

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

/** La clé de fil de `app.cle_fil` : le premier `References`, ou le `Message-ID` propre. */
const cleFil = (m: Message) => m.references_ids?.[0] ?? m.rfc822_message_id

/** Ce que l'oracle sait d'une personne, lu par la clé de service. */
type Personne = { adresses: Set<string>; responsable: Set<string>; transferes: Set<string> }

async function personne(request: APIRequestContext, idPersonne: string): Promise<Personne> {
	const rattachements = await service<{ card_id: string }[]>(
		request,
		`card_placements?select=card_id&owner_id=eq.${idPersonne}&archived_at=is.null`,
	)
	const transferts = await service<{ message_id: string }[]>(
		request,
		`mail_message_transfers?select=message_id&recipient_id=eq.${idPersonne}`,
	)
	return {
		adresses: await adressesDe(request, idPersonne),
		responsable: new Set(rattachements.map((r) => r.card_id)),
		transferes: new Set(transferts.map((t) => t.message_id)),
	}
}

/**
 * L'ORACLE ENTIER de `concerns_me` (§27.2, §27.7.2), calculé sur ce que la personne LIT (`tout`) : ses adresses, ses
 * transferts, et, pour un message reçu et rattaché, (i) un message lu du même fil expédié par l'une de ses adresses, ou
 * (ii) un rattachement actif de l'affaire dont elle est responsable.
 */
function concerneSelon(m: Message, tout: Message[], qui: Personne): boolean {
	if (concerne(m, qui.adresses) || qui.transferes.has(m.id)) return true
	if (m.direction !== 'inbound' || m.card_id === null) return false
	if (qui.responsable.has(m.card_id)) return true
	return tout.some(
		(o) => o.workspace_id === m.workspace_id && cleFil(o) === cleFil(m) && qui.adresses.has(o.from_address.trim().toLowerCase()),
	)
}

/** Ce que la personne LIT, sous son jeton, avec ou sans le filtre. */
async function lus(request: APIRequestContext, jeton: string, filtre: boolean): Promise<Message[]> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_messages?select=${COLONNES}${filtre ? '&concerns_me=is.true' : ''}`,
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

	// RÉVISÉE PAR `CRM-144` T5 (décision 913), non relâchée : Camille porte TROIS identités — la sienne et les deux de
	// démonstration de l'outbox (docs/SPEC-seed.md §42) — et le filtre compte chacune de ses adresses, comme l'oracle.
	test('Camille, trois identités : le filtre rend exactement son courrier, que l’oracle trouve par ses adresses', async ({ request }) => {
		const jeton = await jetonDe(CAMILLE.adresse)
		const qui = await personne(request, CAMILLE.id)
		expect(qui.adresses.size).toBe(3)
		const tout = await lus(request, jeton, false)
		const filtre = await lus(request, jeton, true)
		// RÉVISÉ par `CRM-160` (décision 51), non relâché : l'oracle ajoute les règles (i) et (ii) du §27.7.2.
		expect(tries(filtre)).toEqual(tries(tout.filter((m) => concerneSelon(m, tout, qui))))
		// TÉMOIN : le seed porte du courrier qui la concerne (son envoi de démonstration) et du courrier qui ne la concerne
		// pas (« Candidature spontanée », adressée à la seule boîte système) ; sans les deux, l'égalité ne prouverait rien.
		expect(filtre.length).toBeGreaterThan(0)
		expect(filtre.length).toBeLessThan(tout.length)
	})

	test('les compteurs suivent : « Non classés » et chaque affaire ne comptent que son courrier', async ({ request }) => {
		const jeton = await jetonDe(CAMILLE.adresse)
		const qui = await personne(request, CAMILLE.id)
		const tout = await lus(request, jeton, false)
		// RÉVISÉ par `CRM-160` (décision 51), non relâché : l'oracle entier, règles (i) et (ii) comprises.
		const siens = tout.filter((m) => concerneSelon(m, tout, qui))
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

	// `CRM-160` (§27.7) : la réponse du seed §53, adressée à la seule adresse de Vertuo. Elle est jouée AVANT tout prêt d'identité : la
	// réponse est expédiée par `bizdev@`, et l'adresse prêtée (`BizDev@`) concernerait alors Camille ou la lectrice par l'adresse.
	test('la réponse reçue à la seule adresse d’une affaire : Camille qui a écrit, Driss responsable, pas la lectrice', async ({ request }) => {
		const [reponse] = await service<Message[]>(request, `mail_messages?select=${COLONNES}&rfc822_message_id=eq.${encodeURIComponent(REPONSE_AFFAIRE)}`)
		expect(reponse, 'la réponse du seed §53').toBeDefined()
		expect(reponse!.card_id).toBe(VERTUO)
		expect(reponse!.to_addresses?.every((a) => a.startsWith('c-')), 'adressée à la seule adresse de l’affaire').toBe(true)
		const filtrePar = async (adresse: string) =>
			(await lus(request, await jetonDe(adresse), true)).some((m) => m.id === reponse!.id)
		expect(await filtrePar(CAMILLE.adresse), 'Camille, règle (i) : elle a écrit dans le fil').toBe(true)
		expect(await filtrePar(DRISS.adresse), 'Driss, règle (ii) : il est responsable de Vertuo').toBe(true)
		expect(await filtrePar(LECTRICE.adresse), 'la lectrice n’est pas concernée').toBe(false)
		// Le dossier de Vertuo, filtre posé, la compte pour Camille : son envoi et cette réponse au moins.
		const vertuo = (await arbre(request, await jetonDe(CAMILLE.adresse), true)).find((l) => l.card_id === VERTUO)
		expect(vertuo?.nombre ?? 0).toBeGreaterThanOrEqual(2)
	})

	// RÉVISÉE PAR `CRM-144` T5 (décision 913), non relâchée : l'identité prêtée s'ajoute aux TROIS de Camille (la sienne et
	// les deux de démonstration de l'outbox, docs/SPEC-seed.md §42) ; le filtre réunit toujours le courrier de toutes.
	test('Camille, une identité de plus : le filtre réunit le courrier de toutes', async ({ request }) => {
		await preterIdentite(request, CAMILLE.id)
		const jeton = await jetonDe(CAMILLE.adresse)
		const qui = await personne(request, CAMILLE.id)
		expect(qui.adresses.size).toBe(4)
		const tout = await lus(request, jeton, false)
		const filtre = await lus(request, jeton, true)
		expect(tries(filtre)).toEqual(tries(tout.filter((m) => concerneSelon(m, tout, qui))))
		// Les deux adresses comptent : la seconde, écrite avec des majuscules, ajoute le courrier qu'elle a expédié.
		const parLaSeule = tout.filter((m) => concerne(m, new Set([CAMILLE.adresse])))
		expect(filtre.length).toBeGreaterThan(parLaSeule.length)
	})

	test('Driss : jamais le courrier de Camille, qu’il lit pourtant', async ({ request }) => {
		const jeton = await jetonDe(DRISS.adresse)
		const qui = await personne(request, DRISS.id)
		const tout = await lus(request, jeton, false)
		const filtre = await lus(request, jeton, true)
		// RÉVISÉ par `CRM-156` T5 (décision 51, 2026-11-19) : un mail TRANSFÉRÉ le concerne aussi (§32.7) — le seed §49 lui
		// en transfère un. RÉVISÉ par `CRM-160` (décision 51), non relâché : il est responsable de Vertuo, de `…00c1` et de
		// « Plateforme de billetterie », et leur courrier reçu le concerne (§27.7.2 ii). L'oracle entier, lu par la clé de service.
		expect(qui.transferes.size, 'le seed §49 transfère un mail à Driss').toBeGreaterThan(0)
		expect(qui.responsable.size, 'le seed le fait responsable d’affaires').toBeGreaterThan(0)
		expect(tries(filtre)).toEqual(tries(tout.filter((m) => concerneSelon(m, tout, qui))))
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
			`mail_messages?select=${COLONNES}&from_address=eq.bizdev@p2enjoy.test`,
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
