// @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : copie cachée et pièces jointes à l'envoi, contrat d'API hors interface
// @verifies docs/SPEC-mail-subsystem.md §19 bis.2 (Cci dans la file, pièces prises sur l'ordinateur, 10 fichiers et
//           10 Mo, bucket privé vérifié en base), §19 bis.3 (les trois refus, taille et type lus dans `storage.objects`,
//           les politiques de stockage) ; docs/SPEC-permissions-rls.md §5 (Storage) ; CLAUDE.md §10 ;
//           docs/JOURNAL.md décisions 719 et 720
//
// TOUT SE MESURE AVEC LES VRAIS JETONS de Camille (admin) et de Driss (business developer), par la vraie API de stockage
// puis la vraie RPC. Rien n'est envoyé : la file n'est vidée que par le worker, que ce fichier ne déclenche pas. Chaque
// scénario retire ses lignes de file et ses objets par la clé de service.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const CARD = '5eed0000-0000-4000-8000-0000000000c1'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const BUCKET = 'mail-outbound-attachments'

const chemin = (personne: string, nom: string) => `${ESPACE}/${personne}/${crypto.randomUUID()}/${nom}`

async function deposer(
	request: APIRequestContext,
	jeton: string | null,
	nom: string,
	contenu: Buffer,
	type = 'text/plain',
) {
	return request.post(`${URL_API}/storage/v1/object/${BUCKET}/${nom}`, {
		headers: {
			apikey: CLE_ANONYME,
			Authorization: `Bearer ${jeton ?? CLE_ANONYME}`,
			'Content-Type': type,
		},
		data: contenu,
	})
}

