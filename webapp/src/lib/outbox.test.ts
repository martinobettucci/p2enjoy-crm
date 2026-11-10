// @verifies CRM-144 (docs/BACKLOG.md) — tranche T3 : l'outbox côté webapp — les dossiers et leur adresse, la lecture de
//           chaque dossier dans son ordre et ses états, la pagination de « Envoyés », les comptes, la capacité lue sans
//           jamais la deviner, le dictionnaire des motifs (code inconnu jamais brut), l'issue incertaine, le geste offert
//           selon l'état, le classement des refus, et les deux appels `cancel_outbound_email` et `retry_outbound_email`
// @verifies docs/SPEC-mail-subsystem.md §28.3, §28.4, §28.6, §28.7 ; docs/DESIGN_SYSTEM.md §5.98, §5.59 ; décision 906

import { describe, expect, it } from 'vitest'
import {
	MOTIFS_ENVOI,
	PAGE_ENVOYES,
	annulerEnvoi,
	classerMotif,
	classerRefusOutbox,
	departEchu,
	dossierEnvoiDepuisAdresse,
	envoiDepuisLigne,
	gesteDe,
	issueIncertaine,
	lireComptesEnvois,
	lireEnvois,
	reessayerEnvoi,
	type EnvoiOutbox,
} from './outbox'
import type { ClientCrm } from './supabase'

const LIGNE = {
	id: 'o1',
	card_id: 'c1',
	to_addrs: ['client@exemple.fr'],
	cc_addrs: null,
	bcc_addrs: ['cache@exemple.fr'],
	subject: 'Proposition',
	body_text: 'Bonjour',
	status: 'queued',
	attempts: 2,
	next_attempt_at: '2026-11-10T10:00:00Z',
	last_error: 'timeout',
	sent_at: null,
	updated_at: '2026-11-10T09:00:00Z',
	from_address: 'driss@p2enjoy.test',
	outbox_gestes_permis: true,
	cards: { title: 'Refonte' },
	auteur: { full_name: 'Driss Lemoine' },
}

type Appels = { table?: string; dans?: [string, unknown]; ordres: string[]; limite?: number; rpc?: [string, unknown] }

