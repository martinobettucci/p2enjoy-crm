// @spec INC-271 (docs/INCONSISTENCY_REPORT.md ; docs/BACKLOG.md « Correctif arbitré le 2026-10-12 — INC-271 ») — le
//       ménage d'un scénario mail qui envoie dans une boîte que la veille de fond relève
// @spec docs/JOURNAL.md décision 624 (les tests ne doivent pas entrer en collision, idempotents) ;
//       docs/SPEC-mail-subsystem.md §12.6 (les preuves `e2e/mail` et la veille de fond), §4.5 (le produit COPIE le
//       message rangé dans le dossier de sa card), §20.10 (la veille relève tout compte doté d'un secret) ; INC-266
//       (une seule relève à la fois par compte)
//
// LE MOTIF, MESURÉ LE 2026-10-12. Un message envoyé depuis une card vers une boîte relevée par la veille y est reconnu
// comme appartenant à la card, et la veille en RANGE une copie sous `CRM/<track>/<channel>/<card>`, dossiers créés au
// passage, correspondances écrites dans `mail_folder_map`. Ne purger que la boîte laissait ces dossiers derrière le
// scénario — selon que la veille était passée ou non —, et une relève de veille partie avant la purge réinsérait encore
// une ligne `mail_messages` après le ménage. Le reliquat dépendait de l'instant : exactement ce que l'arbitrage exclut.

// @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
import { conteneur } from '../conteneur'
import { execFileSync } from 'node:child_process'
import { expect, type APIRequestContext } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesService } from '../api/jetons'
import { retirerDeLaBoite, sessionImap } from './protocoles'

const CONTENEUR = conteneur('mail-sync')
const IMAGE = 'python:3.13.13-slim-bookworm'
const URL_API = urlApi()

/** Une boîte réelle du serveur de développement, et ce qu'il faut pour l'ouvrir. */
export type Boite = { readonly adresse: string; readonly motDePasse: string }

function hoteImap(): { hote: string; port: number } {
	return { hote: lireEnv('DEV_BIND_ADDRESS'), port: Number(lireEnv('STALWART_IMAP_PORT')) }
}

/** Les dossiers d'une boîte, sous la forme que le serveur rend (UTF-7 modifié) — celle que `DELETE` attend. */
async function dossiersDe(boite: Boite): Promise<string[]> {
	const { hote, port } = hoteImap()
	const inventaire = await sessionImap(hote, port, boite.adresse, boite.motDePasse, ['LIST "" "*"'])
	return [...inventaire.matchAll(/^\* LIST \([^)]*\) "[^"]*" "?([^"\r\n]+)"?/gm)].map((trouve) => trouve[1]!).sort()
}

/** Les dossiers de chaque boîte, AVANT le scénario : l'état que le ménage doit rendre. */
export async function instantaneDesBoites(boites: readonly Boite[]): Promise<Record<string, string[]>> {
	const instantane: Record<string, string[]> = {}
	for (const boite of boites) instantane[boite.adresse] = await dossiersDe(boite)
	return instantane
}

/**
 * Relève un compte par la route interne `/poll` — la BARRIÈRE du ménage. Le verrou par compte (INC-266) la fait
 * attendre la fin d'une relève de veille déjà en vol ; partie après la purge, elle-même ne trouve plus rien.
 */
function releverParLaRoute(compte: string): void {
	const reseau = execFileSync(
		'docker',
		['inspect', CONTENEUR, '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'],
		{ encoding: 'utf8', timeout: 60_000 },
	).trim()
	const statut = execFileSync(
		'docker',
		[
			'run', '--rm', '--network', reseau, '-e', 'COMPTE', '-e', 'JETON', IMAGE, 'python', '-c',
			`
import os, urllib.request
requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll", data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
with urllib.request.urlopen(requete, timeout=300) as r:
    print(r.status, end="")
`,
		],
		{
			encoding: 'utf8',
			timeout: 330_000,
			env: { ...process.env, COMPTE: compte, JETON: lireEnv('MAIL_SYNC_INTERNAL_TOKEN') },
		},
	).trim()
	expect(statut, `la relève-barrière du compte ${compte}`).toBe('200')
}

/**
 * REND LES BOÎTES DANS L'ÉTAT OÙ LE SCÉNARIO LES A TROUVÉES, dans l'ordre qui ne donne à la veille aucune raison d'agir :
 *
 *   1. le message, dans TOUS les dossiers de chaque boîte — plus rien à ingérer ni à ranger ;
 *   2. la barrière, une relève de chaque compte concerné — plus aucune relève en vol ;
 *   3. ses lignes en base (`motif` dans le sujet) ;
 *   4. les correspondances de dossier nées pendant le scénario — plus rien à renommer ;
 *   5. les dossiers nés pendant le scénario, les plus profonds d'abord.
 *
 * Puis l'état rendu est EXIGÉ : les dossiers trouvés, aucun message du scénario dans aucun dossier, aucune ligne en base.
 */
export async function rendreLesBoites(
	request: APIRequestContext,
	options: {
		readonly boites: readonly Boite[]
		readonly motif: string
		readonly avant: Record<string, string[]>
		readonly debut: string
	},
): Promise<void> {
	const { hote, port } = hoteImap()
	for (const boite of options.boites) await retirerDeLaBoite(hote, port, boite.adresse, boite.motDePasse, options.motif)

	const filtre = options.boites.map((boite) => `imap_username.eq.${boite.adresse}`).join(',')
	const comptes = await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id&or=(${filtre})`, {
		headers: enTetesService(),
	})
	for (const { id } of (await comptes.json()) as { id: string }[]) releverParLaRoute(id)

	await request.delete(`${URL_API}/rest/v1/mail_messages?subject=like.*${options.motif}*`, { headers: enTetesService() })
	await request.delete(`${URL_API}/rest/v1/mail_folder_map?created_at=gte.${encodeURIComponent(options.debut)}`, {
		headers: enTetesService(),
	})

	for (const boite of options.boites) {
		const connus = new Set(options.avant[boite.adresse] ?? [])
		const nes = (await dossiersDe(boite)).filter((nom) => !connus.has(nom))
		const parProfondeur = [...nes].sort((a, b) => b.split('/').length - a.split('/').length)
		if (parProfondeur.length === 0) continue
		const transcription = await sessionImap(
			hote,
			port,
			boite.adresse,
			boite.motDePasse,
			parProfondeur.map((nom) => `DELETE "${nom}"`),
		)
		expect(transcription, `suppression des dossiers nés dans ${boite.adresse}`).not.toMatch(/^a\d+ (NO|BAD)/m)
	}

	expect(await instantaneDesBoites(options.boites), 'les boîtes sont rendues dans l’état trouvé').toEqual(options.avant)
	for (const boite of options.boites) {
		for (const dossier of await dossiersDe(boite)) {
			const recherche = await sessionImap(hote, port, boite.adresse, boite.motDePasse, [
				`EXAMINE "${dossier}"`,
				`UID SEARCH HEADER "Subject" "${options.motif}"`,
			])
			const trouves = (/^\* SEARCH([ \d]*)$/m.exec(recherche)?.[1] ?? '').trim()
			expect(trouves, `un message du scénario survit dans ${boite.adresse} / ${dossier}`).toBe('')
		}
	}
	const restes = await request.get(`${URL_API}/rest/v1/mail_messages?select=id&subject=like.*${options.motif}*`, {
		headers: enTetesService(),
	})
	expect(await restes.json(), 'aucune ligne du scénario ne survit au ménage').toEqual([])
}
