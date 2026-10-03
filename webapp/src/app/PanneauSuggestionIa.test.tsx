// @verifies CRM-097 (docs/BACKLOG.md) — tranche T2.c : le panneau de suggestion de l'assistant IA
// @verifies docs/SPEC-ia.md §12.5 (demander, générer, relire, corriger, accepter, abandonner ; génération d'un autre
//           relue sans scrutation ; reprise sans consigne), §12.7 (refus traduits), §12.1 (une phrase par code)
// @verifies docs/DESIGN_SYSTEM.md §5.52 (principe écrit, état de l'assistant qui n'éteint rien, opération longue,
//           défauts en tête, « Accepter » retenu par des défauts non modifiés, retraits annoncés, confirmation
//           d'abandon dans le flux et focus, refus près de la cause), §10 (aucun marqueur `{…}` laissé à l'écran)
// @verifies CRM-097 tranche T3.c — docs/SPEC-ia.md §13.6 (le panneau titré par la portée ; la demande ciblée ; le
//           différentiel ; les affaires des étapes retirées, « Aucune destination » jamais présélectionnée ; accepter
//           enregistre d'abord le remappage, puis annonce le point de retour), §13.4 (`PT409`) ; docs/DESIGN_SYSTEM.md
//           §5.53 (précisions : libellé d'acceptation, type d'un champ conservé en texte, indication du libellé vide) ;
//           décision 620

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanneauSuggestionIa, phraseDefaut, type ProprietesPanneauIa } from './PanneauSuggestionIa'
import type { AccesAssistant, DefautIa } from '../lib/assistant-ia'
import type { PropositionIa } from '../lib/brouillon-ia'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const ID = '0c970000-0000-4000-8000-0000000000a1'
const WF = '0c970000-0000-4000-8000-0000000000b1'
const MAINTENANT = Date.parse('2026-10-02T12:00:00Z')

const PROPOSITION: PropositionIa = {
	version: 1,
	workflow: { nom: 'Cycle d’une agence web' },
	noeuds: [
		{ cle: 'prise-de-contact', libelle: 'Prise de contact', nature: 'open', probabilite: 10 },
		{ cle: 'maquette', libelle: 'Maquette et devis', nature: 'open', probabilite: 40 },
		{ cle: 'gagne-web', libelle: 'Gagné', nature: 'won', probabilite: 100 },
	],
	etapes: [
		{ noeud: 'prise-de-contact', initiale: true },
		{ noeud: 'maquette', initiale: false },
		{ noeud: 'gagne-web', initiale: false },
		{ noeud: 'relance', initiale: false },
	],
	transitions: [
		{ de: 'prise-de-contact', vers: 'maquette', libelle: 'Lancer la maquette', commentaire_requis: false },
		{ de: 'maquette', vers: 'gagne-web', libelle: 'Devis signé', commentaire_requis: false },
	],
	champs: [{ cle: 'budget', libelle: 'Budget', type: 'money', choix: null, devise: 'EUR', aide: null }],
	regles: [{ champ: 'budget', etape: 'maquette', visibilite: 'required' }],
	exigences: [{ de: 'maquette', vers: 'gagne-web', champ: 'budget' }],
}

// La forme réelle d'une ligne lue (`COLONNES_SUGGESTION`) : une création n'a ni workflow visé ni point de retour.
const SUGGESTION = {
	id: ID,
	portee: 'workflow',
	workflow_id: null as string | null,
	version_retour_id: null as string | null,
	demande: 'Un cycle pour une agence web :\nprise de contact, maquette, signature.',
	statut: 'en_revue',
	created_at: '2026-10-02T11:50:00Z',
	generation_depuis: null as string | null,
	derniere_erreur: null as string | null,
	workflow_cree_id: null,
}

const revision = (numero: number, defauts: DefautIa[] = [], proposition = PROPOSITION) => ({
	id: `r-${numero}`, numero, origine: numero === 1 ? 'ia' : 'correction', consigne: numero === 1 ? SUGGESTION.demande : null,
	proposition, defauts, modele: numero === 1 ? 'gemma4:e2b' : null, created_at: '2026-10-02T11:51:00Z',
})

