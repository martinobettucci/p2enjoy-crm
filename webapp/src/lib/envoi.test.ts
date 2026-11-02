// @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : la copie cachée et les pièces envoyées à la file, le chemin et le nom
//           de dépôt, les plafonds, les refus nommés
// @verifies docs/SPEC-mail-subsystem.md §19 bis.2 (points 1, 4 et 5), §19 bis.3 (les trois refus) ;
//           docs/DESIGN_SYSTEM.md §5.4 sexies ; docs/JOURNAL.md décisions 719 et 720
// @verifies CRM-058 (docs/BACKLOG.md) — le classement des refus de la file (§19.4), jusqu'ici sans test unitaire dédié
// @verifies INC-335 (docs/BACKLOG.md, correctif de la décision 805, T2) — les identités empruntables sont les siennes, et
//           elles seules ; la présélection prend son défaut, à défaut l'unique, sinon rien (docs/SPEC-mail-subsystem.md
//           §14.2, §19.4, §22.14) ; au bloc d'armement, pour le seul responsable du rattachement (décision 803,
//           docs/SPEC-rattachements.md §7)

import { describe, expect, it } from 'vitest'
import {
	BUCKET_PIECES,
	PIECES_MAX,
	PIECES_OCTETS_MAX,
	cheminDeDepot,
	classerRefusEnvoi,
	depassementPlafond,
	deposerPiece,
	identiteAPreselectionner,
	identiteArmementAPreselectionner,
	lireIdentitesDisponibles,
	mettreEnFile,
	nomDeDepot,
	retirerPiece,
	tailleLisible,
} from './envoi'
import type { ClientCrm } from './supabase'

describe('le nom et le chemin de dépôt (§19 bis.2 point 5)', () => {
	it('translittère les accents, que la clé de stockage refuse', () => {
		expect(nomDeDepot('Proposition révisée.pdf')).toBe('Proposition revisee.pdf')
		expect(nomDeDepot('Œuvre — été.txt')).toBe('_uvre _ ete.txt')
	})

	it('remplace un séparateur de chemin, et ne rend jamais un nom vide ou fait de points', () => {
		expect(nomDeDepot('a/b\\c.txt')).toBe('a_b_c.txt')
		expect(nomDeDepot('')).toBe('piece')
		expect(nomDeDepot('..')).toBe('piece')
	})

	it('forme `<espace>/<personne>/<aléatoire>/<nom>`, la seule que la politique accepte', () => {
		expect(cheminDeDepot('e1', 'p1', 'Devis été.pdf', 'r1')).toBe('e1/p1/r1/Devis ete.pdf')
	})
})

describe('les plafonds (§19 bis.2 point 4)', () => {
	it('signale le nombre au-delà de dix, puis la taille au-delà de 10 Mo', () => {
		expect(depassementPlafond(Array(PIECES_MAX).fill(1))).toBeNull()
		expect(depassementPlafond(Array(PIECES_MAX + 1).fill(1))).toBe('nombre')
		expect(depassementPlafond([PIECES_OCTETS_MAX])).toBeNull()
		expect(depassementPlafond([PIECES_OCTETS_MAX, 1])).toBe('taille')
	})

	it('écrit une taille lisible en français', () => {
		expect(tailleLisible(980)).toBe('980 o')
		expect(tailleLisible(3482)).toBe('3,4 Ko')
		expect(tailleLisible(PIECES_OCTETS_MAX)).toBe('10 Mo')
	})
})

