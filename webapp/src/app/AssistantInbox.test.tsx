// @verifies CRM-166 (docs/BACKLOG.md) — tranche T2 : la bulle de l'assistant de l'inbox, ses quatre états, la demande lot après lot, le plan fil par fil,
//           « Tout accepter » qui laisse les actions à confirmation, les confirmations des gestes irréversibles, le clavier
//           (docs/DESIGN_SYSTEM.md §5.116 ; docs/SPEC-mail-subsystem.md §36.1 à §36.5, §36.9 ; docs/SPEC-ia.md §17 ; décisions 994 et 997)
//
// LE VRAI COMPOSANT ET LE VRAI HOOK ; SEULS LES APPELS RÉSEAU SONT REMPLACÉS (l'état de la fonction, un lot, l'application d'une action, les comptes).
// Le parcours réel contre la fonction `ia`, le simulateur et la base est `e2e/ui/assistant-inbox.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResultatLot, PlanDeFil } from '../lib/assistant-inbox'

const etat = { valeur: { disponible: true, modele: 'simule' } as { disponible: boolean; modele: string; raison?: string } | null }
const lots: { options: { portee: { [cle: string]: unknown }; demande: string; signal?: AbortSignal }; resoudre: (r: ResultatLot) => void }[] = []
const appliquees: { portee: { fils: { cleFil: string }[] | null; sommeilVisible: boolean }; action: { genre: string } }[] = []
const reponseApplication: { suivante: { faits: number; refus: Record<string, number>; interruption: null | { nature: string } } } = {
	suivante: { faits: 1, refus: {}, interruption: null },
}
const ACCES = { url: 'http://api.test', cleAnonyme: 'cle', jeton: () => 'jeton' }

vi.mock('../lib/supabase', () => ({
	clientCrm: { rpc: vi.fn(async () => ({ data: [], error: null })) },
	urlApiCrm: 'http://api.test',
	cleAnonymeCrm: 'cle',
	porteurJeton: { lire: () => 'jeton' },
}))
vi.mock('../lib/assistant-ia', async (original) => ({
	...(await original<typeof import('../lib/assistant-ia')>()),
	accesAssistantCrm: ACCES,
	lireEtatAssistant: async () => etat.valeur,
}))
vi.mock('../lib/actions-groupees', async (original) => ({
	...(await original<typeof import('../lib/actions-groupees')>()),
	compterPortee: async () => ({ statut: 'pret', donnees: { fils: 1, messages: 3 } }),
	appliquerParPaquets: async (_c: unknown, portee: (typeof appliquees)[number]['portee'], action: (typeof appliquees)[number]['action']) => {
		appliquees.push({ portee, action })
		return { fils: 1, messages: 1, ...reponseApplication.suivante }
	},
}))
vi.mock('../lib/transferts-inbox', async (original) => ({
	...(await original<typeof import('../lib/transferts-inbox')>()),
	compterImpactBlocage: async () => ({ statut: 'pret', donnees: 4 }),
	bloquerExpediteur: async () => ({ corbeille: 4 }),
}))
vi.mock('../lib/assistant-inbox', async (original) => ({
	...(await original<typeof import('../lib/assistant-inbox')>()),
	demanderLot: (_acces: unknown, options: (typeof lots)[number]['options']) =>
		new Promise<ResultatLot>((resoudre) => {
			lots.push({ options, resoudre })
			options.signal?.addEventListener('abort', () => resoudre({ statut: 'annule' }), { once: true })
		}),
}))

const { AssistantInbox } = await import('./AssistantInbox')

const PORTEE = {
	idWorkspace: 'espace-1',
	dossier: { genre: 'non-classes' as const },
	seulementMoi: false,
	pastilles: [],
	expediteur: null,
	sommeilVisible: false,
}
const fil = (n: number) => ({ workspaceId: 'espace-1', cleFil: `fil-${n}` })
const plan = (n: number, actions: PlanDeFil['actions']): PlanDeFil => ({
	workspace_id: 'espace-1',
	thread_key: `fil-${n}`,
	objet: `Facture ${n}`,
	expediteur: `exp${n}@client.test`,
	actions,
})
const POSE = { action: 'pose_pastille', cible: { genre: 'pastille', id: 'p1', libelle: 'Facture' }, motif: 'Une facture', confirmation: false } as const
const LU = { action: 'lu', cible: null, motif: 'Déjà traité', confirmation: false } as const
const SUPPRIME = { action: 'supprime_partout', cible: null, motif: 'Du bruit', confirmation: true } as const

