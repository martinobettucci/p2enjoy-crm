// @verifies CRM-141 (docs/BACKLOG.md) — tranche T2 : l'évaluation des pastilles d'un mail — la demande au modèle, le
//           contrôle de sa sortie, la passe et sa route
// @verifies docs/SPEC-ia.md §15.1 (l'objet, l'expéditeur et 2 000 caractères ; le texte tiré du HTML ; jamais une pièce
//           jointe, un destinataire ni un identifiant de la base), §15.2 (sortie structurée, clés courtes, température 0,
//           borne de 30 s), §15.3 (clé inconnue rejetée et comptée, doublons, JSON hors schéma), §15.4 (le secret exigé ;
//           le mode dégradé sans rien prendre ; la passe bornée à 100 s, arrêtée au premier échec ; des comptes seuls) ;
//           docs/SPEC-mail-subsystem.md §31.5 ; CLAUDE.md §20 (aucun contenu au journal)

import { describe, expect, it } from 'vitest'
import { lireConfiguration } from './configuration.ts'
import { EN_TETE_DISPATCH_PASTILLES, passePastilles, traiterIa, type DependancesIa } from './handler.ts'
import type { EchecGeneration, Generation, Message } from './ollama.ts'
import {
	BUDGET_PASSE_MS,
	LONGUEUR_TEXTE,
	controlerSortie,
	demandeDePastilles,
	texteDuHtml,
	texteDuMail,
	type MessageAEvaluer,
} from './pastilles.ts'

const PASTILLES = [
	{ id: '0c141000-0000-4000-8000-0000000000a1', name: 'Devis / commande', description: 'Une demande de devis.' },
	{ id: '0c141000-0000-4000-8000-0000000000a2', name: 'Spam', description: 'Courrier indésirable.' },
]

const MESSAGE: MessageAEvaluer = {
	message_id: '0c141000-0000-4000-8000-000000000001',
	subject: 'Demande de devis',
	from_address: 'lea@client.test',
	from_name: 'Léa Martin',
	body_text: 'Bonjour, pouvez-vous nous chiffrer la refonte ?',
	body_html: null,
	labels: PASTILLES,
}

describe('le texte envoyé au modèle (§15.1)', () => {
	it('est `body_text`, tronqué à 2 000 caractères', () => {
		expect(texteDuMail('a'.repeat(5_000), null)).toHaveLength(LONGUEUR_TEXTE)
		expect(texteDuMail('  court  ', '<p>ignoré</p>')).toBe('court')
	})

	it('à défaut, le texte tiré du HTML : balises, scripts et styles retirés, entités décodées', () => {
		const html = '<html><head><style>p{color:red}</style></head><body><p>Bonjour&nbsp;&amp; merci</p><script>alert(1)</script><br>Fin</body></html>'
		expect(texteDuHtml(html)).toBe('Bonjour & merci\nFin')
		expect(texteDuMail(null, html)).toBe('Bonjour & merci\nFin')
		expect(texteDuMail('   ', '<b>gras</b>')).toBe('gras')
	})

	it('aucun texte : une chaîne vide, jamais une erreur', () => {
		expect(texteDuMail(null, null)).toBe('')
	})
})

describe('la demande (§15.1, §15.2)', () => {
	it('ne porte que l’objet, l’expéditeur, le texte et les pastilles sous des clés courtes', () => {
		const demande = demandeDePastilles(MESSAGE)
		const contenu = demande.messages.map((m) => m.content).join('\n')
		expect(contenu).toContain('- p1 : Devis / commande — Une demande de devis.')
		expect(contenu).toContain('- p2 : Spam — Courrier indésirable.')
		expect(contenu).toContain('Objet : Demande de devis')
		expect(contenu).toContain('De : Léa Martin <lea@client.test>')
		expect(contenu).toContain('pouvez-vous nous chiffrer la refonte')
		// Aucun identifiant de la base ne sort vers le modèle : ni le message, ni une pastille.
		expect(contenu).not.toContain(MESSAGE.message_id)
		for (const pastille of PASTILLES) expect(contenu).not.toContain(pastille.id)
		expect([...demande.cles.entries()]).toEqual([
			['p1', PASTILLES[0]!.id],
			['p2', PASTILLES[1]!.id],
		])
	})

	it('le schéma énumère les seules clés de la demande, sans doublon', () => {
		const { schema } = demandeDePastilles(MESSAGE)
		expect(schema).toEqual({
			type: 'object',
			properties: { pastilles: { type: 'array', items: { type: 'string', enum: ['p1', 'p2'] }, uniqueItems: true } },
			required: ['pastilles'],
			additionalProperties: false,
		})
	})
})

