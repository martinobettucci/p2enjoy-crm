// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.d : Temps ▸ Saisie sur une grille de tous les espaces — d'un seul espace, la
//           grille d'avant (lectures bornées à l'espace) ; à partir de deux, les lectures sans espace, les lignes groupées par
//           espace dans l'ordre du menu, chaque cellule écrite dans l'espace de sa ligne, les totaux par jour tous espaces
//           confondus et l'annonce du dépassement sur ce total, « Saisir pour » groupé par espace administré, un collègue
//           choisi qui restreint la grille à son espace, la recherche d'affaire bornée à cet espace, aucun filtre « Espace »
//           (décision 981 ; docs/SPEC-espace-courant.md §16.9.2 ; docs/DESIGN_SYSTEM.md §5.54, §5.115 ; docs/SPEC-temps.md §7)

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { FournisseurEspace } from './ContexteEspace'
import { SaisieTemps } from './SaisieTemps'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'
import type { Saisie } from '../lib/temps'

afterEach(cleanup)

const P2ENJOY = { id: 'ws1', name: 'P2Enjoy SAS', slug: 'p2enjoy' }
const LUMEN = { id: 'ws2', name: 'Studio Lumen', slug: 'studio-lumen' }

type Lecture = { readonly table: string; readonly eqs: readonly (readonly [string, unknown])[] }
type Ecriture = { readonly action: string; readonly charge: Record<string, unknown> }

/**
 * Un client dont les lectures filtrent comme `eq(colonne, valeur)` le fait : une colonne qu'une ligne porte doit être égale. Il
 * garde chaque lecture et chaque écriture. `roles` : le rôle rendu par `mon_role_espace` pour chaque espace.
 */
