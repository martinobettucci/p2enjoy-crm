// @verifies CRM-138 (docs/BACKLOG.md) — tranche T3 : la corbeille de l'inbox côté webapp — la projection d'une ligne de
//           `trashed_messages`, l'état agrégé du déplacement IMAP, le dictionnaire fermé des motifs et celui des refus,
//           la clé d'adresse lue défensivement
// @verifies docs/SPEC-mail-subsystem.md §29.1, §29.3 à §29.5 ; docs/DESIGN_SYSTEM.md §5.102, §5.16 (« Auteur inconnu »)

import { describe, expect, it } from 'vitest'
import {
	classerMotifDeplacement,
	classerRefusCorbeille,
	corbeilleDepuisAdresse,
	etatDeplacement,
	projeterCorbeille,
	type LigneCorbeille,
} from './corbeille-inbox'
import { OBJET_ABSENT } from './inbox'

const LIGNE: LigneCorbeille = {
	message_id: 'm1',
	subject: 'Devis signé',
	from_address: 'client@exemple.test',
	from_name: 'Claire Martin',
	card_id: null,
	deleted_at: '2026-11-11T09:00:00Z',
	deleted_by_name: 'Camille Durand',
	purge_at: '2026-12-11T09:00:00Z',
	moves_pending: 0,
	moves_done: 0,
	moves_failed: 0,
	last_move_error: null,
}

describe('la ligne de la corbeille (§5.102)', () => {
	it('nomme l’expéditeur avec son adresse, et l’auteur de l’effacement', () => {
		const ligne = projeterCorbeille(LIGNE)
		expect(ligne.expediteur).toBe('Claire Martin <client@exemple.test>')
		expect(ligne.effacePar).toBe('Camille Durand')
		expect(ligne.purgeLe).toBe('2026-12-11T09:00:00Z')
		expect(ligne.deplacement).toBe('aucun')
		expect(ligne.motifDeplacement).toBeNull()
	})

	it('un objet vide prend le repli de la liste, un auteur détaché est `null` — l’écran écrit « Auteur inconnu »', () => {
		const ligne = projeterCorbeille({ ...LIGNE, subject: '  ', from_name: null, deleted_by_name: null, purge_at: null })
		expect(ligne.objet).toBe(OBJET_ABSENT)
		expect(ligne.expediteur).toBe('client@exemple.test')
		expect(ligne.effacePar).toBeNull()
		expect(ligne.purgeLe).toBeNull()
	})
})

describe('l’état du déplacement IMAP (§29.5)', () => {
	it('un échec se dit d’abord, puis l’attente, puis le fait ; sans déplacement, rien', () => {
		expect(etatDeplacement({ moves_pending: 1, moves_done: 1, moves_failed: 1 })).toBe('echec')
		expect(etatDeplacement({ moves_pending: 1, moves_done: 1, moves_failed: 0 })).toBe('attente')
		expect(etatDeplacement({ moves_pending: 0, moves_done: 2, moves_failed: 0 })).toBe('fait')
		expect(etatDeplacement({ moves_pending: 0, moves_done: 0, moves_failed: 0 })).toBe('aucun')
		expect(etatDeplacement({ moves_pending: null, moves_done: null, moves_failed: null })).toBe('aucun')
	})

	it('le motif d’un échec est ramené au dictionnaire fermé, jamais le code brut', () => {
		expect(projeterCorbeille({ ...LIGNE, moves_failed: 1, last_move_error: 'no_trash_folder' }).motifDeplacement).toBe(
			'no_trash_folder',
		)
		expect(projeterCorbeille({ ...LIGNE, moves_failed: 1, last_move_error: 'imap_boum' }).motifDeplacement).toBe('inconnu')
		expect(projeterCorbeille({ ...LIGNE, moves_failed: 1, last_move_error: null }).motifDeplacement).toBe('inconnu')
		// Une note d'un déplacement FAIT (`absent_from_folder`) n'est pas un motif d'échec.
		expect(projeterCorbeille({ ...LIGNE, moves_done: 1, last_move_error: 'absent_from_folder' }).motifDeplacement).toBeNull()
		expect(classerMotifDeplacement('')).toBeNull()
		expect(classerMotifDeplacement('timeout')).toBe('timeout')
	})
})

describe('les refus (§29.3, §29.4)', () => {
	it('traduit les codes nommés de la base', () => {
		expect(classerRefusCorbeille(404, 'message_not_found')).toBe('introuvable')
		expect(classerRefusCorbeille(403, 'forbidden')).toBe('refuse')
		expect(classerRefusCorbeille(401, 'not_authenticated')).toBe('refuse')
		expect(classerRefusCorbeille(400, 'no_writable_mailbox')).toBe('aucune_boite')
	})

	it('replie un statut sans code connu, et ne prend jamais un inconnu pour un succès', () => {
		expect(classerRefusCorbeille(404, '')).toBe('introuvable')
		expect(classerRefusCorbeille(403, 'autre')).toBe('refuse')
		expect(classerRefusCorbeille(0, 'TypeError: Failed to fetch')).toBe('reseau')
		expect(classerRefusCorbeille(500, 'boum')).toBe('inconnu')
		expect(classerRefusCorbeille(undefined, 'boum')).toBe('inconnu')
	})
})

describe('l’adresse (§5.102)', () => {
	it('seule `oui` ouvre la corbeille', () => {
		expect(corbeilleDepuisAdresse('oui')).toBe(true)
		expect(corbeilleDepuisAdresse('true')).toBe(false)
		expect(corbeilleDepuisAdresse(null)).toBe(false)
	})
})