type Options = {
	suggestion?: typeof SUGGESTION | null
	/** Le workflow vivant d'une modification : ce que rendent `proposition_du_workflow` et `occupation_du_workflow`. */
	vivant?: { composition: PropositionIa; occupation: Record<string, number> }
	version?: number | null
	revisions?: ReturnType<typeof revision>[]
	correction?: { data: unknown; error: unknown }
	acceptation?: { data: unknown; error: unknown }
	abandon?: { data: unknown; error: unknown }
}

/** Un client qui sert la suggestion, ses révisions et le catalogue, et retient les écritures. */
function clientFactice(options: Options = {}) {
	const ecritures: { table: string; verbe: string; charge: unknown }[] = []
	const chaine = (resultat: unknown) => {
		const c: Record<string, unknown> = {}
		for (const m of ['select', 'eq', 'is', 'order', 'maybeSingle', 'single']) c[m] = () => c
		c['then'] = (resoudre: (v: unknown) => unknown) => Promise.resolve(resultat).then(resoudre)
		return c
	}
	const ok = (data: unknown) => ({ data, error: null, status: 200 })
	const client = {
		from: (table: string) => ({
			select: () => {
				if (table === 'suggestions_ia') return chaine(ok(options.suggestion === undefined ? SUGGESTION : options.suggestion))
				if (table === 'suggestions_ia_revisions') return chaine(ok(options.revisions ?? [revision(1)]))
				if (table === 'workflow_nodes_catalog') return chaine(ok([{ id: 'n-1', key: 'relance', label: 'Relance', kind: 'open' }]))
				if (table === 'workflow_versions') return chaine(ok(options.version === null ? null : { version_number: options.version ?? 4 }))
				throw new Error(`lecture inattendue : ${table}`)
			},
			insert: (charge: unknown) => {
				ecritures.push({ table, verbe: 'insert', charge })
				return chaine(options.correction ?? { data: revision(2), error: null })
			},
			update: (charge: unknown) => {
				ecritures.push({ table, verbe: 'update', charge })
				return chaine(options.abandon ?? { data: [{ id: ID }], error: null })
			},
		}),
		rpc: (nom: string, params: unknown) => {
			// Les deux lectures du workflow vivant ne sont pas des écritures : elles ne sont pas retenues.
			if (nom === 'proposition_du_workflow') return Promise.resolve(ok(options.vivant?.composition ?? null))
			if (nom === 'occupation_du_workflow') return Promise.resolve(ok(options.vivant?.occupation ?? {}))
			ecritures.push({ table: nom, verbe: 'rpc', charge: params })
			return Promise.resolve(options.acceptation ?? { data: WF, error: null })
		},
	}
	return { client: client as unknown as ClientCrm, ecritures }
}

function flux(lignes: readonly unknown[], statut = 202): Response {
	return new Response(lignes.map((l) => `${JSON.stringify(l)}\n`).join(''), { status: statut, headers: { 'content-type': 'application/x-ndjson' } })
}

