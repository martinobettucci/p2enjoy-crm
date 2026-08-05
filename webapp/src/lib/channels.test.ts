// @verifies CRM-021 (docs/BACKLOG.md) — lecture des channels et résolution d'un track par slug
// @verifies docs/SPEC-channels.md §5 (requête émise), §5.1 (route d'un track), §4 (archivage)
// @verifies docs/SPEC-webapp.md §6.4 (contrat asynchrone), §7 (états systématiques)
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue. Motif : trois
// exigences de `docs/SPEC-channels.md` §5 sont portées par la requête elle-même — le filtre sur
// `track_id`, celui des archivés, et l'ordre — et un test qui n'observerait que la réponse les
// laisserait disparaître sans bruit. C'est exactement le procédé retenu pour les tracks.

import { describe, expect, it } from 'vitest'
import { enChargement, enErreur, pret } from './async'
import {
	COLONNES_CHANNEL,
	COLONNES_TRACK_OUVERT,
	lireChannels,
	lireTrackParSlug,
	projeterChannels,
	type Channel,
	type TrackOuvert,
} from './channels'
import type { ClientCrm } from './supabase'

type Appel = {
	table?: string
	colonnes?: string
	egalites: [string, unknown][]
	nuls: string[]
	tris: string[]
	limite?: number
}

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

/** Client factice qui **enregistre** la requête construite, puis rend la réponse voulue. */
function clientEspion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { egalites: [], nuls: [], tris: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.egalites.push([colonne, valeur])
			return chaine
		},
		is: (colonne: string) => {
			appel.nuls.push(colonne)
			return chaine
		},
		order: (colonne: string) => {
			appel.tris.push(colonne)
			return chaine
		},
		limit: (n: number) => {
			appel.limite = n
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

const TRACK: TrackOuvert = { id: 't-1', name: 'Conseil & IA', slug: 'conseil-ia' }
const CHANNEL: Channel = {
	id: 'c-1',
	name: 'Prospection',
	slug: 'prospection',
	position: 1,
	workflow_id: 'wf-1',
}

describe('lireTrackParSlug', () => {
	it('interroge `tracks` sur le slug, en écartant les archivés', async () => {
		const { client, appel } = clientEspion({ data: [TRACK], error: null, status: 200 })
		await lireTrackParSlug(client, 'conseil-ia')

		expect(appel.table).toBe('tracks')
		expect(appel.colonnes).toBe(COLONNES_TRACK_OUVERT)
		expect(appel.egalites).toEqual([['slug', 'conseil-ia']])
		// Sans ce filtre, l'archivage ne serait qu'un masquage de la barre latérale, contournable
		// en saisissant l'adresse (docs/SPEC-tracks.md §4).
		expect(appel.nuls).toEqual(['archived_at'])
		expect(appel.limite).toBe(1)
	})

	it('rend le track lorsque le backend en consent un', async () => {
		const { client } = clientEspion({ data: [TRACK], error: null, status: 200 })
		const etat = await lireTrackParSlug(client, 'conseil-ia')
		expect(etat).toEqual({ statut: 'pret', donnees: TRACK })
	})

	it('rend `null` — et non une erreur — lorsque le backend ne consent aucune ligne', async () => {
		// C'est la réponse réelle à un appelant anonyme (INC-021) **comme** à un slug inexistant.
		// Les deux se ressemblent délibérément : les distinguer renseignerait un appelant sans
		// droit sur l'existence d'un track (docs/SPEC-permissions-rls.md §7).
		const { client } = clientEspion({ data: [], error: null, status: 200 })
		const etat = await lireTrackParSlug(client, 'inconnu')
		expect(etat).toEqual({ statut: 'pret', donnees: null })
	})

	it('classe un refus du backend comme tel, sur le code HTTP et non sur le message', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'nope' }, status: 403 })
		const etat = await lireTrackParSlug(client, 'conseil-ia')
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})
})

