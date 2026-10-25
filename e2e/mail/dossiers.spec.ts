// @verifies CRM-056 (docs/BACKLOG.md) — arborescence IMAP, vérifiée PAR UN CLIENT IMAP
// @verifies INC-271 (docs/INCONSISTENCY_REPORT.md, décision 624) — aucune collision avec la veille : le contrat est
//           jugé sur l'état final, et le nettoyage ne laisse aucune correspondance vers un dossier supprimé
// @verifies docs/SPEC-mail-subsystem.md §4.5 (dossiers imbriqués, renommage, copie et non
//           déplacement), §17.1 (le RENAME emporte les enfants), §17.2
// @verifies docs/JOURNAL.md décisions 323, 324 et 325
//
// L'ARBORESCENCE EST LUE PAR UN CLIENT IMAP TIERS, et c'est ce que la Definition of Done exige.
// Le client vit dans un conteneur jetable — il n'est ni le service, ni sa connexion : si le
// produit se trompait de dossier, la lecture le verrait.
//
// Le scénario crée son propre message, renomme un vrai track, constate la propagation, puis rend
// le nom d'origine et retire ce qu'il a créé. Le seed est rendu tel qu'il a été reçu.

// @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
import { conteneur } from '../conteneur'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesService } from '../api/jetons'

const CONTENEUR = conteneur('mail-sync')
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 300_000 }).trim()
}

// INC-151 — CALCUL RENDU PARESSEUX le 2026-08-18. Cette valeur était une constante de premier
// niveau, donc un appel `docker` à l'IMPORT du module. Docker absent, l'import levait et Playwright
// abandonnait le PROJET ENTIER : `--list` rendait « 0 test dans 0 fichier » pour les onze fichiers
// de `e2e/mail/`, alors que neuf seulement portaient le défaut. On ne pouvait donc ni compter ni
// inventorier ces scénarios sans l'infrastructure — au moment précis où l'on en a besoin.
// La valeur et la commande sont INCHANGÉES ; seul le moment du calcul l'est, et il est mémoïsé.
let reseauMemo: string | undefined
function reseau(): string {
	reseauMemo ??= docker(
		'inspect',
		CONTENEUR,
		'--format',
		'{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}',
	)
	return reseauMemo
}

function python(source: string, variables: Record<string, string> = {}): string {
	const arguments_ = ['run', '--rm', '--network', reseau()]
	for (const [nom, valeur] of Object.entries(variables)) arguments_.push('-e', `${nom}=${valeur}`)
	arguments_.push(IMAGE, 'python', '-c', source)
	return docker(...arguments_)
}

/**
 * L'arborescence telle qu'un CLIENT IMAP la voit — `imaplib`, la bibliothèque standard, et non
 * celle du service. Deux bibliothèques différentes ne peuvent pas se tromper de la même façon.
 *
 * Les noms circulent en UTF-7 modifié sur le fil (§17.1) : `imaplib` ne le décode pas, la lecture
 * le fait donc ici, explicitement.
 */
function arborescence(): string[] {
	const brut = python(`
import base64, imaplib, re

def decoder(nom):
    """Décode l'UTF-7 modifié de la RFC 3501 — \`&AOk-\` pour \`é\`, \`&-\` pour \`&\`.

    UN CLIENT QUI NE DÉCODE PAS NE VÉRIFIE PAS GRAND-CHOSE : la Definition of Done demande de
    vérifier l'arborescence par un client IMAP, et un nom illisible ne prouve que le fil.
    \`imaplib\` ne fournit pas ce décodage — \`IMAPClient\` si, et c'est précisément pourquoi il
    n'est pas employé ici : deux bibliothèques différentes ne se trompent pas de la même façon.
    """
    def bloc(correspondance):
        contenu = correspondance.group(1)
        if contenu == '':
            return '&'
        rembourrage = '=' * ((4 - len(contenu) % 4) % 4)
        return base64.b64decode(contenu.replace(',', '/') + rembourrage).decode('utf-16-be')
    return re.sub(r'&([A-Za-z0-9+,]*)-', bloc, nom)

c = imaplib.IMAP4('stalwart', 143)
c.login('systeme@crm.p2enjoy.test', 'SeedDev2026Local')
typ, dossiers = c.list()
for d in dossiers:
    nom = decoder(d.decode('utf-8').rsplit(' "/" ', 1)[-1].strip('"'))
    if nom.startswith('CRM'):
        print(nom)
c.logout()
`)
	return brut.split('\n').map((ligne) => ligne.trim()).filter(Boolean).sort()
}