describe('la sortie n’est jamais crue (§15.3)', () => {
	const { cles } = demandeDePastilles(MESSAGE)

	it('garde les clés connues, REJETTE et compte les inconnues, fait tomber les doublons', () => {
		expect(controlerSortie({ pastilles: ['p1', 'p99', 'p1', 'p2', 'Spam'] }, cles)).toEqual({
			ids: [PASTILLES[0]!.id, PASTILLES[1]!.id],
			rejetees: 2,
		})
	})

	it('une liste vide est une réponse valide : le mail ne porte aucune pastille', () => {
		expect(controlerSortie({ pastilles: [] }, cles)).toEqual({ ids: [], rejetees: 0 })
	})

	it('une forme fausse rend `null` — l’échec `reponse_invalide`', () => {
		expect(controlerSortie(['p1'], cles)).toBeNull()
		expect(controlerSortie({ pastilles: 'p1' }, cles)).toBeNull()
		expect(controlerSortie({ pastilles: [1] }, cles)).toBeNull()
		expect(controlerSortie(null, cles)).toBeNull()
	})
})

type Banc = {
	d: DependancesIa
	clotures: { id: string; ids: readonly string[] | null; echec: EchecGeneration | null }[]
	appels: { messages: readonly Message[]; schema: unknown }[]
	journal: string[]
	prises: number
}

function banc(options: {
	cle?: string | null
	file?: MessageAEvaluer[]
	generations?: Generation[]
	disponible?: boolean
	secret?: string
	/** Le temps écoulé à chaque lecture de l'horloge. */
	pasMs?: number
} = {}): Banc {
	const file = [...(options.file ?? [MESSAGE])]
	const generations = [...(options.generations ?? [])]
	let horloge = Date.parse('2026-11-11T12:00:00Z')
	const b: Banc = { d: undefined as never, clotures: [], appels: [], journal: [], prises: 0 }
	const fournies: Pick<
		DependancesIa,
		| 'configuration'
		| 'lireEtat'
		| 'verifierDispatch'
		| 'prendreEvaluation'
		| 'cloreEvaluation'
		| 'genererPastilles'
		| 'maintenantMs'
		| 'journaliser'
	> = {
		configuration: lireConfiguration((nom) =>
			({ OLLAMA_HOST: 'https://llm.example.test', OLLAMA_API_KEY: options.cle === undefined ? 'sk-secret' : options.cle ?? undefined })[nom],
		),
		lireEtat: async (cible, modele) =>
			cible === null
				? { disponible: false, raison: 'cle_absente', modele }
				: options.disponible === false
					? { disponible: false, raison: 'serveur_injoignable', modele }
					: { disponible: true, modele },
		verifierDispatch: async (secret) => secret === (options.secret ?? 'secret-de-la-base'),
		prendreEvaluation: async () => (b.prises++, file.shift() ?? null),
		cloreEvaluation: async (id, ids, echec) => void b.clotures.push({ id, ids, echec }),
		genererPastilles: async (_cible, messages, schema) => {
			b.appels.push({ messages, schema })
			return generations.shift() ?? { ok: true, contenu: { pastilles: ['p1'] }, jetonsEntree: 300, jetonsSortie: 9, dureeMs: 2_000 }
		},
		maintenantMs: () => (horloge += options.pasMs ?? 1_000),
		journaliser: (e) => void b.journal.push(JSON.stringify(e)),
	}
	// La passe et sa route n'appellent rien d'autre : le reste des dépendances est absent à dessein.
	b.d = fournies as DependancesIa
	return b
}

const cibleReelle = { hote: 'https://llm.example.test', cle: 'sk-secret', simulee: false }