const onApplique = vi.fn()
const onAnnonce = vi.fn()

function rendre(fils: readonly { workspaceId: string; cleFil: string }[] | null = [fil(1), fil(2)]) {
	return render(<AssistantInbox portee={PORTEE} fils={fils} retention={30} onApplique={onApplique} onAnnonce={onAnnonce} />)
}

async function ouvrir(utilisateur: ReturnType<typeof userEvent.setup>) {
	await utilisateur.click(screen.getByTestId('assistant-bulle'))
	return await screen.findByTestId('assistant-panneau')
}

/** La demande est écrite, envoyée, et son unique lot rendu avec ces plans. */
async function demander(utilisateur: ReturnType<typeof userEvent.setup>, plans: PlanDeFil[]) {
	await ouvrir(utilisateur)
	await utilisateur.type(await screen.findByTestId('assistant-demande'), 'Range ces mails')
	await utilisateur.click(screen.getByTestId('assistant-envoyer'))
	await waitFor(() => expect(lots).toHaveLength(1))
	lots[0]!.resoudre({ statut: 'plan', plans, rejetees: 0, ecartes: 0 })
	await screen.findAllByTestId('assistant-fil')
}

beforeEach(() => {
	etat.valeur = { disponible: true, modele: 'simule' }
	lots.length = 0
	appliquees.length = 0
	reponseApplication.suivante = { faits: 1, refus: {}, interruption: null }
	onApplique.mockClear()
	onAnnonce.mockClear()
})
afterEach(cleanup)

describe('AssistantInbox — la bulle et ses états (CRM-166 T2)', () => {
	it('la bulle est un bouton nommé « Assistant IA » : repliée, aucun panneau ; ouverte, une région nommée', async () => {
		const utilisateur = userEvent.setup()
		rendre()
		const bulle = screen.getByTestId('assistant-bulle')
		expect(bulle.getAttribute('aria-label')).toBe('Assistant IA')
		expect(bulle.getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByTestId('assistant-panneau')).toBeNull()
		const panneau = await ouvrir(utilisateur)
		expect(panneau.getAttribute('role')).toBe('region')
		expect(bulle.getAttribute('aria-expanded')).toBe('true')
		expect(bulle.getAttribute('aria-controls')).toBe(panneau.id)
	})

	it('sans sélection : le motif est dit, le champ est éteint, aucun envoi', async () => {
		const utilisateur = userEvent.setup()
		rendre([])
		await ouvrir(utilisateur)
		expect((await screen.findByTestId('assistant-sans-selection')).textContent).toContain('Cochez des mails')
		expect((screen.getByTestId('assistant-demande') as HTMLTextAreaElement).disabled).toBe(true)
		expect((screen.getByTestId('assistant-envoyer') as HTMLButtonElement).disabled).toBe(true)
	})

	it("sans IA : la raison est dite avec les mots de l'assistant de conception, et aucun champ n'est offert", async () => {
		etat.valeur = { disponible: false, modele: 'x', raison: 'serveur_injoignable' }
		const utilisateur = userEvent.setup()
		rendre()
		await ouvrir(utilisateur)
		expect((await screen.findByTestId('assistant-etat-indisponible')).textContent).toContain('son serveur ne répond pas')
		expect(screen.queryByTestId('assistant-demande')).toBeNull()
		expect(screen.queryByTestId('assistant-envoyer')).toBeNull()
	})

	it("un état illisible se dit et se relit ; le champ n'est pas offert", async () => {
		etat.valeur = null
		const utilisateur = userEvent.setup()
		rendre()
		await ouvrir(utilisateur)
		expect((await screen.findByTestId('assistant-etat-indisponible')).textContent).toContain("n’a pas pu être lu")
		expect(screen.queryByTestId('assistant-demande')).toBeNull()
	})

	it('Échap ferme le panneau et rend le focus à la bulle', async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await ouvrir(utilisateur)
		await screen.findByTestId('assistant-demande')
		await utilisateur.keyboard('{Escape}')
		expect(screen.queryByTestId('assistant-panneau')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('assistant-bulle'))
	})

	it("à l'ouverture, le focus entre sur le champ de demande", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await ouvrir(utilisateur)
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('assistant-demande')))
	})
})

