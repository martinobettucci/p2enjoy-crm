// @verifies CRM-050 (docs/BACKLOG.md) — infrastructure mail de développement
// @verifies INC-272 (docs/INCONSISTENCY_REPORT.md, décision 625) — M2 bis : la limite d'envoi de développement couvre
//           une série de campagnes (docs/SPEC-mail-subsystem.md §11.3)
// @verifies INC-271 (docs/INCONSISTENCY_REPORT.md, décision 624) — M2 rend la boîte système et la base dans l'état
//           trouvé, barrière comprise contre une relève de veille en vol
// @verifies docs/SPEC-mail-subsystem.md §11.4 (domaines et boîtes), §11.6 (ClamAV),
//           §11.8 (ports), §11.9 (preuves exigées)
// @verifies docs/JOURNAL.md décision 235 (le rôle `user`), décision 237 (les deux domaines),
//           décision 238 (aucune bibliothèque), décision 239 (pas de boîte pour le `viewer`)
//
// Ces scénarios exercent des **protocoles**, pas un parcours produit : rien dans le CRM ne lit
// encore ces boîtes (`docs/SPEC-mail-subsystem.md` §11.1). Aucun navigateur n'est lancé ici — la
// preuve visuelle vit dans `roundcube.spec.ts`.
//
// Ce qu'ils prouvent, et qu'aucune preuve existante ne prouvait : qu'un client peut réellement se
// connecter, déposer et relire, sur le serveur que `./runDev.sh` démarre.

import { expect, test } from '@playwright/test'
import { lireEnv } from '../env'
import { instantaneDesBoites, rendreLesBoites } from './menage'
import {
	EICAR,
	authentifierSmtp,
	clamd,
	sessionImap,
	soumettreSmtp,
} from './protocoles'

const HOTE = lireEnv('DEV_BIND_ADDRESS')
const PORT_IMAP = Number(lireEnv('STALWART_IMAP_PORT'))
const PORT_SOUMISSION = Number(lireEnv('STALWART_SUBMISSION_PORT'))
const PORT_GESTION = Number(lireEnv('STALWART_ADMIN_PORT'))
const PORT_CLAMD = Number(lireEnv('CLAMAV_PORT'))

const MDP = lireEnv('STALWART_MAILBOX_PASSWORD')
const DOMAINE_CARDS = lireEnv('CRM_INBOUND_DOMAIN')
const DOMAINE_PERSO = lireEnv('MAIL_DEV_PERSONAL_DOMAIN')

const BOITE_SYSTEME = `systeme@${DOMAINE_CARDS}`
const BOITES_PERSONNELLES = [`admin@${DOMAINE_PERSO}`, `bizdev@${DOMAINE_PERSO}`]

test.describe('M1 — les trois boîtes se connectent réellement en IMAP', () => {
	for (const boite of [BOITE_SYSTEME, ...BOITES_PERSONNELLES]) {
		test(`${boite} ouvre une session, liste ses dossiers et sélectionne INBOX`, async () => {
			const transcription = await sessionImap(HOTE, PORT_IMAP, boite, MDP, [
				'LIST "" "*"',
				'SELECT INBOX',
			])

			// La connexion ABOUTIT : c'est ce qui distingue cette preuve d'un simple « le compte
			// existe ». Un principal créé sans `roles: ["user"]` valide ses identifiants puis
			// refuse la commande sans rien renvoyer (docs/JOURNAL.md décision 235).
			expect(transcription).toContain('a1 OK')
			expect(transcription).toContain('Authentication successful')
			expect(transcription).toMatch(/^\* LIST .* "INBOX"$/m)
			expect(transcription).toContain('a3 OK')
		})
	}

	test('un mot de passe faux est refusé, et la session ne s’ouvre pas', async () => {
		const transcription = await sessionImap(HOTE, PORT_IMAP, BOITE_SYSTEME, 'mauvais-mot-de-passe', [])
		expect(transcription).toMatch(/^a1 NO/m)
		expect(transcription).not.toContain('Authentication successful')
	})

	test('le serveur annonce « / » comme délimiteur de hiérarchie', async () => {
		// Mesure dont `CRM-056` a besoin : les dossiers `CRM/<Track>/<Channel>/<Card>` doivent
		// respecter le délimiteur **annoncé par le serveur**, jamais un délimiteur supposé
		// (docs/SPEC-mail-subsystem.md §4.5).
		const transcription = await sessionImap(HOTE, PORT_IMAP, BOITE_SYSTEME, MDP, ['LIST "" "*"'])
		expect(transcription).toMatch(/^\* LIST \(\) "\/" "INBOX"$/m)
	})
})

