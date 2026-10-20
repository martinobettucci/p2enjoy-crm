// @verifies CRM-101 (docs/BACKLOG.md) — tranche T3 : l'écran de la plateforme
// @verifies docs/SPEC-plateforme.md §7.1 (accès : refus sans le drapeau, aucune lecture métier), §7.2 à §7.5 ;
//           docs/DESIGN_SYSTEM.md §5.56 (onglets-liens, tableaux, formulaires et confirmations dans le flux, suppression
//           confirmée par l'identifiant court, refus traduits, « Amorçage », attente en suspens), §5.27, §5.41, §5.50
// @verifies CLAUDE.md §10 — l'écran ne décide aucun droit : il envoie et traduit le refus de la base

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClientCrm } from '../lib/supabase'
import { Plateforme, type VuePlateforme } from './Plateforme'

afterEach(cleanup)

type Reponse = { readonly data: unknown; readonly error: { readonly message: string } | null; readonly status: number }
type Gestionnaire = (args: Record<string, unknown>) => Reponse
const ok = (data: unknown): Reponse => ({ data, error: null, status: 200 })
const refus = (message: string, status = 400): Reponse => ({ data: null, error: { message }, status })

function client(gestionnaires: Readonly<Record<string, Gestionnaire>>, appels: string[] = []): ClientCrm {
	return {
		rpc: (nom: string, args: Record<string, unknown>) => {
			appels.push(nom)
			const gestionnaire = gestionnaires[nom]
			return Promise.resolve(gestionnaire === undefined ? refus('non_simule', 500) : gestionnaire(args))
		},
	} as unknown as ClientCrm
}

const ESPACE_ATELIER = { id: 'w-2', nom: 'Atelier', slug: 'atelier', domaine_entrant: null, membres: 1, administrateurs: 1, attentes: 0 }
const ESPACE_VIDE = { id: 'w-3', nom: 'Neuf', slug: 'neuf', domaine_entrant: 'crm.neuf.test', membres: 0, administrateurs: 0, attentes: 1 }
const DRISS = { user_id: 'u-12', nom: 'Driss Lemoine', role: 'admin', superadmin: false, depuis: '2026-10-20T09:00:00Z' }

function Lieu() {
	const location = useLocation()
	return <output data-testid="lieu">{`${location.pathname}|${JSON.stringify(location.state ?? null)}`}</output>
}

function rendre(vue: VuePlateforme, adresse: string, c: ClientCrm) {
	const chemin = vue === 'espace' ? '/plateforme/espaces/:slug' : adresse
	return render(
		<MemoryRouter initialEntries={[adresse]}>
			<Routes>
				<Route path={chemin} element={<Plateforme vue={vue} client={c} />} />
				<Route path="*" element={<Lieu />} />
			</Routes>
			<Lieu />
		</MemoryRouter>,
	)
}

const SUPERADMIN = { est_superadmin: () => ok(true) }

