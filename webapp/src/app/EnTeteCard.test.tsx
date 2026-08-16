// @verifies CRM-040 (docs/BACKLOG.md) — le rendu réel de l'en-tête de la fiche d'affaire
// @verifies docs/SPEC-cards.md §15.4 (les six données), §15.5 (l'action de copie et son échec),
//           §15.6 (accessibilité), §15.7 (les trois états de donnée)
// @verifies docs/DESIGN_SYSTEM.md §5.3 bis (omission plutôt que tiret, couple terme/valeur,
//           pilule « Archivé », confirmation de copie), §8 (nom accessible), §10 (aucun texte en dur)
//
// Ces tests montent le **vrai** composant et l'isolent par ses rôles accessibles. La copie est
// injectée : `navigator.clipboard` n'existe pas dans jsdom, et substituer l'API du navigateur
// éprouverait jsdom plutôt que le produit. Le geste réel est éprouvé sur Chromium par
// `e2e/ui/entete-card.spec.ts`.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnTeteCard } from './EnTeteCard'
import type { CardOuverte } from '../lib/formulaire'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

function card(surcharge: Partial<CardOuverte> = {}): CardOuverte {
	return {
		id: 'card-1',
		title: 'Migration ERP Sogexia',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		current_step_id: 'step-1',
		email_local_part: 'c-cvk2w2a1',
		amount: 125000,
		currency: 'EUR',
		next_action: 'Obtenir le cadrage technique',
		next_action_at: '2026-08-20T09:00:00+00:00',
		archived_at: null,
		// Une affaire ÉVEILLÉE par défaut : le sommeil est l'exception, et une fixture qui
		// dormirait rendrait la pastille présente dans toutes les preuves (CRM-081, §16.11).
		snoozed_until: null,
		profiles: { id: 'p-1', full_name: 'Driss Lemoine', avatar_url: null },
		workspaces: { inbound_domain: 'crm.p2enjoy.test' },
		...surcharge,
	}
}

const copieQuiReussit = () => Promise.resolve(true)

describe("l'en-tête d'une affaire complète", () => {
	it('rend le titre en niveau 2, nom accessible de la section', () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		expect(screen.getByRole('heading', { level: 2, name: 'Migration ERP Sogexia' })).toBeTruthy()
	})

	it('rend le responsable, son nom écrit et son avatar décoratif', () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		const ligne = screen.getByTestId('entete-card-responsable')
		expect(ligne.textContent).toContain('Responsable')
		expect(ligne.textContent).toContain('Driss Lemoine')
		// L'avatar ne porte AUCUN nom accessible : le nom est écrit à côté, et l'annoncer deux fois
		// serait une redondance (docs/SPEC-identite.md §7).
		expect(screen.queryByRole('img', { name: 'Driss Lemoine' })).toBeNull()
	})

	it('rend le montant et son code devise dans deux éléments distincts', () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		const ligne = screen.getByTestId('entete-card-montant')
		// Le code devise a SON PROPRE élément : accolé par un nœud de texte nu, `gap` ne le séparerait
		// pas — défaut « Discussion1 » du §5.11 du design system.
		const elements = [...ligne.querySelectorAll('code, span')].map((n) => n.textContent)
		expect(elements).toContain('EUR')
		expect(ligne.textContent?.replace(/\s/gu, '')).toContain('125000,00')
	})

	it("rend la prochaine action et son échéance", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		const ligne = screen.getByTestId('entete-card-prochaine-action')
		expect(ligne.textContent).toContain('Obtenir le cadrage technique')
		expect(screen.getByTestId('entete-card-echeance').textContent).toBe('20/08/2026')
	})

	it("rend l'adresse composée et son explication d'usage en toutes lettres", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-adresse').textContent).toBe('c-cvk2w2a1@crm.p2enjoy.test')
		// L'explication est un TEXTE, pas seulement un `title` : une infobulle native n'apparaît ni
		// au clavier, ni au toucher (§15.5).
		expect(screen.getByText(/Mettez cette adresse en copie/u)).toBeTruthy()
	})

	it("ne porte aucune pilule « Archivé » sur une affaire en cours", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		expect(screen.queryByTestId('entete-card-archivee')).toBeNull()
	})
})

