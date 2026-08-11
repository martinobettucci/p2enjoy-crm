// @verifies CRM-057 (docs/BACKLOG.md) — contrat d'API de l'inbox globale
// @verifies docs/SPEC-mail-subsystem.md §18.1 (la visibilité suit la boîte), §18.2 (classer exige
//           les deux droits), §18.3 (les compteurs sont ceux de l'appelant), §18.5 (la pièce saine)
// @verifies docs/SPEC-permissions-rls.md §7, preuve de refus n° 9 RÉVISÉE ; CLAUDE.md §10
// @verifies docs/JOURNAL.md décision 327
//
// TOUT SE MESURE HORS INTERFACE, avec de vrais jetons obtenus par la route de connexion. Une règle
// d'accès vérifiée depuis l'écran ne prouve que l'écran.
//
// LE COURRIER VIENT DU SEED (docs/SPEC-seed.md §2.19) : deux messages RÉELLEMENT reçus. Aucun
// message n'est forgé ici — un message fabriqué prouverait le comportement d'une donnée qui
// n'existe pas dans le produit.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const MSGID_NON_CLASSE = '<seed-inbox-non-classe@p2enjoy.test>'
const MSGID_CLASSE = '<seed-inbox-classe@p2enjoy.test>'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

const encode = (valeur: string): string => encodeURIComponent(valeur)

type Message = { id: string; card_id: string | null; classification: string }