describe('la passe (§15.4)', () => {
	it('évalue la file une à une et clôt chaque message avec ses pastilles traduites', async () => {
		const autre = { ...MESSAGE, message_id: '0c141000-0000-4000-8000-000000000002' }
		const b = banc({
			file: [MESSAGE, autre],
			generations: [
				{ ok: true, contenu: { pastilles: ['p1', 'p99'] }, jetonsEntree: 1, jetonsSortie: 1, dureeMs: 1 },
				{ ok: true, contenu: { pastilles: [] }, jetonsEntree: 1, jetonsSortie: 1, dureeMs: 1 },
			],
		})
		expect(await passePastilles(b.d, cibleReelle)).toEqual({ evalues: 2, echecs: 0, rejetees: 1 })
		expect(b.clotures).toEqual([
			{ id: MESSAGE.message_id, ids: [PASTILLES[0]!.id], echec: null },
			{ id: autre.message_id, ids: [], echec: null },
		])
	})

	it('sans clé, ou l’assistant indisponible : RIEN n’est pris, les messages restent en attente', async () => {
		const sansCle = banc({ cle: null })
		expect(await passePastilles(sansCle.d, null)).toEqual({ evalues: 0, echecs: 0, rejetees: 0, raison: 'cle_absente' })
		expect(sansCle.prises).toBe(0)
		const injoignable = banc({ disponible: false })
		expect((await passePastilles(injoignable.d, cibleReelle)).raison).toBe('serveur_injoignable')
		expect(injoignable.prises).toBe(0)
	})

	it('un échec s’écrit sur son message et ARRÊTE la passe — l’espacement de la base reprend la main', async () => {
		const b = banc({
			file: [MESSAGE, { ...MESSAGE, message_id: '0c141000-0000-4000-8000-000000000003' }],
			generations: [{ ok: false, echec: 'delai_depasse' }],
		})
		expect(await passePastilles(b.d, cibleReelle)).toEqual({ evalues: 0, echecs: 1, rejetees: 0 })
		expect(b.clotures).toEqual([{ id: MESSAGE.message_id, ids: null, echec: 'delai_depasse' }])
		expect(b.prises).toBe(1)
	})

	it('une sortie hors schéma est l’échec `reponse_invalide`', async () => {
		const b = banc({ generations: [{ ok: true, contenu: { autre: 1 }, jetonsEntree: 1, jetonsSortie: 1, dureeMs: 1 }] })
		await passePastilles(b.d, cibleReelle)
		expect(b.clotures).toEqual([{ id: MESSAGE.message_id, ids: null, echec: 'reponse_invalide' }])
	})

	it('un espace sans pastille active : aucun appel au modèle, le mail n’en porte aucune', async () => {
		const b = banc({ file: [{ ...MESSAGE, labels: [] }] })
		await passePastilles(b.d, cibleReelle)
		expect(b.appels).toHaveLength(0)
		expect(b.clotures).toEqual([{ id: MESSAGE.message_id, ids: [], echec: null }])
	})

	it('cesse de prendre une fois son budget de 100 s épuisé', async () => {
		const file = Array.from({ length: 50 }, (_, rang) => ({ ...MESSAGE, message_id: `0c141000-0000-4000-8000-${String(rang).padStart(12, '0')}` }))
		// Chaque lecture de l'horloge avance de 20 s : la passe s'arrête avant d'avoir tout pris.
		const b = banc({ file, pasMs: 20_000 })
		const bilan = await passePastilles(b.d, cibleReelle)
		expect(bilan.evalues).toBeGreaterThan(0)
		expect(bilan.evalues).toBeLessThan(BUDGET_PASSE_MS / 20_000)
		expect(b.prises).toBe(bilan.evalues)
	})

	it('le journal ne porte que des comptes : ni objet, ni adresse, ni texte, ni pastille', async () => {
		const b = banc()
		await passePastilles(b.d, cibleReelle)
		const journal = b.journal.join('\n')
		for (const fragment of ['Demande de devis', 'lea@client.test', 'chiffrer', 'Devis / commande', PASTILLES[0]!.id]) {
			expect(journal).not.toContain(fragment)
		}
		expect(journal).toContain('"evalues":1')
	})
})

describe('la route `POST /ia/pastilles/evaluer` (§15.4)', () => {
	const appel = (b: Banc, entetes: Record<string, string>, methode = 'POST') =>
		traiterIa(new Request('http://functions:9000/ia/pastilles/evaluer', { method: methode, headers: entetes }), b.d)

	it('exige le secret que la base vérifie : sans lui, ou faux, `401` et rien n’est pris', async () => {
		const essais: Record<string, string>[] = [{}, { [EN_TETE_DISPATCH_PASTILLES]: 'faux' }]
		for (const entetes of essais) {
			const b = banc()
			const reponse = await appel(b, entetes)
			expect(reponse.status).toBe(401)
			expect(b.prises).toBe(0)
		}
	})

	it('avec lui, mène la passe et ne rend que des comptes', async () => {
		const b = banc()
		const reponse = await appel(b, { [EN_TETE_DISPATCH_PASTILLES]: 'secret-de-la-base' })
		expect(reponse.status).toBe(200)
		expect(await reponse.json()).toEqual({ evalues: 1, echecs: 0, rejetees: 0 })
	})

	it('toute autre méthode : `405`', async () => {
		expect((await appel(banc(), {}, 'GET')).status).toBe(405)
	})

	it('l’en-tête du simulateur est IGNORÉ sans `IA_SIMULATEUR_HOST` : la cible reste le serveur réel', async () => {
		const b = banc()
		await appel(b, { [EN_TETE_DISPATCH_PASTILLES]: 'secret-de-la-base', 'x-ia-simulateur': 'pastilles' })
		expect(b.journal.join('\n')).toContain('"simulee":false')
	})
})
