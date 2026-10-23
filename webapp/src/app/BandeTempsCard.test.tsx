// @verifies CRM-106 (docs/BACKLOG.md) — tranche T2 : la bande de la semaine dans la fiche d'une affaire
// @verifies docs/SPEC-temps.md §7.6 (1 : la cellule de la matrice, `Entrée` vers le jour suivant, une seule écriture ;
//           2 : une valeur remplace, zéro retire ; 3 : le temps de la seule personne connectée ; 4 : le mode et le pied
//           d'un jour comptent les autres cibles, le plafond annoncé sans envoi ; 5 : aucune lecture de l'arborescence ;
//           6 : navigation et « Ouvrir dans Temps » ; 7 : « Votre semaine » ; 8 : le résumé relu ; 9 : aucun motif de
//           lecture seule) ; docs/DESIGN_SYSTEM.md §5.54 bis ; décision 630

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'
import type { Saisie } from '../lib/temps'
import { BandeTempsCard, adresseTemps } from './BandeTempsCard'
import { FournisseurEspace } from './ContexteEspace'
import { BlocTempsCard } from './SeriePersonnel'

afterEach(cleanup)

const LUNDI = '2026-10-19'
const MARDI = '2026-10-20'
const AFFAIRE = 'a1'

type Ecriture = { readonly action: string; readonly charge: unknown }
type Requete = { readonly table: string; readonly filtres: ReadonlyArray<readonly [string, unknown]> }

/**
 * Client factice : il rend les saisies données, consigne CHAQUE requête et ses filtres `eq` (pour prouver ce que la
 * bande demande), et les écritures sur `saisies_temps`, qui rendent la ligne écrite après un court délai — celui qui
 * laisse la sortie du champ survenir pendant l'envoi. `rpc` compte les lectures du résumé.
 */
