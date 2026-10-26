// @verifies CRM-072 (docs/BACKLOG.md) — tranche T2 : la présentation d'une entrée du journal d'audit
// @verifies docs/SPEC-audit.md §4 (chaque paire objet / action a sa phrase), §5 (détails : rôles, accès, colonnes, CLÉS de
//           réglages jamais leurs valeurs), §7.3 (le nom d'un contact lu à l'affichage) ; docs/DESIGN_SYSTEM.md §5.66
//           (paire inconnue laissée vide, « Système ou compte supprimé », « sans libellé »), §5.56 (`logs_purged`) ;
//           docs/JOURNAL.md décision 728

import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { EntreeAudit } from '../lib/audit'
import { cleGeste, detailAudit, libelleActeurAudit, libelleGesteAudit, objetNomme } from './presentation-audit'
import { detailJournal, libelleGeste } from './presentation-plateforme'

const entree = (partiel: Partial<EntreeAudit>): EntreeAudit => ({
	id: 1,
	date: '2026-10-26T09:00:00Z',
	famille: 'access',
	action: 'added',
	objet: 'member',
	idObjet: 'u1',
	libelle: 'Sabine Plateforme',
	details: {},
	idActeur: null,
	acteur: null,
	...partiel,
})
const AUCUN: ReadonlyMap<string, string> = new Map()

/** Les paires de la migration 115 (`docs/SPEC-audit.md` §4), toutes rendues par une phrase. */
const PAIRES = [
	['member', 'added'], ['member', 'role_changed'], ['member', 'removed'], ['invitation', 'created'], ['invitation', 'removed'],
	['track_access', 'granted'], ['track_access', 'revoked'], ['channel_access', 'granted'], ['channel_access', 'revoked'],
	['workspace', 'updated'], ['track', 'created'], ['track', 'updated'], ['track', 'trashed'], ['track', 'restored'],
	['track', 'destroyed'], ['channel', 'created'], ['channel', 'updated'], ['channel', 'trashed'], ['channel', 'restored'],
	['channel', 'destroyed'], ['workflow', 'created'], ['workflow', 'updated'], ['workflow', 'archived'], ['workflow', 'deleted'],
	['workflow', 'published'], ['workflow_step', 'created'], ['workflow_step', 'updated'], ['workflow_step', 'deleted'],
	['workflow_transition', 'created'], ['workflow_transition', 'updated'], ['workflow_transition', 'deleted'],
	['workflow_node', 'created'], ['workflow_node', 'updated'], ['workflow_node', 'archived'], ['workflow_node', 'deleted'],
	['form_field', 'created'], ['form_field', 'updated'], ['form_field', 'archived'], ['form_field', 'deleted'],
	['form_field_rule', 'created'], ['form_field_rule', 'updated'], ['form_field_rule', 'deleted'], ['mail_account', 'created'],
	['mail_account', 'updated'], ['mail_account', 'deleted'], ['mail_identity', 'created'], ['mail_identity', 'updated'],
	['mail_identity', 'deleted'], ['card', 'trashed'], ['card', 'restored'], ['card', 'destroyed'], ['comment', 'deleted'],
	['activity', 'deleted'], ['contact', 'deleted'], ['contact', 'anonymized'], ['contact', 'exported'],
	['organization', 'deleted'], ['session', 'signed_in'], ['audit_log', 'purged'],
] as const

describe('la phrase du geste', () => {
	it('chaque paire de la base a sa clé, présente au dictionnaire, et aucune phrase ne laisse un marqueur', () => {
		for (const [objet, action] of PAIRES) {
			const cle = cleGeste({ objet, action })
			expect(cle, `${objet}.${action}`).not.toBeNull()
			expect(fr[cle as keyof typeof fr], `${objet}.${action}`).toBeTypeOf('string')
			expect(libelleGesteAudit(entree({ objet, action }), AUCUN)).not.toContain('{')
		}
	})

	it('nomme l’objet par son libellé au moment du geste', () => {
		expect(libelleGesteAudit(entree({}), AUCUN)).toBe('Membre ajouté : Sabine Plateforme')
		expect(libelleGesteAudit(entree({ objet: 'workflow', action: 'published', libelle: 'Cycle commercial' }), AUCUN)).toBe(
			'Workflow publié : Cycle commercial',
		)
	})

	it('une paire inconnue rend un texte vide, jamais le code brut', () => {
		expect(libelleGesteAudit(entree({ objet: 'card', action: 'moved' }), AUCUN)).toBe('')
	})

	it('un contact est nommé par le carnet : son nom, ou « contact supprimé » s’il n’existe plus', () => {
		const exporte = entree({ objet: 'contact', action: 'exported', idObjet: 'c1', libelle: null })
		expect(libelleGesteAudit(exporte, new Map([['c1', 'Léo Marchand']]))).toBe('Données personnelles exportées : Léo Marchand')
		expect(objetNomme(exporte, AUCUN)).toBe('contact supprimé')
	})

	it('un objet sans libellé se dit « sans libellé », jamais par un blanc', () => {
		expect(libelleGesteAudit(entree({ objet: 'workflow_transition', action: 'created', libelle: '  ' }), AUCUN)).toBe(
			'Transition ajoutée : sans libellé',
		)
	})

	it('l’acteur est son nom ; un acteur nul ne devine pas la cause', () => {
		expect(libelleActeurAudit(entree({ acteur: 'Camille Aubert' }))).toBe('Camille Aubert')
		expect(libelleActeurAudit(entree({ acteur: null }))).toBe('Système ou compte supprimé')
	})
})