describe('le classement des refus de la file', () => {
	it('distingue les refus des pièces des autres `23514`', () => {
		expect(classerRefusEnvoi(400, '23514', 'attachment_not_available').nature).toBe('piece_indisponible')
		expect(classerRefusEnvoi(400, '23514', 'too_many_attachments').nature).toBe('pieces_plafond')
		expect(classerRefusEnvoi(400, '23514', 'attachments_too_large').nature).toBe('pieces_plafond')
		expect(classerRefusEnvoi(400, '23514', 'card_not_available').nature).toBe('invalide')
	})

	it('garde le quota, le refus d’écriture et la panne de transport', () => {
		expect(classerRefusEnvoi(409, '23505', 'quota_exceeded').nature).toBe('quota')
		expect(classerRefusEnvoi(403, '42501', 'forbidden').nature).toBe('forbidden')
		expect(classerRefusEnvoi(undefined, undefined, 'réseau').nature).toBe('network')
	})
})

describe('la mise en file et le dépôt', () => {
	const espion = () => {
		const appels: { rpc?: [string, unknown]; upload?: [string, string, unknown]; remove?: [string, string[]] } = {}
		const client = {
			rpc: (nom: string, args: unknown) => {
				appels.rpc = [nom, args]
				return Promise.resolve({ data: 'file-1', error: null, status: 200 })
			},
			storage: {
				from: (bucket: string) => ({
					upload: (chemin: string, _fichier: Blob, options: unknown) => {
						appels.upload = [bucket, chemin, options]
						return Promise.resolve({ data: { path: chemin }, error: null })
					},
					remove: (chemins: string[]) => {
						appels.remove = [bucket, chemins]
						return Promise.resolve({ data: [], error: null })
					},
				}),
			},
		} as unknown as ClientCrm
		return { client, appels }
	}

	it('envoie la copie cachée et les CHEMINS des pièces, jamais leur contenu', async () => {
		const { client, appels } = espion()
		const refus = await mettreEnFile(client, {
			idCard: 'c1',
			idIdentite: 'i1',
			destinataires: ['client@exemple.fr'],
			objet: 'Devis',
			corps: 'Bonjour',
			copiesCachees: ['direction@exemple.fr'],
			pieces: ['e1/p1/r1/devis.pdf'],
		})
		expect(refus).toBeNull()
		expect(appels.rpc).toEqual([
			'queue_outbound_email',
			{
				p_card_id: 'c1',
				p_identity_id: 'i1',
				p_to: ['client@exemple.fr'],
				p_subject: 'Devis',
				p_body_text: 'Bonjour',
				p_bcc: ['direction@exemple.fr'],
				p_attachments: ['e1/p1/r1/devis.pdf'],
			},
		])
	})

	it('sans Cci ni pièce, envoie deux listes vides', async () => {
		const { client, appels } = espion()
		await mettreEnFile(client, { idCard: 'c1', idIdentite: 'i1', destinataires: ['a@b.fr'], objet: 'o', corps: 'c' })
		expect(appels.rpc?.[1]).toMatchObject({ p_bcc: [], p_attachments: [] })
	})

	it('dépose dans le bucket des pièces à envoyer, sans écraser, avec le type du fichier', async () => {
		const { client, appels } = espion()
		const erreur = await deposerPiece(client, 'e1/p1/r1/note.txt', new Blob(['x'], { type: 'text/plain' }))
		expect(erreur).toBeNull()
		expect(appels.upload).toEqual([BUCKET_PIECES, 'e1/p1/r1/note.txt', { contentType: 'text/plain', upsert: false }])
	})

	it('un type absent part en octet-stream ; un refus du stockage est rendu, jamais avalé', async () => {
		const { client, appels } = espion()
		await deposerPiece(client, 'e1/p1/r1/x', new Blob(['x']))
		expect((appels.upload?.[2] as { contentType: string }).contentType).toBe('application/octet-stream')

		const refusant = {
			storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: { message: 'new row violates' } }) }) },
		} as unknown as ClientCrm
		expect((await deposerPiece(refusant, 'x', new Blob(['x'])))?.nature).toBe('forbidden')
		expect((await deposerPiece(null, 'x', new Blob(['x'])))?.detail).toBe('configuration_absente')
	})

	it('retire un dépôt abandonné du même bucket', async () => {
		const { client, appels } = espion()
		await retirerPiece(client, 'e1/p1/r1/note.txt')
		expect(appels.remove).toEqual([BUCKET_PIECES, ['e1/p1/r1/note.txt']])
	})
})

