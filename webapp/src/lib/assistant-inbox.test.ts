// @verifies CRM-166 (docs/BACKLOG.md) — tranche T2 : la lib de l'assistant de l'inbox — les lots de 5, le flux NDJSON d'un lot, l'« assistant occupé »
//           relancé 6 fois de 5 s en 5 s puis en échec, l'annulation, les refus rendus avant le flux, chaque action vers le geste de la page, l'état
//           d'un fil, accepter un fil (confirmation, déclin, refus de la base), « Tout accepter » qui laisse les actions à confirmation
// @verifies docs/SPEC-ia.md §17.2, §17.4, §17.6, §17.8 ; docs/SPEC-mail-subsystem.md §36.2 à §36.4 ; docs/JOURNAL.md décisions 994 et 997

import { describe, expect, it, vi } from 'vitest'
import type { AccesAssistant } from './assistant-ia'
import {
	accepterFil,
	actionGroupeeDe,
	actionsDeToutAccepter,
	appelDeLAction,
	ATTENTE_OCCUPE_MS,
	decouperEnLots,
	demanderLot,
	etatDeFil,
	ligneProposee,
	LOT_FILS,
	refuserLeFil,
	RELANCES_OCCUPE,
	toutAccepter,
	type ActionDuPlan,
	type Executeur,
	type PlanDeFil,
} from './assistant-inbox'

const action = (nom: ActionDuPlan['action'], cible: ActionDuPlan['cible'] = null, confirmation = false): ActionDuPlan => ({ action: nom, cible, motif: 'motif', confirmation })
const plan = (n: number, actions: ActionDuPlan[]): PlanDeFil => ({ workspace_id: 'espace', thread_key: `fil-${n}`, objet: `Objet ${n}`, expediteur: `e${n}@x.test`, actions })

describe('les lots', () => {
	it('5 fils au plus par lot, dans l’ordre', () => {
		const fils = Array.from({ length: 12 }, (_, n) => n)
		expect(decouperEnLots(fils).map((lot) => lot.length)).toEqual([5, 5, 2])
		expect(decouperEnLots(fils)[0]).toEqual([0, 1, 2, 3, 4])
		expect(LOT_FILS).toBe(5)
		expect(decouperEnLots([])).toEqual([])
	})
})

function flux(lignes: unknown[]): Response {
	return new Response(lignes.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 202, headers: { 'content-type': 'application/x-ndjson' } })
}
const acces = (requete: AccesAssistant['requete']): AccesAssistant => ({ url: 'https://api.test/', cleAnonyme: 'cle-anonyme', jeton: () => 'jeton', requete })
const options = { portee: { workspace_id: 'espace', threads: [] }, demande: 'Marque lu', attendre: async () => undefined }