describe('les données absentes', () => {
	// LE RESPONSABLE EST LA SEULE ABSENCE QUI SOIT UNE PHRASE (§5.3 bis) : n'avoir personne à qui
	// s'adresser est un fait de l'affaire.
	it("écrit « Aucun responsable » plutôt que d'omettre la ligne", () => {
		render(<EnTeteCard card={card({ profiles: null })} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-responsable').textContent).toContain('Aucun responsable')
	})

	// LES AUTRES DISPARAISSENT ENTIÈREMENT — ni tiret, ni « non renseigné » (§5.3 bis).
	it('omet la ligne du montant, sans tiret ni mention', () => {
		render(<EnTeteCard card={card({ amount: null })} copier={copieQuiReussit} />)
		expect(screen.queryByTestId('entete-card-montant')).toBeNull()
		expect(screen.queryByText('—')).toBeNull()
	})

	it('omet la ligne de la prochaine action', () => {
		render(<EnTeteCard card={card({ next_action: null })} copier={copieQuiReussit} />)
		expect(screen.queryByTestId('entete-card-prochaine-action')).toBeNull()
	})

	// L'ÉCHÉANCE SEULE EST OMISE, la prochaine action reste : une action sans date est une action.
	it("garde la prochaine action lorsque seule l'échéance manque", () => {
		render(<EnTeteCard card={card({ next_action_at: null })} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-prochaine-action').textContent).toContain(
			'Obtenir le cadrage technique',
		)
		expect(screen.queryByTestId('entete-card-echeance')).toBeNull()
	})

	it("écrit « Adresse indisponible » et n'offre aucune copie sans domaine", () => {
		render(<EnTeteCard card={card({ workspaces: null })} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-adresse-absente')).toBeTruthy()
		// Une commande sans objet est une commande morte (docs/DESIGN_SYSTEM.md §5.10).
		expect(screen.queryByTestId('entete-card-copier')).toBeNull()
	})
})

describe("l'affaire archivée", () => {
	it('porte la pilule « Archivé » à côté de son titre', () => {
		render(
			<EnTeteCard card={card({ archived_at: '2026-03-31T16:00:00+00:00' })} copier={copieQuiReussit} />,
		)
		// La mention est un MOT, jamais une teinte seule (docs/DESIGN_SYSTEM.md §1).
		expect(screen.getByTestId('entete-card-archivee').textContent).toContain('Archivé')
	})
})

describe("l'action de copie", () => {
	it("porte un nom accessible qui dit CE QUI est copié", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} />)
		expect(screen.getByRole('button', { name: "Copier l'adresse email de l'affaire" })).toBeTruthy()
	})

	it("copie l'adresse composée, et remplace son libellé par la confirmation", async () => {
		const copier = vi.fn(() => Promise.resolve(true))
		render(<EnTeteCard card={card()} copier={copier} />)
		screen.getByTestId('entete-card-copier').click()
		await waitFor(() => {
			expect(screen.getByTestId('entete-card-copier').textContent).toContain('Copié')
		})
		expect(copier).toHaveBeenCalledWith('c-cvk2w2a1@crm.p2enjoy.test')
		// LA CONFIRMATION REMPLACE, elle ne s'ajoute pas (§5.7 ter) : deux mentions superposées
		// feraient croire à deux gestes.
		expect(screen.getByTestId('entete-card-copier').textContent).not.toContain("Copier l'adresse")
	})

	// UN BOUTON QUI NE FAIT RIEN EN SILENCE est la « simulation de succès » que CLAUDE.md §18
	// interdit : le refus est écrit, avec sa manœuvre de remplacement.
	it('dit le refus du navigateur et nomme la manœuvre de remplacement', async () => {
		render(<EnTeteCard card={card()} copier={() => Promise.resolve(false)} />)
		screen.getByTestId('entete-card-copier').click()
		await waitFor(() => {
			expect(screen.getByTestId('entete-card-copie-etat').textContent).toContain(
				"La copie n'a pas abouti",
			)
		})
		// La région d'annonce existe toujours (§8) : apparue seulement à l'échec, son contenu ne
		// serait pas annoncé par un lecteur d'écran.
		expect(screen.getByTestId('entete-card-copie-etat').getAttribute('role')).toBe('status')
	})
})

