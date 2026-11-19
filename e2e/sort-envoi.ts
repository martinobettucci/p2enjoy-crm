// @spec CRM-158 (docs/BACKLOG.md) — le sort d'un envoi lu sur SA ligne, et non sur le compte rendu d'une passe : la boucle
//       d'envoi de `mail-sync` a pu le prendre avant la passe d'une preuve (docs/SPEC-mail-subsystem.md §34.7 ;
//       docs/SPEC-seed.md §42 ; docs/JOURNAL.md décision 954)
//
// @spec CRM-158 (docs/BACKLOG.md) — la retenue de la boucle, en développement seulement : une preuve qui met en file un envoi
//       dû SANS vouloir qu'il parte la retient le temps de son scénario (docs/SPEC-mail-subsystem.md §34.7 bis)
//
// UNE ATTENTE BORNÉE SUR UN FAIT, PAS UNE TEMPORISATION : la ligne est relue jusqu'à ce qu'elle atteigne l'un des états
// exigés, et la borne — soixante secondes, deux passes de la boucle — n'est atteinte que si le service ne fait pas son
// travail ; l'échec nomme alors l'état où la ligne est restée.

import { execFileSync } from 'node:child_process'
import type { APIRequestContext } from '@playwright/test'
import { enTetesService, URL_API } from './api/jetons'
import { conteneur } from './conteneur'
import { lireEnv } from './env'

export type LigneEnvoi = {
	status: string
	attempts: number
	last_error: string | null
	next_attempt_at: string | null
	rfc822_message_id: string | null
	sent_message_id: string | null
}

export type Attente = {
	/** Les états acceptés ; `sent` par défaut. */
	etats?: readonly string[]
	/** Une condition de plus sur la ligne (un essai compté, un motif nommé). */
	condition?: (ligne: LigneEnvoi) => boolean
	/** La borne, en millisecondes : 60 s par défaut. */
	borne?: number
}

export async function lireEnvoi(request: APIRequestContext, id: string): Promise<LigneEnvoi | undefined> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_outbox?select=status,attempts,last_error,next_attempt_at,rfc822_message_id,sent_message_id&id=eq.${id}`,
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as LigneEnvoi[])[0]
}

/** Attend que l'envoi `id` atteigne l'un des états exigés, et rend sa ligne ; lève en nommant l'état resté sinon. */
export async function attendreLeSort(request: APIRequestContext, id: string, attente: Attente = {}): Promise<LigneEnvoi> {
	const etats = attente.etats ?? ['sent']
	const limite = Date.now() + (attente.borne ?? 60_000)
	let derniere: LigneEnvoi | undefined
	for (;;) {
		derniere = await lireEnvoi(request, id)
		if (derniere !== undefined && etats.includes(derniere.status) && (attente.condition?.(derniere) ?? true)) return derniere
		if (Date.now() >= limite) break
		await new Promise((resoudre) => setTimeout(resoudre, 500))
	}
	throw new Error(`l’envoi ${id} n’a pas atteint ${etats.join(' ou ')} : ${JSON.stringify(derniere ?? null)}`)
}

/**
 * Appelle une route de développement de `mail-sync` DANS son conteneur — le service ne publie aucun port, et `docker exec`
 * coûte bien moins qu'un conteneur jetable : la retenue se renouvelle avant chaque preuve.
 */
function routeDeDeveloppement(methode: 'POST' | 'DELETE', chemin: string): Record<string, unknown> {
	const source = `
import os, sys, urllib.error, urllib.request
r = urllib.request.Request("http://127.0.0.1:8080" + os.environ["CHEMIN"], data=b"", method=os.environ["METHODE"])
r.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(r, timeout=30) as s:
        print(s.read().decode(), end="")
except urllib.error.HTTPError as e:
    sys.exit("HTTP %d sur %s" % (e.code, os.environ["CHEMIN"]))
`
	const brut = execFileSync(
		'docker',
		['exec', '-e', `JETON=${lireEnv('MAIL_SYNC_INTERNAL_TOKEN')}`, '-e', `CHEMIN=${chemin}`, '-e', `METHODE=${methode}`, conteneur('mail-sync'),
			'python', '-c', source],
		{ encoding: 'utf8', timeout: 60_000 },
	).trim()
	return JSON.parse(brut) as Record<string, unknown>
}

/**
 * Retient la boucle d'envoi `secondes` secondes (dix minutes au plus) : un envoi mis en file pendant la retenue ne part que si
 * la preuve le pousse elle-même. La retenue expire seule ; `libererLaBoucle` la lève plus tôt.
 */
export function retenirLaBoucle(secondes = 600): void {
	const reponse = routeDeDeveloppement('POST', `/internal/v1/dev/outbox-loop/hold?seconds=${secondes}`)
	if (Number(reponse['held_seconds']) < 1) throw new Error(`la boucle d’envoi n’est pas retenue : ${JSON.stringify(reponse)}`)
}

export function libererLaBoucle(): void {
	routeDeDeveloppement('DELETE', '/internal/v1/dev/outbox-loop/hold')
}

