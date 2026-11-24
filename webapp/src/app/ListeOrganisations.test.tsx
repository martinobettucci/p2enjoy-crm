// @verifies CRM-114 (docs/BACKLOG.md) — tranche T2 : l'onglet « Organisations » du carnet, monté pour de vrai
// @verifies docs/SPEC-organisations.md §2 à §4 ; docs/DESIGN_SYSTEM.md §5.64 (tableau, commande et formulaire qui
//           s'excluent, fiche ouverte après la création, refus dans le formulaire), §5.59 (commande éteinte avec le
//           motif), §5.8 (états)
// @verifies CRM-146 (docs/BACKLOG.md) — tranche T2 : la colonne « Réel sur prévu », et les deux lectures attendues
//           ensemble — un échec de l'une rend l'erreur de l'onglet, « Réessayer » relit les deux (docs/SPEC-recettes.md
//           §12.4 ; docs/DESIGN_SYSTEM.md §5.97)
// @verifies CRM-152 (docs/BACKLOG.md) — tranche T2 : la colonne « Tracks » après « Nom » ; « Rechercher » à la frappe
//           (300 ms, un seul appel) ; le panneau « Tracks » (cocher filtre, « Tracks (1) », `Échap` rend le focus) ;
//           « Recettes » ; « Effacer les filtres » jamais en double ; le tri par « Nom » et « Contacts » avec `aria-sort` ;
//           « Afficher plus », « 2 sur 3 », l'annonce, le focus, l'échec et sa reprise ; l'adresse lue et écrite, un track
//           inconnu replié ; une relecture qui garde les lignes ; le vide sous les filtres (docs/SPEC-organisations.md
//           §8.2, §8.3 ; docs/DESIGN_SYSTEM.md §5.105 ; docs/JOURNAL.md décision 936)
// @verifies CRM-153 (docs/BACKLOG.md) — tranche T4 : les catégories sous le nom (trois au plus, puis « +n » qui énumère
//           les autres) ; le filtre « Catégories » (rendu seulement avec un catalogue, cocher filtre aussitôt, `categories=`
//           dans l'adresse, l'archivée suffixée, une catégorie inconnue retirée) ; un seul panneau à la fois
//           (docs/SPEC-organisations.md §9.3 ; docs/DESIGN_SYSTEM.md §5.107 ; décision 942). Le double est RÉVISÉ le
//           2026-11-18 : il sert les poses (`.in()`) et le catalogue des catégories.
// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.c : rien pour une personne d'un seul espace (la liste d'avant, son
//           espace en `p_workspace_id`) ; à partir de deux, tous les espaces lus, la colonne « Espace » la dernière, la
//           création dite ; le filtre « Espace » par la lecture (`p_workspace_ids`, la première page relue) ; un seul des
//           trois panneaux ouvert ; les cases « Tracks » et « Catégories » des espaces de la portée, groupées par espace ;
//           le vide sous le filtre (docs/SPEC-espace-courant.md §16.8.3 ; docs/DESIGN_SYSTEM.md §5.115, §5.28). Le double
//           est RÉVISÉ le 2026-11-24 : il note les `.in()` de chaque table et rend des tracks donnés.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ListeOrganisations } from './ListeOrganisations'
import { FournisseurEspace } from './ContexteEspace'
import { fr } from '../i18n'
import type { Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const FORMATION = '5eed0000-0000-4000-8000-000000000023'
const TRACKS = [
	{ id: CONSEIL, name: 'Conseil IA', slug: 'conseil-ia', color: 'brand', icon: 'Brain', position: 1, description: null },
	{ id: FORMATION, name: 'Formation', slug: 'formation', color: 'success', icon: 'GraduationCap', position: 2, description: null },
]

type Ligne = { id: string; name: string; domain: string | null; website: string | null; contacts: number; has_revenues: boolean }
const COMPTOIR: Ligne = { id: 'o1', name: 'Comptoir Vasseur', domain: 'comptoir-vasseur.example', website: null, contacts: 0, has_revenues: false }
const SOGEXIA: Ligne = { id: 'o2', name: 'Sogexia', domain: 'sogexia.example', website: 'https://www.sogexia.example', contacts: 1, has_revenues: true }
const VERTIGO: Ligne = { id: 'o3', name: 'Vertigo Conseil', domain: null, website: null, contacts: 4, has_revenues: true }

type Reponse = { data?: unknown; error?: { code?: string; message: string } | null; status?: number }
type Args = Record<string, unknown>
type Liste = (args: Args, rang: number) => Reponse | 'jamais'

const TOTAL_SOGEXIA = {
	organization_id: 'o2', currency: 'EUR', estimated_total: 72000, actual_total: null,
	cards: 1, shared_cards: 0, revenue_lines: 1, lines_without_actual: 1,
}

/** La liste répond par décalage, comme la base : `toutes` paginées par `p_limit`, le total compté au-delà. */
const pagineeDans = (toutes: readonly Ligne[]): Liste => (args) => {
	const debut = Number(args['p_offset'] ?? 0)
	const fin = debut + Number(args['p_limit'] ?? 50)
	return { data: toutes.slice(debut, fin).map((l) => ({ ...l, total_count: toutes.length })) }
}

function double({
	liste = pagineeDans([COMPTOIR, SOGEXIA]) as Liste,
	insertion = { data: [{ id: 'neuve' }], status: 201 } as Reponse,
	totaux = [{ data: [TOTAL_SOGEXIA] }] as (Reponse | 'jamais')[],
	tracksDe = { o2: [CONSEIL], o3: [CONSEIL, FORMATION] } as Record<string, string[]>,
	catalogue = [] as readonly { id: string; name: string; color: string; archived_at: string | null; workspace_id?: string }[],
	categoriesDe = {} as Record<string, string[]>,
	tracks = TRACKS as readonly object[],
} = {}) {
	const ecritures: unknown[] = []
	const appelsTotaux: unknown[] = []
	const appelsListe: Args[] = []
	const appelsIn: [string, string, unknown][] = []
	const chaine = (r: Reponse, table = '') => {
		const c: Record<string, unknown> = {
			select: () => c, order: () => c, eq: () => c, is: () => c,
			in: (colonne: string, valeurs: unknown) => { appelsIn.push([table, colonne, valeurs]); return c },
			then: (resoudre: (v: unknown) => unknown) =>
				Promise.resolve({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 }).then(resoudre),
		}
		return c
	}
	const repondre = (r: Reponse | 'jamais' | undefined) =>
		r === 'jamais' || r === undefined
			? new Promise(() => {})
			: Promise.resolve({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 })
	const client = {
		from: (table: string) => ({
			select: () => chaine(
				table === 'workspaces'
					? { data: [{ id: 'ws', name: 'P2Enjoy', slug: 'p2enjoy' }] }
					: table === 'tracks'
						? { data: tracks }
						: table === 'organization_categories'
							? { data: catalogue }
							: table === 'organization_category_links'
								? {
										data: Object.entries(categoriesDe).flatMap(([o, ids]) =>
											ids.map((id) => ({ organization_id: o, categorie: catalogue.find((c) => c.id === id) ?? null })),
										),
									}
								: { data: [] },
				table,
			),
			insert: (charge: unknown) => { ecritures.push(charge); return chaine(insertion) },
		}),
		rpc: (nom: string, args: Args) => {
			if (nom === 'organization_list') {
				appelsListe.push(args)
				return repondre(liste(args, appelsListe.length - 1))
			}
			if (nom === 'organization_tracks') {
				const ids = args['p_organization_ids'] as string[]
				return repondre({ data: ids.flatMap((o) => (tracksDe[o] ?? []).map((id) => {
					const track = TRACKS.find((t) => t.id === id)!
					return { organization_id: o, track_id: id, name: track.name, slug: track.slug, color: track.color, icon: track.icon }
				})) })
			}
			// `CRM-146` : les totaux, lus à côté de la première page (docs/SPEC-recettes.md §12.4).
			appelsTotaux.push([nom, args])
			return repondre(totaux[Math.min(appelsTotaux.length - 1, totaux.length - 1)])
		},
	} as unknown as ClientCrm
	return { client, ecritures, appelsTotaux, appelsListe, appelsIn }
}

/** L'adresse courante, rendue pour que le test la lise. */
function Adresse() {
	const { search } = useLocation()
	return <output data-testid="adresse">{search}</output>
}

// `CRM-161` T3.c : une personne de deux espaces, par nom (l'ordre du menu, §5.113) ; « ws » est l'espace de l'onglet.
const P2ENJOY = { id: 'ws', name: 'P2Enjoy', slug: 'p2enjoy' }
const LUMEN = { id: 'ws-l', name: 'Studio Lumen', slug: 'studio-lumen' }
type Espace = { readonly id: string; readonly name: string; readonly slug: string }

function monter(
	client: ClientCrm,
	{ edition = 'permise' as Capacite, adresse = '/contacts/organisations', espaces = undefined as readonly Espace[] | undefined } = {},
) {
	render(
		<MemoryRouter initialEntries={[adresse]}>
			<FournisseurEspace
				valeur={{ idWorkspace: 'ws', estAdmin: false, capacites: { administration: 'refusee', edition }, ...(espaces === undefined ? {} : { espaces }) }}
			>
				<Routes>
					<Route path="/contacts/organisations" element={<><ListeOrganisations client={client} /><Adresse /></>} />
					<Route path="/contacts/organisations/:id" element={<p data-testid="fiche-ouverte">fiche</p>} />
				</Routes>
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

const adresse = () => new URLSearchParams(screen.getByTestId('adresse').textContent ?? '')
const derniers = (appels: Args[]) => appels[appels.length - 1] ?? {}

describe('l’onglet « Organisations » (docs/DESIGN_SYSTEM.md §5.64, §5.105)', () => {
	// RÉVISÉE par `CRM-152` T2 : cinq colonnes devenues six, « Tracks » après « Nom ». RÉVISÉE par `CRM-152` (décision 940) :
	// « Domaine » et « Site web » partagent une cellule, sur deux lignes — cinq colonnes ; le compte des contacts est lu dans
	// SA cellule, la quatrième.
	it('rend un tableau à cinq colonnes ; le nom est le seul lien, zéro contact s’écrit 0, les tracks par « · »', async () => {
		monter(double({ liste: pagineeDans([COMPTOIR, SOGEXIA, VERTIGO]) }).client)
		const lignes = await screen.findAllByTestId('ligne-organisation')
		expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
			fr['organizations.table.name'], fr['organizations.table.tracks'], fr['organizations.table.web'],
			fr['organizations.table.contacts'], fr['organizations.table.revenues'],
		])
		expect(within(lignes[0] as HTMLElement).getAllByRole('link').map((l) => l.textContent)).toEqual(['Comptoir Vasseur'])
		expect((lignes[0] as HTMLElement).children[3]?.textContent).toBe('0')
		const tracks = within(lignes[2] as HTMLElement).getByTestId('cellule-tracks')
		expect(tracks.textContent).toBe('Conseil IA · Formation')
		expect(tracks.getAttribute('title')).toBe('Conseil IA · Formation')
		// Sans track, la cellule est vide, sans `title` (§5.9).
		expect(within(lignes[0] as HTMLElement).getByTestId('cellule-tracks').textContent).toBe('')
		expect(within(lignes[0] as HTMLElement).getByTestId('cellule-tracks').hasAttribute('title')).toBe(false)
	})

	it('le domaine et le site web partagent une cellule, chacun sur sa ligne et entier en `title` (décision 940)', async () => {
		monter(double().client)
		const lignes = await screen.findAllByTestId('ligne-organisation')
		const sogexia = within(lignes[1] as HTMLElement).getByTestId('cellule-web')
		expect(within(sogexia).getByTestId('domaine-organisation').textContent).toBe('sogexia.example')
		expect(within(sogexia).getByTestId('site-organisation').getAttribute('title')).toBe('https://www.sogexia.example')
		// Sans site, la ligne du site n'est pas rendue ; le tableau a des colonnes de largeur fixe.
		expect(within(within(lignes[0] as HTMLElement).getByTestId('cellule-web')).queryByTestId('site-organisation')).toBeNull()
		expect(screen.getByTestId('tableau-organisations').className).toContain('table-fixed')
	})

	it('la première page : cinquante, par nom ascendant, dans l’espace ; « Réel sur prévu » de l’organisation à recettes', async () => {
		const { client, appelsTotaux, appelsListe } = double()
		monter(client)
		const lignes = await screen.findAllByTestId('ligne-organisation')
		expect(appelsListe[0]).toMatchObject({ p_workspace_id: 'ws', p_revenues: 'all', p_sort: 'name', p_descending: false, p_limit: 50, p_offset: 0 })
		expect(appelsTotaux).toEqual([['organization_revenue_totals', {}]])
		expect((lignes[0] as HTMLElement).children[4]?.textContent).toBe('')
		expect(within(lignes[1] as HTMLElement).getByTestId('reel-sur-prevu').textContent).toContain('Rien de saisi sur')
	})

	it('attend les deux lectures : la liste lue seule ne s’affiche pas sans ses totaux', async () => {
		monter(double({ totaux: ['jamais'] }).client)
		expect(await screen.findByLabelText(fr['state.loading.aria'])).toBeTruthy()
		expect(screen.queryByTestId('tableau-organisations')).toBeNull()
	})

	it('un échec des totaux rend l’erreur de l’onglet, et « Réessayer » relit les deux', async () => {
		const { client, appelsTotaux, appelsListe } = double({ totaux: [{ error: { message: 'boom' }, status: 500 }, { data: [TOTAL_SOGEXIA] }] })
		monter(client)
		await userEvent.click(await screen.findByRole('button', { name: fr['organizations.error.retry'] }))
		expect(await screen.findAllByTestId('ligne-organisation')).toHaveLength(2)
		expect(appelsTotaux).toHaveLength(2)
		expect(appelsListe).toHaveLength(2)
	})

	it('l’état vide de l’espace garde la commande, sans barre ni tableau', async () => {
		monter(double({ liste: pagineeDans([]) }).client)
		expect(await screen.findByText(fr['organizations.empty.title'])).toBeTruthy()
		expect(screen.getByTestId('ouvrir-creation-organisation')).toBeTruthy()
		expect(screen.queryByTestId('filtres-organisations')).toBeNull()
	})

	it('« Rechercher » suit la frappe après 300 ms, en UN appel, et l’écrit dans l’adresse', async () => {
		const { client, appelsListe } = double()
		monter(client)
		await screen.findAllByTestId('ligne-organisation')
		await userEvent.type(screen.getByRole('searchbox', { name: fr['organizations.filter.search'] }), 'sog')
		expect(appelsListe).toHaveLength(1)
		await waitFor(() => expect(appelsListe).toHaveLength(2))
		expect(derniers(appelsListe)).toMatchObject({ p_search: 'sog', p_offset: 0 })
		expect(adresse().get('q')).toBe('sog')
		await new Promise((r) => setTimeout(r, 400))
		expect(appelsListe).toHaveLength(2)
	})

	it('« Tracks » déplie ses cases ; cocher filtre aussitôt, le bouton dit le nombre, `Échap` replie et rend le focus', async () => {
		const { client, appelsListe } = double()
		monter(client)
		await screen.findAllByTestId('ligne-organisation')
		const bouton = screen.getByTestId('ouvrir-filtre-tracks')
		expect(bouton.getAttribute('aria-expanded')).toBe('false')
		await userEvent.click(bouton)
		expect(bouton.getAttribute('aria-expanded')).toBe('true')
		const panneau = screen.getByTestId('panneau-filtre-tracks')
		expect(bouton.getAttribute('aria-controls')).toBe(panneau.id)
		expect(within(panneau).getAllByRole('checkbox').map((c) => c.getAttribute('data-slug'))).toEqual(['conseil-ia', 'formation'])
		await userEvent.click(within(panneau).getByRole('checkbox', { name: 'Formation' }))
		await waitFor(() => expect(derniers(appelsListe)).toMatchObject({ p_track_ids: [FORMATION] }))
		expect(bouton.textContent).toBe('Tracks (1)')
		expect(adresse().get('tracks')).toBe(FORMATION)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('panneau-filtre-tracks')).toBeNull()
		expect(document.activeElement).toBe(bouton)
	})

	it('« Recettes » filtre ; « Effacer les filtres » paraît, efface et garde le tri', async () => {
		const { client, appelsListe } = double()
		monter(client, { adresse: '/contacts/organisations?tri=contacts' })
		await screen.findAllByTestId('ligne-organisation')
		expect(screen.queryByTestId('effacer-filtres-organisations')).toBeNull()
		await userEvent.selectOptions(screen.getByRole('combobox', { name: fr['organizations.filter.revenues'] }), 'avec')
		await waitFor(() => expect(derniers(appelsListe)).toMatchObject({ p_revenues: 'with', p_sort: 'contacts' }))
		expect(adresse().get('recettes')).toBe('avec')
		await userEvent.click(screen.getByTestId('effacer-filtres-organisations'))
		await waitFor(() => expect(derniers(appelsListe)).toMatchObject({ p_revenues: 'all', p_sort: 'contacts' }))
		expect(adresse().toString()).toBe('tri=contacts')
		expect(screen.queryByTestId('effacer-filtres-organisations')).toBeNull()
	})

	it('le tri : « Contacts » ascendant puis descendant, `aria-sort` sur la seule colonne triée ; « Tracks » ne se trie pas', async () => {
		const { client, appelsListe } = double()
		monter(client)
		await screen.findAllByTestId('ligne-organisation')
		const entetes = () => screen.getAllByTestId('entete-triable-organisations')
		expect(entetes().map((e) => [e.dataset['cle'], e.getAttribute('aria-sort')])).toEqual([['nom', 'ascending'], ['contacts', 'none']])
		await userEvent.click(within(entetes()[1] as HTMLElement).getByRole('button'))
		await waitFor(() => expect(derniers(appelsListe)).toMatchObject({ p_sort: 'contacts', p_descending: false }))
		await userEvent.click(within(entetes()[1] as HTMLElement).getByRole('button'))
		await waitFor(() => expect(derniers(appelsListe)).toMatchObject({ p_sort: 'contacts', p_descending: true }))
		expect(entetes().map((e) => e.getAttribute('aria-sort'))).toEqual(['none', 'descending'])
		expect(adresse().toString()).toBe('tri=contacts&sens=desc')
		const colonneTracks = screen.getByRole('columnheader', { name: fr['organizations.table.tracks'] })
		expect(colonneTracks.hasAttribute('aria-sort')).toBe(false)
		expect(within(colonneTracks).queryByRole('button')).toBeNull()
	})

	it('« Afficher plus » : « 50 sur 51 », la page suivante ajoutée, l’annonce, puis le focus sur la première ajoutée', async () => {
		const toutes = Array.from({ length: 51 }, (_, i) => ({ ...COMPTOIR, id: `o${i}`, name: `Organisation ${String(i).padStart(2, '0')}` }))
		const { client, appelsListe } = double({ liste: pagineeDans(toutes) })
		monter(client)
		expect(await screen.findAllByTestId('ligne-organisation')).toHaveLength(50)
		expect(screen.getByTestId('compte-organisations').textContent).toBe('50 sur 51')
		await userEvent.click(screen.getByTestId('afficher-plus-organisations'))
		await waitFor(() => expect(screen.getAllByTestId('ligne-organisation')).toHaveLength(51))
		expect(derniers(appelsListe)).toMatchObject({ p_offset: 50 })
		expect(screen.getByTestId('compte-organisations').textContent).toBe('51 sur 51')
		expect(screen.queryByTestId('afficher-plus-organisations')).toBeNull()
		expect(screen.getByRole('status', { name: fr['organizations.list.live.aria'] }).textContent).toBe(fr['organizations.more.live.one'])
		await waitFor(() => expect(document.activeElement?.textContent).toBe('Organisation 50'))
	})

	it('« Afficher plus » en échec : l’erreur s’écrit sous lui, les lignes restent, « Réessayer » reprend', async () => {
		const toutes = Array.from({ length: 52 }, (_, i) => ({ ...COMPTOIR, id: `o${i}`, name: `Organisation ${String(i).padStart(2, '0')}` }))
		const paginee = pagineeDans(toutes)
		let echecs = 1
		const { client } = double({
			liste: (args, rang) => (rang > 0 && echecs-- > 0 ? { error: { message: 'boum' }, status: 500 } : paginee(args, rang)),
		})
		monter(client)
		await screen.findAllByTestId('ligne-organisation')
		await userEvent.click(screen.getByTestId('afficher-plus-organisations'))
		const erreur = await screen.findByTestId('erreur-plus-organisations')
		expect(erreur.getAttribute('role')).toBe('alert')
		expect(screen.getAllByTestId('ligne-organisation')).toHaveLength(50)
		await userEvent.click(within(erreur).getByRole('button', { name: fr['organizations.more.retry'] }))
		await waitFor(() => expect(screen.getAllByTestId('ligne-organisation')).toHaveLength(52))
		expect(screen.queryByTestId('erreur-plus-organisations')).toBeNull()
	})

	it('l’adresse chargée pose la recherche, les filtres et le tri ; un track inconnu en est retiré', async () => {
		const { client, appelsListe } = double()
		monter(client, { adresse: `/contacts/organisations?q=sog&tracks=${CONSEIL},00000000-0000-4000-8000-00000000ffff&recettes=sans&tri=contacts&sens=desc` })
		await screen.findAllByTestId('ligne-organisation')
		expect(appelsListe[0]).toMatchObject({ p_search: 'sog', p_revenues: 'without', p_sort: 'contacts', p_descending: true })
		expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('sog')
		await waitFor(() => expect(adresse().get('tracks')).toBe(CONSEIL))
		await waitFor(() => expect(derniers(appelsListe)).toMatchObject({ p_track_ids: [CONSEIL] }))
	})

	it('une relecture garde les lignes, le tableau `aria-busy`, sans squelette', async () => {
		const { client } = double({ liste: (args, rang) => (rang === 0 ? pagineeDans([COMPTOIR, SOGEXIA])(args, rang) : 'jamais') })
		monter(client)
		await screen.findAllByTestId('ligne-organisation')
		await userEvent.selectOptions(screen.getByRole('combobox', { name: fr['organizations.filter.revenues'] }), 'avec')
		await waitFor(() => expect(screen.getByTestId('tableau-organisations').getAttribute('aria-busy')).toBe('true'))
		expect(screen.getAllByTestId('ligne-organisation')).toHaveLength(2)
		expect(screen.queryByLabelText(fr['state.loading.aria'])).toBeNull()
	})

	it('le vide sous les filtres porte « Effacer les filtres », une seule fois, et garde la barre', async () => {
		const { client } = double({ liste: (args, rang) => (args['p_revenues'] === 'without' ? { data: [] } : pagineeDans([COMPTOIR])(args, rang)) })
		monter(client, { adresse: '/contacts/organisations?recettes=sans' })
		expect(await screen.findByText(fr['organizations.empty.filtered.title'])).toBeTruthy()
		expect(screen.getByTestId('filtres-organisations')).toBeTruthy()
		expect(screen.getAllByRole('button', { name: fr['organizations.filter.clear'] })).toHaveLength(1)
		await userEvent.click(screen.getByTestId('effacer-filtres-organisations-vide'))
		expect(await screen.findAllByTestId('ligne-organisation')).toHaveLength(1)
		expect(adresse().toString()).toBe('')
	})

	it('créer : le focus entre, « Créer » attend un nom, l’envoi normalise, puis la fiche s’ouvre', async () => {
		const { client, ecritures } = double()
		monter(client)
		await userEvent.click(await screen.findByTestId('ouvrir-creation-organisation'))
		expect(screen.queryByTestId('ouvrir-creation-organisation')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('champ-nom-organisation'))
		expect((screen.getByTestId('envoyer-organisation') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.type(screen.getByTestId('champ-nom-organisation'), 'Atelier Brun')
		await userEvent.type(screen.getByTestId('champ-domaine-organisation'), 'Atelier-Brun.FR')
		await userEvent.click(screen.getByTestId('envoyer-organisation'))
		expect(await screen.findByTestId('fiche-ouverte')).toBeTruthy()
		expect(ecritures).toEqual([{ workspace_id: 'ws', name: 'Atelier Brun', domain: 'atelier-brun.fr', website: null }])
	})

	it('un refus reste dans le formulaire, la saisie conservée', async () => {
		monter(double({ insertion: { error: { code: '23505', message: 'duplicate' }, status: 409 } }).client)
		await userEvent.click(await screen.findByTestId('ouvrir-creation-organisation'))
		await userEvent.type(screen.getByTestId('champ-nom-organisation'), 'Doublon')
		await userEvent.click(screen.getByTestId('envoyer-organisation'))
		expect((await screen.findByTestId('refus-organisation')).textContent).toBe(fr['organizations.refus.domainePris'])
		expect((screen.getByTestId('champ-nom-organisation') as HTMLInputElement).value).toBe('Doublon')
	})

	it('`Échap` referme et rend le focus à la commande', async () => {
		monter(double().client)
		await userEvent.click(await screen.findByTestId('ouvrir-creation-organisation'))
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('ouvrir-creation-organisation')))
	})

	it('quand la base refuse l’édition, la commande est montée, désactivée, et cite le motif (§5.59)', async () => {
		monter(double().client, { edition: 'refusee' })
		const commande = await screen.findByTestId('ouvrir-creation-organisation')
		expect((commande as HTMLButtonElement).disabled).toBe(true)
		const motif = commande.getAttribute('aria-describedby')
		expect(document.getElementById(motif ?? '')?.textContent).toBe(fr['rights.readonly.edition'])
	})
})