describe('demanderLot — la fonction ia', () => {
	it('envoie la portée et la demande avec le jeton, lit le flux jusqu’au plan', async () => {
		const requete = vi.fn(async () => flux([{ accepte: true, fils: 1 }, { attente: true }, { issue: 'plan', plans: [plan(1, [action('lu')])], rejetees: 2, ecartes: 1 }]))
		const resultat = await demanderLot(acces(requete), options)
		expect(resultat).toMatchObject({ statut: 'plan', rejetees: 2, ecartes: 1 })
		const [url, init] = requete.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe('https://api.test/functions/v1/ia/inbox/plan')
		expect(init.method).toBe('POST')
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer jeton')
		expect(JSON.parse(init.body as string)).toEqual({ scope: options.portee, demande: 'Marque lu' })
	})

	it('l’échec d’un lot est nommé ; un flux fermé sans issue est « flux coupé »', async () => {
		expect(await demanderLot(acces(async () => flux([{ accepte: true }, { issue: 'echec', echec: 'delai_depasse' }])), options)).toEqual({ statut: 'echec', echec: 'delai_depasse' })
		expect(await demanderLot(acces(async () => flux([{ accepte: true }])), options)).toEqual({ statut: 'echec', echec: 'flux_coupe' })
	})

	it('les refus rendus avant le flux : session, refus, demande, indisponible (avec sa raison), lecture, réseau', async () => {
		const rend = (statut: number, corps: unknown = {}) => acces(async () => new Response(JSON.stringify(corps), { status: statut }))
		expect(await demanderLot(rend(401), options)).toEqual({ statut: 'echec', echec: 'session' })
		expect(await demanderLot(rend(403, { erreur: 'refuse' }), options)).toEqual({ statut: 'echec', echec: 'refuse' })
		expect(await demanderLot(rend(400, { erreur: 'demande_invalide' }), options)).toEqual({ statut: 'echec', echec: 'demande_invalide' })
		expect(await demanderLot(rend(503, { erreur: 'assistant_indisponible', raison: 'cle_absente' }), options)).toEqual({ statut: 'echec', echec: 'indisponible', raison: 'cle_absente' })
		expect(await demanderLot(rend(503, { erreur: 'lecture_impossible' }), options)).toEqual({ statut: 'echec', echec: 'lecture_impossible' })
		expect(await demanderLot(acces(async () => Promise.reject(new TypeError('hors ligne'))), options)).toEqual({ statut: 'echec', echec: 'reseau' })
	})

	it('« assistant occupé » : un 502 avant le flux est relancé, avec la mention, de 5 s en 5 s ; la relance réussie rend le plan', async () => {
		const reponses = [new Response('{}', { status: 502 }), new Response('', { status: 503 }), flux([{ issue: 'plan', plans: [], rejetees: 0, ecartes: 0 }])]
		const attentes: number[] = []
		const occupe: number[] = []
		const resultat = await demanderLot(acces(async () => reponses.shift()!), {
			...options,
			attendre: async (ms) => void attentes.push(ms),
			surOccupe: (essai) => void occupe.push(essai),
		})
		expect(resultat).toMatchObject({ statut: 'plan' })
		expect(attentes).toEqual([ATTENTE_OCCUPE_MS, ATTENTE_OCCUPE_MS])
		expect(occupe).toEqual([1, 2])
	})

	it('au-delà de 6 relances le lot est en échec « occupé » ; un 503 de la fonction n’est pas une attente', async () => {
		const requete = vi.fn(async () => new Response('{}', { status: 502 }))
		const resultat = await demanderLot(acces(requete), options)
		expect(resultat).toEqual({ statut: 'echec', echec: 'occupe' })
		expect(requete).toHaveBeenCalledTimes(RELANCES_OCCUPE + 1)
		const indisponible = vi.fn(async () => new Response(JSON.stringify({ erreur: 'lecture_impossible' }), { status: 503 }))
		await demanderLot(acces(indisponible), options)
		expect(indisponible).toHaveBeenCalledTimes(1)
	})

	it('annuler coupe la requête et rend « annulé », sans relance', async () => {
		const controleur = new AbortController()
		const requete = vi.fn(async (_url: string, init?: RequestInit) => {
			controleur.abort()
			if (init?.signal?.aborted) throw new DOMException('annulé', 'AbortError')
			return flux([])
		})
		expect(await demanderLot(acces(requete), { ...options, signal: controleur.signal })).toEqual({ statut: 'annule' })
		expect(requete).toHaveBeenCalledTimes(1)
		const dejaAnnule = new AbortController()
		dejaAnnule.abort()
		expect(await demanderLot(acces(requete), { ...options, signal: dejaAnnule.signal })).toEqual({ statut: 'annule' })
	})
})