async function identiteDeService(request: APIRequestContext): Promise<string> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_outbound_identities?select=id&owner_id=is.null&limit=1`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne, 'l’identité de service du seed est introuvable').toBeDefined()
	return ligne!.id
}

async function mettreEnFile(request: APIRequestContext, jeton: string, corps: Record<string, unknown>) {
	return request.post(`${URL_API}/rest/v1/rpc/queue_outbound_email`, {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		data: { p_card_id: CARD, p_to: ['client@exterieur.test'], p_body_text: 'Corps de preuve.', ...corps },
	})
}

test.describe.serial('copie cachée et pièces jointes à l’envoi — hors interface (§19 bis)', () => {
	let camille: string
	let driss: string
	let identite: string
	const objets: string[] = []
	const files: string[] = []

	test.beforeAll(async ({ request }) => {
		camille = await jetonDe('admin@p2enjoy.test')
		driss = await jetonDe('bizdev@p2enjoy.test')
		identite = await identiteDeService(request)
	})

	test.afterAll(async ({ request }) => {
		for (const file of files) {
			await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, { headers: enTetesService() })
		}
		if (objets.length > 0) {
			await request.delete(`${URL_API}/storage/v1/object/${BUCKET}`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { prefixes: objets },
			})
		}
	})

	test('déposer dans SON dossier est accepté ; dans celui d’autrui ou hors d’un espace, refusé', async ({ request }) => {
		const sien = chemin(CAMILLE, 'devis.txt')
		const accepte = await deposer(request, camille, sien, Buffer.from('Devis de démonstration.'))
		expect(accepte.status(), await accepte.text()).toBe(200)
		objets.push(sien)

		const chezDriss = chemin(DRISS, 'usurpe.txt')
		const refus = await deposer(request, camille, chezDriss, Buffer.from('x'))
		expect([400, 403]).toContain(refus.status())

		const horsEspace = `${crypto.randomUUID()}/${CAMILLE}/${crypto.randomUUID()}/x.txt`
		expect([400, 403]).toContain((await deposer(request, camille, horsEspace, Buffer.from('x'))).status())

		const anonyme = await deposer(request, null, chemin(CAMILLE, 'anonyme.txt'), Buffer.from('x'))
		expect([400, 401, 403]).toContain(anonyme.status())
		// LA MESURE QUI IMPOSE LA TRANSLITTÉRATION DU NOM (`nomDeDepot`, §19 bis.5) : une clé accentuée est refusée par
		// l'API de stockage elle-même, avant toute politique.
		const accentue = await deposer(request, camille, chemin(CAMILLE, 'révisée.txt'), Buffer.from('x'))
		expect(accentue.status()).toBe(400)
		expect(await accentue.text()).toContain('Invalid key')
	})

	test('la mise en file garde la Cci et relit taille et type DANS LE STOCKAGE, jamais du client', async ({ request }) => {
		const nom = chemin(CAMILLE, 'proposition.txt')
		const contenu = Buffer.from('Proposition commerciale, version 2.')
		expect((await deposer(request, camille, nom, contenu)).status()).toBe(200)
		objets.push(nom)

		const reponse = await mettreEnFile(request, camille, {
			p_identity_id: identite,
			p_bcc: ['direction@exterieur.test'],
			p_attachments: [nom],
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		const file = (await reponse.json()) as string
		files.push(file)

		const ligne = await request.get(
			`${URL_API}/rest/v1/mail_outbox?select=bcc_addrs,cc_addrs,attachments&id=eq.${file}`,
			{ headers: enTetesService() },
		)
		const [envoi] = (await ligne.json()) as {
			bcc_addrs: string[]
			cc_addrs: string[]
			attachments: { path: string; filename: string; mime_type: string; size_bytes: number }[]
		}[]
		expect(envoi?.bcc_addrs).toEqual(['direction@exterieur.test'])
		expect(envoi?.cc_addrs).toEqual([])
		expect(envoi?.attachments).toEqual([
			{ path: nom, filename: 'proposition.txt', mime_type: 'text/plain', size_bytes: contenu.length },
		])

		// UNE FOIS EN FILE, LE DÉPÔT APPARTIENT À L'ENVOI : son auteur ne peut plus le retirer.
		await request.delete(`${URL_API}/storage/v1/object/${BUCKET}/${nom}`, {
			headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${camille}` },
		})
		const encore = await request.post(`${URL_API}/storage/v1/object/list/${BUCKET}`, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { prefix: nom.split('/').slice(0, 3).join('/') },
		})
		expect(((await encore.json()) as { name: string }[]).map((o) => o.name)).toEqual(['proposition.txt'])
	})

	test('retirer son dépôt PAS ENCORE en file est permis', async ({ request }) => {
		const nom = chemin(CAMILLE, 'brouillon.txt')
		expect((await deposer(request, camille, nom, Buffer.from('brouillon'))).status()).toBe(200)
		const retrait = await request.delete(`${URL_API}/storage/v1/object/${BUCKET}/${nom}`, {
			headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${camille}` },
		})
		expect(retrait.status(), await retrait.text()).toBe(200)
		const liste = await request.post(`${URL_API}/storage/v1/object/list/${BUCKET}`, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { prefix: nom.split('/').slice(0, 3).join('/') },
		})
		expect((await liste.json()) as unknown[]).toEqual([])
	})

	test('joindre la pièce d’autrui est refusé, sans dire qu’elle existe', async ({ request }) => {
		const deDriss = chemin(DRISS, 'interne.txt')
		expect((await deposer(request, driss, deDriss, Buffer.from('note interne'))).status()).toBe(200)
		objets.push(deDriss)

		const refus = await mettreEnFile(request, camille, { p_identity_id: identite, p_attachments: [deDriss] })
		expect(refus.status()).toBe(400)
		expect(((await refus.json()) as { message: string }).message).toBe('attachment_not_available')

		const inconnue = await mettreEnFile(request, camille, {
			p_identity_id: identite,
			p_attachments: [chemin(CAMILLE, 'absente.txt')],
		})
		expect(((await inconnue.json()) as { message: string }).message).toBe('attachment_not_available')
	})

	test('les plafonds : onze fichiers, puis plus de 10 Mo au total', async ({ request }) => {
		const onze = Array.from({ length: 11 }, (_, rang) => chemin(CAMILLE, `f${rang}.txt`))
		const trop = await mettreEnFile(request, camille, { p_identity_id: identite, p_attachments: onze })
		expect(trop.status()).toBe(400)
		expect(((await trop.json()) as { message: string }).message).toBe('too_many_attachments')

		const gros = [chemin(CAMILLE, 'a.bin'), chemin(CAMILLE, 'b.bin')]
		for (const nom of gros) {
			const depot = await deposer(request, camille, nom, Buffer.alloc(6 * 1024 * 1024, 1), 'application/octet-stream')
			expect(depot.status(), await depot.text()).toBe(200)
			objets.push(nom)
		}
		const lourd = await mettreEnFile(request, camille, { p_identity_id: identite, p_attachments: gros })
		expect(lourd.status()).toBe(400)
		expect(((await lourd.json()) as { message: string }).message).toBe('attachments_too_large')
	})
})
