// @spec CRM-050 (docs/BACKLOG.md) — clients de protocole des preuves de messagerie
// @spec docs/SPEC-mail-subsystem.md §11.9 (preuves exigées, sans bibliothèque tierce)
// @spec docs/JOURNAL.md décision 238 (les preuves de protocole ne dépendent d'aucune bibliothèque)
//
// Trois clients minimaux — IMAP, SMTP et `clamd` — écrits sur une socket `node:net`.
//
// AUCUNE BIBLIOTHÈQUE, ET C'EST UN CHOIX. Deux motifs : aucune dépendance n'est ajoutée au dépôt
// pour une unité d'infrastructure (`CLAUDE.md` §19) ; et le point ouvert n° 1 de
// `docs/SPEC-mail-subsystem.md` §10 — le choix d'une bibliothèque IMAP pour `mail-sync` — est
// réservé à `CRM-051`, où il sera instruit. Le trancher ici, par le biais d'un test, serait le
// trancher sans l'instruire.
//
// Une preuve qui écrit `a1 LOGIN` et lit `a1 OK` éprouve le serveur. Une preuve qui appelle une
// bibliothèque éprouve surtout la bibliothèque.

import net from 'node:net'

/** Délai au-delà duquel une absence de réponse est un échec, et non une attente. */
const DELAI_MS = 15_000

/**
 * Dialogue générique : ouvre une socket, envoie des commandes dans l'ordre, et rend la
 * transcription complète.
 *
 * `attendre` décide quand la réponse à la commande courante est complète. Sans lui, un client
 * naïf enverrait la commande suivante au milieu d'une réponse multiligne, et l'échec serait
 * imputé au serveur.
 */
async function dialogue(
	hote: string,
	port: number,
	etapes: readonly { envoi?: string; attendre: (recu: string) => boolean }[],
): Promise<string> {
	return new Promise((resoudre, rejeter) => {
		const socket = net.createConnection({ host: hote, port })
		socket.setEncoding('utf8')

		let transcription = ''
		let tampon = ''
		let index = 0

		const minuterie = setTimeout(() => {
			socket.destroy()
			rejeter(
				new Error(
					`Aucune réponse de ${hote}:${port} après ${DELAI_MS} ms à l'étape ${index}.\n` +
						`Transcription :\n${transcription}`,
				),
			)
		}, DELAI_MS)

		const terminer = () => {
			clearTimeout(minuterie)
			socket.destroy()
			resoudre(transcription)
		}

		socket.on('error', (erreur) => {
			clearTimeout(minuterie)
			rejeter(new Error(`${hote}:${port} — ${erreur.message}\nTranscription :\n${transcription}`))
		})

		socket.on('close', terminer)

		socket.on('data', (morceau: string) => {
			transcription += morceau
			tampon += morceau
			// Une étape peut se satisfaire de plusieurs morceaux TCP : la condition est
			// réévaluée à chaque arrivée, sur le tampon accumulé depuis la commande précédente.
			while (index < etapes.length && etapes[index]!.attendre(tampon)) {
				index += 1
				tampon = ''
				if (index >= etapes.length) {
					terminer()
					return
				}
				const suivante = etapes[index]!.envoi
				if (suivante !== undefined) socket.write(suivante + '\r\n')
			}
		})

		socket.on('connect', () => {
			const premiere = etapes[0]?.envoi
			if (premiere !== undefined) socket.write(premiere + '\r\n')
		})
	})
}

/** Marqueur de fin d'une réponse IMAP étiquetée : la ligne qui rouvre l'étiquette envoyée. */
const finImap = (etiquette: string) => (recu: string) =>
	new RegExp(`^${etiquette} (OK|NO|BAD)`, 'm').test(recu)

/**
 * Ouvre une session IMAP, exécute les commandes données, puis se déconnecte proprement.
 *
 * Les commandes sont étiquetées `a1`, `a2`, … dans l'ordre reçu ; l'appelant écrit la commande
 * sans son étiquette, et lit la transcription complète.
 */
