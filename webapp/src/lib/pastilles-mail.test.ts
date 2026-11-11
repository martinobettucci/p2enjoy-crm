// @verifies CRM-141 (docs/BACKLOG.md) — tranche T3 : la lecture des pastilles des mails (colonnes demandées, tri des
//           actives avant les archivées), les écritures nettoyées, et le dictionnaire fermé des refus
// @verifies docs/SPEC-mail-subsystem.md §31.2, §31.3, §31.7 ; docs/DESIGN_SYSTEM.md §5.103 ; docs/JOURNAL.md décision 926
//
// Les droits réels sont éprouvés contre la vraie base par `e2e/api/pastilles-reglages.spec.ts` (CLAUDE.md §10).

import { describe, expect, it } from 'vitest'
import type { ClientCrm } from './supabase'
import {
	archiverPastilleMail,
	classerRefusPastilleMail,
	COLONNES_PASTILLE_MAIL,
	creerPastilleMail,
	lirePastillesMail,
	modifierPastilleMail,
	projeterPastillesMail,
} from './pastilles-mail'

type Appel = { readonly methode: string; readonly args: readonly unknown[] }

function espion(reponse: unknown | (() => never)) {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => {
			appels.push({ methode: 'from', args: [table] })
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'is', 'insert', 'update']) {
				maillon[methode] = (...args: unknown[]) => {
					appels.push({ methode, args })
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown, rejeter: (e: unknown) => unknown) => {
				if (typeof reponse === 'function') {
					try {
						;(reponse as () => never)()
					} catch (cause) {
						return rejeter(cause)
					}
				}
				return resoudre(reponse)
			}
			return maillon
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const ligne = (id: string, name: string, archived_at: string | null = null, color = 'primary') => ({
	id,
	workspace_id: 'ws-1',
	name,
	color,
	description: `Descriptif de ${name}`,
	archived_at,
})

describe('projeterPastillesMail', () => {
	it('les actives d’abord, puis les archivées, chacune dans l’ordre du nom sans casse ni accent', () => {
		const projetees = projeterPastillesMail([
			ligne('a', 'Spam'),
			ligne('b', 'Archivée', '2026-11-11T00:00:00Z'),
			ligne('c', 'éducation'),
			null,
			ligne('d', 'Devis'),
		])
		expect(projetees.map((p) => [p.nom, p.archivee])).toEqual([
			['Devis', false],
			['éducation', false],
			['Spam', false],
			['Archivée', true],
		])
	})

	it('une couleur hors des cinq jetons retombe sur le neutre, jamais sur une couleur inventée', () => {
		const [p] = projeterPastillesMail([ligne('a', 'X', null, 'fuchsia')])
		expect(p!.couleur).toBe('neutral')
		expect(p!.descriptif).toBe('Descriptif de X')
		expect(p!.idEspace).toBe('ws-1')
	})
})

describe('lirePastillesMail', () => {
	it('demande les seules colonnes utiles, bornées à l’espace ; archivées comprises', async () => {
		const { client, appels } = espion({ data: [ligne('a', 'Lead', '2026-11-11T00:00:00Z')], error: null, status: 200 })
		const etat = await lirePastillesMail(client, 'ws-1')
		expect(appels).toEqual([
			{ methode: 'from', args: ['mail_labels'] },
			{ methode: 'select', args: [COLONNES_PASTILLE_MAIL] },
			{ methode: 'eq', args: ['workspace_id', 'ws-1'] },
		])
		expect(COLONNES_PASTILLE_MAIL).toBe('id, workspace_id, name, color, description, archived_at')
		expect(etat.statut).toBe('pret')
		if (etat.statut === 'pret') expect(etat.donnees[0]!.archivee).toBe(true)
	})

	it('une erreur de lecture, ou une exception du transport, devient un état d’erreur classé', async () => {
		const enErreur = await lirePastillesMail(espion({ data: null, error: { message: 'fetch failed' }, status: 0 }).client, 'ws-1')
		expect(enErreur.statut).toBe('erreur')
		const leve = await lirePastillesMail(
			espion(() => {
				throw new Error('réseau coupé')
			}).client,
			'ws-1',
		)
		expect(leve.statut).toBe('erreur')
	})
})

describe('les écritures', () => {
	it('créer nettoie le nom et le descriptif, et ne pose ni auteur ni date : la base les pose', async () => {
		const { client, appels } = espion({ data: [{ id: 'n' }], error: null, status: 201 })
		const issue = await creerPastilleMail(client, 'ws-1', { nom: '  Youtube ', couleur: 'danger', descriptif: ' La chaîne. ' })
		expect(issue).toEqual({ statut: 'applique' })
		expect(appels.find((a) => a.methode === 'insert')!.args[0]).toEqual({
			workspace_id: 'ws-1',
			name: 'Youtube',
			color: 'danger',
			description: 'La chaîne.',
		})
	})

	it('modifier vise la pastille par son identifiant', async () => {
		const { client, appels } = espion({ data: [{ id: 'p' }], error: null, status: 200 })
		await modifierPastilleMail(client, 'p', { nom: 'Lead ', couleur: 'success', descriptif: 'Un prospect.' })
		expect(appels.find((a) => a.methode === 'update')!.args[0]).toEqual({ name: 'Lead', color: 'success', description: 'Un prospect.' })
		expect(appels.find((a) => a.methode === 'eq')!.args).toEqual(['id', 'p'])
	})

	it('archiver pose l’horodatage remis ; désarchiver l’efface', async () => {
		const archive = espion({ data: [{ id: 'p' }], error: null, status: 200 })
		await archiverPastilleMail(archive.client, 'p', true, () => '2026-11-11T10:00:00.000Z')
		expect(archive.appels.find((a) => a.methode === 'update')!.args[0]).toEqual({ archived_at: '2026-11-11T10:00:00.000Z' })
		const desarchive = espion({ data: [{ id: 'p' }], error: null, status: 200 })
		await archiverPastilleMail(desarchive.client, 'p', false)
		expect(desarchive.appels.find((a) => a.methode === 'update')!.args[0]).toEqual({ archived_at: null })
	})

	it('zéro ligne rendue sans erreur : la politique a filtré, l’écran ne dit jamais « enregistré »', async () => {
		const issue = await archiverPastilleMail(espion({ data: [], error: null, status: 200 }).client, 'p', true)
		expect(issue).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})

	it('une exception du transport devient le refus réseau', async () => {
		const issue = await creerPastilleMail(
			espion(() => {
				throw new Error('réseau coupé')
			}).client,
			'ws-1',
			{ nom: 'X', couleur: 'neutral', descriptif: 'x' },
		)
		expect(issue).toEqual({ statut: 'refus', nature: 'network' })
	})
})

describe('classerRefusPastilleMail — dictionnaire fermé', () => {
	it.each([
		[409, '23505', 'nom-pris'],
		[400, '23514', 'forme'],
		[403, '42501', 'forbidden'],
		[401, undefined, 'forbidden'],
		[403, undefined, 'forbidden'],
		[0, undefined, 'network'],
		[undefined, undefined, 'network'],
		[500, 'XX000', 'unknown'],
	] as const)('statut %s, code %s → %s', (statut, code, nature) => {
		expect(classerRefusPastilleMail(statut, code)).toBe(nature)
	})
})
