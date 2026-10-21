// @verifies CRM-101 (docs/BACKLOG.md) — tranche T3 : l'écran de la plateforme
// @verifies docs/SPEC-plateforme.md §7.1 (accès : refus sans le drapeau, aucune lecture métier), §7.2 à §7.5 ;
//           docs/DESIGN_SYSTEM.md §5.56 (onglets-liens, tableaux, formulaires et confirmations dans le flux, suppression
//           confirmée par l'identifiant court, refus traduits, « Amorçage », attente en suspens), §5.27, §5.41, §5.50
// @verifies CLAUDE.md §10 — l'écran ne décide aucun droit : il envoie et traduit le refus de la base
// @verifies CRM-101 T6 — docs/SPEC-plateforme.md §6.5, §7.2 ; docs/DESIGN_SYSTEM.md §5.56 (onglet « Utilisateurs » :
//           recherche par nom émise au repos, liste précédente gardée, espaces en liens vers leur fiche, « Aucun
//           espace », « Jamais connecté », troncature écrite, vide nommé avec le terme, erreur avec reprise)
// @verifies CRM-103 T2 — docs/SPEC-mcp.md §8.1 et docs/DESIGN_SYSTEM.md §5.56 (onglet « Connecteur MCP » : comptes, compte
//           sans profil, recherche d'un utilisateur jamais venu, journal des appels en mots et filtré ; fiche : espace dans
//           l'adresse, « pas membre », matrice à enregistrement unique, sélecteur verrouillé tant qu'une saisie n'est pas
//           enregistrée, « Toute la famille », superadministrateur qui franchit la matrice, compte sans profil sans
//           matrice, introuvable) ; le lien « Droits du connecteur » de l'onglet « Utilisateurs »

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
	const chemin = vue === 'espace' ? '/plateforme/espaces/:slug' : vue === 'mcp-compte' ? '/plateforme/mcp/:sub' : adresse.split('?')[0] ?? adresse
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

