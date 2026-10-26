// @spec CRM-072 (docs/BACKLOG.md) — tranche T2 : la présentation d'une entrée du journal d'audit
// @spec docs/SPEC-audit.md §4 (les paires objet / action), §5 (ce que `details` porte), §7.3 (le nom d'un contact, lu à
//       l'affichage) ; docs/DESIGN_SYSTEM.md §5.66 (phrase par clé, paire inconnue laissée vide, détail par clé, acteur
//       nul nommé « Système ou compte supprimé »), §10 (aucune phrase par concaténation) ; docs/JOURNAL.md décision 728

import { t, type CleTraduction } from '../i18n'
import type { EntreeAudit, FamilleAudit } from '../lib/audit'
import type { RoleEspace } from '../lib/plateforme'
import { libelleRole } from './presentation-plateforme'

export const CLES_FAMILLE: Readonly<Record<FamilleAudit, CleTraduction>> = {
	access: 'audit.family.access',
	configuration: 'audit.family.configuration',
	sign_in: 'audit.family.sign_in',
	export: 'audit.family.export',
	deletion: 'audit.family.deletion',
	retention: 'audit.family.retention',
}

/**
 * Une clé par paire objet / action (`docs/SPEC-audit.md` §4). Les phrases qui nomment leur objet portent `{objet}` ;
 * celles d'un contenu (commentaire, activité), d'une connexion, d'une purge ou d'un contact supprimé n'en portent pas.
 */
const CLES_GESTE: Readonly<Record<string, CleTraduction>> = {
	'member.added': 'audit.geste.member.added',
	'member.role_changed': 'audit.geste.member.role_changed',
	'member.removed': 'audit.geste.member.removed',
	'invitation.created': 'audit.geste.invitation.created',
	'invitation.removed': 'audit.geste.invitation.removed',
	'track_access.granted': 'audit.geste.track_access.granted',
	'track_access.revoked': 'audit.geste.track_access.revoked',
	'channel_access.granted': 'audit.geste.channel_access.granted',
	'channel_access.revoked': 'audit.geste.channel_access.revoked',
	'workspace.updated': 'audit.geste.workspace.updated',
	'track.created': 'audit.geste.track.created',
	'track.updated': 'audit.geste.track.updated',
	'track.trashed': 'audit.geste.track.trashed',
	'track.restored': 'audit.geste.track.restored',
	'track.destroyed': 'audit.geste.track.destroyed',
	'channel.created': 'audit.geste.channel.created',
	'channel.updated': 'audit.geste.channel.updated',
	'channel.trashed': 'audit.geste.channel.trashed',
	'channel.restored': 'audit.geste.channel.restored',
	'channel.destroyed': 'audit.geste.channel.destroyed',
	'workflow.created': 'audit.geste.workflow.created',
	'workflow.updated': 'audit.geste.workflow.updated',
	'workflow.archived': 'audit.geste.workflow.archived',
	'workflow.deleted': 'audit.geste.workflow.deleted',
	'workflow.published': 'audit.geste.workflow.published',
	'workflow_step.created': 'audit.geste.workflow_step.created',
	'workflow_step.updated': 'audit.geste.workflow_step.updated',
	'workflow_step.deleted': 'audit.geste.workflow_step.deleted',
	'workflow_transition.created': 'audit.geste.workflow_transition.created',
	'workflow_transition.updated': 'audit.geste.workflow_transition.updated',
	'workflow_transition.deleted': 'audit.geste.workflow_transition.deleted',
	'workflow_node.created': 'audit.geste.workflow_node.created',
	'workflow_node.updated': 'audit.geste.workflow_node.updated',
	'workflow_node.archived': 'audit.geste.workflow_node.archived',
	'workflow_node.deleted': 'audit.geste.workflow_node.deleted',
	'form_field.created': 'audit.geste.form_field.created',
	'form_field.updated': 'audit.geste.form_field.updated',
	'form_field.archived': 'audit.geste.form_field.archived',
	'form_field.deleted': 'audit.geste.form_field.deleted',
	'form_field_rule.created': 'audit.geste.form_field_rule.created',
	'form_field_rule.updated': 'audit.geste.form_field_rule.updated',
	'form_field_rule.deleted': 'audit.geste.form_field_rule.deleted',
	'mail_account.created': 'audit.geste.mail_account.created',
	'mail_account.updated': 'audit.geste.mail_account.updated',
	'mail_account.deleted': 'audit.geste.mail_account.deleted',
	'mail_identity.created': 'audit.geste.mail_identity.created',
	'mail_identity.updated': 'audit.geste.mail_identity.updated',
	'mail_identity.deleted': 'audit.geste.mail_identity.deleted',
	'card.trashed': 'audit.geste.card.trashed',
	'card.restored': 'audit.geste.card.restored',
	'card.destroyed': 'audit.geste.card.destroyed',
	'comment.deleted': 'audit.geste.comment.deleted',
	'activity.deleted': 'audit.geste.activity.deleted',
	'contact.deleted': 'audit.geste.contact.deleted',
	'contact.anonymized': 'audit.geste.contact.anonymized',
	'contact.exported': 'audit.geste.contact.exported',
	'organization.deleted': 'audit.geste.organization.deleted',
	'session.signed_in': 'audit.geste.session.signed_in',
	'audit_log.purged': 'audit.geste.audit_log.purged',
}

