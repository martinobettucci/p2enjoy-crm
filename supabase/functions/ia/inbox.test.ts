// @verifies CRM-166 (docs/BACKLOG.md) — tranche T1 : l'assistant de l'inbox, côté fonction — la demande au modèle (troncature, texte tiré du
//           HTML, aucune pièce jointe, aucun destinataire, les clés courtes), le contrôle de la sortie (chaque rejet, les contradictions,
//           l'ordre, la suppression qui ferme le fil), la route `POST /ia/inbox/plan` (authentification, l'espace refusé sans appel au
//           modèle, le flux, l'annulation qui coupe la génération, les échecs nommés, le journal sans contenu)
// @verifies docs/SPEC-ia.md §17.2 à §17.8 ; docs/SPEC-mail-subsystem.md §36.3 ; docs/JOURNAL.md décisions 994 et 997 ; CLAUDE.md §10, §20

import { describe, expect, it } from 'vitest'
import { lireConfiguration } from './configuration.ts'
import type { DependancesIa } from './handler.ts'
import { traiterIa } from './handler.ts'
import {
	ACTIONS,
	controlerPlan,
	demandeInbox,
	LOT_FILS,
	MOTIF_MAX,
	type ContexteInbox,
	type FilLu,
} from './inbox.ts'
import type { Generation } from './ollama.ts'

const ESPACE = '0c970000-0000-4000-8000-0000000000e1'
const PASTILLE_1 = '0c970000-0000-4000-8000-0000000000b1'
const PASTILLE_2 = '0c970000-0000-4000-8000-0000000000b2'
const AFFAIRE = '0c970000-0000-4000-8000-0000000000c1'
const MEMBRE = '0c970000-0000-4000-8000-0000000000d1'
const SECRET_DEMANDE = 'Archive les factures du fournisseur Zorglub — confidentiel'

const fil = (n: number, extra: Partial<FilLu> = {}): FilLu => ({
	workspace_id: ESPACE,
	thread_key: `fil-${n}`,
	subject: `Objet ${n}`,
	from_name: `Expéditeur ${n}`,
	from_address: `exp${n}@exemple.test`,
	received_at: '2026-11-25T08:00:00Z',
	body_text: `Texte ${n}`,
	body_html: null,
	...extra,
})

const CONTEXTE: ContexteInbox = {
	labels: [
		{ id: PASTILLE_1, name: 'Facture', description: 'Une facture fournisseur' },
		{ id: PASTILLE_2, name: 'Lead', description: null },
	],
	cards: [{ id: AFFAIRE, title: 'Refonte intranet' }],
	members: [{ id: MEMBRE, full_name: 'Driss Lemoine' }],
}

describe('demandeInbox — ce qui part au modèle (§17.3)', () => {
	it('porte la demande, les listes à clés courtes, les mails ; jamais un identifiant de la base', () => {
		const demande = demandeInbox('Classe dans la refonte', [fil(1), fil(2)], CONTEXTE)
		const contenu = demande.messages[1]!.content
		expect(contenu).toContain('Classe dans la refonte')
		expect(contenu).toContain('- p1 : Facture — Une facture fournisseur')
		expect(contenu).toContain('- p2 : Lead')
		expect(contenu).toContain('- a1 : Refonte intranet')
		expect(contenu).toContain('- u1 : Driss Lemoine')
		expect(contenu).toContain('[f1]')
		expect(contenu).toContain('[f2]')
		expect(contenu).toContain('Durées de sommeil possibles : demain, semaine_prochaine, mois_prochain')
		for (const id of [PASTILLE_1, AFFAIRE, MEMBRE, ESPACE, 'fil-1']) expect(contenu).not.toContain(id)
		expect(demande.messages[0]!.role).toBe('system')
	})

	it('tronque le texte à 2 000 caractères et tire le texte du HTML à défaut de texte brut', () => {
		const long = demandeInbox('x', [fil(1, { body_text: 'a'.repeat(5_000) })], CONTEXTE).messages[1]!.content
		expect(long).toContain('a'.repeat(2_000))
		expect(long).not.toContain('a'.repeat(2_001))
		const html = demandeInbox('x', [fil(1, { body_text: null, body_html: '<p>Bonjour <b>Zorglub</b></p><script>1</script>' })], CONTEXTE).messages[1]!.content
		expect(html).toContain('Bonjour Zorglub')
		expect(html).not.toContain('<p>')
	})

	it('le schéma énumère les clés de la demande, borne les actions et les motifs', () => {
		const { schema } = demandeInbox('x', [fil(1), fil(2)], CONTEXTE)
		const s = schema as { properties: { plans: { maxItems: number; items: { properties: Record<string, { enum?: string[]; maxItems?: number; items?: { properties: Record<string, { enum?: string[]; maxLength?: number }> } }> } } } }
		expect(s.properties.plans.maxItems).toBe(2)
		const item = s.properties.plans.items.properties
		expect(item.fil!.enum).toEqual(['f1', 'f2'])
		expect(item.actions!.maxItems).toBe(4)
		expect(item.actions!.items!.properties.action!.enum).toEqual([...ACTIONS])
		expect(item.actions!.items!.properties.cible!.enum).toEqual(['', 'p1', 'p2', 'a1', 'u1', 'demain', 'semaine_prochaine', 'mois_prochain'])
		expect(item.actions!.items!.properties.motif!.maxLength).toBe(MOTIF_MAX)
	})
})