test.describe('M2 — le catch-all reçoit une adresse de card jamais déclarée', () => {
	test('un message soumis en SMTP authentifié arrive dans la boîte système et se relit en IMAP', async ({
		request,
	}) => {
		// L'adresse est celle d'une card qui n'existe pas : c'est exactement ce que la boîte
		// système doit attraper (docs/SPEC-mail-subsystem.md §2.1). Le jeton la rend unique à
		// chaque exécution, de sorte qu'un rejeu ne relise pas le message du précédent.
		const jeton = `c-${Math.random().toString(36).slice(2, 10)}`
		const destinataire = `${jeton}@${DOMAINE_CARDS}`
		const messageId = `<${jeton}@preuves.p2enjoy.test>`
		const sujet = `Preuve CRM-050 ${jeton}`
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites([{ adresse: BOITE_SYSTEME, motDePasse: MDP }])

		try {
			const smtp = await soumettreSmtp(HOTE, PORT_SOUMISSION, {
				identifiant: BOITES_PERSONNELLES[0]!,
				motDePasse: MDP,
				expediteur: BOITES_PERSONNELLES[0]!,
				destinataire,
				sujet,
				messageId,
				corps: "Corps de la preuve d'infrastructure.",
			})

			expect(smtp).toMatch(/^235 /m) // authentification acceptée
			expect(smtp).toMatch(/^250 .*queued/im) // message accepté pour remise

		// MESURÉ : `SEARCH HEADER Message-ID "<jeton@domaine>"` ne trouve rien — Stalwart
		// n'indexe pas les chevrons. La forme sans chevrons, elle, trouve. C'est un détail de
		// serveur, et il est écrit ici plutôt que découvert deux fois.
		const critere = `SEARCH HEADER "Message-ID" "${jeton}@preuves.p2enjoy.test"`

			// La remise est asynchrone : la boîte est interrogée jusqu'à ce que le message
			// apparaisse, plutôt qu'après une temporisation arbitraire (`CLAUDE.md` §18).
			await expect
				.poll(
					async () => {
						const imap = await sessionImap(HOTE, PORT_IMAP, BOITE_SYSTEME, MDP, [
							'SELECT INBOX',
							critere,
						])
						return /^\* SEARCH \d/m.test(imap)
					},
					{ timeout: 30_000, message: `Message ${messageId} jamais remis dans ${BOITE_SYSTEME}` },
				)
				.toBe(true)

			// La recherche dit qu'un message correspond ; la relecture dit **lequel**. L'en-tête est
			// relu intact, sujet compris : c'est ce que `CRM-054` devra ingérer.
			const relu = await sessionImap(HOTE, PORT_IMAP, BOITE_SYSTEME, MDP, [
				'SELECT INBOX',
				'FETCH 1:* (BODY[HEADER.FIELDS (SUBJECT MESSAGE-ID TO)])',
			])
			expect(relu).toContain(messageId)
			expect(relu).toContain(sujet)
			expect(relu).toContain(destinataire)
		} finally {
			// LA BOÎTE SYSTÈME EST SEEDÉE ET RELEVÉE EN CONTINU — INC-091, décision 362. Ce
			// scénario ne nettoyait ni la boîte ni la base : chaque exécution y laissait un
			// « Preuve CRM-050 … » que la veille de `CRM-059` remonte en non classé permanent.
			// LA BOÎTE ET LA BASE, DANS L'ORDRE ET AVEC UNE BARRIÈRE — INC-271, décision 624 : une relève de veille
			// partie avant la purge pouvait encore créer la ligne après sa suppression, et l'assertion 9 de
			// `0029_inbox_globale.test.sql`, qui mesure la fuite, l'aurait comptée. `rendreLesBoites` (e2e/mail/menage.ts)
			// purge, attend toute relève en vol, retire la ligne, puis EXIGE l'état trouvé.
			await rendreLesBoites(request, { boites: [{ adresse: BOITE_SYSTEME, motDePasse: MDP }], motif: jeton, avant: dossiersAvant, debut })
		}
	})

	test('la soumission SMTP exige une authentification', async () => {
		// Sans elle, le serveur de développement serait un relais ouvert sur la boucle locale.
		const transcription = await authentifierSmtp(
			HOTE,
			PORT_SOUMISSION,
			BOITE_SYSTEME,
			'mauvais-mot-de-passe',
		)
		expect(transcription).toMatch(/^535 /m)
		expect(transcription).not.toMatch(/^235 /m)
	})
})

// INC-272, DÉCISION 625 — LA LIMITE D'ENVOI DE DÉVELOPPEMENT EST RELEVÉE, ET C'EST UN COMPORTEMENT DU SERVEUR, PAS UNE
// LIGNE DE SCRIPT. Stalwart v0.13.4 limite par défaut un couple (domaine expéditeur, destinataire) à 25 envois par
// heure ; `stalwart/provision.sh` porte cette limite à 1000 pour le seul développement. La preuve soumet RÉELLEMENT
// l'ancienne limite plus un — 26 messages — au même destinataire : sous l'ancienne valeur, la 26e soumission est
// refusée en `452 4.4.5 Rate limit exceeded` (mesuré le 2026-10-12), et la transcription le dit. Le destinataire est
// une adresse de card jamais déclarée, neuve à chaque passage, que le catch-all de la boîte système reçoit : elle ne
// partage son quota avec aucune autre preuve. Les soumissions sont espacées de 250 ms : la limite PAR ADRESSE IP du
// serveur (`5/1s`, relue par l'API, inchangée) est un autre contrôle, que cette preuve ne doit pas mesurer.
const ANCIENNE_LIMITE_PAR_DESTINATAIRE = 25
const ESPACEMENT_SOUS_LA_LIMITE_IP_MS = 250