describe('AssistantInbox — la demande, lot après lot', () => {
	it('7 fils : deux lots de 5 et 2, la progression est dite, les lignes arrivent à mesure', async () => {
		const utilisateur = userEvent.setup()
		rendre([1, 2, 3, 4, 5, 6, 7].map(fil))
		await ouvrir(utilisateur)
		await utilisateur.type(await screen.findByTestId('assistant-demande'), 'Marque lu')
		await utilisateur.click(screen.getByTestId('assistant-envoyer'))
		await waitFor(() => expect(lots).toHaveLength(1))
		expect((lots[0]!.options.portee['threads'] as unknown[]).length).toBe(5)
		expect(screen.getByTestId('assistant-progression').textContent).toContain('Lot 1 sur 2')
		lots[0]!.resoudre({ statut: 'plan', plans: [1, 2, 3, 4, 5].map((n) => plan(n, [LU])), rejetees: 0, ecartes: 0 })
		await waitFor(() => expect(lots).toHaveLength(2))
		expect((lots[1]!.options.portee['threads'] as unknown[]).length).toBe(2)
		expect(screen.getByTestId('assistant-progression').textContent).toContain('Lot 2 sur 2')
		expect(screen.getAllByTestId('assistant-fil')).toHaveLength(5)
		lots[1]!.resoudre({ statut: 'plan', plans: [6, 7].map((n) => plan(n, [LU])), rejetees: 0, ecartes: 0 })
		await waitFor(() => expect(screen.getAllByTestId('assistant-fil')).toHaveLength(7))
		expect(screen.queryByTestId('assistant-progression')).toBeNull()
	})

	it("Ctrl+Entrée envoie ; Entrée seule va à la ligne ; au-delà de 1 000 caractères, l'envoi est refusé", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await ouvrir(utilisateur)
		const champ = await screen.findByTestId('assistant-demande')
		await utilisateur.type(champ, 'a{Enter}b')
		expect((champ as HTMLTextAreaElement).value).toBe('a\nb')
		expect(lots).toHaveLength(0)
		await utilisateur.keyboard('{Control>}{Enter}{/Control}')
		await waitFor(() => expect(lots).toHaveLength(1))
		cleanup()
		lots.length = 0
		rendre()
		await ouvrir(utilisateur)
		const long = await screen.findByTestId('assistant-demande')
		await utilisateur.click(long)
		await utilisateur.paste('x'.repeat(1001))
		expect(screen.getByTestId('assistant-compteur').textContent).toBe('1001 / 1000')
		expect((screen.getByTestId('assistant-envoyer') as HTMLButtonElement).disabled).toBe(true)
	})

	it('Annuler coupe la demande en cours : le signal est levé et aucun lot suivant ne part', async () => {
		const utilisateur = userEvent.setup()
		rendre([1, 2, 3, 4, 5, 6].map(fil))
		await ouvrir(utilisateur)
		await utilisateur.type(await screen.findByTestId('assistant-demande'), 'Marque lu')
		await utilisateur.click(screen.getByTestId('assistant-envoyer'))
		await waitFor(() => expect(lots).toHaveLength(1))
		await utilisateur.click(screen.getByTestId('assistant-annuler'))
		expect(lots[0]!.options.signal?.aborted).toBe(true)
		await waitFor(() => expect(screen.queryByTestId('assistant-progression')).toBeNull())
		expect(lots).toHaveLength(1)
	})

	it('un lot en échec porte son erreur et « Réessayer » ; les lots rendus restent proposés', async () => {
		const utilisateur = userEvent.setup()
		rendre([1, 2, 3, 4, 5, 6].map(fil))
		await ouvrir(utilisateur)
		await utilisateur.type(await screen.findByTestId('assistant-demande'), 'Marque lu')
		await utilisateur.click(screen.getByTestId('assistant-envoyer'))
		await waitFor(() => expect(lots).toHaveLength(1))
		lots[0]!.resoudre({ statut: 'plan', plans: [1, 2, 3, 4, 5].map((n) => plan(n, [LU])), rejetees: 0, ecartes: 0 })
		await waitFor(() => expect(lots).toHaveLength(2))
		lots[1]!.resoudre({ statut: 'echec', echec: 'delai_depasse' })
		expect((await screen.findByTestId('assistant-echec')).textContent).toContain('trop de temps')
		expect(screen.getAllByTestId('assistant-fil')).toHaveLength(5)
		await utilisateur.click(screen.getByTestId('assistant-reessayer-lot'))
		await waitFor(() => expect(lots).toHaveLength(3))
		lots[2]!.resoudre({ statut: 'plan', plans: [plan(6, [LU])], rejetees: 0, ecartes: 0 })
		await waitFor(() => expect(screen.getAllByTestId('assistant-fil')).toHaveLength(6))
		expect(screen.queryByTestId('assistant-echec')).toBeNull()
	})

	it('ce que le plan écarte est dit ; un plan vide aussi', async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await ouvrir(utilisateur)
		await utilisateur.type(await screen.findByTestId('assistant-demande'), 'Range')
		await utilisateur.click(screen.getByTestId('assistant-envoyer'))
		await waitFor(() => expect(lots).toHaveLength(1))
		lots[0]!.resoudre({ statut: 'plan', plans: [], rejetees: 2, ecartes: 1 })
		expect((await screen.findByTestId('assistant-ecarts')).textContent).toContain('2 actions ignorées')
		expect(screen.getByTestId('assistant-ecarts').textContent).toContain('1 mail n’est plus visible')
		expect(screen.getByTestId('assistant-plan-vide').textContent).toContain('ne propose rien')
	})

	it('« tout le filtre » plus grand que 50 : la bulle le dit et ne part pas', async () => {
		const { clientCrm } = await import('../lib/supabase')
		;(clientCrm as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc.mockResolvedValueOnce({
			data: Array.from({ length: 51 }, (_, n) => ({ workspace_id: 'espace-1', thread_key: `f${n}` })),
			error: null,
		})
		const utilisateur = userEvent.setup()
		rendre(null)
		await ouvrir(utilisateur)
		await utilisateur.type(await screen.findByTestId('assistant-demande'), 'Range')
		await utilisateur.click(screen.getByTestId('assistant-envoyer'))
		expect((await screen.findByTestId('assistant-trop')).textContent).toContain('plus de 50 fils')
		expect(lots).toHaveLength(0)
	})
})