function cles() {
	return demandeInbox('x', [fil(1), fil(2), fil(3)], CONTEXTE).cles
}
const sortie = (...plans: unknown[]) => ({ plans })
const act = (action: string, cible = '', motif = 'parce que') => ({ action, cible, motif })

describe('controlerPlan — la sortie n’est jamais crue (§17.5)', () => {
	it('garde un plan conforme, résout les clés en identifiants et en libellés, pose la confirmation', () => {
		const resultat = controlerPlan(
			sortie({ fil: 'f1', actions: [act('pose_pastille', 'p1', '  Une facture  '), act('classe', 'a1'), act('sommeil', 'demain'), act('supprime_partout')] }),
			cles(),
		)!
		expect(resultat.rejetees).toBe(0)
		const plan = resultat.plans[0]!
		expect(plan.thread_key).toBe('fil-1')
		expect(plan.objet).toBe('Objet 1')
		expect(plan.expediteur).toBe('exp1@exemple.test')
		expect(plan.actions.map((a) => a.action)).toEqual(['pose_pastille', 'sommeil', 'classe', 'supprime_partout'])
		expect(plan.actions[0]).toEqual({ action: 'pose_pastille', cible: { genre: 'pastille', id: PASTILLE_1, libelle: 'Facture' }, motif: 'Une facture', confirmation: false })
		expect(plan.actions[2]!.cible).toEqual({ genre: 'affaire', id: AFFAIRE, libelle: 'Refonte intranet' })
		expect(plan.actions[3]!.confirmation).toBe(true)
		expect(resultat.plans).toHaveLength(1) // les fils sans action n'y figurent pas
	})

	it('rejette et compte : un fil hors du lot, une action inconnue, une clé inconnue, une cible incompatible, une cible superflue', () => {
		const resultat = controlerPlan(
			sortie(
				{ fil: 'f99', actions: [act('lu')] },
				{ fil: 'f1', actions: [act('inconnue'), act('pose_pastille', 'p99'), act('classe', 'p1'), act('lu', 'a1'), act('non_lu')] },
			),
			cles(),
		)!
		expect(resultat.rejetees).toBe(5)
		expect(resultat.plans[0]!.actions.map((a) => a.action)).toEqual(['non_lu'])
	})

	it('une pastille ne se prend jamais pour une affaire : la clé est du bon genre, ou rejetée', () => {
		const resultat = controlerPlan(sortie({ fil: 'f1', actions: [act('transfere', 'a1'), act('sommeil', 'p1')] }), cles())!
		expect(resultat.plans).toHaveLength(0)
		expect(resultat.rejetees).toBe(2)
	})

	it('les doublons tombent ; la première de deux actions contradictoires est gardée', () => {
		const resultat = controlerPlan(
			sortie({
				fil: 'f1',
				actions: [act('lu'), act('lu'), act('non_lu'), act('pose_pastille', 'p1'), act('retire_pastille', 'p1'), act('pose_pastille', 'p2')],
			}),
			cles(),
		)!
		expect(resultat.plans[0]!.actions.map((a) => `${a.action}:${a.cible?.id ?? ''}`)).toEqual([`pose_pastille:${PASTILLE_1}`, `pose_pastille:${PASTILLE_2}`, 'lu:'])
		expect(resultat.rejetees).toBe(2) // non_lu et retire_pastille ; le doublon de `lu` tombe sans être compté
	})

	it('une seule affaire, un seul sommeil, un seul transfert ; classer puis déclasser se contredit', () => {
		const resultat = controlerPlan(
			sortie({ fil: 'f1', actions: [act('sommeil', 'demain'), act('sommeil', 'mois_prochain'), act('declasse'), act('classe', 'a1')] }),
			cles(),
		)!
		expect(resultat.plans[0]!.actions.map((a) => a.action)).toEqual(['sommeil', 'declasse'])
		expect(resultat.rejetees).toBe(2)
	})

	it('une suppression ferme le fil du plan : rien ne la suit ; supprimer ici et partout se contredisent', () => {
		const resultat = controlerPlan(sortie({ fil: 'f1', actions: [act('supprime_ici'), act('lu'), act('supprime_partout')] }), cles())!
		expect(resultat.plans[0]!.actions.map((a) => a.action)).toEqual(['supprime_ici'])
		expect(resultat.rejetees).toBe(2)
		// Une suppression donnée en DERNIER reste en dernier : les gestes qui la précèdent sont gardés.
		const apres = controlerPlan(sortie({ fil: 'f1', actions: [act('lu'), act('supprime_ici')] }), cles())!
		expect(apres.plans[0]!.actions.map((a) => a.action)).toEqual(['lu', 'supprime_ici'])
	})

	it('au plus quatre actions par fil ; l’ordre de l’application met ce qui sort le fil de son dossier en dernier', () => {
		const resultat = controlerPlan(
			sortie({ fil: 'f1', actions: [act('classe', 'a1'), act('lu'), act('bloque_expediteur'), act('transfere', 'u1'), act('pose_pastille', 'p1')] }),
			cles(),
		)!
		expect(resultat.plans[0]!.actions.map((a) => a.action)).toEqual(['lu', 'transfere', 'classe', 'bloque_expediteur'])
		expect(resultat.rejetees).toBe(1)
	})

	it('rogne le motif à 200 caractères et ne le rend qu’en texte', () => {
		const resultat = controlerPlan(sortie({ fil: 'f1', actions: [act('lu', '', `<b>${'m'.repeat(400)}</b>`)] }), cles())!
		expect(resultat.plans[0]!.actions[0]!.motif).toHaveLength(MOTIF_MAX)
	})

	it('fusionne deux entrées du même fil, et rend `null` quand la forme est fausse (reponse_invalide)', () => {
		const fusion = controlerPlan(sortie({ fil: 'f1', actions: [act('lu')] }, { fil: 'f1', actions: [act('sommeil', 'demain')] }), cles())!
		expect(fusion.plans[0]!.actions.map((a) => a.action)).toEqual(['lu', 'sommeil'])
		for (const faux of [null, 'texte', [], {}, { plans: 'x' }, { plans: {} }]) expect(controlerPlan(faux, cles())).toBeNull()
		const mal = controlerPlan(sortie('pas un objet', { fil: 'f1' }, { fil: 'f1', actions: [{ action: 'lu' }] }), cles())!
		expect(mal.plans).toHaveLength(0)
		expect(mal.rejetees).toBe(3)
	})
})