function double({
	saisies = [] as readonly (Saisie & { workspace_id: string })[],
	roles = { ws1: 'admin', ws2: 'admin' } as Record<string, string>,
	cartes = [] as readonly object[],
} = {}) {
	const lectures: Lecture[] = []
	const ecritures: Ecriture[] = []
	let numero = 0
	const tables: Record<string, readonly Record<string, unknown>[]> = {
		tracks: [
			{ id: 't1', name: 'Studio web', position: 1, workspace_id: 'ws1', channels: [{ id: 'c1', name: 'Refonte de site', position: 1 }] },
			{ id: 't2', name: 'Productions', position: 1, workspace_id: 'ws2', channels: [{ id: 'c2', name: 'Tournages', position: 1 }] },
		],
		saisies_temps: saisies as readonly Record<string, unknown>[],
		cards: cartes as readonly Record<string, unknown>[],
		workspace_members: [
			{ user_id: 'moi', workspace_id: 'ws1', profiles: { id: 'moi', full_name: 'Camille Aubert' } },
			{ user_id: 'p2', workspace_id: 'ws1', profiles: { id: 'p2', full_name: 'Driss Lemoine' } },
			{ user_id: 'moi', workspace_id: 'ws2', profiles: { id: 'moi', full_name: 'Camille Aubert' } },
			{ user_id: 'p3', workspace_id: 'ws2', profiles: { id: 'p3', full_name: 'Inès Arlo' } },
		],
	}
	const client = {
		rpc: (_nom: string, args: { ws: string }) => Promise.resolve({ data: roles[args.ws] ?? null, error: null, status: 200 }),
		from: (table: string) => {
			let action = 'select'
			let charge: Record<string, unknown> = {}
			const eqs: [string, unknown][] = []
			const chaine: Record<string, unknown> = {}
			for (const nom of ['is', 'in', 'gte', 'lte', 'ilike', 'order', 'limit', 'select']) chaine[nom] = () => chaine
			chaine['eq'] = (colonne: string, valeur: unknown) => {
				eqs.push([colonne, valeur])
				return chaine
			}
			for (const nom of ['insert', 'update', 'delete']) {
				chaine[nom] = (valeur?: Record<string, unknown>) => {
					action = nom
					charge = valeur ?? {}
					return chaine
				}
			}
			chaine['then'] = (resoudre: (r: unknown) => unknown) => {
				if (action === 'select') {
					lectures.push({ table, eqs: [...eqs] })
					const lignes = (tables[table] ?? []).filter((l) => eqs.every(([col, val]) => !(col in l) || l[col] === val))
					return Promise.resolve({ data: lignes, error: null, status: 200 }).then(resoudre)
				}
				ecritures.push({ action, charge })
				const ligne = { id: `s${++numero}`, jour: '2026-06-01', minutes: 105, track_id: null, channel_id: null, card_id: null, ...charge }
				return Promise.resolve({ data: [ligne], error: null, status: 201 }).then(resoudre)
			}
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, lectures, ecritures }
}

function monter(client: ClientCrm, espaces: readonly (typeof P2ENJOY)[], estAdmin = false) {
	return render(
		<MemoryRouter initialEntries={['/temps?semaine=2026-06-01']}>
			<FournisseurEspace valeur={{ idWorkspace: 'ws1', estAdmin, espaces }}>
				<SaisieTemps client={client} idWorkspace="ws1" idUtilisateur="moi" estAdmin={estAdmin} aujourdhui="2026-10-11" />
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

const eqEspace = (lectures: readonly Lecture[], table: string) =>
	lectures.filter((l) => l.table === table).map((l) => l.eqs.find(([c]) => c === 'workspace_id')?.[1])

describe('Temps ▸ Saisie d’un seul espace : la grille d’avant', () => {
	it('lit l’espace de l’onglet seul, sans groupe ni note, une personne d’un seul espace ne voyant rien de nouveau', async () => {
		const { client, lectures } = double()
		monter(client, [P2ENJOY])
		expect(await screen.findByRole('textbox', { name: 'Studio web, lundi 1 juin' })).toBeTruthy()
		expect(screen.queryByTestId('temps-groupe-espace')).toBeNull()
		expect(screen.queryByTestId('temps-note-espaces')).toBeNull()
		expect(screen.queryByTestId('ouvrir-filtre-espaces')).toBeNull()
		expect(eqEspace(lectures, 'tracks')).toEqual(['ws1'])
		expect(eqEspace(lectures, 'saisies_temps')).toEqual(['ws1'])
		// La grille ne montre pas les tracks d'un autre espace.
		expect(screen.queryByRole('textbox', { name: 'Productions, lundi 1 juin' })).toBeNull()
	})
})

describe('Temps ▸ Saisie de tous les espaces (décision 981, §16.9.2)', () => {
	it('les lectures ne bornent aucun espace, et les lignes sont groupées par espace, dans l’ordre du menu', async () => {
		const { client, lectures } = double()
		monter(client, [P2ENJOY, LUMEN])
		await screen.findByRole('textbox', { name: 'Productions, lundi 1 juin' })
		expect(eqEspace(lectures, 'tracks')).toEqual([undefined])
		expect(eqEspace(lectures, 'saisies_temps')).toEqual([undefined])
		const groupes = screen.getAllByTestId('temps-groupe-espace')
		expect(groupes.map((g) => g.textContent)).toEqual(['P2Enjoy SAS', 'Studio Lumen'])
		expect(within(groupes[0] as HTMLElement).getByRole('rowheader').getAttribute('scope')).toBe('rowgroup')
		// L'ordre affiché : le groupe, ses lignes, le groupe suivant.
		const lignes = screen.getAllByRole('row').map((r) => r.textContent ?? '')
		expect(lignes.findIndex((l) => l.includes('P2Enjoy SAS'))).toBeLessThan(lignes.findIndex((l) => l.includes('Studio web')))
		expect(lignes.findIndex((l) => l.includes('Studio web'))).toBeLessThan(lignes.findIndex((l) => l.includes('Studio Lumen')))
		expect(lignes.findIndex((l) => l.includes('Studio Lumen'))).toBeLessThan(lignes.findIndex((l) => l.includes('Productions')))
		expect(screen.getByTestId('temps-note-espaces').textContent).toBe(fr['time.matrix.spacesNote'])
		// Aucun filtre « Espace » sur cet écran de saisie.
		expect(screen.queryByTestId('ouvrir-filtre-espaces')).toBeNull()
	})

	it('une cellule s’écrit dans l’espace de SA ligne', async () => {
		const { client, ecritures } = double()
		monter(client, [P2ENJOY, LUMEN])
		const champLumen = await screen.findByRole('textbox', { name: 'Tournages, lundi 1 juin' })
		await userEvent.click(champLumen)
		await userEvent.keyboard('1{Enter}')
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.charge).toMatchObject({ workspace_id: 'ws2', profile_id: 'moi', channel_id: 'c2', minutes: 105 })
		const champP2 = screen.getByRole('textbox', { name: 'Refonte de site, mardi 2 juin' })
		await userEvent.click(champP2)
		await userEvent.keyboard('1{Enter}')
		await waitFor(() => expect(ecritures).toHaveLength(2))
		expect(ecritures[1]?.charge).toMatchObject({ workspace_id: 'ws1', channel_id: 'c1' })
	})

	it('le total du jour compte tous les espaces, et le dépassement est annoncé sur ce total sans rien envoyer', async () => {
		const { client, ecritures } = double({
			saisies: [
				{ id: 'a', jour: '2026-06-01', minutes: 210, track_id: 't1', channel_id: null, card_id: null, workspace_id: 'ws1' },
				{ id: 'b', jour: '2026-06-01', minutes: 105, track_id: 't2', channel_id: null, card_id: null, workspace_id: 'ws2' },
			],
		})
		monter(client, [P2ENJOY, LUMEN])
		await screen.findByRole('textbox', { name: 'Tournages, lundi 1 juin' })
		// 210 + 105 = 315 minutes, trois quarts sur quatre.
		await waitFor(() => expect(screen.getByTestId('temps-total-2026-06-01').textContent).toBe('3 / 4 quarts'))
		const champ = screen.getByRole('textbox', { name: 'Tournages, lundi 1 juin' })
		await userEvent.click(champ)
		await userEvent.keyboard('2{Enter}')
		expect(champ.getAttribute('aria-invalid')).toBe('true')
		expect(screen.getAllByText(fr['time.cell.refused.cap']).length).toBeGreaterThan(0)
		expect(ecritures).toEqual([])
	})

	it('les flèches suivent l’ordre AFFICHÉ, d’un groupe au suivant', async () => {
		const { client } = double()
		monter(client, [P2ENJOY, LUMEN])
		const champ = await screen.findByRole('textbox', { name: 'Refonte de site, lundi 1 juin' })
		await userEvent.click(champ)
		await userEvent.keyboard('{ArrowDown}')
		// Les lignes du premier espace : « Studio web », « Refonte de site » ; les suivantes viennent d'un autre groupe.
		expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Productions, lundi 1 juin' }))
	})
})

describe('« Saisir pour » à plusieurs espaces (§16.9.2)', () => {
	it('groupe les membres par espace administré ; la personne connectée n’y est pas offerte', async () => {
		const { client } = double()
		monter(client, [P2ENJOY, LUMEN], true)
		const select = await screen.findByTestId('temps-saisir-pour')
		await waitFor(() => expect(within(select).getAllByRole('group')).toHaveLength(2))
		const groupes = within(select).getAllByRole('group')
		expect(groupes.map((g) => g.getAttribute('label'))).toEqual(['P2Enjoy SAS', 'Studio Lumen'])
		expect(within(groupes[0] as HTMLElement).getAllByRole('option').map((o) => [o.textContent, o.getAttribute('value')])).toEqual([['Driss Lemoine', 'ws1|p2']])
		expect(within(groupes[1] as HTMLElement).getAllByRole('option').map((o) => [o.textContent, o.getAttribute('value')])).toEqual([['Inès Arlo', 'ws2|p3']])
		expect(within(select).getAllByRole('option').map((o) => o.textContent)).toContain(fr['time.for.me'])
	})

	it('un espace non administré n’offre aucun membre ; sans aucun espace administré, aucun « Saisir pour »', async () => {
		const { client } = double({ roles: { ws1: 'business_developer', ws2: 'viewer' } })
		monter(client, [P2ENJOY, LUMEN], false)
		await screen.findByRole('textbox', { name: 'Productions, lundi 1 juin' })
		await new Promise((ok) => setTimeout(ok, 30))
		expect(screen.queryByTestId('temps-saisir-pour')).toBeNull()
	})

	it('choisir un collègue restreint la grille à SON espace, lit ses saisies dans cet espace, et le bandeau le dit', async () => {
		const { client, lectures } = double()
		monter(client, [P2ENJOY, LUMEN], true)
		const select = await screen.findByTestId('temps-saisir-pour')
		await waitFor(() => expect(within(select).getAllByRole('group')).toHaveLength(2))
		await userEvent.selectOptions(select, 'ws2|p3')
		await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Studio web, lundi 1 juin' })).toBeNull())
		expect(screen.getByRole('textbox', { name: 'Productions, lundi 1 juin' })).toBeTruthy()
		expect(screen.getAllByTestId('temps-groupe-espace').map((g) => g.textContent)).toEqual(['Studio Lumen'])
		expect(screen.getByTestId('temps-bandeau-autrui').textContent).toContain('Inès Arlo')
		// Les lectures de la grille d'un collègue sont bornées à l'espace choisi.
		const derniereArbre = lectures.filter((l) => l.table === 'tracks').at(-1)
		const derniereSaisies = lectures.filter((l) => l.table === 'saisies_temps').at(-1)
		expect(derniereArbre?.eqs).toContainEqual(['workspace_id', 'ws2'])
		expect(derniereSaisies?.eqs).toContainEqual(['workspace_id', 'ws2'])
		expect(derniereSaisies?.eqs).toContainEqual(['profile_id', 'p3'])
		// Revenir à soi-même rend la grille de tous les espaces.
		await userEvent.selectOptions(select, 'moi')
		expect(await screen.findByRole('textbox', { name: 'Studio web, lundi 1 juin' })).toBeTruthy()
		expect(screen.getAllByTestId('temps-groupe-espace')).toHaveLength(2)
	})

	it('la recherche d’affaire d’une saisie pour un collègue ne propose que les affaires de SON espace', async () => {
		const carte = (id: string, titre: string, espace: string) => ({
			id,
			title: titre,
			workspace_id: espace,
			card_placements: [{ id: `${id}-p`, channel_id: espace === 'ws1' ? 'c1' : 'c2', created_at: '2026-01-01T00:00:00Z' }],
		})
		const { client } = double({ cartes: [carte('k1', 'Refonte du portail', 'ws1'), carte('k2', 'Refonte du clip', 'ws2')] })
		monter(client, [P2ENJOY, LUMEN], true)
		const select = await screen.findByTestId('temps-saisir-pour')
		await waitFor(() => expect(within(select).getAllByRole('group')).toHaveLength(2))
		// Pour soi-même : les deux espaces.
		await userEvent.type(screen.getByTestId('temps-ajout-affaire'), 'Refonte')
		expect((await screen.findAllByRole('option', { name: /Refonte du/ })).map((o) => o.textContent).sort()).toEqual(['Refonte du clip', 'Refonte du portail'])
		// Pour un collègue de « Studio Lumen » : celles de cet espace seul.
		await userEvent.clear(screen.getByTestId('temps-ajout-affaire'))
		await userEvent.selectOptions(select, 'ws2|p3')
		await screen.findByRole('textbox', { name: 'Productions, lundi 1 juin' })
		await userEvent.type(screen.getByTestId('temps-ajout-affaire'), 'Refonte')
		await waitFor(() => expect(screen.getAllByRole('option', { name: /Refonte du/ }).map((o) => o.textContent)).toEqual(['Refonte du clip']))
	})
})
