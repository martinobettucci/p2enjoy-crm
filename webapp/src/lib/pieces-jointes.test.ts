// @verifies CRM-074 (docs/BACKLOG.md) — tranche T3 : le module de l'aperçu — ce qui s'aperçoit (saine, 25 Mo, types retenus,
//           extension d'un type générique), le type forcé de l'adresse locale, la lecture du texte et de ses statuts, les
//           pièces d'une affaire groupées par message
// @verifies docs/SPEC-pieces-jointes.md §3, §5, §5.2 (décision 791) ; docs/DESIGN_SYSTEM.md §5.80
// @verifies CRM-143 (docs/BACKLOG.md) — tranche T4 : l'état d'une pièce non analysée (la règle des quinze minutes, les deux
//           raisons, le repli jamais permissif) et la confirmation du risque, avec son dictionnaire fermé de refus ;
//           docs/SPEC-pieces-jointes.md §17.3, §17.4 ; docs/DESIGN_SYSTEM.md §5.95

import { describe, expect, it } from 'vitest'
import type { PieceJointe } from './inbox'
import {
	APERCU_MAX_OCTETS,
	classerRefusConfirmation,
	confirmerPieceNonAnalysee,
	etatPiece,
	formeApercu,
	lirePiecesDesMessages,
	lireTextePiece,
	typeForce,
} from './pieces-jointes'
import type { ClientCrm } from './supabase'

const piece = (type: string, nom = 'f', autres: Partial<PieceJointe> = {}) => ({
	type,
	nom,
	taille: 10,
	statutAnalyse: 'clean' as const,
	...autres,
})