function espion(reponse: { data?: unknown; error: { message: string } | null; status?: number; count?: number }) {
	const appels: Appels = { ordres: [] }
	const requete = {
		select: () => requete,
		in: (colonne: string, valeurs: unknown) => {
			appels.dans = [colonne, valeurs]
			return requete
		},
		order: (colonne: string) => {
			appels.ordres.push(colonne)
			return requete
		},
		limit: (n: number) => {
			appels.limite = n
			return requete
		},
		then: (resoudre: (valeur: unknown) => unknown) => resoudre({ status: 200, ...reponse }),
	}
	const client = {
		from: (table: string) => {
			appels.table = table
			return requete
		},
		rpc: (fonction: string, arguments_: unknown) => {
			appels.rpc = [fonction, arguments_]
			return Promise.resolve({ status: 200, ...reponse })
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const envoi = (surcharge: Partial<EnvoiOutbox>): EnvoiOutbox => ({ ...envoiDepuisLigne(LIGNE), ...surcharge })

describe('les dossiers et leur adresse (§5.98)', () => {
	it('reconnaît les trois valeurs, et aucune autre', () => {
		expect(dossierEnvoiDepuisAdresse('file')).toBe('file')
		expect(dossierEnvoiDepuisAdresse('envoyes')).toBe('envoyes')
		expect(dossierEnvoiDepuisAdresse('echecs')).toBe('echecs')
		expect(dossierEnvoiDepuisAdresse('sent')).toBeNull()
		expect(dossierEnvoiDepuisAdresse('')).toBeNull()
		expect(dossierEnvoiDepuisAdresse(null)).toBeNull()
	})
})

describe('la ligne lue', () => {
	it('rend ce que l’écran montre, les listes absentes vides', () => {
		const lu = envoiDepuisLigne(LIGNE)
		expect(lu).toMatchObject({
			id: 'o1',
			idCard: 'c1',
			titreCard: 'Refonte',
			destinataires: ['client@exemple.fr'],
			copies: [],
			copiesCachees: ['cache@exemple.fr'],
			statut: 'queued',
			essais: 2,
			motif: 'timeout',
			expediteur: 'driss@p2enjoy.test',
			auteur: 'Driss Lemoine',
			gestesPermis: true,
		})
	})

	it('UNE CAPACITÉ NON RENDUE N’EST PAS UN REFUS (§5.59) : `null`, et la commande reste offerte', () => {
		expect(envoiDepuisLigne({ ...LIGNE, outbox_gestes_permis: undefined }).gestesPermis).toBeNull()
		expect(envoiDepuisLigne({ ...LIGNE, outbox_gestes_permis: null }).gestesPermis).toBeNull()
		expect(envoiDepuisLigne({ ...LIGNE, outbox_gestes_permis: false }).gestesPermis).toBe(false)
	})

	it('un état inconnu ne devient aucun état connu', () => {
		expect(envoiDepuisLigne({ ...LIGNE, status: 'bientot' }).statut).toBe('inconnu')
		expect(gesteDe(envoiDepuisLigne({ ...LIGNE, status: 'bientot' }))).toBe('aucun')
	})
})

describe('lire un dossier (§28.6)', () => {
	it('« En file » : queued et sending, du plus proche départ au plus lointain, sans borne', async () => {
		const { client, appels } = espion({ data: [LIGNE], error: null })
		const lu = await lireEnvois(client, 'file')
		expect(appels.table).toBe('mail_outbox')
		expect(appels.dans).toEqual(['status', ['queued', 'sending']])
		expect(appels.ordres[0]).toBe('next_attempt_at')
		expect(appels.limite).toBeUndefined()
		expect(lu).toMatchObject({ statut: 'pret', donnees: { plusAnciens: false } })
	})

	it('« Envoyés » : sent, du plus récent, une ligne de plus que la page pour savoir s’il en reste', async () => {
		const lignes = Array.from({ length: 3 }, (_, rang) => ({ ...LIGNE, id: `o${rang}`, status: 'sent' }))
		const { client, appels } = espion({ data: lignes, error: null })
		const lu = await lireEnvois(client, 'envoyes', 2)
		expect(appels.dans).toEqual(['status', ['sent']])
		expect(appels.ordres[0]).toBe('sent_at')
		expect(appels.limite).toBe(3)
		if (lu.statut !== 'pret') throw new Error('attendu prêt')
		expect(lu.donnees.envois.map((e) => e.id)).toEqual(['o0', 'o1'])
		expect(lu.donnees.plusAnciens).toBe(true)
		expect(PAGE_ENVOYES).toBe(50)
	})

	it('« Échecs » : failed, du plus récent (`updated_at`)', async () => {
		const { client, appels } = espion({ data: [], error: null })
		const lu = await lireEnvois(client, 'echecs')
		expect(appels.dans).toEqual(['status', ['failed']])
		expect(appels.ordres[0]).toBe('updated_at')
		expect(lu).toEqual({ statut: 'pret', donnees: { envois: [], plusAnciens: false } })
	})

	it('une erreur de la base rend une erreur, jamais une liste vide', async () => {
		const { client } = espion({ data: null, error: { message: 'permission denied' }, status: 403 })
		expect((await lireEnvois(client, 'file')).statut).toBe('erreur')
		expect((await lireEnvois(null, 'file')).statut).toBe('erreur')
	})

	it('les comptes des trois dossiers', async () => {
		const { client } = espion({ data: null, error: null, count: 4 })
		expect(await lireComptesEnvois(client)).toEqual({ statut: 'pret', donnees: { file: 4, envoyes: 4, echecs: 4 } })
		const panne = espion({ data: null, error: { message: 'boom' }, status: 500 })
		expect((await lireComptesEnvois(panne.client)).statut).toBe('erreur')
	})
})

describe('le dictionnaire des motifs (§28.7)', () => {
	it('connaît les douze codes que la file écrit', () => {
		expect(MOTIFS_ENVOI).toHaveLength(12)
		for (const code of MOTIFS_ENVOI) expect(classerMotif(code)).toBe(code)
	})
	it('UN CODE INCONNU REND « inconnu », jamais le code brut ; aucun code, aucun motif', () => {
		expect(classerMotif('smtp_421')).toBe('inconnu')
		expect(classerMotif(null)).toBeNull()
		expect(classerMotif('')).toBeNull()
	})
})

describe('le geste offert, selon l’état et jamais selon un rôle (§5.98)', () => {
	it('en file : annuler ; en échec : réessayer ; en cours : aucune commande ; parti ou annulé : rien', () => {
		expect(gesteDe(envoi({ statut: 'queued', motif: null }))).toBe('annuler')
		expect(gesteDe(envoi({ statut: 'queued', motif: 'timeout' }))).toBe('annuler')
		expect(gesteDe(envoi({ statut: 'failed' }))).toBe('reessayer')
		expect(gesteDe(envoi({ statut: 'sending' }))).toBe('en_cours')
		expect(gesteDe(envoi({ statut: 'sent' }))).toBe('aucun')
		expect(gesteDe(envoi({ statut: 'cancelled' }))).toBe('aucun')
	})
	it('L’ISSUE INCERTAINE (décision 906, Q3) : en file après un essai interrompu, sans commande', () => {
		const incertain = envoi({ statut: 'queued', motif: 'worker_interrompu' })
		expect(issueIncertaine(incertain)).toBe(true)
		expect(gesteDe(incertain)).toBe('incertain')
		expect(issueIncertaine(envoi({ statut: 'failed', motif: 'worker_interrompu' }))).toBe(false)
	})
	it('« au prochain passage » : un départ prévu déjà échu', () => {
		const maintenant = new Date('2026-11-10T10:00:00Z')
		expect(departEchu(envoi({ prevuLe: '2026-11-10T09:59:59Z' }), maintenant)).toBe(true)
		expect(departEchu(envoi({ prevuLe: '2026-11-10T10:00:00Z' }), maintenant)).toBe(true)
		expect(departEchu(envoi({ prevuLe: '2026-11-10T10:00:01Z' }), maintenant)).toBe(false)
		expect(departEchu(envoi({ prevuLe: 'pas une date' }), maintenant)).toBe(false)
	})
})

describe('les refus (§28.3, §28.4)', () => {
	it('chaque refus nommé de la base a sa nature', () => {
		expect(classerRefusOutbox(409, 'outbox_sent')).toBe('parti')
		expect(classerRefusOutbox(409, 'outbox_sending')).toBe('en_cours')
		expect(classerRefusOutbox(409, 'outbox_cancelled')).toBe('deja_annule')
		expect(classerRefusOutbox(409, 'outbox_failed')).toBe('en_echec')
		expect(classerRefusOutbox(409, 'outbox_queued')).toBe('deja_en_file')
		expect(classerRefusOutbox(409, 'outbox_uncertain')).toBe('incertain')
		expect(classerRefusOutbox(404, 'outbox_not_found')).toBe('introuvable')
		expect(classerRefusOutbox(403, 'forbidden')).toBe('refuse')
		expect(classerRefusOutbox(400, 'card_not_available')).toBe('affaire_indisponible')
		expect(classerRefusOutbox(409, 'quota_exceeded')).toBe('quota')
	})
	it('un refus inconnu se replie sur son statut, puis sur « inconnu »', () => {
		expect(classerRefusOutbox(404, 'autre')).toBe('introuvable')
		expect(classerRefusOutbox(401, 'autre')).toBe('refuse')
		expect(classerRefusOutbox(500, 'autre')).toBe('inconnu')
	})
})

describe('les deux gestes', () => {
	it('annuler appelle `cancel_outbound_email` et rend `null` au succès', async () => {
		const { client, appels } = espion({ data: '2026-11-10T10:00:00Z', error: null })
		expect(await annulerEnvoi(client, 'o1')).toBeNull()
		expect(appels.rpc).toEqual(['cancel_outbound_email', { p_outbox_id: 'o1' }])
	})
	it('réessayer appelle `retry_outbound_email`, et rend le refus classé', async () => {
		const { client, appels } = espion({ data: null, error: { message: 'outbox_sent' }, status: 409 })
		expect(await reessayerEnvoi(client, 'o1')).toBe('parti')
		expect(appels.rpc).toEqual(['retry_outbound_email', { p_outbox_id: 'o1' }])
	})
	it('sans client, rien ne part et le refus est inconnu', async () => {
		expect(await annulerEnvoi(null, 'o1')).toBe('inconnu')
	})
})