describe('AssistantInbox — accepter, refuser, tout accepter', () => {
	it("« Accepter » applique les actions dans l'ordre du plan, par le geste de la page, sur ce seul fil ; la ligne garde sa place", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [POSE, LU]), plan(2, [LU])])
		const premiere = screen.getAllByTestId('assistant-fil')[0]!
		await utilisateur.click(within(premiere).getByTestId('assistant-accepter'))
		await waitFor(() => expect(premiere.getAttribute('data-etat')).toBe('applique'))
		expect(within(premiere).getByTestId('assistant-etat').textContent).toContain('Appliqué (2 actions)')
		expect(appliquees.map((a) => a.action.genre)).toEqual(['set_label', 'mark_read'])
		expect(appliquees[0]!.portee.fils).toEqual([{ workspaceId: 'espace-1', cleFil: 'fil-1' }])
		expect(appliquees[0]!.portee.sommeilVisible).toBe(true)
		expect(onApplique).toHaveBeenCalled()
		expect(screen.getAllByTestId('assistant-fil')[0]).toBe(premiere)
		expect(within(premiere).queryByTestId('assistant-accepter')).toBeNull()
	})

	it("« Refuser » rend le fil sans suite : rien n'est appliqué", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [LU])])
		await utilisateur.click(screen.getByTestId('assistant-refuser'))
		expect(screen.getByTestId('assistant-fil').getAttribute('data-etat')).toBe('refuse')
		expect(screen.getByTestId('assistant-etat').textContent).toContain('Refusé')
		expect(appliquees).toHaveLength(0)
	})

	it("un refus de la base est dit sur la ligne avec la phrase des actions groupées, et le fil se réessaie", async () => {
		reponseApplication.suivante = { faits: 0, refus: { forbidden: 1 }, interruption: null }
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [POSE])])
		await utilisateur.click(screen.getByTestId('assistant-accepter'))
		expect((await screen.findByTestId('assistant-refus')).textContent).toContain('vous n’avez pas le droit')
		expect(screen.getByTestId('assistant-fil').getAttribute('data-etat')).toBe('echec')
		reponseApplication.suivante = { faits: 1, refus: {}, interruption: null }
		await utilisateur.click(screen.getByTestId('assistant-accepter'))
		await waitFor(() => expect(screen.getByTestId('assistant-fil').getAttribute('data-etat')).toBe('applique'))
	})

	it("un refus inconnu se dit « Cette action n'a pas pu être appliquée »", async () => {
		reponseApplication.suivante = { faits: 0, refus: { quelque_chose: 1 }, interruption: null }
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [LU])])
		await utilisateur.click(screen.getByTestId('assistant-accepter'))
		expect((await screen.findByTestId('assistant-refus')).textContent).toContain("n’a pas pu être appliquée")
	})

	it('une action irréversible porte son mot et son icône ; sa confirmation est dans le panneau, et la décliner laisse le fil partiel', async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [LU, SUPPRIME])])
		const ligne = screen.getByTestId('assistant-fil')
		expect(within(ligne).getByText('irréversible')).toBeTruthy()
		await utilisateur.click(within(ligne).getByTestId('assistant-accepter'))
		const confirmation = await within(ligne).findByTestId('assistant-confirmation')
		expect(confirmation.textContent).toContain('partout')
		expect(appliquees.map((a) => a.action.genre)).toEqual(['mark_read'])
		await utilisateur.click(within(confirmation).getByRole('button', { name: 'Annuler' }))
		await waitFor(() => expect(ligne.getAttribute('data-etat')).toBe('partiel'))
		expect(within(ligne).getByTestId('assistant-etat').textContent).toContain('1 sur 2 faites')
		expect(appliquees.map((a) => a.action.genre)).toEqual(['mark_read'])
	})

	it("valider la confirmation de suppression applique l'action, une fois", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [SUPPRIME])])
		await utilisateur.click(screen.getByTestId('assistant-accepter'))
		await utilisateur.click(await screen.findByTestId('assistant-confirmer'))
		await waitFor(() => expect(screen.getByTestId('assistant-fil').getAttribute('data-etat')).toBe('applique'))
		expect(appliquees).toHaveLength(1)
		expect(appliquees[0]!.action).toMatchObject({ genre: 'delete', partout: true })
	})

	it("« Tout accepter » dit le nombre d'actions et de mails, laisse les actions à confirmation proposées, et applique le reste fil après fil", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [POSE, SUPPRIME]), plan(2, [LU])])
		await utilisateur.click(screen.getByTestId('assistant-tout-accepter'))
		const confirmation = await screen.findByTestId('assistant-tout-confirmation')
		expect(confirmation.textContent).toContain('2 actions seront appliquées sur 2 mails')
		expect(confirmation.textContent).toContain('1 action irréversible reste à valider une à une')
		await utilisateur.click(screen.getByTestId('assistant-tout-appliquer'))
		await waitFor(() => expect(appliquees).toHaveLength(2))
		expect(appliquees.map((a) => a.action.genre)).toEqual(['set_label', 'mark_read'])
		const lignes = screen.getAllByTestId('assistant-fil')
		await waitFor(() => expect(lignes[1]!.getAttribute('data-etat')).toBe('applique'))
		expect(lignes[0]!.getAttribute('data-etat')).toBe('partiel')
		expect(within(lignes[0]!).getByTestId('assistant-accepter')).toBeTruthy()
		expect(screen.queryByTestId('assistant-confirmation')).toBeNull()
	})

	it("un fil refusé par la base n'arrête pas « Tout accepter »", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [POSE]), plan(2, [LU])])
		reponseApplication.suivante = { faits: 0, refus: { forbidden: 1 }, interruption: null }
		await utilisateur.click(screen.getByTestId('assistant-tout-accepter'))
		reponseApplication.suivante = { faits: 0, refus: { forbidden: 1 }, interruption: null }
		await utilisateur.click(await screen.findByTestId('assistant-tout-appliquer'))
		await waitFor(() => expect(appliquees).toHaveLength(2))
		const lignes = screen.getAllByTestId('assistant-fil')
		expect(lignes.map((l) => l.getAttribute('data-etat'))).toEqual(['echec', 'echec'])
	})

	it("le blocage de l'expéditeur : le nombre de messages, puis la seconde confirmation, puis le blocage", async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await demander(utilisateur, [plan(1, [{ action: 'bloque_expediteur', cible: null, motif: 'Spam', confirmation: true }])])
		await utilisateur.click(screen.getByTestId('assistant-accepter'))
		expect((await screen.findByTestId('assistant-blocage-impact')).textContent).toContain('4')
		await utilisateur.click(screen.getByTestId('assistant-blocage-continuer'))
		await utilisateur.click(await screen.findByTestId('assistant-confirmer'))
		await waitFor(() => expect(screen.getByTestId('assistant-fil').getAttribute('data-etat')).toBe('applique'))
	})
})