/** Un accès dont chaque route rend la réponse donnée ; la génération peut être RETENUE pour observer l'attente. */
function accesFactice(reponses: { etat?: Response; generation?: () => Promise<Response> | Response }) {
	const appels: { url: string; corps: unknown }[] = []
	const acces: AccesAssistant = {
		url: 'http://api.test',
		cleAnonyme: 'cle',
		jeton: () => 'jeton',
		requete: async (url, init) => {
			appels.push({ url, corps: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
			if (url.endsWith('/etat')) return reponses.etat ?? new Response('{"disponible":true,"modele":"gemma4:e2b"}')
			return (await reponses.generation?.()) ?? flux([{ issue: 'revision', defauts: 0 }])
		},
	}
	return { acces, appels }
}

function rendre(proprietes: Partial<ProprietesPanneauIa> & Pick<ProprietesPanneauIa, 'client' | 'ouverture'>) {
	const rappels = {
		onSuggestionCreee: vi.fn(),
		onSuggestionPrete: vi.fn(),
		onAcceptee: vi.fn(),
		onAbandonnee: vi.fn(),
		onFermer: vi.fn(),
		annoncer: vi.fn(),
	}
	render(<PanneauSuggestionIa acces={null} idWorkspace="ws-1" maintenant={() => MAINTENANT} {...rappels} {...proprietes} />)
	return rappels
}

describe('les phrases des défauts (docs/SPEC-ia.md §12.1)', () => {
	const CODES: Record<string, Record<string, unknown>> = {
		nom_absent: {}, cle_invalide: { cle: 'F!' }, noeud_en_double: { cle: 'a' }, noeud_deja_au_catalogue: { cle: 'a' },
		noeud_archive: { cle: 'a' }, libelle_absent: { cle: 'a' }, nature_invalide: { cle: 'a', nature: 'x' },
		probabilite_invalide: { cle: 'a' }, noeud_inutilise: { cle: 'a' }, aucune_etape: {}, etape_en_double: { cle: 'a' },
		noeud_inconnu: { cle: 'a' }, etape_initiale: { nombre: 2 }, transition_etape_absente: { de: 'a', vers: 'b' },
		transition_boucle: { cle: 'a' }, transition_en_double: { de: 'a', vers: 'b' }, transition_sans_libelle: { de: 'a', vers: 'b' },
		champ_en_double: { cle: 'f' }, type_inconnu: { cle: 'f', type: 'x' }, choix_requis: { cle: 'f' },
		choix_invalide: { cle: 'f', choix: 'x' }, devise_requise: { cle: 'f' }, regle_champ_absent: { cle: 'f' },
		regle_etape_absente: { cle: 'a' }, regle_en_double: { champ: 'f', etape: 'a' }, visibilite_invalide: { visibilite: 'x' },
		exigence_transition_absente: { de: 'a', vers: 'b' }, exigence_champ_absent: { cle: 'f' },
		exigence_en_double: { de: 'a', vers: 'b', champ: 'f' },
	}

	it('les vingt-neuf codes ont chacun leur phrase, sans marqueur laissé à l’écran', () => {
		expect(Object.keys(CODES)).toHaveLength(29)
		for (const [code, valeurs] of Object.entries(CODES)) {
			const phrase = phraseDefaut({ code, chemin: 'x', valeurs })
			expect(phrase, code).not.toMatch(/[{}]/)
			expect(phrase, code).not.toMatch(/^Défaut/)
		}
		expect(phraseDefaut({ code: 'etape_initiale', chemin: 'etapes', valeurs: { nombre: 2 } })).toBe(
			'Il faut exactement une étape initiale ; la proposition en a 2.',
		)
	})

	it('un code inconnu se dit tel quel, jamais en silence', () => {
		expect(phraseDefaut({ code: 'nouveau_code', chemin: 'x', valeurs: {} })).toBe('Défaut «\u00a0nouveau_code\u00a0».')
	})
})

describe('Demander', () => {
	it('le focus entre dans la demande ; « Générer » attend un texte ; le rappel des données est relié au champ', async () => {
		const { client } = clientFactice()
		rendre({ client, ouverture: { type: 'demande' } })
		const champ = screen.getByLabelText('Décrivez le workflow')
		await waitFor(() => expect(document.activeElement).toBe(champ))
		expect(champ.getAttribute('aria-describedby')).toContain('donnees')
		expect(screen.getByText(/n’y collez aucune donnée personnelle/)).toBeTruthy()
		expect((screen.getByRole('button', { name: /Générer la suggestion/ }) as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByText(/rien n’est créé avant/)).toBeTruthy()
	})

	it('l’assistant indisponible se DIT, et la commande reste offerte', async () => {
		const { client } = clientFactice()
		const { acces } = accesFactice({ etat: new Response('{"disponible":false,"raison":"cle_absente","modele":"gemma4:e2b"}') })
		rendre({ client, acces, ouverture: { type: 'demande' } })
		expect((await screen.findByRole('status')).textContent).toContain('L’assistant est indisponible : il n’est pas configuré.')
		await userEvent.type(screen.getByLabelText('Décrivez le workflow'), 'Un cycle')
		expect((screen.getByRole('button', { name: /Générer la suggestion/ }) as HTMLButtonElement).disabled).toBe(false)
	})

	it('générer : l’attente est dite pendant le vol, puis la suggestion s’ouvre avec son annonce', async () => {
		const { client } = clientFactice()
		let liberer: (r: Response) => void = () => {}
		const { acces, appels } = accesFactice({ generation: () => new Promise<Response>((r) => (liberer = r)) })
		const rappels = rendre({ client, acces, ouverture: { type: 'demande' } })
		await userEvent.type(screen.getByLabelText('Décrivez le workflow'), 'Un cycle de vente')
		await userEvent.click(screen.getByRole('button', { name: /Générer la suggestion/ }))
		expect(await screen.findByText('L’assistant prépare une proposition — environ une demi-minute.')).toBeTruthy()
		expect(screen.getByTestId('ia-attente').querySelector('[aria-hidden="true"]')).toBeTruthy()
		await act(async () => liberer(flux([{ suggestion_id: ID }, { attente: true }, { issue: 'revision', defauts: 1 }])))
		await waitFor(() => expect(rappels.onSuggestionPrete).toHaveBeenCalledWith(ID, 'Suggestion prête, avec 1 défaut.'))
		expect(rappels.onSuggestionCreee).toHaveBeenCalledWith(ID)
		expect(appels.find((a) => a.url.endsWith('/suggestions'))?.corps).toEqual({ workspace_id: 'ws-1', portee: 'workflow', demande: 'Un cycle de vente' })
	})

	it('le refus d’un non-administrateur se lit SOUS la demande, qui est conservée', async () => {
		const { client } = clientFactice()
		const { acces } = accesFactice({ generation: () => new Response('{"erreur":"refuse"}', { status: 403 }) })
		rendre({ client, acces, ouverture: { type: 'demande' } })
		await userEvent.type(screen.getByLabelText('Décrivez le workflow'), 'Un cycle')
		await userEvent.click(screen.getByRole('button', { name: /Générer la suggestion/ }))
		expect((await screen.findByRole('alert')).textContent).toContain('L’assistant est réservé aux administrateurs de l’espace de travail.')
		expect((screen.getByLabelText('Décrivez le workflow') as HTMLInputElement).value).toBe('Un cycle')
	})

	it('`Échap` dans la demande referme le panneau', async () => {
		const { client } = clientFactice()
		const rappels = rendre({ client, ouverture: { type: 'demande' } })
		await userEvent.type(screen.getByLabelText('Décrivez le workflow'), '{Escape}')
		expect(rappels.onFermer).toHaveBeenCalled()
	})
})

describe('Relire et corriger', () => {
	it('le focus va au titre ; la demande est citée ; l’étape du catalogue est nommée par un mot', async () => {
		const { client } = clientFactice()
		rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: /Suggestion de l’IA/ })))
		expect(screen.getByTestId('ia-demande').textContent).toBe(SUGGESTION.demande)
		const etapes = await screen.findAllByTestId('ia-etape')
		expect(within(etapes[3] as HTMLElement).getByText('Du catalogue')).toBeTruthy()
		expect(within(etapes[3] as HTMLElement).getByText('Relance')).toBeTruthy()
		expect(within(etapes[0] as HTMLElement).getByText('Nouveau nœud')).toBeTruthy()
	})

	it('des défauts non modifiés retiennent « Accepter », et la raison est reliée ; corriger la rend', async () => {
		const defauts = [
			{ code: 'etape_initiale', chemin: 'etapes', valeurs: { nombre: 2 } },
			{ code: 'noeud_inutilise', chemin: 'noeuds[3]', valeurs: { cle: 'oublie' } },
		]
		const { client } = clientFactice({ revisions: [revision(1, defauts)] })
		rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		const bloc = await screen.findByTestId('ia-defauts')
		expect((within(bloc).getByRole('heading')).textContent).toContain('2 défauts empêchent l’acceptation')
		expect(within(bloc).getAllByRole('listitem')).toHaveLength(2)
		const accepter = screen.getByRole('button', { name: 'Accepter et créer le workflow' })
		expect((accepter as HTMLButtonElement).disabled).toBe(true)
		expect(document.getElementById(accepter.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Corrigez les défauts')
		expect((screen.getByRole('button', { name: 'Enregistrer la correction' }) as HTMLButtonElement).disabled).toBe(true)

		await userEvent.type(screen.getByLabelText('Nom du workflow'), ' bis')
		expect((screen.getByTestId('ia-modifie')).textContent).toContain('Modifications non enregistrées')
		expect((accepter as HTMLButtonElement).disabled).toBe(false)
		expect((screen.getByRole('button', { name: 'Enregistrer la correction' }) as HTMLButtonElement).disabled).toBe(false)
		await userEvent.click(screen.getByRole('button', { name: 'Rétablir' }))
		expect((screen.getByLabelText('Nom du workflow') as HTMLInputElement).value).toBe('Cycle d’une agence web')
	})

	it('enregistrer envoie la proposition corrigée ENTIÈRE ; l’issue est annoncée', async () => {
		const { client, ecritures } = clientFactice()
		const rappels = rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		await userEvent.type(await screen.findByLabelText('Nom du workflow'), ' bis')
		await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la correction' }))
		await waitFor(() => expect(rappels.annoncer).toHaveBeenCalledWith('Correction enregistrée, sans défaut.'))
		const envoi = ecritures.find((e) => e.verbe === 'insert')?.charge as { origine: string; proposition: PropositionIa }
		expect(envoi.origine).toBe('correction')
		expect(envoi.proposition.workflow.nom).toBe('Cycle d’une agence web bis')
		expect(envoi.proposition.etapes).toHaveLength(4)
	})

	it('deux étapes initiales : AUCUN radio n’est coché — le navigateur cocherait le dernier, et mentirait', async () => {
		const deuxInitiales = { ...PROPOSITION, etapes: PROPOSITION.etapes.map((e, i) => ({ ...e, initiale: i < 2 })) }
		const { client } = clientFactice({ revisions: [revision(1, [], deuxInitiales)] })
		rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		const radios = await screen.findAllByRole('radio')
		expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0)
		await userEvent.click(screen.getByRole('radio', { name: 'Étape initiale : Maquette et devis' }))
		expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked).map((r) => r.getAttribute('aria-label'))).toEqual([
			'Étape initiale : Maquette et devis',
		])
	})

	it('retirer une étape annonce ce qu’elle emporte', async () => {
		const { client } = clientFactice()
		const rappels = rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		await userEvent.click(await screen.findByRole('button', { name: 'Retirer l’étape Maquette et devis' }))
		expect(rappels.annoncer).toHaveBeenCalledWith(
			'Étape Maquette et devis retirée. Retirées avec elle — transitions : 2, règles : 1, exigences : 1.',
		)
		expect(screen.getAllByTestId('ia-etape')).toHaveLength(3)
	})
})