describe('les identités qu’on peut employer, et celle qu’on présélectionne (décision 805, INC-335)', () => {
	const MOI = 'personne-1'
	const lignes = [
		{ id: 'service', label: 'Identité de service', from_address: 'systeme@crm.test', owner_id: null, is_default: true },
		{ id: 'collegue', label: 'Envoi de Driss', from_address: 'contact@p2enjoy.test', owner_id: 'personne-2', is_default: true },
		{ id: 'mienne-a', label: 'Envoi A', from_address: 'a@p2enjoy.test', owner_id: MOI, is_default: false },
		{ id: 'mienne-b', label: 'Envoi B', from_address: 'b@p2enjoy.test', owner_id: MOI, is_default: true },
	]
	const lecteur = (data: unknown, error: { message: string } | null = null) =>
		({ from: () => ({ select: () => ({ order: () => Promise.resolve({ data, error }) }) }) }) as unknown as ClientCrm

	it('ne garde que SES identités : ni celle du service, ni celle d’un collègue que la RLS montre à une administratrice', async () => {
		const lues = await lireIdentitesDisponibles(lecteur(lignes), MOI)
		expect(lues.map((identite) => identite.id)).toEqual(['mienne-a', 'mienne-b'])
		expect(lues.find((identite) => identite.id === 'mienne-b')?.parDefaut).toBe(true)
		expect(lues.find((identite) => identite.id === 'mienne-a')?.parDefaut).toBe(false)
	})

	it('ne propose rien sans session, ni sur une lecture refusée', async () => {
		expect(await lireIdentitesDisponibles(lecteur(lignes), null)).toEqual([])
		expect(await lireIdentitesDisponibles(lecteur(null, { message: 'refus' }), MOI)).toEqual([])
		expect(await lireIdentitesDisponibles(null, MOI)).toEqual([])
	})

	it('présélectionne le défaut de la personne, même s’il n’est pas le premier par libellé', () => {
		const identites = [
			{ id: 'a', libelle: 'A', adresse: 'a@x.test', parDefaut: false },
			{ id: 'b', libelle: 'B', adresse: 'b@x.test', parDefaut: true },
		]
		expect(identiteAPreselectionner(identites)).toBe('b')
	})

	it('à défaut de défaut, l’unique identité ; avec plusieurs sans défaut, ou aucune, rien', () => {
		expect(identiteAPreselectionner([{ id: 'seule', libelle: 'S', adresse: 's@x.test', parDefaut: false }])).toBe('seule')
		expect(
			identiteAPreselectionner([
				{ id: 'a', libelle: 'A', adresse: 'a@x.test', parDefaut: false },
				{ id: 'b', libelle: 'B', adresse: 'b@x.test', parDefaut: false },
			]),
		).toBe('')
		expect(identiteAPreselectionner([])).toBe('')
	})
})

describe('l’identité que le bloc d’armement présélectionne (décisions 803 et 805)', () => {
	const identites = [
		{ id: 'a', libelle: 'A', adresse: 'a@x.test', parDefaut: false },
		{ id: 'b', libelle: 'B', adresse: 'b@x.test', parDefaut: true },
	]

	it('la personne qui arme est le responsable du rattachement : son identité par défaut', () => {
		expect(identiteArmementAPreselectionner(identites, 'moi', 'moi')).toBe('b')
		expect(identiteArmementAPreselectionner([identites[0]!], 'moi', 'moi')).toBe('a')
	})

	it('une autre personne, ou un responsable inconnu, ou aucune session : rien', () => {
		expect(identiteArmementAPreselectionner(identites, 'moi', 'autre')).toBe('')
		expect(identiteArmementAPreselectionner(identites, 'moi', null)).toBe('')
		expect(identiteArmementAPreselectionner(identites, null, null)).toBe('')
	})
})