/**
 * L'ENCODEUR EST LE PENDANT DU DÉCODEUR, ET IL A MANQUÉ — défaut trouvé quand le seed de `CRM-057`
 * a fait entrer du courrier dans une card dont le titre porte un tiret cadratin.
 *
 * `imaplib` transmet le nom de boîte tel quel et le serveur l'attend en **UTF-7 modifié**
 * (RFC 3501) : un nom non ASCII lève `UnicodeEncodeError` avant même d'atteindre le réseau. La
 * bibliothèque du produit — IMAPClient — encode toute seule ; la sonde doit donc parler la même
 * langue (décision 324), sans quoi elle échoue là où le produit réussit.
 */
const ENCODEUR_UTF7 = `
def encoder(nom):
    sortie = []
    tampon = ''
    def vider():
        nonlocal tampon
        if tampon:
            brut = base64.b64encode(tampon.encode('utf-16-be')).decode('ascii')
            sortie.append('&' + brut.rstrip('=').replace('/', ',') + '-')
            tampon = ''
    for caractere in nom:
        if caractere == '&':
            vider()
            sortie.append('&-')
        elif 0x20 <= ord(caractere) <= 0x7E:
            vider()
            sortie.append(caractere)
        else:
            tampon += caractere
    vider()
    return ''.join(sortie)
`

function messagesDuDossier(chemin: string): number {
	const brut = python(
		`
import base64, imaplib, os
${ENCODEUR_UTF7}
c = imaplib.IMAP4('stalwart', 143)
c.login('systeme@crm.p2enjoy.test', 'SeedDev2026Local')
typ, data = c.select('"%s"' % encoder(os.environ['CHEMIN']), readonly=True)
print(0 if typ != 'OK' else int(data[0]))
c.logout()
`,
		{ CHEMIN: chemin },
	)
	return Number(brut.trim())
}

function envoyer(identifiant: string, destinataire: string): void {
	python(
		`
import os, smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg['From'] = 'admin@p2enjoy.test'
msg['To'] = os.environ['DEST']
msg['Subject'] = 'Dossiers ' + os.environ['ID']
msg['Message-ID'] = '<' + os.environ['ID'] + '@p2enjoy.test>'
msg.set_content('Message rangé dans son dossier.')
s = smtplib.SMTP('stalwart', 587, timeout=30)
s.ehlo()
s.login('admin@p2enjoy.test', 'SeedDev2026Local')
s.send_message(msg)
s.quit()
`,
		{ ID: identifiant, DEST: destinataire },
	)
}

function relever(compte: string): Record<string, number> {
	const brut = python(
		`
import os, urllib.error, urllib.request
requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll",
    data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(requete, timeout=180) as r:
        print(r.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.read().decode(), end="")
`,
		{ COMPTE: compte, JETON },
	)
	return JSON.parse(brut) as Record<string, number>
}

/**
 * Le message de la preuve, tel que la base le porte : la card à laquelle il est rangé.
 *
 * LE CONTRAT EST JUGÉ SUR L'ÉTAT, JAMAIS SUR LE COMPTE D'UNE RELÈVE — INC-271, décision 624. La veille de fond relève la
 * même boîte toutes les minutes : elle peut ranger le message AVANT la relève que la preuve déclenche, qui rend alors
 * `filed: 0` pour un produit correct. Ce qui compte est que le message soit rangé, et dans la bonne card.
 */
