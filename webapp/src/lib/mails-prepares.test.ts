// @verifies CRM-128 (docs/BACKLOG.md) — tranche T4 : la lecture des mails préparés en attente (du plus ancien au plus
//           récent, par affaire), l'envoi avec le contenu relu par `send_email_draft`, l'écart par `discard_email_draft`,
//           le classement de leurs refus et l'adresse de relecture
// @verifies docs/SPEC-mails-prepares.md §3.4, §3.5, §6.1 ; docs/DESIGN_SYSTEM.md §5.90 ; décision 829

import { describe, expect, it } from 'vitest'
import {
	adresseRelecture,
	classerRefusMailPrepare,
	ecarterMailPrepare,
	envoyerMailPrepare,
	lireMailsPrepares,
	mailPrepareDepuisLigne,
} from './mails-prepares'
import type { ClientCrm } from './supabase'

const LIGNE = {
	id: 'm1',
	card_id: 'c1',
	identity_id: 'i1',
	in_reply_to_message_id: 'r1',
	to_addrs: ['client@exemple.fr'],
	cc_addrs: ['copie@exemple.fr'],
	bcc_addrs: [],
	subject: 'Proposition',
	body_text: 'Bonjour',
	origin: 'mcp',
	created_at: '2026-11-03T10:00:00Z',
	cards: { title: 'Refonte' },
}

function espion(reponse: { data?: unknown; error: { code?: string; message: string } | null; status?: number }) {
	const appels: { filtres: [string, unknown][]; ordres: string[]; rpc?: [string, unknown] } = { filtres: [], ordres: [] }
	const requete = {
		select: () => requete,
		eq: (colonne: string, valeur: unknown) => {
			appels.filtres.push([colonne, valeur])
			return requete
		},
		order: (colonne: string) => {
			appels.ordres.push(colonne)
			return requete
		},
		then: (resoudre: (valeur: unknown) => unknown) => resoudre({ status: 200, ...reponse }),
	}
	const client = {
		from: (table: string) => {
			appels.filtres.push(['table', table])
			return requete
		},
		rpc: (fonction: string, arguments_: unknown) => {
			appels.rpc = [fonction, arguments_]
			return Promise.resolve({ status: 200, ...reponse })
		},
	} as unknown as ClientCrm
	return { client, appels }
}

describe('la lecture des mails préparés', () => {
	it('lit les mails EN ATTENTE, du plus ancien au plus récent, et laisse la RLS dire à qui ils sont', async () => {
		const { client, appels } = espion({ data: [LIGNE], error: null })
		const etat = await lireMailsPrepares(client)
		expect(etat).toEqual({ statut: 'pret', donnees: [mailPrepareDepuisLigne(LIGNE)] })
		expect(appels.filtres).toEqual([['table', 'mail_drafts'], ['status', 'pending']])
		expect(appels.ordres).toEqual(['created_at', 'id'])
	})

	it('filtre sur l’affaire quand elle est donnée', async () => {
		const { client, appels } = espion({ data: [], error: null })
		await lireMailsPrepares(client, 'c1')
		expect(appels.filtres).toContainEqual(['card_id', 'c1'])
	})

	it('rend la ligne dans la forme de l’écran, et n’attribue jamais au connecteur une origine inconnue', () => {
		expect(mailPrepareDepuisLigne(LIGNE)).toEqual({
			id: 'm1', idCard: 'c1', titreCard: 'Refonte', idIdentite: 'i1', repondA: 'r1',
			destinataires: ['client@exemple.fr'], copies: ['copie@exemple.fr'], copiesCachees: [],
			objet: 'Proposition', corps: 'Bonjour', origine: 'mcp', creeLe: '2026-11-03T10:00:00Z',
		})
		expect(mailPrepareDepuisLigne({ ...LIGNE, origin: 'autre', cards: null, subject: null }).origine).toBe('web')
	})

	it('dit une panne de lecture comme une erreur, jamais comme une liste vide', async () => {
		const { client } = espion({ data: null, error: { message: 'boom' }, status: 500 })
		expect((await lireMailsPrepares(client)).statut).toBe('erreur')
		expect((await lireMailsPrepares(null)).statut).toBe('erreur')
	})
})

describe('envoyer et écarter', () => {
	it('envoie le contenu RELU, copie et copie cachée comprises, par `send_email_draft`', async () => {
		const { client, appels } = espion({ data: 'outbox-1', error: null })
		const refus = await envoyerMailPrepare(client, 'm1', {
			idIdentite: 'i1', destinataires: ['client@exemple.fr'], objet: 'Relu', corps: 'Corps relu',
			copies: ['copie@exemple.fr'], copiesCachees: ['direction@exemple.fr'], pieces: ['e/p/r/devis.pdf'],
		})
		expect(refus).toBeNull()
		expect(appels.rpc).toEqual(['send_email_draft', {
			p_draft_id: 'm1', p_identity_id: 'i1', p_to: ['client@exemple.fr'], p_subject: 'Relu', p_body_text: 'Corps relu',
			p_cc: ['copie@exemple.fr'], p_bcc: ['direction@exemple.fr'], p_attachments: ['e/p/r/devis.pdf'],
		}])
	})

	it('écarte par `discard_email_draft`', async () => {
		const { client, appels } = espion({ data: null, error: null })
		expect(await ecarterMailPrepare(client, 'm1')).toBeNull()
		expect(appels.rpc).toEqual(['discard_email_draft', { p_draft_id: 'm1' }])
	})

	it('classe « plus en attente » sans distinguer l’envoyé, l’écarté, l’absent et l’interdit', async () => {
		expect(classerRefusMailPrepare(400, '23514', 'draft_not_pending').nature).toBe('plus_en_attente')
		expect(classerRefusMailPrepare(404, 'P0002', 'draft_not_found').nature).toBe('plus_en_attente')
		const { client } = espion({ data: null, error: { code: 'P0002', message: 'draft_not_found' }, status: 404 })
		expect((await ecarterMailPrepare(client, 'm1'))?.nature).toBe('plus_en_attente')
	})

	it('laisse les refus de l’envoi au dictionnaire de l’envoi', () => {
		expect(classerRefusMailPrepare(409, '23505', 'quota_exceeded').nature).toBe('quota')
		expect(classerRefusMailPrepare(403, '42501', 'identity_not_available').nature).toBe('forbidden')
	})

	it('dit une panne sans client', async () => {
		expect((await envoyerMailPrepare(null, 'm1', { idIdentite: 'i1', destinataires: [], objet: '', corps: '' }))?.nature)
			.toBe('unknown')
	})
})

it('compose l’adresse de relecture que le connecteur rend aussi', () => {
	expect(adresseRelecture('a b')).toBe('/inbox?brouillon=a%20b')
})