const CAT = (n: number) => `5eed0000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const CATALOGUE = [
	{ id: CAT(1), name: 'Client', color: 'brand', archived_at: null },
	{ id: CAT(2), name: 'Fournisseur', color: 'accent', archived_at: null },
	{ id: CAT(3), name: 'Partenaire', color: 'success', archived_at: null },
	{ id: CAT(4), name: 'Prospect', color: 'neutral', archived_at: null },
	{ id: CAT(5), name: 'Ancien client', color: 'danger', archived_at: '2026-11-18T00:00:00Z' },
]

describe('les catégories dans la liste (`CRM-153` T4, docs/DESIGN_SYSTEM.md §5.107)', () => {
	it('sous le nom : trois pilules au plus, puis « +n » qui énumère les autres ; sans catégorie, aucune ligne', async () => {
		monter(double({ catalogue: CATALOGUE, categoriesDe: { o2: [CAT(5), CAT(4), CAT(3), CAT(2), CAT(1)] } }).client)
		const [comptoir, sogexia] = await screen.findAllByTestId('ligne-organisation')
		expect(within(comptoir!).queryByTestId('categories-sous-nom')).toBeNull()
		const liste = within(sogexia!).getByTestId('categories-sous-nom')
		expect(within(liste).getAllByTestId('pastille-etiquette').map((p) => p.textContent)).toEqual(['Client', 'Fournisseur', 'Partenaire'])
		const reste = within(liste).getByTestId('pastille-etiquettes-reste')
		expect(reste.textContent).toBe('+2')
		expect(reste.getAttribute('aria-label')).toBe('2 autres catégories : Prospect, Ancien client')
		// Le nom reste le premier lien de la cellule, toujours tronqué en ellipse.
		expect(within(sogexia!).getByTestId('lien-fiche-organisation').parentElement!.className).toContain('truncate')
	})

	it('le filtre n’est pas rendu sans catalogue ; avec, cocher filtre aussitôt et l’écrit dans l’adresse', async () => {
		monter(double().client)
		await screen.findAllByTestId('ligne-organisation')
		expect(screen.queryByTestId('ouvrir-filtre-categories')).toBeNull()
		cleanup()
		const { client, appelsListe } = double({ catalogue: CATALOGUE })
		monter(client)
		const bouton = await screen.findByTestId('ouvrir-filtre-categories')
		await userEvent.click(bouton)
		const panneau = screen.getByTestId('panneau-filtre-categories')
		expect(within(panneau).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual([
			'Client', 'Fournisseur', 'Partenaire', 'Prospect', 'Ancien client (archivée)',
		])
		await userEvent.click(within(panneau).getByRole('checkbox', { name: 'Ancien client (archivée)' }))
		await waitFor(() => expect(derniers(appelsListe)['p_category_ids']).toEqual([CAT(5)]))
		expect(adresse().get('categories')).toBe(CAT(5))
		expect(bouton.textContent).toBe('Catégories (1)')
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('panneau-filtre-categories')).toBeNull()
		expect(document.activeElement).toBe(bouton)
	})

	it('un seul panneau à la fois : ouvrir « Catégories » replie « Tracks »', async () => {
		monter(double({ catalogue: CATALOGUE }).client)
		await userEvent.click(await screen.findByTestId('ouvrir-filtre-tracks'))
		expect(screen.getByTestId('panneau-filtre-tracks')).toBeTruthy()
		await userEvent.click(screen.getByTestId('ouvrir-filtre-categories'))
		expect(screen.queryByTestId('panneau-filtre-tracks')).toBeNull()
		expect(screen.getByTestId('panneau-filtre-categories')).toBeTruthy()
	})

	it('l’adresse chargée pose le filtre ; une catégorie inconnue en est retirée, l’archivée gardée', async () => {
		const inconnue = '5eed0000-0000-4000-8000-0000000009ff'
		const { client, appelsListe } = double({ catalogue: CATALOGUE })
		monter(client, { adresse: `/contacts/organisations?categories=${CAT(5)},${inconnue}` })
		await screen.findAllByTestId('ligne-organisation')
		await waitFor(() => expect(adresse().get('categories')).toBe(CAT(5)))
		await waitFor(() => expect(derniers(appelsListe)['p_category_ids']).toEqual([CAT(5)]))
		expect(screen.getByTestId('ouvrir-filtre-categories').textContent).toBe('Catégories (1)')
	})
})

describe('les organisations de tous les espaces (`CRM-161` T3.c, docs/DESIGN_SYSTEM.md §5.115)', () => {
	const MAISON: Ligne & { workspace_id: string } = { id: 'o9', name: 'Maison Arlo', domain: null, website: null, contacts: 1, has_revenues: false, workspace_id: 'ws-l' }
	const DES_DEUX = [{ ...COMPTOIR, workspace_id: 'ws' }, MAISON, { ...SOGEXIA, workspace_id: 'ws' }]
	// Deux homonymes, « Productions », un par espace : deux cases distinctes.
	const TRACKS_DES_DEUX = [
		{ ...TRACKS[0], workspace_id: 'ws' },
		{ id: 'tp', name: 'Productions', slug: 'productions', color: 'warning', icon: 'Film', position: 3, description: null, workspace_id: 'ws' },
		{ id: 'tl', name: 'Productions', slug: 'productions', color: 'brand', icon: 'Film', position: 1, description: null, workspace_id: 'ws-l' },
	]
	/** La base filtre par espace comme `organization_list` : `p_workspace_ids` restreint, sinon tous. */
	const parEspace = (toutes: readonly (Ligne & { workspace_id: string })[]): Liste => (args) => {
		const ids = args['p_workspace_ids'] as string[] | undefined
		const gardees = ids === undefined ? toutes : toutes.filter((l) => ids.includes(l.workspace_id))
		return { data: gardees.map((l) => ({ ...l, total_count: gardees.length })) }
	}

	it('d’un seul espace, la liste d’avant : son espace en `p_workspace_id`, ni bouton « Espace », ni colonne, ni mention', async () => {
		const { client, appelsListe } = double()
		monter(client, { espaces: [P2ENJOY] })
		await screen.findAllByTestId('ligne-organisation')
		expect(derniers(appelsListe)['p_workspace_id']).toBe('ws')
		expect(derniers(appelsListe)).not.toHaveProperty('p_workspace_ids')
		expect(screen.queryByTestId('ouvrir-filtre-espaces')).toBeNull()
		expect(screen.queryByTestId('espace-organisation')).toBeNull()
		expect(screen.queryByTestId('espace-des-gestes')).toBeNull()
		expect(screen.getAllByRole('columnheader')).toHaveLength(5)
	})

	it('de deux espaces : tous lus, la colonne « Espace » la dernière, la création dite dans l’espace de l’onglet', async () => {
		const { client, appelsListe } = double({ liste: parEspace(DES_DEUX) })
		monter(client, { espaces: [P2ENJOY, LUMEN] })
		const lignes = await screen.findAllByTestId('ligne-organisation')
		expect(derniers(appelsListe)).not.toHaveProperty('p_workspace_id')
		expect(derniers(appelsListe)).not.toHaveProperty('p_workspace_ids')
		const entetes = screen.getAllByRole('columnheader').map((c) => c.textContent)
		expect(entetes).toHaveLength(6)
		expect(entetes[5]).toBe(fr['spaces.column'])
		expect(lignes.map((l) => within(l).getByTestId('espace-organisation').textContent)).toEqual(['P2Enjoy', 'Studio Lumen', 'P2Enjoy'])
		expect(within(lignes[1] as HTMLElement).getByTestId('espace-organisation').getAttribute('title')).toBe('Studio Lumen')
		expect(screen.getByTestId('espace-des-gestes').textContent).toBe('Dans l’espace P2Enjoy')
		await userEvent.click(screen.getByTestId('ouvrir-creation-organisation'))
		expect(screen.getByTestId('espace-creation-organisation').textContent).toBe('Dans l’espace P2Enjoy')
	})

	it('le filtre « Espace » se fait par la lecture : `p_workspace_ids`, l’adresse, la première page relue', async () => {
		const { client, appelsListe } = double({ liste: parEspace(DES_DEUX) })
		monter(client, { espaces: [P2ENJOY, LUMEN] })
		await screen.findAllByTestId('ligne-organisation')
		const bouton = screen.getByTestId('ouvrir-filtre-espaces')
		await userEvent.click(bouton)
		const panneau = screen.getByTestId('panneau-filtre-espaces')
		await userEvent.click(within(panneau).getByRole('checkbox', { name: 'Studio Lumen' }))
		await waitFor(() => expect(derniers(appelsListe)['p_workspace_ids']).toEqual(['ws-l']))
		expect(derniers(appelsListe)['p_offset']).toBe(0)
		expect(adresse().get('espaces')).toBe('studio-lumen')
		await waitFor(() => expect(screen.getAllByTestId('ligne-organisation').map((l) => l.dataset['organisation'])).toEqual(['o9']))
		expect(bouton.textContent).toBe('Espace (1)')
	})

	it('l’adresse chargée pose le filtre ; un seul des trois panneaux ouvert à la fois', async () => {
		const { client, appelsListe } = double({ liste: parEspace(DES_DEUX), catalogue: [{ id: 'c1', name: 'Client', color: 'brand', archived_at: null, workspace_id: 'ws' }] })
		monter(client, { espaces: [P2ENJOY, LUMEN], adresse: '/contacts/organisations?espaces=p2enjoy' })
		await screen.findAllByTestId('ligne-organisation')
		await waitFor(() => expect(derniers(appelsListe)['p_workspace_ids']).toEqual(['ws']))
		await userEvent.click(screen.getByTestId('ouvrir-filtre-tracks'))
		await userEvent.click(screen.getByTestId('ouvrir-filtre-espaces'))
		expect(screen.queryByTestId('panneau-filtre-tracks')).toBeNull()
		expect(screen.getByTestId('panneau-filtre-espaces')).toBeTruthy()
		await userEvent.click(await screen.findByTestId('ouvrir-filtre-categories'))
		expect(screen.queryByTestId('panneau-filtre-espaces')).toBeNull()
		expect(screen.getByTestId('panneau-filtre-categories')).toBeTruthy()
		await userEvent.click(screen.getByTestId('ouvrir-filtre-espaces'))
		expect(screen.queryByTestId('panneau-filtre-categories')).toBeNull()
	})

	it('les cases « Tracks » : celles des espaces de la portée, groupées par espace à partir de deux ; les homonymes distincts', async () => {
		const { client, appelsIn } = double({ liste: parEspace(DES_DEUX), tracks: TRACKS_DES_DEUX })
		monter(client, { espaces: [P2ENJOY, LUMEN] })
		await screen.findAllByTestId('ligne-organisation')
		await waitFor(() => expect(appelsIn).toContainEqual(['tracks', 'workspace_id', ['ws', 'ws-l']]))
		await userEvent.click(screen.getByTestId('ouvrir-filtre-tracks'))
		const groupes = within(screen.getByTestId('panneau-filtre-tracks')).getAllByTestId('groupe-cases-espace')
		expect(groupes.map((g) => [g.querySelector('legend')?.textContent, within(g).getAllByRole('checkbox').length])).toEqual([
			['P2Enjoy', 2],
			['Studio Lumen', 1],
		])
		expect(within(groupes[1] as HTMLElement).getByRole('checkbox', { name: 'Productions' })).toBeTruthy()
	})

	it('une portée d’un espace : ses seules cases, sans groupe', async () => {
		const { client, appelsIn } = double({ liste: parEspace(DES_DEUX), tracks: TRACKS_DES_DEUX.filter((t) => t.workspace_id === 'ws-l') })
		monter(client, { espaces: [P2ENJOY, LUMEN], adresse: '/contacts/organisations?espaces=studio-lumen' })
		await screen.findAllByTestId('ligne-organisation')
		await waitFor(() => expect(appelsIn).toContainEqual(['tracks', 'workspace_id', ['ws-l']]))
		await userEvent.click(screen.getByTestId('ouvrir-filtre-tracks'))
		const panneau = screen.getByTestId('panneau-filtre-tracks')
		expect(within(panneau).queryAllByTestId('groupe-cases-espace')).toHaveLength(0)
		expect(within(panneau).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual(['Productions'])
	})

	it('les cases « Catégories » se groupent de même par espace', async () => {
		const catalogue = [
			{ id: 'c1', name: 'Client', color: 'brand', archived_at: null, workspace_id: 'ws' },
			{ id: 'c2', name: 'Client', color: 'success', archived_at: null, workspace_id: 'ws-l' },
		]
		const { client } = double({ liste: parEspace(DES_DEUX), catalogue })
		monter(client, { espaces: [P2ENJOY, LUMEN] })
		await userEvent.click(await screen.findByTestId('ouvrir-filtre-categories'))
		const groupes = within(screen.getByTestId('panneau-filtre-categories')).getAllByTestId('groupe-cases-espace')
		expect(groupes.map((g) => g.dataset['slug'])).toEqual(['p2enjoy', 'studio-lumen'])
	})

	it('le vide sous le filtre « Espace » : la barre reste, « Afficher tous les espaces » vide le filtre et rend le focus', async () => {
		const { client, appelsListe } = double({ liste: parEspace([{ ...COMPTOIR, workspace_id: 'ws' }]) })
		monter(client, { espaces: [P2ENJOY, LUMEN], adresse: '/contacts/organisations?espaces=studio-lumen' })
		expect(await screen.findByTestId('vide-filtre-espaces')).toBeTruthy()
		expect(screen.getByTestId('filtres-organisations')).toBeTruthy()
		expect(screen.queryByTestId('effacer-filtres-organisations-vide')).toBeNull()
		await userEvent.click(screen.getByTestId('afficher-tous-les-espaces'))
		await waitFor(() => expect(adresse().get('espaces')).toBeNull())
		await waitFor(() => expect(derniers(appelsListe)).not.toHaveProperty('p_workspace_ids'))
		expect(await screen.findAllByTestId('ligne-organisation')).toHaveLength(1)
		expect(document.activeElement).toBe(screen.getByTestId('ouvrir-filtre-espaces'))
	})
})