describe('accès (§7.1)', () => {
	it('rend le refus sans le drapeau, et n’émet AUCUNE lecture de la plateforme', async () => {
		const appels: string[] = []
		rendre('espaces', '/plateforme/espaces', client({ est_superadmin: () => ok(false) }, appels))
		expect(await screen.findByTestId('etat-refus')).toBeTruthy()
		expect(appels).toEqual(['est_superadmin'])
	})

	it('marque l’onglet « Espaces » sur la fiche d’un espace, par `aria-current`', async () => {
		rendre(
			'espace',
			'/plateforme/espaces/atelier',
			client({ ...SUPERADMIN, plateforme_espaces: () => ok([ESPACE_ATELIER]), plateforme_membres: () => ok([DRISS]), plateforme_attentes: () => ok([]) }),
		)
		const nav = await screen.findByRole('navigation', { name: 'Sections de la plateforme' })
		expect(within(nav).getByRole('link', { name: 'Espaces' }).getAttribute('aria-current')).toBe('page')
		expect(within(nav).getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBeNull()
	})
})

describe('espaces (§5.56)', () => {
	it('liste les espaces et nomme celui qui n’a aucun administrateur, par un mot', async () => {
		rendre('espaces', '/plateforme/espaces', client({ ...SUPERADMIN, plateforme_espaces: () => ok([ESPACE_ATELIER, ESPACE_VIDE]) }))
		const lignes = await screen.findAllByTestId('ligne-espace')
		expect(lignes).toHaveLength(2)
		expect(within(lignes[1] as HTMLElement).getByText('Aucun administrateur')).toBeTruthy()
		expect(within(lignes[0] as HTMLElement).queryByText('Aucun administrateur')).toBeNull()
	})

	it('l’état vide porte le geste de création', async () => {
		rendre('espaces', '/plateforme/espaces', client({ ...SUPERADMIN, plateforme_espaces: () => ok([]) }))
		const vide = await screen.findByTestId('etat-vide')
		expect(within(vide).getByRole('button', { name: 'Nouvel espace' })).toBeTruthy()
	})

	it('« Créer » reste éteint tant qu’un champ requis est blanc ; un refus est traduit et la saisie conservée', async () => {
		const utilisateur = userEvent.setup()
		rendre(
			'espaces',
			'/plateforme/espaces',
			client({ ...SUPERADMIN, plateforme_espaces: () => ok([ESPACE_ATELIER]), plateforme_creer_espace: () => refus('identifiant_pris', 409) }),
		)
		await utilisateur.click(await screen.findByRole('button', { name: 'Nouvel espace' }))
		const creer = screen.getByRole('button', { name: 'Créer' })
		expect((creer as HTMLButtonElement).disabled).toBe(true)
		expect(document.activeElement?.id).toBe('espace-nom')
		await utilisateur.type(screen.getByLabelText('Nom'), 'Atelier bis')
		await utilisateur.type(screen.getByLabelText('Identifiant court'), 'atelier')
		await utilisateur.click(screen.getByRole('button', { name: 'Créer' }))
		expect((await screen.findByTestId('refus-espace')).textContent).toContain('déjà employé')
		expect((screen.getByLabelText('Identifiant court') as HTMLInputElement).value).toBe('atelier')
	})

	it('un succès ouvre la fiche du nouvel espace', async () => {
		const utilisateur = userEvent.setup()
		rendre(
			'espaces',
			'/plateforme/espaces',
			client({ ...SUPERADMIN, plateforme_espaces: () => ok([ESPACE_ATELIER]), plateforme_creer_espace: () => ok('w-9') }),
		)
		await utilisateur.click(await screen.findByRole('button', { name: 'Nouvel espace' }))
		await utilisateur.type(screen.getByLabelText('Nom'), 'Studio')
		await utilisateur.type(screen.getByLabelText('Identifiant court'), 'studio')
		await utilisateur.click(screen.getByRole('button', { name: 'Créer' }))
		await waitFor(() => expect(screen.getAllByTestId('lieu')[0]?.textContent).toContain('/plateforme/espaces/studio'))
	})
})

describe('fiche d’un espace (§5.56)', () => {
	const fiche = (extra: Readonly<Record<string, Gestionnaire>> = {}, membres = [DRISS], attentes: unknown[] = [], espace = ESPACE_ATELIER) =>
		client({
			...SUPERADMIN,
			plateforme_espaces: () => ok([espace]),
			plateforme_membres: () => ok(membres),
			plateforme_attentes: () => ok(attentes),
			...extra,
		})

	it('écrit le rôle au choix et lit le refus du dernier administrateur SOUS le tableau', async () => {
		const utilisateur = userEvent.setup()
		rendre('espace', '/plateforme/espaces/atelier', fiche({ plateforme_poser_membre: () => refus('last_workspace_admin') }))
		await utilisateur.selectOptions(await screen.findByLabelText('Rôle de Driss Lemoine'), 'viewer')
		expect((await screen.findByTestId('message-membres')).textContent).toContain('au moins un administrateur')
		await waitFor(() => expect((screen.getByLabelText('Rôle de Driss Lemoine') as HTMLSelectElement).value).toBe('admin'))
	})

	it('retirer un membre ouvre une confirmation sur une ligne à elle ; `Échap` la referme et rend le focus', async () => {
		const utilisateur = userEvent.setup()
		rendre('espace', '/plateforme/espaces/atelier', fiche())
		const commande = await screen.findByRole('button', { name: 'Retirer Driss Lemoine de l’espace' })
		await utilisateur.click(commande)
		expect(screen.getByText(/Retirer Driss Lemoine de l’espace/u, { selector: 'p' })).toBeTruthy()
		expect((commande as HTMLButtonElement).disabled).toBe(true)
		await utilisateur.keyboard('{Escape}')
		expect(screen.queryByText(/Ses droits fins/u)).toBeNull()
		expect(document.activeElement).toBe(commande)
	})

	it('dit qu’une attente est en suspens dans un espace sans administrateur, et la retire sans confirmation', async () => {
		const utilisateur = userEvent.setup()
		const appels: string[] = []
		const c = client(
			{
				...SUPERADMIN,
				plateforme_espaces: () => ok([ESPACE_VIDE]),
				plateforme_membres: () => ok([]),
				plateforme_attentes: () => ok([{ email: 'lea@exemple.test', role: 'viewer', invite_par: null, depuis: '2026-10-20T09:00:00Z' }]),
				plateforme_retirer_attente: () => ok(null),
			},
			appels,
		)
		rendre('espace', '/plateforme/espaces/neuf', c)
		expect(await screen.findByRole('img', { name: /En suspens/u })).toBeTruthy()
		expect(screen.getByTestId('bandeau-sans-admin')).toBeTruthy()
		expect(screen.getByText('Auteur inconnu')).toBeTruthy()
		await utilisateur.click(screen.getByRole('button', { name: 'Retirer l’attente de lea@exemple.test' }))
		await waitFor(() => expect(appels).toContain('plateforme_retirer_attente'))
		expect((await screen.findByTestId('message-attentes')).textContent).toContain('retirée')
	})

	it('la suppression reste éteinte jusqu’à la saisie exacte de l’identifiant, puis quitte la fiche pour la liste', async () => {
		const utilisateur = userEvent.setup()
		rendre('espace', '/plateforme/espaces/atelier', fiche({ plateforme_supprimer_espace: () => ok(null) }))
		await utilisateur.click(await screen.findByTestId('supprimer-espace'))
		const confirmer = screen.getByRole('button', { name: 'Supprimer définitivement' })
		expect((confirmer as HTMLButtonElement).disabled).toBe(true)
		await utilisateur.type(screen.getByLabelText(/Saisissez/u), 'Atelier')
		expect((confirmer as HTMLButtonElement).disabled).toBe(true)
		await utilisateur.clear(screen.getByLabelText(/Saisissez/u))
		await utilisateur.type(screen.getByLabelText(/Saisissez/u), 'atelier')
		expect((confirmer as HTMLButtonElement).disabled).toBe(false)
		await utilisateur.click(confirmer)
		await waitFor(() => expect(screen.getAllByTestId('lieu')[0]?.textContent).toBe('/plateforme/espaces|{"espaceSupprime":"Atelier"}'))
	})

	it('un espace inconnu rend « Espace introuvable » et son lien de retour', async () => {
		rendre('espace', '/plateforme/espaces/inconnu', fiche())
		expect(await screen.findByText('Espace introuvable')).toBeTruthy()
		expect(screen.getByRole('link', { name: 'Revenir aux espaces' })).toBeTruthy()
	})
})

describe('superadministrateurs et journal (§5.56)', () => {
	it('écrit « Amorçage » pour un drapeau amorcé, et traduit le refus du dernier superadministrateur', async () => {
		const utilisateur = userEvent.setup()
		rendre(
			'superadmins',
			'/plateforme/superadmins',
			client({
				...SUPERADMIN,
				plateforme_superadmins: () => ok([{ sub: 'u-18', nom: 'Sabine Plateforme', accorde_par_nom: null, accorde_le: '2026-10-20T09:00:00Z' }]),
				plateforme_poser_superadmin: () => refus('dernier_superadministrateur', 400),
			}),
		)
		const ligne = await screen.findByTestId('ligne-superadmin')
		expect(within(ligne).getByText('Amorçage')).toBeTruthy()
		await utilisateur.click(screen.getByRole('button', { name: 'Retirer le drapeau de Sabine Plateforme' }))
		await utilisateur.click(screen.getByRole('button', { name: 'Retirer le drapeau' }))
		expect((await screen.findByTestId('message-superadmins')).textContent).toContain('au moins un superadministrateur')
	})

	it('rend le journal en mots, le détail par clé, et ne propose la suite que sur une page pleine', async () => {
		rendre(
			'journal',
			'/plateforme/journal',
			client({
				...SUPERADMIN,
				plateforme_journal_liste: () =>
					ok([
						{ id: 2, acteur_nom: 'Sabine Plateforme', geste: 'espace_cree', workspace_id: 'w-2', cible: { nom: 'Atelier', slug: 'atelier' }, cree_le: '2026-10-20T10:00:00Z' },
						{ id: 1, acteur_nom: null, geste: 'superadmin_amorce', workspace_id: null, cible: { nom: 'Sabine Plateforme' }, cree_le: '2026-10-20T09:00:00Z' },
						{ id: 0, acteur_nom: null, geste: 'geste_inconnu', workspace_id: null, cible: {}, cree_le: '2026-10-20T08:00:00Z' },
					]),
			}),
		)
		const lignes = await screen.findAllByTestId('ligne-journal')
		expect(within(lignes[0] as HTMLElement).getByText('Espace créé')).toBeTruthy()
		expect(within(lignes[0] as HTMLElement).getByText('Atelier (atelier)')).toBeTruthy()
		expect(within(lignes[1] as HTMLElement).getByText('Amorçage')).toBeTruthy()
		expect(lignes[2]?.textContent).not.toContain('geste_inconnu')
		expect(screen.queryByTestId('journal-suite')).toBeNull()
	})
})