function clientFactice(saisies: readonly Saisie[] = []) {
	const ecritures: Ecriture[] = []
	const requetes: Requete[] = []
	let lecturesResume = 0
	let numero = 0
	const client = {
		rpc: () => {
			lecturesResume += 1
			return Promise.resolve({ data: [], error: null, status: 200 })
		},
		from: (table: string) => {
			let action = 'select'
			let charge: unknown = null
			const filtres: Array<readonly [string, unknown]> = []
			const chaine: Record<string, unknown> = {}
			for (const nom of ['is', 'in', 'gte', 'lte', 'order', 'limit', 'select']) chaine[nom] = () => chaine
			chaine.eq = (colonne: string, valeur: unknown) => {
				filtres.push([colonne, valeur])
				return chaine
			}
			for (const nom of ['insert', 'update', 'delete']) {
				chaine[nom] = (valeur?: unknown) => {
					action = nom
					charge = valeur
					return chaine
				}
			}
			chaine.then = (resoudre: (r: unknown) => unknown) => {
				requetes.push({ table, filtres })
				if (action === 'select') return Promise.resolve({ data: table === 'saisies_temps' ? [...saisies] : [], error: null, status: 200 }).then(resoudre)
				ecritures.push({ action, charge })
				const ligne = { id: `n${++numero}`, jour: LUNDI, minutes: 105, track_id: null, channel_id: null, card_id: AFFAIRE, ...(charge as object) }
				return new Promise((ok) => setTimeout(() => ok({ data: [ligne], error: null, status: 201 }), 20)).then(resoudre)
			}
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, ecritures, requetes, lecturesResume: () => lecturesResume }
}

const saisie = (id: string, jour: string, minutes: number, cible: Partial<Pick<Saisie, 'track_id' | 'channel_id' | 'card_id'>>): Saisie => ({
	id,
	jour,
	minutes,
	track_id: null,
	channel_id: null,
	card_id: null,
	...cible,
})

function rendre(saisies: readonly Saisie[] = [], aujourdhui = MARDI) {
	const factice = clientFactice(saisies)
	let enregistrements = 0
	render(
		<MemoryRouter>
			<BandeTempsCard
				client={factice.client}
				idWorkspace="w"
				idUtilisateur="moi"
				idCard={AFFAIRE}
				titreCard="Refonte intranet"
				aujourdhui={aujourdhui}
				onEnregistre={() => {
					enregistrements += 1
				}}
			/>
		</MemoryRouter>,
	)
	return { ...factice, enregistrements: () => enregistrements }
}

const cellule = (jour: string) => screen.getByRole('textbox', { name: `Refonte intranet, ${jour}` })

describe('la lecture de la bande', () => {
	it('lit la semaine de la seule personne connectée, sur l’espace, sans aucune lecture de l’arborescence', async () => {
		const { requetes } = rendre()
		await screen.findByTestId('temps-card-tableau')
		expect(requetes.map((r) => r.table)).toEqual(['saisies_temps'])
		expect(requetes[0]?.filtres).toEqual([
			['workspace_id', 'w'],
			['profile_id', 'moi'],
		])
	})

	it('dit sa portée, « Votre semaine », et sept cellules nommées par l’affaire et le jour', async () => {
		rendre()
		await screen.findByTestId('temps-card-tableau')
		expect(screen.getByRole('heading', { name: fr['personnel.card.week.title'] })).toBeTruthy()
		expect(screen.getAllByTestId('temps-cellule')).toHaveLength(7)
		expect(cellule('lundi 19 octobre')).toBeTruthy()
		expect(cellule('dimanche 25 octobre')).toBeTruthy()
		// Trop étroite pour sept libellés, la bande nomme les cases « En heures » par une phrase, et chacune par son nom.
		expect(screen.getByText(fr['personnel.card.week.hoursHint'])).toBeTruthy()
		expect(screen.queryByText(fr['time.hours.short'])).toBeNull()
		expect(screen.getByRole('checkbox', { name: 'Saisir le lundi 19 octobre en heures' })).toBeTruthy()
		expect(screen.queryByTestId('temps-total-ligne')).toBeNull()
	})

	it('compte au pied du jour les AUTRES cibles, et au total de la ligne la seule affaire', async () => {
		rendre([saisie('s1', LUNDI, 315, { channel_id: 'c1' }), saisie('s2', LUNDI, 105, { card_id: AFFAIRE })])
		expect((await screen.findByTestId(`temps-total-${LUNDI}`)).textContent).toBe('4 / 4 quarts')
		expect(screen.getByTestId('temps-total-ligne').textContent).toBe('1 h 45')
		expect((cellule('lundi 19 octobre') as HTMLInputElement).value).toBe('1')
	})

	it('lit le mode d’un jour sur toutes ses saisies : une autre cible en heures met le jour en heures', async () => {
		rendre([saisie('s1', MARDI, 90, { track_id: 't1' })])
		const caseMardi = (await screen.findByTestId(`temps-heures-${MARDI}`)) as HTMLInputElement
		expect(caseMardi.checked).toBe(true)
		expect((screen.getByTestId(`temps-heures-${LUNDI}`) as HTMLInputElement).checked).toBe(false)
	})

	it('dit l’erreur de lecture et relit sur « Réessayer »', async () => {
		const factice = clientFactice()
		let appels = 0
		const client = {
			...factice.client,
			from: (table: string) => {
				appels += 1
				if (appels === 1) {
					const c: Record<string, unknown> = {}
					for (const nom of ['eq', 'gte', 'lte', 'order', 'select']) c[nom] = () => c
					c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'boom' }, status: 500 }).then(ok)
					return c
				}
				return (factice.client as unknown as { from: (nom: string) => unknown }).from(table)
			},
		} as unknown as ClientCrm
		render(
			<MemoryRouter>
				<BandeTempsCard client={client} idWorkspace="w" idUtilisateur="moi" idCard={AFFAIRE} titreCard="Refonte intranet" aujourdhui={MARDI} onEnregistre={() => {}} />
			</MemoryRouter>,
		)
		expect((await screen.findByRole('alert')).textContent).toBe(fr['personnel.error'])
		await userEvent.setup().click(screen.getByRole('button', { name: fr['state.error.retry'] }))
		expect(await screen.findByTestId('temps-card-tableau')).toBeTruthy()
	})
})

