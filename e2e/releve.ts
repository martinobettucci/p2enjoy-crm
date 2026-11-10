// @spec CRM-135 (docs/BACKLOG.md) — la vraie relève et le vrai changement de mot de passe, partagés par les preuves
//       `mail` et `ui` de la relève en échec
// @spec docs/SPEC-mail-subsystem.md §24.3 (l'échec s'écrit, `/poll` rend 502), §24.6 (le seed est inchangé : l'échec naît du
//       véritable parcours) ; §15 (la route interne `/poll`) ; CLAUDE.md §8 (aucune trace fabriquée)
//
// LA RELÈVE EST LA VRAIE : la route interne `/poll` du service `mail-sync`, appelée depuis son conteneur avec son jeton
// interne. LE MOT DE PASSE EST CHANGÉ PAR LE VRAI CHEMIN D'ÉCRITURE, `upsert_mail_inbound_account`, sous le jeton du
// propriétaire de la boîte — la fonction que le formulaire des réglages appelle (§21).

import { execFileSync } from 'node:child_process'
import { conteneur } from './conteneur'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './api/jetons'

export type BoiteEntrante = {
	id: string
	workspace_id: string
	owner_id: string | null
	label: string
	imap_host: string
	imap_port: number
	imap_security: string
	imap_username: string
	status: string
	last_error: string | null
	last_checked_at: string | null
	last_sync_at: string | null
}

const COLONNES =
	'id,workspace_id,owner_id,label,imap_host,imap_port,imap_security,imap_username,status,last_error,last_checked_at,last_sync_at'

/** La ligne telle que la base la porte, lue par la clé de service : un constat, jamais une écriture. */
export async function lireBoite(filtre: string): Promise<BoiteEntrante> {
	const reponse = await fetch(`${URL_API}/rest/v1/mail_inbound_accounts?select=${COLONNES}&${filtre}`, {
		headers: enTetesService(),
	})
	if (reponse.status !== 200) throw new Error(`lecture de la boîte refusée (HTTP ${reponse.status})`)
	const lignes = (await reponse.json()) as BoiteEntrante[]
	if (lignes.length !== 1) throw new Error(`le filtre « ${filtre} » désigne ${lignes.length} boîtes, une seule attendue`)
	return lignes[0]!
}

/** Change le mot de passe par `upsert_mail_inbound_account`, sous le jeton du propriétaire (§21) : `status` repasse `pending`. */
export async function changerMotDePasse(boite: BoiteEntrante, proprietaire: string, motDePasse: string): Promise<void> {
	const jeton = await jetonDe(proprietaire)
	const reponse = await fetch(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
		method: 'POST',
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		body: JSON.stringify({
			p_workspace_id: boite.workspace_id,
			p_label: boite.label,
			p_imap_host: boite.imap_host,
			p_imap_port: boite.imap_port,
			p_imap_security: boite.imap_security,
			p_imap_username: boite.imap_username,
			p_password: motDePasse,
			p_owner_id: boite.owner_id,
		}),
	})
	if (reponse.status !== 200) throw new Error(`changement du mot de passe refusé (HTTP ${reponse.status}) : ${await reponse.text()}`)
}

/** Relève la boîte par `/poll`, depuis le conteneur du service, et rend le statut HTTP — `502` pour une relève en échec. */
export function relever(idBoite: string): number {
	const sortie = execFileSync(
		'docker',
		[
			'exec',
			'-e',
			`COMPTE=${idBoite}`,
			conteneur('mail-sync'),
			'python',
			'-c',
			`
import os, urllib.error, urllib.request
requete = urllib.request.Request(
    "http://127.0.0.1:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll", data=b"", method="POST",
    headers={"Authorization": "Bearer " + os.environ["MAIL_SYNC_INTERNAL_TOKEN"]})
try:
    print(urllib.request.urlopen(requete, timeout=120).status)
except urllib.error.HTTPError as erreur:
    print(erreur.code)
`,
		],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	)
	return Number(sortie.trim())
}

/** Les identifiants que la veille lirait à son prochain tour : `lire_comptes_a_veiller`, exécutée dans le service (§24.5). */
export function comptesAVeiller(): string[] {
	const sortie = execFileSync(
		'docker',
		[
			'exec',
			conteneur('mail-sync'),
			'python',
			'-c',
			`
from mail_sync.config import load_settings
from mail_sync.postgrest import PostgrestClient
reglages = load_settings()
client = PostgrestClient(reglages.SUPABASE_URL, reglages.SERVICE_ROLE_KEY.get_secret_value())
for compte in client.lire_comptes_a_veiller():
    print(compte.identifiant)
`,
		],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	)
	return sortie.split('\n').map((ligne) => ligne.trim()).filter(Boolean)
}

/** Pose `status` par la clé de service : `disabled` n'a aucun chemin d'écriture applicatif (§24.1), et la preuve le rend. */
export async function poserStatut(idBoite: string, status: string, last_error: string | null): Promise<void> {
	const reponse = await fetch(`${URL_API}/rest/v1/mail_inbound_accounts?id=eq.${idBoite}`, {
		method: 'PATCH',
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
		body: JSON.stringify({ status, last_error }),
	})
	if (reponse.status !== 204) throw new Error(`pose du statut refusée (HTTP ${reponse.status})`)
}