/** Les colonnes de configuration nommées par un mot ; une colonne inconnue paraît sous sa clé (§5.66). */
const CLES_COLONNE: Readonly<Record<string, CleTraduction>> = {
	name: 'audit.colonne.name',
	slug: 'audit.colonne.slug',
	label: 'audit.colonne.label',
	label_override: 'audit.colonne.label',
	key: 'audit.colonne.key',
	type: 'audit.colonne.type',
	kind: 'audit.colonne.kind',
	color: 'audit.colonne.color',
	options: 'audit.colonne.options',
	help_text: 'audit.colonne.help_text',
	archived_at: 'audit.colonne.archived_at',
	inbound_domain: 'audit.colonne.inbound_domain',
	settings: 'audit.colonne.settings',
	workflow_id: 'audit.colonne.workflow_id',
	node_id: 'audit.colonne.node_id',
	probability_override: 'audit.colonne.probability',
	default_probability: 'audit.colonne.probability',
	stale_after_days: 'audit.colonne.stale_after_days',
	default_stale_after_days: 'audit.colonne.stale_after_days',
	is_initial: 'audit.colonne.is_initial',
	from_step_id: 'audit.colonne.from_step_id',
	to_step_id: 'audit.colonne.to_step_id',
	require_comment: 'audit.colonne.require_comment',
	secret_id: 'audit.colonne.secret_id',
	imap_host: 'audit.colonne.server',
	smtp_host: 'audit.colonne.server',
	imap_port: 'audit.colonne.port',
	smtp_port: 'audit.colonne.port',
	imap_security: 'audit.colonne.security',
	smtp_security: 'audit.colonne.security',
	imap_username: 'audit.colonne.username',
	smtp_username: 'audit.colonne.username',
	from_address: 'audit.colonne.from_address',
	from_name: 'audit.colonne.from_name',
	signature_text: 'audit.colonne.signature_text',
	is_default: 'audit.colonne.is_default',
	daily_quota: 'audit.colonne.daily_quota',
	watch_folders: 'audit.colonne.watch_folders',
	folder_style: 'audit.colonne.folder_style',
	backfill_months: 'audit.colonne.backfill_months',
	visibility: 'audit.colonne.visibility',
}

const CLES_ACCES: Readonly<Record<string, CleTraduction>> = {
	member: 'members.rights.posed.member',
	viewer: 'members.rights.posed.viewer',
	none: 'members.rights.posed.none',
}

const chaine = (valeur: unknown): string => (typeof valeur === 'string' ? valeur : '')
const sous = (objet: Readonly<Record<string, unknown>>, cle: string): Readonly<Record<string, unknown>> => {
	const valeur = objet[cle]
	return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : {}
}
const listeDeTextes = (valeur: unknown): readonly string[] =>
	Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === 'string') : []
const roleDe = (valeur: unknown): string =>
	valeur === 'admin' || valeur === 'business_developer' || valeur === 'viewer' ? libelleRole(valeur as RoleEspace) : ''
const accesDe = (valeur: unknown): string => {
	const cle = typeof valeur === 'string' ? CLES_ACCES[valeur] : undefined
	return cle === undefined ? '' : t(cle)
}
const colonneDe = (colonne: string): string => {
	const cle = CLES_COLONNE[colonne]
	return cle === undefined ? colonne : t(cle)
}