describe('chaque action est le geste de la page (§36.3)', () => {
	const maintenant = new Date('2026-11-25T08:00:00Z')
	const cible = (genre: 'pastille' | 'affaire' | 'membre' | 'duree', id: string) => ({ genre, id, libelle: id })
	it('vers `inbox_bulk_apply` : le même p_action et le même p_argument que les actions groupées', () => {
		expect(appelDeLAction(action('pose_pastille', cible('pastille', 'p-id')))).toEqual({ p_action: 'set_label', p_argument: { label_id: 'p-id', applied: true } })
		expect(appelDeLAction(action('retire_pastille', cible('pastille', 'p-id')))).toEqual({ p_action: 'set_label', p_argument: { label_id: 'p-id', applied: false } })
		expect(appelDeLAction(action('classe', cible('affaire', 'a-id')))).toEqual({ p_action: 'classify', p_argument: { card_id: 'a-id' } })
		expect(appelDeLAction(action('declasse'))).toEqual({ p_action: 'unclassify', p_argument: {} })
		expect(appelDeLAction(action('lu'))).toEqual({ p_action: 'mark_read', p_argument: {} })
		expect(appelDeLAction(action('non_lu'))).toEqual({ p_action: 'mark_unread', p_argument: {} })
		expect(appelDeLAction(action('supprime_ici'))).toEqual({ p_action: 'delete', p_argument: { also_mailbox: false } })
		expect(appelDeLAction(action('supprime_partout', null, true))).toEqual({ p_action: 'delete', p_argument: { also_mailbox: true } })
		expect(appelDeLAction(action('transfere', cible('membre', 'u-id')))).toEqual({ p_action: 'transfer', p_argument: { recipient_id: 'u-id' } })
	})

	it('le sommeil reçoit l’échéance usuelle de la page, calculée par l’écran ; bloquer l’expéditeur n’est pas une action groupée', () => {
		expect(appelDeLAction(action('sommeil', cible('duree', 'demain')), maintenant)).toEqual({ p_action: 'snooze', p_argument: { until: '2026-11-26T08:00:00.000Z' } })
		expect(appelDeLAction(action('sommeil', cible('duree', 'semaine_prochaine')), maintenant)).toEqual({ p_action: 'snooze', p_argument: { until: '2026-12-02T08:00:00.000Z' } })
		expect(appelDeLAction(action('sommeil', cible('duree', 'mois_prochain')), maintenant)).toEqual({ p_action: 'snooze', p_argument: { until: '2026-12-25T08:00:00.000Z' } })
		expect(actionGroupeeDe(action('bloque_expediteur', null, true))).toBeNull()
		expect(actionGroupeeDe(action('sommeil', cible('duree', 'jamais')))).toBeNull()
		expect(actionGroupeeDe(action('classe'))).toBeNull() // sans cible : rien à appeler
	})
})

function executeur(options: { refus?: Record<string, string>; confirme?: boolean } = {}) {
	const appels: string[] = []
	const confirmations: string[] = []
	const e: Executeur = {
		appliquer: async (a, p) => {
			appels.push(`${p.thread_key}:${a.action}`)
			const code = options.refus?.[`${p.thread_key}:${a.action}`]
			return code === undefined ? { statut: 'fait' } : { statut: 'refuse', code }
		},
		confirmer: async (a, p) => (confirmations.push(`${p.thread_key}:${a.action}`), options.confirme ?? true),
	}
	return { e, appels, confirmations }
}