describe('formeApercu', () => {
	it('une image, un PDF, un fichier Office ; rien pour un autre type', () => {
		expect(formeApercu(piece('image/png'))).toBe('image')
		expect(formeApercu(piece('image/webp'))).toBe('image')
		expect(formeApercu(piece('Application/PDF; name=x'))).toBe('pdf')
		expect(formeApercu(piece('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe('texte')
		expect(formeApercu(piece('application/vnd.oasis.opendocument.spreadsheet'))).toBe('texte')
		expect(formeApercu(piece('text/plain', 'note.txt'))).toBeNull()
		expect(formeApercu(piece('image/svg+xml', 'logo.svg'))).toBeNull()
		expect(formeApercu(piece('text/html', 'page.html'))).toBeNull()
	})

	it('un type générique se lit par l’extension ; un type précis jamais', () => {
		expect(formeApercu(piece('application/octet-stream', 'Devis.PDF'))).toBe('pdf')
		expect(formeApercu(piece('application/zip', 'bilan.xlsx'))).toBe('texte')
		expect(formeApercu(piece('application/zip', 'archive.zip'))).toBeNull()
		expect(formeApercu(piece('text/plain', 'faux.pdf'))).toBeNull()
	})

	it('une pièce non saine ou de plus de 25 Mo n’a pas d’aperçu', () => {
		expect(formeApercu(piece('image/png', 'x', { statutAnalyse: 'pending' }))).toBeNull()
		expect(formeApercu(piece('image/png', 'x', { statutAnalyse: 'infected' }))).toBeNull()
		expect(formeApercu(piece('application/pdf', 'x', { taille: APERCU_MAX_OCTETS + 1 }))).toBeNull()
		expect(formeApercu(piece('application/pdf', 'x', { taille: APERCU_MAX_OCTETS }))).toBe('pdf')
	})
})

describe('typeForce', () => {
	it('le type de l’adresse locale est forcé par la forme, jamais repris tel quel d’un type générique', () => {
		expect(typeForce('pdf', { type: 'application/octet-stream' })).toBe('application/pdf')
		expect(typeForce('image', { type: 'image/PNG' })).toBe('image/png')
		expect(typeForce('texte', { type: 'application/zip' })).toBe('text/plain')
	})
})

function client(reponse: { data: unknown; error: unknown }, appels: string[] = []): ClientCrm {
	const maillon: Record<string, unknown> = {}
	for (const m of ['select', 'eq', 'in', 'order', 'maybeSingle']) {
		maillon[m] = (...args: unknown[]) => {
			appels.push(`${m}:${args.map(String).join(',')}`)
			return maillon
		}
	}
	maillon.then = (resoudre: (r: unknown) => unknown) => resoudre(reponse)
	return { from: (table: string) => (appels.push(`from:${table}`), maillon) } as unknown as ClientCrm
}

describe('lireTextePiece', () => {
	it('rend le texte et sa coupe, ou le statut ; une panne rend null', async () => {
		expect(
			await lireTextePiece(client({ data: { text_status: 'extracted', extracted_text: 'Devis', text_truncated: true }, error: null }), 'p'),
		).toEqual({ statut: 'extracted', texte: 'Devis', tronque: true })
		expect(await lireTextePiece(client({ data: { text_status: 'empty', extracted_text: null, text_truncated: false }, error: null }), 'p')).toEqual({
			statut: 'empty',
		})
		expect(await lireTextePiece(client({ data: { text_status: null, extracted_text: null, text_truncated: false }, error: null }), 'p')).toEqual({
			statut: 'pending',
		})
		expect(await lireTextePiece(client({ data: null, error: { message: 'boom' } }), 'p')).toBeNull()
		expect(await lireTextePiece(null, 'p')).toBeNull()
	})
})

describe('lirePiecesDesMessages', () => {
	it('groupe les pièces par message, dans l’ordre du nom, lues par les messages de l’affaire', async () => {
		const appels: string[] = []
		const LU = { av_skip_reason: null, created_at: '2026-11-10T08:00:00Z', mail_attachment_risk_acknowledgments: [] }
		const lignes = [
			{ id: 'a', message_id: 'm1', filename: 'a.pdf', mime_type: 'application/pdf', size_bytes: 3, storage_path: 's/a', av_status: 'clean', ...LU },
			{
				id: 'b', message_id: 'm2', filename: 'b.png', mime_type: 'image/png', size_bytes: 4, storage_path: 's/b', av_status: 'skipped',
				av_skip_reason: 'scanner_unavailable', created_at: '2026-11-10T08:00:00Z', mail_attachment_risk_acknowledgments: [{ user_id: 'u' }],
			},
			{ id: 'c', message_id: 'm1', filename: 'c.docx', mime_type: 'application/zip', size_bytes: 5, storage_path: 's/c', av_status: 'clean', ...LU },
		]
		const parMessage = await lirePiecesDesMessages(client({ data: lignes, error: null }, appels), ['m1', 'm2'])
		expect([...parMessage.keys()]).toEqual(['m1', 'm2'])
		expect(parMessage.get('m1')!.map((p) => p.nom)).toEqual(['a.pdf', 'c.docx'])
		// CRM-143 : la raison, la réception et la confirmation DE LA PERSONNE (la RLS ne rend que les siennes).
		expect(parMessage.get('m2')![0]).toEqual({
			id: 'b', nom: 'b.png', type: 'image/png', taille: 4, chemin: 's/b', statutAnalyse: 'skipped',
			raisonNonAnalyse: 'scanner_unavailable', recueLe: '2026-11-10T08:00:00Z', confirmee: true,
		})
		expect(parMessage.get('m1')![0]!.confirmee).toBe(false)
		expect(appels).toContain('in:message_id,m1,m2')
		expect(await lirePiecesDesMessages(client({ data: null, error: { message: 'x' } }), ['m1'])).toEqual(new Map())
		expect(await lirePiecesDesMessages(client({ data: lignes, error: null }), [])).toEqual(new Map())
	})
})

describe('etatPiece (CRM-143)', () => {
	const maintenant = new Date('2026-11-10T12:00:00Z')
	const recue = (minutes: number) => new Date(maintenant.getTime() - minutes * 60_000).toISOString()
	const p = (statutAnalyse: string, raisonNonAnalyse: string | null = null, recueLe = recue(1)) => ({
		statutAnalyse,
		raisonNonAnalyse,
		recueLe,
	})

	it('saine, infectée, trop volumineuse, non analysée faute d’antivirus', () => {
		expect(etatPiece(p('clean'), maintenant)).toEqual({ etat: 'saine' })
		expect(etatPiece(p('infected'), maintenant)).toEqual({ etat: 'infectee' })
		expect(etatPiece(p('skipped', 'too_large'), maintenant)).toEqual({ etat: 'trop_volumineuse' })
		expect(etatPiece(p('skipped', 'scanner_unavailable'), maintenant)).toEqual({
			etat: 'non_analysee',
			cause: 'antivirus_indisponible',
		})
	})

	it('pending : en cours jusqu’à quinze minutes, non analysée au-delà — la borne de la base, stricte', () => {
		expect(etatPiece(p('pending', null, recue(14)), maintenant)).toEqual({ etat: 'en_cours' })
		expect(etatPiece(p('pending', null, recue(15)), maintenant)).toEqual({ etat: 'en_cours' })
		expect(etatPiece(p('pending', null, recue(16)), maintenant)).toEqual({
			etat: 'non_analysee',
			cause: 'analyse_en_attente',
		})
	})

	it('le repli ne glisse jamais du côté permissif : statut inconnu, skipped sans raison, date illisible', () => {
		expect(etatPiece(p('quarantined'), maintenant)).toEqual({ etat: 'inconnue' })
		expect(etatPiece(p('skipped', null), maintenant)).toEqual({ etat: 'inconnue' })
		expect(etatPiece(p('skipped', 'autre'), maintenant)).toEqual({ etat: 'inconnue' })
		expect(etatPiece(p('pending', null, 'pas une date'), maintenant)).toEqual({ etat: 'inconnue' })
	})
})

describe('confirmerPieceNonAnalysee (CRM-143)', () => {
	const clientRpc = (reponse: unknown, appels: unknown[] = []) =>
		({
			rpc: (nom: string, args: unknown) => {
				appels.push([nom, args])
				return Promise.resolve(reponse)
			},
		}) as unknown as ClientCrm

	it('appelle la fonction sous la session, avec l’identifiant de la pièce', async () => {
		const appels: unknown[] = []
		const issue = await confirmerPieceNonAnalysee(clientRpc({ data: '2026-11-10T12:00:00Z', error: null }, appels), 'p1')
		expect(issue).toEqual({ ok: true })
		expect(appels).toEqual([['acknowledge_unscanned_attachment', { p_attachment_id: 'p1' }]])
	})

	it('une pièce devenue saine entre-temps est une issue réussie : elle se télécharge', async () => {
		const issue = await confirmerPieceNonAnalysee(
			clientRpc({ data: null, error: { message: 'attachment_clean', code: '22023' } }),
			'p1',
		)
		expect(issue).toEqual({ ok: true })
	})

	it('chaque refus a son entrée ; un message inconnu rend « inconnu », jamais le texte du serveur', async () => {
		expect(classerRefusConfirmation('attachment_not_found')).toBe('introuvable')
		expect(classerRefusConfirmation('attachment_infected')).toBe('infectee')
		expect(classerRefusConfirmation('attachment_scanning')).toBe('en_cours')
		expect(classerRefusConfirmation('attachment_not_stored')).toBe('non_conservee')
		expect(classerRefusConfirmation('quelque chose')).toBe('inconnu')
		expect(classerRefusConfirmation(undefined)).toBe('inconnu')
		const issue = await confirmerPieceNonAnalysee(
			clientRpc({ data: null, error: { message: 'attachment_infected', code: '42501' } }),
			'p1',
		)
		expect(issue).toEqual({ ok: false, refus: 'infectee' })
	})

	it('une panne réseau se dit « réseau » ; sans client, « inconnu »', async () => {
		const enPanne = { rpc: () => Promise.reject(new Error('réseau')) } as unknown as ClientCrm
		expect(await confirmerPieceNonAnalysee(enPanne, 'p1')).toEqual({ ok: false, refus: 'reseau' })
		expect(await confirmerPieceNonAnalysee(null, 'p1')).toEqual({ ok: false, refus: 'inconnu' })
	})
})