/** La clé de la phrase d'une entrée, ou `null` pour une paire que l'écran ne connaît pas. */
export function cleGeste(entree: Pick<EntreeAudit, 'objet' | 'action'>): CleTraduction | null {
	return CLES_GESTE[`${entree.objet}.${entree.action}`] ?? null
}

/**
 * L'objet que la phrase nomme. Un contact est nommé par le carnet, lu à l'affichage (`nomsContacts`) : absent, il n'existe
 * plus. Un objet sans libellé — une transition sans libellé propre — se dit « sans libellé », jamais par un blanc.
 */
export function objetNomme(entree: EntreeAudit, nomsContacts: ReadonlyMap<string, string>): string {
	if (entree.objet === 'contact') {
		const nom = entree.idObjet === null ? undefined : nomsContacts.get(entree.idObjet)
		return nom ?? t('audit.objet.contactSupprime')
	}
	const libelle = entree.libelle?.trim() ?? ''
	return libelle === '' ? t('audit.objet.sansLibelle') : libelle
}

/** La phrase du geste ; une paire inconnue rend un texte vide, jamais le code brut (§5.66). */
export function libelleGesteAudit(entree: EntreeAudit, nomsContacts: ReadonlyMap<string, string>): string {
	const cle = cleGeste(entree)
	return cle === null ? '' : t(cle, { objet: objetNomme(entree, nomsContacts) })
}

/** L'acteur : le nom, ou la seule mention qui ne devine pas la cause d'un acteur nul (§5.66). */
export function libelleActeurAudit(entree: EntreeAudit): string {
	return entree.acteur ?? t('audit.acteur.systeme')
}

/** Le détail d'une entrée, composé par clé à partir de `details` ; un détail sans objet rend un texte vide. */
export function detailAudit(entree: EntreeAudit): string {
	const d = entree.details
	switch (`${entree.objet}.${entree.action}`) {
		case 'member.added':
		case 'member.removed':
		case 'invitation.created':
		case 'invitation.removed':
			return roleDe(d['role']) === '' ? '' : t('audit.detail.role', { role: roleDe(d['role']) })
		case 'member.role_changed':
			return t('audit.detail.roleChange', { avant: roleDe(d['before']), apres: roleDe(d['after']) })
		case 'track_access.granted':
		case 'channel_access.granted':
			return d['before'] === null || d['before'] === undefined
				? t('audit.detail.accesPose', { apres: accesDe(d['after']) })
				: t('audit.detail.accesChange', { avant: accesDe(d['before']), apres: accesDe(d['after']) })
		case 'track_access.revoked':
		case 'channel_access.revoked':
			return t('audit.detail.accesRetire', { avant: accesDe(d['access']) })
		case 'workflow.published':
			return typeof d['version_number'] === 'number' ? t('audit.detail.version', { numero: String(d['version_number']) }) : ''
		case 'workflow_transition.updated':
			if (typeof d['required_field_added'] === 'string') return t('audit.detail.exigenceAjoutee')
			if (typeof d['required_field_removed'] === 'string') return t('audit.detail.exigenceRetiree')
			return detailModification(d)
		case 'audit_log.purged': {
			const nombre = typeof d['count'] === 'number' ? d['count'] : 0
			return t(nombre === 1 ? 'audit.detail.purge.un' : 'audit.detail.purge.plusieurs', { nombre: String(nombre) })
		}
		default:
			return entree.action === 'updated' ? detailModification(d) : ''
	}
}

/**
 * Une modification : le renommage d'abord quand le nom ou le libellé change, sinon les colonnes changées en mots, et les
 * CLÉS de réglages changées — jamais leurs valeurs (`docs/SPEC-audit.md` §5).
 */
function detailModification(d: Readonly<Record<string, unknown>>): string {
	const avant = sous(d, 'before')
	const apres = sous(d, 'after')
	for (const colonne of ['name', 'label', 'label_override']) {
		if (colonne in avant || colonne in apres) {
			return t('audit.detail.renomme', { avant: chaine(avant[colonne]), apres: chaine(apres[colonne]) })
		}
	}
	const cles = listeDeTextes(d['settings_keys'])
	if (cles.length > 0) return t('audit.detail.reglages', { cles: cles.join(', ') })
	const colonnes = listeDeTextes(d['changed'])
	return colonnes.length === 0 ? '' : t('audit.detail.modifie', { colonnes: colonnes.map(colonneDe).join(', ') })
}
