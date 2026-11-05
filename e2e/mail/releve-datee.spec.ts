// @verifies CRM-127 (docs/BACKLOG.md) — tranche T2 : une relève réelle date `last_sync_at`, à l'horloge de la base
// @verifies docs/SPEC-mail-subsystem.md §23.2 (la relève réussie écrit `last_sync_at`, à l'horloge de la base), §20.7 et
//           §20.11 (l'écran d'état montre la dernière relève réussie), §23.7 (preuve E2E `mail`) ; INC-340 ;
//           docs/DESIGN_SYSTEM.md §5.14, §5.93 ; CLAUDE.md §8 (aucune trace fabriquée)
//
// LA RELÈVE EST LA VRAIE : la route interne `/poll` du service `mail-sync`, appelée depuis son conteneur avec son jeton
// interne, sur la boîte système du seed — une vraie session IMAP vers le Stalwart de développement. Rien n'est écrit par la
// clé de service : la date que l'écran montre est celle que la relève a posée.
//
// L'ÉCRAN D'ÉTAT N'EST PAS EXERCÉ ICI : le projet `mail` ne sert pas la webapp (`e2e/playwright.config.ts`, SERVEUR_REQUIS),
// et le lui faire construire alourdirait chaque campagne de messagerie. La date à l'écran, après une relève réelle par la
// même route, est prouvée par `e2e/ui/etat-messagerie.spec.ts` (décision 850).

import { execFileSync } from 'node:child_process'
import { conteneur } from '../conteneur'
import { expect, test } from '@playwright/test'
import { urlApi } from '../env'
import { enTetesService } from '../api/jetons'

/** La relève par la route interne, depuis le conteneur du service : le vrai chemin de la synchronisation (§15). */
function relever(compte: string): void {
	execFileSync(
		'docker',
		[
			'exec',
			'-e',
			`COMPTE=${compte}`,
			conteneur('mail-sync'),
			'python',
			'-c',
			`
import os, sys, urllib.request
requete = urllib.request.Request(
    "http://127.0.0.1:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll", data=b"", method="POST",
    headers={"Authorization": "Bearer " + os.environ["MAIL_SYNC_INTERNAL_TOKEN"]})
sys.exit(0 if urllib.request.urlopen(requete, timeout=120).status == 200 else 1)
`,
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	)
}

test('une relève réelle de la boîte système date `last_sync_at` à l’horloge de la base, et garde ses bornes d’UID', async ({ request }) => {
	test.setTimeout(150_000)
	const reponse = await request.get(
		`${urlApi()}/rest/v1/mail_inbound_accounts?select=id,last_sync_at&owner_id=is.null`,
		{ headers: enTetesService() },
	)
	expect(reponse.status()).toBe(200)
	const [systeme] = (await reponse.json()) as { id: string; last_sync_at: string | null }[]
	expect(systeme, 'la boîte système du seed').toBeDefined()

	const debut = new Date()
	relever(systeme!.id)

	const relue = await request.get(`${urlApi()}/rest/v1/mail_inbound_accounts?select=last_sync_at&id=eq.${systeme!.id}`, {
		headers: enTetesService(),
	})
	const [ligneRelue] = (await relue.json()) as { last_sync_at: string | null }[]
	const datee = ligneRelue?.last_sync_at ?? null
	expect(datee, 'la relève a daté la boîte (§23.2)').not.toBeNull()
	// L'horloge de la base et celle de l'hôte : une seconde de marge, rien de plus.
	expect(new Date(datee!).getTime()).toBeGreaterThanOrEqual(debut.getTime() - 1_000)

	// La relève qui a daté la boîte est allée au bout : elle a enregistré sa progression, des bornes d'UID par dossier
	// (§23.2 : la datation vient APRÈS `enregistrer_progression`).
	const etat = await request.get(`${urlApi()}/rest/v1/mail_inbound_accounts?select=sync_state&id=eq.${systeme!.id}`, {
		headers: enTetesService(),
	})
	type Bornes = { uid_min: number; uid_max: number }
	const [ligneEtat] = (await etat.json()) as { sync_state: Record<string, Bornes> }[]
	const progression: Record<string, Bornes> = ligneEtat?.sync_state ?? {}
	expect(Object.keys(progression).length, 'au moins un dossier relevé').toBeGreaterThan(0)
	for (const bornes of Object.values(progression)) {
		expect(typeof bornes.uid_min).toBe('number')
		expect(typeof bornes.uid_max).toBe('number')
	}
})