export async function sessionImap(
	hote: string,
	port: number,
	identifiant: string,
	motDePasse: string,
	commandes: readonly string[] = [],
): Promise<string> {
	const toutes = [`LOGIN "${identifiant}" "${motDePasse}"`, ...commandes, 'LOGOUT']
	const etapes = [
		// La bannière du serveur précède toute commande : elle est attendue, pas envoyée.
		{ attendre: (recu: string) => recu.includes('* OK') },
		...toutes.map((commande, rang) => ({
			envoi: `a${rang + 1} ${commande}`,
			attendre: finImap(`a${rang + 1}`),
		})),
	]
	return dialogue(hote, port, etapes)
}

/** Encodage SASL PLAIN : `\0utilisateur\0secret`, en base64. */
export function sasIPlain(identifiant: string, motDePasse: string): string {
	return Buffer.from(`\0${identifiant}\0${motDePasse}`, 'utf8').toString('base64')
}

/**
 * Soumet un message par SMTP, authentifié en SASL PLAIN.
 *
 * Rend la transcription : c'est elle qui porte la preuve — `235` pour l'authentification,
 * `250 … queued` pour l'acceptation.
 */
export async function soumettreSmtp(
	hote: string,
	port: number,
	options: {
		identifiant: string
		motDePasse: string
		expediteur: string
		destinataire: string
		sujet: string
		messageId: string
		corps: string
	},
): Promise<string> {
	const code = (n: string) => (recu: string) => new RegExp(`^${n} `, 'm').test(recu)
	const donnees = [
		`From: ${options.expediteur}`,
		`To: ${options.destinataire}`,
		`Subject: ${options.sujet}`,
		`Message-ID: ${options.messageId}`,
		'',
		options.corps,
		'.',
	].join('\r\n')

	return dialogue(hote, port, [
		{ attendre: code('220') },
		{ envoi: 'EHLO preuves.p2enjoy.test', attendre: (r) => /^250 /m.test(r) },
		{
			envoi: `AUTH PLAIN ${sasIPlain(options.identifiant, options.motDePasse)}`,
			attendre: (r) => /^(235|535) /m.test(r),
		},
		{ envoi: `MAIL FROM:<${options.expediteur}>`, attendre: code('250') },
		{ envoi: `RCPT TO:<${options.destinataire}>`, attendre: code('250') },
		{ envoi: 'DATA', attendre: code('354') },
		{ envoi: donnees, attendre: code('250') },
		{ envoi: 'QUIT', attendre: code('221') },
	])
}

/**
 * Tente une authentification SMTP et s'arrête là.
 *
 * Séparée de `soumettreSmtp` parce qu'une preuve de **refus** ne doit pas poursuivre le dialogue :
 * après un `535`, le serveur répond `503 You must authenticate first` à `MAIL FROM`, et un client
 * qui attendrait `250` resterait bloqué jusqu'à son propre délai — l'échec serait alors imputé à
 * une absence de réponse plutôt qu'au refus, qui est précisément ce qu'on veut prouver.
 */
export async function authentifierSmtp(
	hote: string,
	port: number,
	identifiant: string,
	motDePasse: string,
): Promise<string> {
	return dialogue(hote, port, [
		{ attendre: (r) => /^220 /m.test(r) },
		{ envoi: 'EHLO preuves.p2enjoy.test', attendre: (r) => /^250 /m.test(r) },
		{
			envoi: `AUTH PLAIN ${sasIPlain(identifiant, motDePasse)}`,
			attendre: (r) => /^(235|535) /m.test(r),
		},
		{ envoi: 'QUIT', attendre: (r) => /^221 /m.test(r) },
	])
}

/**
 * Interroge `clamd` en protocole binaire.
 *
 * `INSTREAM` est le seul contrôle capable de distinguer un antivirus **opérant** d'un antivirus
 * sans base de signatures : un `PONG` prouve qu'un processus écoute, pas qu'il sait détecter
 * (`docs/SPEC-mail-subsystem.md` §11.6).
 */