describe('le détail', () => {
	it('dit le rôle, et le changement de rôle avant → après', () => {
		expect(detailAudit(entree({ details: { role: 'viewer' } }))).toBe('Rôle : Lecteur')
		expect(detailAudit(entree({ action: 'role_changed', details: { before: 'viewer', after: 'business_developer' } }))).toBe(
			'Rôle : Lecteur → Business developer',
		)
	})

	it('dit l’accès posé, changé ou retiré', () => {
		const acces = { objet: 'track_access', action: 'granted' }
		expect(detailAudit(entree({ ...acces, details: { before: null, after: 'viewer' } }))).toBe('Accès : Lecture')
		expect(detailAudit(entree({ ...acces, details: { before: 'member', after: 'none' } }))).toBe('Accès : Membre → Aucun accès')
		expect(detailAudit(entree({ objet: 'channel_access', action: 'revoked', details: { access: 'member' } }))).toBe(
			'Accès retiré : Membre',
		)
	})

	it('dit une publication, une exigence, et accorde le compte d’une purge par clé', () => {
		expect(detailAudit(entree({ objet: 'workflow', action: 'published', details: { version_number: 4 } }))).toBe('Version 4')
		expect(detailAudit(entree({ objet: 'workflow_transition', action: 'updated', details: { required_field_added: 'f1' } }))).toBe(
			'Champ exigé ajouté',
		)
		expect(detailAudit(entree({ objet: 'audit_log', action: 'purged', details: { count: 1 } }))).toBe(
			'1 entrée de plus d’un an effacée',
		)
		expect(detailAudit(entree({ objet: 'audit_log', action: 'purged', details: { count: 12 } }))).toBe(
			'12 entrées de plus d’un an effacées',
		)
	})

	it('une modification : le renommage d’abord, puis les clés de réglages, puis les colonnes en mots', () => {
		const maj = { objet: 'track', action: 'updated' }
		expect(detailAudit(entree({ ...maj, details: { changed: ['name'], before: { name: 'A' }, after: { name: 'B' } } }))).toBe(
			'Nom : A → B',
		)
		expect(detailAudit(entree({ objet: 'workspace', action: 'updated', details: { changed: ['settings'], settings_keys: ['theme'] } }))).toBe(
			'Réglages modifiés : theme',
		)
		expect(detailAudit(entree({ ...maj, details: { changed: ['slug', 'secret_id', 'inconnue'] } }))).toBe(
			'Modifié : identifiant court, mot de passe, inconnue',
		)
	})

	it('un détail sans objet rend un texte vide', () => {
		expect(detailAudit(entree({ objet: 'comment', action: 'deleted', details: { card_id: 'c' } }))).toBe('')
		expect(detailAudit(entree({ objet: 'session', action: 'signed_in' }))).toBe('')
	})
})

describe('le journal de la plateforme apprend `logs_purged` (§5.56, §5.66)', () => {
	it('le geste est un mot, et son détail accorde ses deux comptes par clé', () => {
		const purge = { id: 1, acteur: null, geste: 'logs_purged' as const, cible: { platform: 1, connector: 12 }, creeLe: '2026-10-26T03:17:00Z' }
		expect(libelleGeste('logs_purged')).toBe('Journaux purgés')
		expect(detailJournal(purge)).toBe('1 entrée de la plateforme et 12 entrées du connecteur, de plus d’un an')
	})
})