describe('Accepter, faire revoir, abandonner', () => {
	it('accepter appelle le geste et rend le workflow créé, nommé', async () => {
		const { client, ecritures } = clientFactice()
		const rappels = rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		await userEvent.click(await screen.findByRole('button', { name: 'Accepter et créer le workflow' }))
		await waitFor(() => expect(rappels.onAcceptee).toHaveBeenCalledWith(WF, 'Cycle d’une agence web', null))
		expect(ecritures).toEqual([{ table: 'accepter_suggestion_ia', verbe: 'rpc', charge: { p_suggestion: ID } }])
	})

	it('modifiée, la proposition est enregistrée AVANT d’être acceptée ; des défauts nouveaux arrêtent tout', async () => {
		const { client, ecritures } = clientFactice({
			correction: { data: revision(2, [{ code: 'nom_absent', chemin: 'workflow.nom', valeurs: {} }]), error: null },
		})
		const rappels = rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		await userEvent.clear(await screen.findByLabelText('Nom du workflow'))
		await userEvent.click(screen.getByRole('button', { name: 'Accepter et créer le workflow' }))
		expect((await screen.findByTestId('ia-refus-barre')).textContent).toContain('La proposition porte 1 défaut : corrigez-le avant d’accepter.')
		expect(ecritures.map((e) => e.verbe)).toEqual(['insert'])
		expect(rappels.onAcceptee).not.toHaveBeenCalled()
	})

	it('un refus de la base se lit sous la barre de gestes', async () => {
		const { client } = clientFactice({ acceptation: { data: null, error: { code: 'PT404', message: 'suggestion introuvable' } } })
		rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		await userEvent.click(await screen.findByRole('button', { name: 'Accepter et créer le workflow' }))
		expect((await screen.findByTestId('ia-refus-barre')).textContent).toContain('Cette suggestion est introuvable.')
	})

	it('faire revoir envoie la consigne ; le panneau dit l’attente puis relit', async () => {
		const { client } = clientFactice()
		const { acces, appels } = accesFactice({})
		const rappels = rendre({ client, acces, ouverture: { type: 'suggestion', id: ID } })
		const revoir = await screen.findByRole('button', { name: /Revoir avec l’IA/ })
		expect((revoir as HTMLButtonElement).disabled).toBe(true)
		await userEvent.type(screen.getByLabelText('Consigne pour l’IA'), 'Ajoute une étape perdu')
		await userEvent.click(revoir)
		await waitFor(() => expect(rappels.annoncer).toHaveBeenCalledWith('Suggestion prête, sans défaut.'))
		expect(appels.find((a) => a.url.endsWith('/revue'))?.corps).toEqual({ consigne: 'Ajoute une étape perdu' })
	})

	it('abandonner passe par une confirmation dans le flux, qui prend le focus et nomme la demande', async () => {
		const { client, ecritures } = clientFactice()
		const rappels = rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		await userEvent.click(await screen.findByRole('button', { name: 'Abandonner la suggestion' }))
		const confirmation = screen.getByTestId('ia-confirmation-abandon')
		expect(document.activeElement).toBe(within(confirmation).getByRole('button', { name: 'Abandonner' }))
		expect(confirmation.textContent).toContain('Un cycle pour une agence web')
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('ia-confirmation-abandon')).toBeNull()
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abandonner la suggestion' }))

		await userEvent.click(screen.getByRole('button', { name: 'Abandonner la suggestion' }))
		await userEvent.click(within(screen.getByTestId('ia-confirmation-abandon')).getByRole('button', { name: 'Abandonner' }))
		await waitFor(() => expect(rappels.onAbandonnee).toHaveBeenCalled())
		expect(rappels.annoncer).toHaveBeenCalledWith('Suggestion abandonnée.')
		expect(ecritures).toEqual([{ table: 'suggestions_ia', verbe: 'update', charge: { statut: 'abandonnee' } }])
	})

	it('un abandon sans effet se DIT, et la suggestion reste', async () => {
		const { client } = clientFactice({ abandon: { data: [], error: null } })
		const rappels = rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		await userEvent.click(await screen.findByRole('button', { name: 'Abandonner la suggestion' }))
		await userEvent.click(within(screen.getByTestId('ia-confirmation-abandon')).getByRole('button', { name: 'Abandonner' }))
		expect((await screen.findByTestId('ia-refus-barre')).textContent).toContain('L’abandon n’a pas été pris en compte.')
		expect(rappels.onAbandonnee).not.toHaveBeenCalled()
	})
})

