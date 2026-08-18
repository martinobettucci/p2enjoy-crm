// @verifies CRM-054 (docs/BACKLOG.md) — contrat d'API de l'ingestion
// @verifies docs/SPEC-mail-subsystem.md §4.3 (une pièce n'est téléchargeable qu'en `clean`),
//           §15.5 (le bucket est privé et sans politique)
// @verifies docs/SPEC-permissions-rls.md §7, preuve de refus n° 9 et n° 11
// @verifies docs/JOURNAL.md décision 320 ; CLAUDE.md §10
//
// PREUVE DE REFUS N° 9, ENFIN SATISFAISABLE. Elle exigeait des pièces jointes et un bucket : les
// deux existent depuis `CRM-054`. Le scénario CRÉE ses propres lignes avec la clé de service —
// une `infected` et une `pending` —, mesure qu'aucun appelant ne peut les télécharger, puis les
// retire. Le seed n'est jamais touché.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const EMPREINTE = 'a'.repeat(64)
const EMPREINTE_BIS = 'b'.repeat(64)

test.describe('ingestion — ce que la pile refuse', () => {
	// TITRE CORRIGÉ le 2026-08-18 (INC-147). Ce scénario s'annonçait comme le REFUS N° 9 du §7. Il
	// ne l'était pas : il ne DÉPOSE aucun objet avant de le demander, et son assertion accepte
	// `404`. Un objet jamais déposé rend `404` — il serait donc resté vert sans aucune politique de
	// Storage, et même si la pièce saine était librement téléchargeable. Il ne distinguait pas
	// « refusé » de « inexistant ».
	//
	// Il n'est PAS supprimé, et ce qu'il mesure garde une valeur propre : la LIGNE de métadonnées
	// est bien créée, et le bucket ne sert pas un chemin qu'aucun dépôt n'a rempli. C'est un
	// contrôle d'ingestion, pas une preuve d'autorisation — et il s'appelle désormais ainsi.
	//
	// La preuve n° 9, la vraie, est portée par `e2e/api/inbox.spec.ts` §18.5, qui dépose les objets,
	// vérifie que la pièce `clean` se télécharge en `200` avec le bon contenu — le témoin positif —
	// puis mesure le refus des autres. C'est elle que `scripts/verify-preuves-refus.sh` exerce.
	test('un chemin de pièce jamais déposée n’est servi à personne', async ({
		request,
	}) => {
		const identifiant = `<refus9-${Date.now()}@preuves.test>`
		let message: string | undefined

		try {
			const creation = await request.post(`${URL_API}/rest/v1/mail_messages`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE,
					rfc822_message_id: identifiant,
					from_address: 'expediteur@preuves.test',
				},
			})
			expect(creation.status()).toBe(201)
			const [ligne] = (await creation.json()) as { id: string }[]
			message = ligne?.id

			for (const [empreinte, statut] of [
				[EMPREINTE, 'infected'],
				[EMPREINTE_BIS, 'pending'],
			] as const) {
				const piece = await request.post(`${URL_API}/rest/v1/mail_attachments`, {
					headers: { ...enTetesService(), Prefer: 'return=minimal' },
					data: {
						message_id: message,
						filename: `${statut}.bin`,
						mime_type: 'application/octet-stream',
						size_bytes: 3,
						storage_path: `${WORKSPACE}/${message}/${empreinte}`,
						sha256: empreinte,
						av_status: statut,
					},
				})
				expect(piece.status()).toBe(201)

				// Le dépôt réel se fait par le service ; ici, seule la LECTURE est éprouvée, et
				// c'est elle que la preuve n° 9 vise.
				const chemin = `${WORKSPACE}/${message}/${empreinte}`
				for (const entetes of [enTetesAnonymes(), enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))]) {
					const telechargement = await request.get(
						`${URL_API}/storage/v1/object/mail-attachments/${chemin}`,
						{ headers: entetes },
					)
					// 400 ou 404 : l'objet n'est pas servi, et le refus ne dit pas s'il existe.
					expect([400, 401, 403, 404]).toContain(telechargement.status())
				}
			}
		} finally {
			if (message !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
					headers: enTetesService(),
				})
			}
		}
	})

	test('le bucket des pièces jointes n’est pas listable par un appelant', async ({ request }) => {
		for (const entetes of [enTetesAnonymes(), enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))]) {
			const liste = await request.post(
				`${URL_API}/storage/v1/object/list/mail-attachments`,
				{ headers: { ...entetes, 'Content-Type': 'application/json' }, data: { prefix: '' } },
			)
			if (liste.ok()) {
				// Un `200` est acceptable tant qu'il ne révèle AUCUN objet : c'est le refus par
				// défaut de la RLS, qui filtre au lieu de lever une erreur.
				expect((await liste.json()) as unknown[]).toHaveLength(0)
			} else {
				expect([400, 401, 403, 404]).toContain(liste.status())
			}
		}
	})

	test('REFUS N° 11 : un anonyme ne lit aucune des trois tables d’ingestion', async ({ request }) => {
		// LA COLONNE DEMANDÉE EXISTE SUR CHAQUE TABLE, et ce n'est pas un détail : `select=id` sur
		// les occurrences — dont la clé est COMPOSITE — rend `400` avant tout contrôle
		// d'autorisation, et l'assertion aurait mesuré une faute de syntaxe au lieu d'un refus.
		const colonnes = {
			mail_messages: 'id',
			mail_message_occurrences: 'folder',
			mail_attachments: 'id',
		} as const

		for (const [table, colonne] of Object.entries(colonnes)) {
			const reponse = await request.get(`${URL_API}/rest/v1/${table}?select=${colonne}`, {
				headers: enTetesAnonymes(),
			})
			expect([401, 403], `${table} a rendu ${reponse.status()}`).toContain(reponse.status())
		}
	})

	test('un message NON CLASSÉ n’est lisible par personne, pas même l’administratrice', async ({
		request,
	}) => {
		// Ce n'est pas un oubli : l'inbox globale, qui décidera qui voit les non classés,
		// appartient à `CRM-057`. Inventer ici une règle que l'unité suivante devrait défaire
		// serait pire que l'absence, et cette assertion devra tomber à ce moment-là.
		const identifiant = `<nonclasse-${Date.now()}@preuves.test>`
		let message: string | undefined
		try {
			const creation = await request.post(`${URL_API}/rest/v1/mail_messages`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE,
					rfc822_message_id: identifiant,
					from_address: 'expediteur@preuves.test',
				},
			})
			const [ligne] = (await creation.json()) as { id: string }[]
			message = ligne?.id

			const jeton = await jetonDe('admin@p2enjoy.test')
			const lues = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			expect(lues.status()).toBe(200)
			expect((await lues.json()) as unknown[]).toHaveLength(0)

			// Contre-épreuve : la ligne EXISTE bien.
			const parService = await request.get(
				`${URL_API}/rest/v1/mail_messages?id=eq.${message}&select=id`,
				{ headers: enTetesService() },
			)
			expect((await parService.json()) as unknown[]).toHaveLength(1)
		} finally {
			if (message !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, {
					headers: enTetesService(),
				})
			}
		}
	})
})