// ── La route ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Banc = {
	d: DependancesIa
	modele: { messages: unknown; schema: unknown; signal: AbortSignal }[]
	journal: string[]
	lectures: string[]
}

function banc(options: {
	cle?: string | null
	contexte?: ContexteInbox | 'refuse' | null
	fils?: readonly FilLu[] | 'refuse' | 'portee_invalide' | null
	generation?: Generation | 'attendre-la-coupure'
} = {}): Banc {
	const b: Banc = { d: undefined as never, modele: [], journal: [], lectures: [] }
	const configuration = lireConfiguration((nom) =>
		({ OLLAMA_HOST: 'https://llm.example.test', OLLAMA_API_KEY: options.cle === undefined ? 'sk-secret-du-serveur' : options.cle ?? undefined })[nom],
	)
	b.d = {
		configuration,
		lireContexteInbox: async (jeton, espace) => (b.lectures.push(`contexte:${espace}:${jeton}`), options.contexte === undefined ? CONTEXTE : options.contexte),
		lireFilsInbox: async (jeton) => (b.lectures.push(`fils:${jeton}`), options.fils === undefined ? [fil(1), fil(2)] : options.fils),
		async genererInbox(_cible, messages, schema, signal) {
			b.modele.push({ messages, schema, signal })
			if (options.generation === 'attendre-la-coupure') {
				await new Promise<void>((resoudre) => signal.addEventListener('abort', () => resoudre()))
				return { ok: false, echec: 'serveur_injoignable' }
			}
			return (
				options.generation ?? {
					ok: true,
					contenu: sortie({ fil: 'f1', actions: [act('lu', '', 'À lire'), act('pose_pastille', 'p99')] }, { fil: 'f99', actions: [act('lu')] }),
					jetonsEntree: 1200,
					jetonsSortie: 80,
					dureeMs: 4_000,
				}
			)
		},
		battementMs: 60_000,
		maintenantMs: () => Date.parse('2026-11-25T12:00:00Z'),
		journaliser: (e) => void b.journal.push(JSON.stringify(e)),
	} satisfies Partial<DependancesIa> as unknown as DependancesIa
	return b
}