describe('la saisie depuis la bande', () => {
	it('insère sur l’affaire, pour la personne connectée, et prévient le bloc', async () => {
		const { ecritures, enregistrements } = rendre()
		const user = userEvent.setup()
		await user.click(await screen.findByRole('textbox', { name: 'Refonte intranet, lundi 19 octobre' }))
		await user.keyboard('2')
		await user.tab()
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toEqual({
			action: 'insert',
			charge: { workspace_id: 'w', profile_id: 'moi', jour: LUNDI, minutes: 210, track_id: null, channel_id: null, card_id: AFFAIRE },
		})
		await waitFor(() => expect(enregistrements()).toBe(1))
		expect(screen.getByTestId('temps-total-ligne').textContent).toBe('3 h 30')
	})

	it('une valeur REMPLACE celle du jour (mise à jour des minutes), et zéro la retire', async () => {
		const { ecritures } = rendre([saisie('s2', LUNDI, 105, { card_id: AFFAIRE })])
		const user = userEvent.setup()
		await user.clear(await screen.findByRole('textbox', { name: 'Refonte intranet, lundi 19 octobre' }))
		await user.keyboard('3')
		await user.tab()
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toEqual({ action: 'update', charge: { minutes: 315 } })
		expect(ecritures.some((e) => e.action === 'insert')).toBe(false)

		await user.clear(cellule('lundi 19 octobre'))
		await user.tab()
		await waitFor(() => expect(ecritures).toHaveLength(2))
		expect(ecritures[1]?.action).toBe('delete')
		// Un total nul ne s'écrit pas (§5.54 bis).
		await waitFor(() => expect(screen.queryByTestId('temps-total-ligne')).toBeNull())
	})

	it('annonce le plafond sans rien envoyer quand une autre cible remplit déjà la journée', async () => {
		const { ecritures } = rendre([saisie('s1', LUNDI, 315, { channel_id: 'c1' })])
		const user = userEvent.setup()
		await user.click(await screen.findByRole('textbox', { name: 'Refonte intranet, lundi 19 octobre' }))
		await user.keyboard('2')
		await user.tab()
		await waitFor(() => expect(cellule('lundi 19 octobre').getAttribute('data-etat')).toBe('refus'))
		const motif = document.getElementById(cellule('lundi 19 octobre').getAttribute('aria-describedby') ?? '')
		expect(motif?.textContent).toBe(fr['time.cell.refused.cap'])
		expect(ecritures).toHaveLength(0)
	})

	it('`Entrée` enregistre UNE fois et passe au jour suivant', async () => {
		const { ecritures } = rendre()
		const user = userEvent.setup()
		await user.click(await screen.findByRole('textbox', { name: 'Refonte intranet, lundi 19 octobre' }))
		await user.keyboard('1{Enter}')
		await waitFor(() => expect(document.activeElement).toBe(cellule('mardi 20 octobre')))
		await new Promise((ok) => setTimeout(ok, 60))
		expect(ecritures).toHaveLength(1)
	})

	it('n’est jamais éteinte par le motif de lecture seule de la fiche', async () => {
		const factice = clientFactice()
		render(
			<MemoryRouter>
				<FournisseurRefus valeur={{ disabled: true, 'aria-describedby': 'motif' }}>
					<BandeTempsCard client={factice.client} idWorkspace="w" idUtilisateur="moi" idCard={AFFAIRE} titreCard="Refonte intranet" aujourdhui={MARDI} onEnregistre={() => {}} />
				</FournisseurRefus>
			</MemoryRouter>,
		)
		await screen.findByTestId('temps-card-tableau')
		for (const champ of screen.getAllByTestId('temps-cellule')) expect((champ as HTMLInputElement).disabled).toBe(false)
	})
})

describe('la navigation de la bande', () => {
	it('change de semaine sans toucher l’adresse, et « Ouvrir dans Temps » suit la semaine affichée', async () => {
		rendre()
		const user = userEvent.setup()
		await screen.findByTestId('temps-card-tableau')
		expect(screen.getByRole('link', { name: fr['personnel.card.week.open'] }).getAttribute('href')).toBe('/temps')
		expect(screen.queryByRole('button', { name: fr['time.week.current'] })).toBeNull()

		await user.click(screen.getByRole('button', { name: fr['time.week.next'] }))
		expect(screen.getByTestId('temps-card-semaine').textContent).toBe('Semaine du 26 octobre au 1 novembre 2026')
		expect(screen.getByRole('link', { name: fr['personnel.card.week.open'] }).getAttribute('href')).toBe('/temps?semaine=2026-10-26')

		await user.click(screen.getByRole('button', { name: fr['time.week.current'] }))
		expect(screen.getByTestId('temps-card-semaine').textContent).toBe('Semaine du 19 au 25 octobre 2026')
	})

	it('l’adresse de la matrice omet la semaine du jour', () => {
		expect(adresseTemps('2026-10-19', '2026-10-23')).toBe('/temps')
		expect(adresseTemps('2026-10-12', '2026-10-23')).toBe('/temps?semaine=2026-10-12')
	})
})

describe('le bloc « Temps passé » qui porte la bande', () => {
	it('relit son résumé après un enregistrement accepté', async () => {
		const factice = clientFactice()
		render(
			<MemoryRouter>
				<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: true }}>
					<BlocTempsCard client={factice.client} idCard={AFFAIRE} saisie={{ idWorkspace: 'w', idUtilisateur: 'moi', titreCard: 'Refonte intranet', aujourdhui: MARDI }} />
				</FournisseurEspace>
			</MemoryRouter>,
		)
		const user = userEvent.setup()
		await waitFor(() => expect(factice.lecturesResume()).toBe(1))
		await user.click(await screen.findByRole('textbox', { name: 'Refonte intranet, lundi 19 octobre' }))
		await user.keyboard('1')
		await user.tab()
		await waitFor(() => expect(factice.lecturesResume()).toBe(2))
		// Pour un administrateur, le résumé compte l'équipe ; la bande dit qu'elle n'est que la sienne.
		expect(screen.getByTestId('personnel-portee').textContent).toBe(fr['personnel.scope.team'])
		expect(screen.getByRole('heading', { name: fr['personnel.card.week.title'] })).toBeTruthy()
	})

	it('sans identité de session, ne porte aucune bande', async () => {
		const factice = clientFactice()
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false }}>
				<BlocTempsCard client={factice.client} idCard={AFFAIRE} />
			</FournisseurEspace>,
		)
		await screen.findByText(fr['personnel.card.empty'])
		expect(screen.queryByTestId('temps-card-bande')).toBeNull()
	})
})