async function cardDuMessage(
	request: import('@playwright/test').APIRequestContext,
	identifiant: string,
): Promise<string | null> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}&select=card_id`,
		{ headers: enTetesService() },
	)
	const [message] = (await reponse.json()) as { card_id: string | null }[]
	return message?.card_id ?? null
}

/**
 * Le nettoyage, DANS CET ORDRE — INC-271, décision 624. La boîte d'abord : sans le message sur le serveur, aucune relève
 * ne peut le réingérer. Puis le message en base : sans lui, aucun rangement ne reste à reprendre. Puis les
 * correspondances : sans elles, aucune divergence ne reste à renommer. Les dossiers IMAP en dernier. Dans l'ordre que
 * le scénario suivait, un tour de veille tombé entre la purge des dossiers et la suppression des correspondances voyait
 * une correspondance vers un dossier disparu, et journalisait `folder_rename_refused` (mesuré le 2026-10-11).
 * `avantDossiers` s'exécute après les correspondances et avant les dossiers : le renommage en retour d'un track y prend
 * place, quand plus aucune correspondance ne peut en faire une divergence.
 * Entre la purge et la base, une BARRIÈRE : une relève du compte par `/poll`, que le verrou par compte (INC-266) fait
 * attendre la fin d'une relève de veille déjà en vol — partie avant la purge, elle réinsérait sinon une ligne ou une
 * correspondance après le ménage (mesuré sur `envoi.spec.ts` le 2026-10-12). Elle-même ne trouve plus rien.
 */
async function nettoyerDansLOrdre(
	request: import('@playwright/test').APIRequestContext,
	compte: string,
	identifiant: string,
	avantDossiers: () => Promise<void> = async () => undefined,
): Promise<void> {
	purgerLaBoite(identifiant)
	relever(compte)
	await request.delete(
		`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}`,
		{ headers: enTetesService() },
	)
	await request.delete(`${URL_API}/rest/v1/mail_folder_map?actual_path=like.CRM*`, { headers: enTetesService() })
	await avantDossiers()
	supprimerLesDossiers(['CRM'])
}

/** Retire le message de la preuve de la boîte (INBOX, Junk Mail) — premier temps du nettoyage (INC-271). */
function purgerLaBoite(identifiant: string): void {
	python(
		`
import os, imaplib

c = imaplib.IMAP4('stalwart', 143)
c.login('systeme@crm.p2enjoy.test', 'SeedDev2026Local')
for dossier in ('INBOX', 'Junk Mail'):
    c.select('"%s"' % dossier)
    typ, ids = c.uid('search', None, 'ALL')
    for uid in ids[0].split():
        typ, brut = c.uid('fetch', uid, '(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])')
        if os.environ['ID'].encode() in brut[0][1]:
            c.uid('store', uid, '+FLAGS', '(\\\\Deleted)')
    c.expunge()
c.logout()
`,
		{ ID: identifiant },
	)
}

/** Supprime les dossiers IMAP sous ces préfixes, les plus profonds d'abord — dernier temps du nettoyage (INC-271). */
function supprimerLesDossiers(prefixes: string[]): void {
	python(
		`
import os, imaplib

c = imaplib.IMAP4('stalwart', 143)
c.login('systeme@crm.p2enjoy.test', 'SeedDev2026Local')
typ, dossiers = c.list()
noms = []
for d in dossiers:
    nom = d.decode('utf-8').rsplit(' "/" ', 1)[-1].strip('"')
    if any(nom.startswith(p) for p in os.environ['PREFIXES'].split('|')):
        noms.append(nom)
for nom in sorted(noms, key=len, reverse=True):
    try:
        c.delete('"%s"' % nom)
    except Exception:
        pass