describe('lireChannels', () => {
	it('filtre sur le track **côté serveur**, écarte les archivés et ordonne', async () => {
		const { client, appel } = clientEspion({ data: [CHANNEL], error: null, status: 200 })
		await lireChannels(client, 't-1')

		expect(appel.table).toBe('channels')
		expect(appel.colonnes).toBe(COLONNES_CHANNEL)
		// Le filtre est côté serveur : rapporter les channels de tous les tracks pour n'en
		// afficher qu'une barre ferait transiter des lignes que l'écran ne montrera jamais.
		expect(appel.egalites).toEqual([['track_id', 't-1']])
		expect(appel.nuls).toEqual(['archived_at'])
		// `position` puis `name` : deux channels de même position ne doivent pas s'échanger d'un
		// chargement à l'autre (docs/SPEC-channels.md §3).
		expect(appel.tris).toEqual(['position', 'name'])
	})

	// ASSERTION RETOURNÉE PAR `CRM-041`, non retirée (mécanisme de la décision 51). Elle exigeait
	// jusqu'ici que `workflow_id` **ne soit pas** demandée, « la colonne étant nulle partout
	// jusqu'à CRM-031 (INC-029) ». MESURÉ le 2026-08-05 : les six channels du seed portent un
	// workflow, la colonne est `NOT NULL` depuis `CRM-033`, et le board en a besoin pour composer
	// ses colonnes. Elle est lue **ici**, dans la lecture partagée, plutôt que par une seconde
	// lecture des mêmes lignes (docs/SPEC-channels.md §5, décision 169).
	it('demande `workflow_id`, dont le board a besoin, dans la lecture PARTAGÉE', () => {
		expect(COLONNES_CHANNEL).toContain('workflow_id')
	})

	it('rend les channels consentis par le backend', async () => {
		const { client } = clientEspion({ data: [CHANNEL], error: null, status: 200 })
		const etat = await lireChannels(client, 't-1')
		expect(etat).toEqual({ statut: 'pret', donnees: [CHANNEL] })
	})

	it('rend un état **vide**, et non une erreur, quand la RLS ne consent rien', async () => {
		// Un refus de lecture est `200` et zéro ligne, jamais une erreur : c'est un état vide, et
		// c'est exactement ce que l'interface doit montrer (docs/SPEC-webapp.md §6.3).
		const { client } = clientEspion({ data: [], error: null, status: 200 })
		const etat = await lireChannels(client, 't-1')
		expect(etat).toEqual({ statut: 'pret', donnees: [] })
	})

	it('classe une panne de transport comme réessayable', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'fetch failed' }, status: 0 })
		const etat = await lireChannels(client, 't-1')
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('network')
	})

	it('ne laisse pas remonter une exception du transport jusqu’à React', async () => {
		const client = {
			from: () => ({
				select: () => ({
					eq: () => ({
						is: () => ({
							order: () => ({
								order: () => {
									throw new Error('socket fermée')
								},
							}),
						}),
					}),
				}),
			}),
		} as unknown as ClientCrm
		const etat = await lireChannels(client, 't-1')
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') {
			expect(etat.erreur.nature).toBe('network')
			expect(etat.erreur.detail).toContain('socket fermée')
		}
	})
})

// @verifies CRM-037 (docs/BACKLOG.md) — la barre d'onglets d'une route de card
// @verifies docs/SPEC-form-composer.md §4.6 bis ; docs/SPEC-channels.md §5.4
describe('projeterChannels', () => {
	it('rend les channels du track lorsque le contenu est prêt', () => {
		expect(projeterChannels(pret({ track: TRACK, channels: [CHANNEL] }))).toEqual({
			statut: 'pret',
			donnees: [CHANNEL],
		})
	})

	it('rend un état **prêt et vide** quand le backend n’a consenti aucun track', () => {
		// Un refus de lecture est zéro ligne, pas une erreur : la barre affiche son état vide, et
		// la zone principale n'a rien à reprendre (docs/SPEC-form-composer.md §4.6 bis).
		expect(projeterChannels(pret({ track: null, channels: [] }))).toEqual({
			statut: 'pret',
			donnees: [],
		})
	})

	it('transmet le chargement, pour que la barre montre son squelette', () => {
		expect(projeterChannels(enChargement())).toEqual({ statut: 'chargement' })
	})

	it('transmet l’échec **sans le transformer en état vide**', () => {
		// Un échec avalé deviendrait « aucun channel », c'est-à-dire la valeur par défaut trompeuse
		// que CLAUDE.md §18 interdit. La coquille doit pouvoir le présenter et offrir une reprise.
		const erreur = { nature: 'forbidden', detail: 'refusé' } as const
		expect(projeterChannels(enErreur(erreur))).toEqual({ statut: 'erreur', erreur })
	})
})