async function messageParIdentifiant(
	request: import('@playwright/test').APIRequestContext,
	entetes: Record<string, string>,
	identifiant: string,
): Promise<Message[]> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_messages?select=id,card_id,classification&rfc822_message_id=eq.${encode(identifiant)}`,
		{ headers: entetes },
	)
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as Message[]
}

test.describe('inbox globale — qui voit quoi, hors interface', () => {
	// TÉMOIN AVANT TOUT REFUS : « zéro ligne » est vrai que la RLS refuse ou que la donnée manque
	// (décision 50). La clé de service constate d'abord que les deux messages existent.
	test('TÉMOIN : les deux messages du seed existent, vus par la clé de service', async ({ request }) => {
		const nonClasse = await messageParIdentifiant(request, enTetesService(), MSGID_NON_CLASSE)
		const classe = await messageParIdentifiant(request, enTetesService(), MSGID_CLASSE)
		expect(nonClasse).toHaveLength(1)
		expect(classe).toHaveLength(1)
		expect(nonClasse[0]?.classification).toBe('unclassified')
		expect(classe[0]?.classification).toBe('auto')
		expect(classe[0]?.card_id).not.toBeNull()
	})

	test('l’administratrice voit le message NON CLASSÉ de la boîte du workspace', async ({ request }) => {
		const entetes = enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))
		const lignes = await messageParIdentifiant(request, entetes, MSGID_NON_CLASSE)
		expect(lignes).toHaveLength(1)
	})

	// ABSENCE FIGÉE (§18.1) : aucun rôle de tri n'existe. Le jour où il existera, cette assertion
	// deviendra rouge et désignera la preuve à réécrire — mécanisme de la décision 51.
	test('un membre ordinaire ne voit AUCUN message non classé', async ({ request }) => {
		const entetes = enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test'))
		const lignes = await messageParIdentifiant(request, entetes, MSGID_NON_CLASSE)
		expect(lignes).toHaveLength(0)

		const tousLesNonClasses = await request.get(
			`${URL_API}/rest/v1/mail_messages?select=id&card_id=is.null`,
			{ headers: entetes },
		)
		expect(tousLesNonClasses.status()).toBe(200)
		expect((await tousLesNonClasses.json()) as unknown[]).toHaveLength(0)
	})

	test('le message CLASSÉ, lui, est lisible par qui lit sa card', async ({ request }) => {
		const entetes = enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test'))
		const lignes = await messageParIdentifiant(request, entetes, MSGID_CLASSE)
		expect(lignes).toHaveLength(1)
	})

	test('un anonyme ne lit aucun message, classé ou non', async ({ request }) => {
		for (const identifiant of [MSGID_CLASSE, MSGID_NON_CLASSE]) {
			const reponse = await request.get(
				`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=eq.${encode(identifiant)}`,
				{ headers: enTetesAnonymes() },
			)
			expect([401, 403]).toContain(reponse.status())
		}
	})
})

test.describe('inbox globale — l’arborescence', () => {
	test('les compteurs sont ceux de l’APPELANT, non ceux de la base', async ({ request }) => {
		type Ligne = { card_id: string | null; nombre: number }

		const lire = async (entetes: Record<string, string>): Promise<Ligne[]> => {
			const reponse = await request.post(`${URL_API}/rest/v1/rpc/inbox_arborescence`, {
				headers: { ...entetes, 'Content-Type': 'application/json' },
				data: {},
			})
			expect(reponse.status(), await reponse.text()).toBe(200)
			return (await reponse.json()) as Ligne[]
		}

		const admin = await lire(enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')))
		const membre = await lire(enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test')))

		const nonClasses = (lignes: Ligne[]) => lignes.find((ligne) => ligne.card_id === null)?.nombre ?? -1
		// La ligne des non classés existe TOUJOURS, même à zéro : c'est l'entrée du travail de tri.
		expect(nonClasses(admin)).toBeGreaterThanOrEqual(1)
		expect(nonClasses(membre)).toBe(0)
		// Le membre voit néanmoins le courrier CLASSÉ des cards qu'il lit : deux titres différents.
		expect(membre.filter((ligne) => ligne.card_id !== null).length).toBeGreaterThanOrEqual(1)
	})

	test('un anonyme ne peut pas exécuter l’arborescence', async ({ request }) => {
		const reponse = await request.post(`${URL_API}/rest/v1/rpc/inbox_arborescence`, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: {},
		})
		expect([401, 403, 404]).toContain(reponse.status())
	})
})

test.describe('inbox globale — classer exige les DEUX droits (§18.2)', () => {
	test('un membre ne classe pas un message qu’il n’a pas le droit de VOIR', async ({ request }) => {
		// L'identifiant est obtenu par la clé de SERVICE : l'attaquant réaliste connaît ou devine un
		// identifiant, et la garde ne doit pas dépendre du secret de celui-ci.
		const [message] = await messageParIdentifiant(request, enTetesService(), MSGID_NON_CLASSE)
		expect(message).toBeDefined()

		const entetes = enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test'))
		const cards = await request.get(
			`${URL_API}/rest/v1/cards?select=id&archived_at=is.null&deleted_at=is.null&limit=1`,
			{ headers: entetes },
		)
		expect(cards.status()).toBe(200)
		const [card] = (await cards.json()) as { id: string }[]
		expect(card).toBeDefined()

		const refus = await request.post(`${URL_API}/rest/v1/rpc/classify_message`, {
			headers: { ...entetes, 'Content-Type': 'application/json' },
			data: { p_message_id: message!.id, p_card_id: card!.id },
		})
		expect(refus.status()).toBe(403)
		const corps = (await refus.json()) as { code?: string; message?: string }
		expect(corps.code).toBe('42501')
		expect(corps.message).toBe('forbidden')

		// LE REFUS N'A RIEN ÉCRIT : la ligne est relue par la clé de service, inchangée.
		const [apres] = await messageParIdentifiant(request, enTetesService(), MSGID_NON_CLASSE)
		expect(apres?.classification).toBe('unclassified')
		expect(apres?.card_id).toBeNull()
	})
})

test.describe('inbox globale — la pièce jointe saine, et elle seule (§18.5)', () => {
	// PREUVE DE REFUS N° 9, RÉVISÉE ET RENDUE CONCLUANTE. Trois objets sont RÉELLEMENT déposés dans
	// le bucket par la clé de service — le dépôt est le fait du service, comme en production. Le
	// `clean` est le TÉMOIN : sans lui, « rien ne se télécharge » serait aussi vrai si le bucket
	// était vide, et l'assertion ne prouverait rien du tout.
	test('`clean` se télécharge, `infected`, `pending` et `skipped` non, et l’anonyme rien', async ({
		request,
	}) => {
		const [porteur] = await messageParIdentifiant(request, enTetesService(), MSGID_CLASSE)
		expect(porteur).toBeDefined()

		const pieces = [
			{ statut: 'clean', empreinte: 'c'.repeat(64) },
			{ statut: 'infected', empreinte: 'd'.repeat(64) },
			{ statut: 'pending', empreinte: 'e'.repeat(64) },
			{ statut: 'skipped', empreinte: 'f'.repeat(64) },
		] as const
		const cheminDe = (empreinte: string) => `${WORKSPACE}/${porteur!.id}/${empreinte}`
		const identifiants: string[] = []

		try {
			for (const piece of pieces) {
				const chemin = cheminDe(piece.empreinte)
				const depot = await request.post(`${URL_API}/storage/v1/object/mail-attachments/${chemin}`, {
					headers: { ...enTetesService(), 'Content-Type': 'application/octet-stream' },
					data: Buffer.from(`contenu ${piece.statut}`),
				})
				expect([200, 201], await depot.text()).toContain(depot.status())

				const ligne = await request.post(`${URL_API}/rest/v1/mail_attachments`, {
					headers: { ...enTetesService(), Prefer: 'return=representation' },
					data: {
						message_id: porteur!.id,
						card_id: porteur!.card_id,
						filename: `${piece.statut}.bin`,
						mime_type: 'application/octet-stream',
						size_bytes: 12,
						storage_path: chemin,
						sha256: piece.empreinte,
						av_status: piece.statut,
					},
				})
				expect(ligne.status(), await ligne.text()).toBe(201)
				const [creee] = (await ligne.json()) as { id: string }[]
				if (creee !== undefined) identifiants.push(creee.id)
			}

			const admin = enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))

			// LE TÉMOIN : la pièce saine se télécharge réellement, et son contenu est celui déposé.
			const saine = await request.get(
				`${URL_API}/storage/v1/object/mail-attachments/${cheminDe('c'.repeat(64))}`,
				{ headers: admin },
			)
			expect(saine.status(), await saine.text()).toBe(200)
			expect(await saine.text()).toBe('contenu clean')

			// LES TROIS AUTRES SONT REFUSÉES — au MÊME appelant, sur des objets qui EXISTENT.
			for (const piece of pieces.filter((candidate) => candidate.statut !== 'clean')) {
				const refus = await request.get(
					`${URL_API}/storage/v1/object/mail-attachments/${cheminDe(piece.empreinte)}`,
					{ headers: admin },
				)
				expect([400, 401, 403, 404], `${piece.statut} a rendu ${refus.status()}`).toContain(
					refus.status(),
				)
			}

			// ET L'ANONYME N'OBTIENT RIEN, PAS MÊME LA PIÈCE SAINE.
			for (const piece of pieces) {
				const refus = await request.get(
					`${URL_API}/storage/v1/object/mail-attachments/${cheminDe(piece.empreinte)}`,
					{ headers: enTetesAnonymes() },
				)
				expect([400, 401, 403, 404]).toContain(refus.status())
			}

			// UN MEMBRE QUI NE VOIT PAS LE MESSAGE NE VOIT PAS SA PIÈCE : ici le message est classé
			// dans une card que le viewer ne lit pas, et la pièce saine lui est donc refusée.
			const viewer = enTetesAuthentifies(await jetonDe('viewer@p2enjoy.test'))
			const refusViewer = await request.get(
				`${URL_API}/storage/v1/object/mail-attachments/${cheminDe('c'.repeat(64))}`,
				{ headers: viewer },
			)
			expect([400, 401, 403, 404]).toContain(refusViewer.status())
		} finally {
			// LE SEED N'EST JAMAIS TOUCHÉ : le scénario retire ce qu'il a créé, par identifiant.
			for (const identifiant of identifiants) {
				await request.delete(`${URL_API}/rest/v1/mail_attachments?id=eq.${identifiant}`, {
					headers: enTetesService(),
				})
			}
			for (const piece of pieces) {
				await request.delete(
					`${URL_API}/storage/v1/object/mail-attachments/${cheminDe(piece.empreinte)}`,
					{ headers: enTetesService() },
				)
			}
		}
	})
})