test.describe('M2 bis — la limite d’envoi de développement couvre une série de campagnes (INC-272)', () => {
	test('l’ancienne limite plus un : toutes les soumissions vers un même destinataire sont acceptées', async ({
		request,
	}) => {
		test.setTimeout(240_000)
		const jeton = `c-${Math.random().toString(36).slice(2, 10)}`
		const destinataire = `${jeton}@${DOMAINE_CARDS}`
		const boite = { adresse: BOITE_SYSTEME, motDePasse: MDP }
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites([boite])

		try {
			for (let rang = 1; rang <= ANCIENNE_LIMITE_PAR_DESTINATAIRE + 1; rang += 1) {
				const transcription = await soumettreSmtp(HOTE, PORT_SOUMISSION, {
					identifiant: BOITES_PERSONNELLES[0]!,
					motDePasse: MDP,
					expediteur: BOITES_PERSONNELLES[0]!,
					destinataire,
					sujet: `Limite INC-272 ${jeton} ${rang}`,
					messageId: `<${jeton}-${rang}@preuves.p2enjoy.test>`,
					corps: 'Preuve de la limite d’envoi de développement.',
				})
				expect(transcription, `soumission ${rang}`).toMatch(/^250 .*queued/im)
				await new Promise((fin) => setTimeout(fin, ESPACEMENT_SOUS_LA_LIMITE_IP_MS))
			}
		} finally {
			await rendreLesBoites(request, { boites: [boite], motif: jeton, avant: dossiersAvant, debut })
		}
	})
})

test.describe("M3 — l'API de gestion n'est pas ouverte", () => {
	test('une requête anonyme est refusée', async ({ request }) => {
		const reponse = await request.get(`http://${HOTE}:${PORT_GESTION}/api/principal`)
		expect(reponse.status()).toBe(401)
	})

	test('un mot de passe faux est refusé', async ({ request }) => {
		const reponse = await request.get(`http://${HOTE}:${PORT_GESTION}/api/principal`, {
			headers: {
				Authorization: `Basic ${Buffer.from(`${lireEnv('STALWART_ADMIN_USER')}:mauvais`).toString('base64')}`,
			},
		})
		expect(reponse.status()).toBe(401)
	})

	test('les trois boîtes attendues existent, et le `viewer` n’en a pas', async ({ request }) => {
		const enTetes = {
			Authorization: `Basic ${Buffer.from(
				`${lireEnv('STALWART_ADMIN_USER')}:${lireEnv('STALWART_ADMIN_PASSWORD')}`,
			).toString('base64')}`,
		}
		const reponse = await request.get(
			`http://${HOTE}:${PORT_GESTION}/api/principal?types=individual&fields=name`,
			{ headers: enTetes },
		)
		expect(reponse.status()).toBe(200)
		const corps = await reponse.text()

		for (const boite of [BOITE_SYSTEME, ...BOITES_PERSONNELLES]) {
			expect(corps).toContain(boite)
		}
		// Farida Nowak lit ; elle ne correspond pas (docs/JOURNAL.md décision 239).
		expect(corps).not.toContain(`viewer@${DOMAINE_PERSO}`)
	})
})

test.describe('M4 — ClamAV sait détecter, pas seulement répondre', () => {
	test('clamd répond PONG', async () => {
		expect(await clamd(HOTE, PORT_CLAMD, 'PING')).toBe('PONG')
	})

	test('clamd détecte la signature de test EICAR', async () => {
		// Un `PONG` prouve qu'un processus écoute ; seule une détection prouve qu'il a sa base de
		// signatures (docs/SPEC-mail-subsystem.md §11.6).
		const verdict = await clamd(HOTE, PORT_CLAMD, { analyser: EICAR })
		expect(verdict).toContain('FOUND')
		expect(verdict).toContain('Eicar-Test-Signature')
	})

	test('un contenu anodin est déclaré sain', async () => {
		// Contre-épreuve : sans elle, un antivirus qui répondrait « FOUND » à tout passerait le
		// contrôle précédent.
		const verdict = await clamd(HOTE, PORT_CLAMD, { analyser: 'Un texte parfaitement anodin.' })
		expect(verdict).toContain('OK')
		expect(verdict).not.toContain('FOUND')
	})
})