describe('Les états sans révision, et la génération d’un autre', () => {
	it('une première génération échouée se dit, et « Réessayer » la reprend SANS consigne', async () => {
		const { client } = clientFactice({ suggestion: { ...SUGGESTION, derniere_erreur: 'cle_refusee' }, revisions: [] })
		const { acces, appels } = accesFactice({})
		rendre({ client, acces, ouverture: { type: 'suggestion', id: ID } })
		expect(await screen.findByText(/L’assistant est mal configuré/)).toBeTruthy()
		await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
		await waitFor(() => expect(appels.find((a) => a.url.endsWith('/revue'))?.corps).toEqual({}))
	})

	it('une génération en vol ailleurs se dit avec son heure, et « Relire » relit — aucune scrutation', async () => {
		const { client } = clientFactice({ suggestion: { ...SUGGESTION, generation_depuis: '2026-10-02T11:59:30Z' }, revisions: [] })
		rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		expect(await screen.findByText(/Une génération est en cours depuis/)).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Relire' })).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull()
	})

	it('une suggestion illisible est INTROUVABLE, sans geste', async () => {
		const { client } = clientFactice({ suggestion: null, revisions: [] })
		rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		expect(await screen.findByText('Suggestion introuvable')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Accepter et créer le workflow' })).toBeNull()
	})

	it('l’historique replié compte ses révisions et dit leur origine en mots', async () => {
		const { client } = clientFactice({ revisions: [revision(2), revision(1)] })
		rendre({ client, ouverture: { type: 'suggestion', id: ID } })
		const historique = await screen.findByTestId('ia-historique')
		expect(historique.hasAttribute('open')).toBe(false)
		expect(within(historique).getByText('Historique — 2 révisions')).toBeTruthy()
		expect(within(historique).getByText('Corrigée à la main')).toBeTruthy()
		expect(within(historique).getByText('Proposée par l’IA')).toBeTruthy()
	})
})

// ---------------------------------------------------------------------------------------------
// T3.c — faire évoluer un workflow existant
// ---------------------------------------------------------------------------------------------

/** Le workflow vivant : la relance porte 9 affaires ; une transition sans libellé propre. */
const VIVANTE: PropositionIa = {
	version: 1,
	workflow: { nom: 'Pipeline' },
	noeuds: [],
	etapes: [
		{ noeud: 'prospection', initiale: true },
		{ noeud: 'relance', initiale: false },
		{ noeud: 'negociation', initiale: false },
	],
	transitions: [
		{ de: 'prospection', vers: 'relance', libelle: '', commentaire_requis: false },
		{ de: 'relance', vers: 'negociation', libelle: 'Relancer', commentaire_requis: false },
	],
	champs: [{ cle: 'budget', libelle: 'Budget', type: 'money', choix: null, devise: 'EUR', aide: null }],
	regles: [],
	exigences: [],
}

/** La cible du scénario `modification` du simulateur : la relance retirée, la qualification ajoutée, aucun remappage. */
const CIBLE: PropositionIa = {
	...VIVANTE,
	noeuds: [{ cle: 'qualification-ia', libelle: 'Qualification', nature: 'open', probabilite: 30 }],
	etapes: [
		{ noeud: 'prospection', initiale: true },
		{ noeud: 'qualification-ia', initiale: false },
		{ noeud: 'negociation', initiale: false },
	],
	transitions: [
		{ de: 'prospection', vers: 'qualification-ia', libelle: 'Qualifier', commentaire_requis: false },
		{ de: 'qualification-ia', vers: 'negociation', libelle: '', commentaire_requis: false },
	],
	remappages: [],
}

const MODIFICATION = { ...SUGGESTION, portee: 'etapes', workflow_id: WF, demande: 'Remplace la relance par une qualification' }
const REMAPPAGE_REQUIS: DefautIa = { code: 'remappage_requis', chemin: 'remappages', valeurs: { cle: 'relance', affaires: 9 } }

function rendreModification(options: Options = {}) {
	const fabrique = clientFactice({
		suggestion: MODIFICATION,
		revisions: [revision(1, [REMAPPAGE_REQUIS], CIBLE)],
		vivant: { composition: VIVANTE, occupation: { prospection: 11, relance: 9, negociation: 8 } },
		...options,
	})
	const rappels = rendre({
		client: fabrique.client,
		ouverture: { type: 'suggestion', id: ID, portee: 'etapes' },
		workflow: { id: WF, nom: 'Pipeline' },
	})
	return { ...fabrique, rappels }
}

describe('T3.c — la demande ciblée', () => {
	it('le titre nomme la portée et le workflow ; la demande part avec la portée et la cible', async () => {
		const { client } = clientFactice()
		const { acces, appels } = accesFactice({ generation: () => flux([{ suggestion_id: ID }, { issue: 'revision', defauts: 1 }]) })
		const rappels = rendre({ client, acces, ouverture: { type: 'demande', portee: 'transitions' }, workflow: { id: WF, nom: 'Pipeline' } })
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Faire évoluer les transitions de «\u00a0Pipeline\u00a0»')
		expect(screen.getByTestId('ia-panneau').textContent).toContain('Suggestion — rien ne change avant «\u00a0Accepter\u00a0»')
		await userEvent.type(screen.getByLabelText('Décrivez ce qui doit changer'), 'Ajoute une sortie perdu')
		await userEvent.click(screen.getByRole('button', { name: /Générer la suggestion/ }))
		await waitFor(() => expect(rappels.onSuggestionPrete).toHaveBeenCalled())
		expect(appels.find((a) => a.url.endsWith('/suggestions'))?.corps).toEqual({
			workspace_id: 'ws-1', portee: 'transitions', workflow_id: WF, demande: 'Ajoute une sortie perdu',
		})
	})
})

describe('T3.c — relire une modification', () => {
	it('le différentiel : la qualification ajoutée, la relance retirée, la transition sans libellé dite', async () => {
		rendreModification()
		const differentiel = await screen.findByTestId('ia-differentiel')
		const etapes = within(differentiel).getByTestId('ia-differentiel-etapes')
		expect(etapes.textContent).toContain('Ajouté')
		expect(etapes.textContent).toContain('Qualification')
		expect(etapes.textContent).toContain('Retiré')
		expect(etapes.textContent).toContain('Relance')
		const transitions = within(differentiel).getByTestId('ia-differentiel-transitions')
		// « prospection » n'est pas au catalogue de ce banc : la clé la nomme, jamais un vide.
		expect(transitions.textContent).toContain('prospection vers Qualification')
	})

	it('aucun changement se dit en une phrase', async () => {
		rendreModification({ revisions: [revision(1, [], { ...VIVANTE, remappages: [] })] })
		expect((await screen.findByTestId('ia-differentiel')).textContent).toContain('La suggestion ne change rien au workflow.')
	})

	it('les affaires de la relance : leur nombre, et « Aucune destination » — jamais présélectionnée', async () => {
		rendreModification()
		const bloc = await screen.findByTestId('ia-remappages')
		expect(within(bloc).getByText('Où vont les affaires des étapes retirées')).toBeTruthy()
		expect(within(bloc).getByText('9 affaires')).toBeTruthy()
		const choix = within(bloc).getByLabelText('Destination des affaires de Relance') as HTMLSelectElement
		expect(choix.value).toBe('')
		expect(choix.selectedOptions[0]?.textContent).toBe('Aucune destination')
		expect([...choix.options].map((o) => o.value)).toEqual(['', 'prospection', 'qualification-ia', 'negociation'])
	})

	it('choisir la destination écrit le remappage ; accepter l’enregistre D’ABORD, puis annonce le point de retour', async () => {
		const corrigee = { ...CIBLE, remappages: [{ de: 'relance', vers: 'qualification-ia' }] }
		const { ecritures, rappels } = rendreModification({
			suggestion: { ...MODIFICATION, version_retour_id: 'v-4' },
			correction: { data: revision(2, [], corrigee), error: null },
			version: 4,
		})
		await userEvent.selectOptions(await screen.findByLabelText('Destination des affaires de Relance'), 'qualification-ia')
		expect(screen.getByTestId('ia-modifie')).toBeTruthy()
		await userEvent.click(screen.getByRole('button', { name: 'Accepter et faire évoluer le workflow' }))
		await waitFor(() => expect(rappels.onAcceptee).toHaveBeenCalledWith(WF, 'Pipeline', 4))
		expect(ecritures.map((e) => [e.table, e.verbe])).toEqual([
			['suggestions_ia_revisions', 'insert'],
			['accepter_suggestion_ia', 'rpc'],
		])
		expect((ecritures[0]?.charge as { proposition: PropositionIa }).proposition.remappages).toEqual([{ de: 'relance', vers: 'qualification-ia' }])
	})

	it('le workflow a changé depuis la suggestion : le refus le dit, et dit quoi faire', async () => {
		rendreModification({
			revisions: [revision(1, [], { ...CIBLE, remappages: [{ de: 'relance', vers: 'qualification-ia' }] })],
			acceptation: { data: null, error: { code: 'PT409', message: 'workflow modifie' } },
		})
		await userEvent.click(await screen.findByRole('button', { name: 'Accepter et faire évoluer le workflow' }))
		expect((await screen.findByTestId('ia-refus-barre')).textContent).toContain('Le workflow a changé depuis cette suggestion')
	})

	it('le type d’un champ conservé est un texte ; un libellé de transition vide porte son indication', async () => {
		rendreModification()
		expect((await screen.findByTestId('ia-type-fixe')).textContent).toBe('Type : Montant')
		expect(screen.queryByLabelText('Type de Budget')).toBeNull()
		const libelle = screen.getByLabelText('Libellé de la transition de Qualification vers negociation') as HTMLInputElement
		expect(libelle.placeholder).toBe('Libellé de l’étape d’arrivée')
	})

	it('le workflow vivant illisible se dit ; la suggestion reste relisible', async () => {
		rendreModification({ vivant: undefined })
		expect(await screen.findByText('Le workflow que cette suggestion fait évoluer n’est plus lisible.')).toBeTruthy()
		expect(screen.getByTestId('ia-apercu')).toBeTruthy()
	})
})