describe('utilisateurs (§5.56, T6)', () => {
	const SABINE_U = {
		id: 'u-18',
		nom: 'Sabine Plateforme',
		cree_le: '2026-10-20T09:00:00Z',
		superadmin: true,
		espaces: [],
		connecteur_derniere_activite: '2026-10-21T08:30:00Z',
	}
	const DRISS_U = {
		id: 'u-12',
		nom: 'Driss Lemoine',
		cree_le: '2026-10-01T09:00:00Z',
		superadmin: false,
		espaces: [
			{ slug: 'atelier', nom: 'Atelier', role: 'admin' },
			{ slug: 'p2enjoy', nom: 'P2Enjoy', role: 'business_developer' },
		],
		connecteur_derniere_activite: null,
	}

	it('marque l’onglet, lit tous les utilisateurs, et rend espaces, drapeau et connecteur', async () => {
		const appels: string[] = []
		rendre('utilisateurs', '/plateforme/utilisateurs', client({ ...SUPERADMIN, plateforme_utilisateurs: () => ok([DRISS_U, SABINE_U]) }, appels))
		const lignes = await screen.findAllByTestId('ligne-utilisateur')
		expect(screen.getByRole('link', { name: 'Utilisateurs' }).getAttribute('aria-current')).toBe('page')
		const driss = lignes[0] as HTMLElement
		expect(within(driss).getByRole('link', { name: 'Atelier' }).getAttribute('href')).toBe('/plateforme/espaces/atelier')
		expect(within(driss).getByRole('link', { name: 'P2Enjoy' }).getAttribute('href')).toBe('/plateforme/espaces/p2enjoy')
		expect(within(driss).getByText('Business developer')).toBeTruthy()
		expect(within(driss).getByText('Jamais connecté')).toBeTruthy()
		expect(within(driss).queryByText('Superadministrateur')).toBeNull()
		const sabine = lignes[1] as HTMLElement
		expect(within(sabine).getByText('Aucun espace')).toBeTruthy()
		expect(within(sabine).getByText('Superadministrateur')).toBeTruthy()
		expect(sabine.textContent).not.toContain('Jamais connecté')
		expect(appels).toContain('plateforme_utilisateurs')
		expect(screen.queryByTestId('troncature-utilisateurs')).toBeNull()
	})

	it('cherche par nom au repos, garde la liste pendant la lecture, et nomme le terme quand rien ne répond', async () => {
		const utilisateur = userEvent.setup()
		const termes: unknown[] = []
		rendre(
			'utilisateurs',
			'/plateforme/utilisateurs',
			client({
				...SUPERADMIN,
				plateforme_utilisateurs: (args) => {
					termes.push(args['p_recherche'])
					return ok(args['p_recherche'] === '' ? [DRISS_U, SABINE_U] : [])
				},
			}),
		)
		await screen.findAllByTestId('ligne-utilisateur')
		await utilisateur.type(screen.getByLabelText('Rechercher un utilisateur'), 'Zoé')
		// La liste reste affichée, sous `aria-busy`, tant que la nouvelle lecture n'a pas répondu (§5.46).
		expect(screen.getAllByTestId('ligne-utilisateur')).toHaveLength(2)
		expect(screen.getByTestId('tableau-utilisateurs').closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
		// La normalisation de testing-library ramène les espaces insécables du texte rendu à des espaces ordinaires.
		expect(await screen.findByText('Aucun utilisateur ne correspond à « Zoé ».')).toBeTruthy()
		expect(termes[0]).toBe('')
		expect(termes.at(-1)).toBe('Zoé')
		expect(termes.length).toBeLessThan(4)
	})

	it('écrit la troncature à la borne, et rend l’erreur avec sa reprise', async () => {
		const pleins = Array.from({ length: 200 }, (_, i) => ({ ...DRISS_U, id: `u-${i}`, nom: `Personne ${String(i).padStart(3, '0')}` }))
		rendre('utilisateurs', '/plateforme/utilisateurs', client({ ...SUPERADMIN, plateforme_utilisateurs: () => ok(pleins) }))
		expect((await screen.findByTestId('troncature-utilisateurs')).textContent).toBe('Les 200 premiers utilisateurs\u00a0: affinez la recherche.')
		cleanup()

		const utilisateur = userEvent.setup()
		let essais = 0
		rendre(
			'utilisateurs',
			'/plateforme/utilisateurs',
			client({
				...SUPERADMIN,
				plateforme_utilisateurs: () => {
					essais += 1
					return essais === 1 ? refus('panne', 500) : ok([SABINE_U])
				},
			}),
		)
		await utilisateur.click(await screen.findByRole('button', { name: 'Réessayer' }))
		expect(await screen.findByTestId('ligne-utilisateur')).toBeTruthy()
	})
})

describe('connecteur MCP (§5.56, CRM-103 T2)', () => {
	const DRISS_MCP = { sub: 'u-12', nom: 'Driss Lemoine', email: 'driss@exemple.test', derniere_activite: '2026-10-21T08:30:00Z', espaces_ouverts: 1, superadmin: false, avec_profil: true }
	const SANS_PROFIL = { sub: 'u-x', nom: 'Sans Profil', email: 'x@exemple.test', derniere_activite: '2026-10-21T08:00:00Z', espaces_ouverts: 0, superadmin: false, avec_profil: false }
	const APPEL = { id: 9, sub: 'u-12', nom: 'Driss Lemoine', outil: 'crm_workspace_list', workspace_id: null, espace_nom: null, issue: 'refus_matrice', duree_ms: 12, cree_le: '2026-10-21T08:30:00Z' }
	const fiche = (surcharge: Record<string, unknown> = {}) => ({
		sub: 'u-y',
		nom: 'Yannick Témoin',
		email: null,
		avec_profil: true,
		connecte: false,
		derniere_activite: null,
		superadmin: false,
		espaces: [
			{ workspace_id: 'w-1', slug: 'atelier', nom: 'Atelier', role: null, droits: [] },
			{ workspace_id: 'w-2', slug: 'p2enjoy', nom: 'P2Enjoy', role: 'viewer', droits: [['affaires', 'consulter']] },
		],
		...surcharge,
	})

	it('liste les comptes, dit un compte sans profil, et rend le journal des appels en mots', async () => {
		rendre(
			'mcp',
			'/plateforme/mcp',
			client({ ...SUPERADMIN, mcp_comptes_liste: () => ok([DRISS_MCP, SANS_PROFIL]), mcp_journal_liste: () => ok([APPEL]) }),
		)
		const lignes = await screen.findAllByTestId('ligne-compte-mcp')
		expect(screen.getByRole('link', { name: 'Connecteur MCP' }).getAttribute('aria-current')).toBe('page')
		expect(within(lignes[0] as HTMLElement).getByRole('link', { name: 'Driss Lemoine' }).getAttribute('href')).toBe('/plateforme/mcp/u-12')
		expect(within(lignes[1] as HTMLElement).getByText('Sans profil dans le CRM')).toBeTruthy()
		const appel = await screen.findByTestId('ligne-appel')
		expect(within(appel).getByText('Refusé par la matrice')).toBeTruthy()
		expect(within(appel).getByText('crm_workspace_list').tagName).toBe('CODE')
	})

	it('filtre le journal par issue, et cherche un utilisateur jamais venu pour ouvrir sa fiche', async () => {
		const utilisateur = userEvent.setup()
		const issues: unknown[] = []
		rendre(
			'mcp',
			'/plateforme/mcp',
			client({
				...SUPERADMIN,
				mcp_comptes_liste: () => ok([]),
				mcp_journal_liste: (args) => {
					issues.push(args['p_issue'])
					return ok([])
				},
				plateforme_utilisateurs: () => ok([{ id: 'u-y', nom: 'Yannick Témoin', cree_le: '2026-10-21T08:00:00Z', superadmin: false, espaces: [], connecteur_derniere_activite: null }]),
			}),
		)
		expect(await screen.findByText('Personne n’est encore venu au connecteur.')).toBeTruthy()
		await utilisateur.selectOptions(await screen.findByTestId('filtre-issue'), 'refus_crm')
		await waitFor(() => expect(issues.at(-1)).toBe('refus_crm'))
		expect(await screen.findByText('Aucun appel avec cette issue.')).toBeTruthy()
		await utilisateur.type(screen.getByTestId('recherche-accorder'), 'Yan')
		const lien = await screen.findByRole('link', { name: 'Yannick Témoin' })
		expect(lien.getAttribute('href')).toBe('/plateforme/mcp/u-y')
		expect(within(screen.getByTestId('resultats-accorder')).getByText('Jamais connecté')).toBeTruthy()
	})

	it('la fiche : espace de l’adresse, « pas membre », saisie qui verrouille le sélecteur, matrice envoyée entière', async () => {
		const utilisateur = userEvent.setup()
		const envois: unknown[] = []
		rendre(
			'mcp-compte',
			'/plateforme/mcp/u-y?espace=atelier',
			client({
				...SUPERADMIN,
				mcp_compte: () => ok(fiche()),
				mcp_poser_droits: (args) => {
					envois.push(args)
					return ok(null)
				},
			}),
		)
		expect(await screen.findByText('Jamais connecté au connecteur\u00a0: ces droits vaudront dès sa première connexion.', { normalizer: (s) => s })).toBeTruthy()
		expect(screen.getByTestId('fiche-mcp-hors-espace')).toBeTruthy()
		const choix = screen.getByTestId('choix-espace-mcp') as HTMLSelectElement
		expect(choix.value).toBe('atelier')
		expect(screen.getByRole('button', { name: 'Enregistrer les droits' })).toHaveProperty('disabled', true)

		await utilisateur.click(screen.getByRole('button', { name: 'Cocher toute la famille Affaires' }))
		await utilisateur.click(screen.getByRole('checkbox', { name: /^Structure\s:\sconsulter$/u }))
		expect(screen.getByText('Modifications non enregistrées')).toBeTruthy()
		expect(choix.disabled).toBe(true)
		expect(screen.getByRole('button', { name: 'Décocher toute la famille Affaires' })).toBeTruthy()
		await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer les droits' }))
		expect(await screen.findByText('Droits enregistrés.')).toBeTruthy()
		expect(envois[0]).toEqual({
			p_sub: 'u-y',
			p_ws: 'w-1',
			p_droits: [['structure', 'consulter'], ['affaires', 'consulter'], ['affaires', 'ajouter'], ['affaires', 'modifier'], ['affaires', 'supprimer']],
		})
	})

	it('la fiche : un refus est traduit et la saisie gardée ; « Annuler » rend l’état enregistré', async () => {
		const utilisateur = userEvent.setup()
		rendre(
			'mcp-compte',
			'/plateforme/mcp/u-y?espace=p2enjoy',
			client({ ...SUPERADMIN, mcp_compte: () => ok(fiche()), mcp_poser_droits: () => refus('droit_invalide', 400) }),
		)
		expect((await screen.findByTestId('fiche-mcp-role')).textContent).toContain('Lecteur')
		const caseConsulter = screen.getByRole('checkbox', { name: /^Affaires\s:\sconsulter$/u }) as HTMLInputElement
		expect(caseConsulter.checked).toBe(true)
		await utilisateur.click(caseConsulter)
		await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer les droits' }))
		expect((await screen.findByTestId('message-mcp')).getAttribute('role')).toBe('alert')
		expect(caseConsulter.checked).toBe(false)
		await utilisateur.click(screen.getByRole('button', { name: 'Annuler les modifications' }))
		expect(caseConsulter.checked).toBe(true)
	})

	it('un superadministrateur franchit la matrice : cases lisibles et désactivées ; un compte sans profil n’a pas de matrice', async () => {
		rendre('mcp-compte', '/plateforme/mcp/u-y', client({ ...SUPERADMIN, mcp_compte: () => ok(fiche({ superadmin: true })) }))
		expect(await screen.findByTestId('fiche-mcp-franchie')).toBeTruthy()
		expect((screen.getByRole('checkbox', { name: /^Temps\s:\ssupprimer$/u }) as HTMLInputElement).disabled).toBe(true)
		cleanup()

		rendre('mcp-compte', '/plateforme/mcp/u-x', client({ ...SUPERADMIN, mcp_compte: () => ok(fiche({ sub: 'u-x', avec_profil: false, connecte: true, email: 'x@exemple.test', derniere_activite: '2026-10-21T08:00:00Z' })), mcp_journal_liste: () => ok([]) }))
		expect(await screen.findByTestId('fiche-mcp-sans-profil')).toBeTruthy()
		expect(screen.queryByTestId('matrice-mcp')).toBeNull()
		cleanup()

		rendre('mcp-compte', '/plateforme/mcp/inconnu', client({ ...SUPERADMIN, mcp_compte: () => refus('profil_introuvable', 404) }))
		expect(await screen.findByText('Utilisateur introuvable')).toBeTruthy()
		expect(screen.getByRole('link', { name: 'Tous les comptes du connecteur' }).getAttribute('href')).toBe('/plateforme/mcp')
	})

	it('l’onglet « Utilisateurs » mène aux droits du connecteur de chaque personne', async () => {
		rendre(
			'utilisateurs',
			'/plateforme/utilisateurs',
			client({ ...SUPERADMIN, plateforme_utilisateurs: () => ok([{ id: 'u-y', nom: 'Yannick Témoin', cree_le: '2026-10-21T08:00:00Z', superadmin: false, espaces: [], connecteur_derniere_activite: null }]) }),
		)
		const lien = await screen.findByRole('link', { name: 'Droits du connecteur de Yannick Témoin' })
		expect(lien.getAttribute('href')).toBe('/plateforme/mcp/u-y')
	})
})