// LA RÉGRESSION TROUVÉE PAR LA CAMPAGNE DE FIN DE SESSION, figée ici.
//
// Les preuves d'interface qui substituent le réseau (docs/DESIGN_SYSTEM.md §12.5) servent une card
// SANS ses relations embarquées : `profiles` y est **absente**, et non nulle. `profil.full_name`
// levait alors `Cannot read properties of undefined` et faisait tomber la page entière — cinquante
// et un scénarios rouges. Le type ne garantit jamais une valeur (docs/SPEC-types.md).
describe('une réponse qui ne porte pas les relations embarquées', () => {
	function sansRelations(): CardOuverte {
		const { profiles: _p, workspaces: _w, ...reste } = card()
		return reste as CardOuverte
	}

	it("traite une relation ABSENTE comme une absence de responsable, sans tomber", () => {
		render(<EnTeteCard card={sansRelations()} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-responsable').textContent).toContain('Aucun responsable')
	})

	it("traite un workspace ABSENT comme une adresse indisponible", () => {
		render(<EnTeteCard card={sansRelations()} copier={copieQuiReussit} />)
		expect(screen.getByTestId('entete-card-adresse-absente')).toBeTruthy()
	})
})

// ---------------------------------------------------------------------------------------------
// L'ÉDITION des six champs — docs/SPEC-cards.md §15 bis
//
// @verifies docs/SPEC-cards.md §15 bis.2 (une colonne par écriture), §15 bis.3 (le moment),
//           §15 bis.6 (la liste des membres, lue à l'ouverture seulement),
//           §15 bis.7 (« sans effet » n'est pas un succès), §15 bis.9 (états et accessibilité)
// @verifies docs/DESIGN_SYSTEM.md §5.3 ter (bascule, focus, commande jamais éteinte)
// ---------------------------------------------------------------------------------------------

type EcritureEntete = { readonly charge: Record<string, unknown> }

/**
 * Client factice : il enregistre les écritures reçues et rend la réponse voulue.
 *
 * Il n'imite pas PostgREST — il rapporte ce que le composant a ÉMIS, ce qui est exactement ce qu'une
 * preuve unitaire peut établir. Que le serveur accepte réellement cette charge, et qu'il rende bien
 * `200` et zéro ligne au lecteur seul, est prouvé contre la vraie route par
 * `e2e/api/entete-card-ecriture.spec.ts`.
 */
function clientEntete(
	reponse: { data: unknown[] | null; error: { code: string; message: string } | null; status: number } = {
		data: [
			{
				id: 'card-1',
				title: 'Migration ERP Sogexia',
				owner_id: 'p-1',
				amount: 125000,
				currency: 'EUR',
				next_action: 'Obtenir le cadrage technique',
				next_action_at: '2026-08-20T09:00:00+00:00',
			},
		],
		error: null,
		status: 200,
	},
	membres: unknown[] = [{ user_id: 'p-2', profiles: { id: 'p-2', full_name: 'Camille Aubert' } }],
): { client: ClientCrm; ecritures: EcritureEntete[] } {
	const ecritures: EcritureEntete[] = []
	const client = {
		from: (table: string) => ({
			update: (charge: Record<string, unknown>) => {
				ecritures.push({ charge })
				const chaine: Record<string, unknown> = {}
				chaine['eq'] = () => chaine
				chaine['select'] = () => chaine
				chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
					Promise.resolve(reponse).then(resoudre)
				return chaine
			},
			select: () => {
				const chaine: Record<string, unknown> = {}
				chaine['eq'] = () => chaine
				chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
					Promise.resolve(
						table === 'workspace_members'
							? { data: membres, error: null, status: 200 }
							: { data: [], error: null, status: 200 },
					).then(resoudre)
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, ecritures }
}

async function ouvrirEdition(surcharge: Partial<CardOuverte> = {}, factice = clientEntete()) {
	render(<EnTeteCard card={card(surcharge)} copier={copieQuiReussit} client={factice.client} />)
	screen.getByTestId('entete-card-modifier').click()
	await waitFor(() => expect(screen.getByTestId('entete-card-edition')).toBeTruthy())
	return factice
}

describe("la bascule entre lecture et édition", () => {
	it("n'affiche aucun contrôle tant que l'édition n'est pas ouverte", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} client={clientEntete().client} />)
		expect(screen.queryByTestId('entete-card-edition')).toBeNull()
		expect(screen.queryByTestId('entete-title')).toBeNull()
	})

	// LA COMMANDE N'EST JAMAIS ÉTEINTE D'AVANCE, quel que soit le rôle : la règle vit dans la
	// politique, et une commande grisée ferait passer une décision de la base pour une décision
	// d'écran (CLAUDE.md §10).
	it("offre la commande sans jamais la désactiver", () => {
		render(<EnTeteCard card={card()} copier={copieQuiReussit} client={clientEntete().client} />)
		const commande = screen.getByTestId('entete-card-modifier') as HTMLButtonElement
		expect(commande.disabled).toBe(false)
	})

	it("rend les six contrôles à l'ouverture, y compris ceux dont la lecture omet la ligne", async () => {
		await ouvrirEdition({ amount: null, next_action: null, next_action_at: null })
		// La lecture ne rendrait NI le montant NI la prochaine action : sans le mode d'édition, il
		// n'existerait aucun endroit où les saisir (§5.3 ter).
		for (const champ of ['title', 'owner_id', 'amount', 'currency', 'next_action', 'next_action_at']) {
			expect(screen.getByTestId(`entete-${champ}`)).toBeTruthy()
		}
	})

	it("porte le focus dans le premier contrôle à l'ouverture (§5.13)", async () => {
		await ouvrirEdition()
		expect(document.activeElement).toBe(screen.getByTestId('entete-title'))
	})

	it("rend le focus à la commande en terminant, et non au corps du document", async () => {
		await ouvrirEdition()
		screen.getByTestId('entete-card-terminer').click()
		await waitFor(() => expect(screen.queryByTestId('entete-card-edition')).toBeNull())
		expect(document.activeElement).toBe(screen.getByTestId('entete-card-modifier'))
	})

	it("n'émet AUCUNE écriture en terminant : chaque champ a déjà écrit sa valeur", async () => {
		const factice = await ouvrirEdition()
		screen.getByTestId('entete-card-terminer').click()
		await waitFor(() => expect(screen.queryByTestId('entete-card-edition')).toBeNull())
		expect(factice.ecritures).toHaveLength(0)
	})
})

describe("l'écriture d'un champ d'en-tête", () => {
	it("n'émet QU'UNE colonne par requête (§15 bis.2)", async () => {
		const factice = await ouvrirEdition()
		const controle = screen.getByTestId('entete-title') as HTMLInputElement
		fireEvent.change(controle, { target: { value: 'Migration ERP — phase 2' } })
		fireEvent.blur(controle)
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		expect(Object.keys(factice.ecritures[0]!.charge)).toEqual(['title'])
	})

	it("n'émet RIEN si la valeur n'a pas changé (§15 bis.3)", async () => {
		const factice = await ouvrirEdition()
		const controle = screen.getByTestId('entete-title')
		fireEvent.focus(controle)
		fireEvent.blur(controle)
		expect(factice.ecritures).toHaveLength(0)
	})

	it('met la devise en majuscules avant de l’émettre', async () => {
		const factice = await ouvrirEdition()
		const controle = screen.getByTestId('entete-currency') as HTMLInputElement
		fireEvent.change(controle, { target: { value: 'chf' } })
		fireEvent.blur(controle)
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		expect(factice.ecritures[0]!.charge).toEqual({ currency: 'CHF' })
	})

	it("écrit le responsable au CHANGEMENT, sans attendre la perte du focus", async () => {
		const factice = await ouvrirEdition()
		fireEvent.change(screen.getByTestId('entete-owner_id'), { target: { value: 'p-2' } })
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		expect(factice.ecritures[0]!.charge).toEqual({ owner_id: 'p-2' })
	})

	it('confirme par une région annoncée, liée au contrôle', async () => {
		await ouvrirEdition()
		const controle = screen.getByTestId('entete-title') as HTMLInputElement
		fireEvent.change(controle, { target: { value: 'Autre titre' } })
		fireEvent.blur(controle)
		const etat = await screen.findByTestId('entete-title-etat')
		expect(etat.getAttribute('role')).toBe('status')
		expect(controle.getAttribute('aria-describedby')).toContain('entete-title-etat')
	})
})

describe("les issues qui ne sont pas des enregistrements", () => {
	// LA MESURE QUI COMMANDE LE GESTE : le lecteur seul reçoit 200 et ZÉRO ligne, jamais 403.
	// Annoncer « Enregistré » ici serait la simulation de succès que CLAUDE.md §18 interdit.
	it("dit « rien n'a été enregistré » sur 200 avec zéro ligne, et n'annonce PAS un succès", async () => {
		const factice = clientEntete({ data: [], error: null, status: 200 })
		await ouvrirEdition({}, factice)
		const controle = screen.getByTestId('entete-title') as HTMLInputElement
		fireEvent.change(controle, { target: { value: 'Tentative' } })
		fireEvent.blur(controle)
		const refus = await screen.findByTestId('entete-title-refus')
		expect(refus.getAttribute('role')).toBe('alert')
		expect(refus.textContent).toContain("Rien n'a été enregistré")
		expect(screen.queryByTestId('entete-title-etat')).toBeNull()
	})

	it("laisse la saisie à l'écran après un refus, et ne la rejette jamais", async () => {
		const factice = clientEntete({
			data: null,
			error: { code: '23514', message: 'violates check constraint' },
			status: 400,
		})
		await ouvrirEdition({}, factice)
		const controle = screen.getByTestId('entete-title') as HTMLInputElement
		fireEvent.change(controle, { target: { value: '   ' } })
		fireEvent.blur(controle)
		await screen.findByTestId('entete-title-refus')
		expect(controle.value).toBe('   ')
		expect(controle.getAttribute('aria-invalid')).toBe('true')
	})

	it("ne désactive JAMAIS le contrôle pendant l'envoi (§5.7 ter)", async () => {
		await ouvrirEdition()
		const controle = screen.getByTestId('entete-title') as HTMLInputElement
		fireEvent.change(controle, { target: { value: 'Autre' } })
		fireEvent.blur(controle)
		expect(controle.disabled).toBe(false)
	})

	it("nomme l'échec de la liste des membres plutôt que de rendre un sélecteur vide", async () => {
		const factice = clientEntete(undefined, [])
		const client = {
			from: (table: string) =>
				table === 'workspace_members'
					? {
							select: () => {
								const chaine: Record<string, unknown> = {}
								chaine['eq'] = () => chaine
								chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
									Promise.resolve({
										data: null,
										error: { message: 'panne' },
										status: 500,
									}).then(resoudre)
								return chaine
							},
						}
					: (factice.client as unknown as { from: (t: string) => unknown }).from(table),
		} as unknown as ClientCrm
		render(<EnTeteCard card={card()} copier={copieQuiReussit} client={client} />)
		screen.getByTestId('entete-card-modifier').click()
		const echec = await screen.findByTestId('entete-membres-echec')
		expect(echec.getAttribute('role')).toBe('alert')
	})
})

describe("ce que l'écran montre APRÈS une écriture confirmée", () => {
	it("met la lecture à jour depuis la ligne RENDUE par le serveur, pas depuis la saisie", async () => {
		// Le serveur rend un titre DIFFÉRENT de la saisie : c'est le sien qui doit paraître.
		const factice = clientEntete({
			data: [
				{
					id: 'card-1',
					title: 'Titre normalisé par la base',
					owner_id: null,
					amount: 999,
					currency: 'EUR',
					next_action: null,
					next_action_at: null,
				},
			],
			error: null,
			status: 200,
		})
		await ouvrirEdition({}, factice)
		const controle = screen.getByTestId('entete-title') as HTMLInputElement
		fireEvent.change(controle, { target: { value: 'ce que je tape' } })
		fireEvent.blur(controle)
		await screen.findByTestId('entete-title-etat')
		screen.getByTestId('entete-card-terminer').click()
		await waitFor(() =>
			expect(screen.getByTestId('entete-card').textContent).toContain('Titre normalisé par la base'),
		)
	})

	it("détache le responsable quand le serveur rend owner_id à null", async () => {
		const factice = clientEntete({
			data: [
				{
					id: 'card-1',
					title: 'Migration ERP Sogexia',
					owner_id: null,
					amount: 125000,
					currency: 'EUR',
					next_action: null,
					next_action_at: null,
				},
			],
			error: null,
			status: 200,
		})
		await ouvrirEdition({}, factice)
		fireEvent.change(screen.getByTestId('entete-owner_id'), { target: { value: '' } })
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		screen.getByTestId('entete-card-terminer').click()
		await waitFor(() =>
			expect(screen.getByTestId('entete-card-responsable').textContent).toContain(
				'Aucun responsable',
			),
		)
	})
})

// @verifies CRM-081 (docs/BACKLOG.md) — mise en sommeil d'une affaire, tranche 2 a
// @verifies docs/SPEC-cards.md §16.11.1 (le prédicat et son instant injectable),
//           §16.11.2 (la pastille), §16.11.3 (les deux visages de la commande),
//           §16.11.4 (les issues montrées) ; docs/DESIGN_SYSTEM.md §5.3 quater
describe("la mise en sommeil (CRM-081, docs/SPEC-cards.md §16.11)", () => {
	const MAINTENANT = new Date('2026-08-16T12:00:00Z')

	/** Un client réduit aux deux RPC, qui NOTE ce qui lui a été demandé. */
	function clientSommeil(
		reponse: { status: number; error: { message: string } | null; data: unknown },
	): { client: ClientCrm; appels: { nom: string; arguments: Record<string, unknown> }[] } {
		const appels: { nom: string; arguments: Record<string, unknown> }[] = []
		const client = {
			rpc: async (nom: string, args: Record<string, unknown>) => {
				appels.push({ nom, arguments: args })
				return reponse
			},
			from: () => ({
				select: () => {
					const chaine: Record<string, unknown> = {}
					chaine['eq'] = () => chaine
					chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
						Promise.resolve({ data: [], error: null, status: 200 }).then(resoudre)
					return chaine
				},
			}),
		} as unknown as ClientCrm
		return { client, appels }
	}

	it("porte la pastille et son échéance quand l'affaire dort", () => {
		const { client } = clientSommeil({ status: 200, error: null, data: null })
		render(
			<EnTeteCard
				card={card({ snoozed_until: '2026-08-26T12:00:00+00:00' })}
				client={client}
				maintenant={MAINTENANT}
			/>,
		)
		expect(screen.getByTestId('entete-card-sommeil').textContent).toContain('26/08/2026')
		// DEUX VISAGES, UN SEUL RENDU : la commande d'endormissement disparaît.
		expect(screen.getByTestId('entete-card-reveiller')).toBeTruthy()
		expect(screen.queryByTestId('entete-card-endormir')).toBeNull()
	})

	it("ne porte AUCUNE pastille quand l'échéance est échue, colonne pourtant renseignée (§16.2)", () => {
		const { client } = clientSommeil({ status: 200, error: null, data: null })
		render(
			<EnTeteCard
				card={card({ snoozed_until: '2026-08-14T12:00:00+00:00' })}
				client={client}
				maintenant={MAINTENANT}
			/>,
		)
		expect(screen.queryByTestId('entete-card-sommeil')).toBeNull()
		expect(screen.getByTestId('entete-card-endormir')).toBeTruthy()
	})

	it("la pastille d'archivage et celle de sommeil COEXISTENT", () => {
		const { client } = clientSommeil({ status: 200, error: null, data: null })
		render(
			<EnTeteCard
				card={{
					...card({ snoozed_until: '2026-08-26T12:00:00+00:00' }),
					archived_at: '2026-03-31T16:00:00+00:00',
				}}
				client={client}
				maintenant={MAINTENANT}
			/>,
		)
		expect(screen.getByTestId('entete-card-archivee')).toBeTruthy()
		expect(screen.getByTestId('entete-card-sommeil')).toBeTruthy()
	})

	it("une échéance usuelle envoie une date FUTURE, et la pastille naît de la ligne rendue", async () => {
		const { client, appels } = clientSommeil({
			status: 200,
			error: null,
			data: { id: 'card-1', snoozed_until: '2026-08-19T12:00:00+00:00' },
		})
		render(<EnTeteCard card={card()} client={client} maintenant={MAINTENANT} />)
		screen.getByTestId('entete-card-endormir').click()
		// Le panneau naît d'une mise à jour d'état : il est ATTENDU, jamais supposé rendu au retour
		// du clic — c'est la même règle que la bascule d'édition plus haut dans ce fichier.
		await screen.findByTestId('entete-card-panneau-sommeil')
		screen.getByTestId('entete-card-sommeil-troisjours').click()
		await waitFor(() => expect(appels).toHaveLength(1))
		expect(appels[0]?.nom).toBe('snooze_card')
		expect(String(appels[0]?.arguments['until'])).toBe('2026-08-19T12:00:00.000Z')
		// LA LIGNE RENDUE EST LA SOURCE, jamais la saisie : la pastille porte 19/08, ce que le
		// serveur a répondu, et non une date recomposée par l'écran.
		await waitFor(() =>
			expect(screen.getByTestId('entete-card-sommeil').textContent).toContain('19/08/2026'),
		)
	})

	it("ENVOIE une échéance passée plutôt que de la refuser, et MONTRE le refus de la base", async () => {
		const { client, appels } = clientSommeil({
			status: 400,
			error: { message: 'snooze_date_in_past' },
			data: null,
		})
		render(<EnTeteCard card={card()} client={client} maintenant={MAINTENANT} />)
		screen.getByTestId('entete-card-endormir').click()
		await screen.findByTestId('entete-card-panneau-sommeil')
		fireEvent.change(screen.getByTestId('entete-card-sommeil-echeance'), {
			target: { value: '2020-01-01T09:00' },
		})
		screen.getByTestId('entete-card-sommeil-envoyer').click()
		await waitFor(() => expect(appels).toHaveLength(1))
		const mention = await screen.findByTestId('entete-card-sommeil-mention')
		expect(mention.textContent).toContain('future')
		// LE REFUS N'EFFACE PAS LA SAISIE : le panneau reste ouvert pour la corriger.
		expect(screen.getByTestId('entete-card-panneau-sommeil')).toBeTruthy()
		expect(screen.queryByTestId('entete-card-sommeil')).toBeNull()
	})

	it("une saisie VIDE est envoyée telle quelle : c'est la base qui exige l'échéance", async () => {
		const { client, appels } = clientSommeil({
			status: 400,
			error: { message: 'snooze_date_required' },
			data: null,
		})
		render(<EnTeteCard card={card()} client={client} maintenant={MAINTENANT} />)
		screen.getByTestId('entete-card-endormir').click()
		await screen.findByTestId('entete-card-panneau-sommeil')
		screen.getByTestId('entete-card-sommeil-envoyer').click()
		await waitFor(() => expect(appels).toHaveLength(1))
		expect(appels[0]?.arguments['until']).toBeNull()
		expect((await screen.findByTestId('entete-card-sommeil-mention')).textContent).toContain(
			'échéance est nécessaire',
		)
	})

	it("le réveil appelle `wake_card` SANS panneau, et la pastille disparaît", async () => {
		const { client, appels } = clientSommeil({
			status: 200,
			error: null,
			data: { id: 'card-1', snoozed_until: null },
		})
		render(
			<EnTeteCard
				card={card({ snoozed_until: '2026-08-26T12:00:00+00:00' })}
				client={client}
				maintenant={MAINTENANT}
			/>,
		)
		screen.getByTestId('entete-card-reveiller').click()
		await waitFor(() => expect(appels).toHaveLength(1))
		expect(appels[0]?.nom).toBe('wake_card')
		await waitFor(() => expect(screen.queryByTestId('entete-card-sommeil')).toBeNull())
		expect(screen.getByTestId('entete-card-endormir')).toBeTruthy()
	})

	it("montre le refus d'un lecteur seul, la commande n'ayant jamais été éteinte d'avance", async () => {
		const { client } = clientSommeil({
			status: 403,
			error: { message: 'forbidden' },
			data: null,
		})
		render(<EnTeteCard card={card()} client={client} maintenant={MAINTENANT} />)
		const commande = screen.getByTestId('entete-card-endormir') as HTMLButtonElement
		expect(commande.disabled, "la règle vit dans la base, pas dans l'écran").toBe(false)
		commande.click()
		await screen.findByTestId('entete-card-panneau-sommeil')
		screen.getByTestId('entete-card-sommeil-demain').click()
		expect((await screen.findByTestId('entete-card-sommeil-mention')).textContent).toContain(
			'ne pouvez pas modifier',
		)
	})

	it('`Échap` referme le panneau sans rien envoyer', async () => {
		const { client, appels } = clientSommeil({ status: 200, error: null, data: null })
		render(<EnTeteCard card={card()} client={client} maintenant={MAINTENANT} />)
		screen.getByTestId('entete-card-endormir').click()
		fireEvent.keyDown(await screen.findByTestId('entete-card-panneau-sommeil'), { key: 'Escape' })
		await waitFor(() => expect(screen.queryByTestId('entete-card-panneau-sommeil')).toBeNull())
		expect(appels).toHaveLength(0)
	})
})