c.logout()
`,
		{ PREFIXES: prefixes.join('|') },
	)
}

test.describe('dossiers IMAP — l’arborescence vue par un client', () => {
	test('un message classé crée son arborescence, y est COPIÉ, et reste dans INBOX', async ({
		request,
	}) => {
		test.setTimeout(300_000)
		const identifiant = `dossiers-${Date.now()}`

		const cartes = await request.get(
			`${URL_API}/rest/v1/cards?archived_at=is.null&deleted_at=is.null&select=id,email_local_part&limit=1`,
			{ headers: enTetesService() },
		)
		const [carte] = (await cartes.json()) as { id: string; email_local_part: string }[]

		const comptes = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id`,
			{ headers: enTetesService() },
		)
		const [compte] = (await comptes.json()) as { id: string }[]

		const cheminReponse = await request.post(`${URL_API}/rest/v1/rpc/chemin_dossier_card`, {
			headers: enTetesService(),
			data: { p_card_id: carte!.id },
		})
		const chemin = (await cheminReponse.json()) as string
		expect(chemin.startsWith('CRM/')).toBe(true)
		expect(chemin.split('/')).toHaveLength(4)

		try {
			envoyer(identifiant, `${carte!.email_local_part}@crm.p2enjoy.test`)
			relever(compte!.id)
			// Rangé dans SA card — par cette relève ou par la veille qui l'a précédée (INC-271).
			expect(await cardDuMessage(request, identifiant)).toBe(carte!.id)

			// L'ARBORESCENCE EST LUE PAR UN CLIENT IMAP TIERS, niveau par niveau.
			const arbre = arborescence()
			for (const niveau of ['CRM', chemin.split('/').slice(0, 2).join('/'), chemin.split('/').slice(0, 3).join('/'), chemin]) {
				expect(arbre, `le niveau « ${niveau} » manque`).toContain(niveau)
			}

			// LE MESSAGE EST COPIÉ, ET NON DÉPLACÉ (§4.5) : il est dans le dossier de la card ET
			// toujours dans INBOX. Retirer un message de la boîte de quelqu'un serait destructif.
			expect(messagesDuDossier(chemin)).toBeGreaterThanOrEqual(1)
			expect(messagesDuDossier('INBOX')).toBeGreaterThanOrEqual(1)

			// La correspondance porte les TROIS niveaux, sans quoi renommer un track n'aurait rien
			// à renommer.
			const carte_ = await request.get(
				`${URL_API}/rest/v1/mail_folder_map?select=entity_type,actual_path&order=entity_type`,
				{ headers: enTetesService() },
			)
			const types = ((await carte_.json()) as { entity_type: string }[]).map((l) => l.entity_type)
			expect(types).toContain('track')
			expect(types).toContain('channel')
			expect(types).toContain('card')
		} finally {
			await nettoyerDansLOrdre(request, compte!.id, identifiant)
		}
	})

	test('renommer un TRACK renomme son dossier et emporte ses enfants', async ({ request }) => {
		test.setTimeout(300_000)
		const identifiant = `renom-${Date.now()}`

		const comptes = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id`,
			{ headers: enTetesService() },
		)
		const [compte] = (await comptes.json()) as { id: string }[]

		const cartes = await request.get(
			`${URL_API}/rest/v1/cards?archived_at=is.null&deleted_at=is.null&select=id,email_local_part,channel_id&limit=1`,
			{ headers: enTetesService() },
		)
		const [carte] = (await cartes.json()) as {
			id: string
			email_local_part: string
			channel_id: string
		}[]
		const canaux = await request.get(
			`${URL_API}/rest/v1/channels?id=eq.${carte!.channel_id}&select=track_id`,
			{ headers: enTetesService() },
		)
		const [canal] = (await canaux.json()) as { track_id: string }[]
		const pistes = await request.get(
			`${URL_API}/rest/v1/tracks?id=eq.${canal!.track_id}&select=name`,
			{ headers: enTetesService() },
		)
		const [piste] = (await pistes.json()) as { name: string }[]
		const nomOrigine = piste!.name
		const nomTemporaire = `${nomOrigine} (renommé ${Date.now()})`

		try {
			envoyer(identifiant, `${carte!.email_local_part}@crm.p2enjoy.test`)
			relever(compte!.id)
			expect(await cardDuMessage(request, identifiant)).toBe(carte!.id)

			await request.patch(`${URL_API}/rest/v1/tracks?id=eq.${canal!.track_id}`, {
				headers: enTetesService(),
				data: { name: nomTemporaire },
			})

			const apres = relever(compte!.id)
			// UN SEUL RENOMMAGE SUFFIT : le `RENAME` d'un parent emporte ses enfants (§17.1). Cette relève en fait un, ou
			// aucun si la veille l'a précédée (INC-271) — jamais deux : l'arborescence et les trois correspondances,
			// relues ci-dessous, disent que le parent a bien emporté ses enfants.
			expect(apres['renamed'], JSON.stringify(apres)).toBeLessThanOrEqual(1)

			const arbre = arborescence()
			expect(arbre.some((n) => n.includes('(renommé'))).toBe(true)
			expect(arbre.filter((n) => n === `CRM/${nomOrigine}`)).toHaveLength(0)

			// LES TROIS CORRESPONDANCES ONT SUIVI EN BASE, comme les dossiers ont suivi sur le
			// serveur : sans cela, la relève suivante croirait devoir les renommer encore.
			const carte_ = await request.get(
				`${URL_API}/rest/v1/mail_folder_map?select=entity_type,actual_path`,
				{ headers: enTetesService() },
			)
			const chemins = ((await carte_.json()) as { actual_path: string }[]).map(
				(l) => l.actual_path,
			)
			expect(chemins).toHaveLength(3)
			expect(chemins.every((c) => c.includes('(renommé'))).toBe(true)

			// Et une seconde relève ne renomme plus rien : la divergence est résolue.
			expect(relever(compte!.id)['renamed']).toBe(0)
		} finally {
			// Le track est renommé en retour APRÈS la suppression des correspondances : il n'y a alors plus aucune
			// divergence qu'un tour de veille pourrait vouloir résoudre (INC-271).
			await nettoyerDansLOrdre(request, compte!.id, identifiant, async () => {
				await request.patch(`${URL_API}/rest/v1/tracks?id=eq.${canal!.track_id}`, {
					headers: enTetesService(),
					data: { name: nomOrigine },
				})
			})
		}
	})
})