export async function clamd(
	hote: string,
	port: number,
	commande: 'PING' | { analyser: string },
): Promise<string> {
	return new Promise((resoudre, rejeter) => {
		const socket = net.createConnection({ host: hote, port })
		let reponse = ''
		const minuterie = setTimeout(() => {
			socket.destroy()
			rejeter(new Error(`clamd ${hote}:${port} muet après ${DELAI_MS} ms`))
		}, DELAI_MS)

		socket.on('error', (erreur) => {
			clearTimeout(minuterie)
			rejeter(new Error(`clamd ${hote}:${port} — ${erreur.message}`))
		})
		socket.on('data', (morceau: Buffer) => {
			reponse += morceau.toString('utf8')
		})
		socket.on('close', () => {
			clearTimeout(minuterie)
			// MESURÉ : la réponse de `clamd` est terminée par un octet NUL, que `trim()` ne
			// retire pas — `"PONG\0"` s'affiche « PONG » et n'est pourtant pas « PONG ».
			resoudre(reponse.replace(/\0/g, '').trim())
		})
		socket.on('connect', () => {
			if (commande === 'PING') {
				socket.write('zPING\0')
				return
			}
			socket.write('zINSTREAM\0')
			const charge = Buffer.from(commande.analyser, 'utf8')
			const taille = Buffer.alloc(4)
			taille.writeUInt32BE(charge.length)
			// Un bloc de longueur nulle clôt le flux ; sans lui, `clamd` attend indéfiniment.
			socket.write(Buffer.concat([taille, charge, Buffer.alloc(4)]))
		})
	})
}

/**
 * Retire d'une boîte RÉELLE tous les messages dont le sujet contient `motif`, dans TOUS ses
 * dossiers, puis les expurge.
 *
 * @spec INC-091 (docs/INCONSISTENCY_REPORT.md) — arbitrage de `docs/JOURNAL.md` décision 362 :
 *       « chaque preuve qui adresse un envoi réel à une boîte seedée purge ce qu'elle y a déposé,
 *       dans son propre `finally`, par le chemin IMAP — que le message ait été relevé ou non ».
 * @spec CRM-059 (docs/BACKLOG.md) — la boucle de veille §20.10 relève TOUS les comptes.
 *
 * POURQUOI CE N'EST PAS UN `DELETE` EN BASE, ET POURQUOI CETTE DISTINCTION EST LA TOTALITÉ DU
 * DÉFAUT. Purger la **table** n'est pas purger la **boîte**. Un `DELETE` sur `mail_messages` rend
 * `204` en n'effaçant **rien** tant que le compte n'a pas été relevé — et le message, lui, reste
 * dans la boîte IMAP, d'où la veille permanente le remontera au tour suivant. C'est exactement la
 * fuite qu'INC-091 a mesurée, et que l'assertion 9 de `0029_inbox_globale.test.sql` détecte.
 *
 * TOUS LES DOSSIERS, ET PAS SEULEMENT `INBOX`. Entre le dépôt et la purge, la veille a pu relever
 * le message ET le ranger dans le dossier de sa card. Ne balayer qu'`INBOX` laisserait donc
 * précisément les messages que le produit a le mieux traités.
 */
export async function retirerDeLaBoite(
	hote: string,
	port: number,
	identifiant: string,
	motDePasse: string,
	motif: string,
): Promise<void> {
	const inventaire = await sessionImap(hote, port, identifiant, motDePasse, ['LIST "" "*"'])

	// `* LIST (\HasNoChildren) "/" "INBOX"` — le nom est le dernier champ, entre guillemets.
	const dossiers = [...inventaire.matchAll(/^\* LIST \([^)]*\) "[^"]*" "?([^"\r\n]+)"?/gm)].map(
		(trouve) => trouve[1]!,
	)

	for (const dossier of dossiers) {
		const recherche = await sessionImap(hote, port, identifiant, motDePasse, [
			`SELECT "${dossier}"`,
			`UID SEARCH HEADER "Subject" "${motif}"`,
		])

		const ligne = /^\* SEARCH([ \d]*)$/m.exec(recherche)
		const uids = (ligne?.[1] ?? '').trim().split(/\s+/).filter(Boolean)
		if (uids.length === 0) continue

		await sessionImap(hote, port, identifiant, motDePasse, [
			`SELECT "${dossier}"`,
			`UID STORE ${uids.join(',')} +FLAGS (\\Deleted)`,
			'EXPUNGE',
		])
	}
}

/**
 * Chaîne de test EICAR, assemblée à l'exécution.
 *
 * Elle n'existe donc **pas telle quelle** dans un fichier du dépôt : un antivirus qui analyserait
 * le poste d'un développeur mettrait autrement ce fichier en quarantaine, et le dépôt deviendrait
 * inclonable sur cette machine.
 */
export const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-', 'ANTIVIRUS-TEST-FILE!$H+H*'].join(
	'',
)