const SCOPE = {
	workspace_id: ESPACE,
	folder: 'unclassified',
	snoozed: 'shown',
	threads: [
		{ workspace_id: ESPACE, thread_key: 'fil-1' },
		{ workspace_id: ESPACE, thread_key: 'fil-2' },
	],
}

const plan = (b: Banc, corps: unknown = { scope: SCOPE, demande: SECRET_DEMANDE }, jeton: string | null = 'jeton-de-la-personne', methode = 'POST') =>
	traiterIa(
		new Request('http://functions/ia/inbox/plan', {
			method: methode,
			headers: { 'content-type': 'application/json', ...(jeton === null ? {} : { authorization: `Bearer ${jeton}` }) },
			...(methode === 'POST' ? { body: JSON.stringify(corps) } : {}),
		}),
		b.d,
	)

async function lignes(reponse: Response): Promise<Record<string, unknown>[]> {
	expect(reponse.headers.get('content-type')).toContain('application/x-ndjson')
	return (await reponse.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('POST /ia/inbox/plan', () => {
	it('202 ; la première ligne dit les fils lus, la dernière porte le plan contrôlé et les comptes', async () => {
		const b = banc({ fils: [fil(1)] })
		const reponse = await plan(b)
		expect(reponse.status).toBe(202)
		const flux = await lignes(reponse)
		expect(flux[0]).toEqual({ accepte: true, fils: 1 })
		const issue = flux.at(-1)!
		expect(issue).toMatchObject({ issue: 'plan', rejetees: 2, ecartes: 1 }) // p99 et f99 ; fil-2 n'est pas rendu par la base
		expect((issue.plans as { thread_key: string; actions: { action: string }[] }[])[0]).toMatchObject({ thread_key: 'fil-1' })
		expect(b.modele).toHaveLength(1)
		// Lu AVEC LE JETON DE LA PERSONNE, jamais avec une autre clé.
		expect(b.lectures).toEqual([`contexte:${ESPACE}:jeton-de-la-personne`, 'fils:jeton-de-la-personne'])
	})

	it('le journal ne porte que des comptes : ni la demande, ni un objet, une adresse, un titre, un membre, ni la clé', async () => {
		const b = banc()
		await lignes(await plan(b))
		const journal = b.journal.join('\n')
		expect(journal).toContain('plan_inbox_ecrit')
		for (const secret of [SECRET_DEMANDE, 'Zorglub', 'Objet 1', 'exp1@exemple.test', 'Refonte intranet', 'Driss', 'sk-secret-du-serveur', 'fil-1']) {
			expect(journal).not.toContain(secret)
		}
		expect(JSON.parse(b.journal.at(-1)!)).toMatchObject({ evenement: 'plan_inbox_ecrit', fils: 2, actions: 1, rejetees: 2, ecartes: 0 })
	})

	it('un espace qui n’est pas le sien : 403, et AUCUN appel au modèle ni lecture de fil', async () => {
		const b = banc({ contexte: 'refuse' })
		expect((await plan(b)).status).toBe(403)
		expect(b.modele).toHaveLength(0)
		expect(b.lectures).toEqual([`contexte:${ESPACE}:jeton-de-la-personne`])
		const refusFils = banc({ fils: 'refuse' })
		expect((await plan(refusFils)).status).toBe(403)
		expect(refusFils.modele).toHaveLength(0)
	})

	it('sans jeton 401 ; mauvaise méthode 405 ; clé absente 503 ; lecture en panne 503 ; portée refusée par la base 400', async () => {
		expect((await plan(banc(), undefined, null)).status).toBe(401)
		expect((await plan(banc(), undefined, 'j', 'GET')).status).toBe(405)
		expect(await (await plan(banc({ cle: null }))).json()).toEqual({ erreur: 'assistant_indisponible', raison: 'cle_absente' })
		expect((await plan(banc({ contexte: null }))).status).toBe(503)
		expect((await plan(banc({ fils: null }))).status).toBe(503)
		expect((await plan(banc({ fils: 'portee_invalide' }))).status).toBe(400)
	})

	it('400 : demande vide ou trop longue, portée sans fils cochés, plus de 5 fils, fils d’un autre espace, clé de fil vide', async () => {
		const b = banc()
		const refus = async (corps: unknown) => (await plan(b, corps)).status
		expect(await refus({ scope: SCOPE, demande: '   ' })).toBe(400)
		expect(await refus({ scope: SCOPE, demande: 'x'.repeat(1_001) })).toBe(400)
		expect(await refus({ scope: SCOPE })).toBe(400)
		expect(await refus({ demande: 'x' })).toBe(400)
		// « Tout le filtre » ne se confond jamais avec un lot : sans fils explicites, rien n'est lu.
		expect(await refus({ scope: { workspace_id: ESPACE, folder: 'unclassified', only_me: true }, demande: 'x' })).toBe(400)
		expect(await refus({ scope: { ...SCOPE, threads: [] }, demande: 'x' })).toBe(400)
		const six = Array.from({ length: LOT_FILS + 1 }, (_, n) => ({ workspace_id: ESPACE, thread_key: `fil-${n}` }))
		expect(await refus({ scope: { ...SCOPE, threads: six }, demande: 'x' })).toBe(400)
		const etranger = [{ workspace_id: '0c970000-0000-4000-8000-0000000000e2', thread_key: 'fil-1' }]
		expect(await refus({ scope: { ...SCOPE, threads: etranger }, demande: 'x' })).toBe(400)
		expect(await refus({ scope: { ...SCOPE, threads: [{ workspace_id: ESPACE, thread_key: '' }] }, demande: 'x' })).toBe(400)
		expect(b.lectures).toEqual([])
	})

	it('des fils que la base ne rend pas : écartés et comptés, sans appel au modèle quand il n’en reste aucun', async () => {
		const b = banc({ fils: [] })
		const flux = await lignes(await plan(b))
		expect(flux.at(-1)).toEqual({ issue: 'plan', plans: [], rejetees: 0, ecartes: 2 })
		expect(b.modele).toHaveLength(0)
	})

	it('les échecs du lot sont nommés : le délai, la clé refusée, une réponse hors schéma', async () => {
		for (const echec of ['delai_depasse', 'cle_refusee', 'serveur_injoignable'] as const) {
			const flux = await lignes(await plan(banc({ generation: { ok: false, echec } })))
			expect(flux.at(-1)).toEqual({ issue: 'echec', echec })
		}
		const invalide = await lignes(await plan(banc({ generation: { ok: true, contenu: { rien: 1 }, jetonsEntree: 1, jetonsSortie: 1, dureeMs: 1 } })))
		expect(invalide.at(-1)).toEqual({ issue: 'echec', echec: 'reponse_invalide' })
	})

	it('le départ du client coupe la génération : le signal donné au modèle est annulé', async () => {
		const b = banc({ generation: 'attendre-la-coupure' })
		const reponse = await plan(b)
		const lecteur = reponse.body!.getReader()
		await lecteur.read() // la première ligne
		await new Promise((r) => setTimeout(r, 0))
		expect(b.modele).toHaveLength(1)
		expect(b.modele[0]!.signal.aborted).toBe(false)
		await lecteur.cancel()
		expect(b.modele[0]!.signal.aborted).toBe(true)
	})
})
