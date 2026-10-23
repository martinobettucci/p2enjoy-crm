// @verifies CRM-107 (docs/BACKLOG.md) — tranche T2 : le calculateur du coût par quart, dans « Nouvelle version »
// @verifies docs/SPEC-temps.md §7.4 bis (1 : les cinq champs, 218 par défaut ; 3 : rien n'est écrit sans « Enregistrer
//           la version » ; 4 : le résultat en direct, « Utiliser ce coût » qui remplit le champ et y place le focus ;
//           5 : un champ hors bornes dit pourquoi et le résultat se tait ; 6 : refermer oublie les valeurs) ;
//           docs/DESIGN_SYSTEM.md §5.54 ter ; décision 631

import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'
import { CalculateurCoutQuart, valeurDeCout } from './CalculateurCoutQuart'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesCoutPersonnel } from './ReglagesCoutPersonnel'

afterEach(cleanup)

const ouvrir = async (user: ReturnType<typeof userEvent.setup>) => {
	const bouton = screen.getByRole('button', { name: fr['staffCost.calc.toggle'] })
	await user.click(bouton)
	return bouton
}

describe('le calculateur seul', () => {
	it('est replié par défaut, et se déplie sur cinq champs, les jours à 218', async () => {
		const user = userEvent.setup()
		render(<CalculateurCoutQuart devise="EUR" onUtiliser={() => {}} />)
		const bouton = screen.getByRole('button', { name: fr['staffCost.calc.toggle'] })
		expect(bouton.getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByRole('group')).toBeNull()
		await ouvrir(user)
		expect(bouton.getAttribute('aria-expanded')).toBe('true')
		expect(screen.getByRole('group', { name: fr['staffCost.calc.legend'] })).toBeTruthy()
		expect(screen.getByLabelText('Salaire brut mensuel (EUR)')).toBeTruthy()
		expect(screen.getByLabelText(fr['staffCost.calc.charges'])).toBeTruthy()
		expect(screen.getByLabelText('Frais de gestion par mois (EUR)')).toBeTruthy()
		expect(screen.getByLabelText('Avantages par mois (EUR)')).toBeTruthy()
		expect((screen.getByLabelText(fr['staffCost.calc.days']) as HTMLInputElement).value).toBe('218')
		expect(screen.getByTestId('cout-calc-resultat').textContent).toBe(fr['staffCost.calc.missingGross'])
		expect((screen.getByRole('button', { name: fr['staffCost.calc.use'] }) as HTMLButtonElement).disabled).toBe(true)
	})

	it('calcule en direct et ne remet le coût qu’au geste « Utiliser ce coût »', async () => {
		const user = userEvent.setup()
		const remis: string[] = []
		render(<CalculateurCoutQuart devise="EUR" onUtiliser={(v) => remis.push(v)} />)
		await ouvrir(user)
		await user.type(screen.getByTestId('cout-calc-brut'), '3000')
		await user.type(screen.getByTestId('cout-calc-charges'), '42')
		await user.type(screen.getByTestId('cout-calc-frais'), '150')
		await user.type(screen.getByTestId('cout-calc-avantages'), '100')
		const resultat = screen.getByTestId('cout-calc-resultat')
		const enClair = (texte: string | null) => (texte ?? '').replace(/\s/g, ' ')
		expect([...resultat.children].map((e) => enClair(e.textContent))).toEqual(['Coût mensuel complet : 4 510,00 EUR', 'Coût par quart : 62,06 EUR'])
		expect(remis).toEqual([])
		await user.click(screen.getByRole('button', { name: fr['staffCost.calc.use'] }))
		expect(remis).toEqual(['62,06'])
		expect(screen.getByText(fr['staffCost.calc.used']).getAttribute('role')).toBe('status')
	})

	it('dit le champ fautif et tait le résultat', async () => {
		const user = userEvent.setup()
		render(<CalculateurCoutQuart devise="EUR" onUtiliser={() => {}} />)
		await ouvrir(user)
		await user.type(screen.getByTestId('cout-calc-brut'), '3000')
		await user.type(screen.getByTestId('cout-calc-charges'), '120')
		const charges = screen.getByTestId('cout-calc-charges')
		expect(charges.getAttribute('aria-invalid')).toBe('true')
		expect(document.getElementById(charges.getAttribute('aria-describedby') ?? '')?.textContent).toBe(fr['staffCost.calc.invalid.percent'])
		expect(screen.getByTestId('cout-calc-resultat').textContent).toBe('')
		expect((screen.getByRole('button', { name: fr['staffCost.calc.use'] }) as HTMLButtonElement).disabled).toBe(true)
	})

	it('refermer oublie les valeurs', async () => {
		const user = userEvent.setup()
		render(<CalculateurCoutQuart devise="EUR" onUtiliser={() => {}} />)
		await ouvrir(user)
		await user.type(screen.getByTestId('cout-calc-brut'), '3000')
		await ouvrir(user)
		await ouvrir(user)
		expect((screen.getByTestId('cout-calc-brut') as HTMLInputElement).value).toBe('')
	})

	it('remet le coût à la virgule, sans séparateur de milliers, au centime', () => {
		expect(valeurDeCout(62.06)).toBe('62,06')
		expect(valeurDeCout(1234.5)).toBe('1234,50')
	})
})

describe('dans « Nouvelle version »', () => {
	/** Client factice : une personne sans version ; chaque écriture est consignée. */
	function clientFactice() {
		const ecritures: unknown[] = []
		const tables: Record<string, unknown[]> = {
			workspace_members: [{ user_id: 'p1', profiles: { id: 'p1', full_name: 'Driss Lemoine' } }],
			saisies_temps: [],
			couts_personnel: [],
		}
		const chaine = (table: string) => {
			const c: Record<string, unknown> = {}
			for (const nom of ['eq', 'in', 'select', 'order', 'is']) c[nom] = () => c
			for (const nom of ['insert', 'delete']) {
				c[nom] = (valeur: unknown) => {
					ecritures.push({ table, nom, valeur })
					return c
				}
			}
			c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null, status: 200 }).then(ok)
			return c
		}
		const client = { rpc: () => Promise.resolve({ data: [], error: null, status: 200 }), from: chaine } as unknown as ClientCrm
		return { client, ecritures }
	}

	it('« Utiliser ce coût » remplit « Coût par quart », y place le focus, et n’enregistre rien', async () => {
		const user = userEvent.setup()
		const { client, ecritures } = clientFactice()
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: true }}>
				<ReglagesCoutPersonnel client={client} aujourdhui="2026-10-23" />
			</FournisseurEspace>,
		)
		await user.click(await screen.findByRole('button', { name: fr['staffCost.add'] }))
		await ouvrir(user)
		await user.type(screen.getByTestId('cout-calc-brut'), '4000')
		await user.clear(screen.getByTestId('cout-calc-jours'))
		await user.type(screen.getByTestId('cout-calc-jours'), '240')
		await user.click(screen.getByRole('button', { name: fr['staffCost.calc.use'] }))
		const champ = screen.getByLabelText(fr['staffCost.form.amount']) as HTMLInputElement
		expect(champ.value).toBe('50,00')
		expect(document.activeElement).toBe(champ)
		expect(ecritures).toEqual([])
	})
})
