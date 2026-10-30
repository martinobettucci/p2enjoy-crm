// @verifies CRM-071 (docs/BACKLOG.md) — tranche T2 : le sélecteur « Vue », ses commandes et son panneau, sans navigateur
// @verifies docs/DESIGN_SYSTEM.md §5.75 (le sélecteur absent sans vue, désactivé pendant la lecture ; choisir compose les
//           paramètres ; « Aucune vue » garde les filtres ; l'écart dit et la mise à jour offerte ; le panneau, son focus, le
//           nom pris refusé avec le focus rendu au champ ; une vue de l'espace éteinte avec son motif pour qui n'administre
//           pas), §5.59 ; docs/SPEC-vues-import-export.md §3 (décision 777)

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import { PARAMETRES_PAR_DEFAUT, type ParametresListe } from '../lib/liste-cards'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { CommandesVues, PanneauVue, useVuesSauvegardees } from './VuesSauvegardees'

afterEach(cleanup)

const ETAPE = '5eed0000-0000-4000-8000-000000000a01'
const MIENNE = { id: '5eed0000-0000-4000-8000-000000000c01', name: 'Mes négociations', visibility: 'private', filters: { step_id: ETAPE } }
const ESPACE = { id: '5eed0000-0000-4000-8000-000000000c02', name: 'Revue du lundi', visibility: 'workspace', filters: { sort: 'amount' } }

type Reponse = { data: unknown; error: unknown; status: number }