describe('l’état d’un fil et son acceptation (§36.2, §36.3)', () => {
	const trois = plan(1, [action('lu'), action('pose_pastille', { genre: 'pastille', id: 'p', libelle: 'P' }), action('supprime_partout', null, true)])

	it('un fil proposé devient appliqué : toutes ses actions, dans l’ordre du plan, chaque confirmation demandée une fois', async () => {
		const { e, appels, confirmations } = executeur()
		const apres = await accepterFil(ligneProposee(trois), e)
		expect(appels).toEqual(['fil-1:lu', 'fil-1:pose_pastille', 'fil-1:supprime_partout'])
		expect(confirmations).toEqual(['fil-1:supprime_partout'])
		expect(etatDeFil(apres)).toBe('applique')
	})

	it('décliner une confirmation n’annule pas le fil : l’action est déclinée, les autres sont faites, le fil est partiel', async () => {
		const { e, appels } = executeur({ confirme: false })
		const apres = await accepterFil(ligneProposee(trois), e)
		expect(appels).toEqual(['fil-1:lu', 'fil-1:pose_pastille'])
		expect(apres.etats).toEqual(['faite', 'faite', 'declinee'])
		expect(etatDeFil(apres)).toBe('partiel')
	})

	it('un refus de la base est dit sur l’action, n’arrête pas le fil, et se réessaie', async () => {
		const { e } = executeur({ refus: { 'fil-1:pose_pastille': 'forbidden' } })
		const apres = await accepterFil(ligneProposee(trois), e)
		expect(apres.etats).toEqual(['faite', 'refusee', 'faite'])
		expect(apres.refus).toEqual({ 1: 'forbidden' })
		expect(etatDeFil(apres)).toBe('partiel')
		// Réessayé : seules les actions non faites repartent, et le refus levé s'efface.
		const second = executeur()
		const reessaye = await accepterFil(apres, second.e)
		expect(second.appels).toEqual(['fil-1:pose_pastille'])
		expect(etatDeFil(reessaye)).toBe('applique')
		expect(reessaye.refus).toEqual({})
		// Tout refusé : « en échec ».
		const tout = await accepterFil(ligneProposee(plan(2, [action('lu')])), executeur({ refus: { 'fil-2:lu': 'forbidden' } }).e)
		expect(etatDeFil(tout)).toBe('echec')
	})

	it('refuser un fil le rend sans suite ; un fil appliqué ou refusé ne se rejoue pas', async () => {
		const refuse = refuserLeFil(ligneProposee(trois))
		expect(etatDeFil(refuse)).toBe('refuse')
		const { e, appels } = executeur()
		const applique = await accepterFil(ligneProposee(plan(3, [action('lu')])), e)
		expect(refuserLeFil(applique)).toBe(applique)
		await toutAccepter([refuse, applique], e)
		expect(appels).toEqual(['fil-3:lu']) // seul l'appel de l'acceptation ci-dessus : rien de plus
	})
})

describe('« Tout accepter » (§36.4)', () => {
	const lignes = [
		ligneProposee(plan(1, [action('lu'), action('supprime_partout', null, true)])),
		ligneProposee(plan(2, [action('sommeil', { genre: 'duree', id: 'demain', libelle: 'demain' })])),
		ligneProposee(plan(3, [action('bloque_expediteur', null, true)])),
	]

	it('compte ce qu’il applique et ce qui reste à valider une à une', () => {
		expect(actionsDeToutAccepter(lignes)).toEqual({ actions: 2, fils: 2, aConfirmer: 2 })
	})

	it('n’applique que les actions sans confirmation ; celles qui en demandent restent proposées, sans qu’aucune confirmation soit posée', async () => {
		const { e, appels, confirmations } = executeur()
		const progression: number[] = []
		const apres = await toutAccepter(lignes, e, (rang) => void progression.push(rang))
		expect(appels).toEqual(['fil-1:lu', 'fil-2:sommeil'])
		expect(confirmations).toEqual([])
		expect(apres[0]!.etats).toEqual(['faite', 'proposee'])
		expect(etatDeFil(apres[0]!)).toBe('partiel')
		expect(etatDeFil(apres[1]!)).toBe('applique')
		expect(apres[2]!.etats).toEqual(['proposee'])
		expect(etatDeFil(apres[2]!)).toBe('propose')
		expect(progression).toEqual([0, 1, 2])
	})

	it('un fil refusé par la base n’arrête pas les suivants', async () => {
		const { e, appels } = executeur({ refus: { 'fil-1:lu': 'forbidden' } })
		const apres = await toutAccepter(lignes, e)
		expect(appels).toEqual(['fil-1:lu', 'fil-2:sommeil'])
		expect(etatDeFil(apres[0]!)).toBe('echec')
		expect(etatDeFil(apres[1]!)).toBe('applique')
	})

	it('l’action à confirmation restée proposée s’accepte ensuite, fil par fil, avec sa confirmation', async () => {
		const { e } = executeur()
		const apres = await toutAccepter(lignes, e)
		const suite = executeur()
		const final = await accepterFil(apres[0]!, suite.e)
		expect(suite.confirmations).toEqual(['fil-1:supprime_partout'])
		expect(suite.appels).toEqual(['fil-1:supprime_partout'])
		expect(etatDeFil(final)).toBe('applique')
	})
})