/** Un faux client : la lecture rend `vues`, chaque écriture la réponse suivante de `ecritures`, et garde l'appel. */
function client(vues: readonly unknown[], ecritures: Reponse[] = []) {
	const appels: { methode: string; valeur?: unknown }[] = []
	const faux = {
		from: () => {
			let ecriture: { methode: string; valeur?: unknown } | null = null
			const maillon: Record<string, unknown> = {}
			maillon.select = () => maillon
			maillon.eq = () => maillon
			for (const methode of ['insert', 'update', 'delete']) {
				maillon[methode] = (valeur?: unknown) => {
					ecriture = { methode, valeur }
					appels.push(ecriture)
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) =>
				resoudre(ecriture === null ? { data: vues, error: null, status: 200 } : (ecritures.shift() ?? { data: [], error: null, status: 200 }))
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

function Banc({ c, initiaux }: { readonly c: ClientCrm; readonly initiaux: ParametresListe }) {
	const [parametres, setParametres] = useState(initiaux)
	const vues = useVuesSauvegardees(c, 'channel-1')
	return (
		<>
			<CommandesVues vues={vues} parametres={parametres} onParametres={setParametres} />
			{vues.panneau === null ? null : <PanneauVue vues={vues} parametres={parametres} onParametres={setParametres} />}
			<output data-testid="adresse">{JSON.stringify(parametres)}</output>
		</>
	)
}

function monter(c: ClientCrm, initiaux: ParametresListe = PARAMETRES_PAR_DEFAUT, administration: Capacite = 'permise') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: administration === 'permise', capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<Banc c={c} initiaux={initiaux} />
		</FournisseurEspace>,
	)
}

const adresse = () => JSON.parse(screen.getByTestId('adresse').textContent ?? '{}') as ParametresListe

describe('le sélecteur « Vue » (§5.75)', () => {
	it('sans aucune vue, le sélecteur n’est pas rendu, et « Enregistrer la vue » l’est', async () => {
		monter(client([]).client)
		await screen.findByTestId('vue-enregistrer')
		await waitFor(() => expect(screen.queryByTestId('selecteur-vue')).toBeNull())
	})

	it('nomme ses deux groupes, et choisir une vue compose ses paramètres et la marque', async () => {
		monter(client([ESPACE, MIENNE]).client, { ...PARAMETRES_PAR_DEFAUT, page: 3 })
		const selecteur = (await screen.findByRole('combobox', { name: fr['vues.selecteur'] })) as HTMLSelectElement
		await waitFor(() => expect(selecteur.disabled).toBe(false))
		expect([...selecteur.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([fr['vues.groupe.miennes'], fr['vues.groupe.espace']])
		await userEvent.selectOptions(selecteur, MIENNE.id)
		expect(adresse()).toMatchObject({ etape: ETAPE, page: 1, vue: MIENNE.id })
		expect(screen.queryByTestId('vue-ecart')).toBeNull()
		// « Aucune vue » retire la marque et garde les filtres.
		await userEvent.selectOptions(selecteur, '')
		expect(adresse()).toMatchObject({ etape: ETAPE, vue: null })
	})

	it('des filtres qui s’écartent de la vue sont dits, et « Mettre à jour la vue » écrit les filtres de l’écran', async () => {
		const { client: c, appels } = client([MIENNE], [{ data: [{ id: MIENNE.id }], error: null, status: 200 }])
		monter(c, { ...PARAMETRES_PAR_DEFAUT, etape: ETAPE, recherche: 'lyon', vue: MIENNE.id })
		expect((await screen.findByTestId('vue-ecart')).textContent).toBe(fr['vues.ecart'])
		await userEvent.click(screen.getByTestId('vue-mettre-a-jour'))
		await waitFor(() => expect(appels[0]).toEqual({ methode: 'update', valeur: { filters: { step_id: ETAPE, search: 'lyon' } } }))
		await waitFor(() => expect(screen.getByRole('status', { name: fr['vues.live'] }).textContent).toContain('Mes négociations'))
	})

	it('une vue de l’espace : pour qui n’administre pas, ses commandes sont éteintes et portent le motif', async () => {
		monter(client([ESPACE]).client, { ...PARAMETRES_PAR_DEFAUT, tri: 'amount', sens: 'desc', vue: ESPACE.id }, 'refusee')
		const supprimer = (await screen.findByTestId('vue-supprimer')) as HTMLButtonElement
		expect(supprimer.disabled).toBe(true)
		expect(supprimer.getAttribute('title')).toBe(fr['vues.motif.espace'])
		const motif = document.getElementById(supprimer.getAttribute('aria-describedby') ?? '')
		expect(motif?.textContent).toBe(fr['vues.motif.espace'])
		// « Enregistrer la vue » reste offerte : une vue privée est à chacun.
		expect((screen.getByTestId('vue-enregistrer') as HTMLButtonElement).disabled).toBe(false)
	})

	it('pendant la lecture, le sélecteur est désactivé et dit « Chargement… »', async () => {
		const enAttente = { from: () => ({ select: () => ({ eq: () => new Promise(() => {}) }) }) } as unknown as ClientCrm
		monter(enAttente)
		const selecteur = (await screen.findByTestId('selecteur-vue')) as HTMLSelectElement
		expect(selecteur.disabled).toBe(true)
		expect(selecteur.textContent).toBe(fr['vues.chargement'])
	})
})

describe('le panneau « Enregistrer la vue » (§5.75)', () => {
	it('s’ouvre à la place de sa commande, le focus dans le nom ; enregistre les filtres et choisit la vue', async () => {
		const { client: c, appels } = client([], [{ data: [{ id: 'nouvelle' }], error: null, status: 201 }])
		monter(c, { ...PARAMETRES_PAR_DEFAUT, etape: ETAPE })
		await userEvent.click(await screen.findByTestId('vue-enregistrer'))
		expect(screen.queryByTestId('vue-enregistrer')).toBeNull()
		const champ = screen.getByLabelText(fr['vues.champ.nom'])
		expect(document.activeElement).toBe(champ)
		expect((screen.getByTestId('panneau-vue-valider') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.type(champ, 'Mes relances')
		await userEvent.click(screen.getByTestId('case-publier-vue'))
		await userEvent.click(screen.getByTestId('panneau-vue-valider'))
		await waitFor(() => expect(adresse().vue).toBe('nouvelle'))
		expect(appels[0]).toEqual({
			methode: 'insert',
			valeur: { channel_id: 'channel-1', name: 'Mes relances', visibility: 'workspace', filters: { step_id: ETAPE } },
		})
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('vue-enregistrer')))
	})

	it('un nom pris est refusé sous le champ, la saisie gardée et le focus rendu au champ', async () => {
		const { client: c } = client([], [{ data: null, error: { code: '23505', message: 'duplicate key value' }, status: 409 }])
		monter(c)
		await userEvent.click(await screen.findByTestId('vue-enregistrer'))
		const champ = screen.getByLabelText(fr['vues.champ.nom'])
		await userEvent.type(champ, 'Revue du lundi')
		await userEvent.click(screen.getByTestId('panneau-vue-valider'))
		expect((await screen.findByTestId('panneau-vue-refus')).textContent).toContain(fr['vues.refus.nomPris'])
		expect((champ as HTMLInputElement).value).toBe('Revue du lundi')
		expect(document.activeElement).toBe(champ)
	})

	it('pour qui n’administre pas, la case de publication est éteinte et dit pourquoi', async () => {
		monter(client([]).client, PARAMETRES_PAR_DEFAUT, 'refusee')
		await userEvent.click(await screen.findByTestId('vue-enregistrer'))
		expect((screen.getByTestId('case-publier-vue') as HTMLInputElement).disabled).toBe(true)
		expect(screen.getByText(fr['vues.publier.refusee'])).toBeTruthy()
	})

	it('« Modifier » une vue de l’espace ne rend pas la case de publication ; Échap referme et rend le focus', async () => {
		monter(client([ESPACE]).client, { ...PARAMETRES_PAR_DEFAUT, tri: 'amount', sens: 'desc', vue: ESPACE.id })
		await userEvent.click(await screen.findByTestId('vue-modifier'))
		expect((screen.getByLabelText(fr['vues.champ.nom']) as HTMLInputElement).value).toBe('Revue du lundi')
		expect(screen.queryByTestId('case-publier-vue')).toBeNull()
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('vue-modifier')))
	})
})
