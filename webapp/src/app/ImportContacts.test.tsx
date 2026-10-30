// @verifies CRM-071 (docs/BACKLOG.md) — tranche T5 : le panneau d'import du carnet, sans navigateur — le fichier lu, les
//           colonnes reconnues, la vérification et ses lignes écartées, la confirmation, le rapport ; les refus du fichier ;
//           la commande éteinte avec son motif pour qui ne peut pas éditer l'espace
// @verifies docs/DESIGN_SYSTEM.md §5.77, §5.59 ; docs/SPEC-vues-import-export.md §6.1, §6.2 bis

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { CommandeImport, PanneauImport } from './ImportContacts'

afterEach(cleanup)

const FICHIER = 'Nom;Email;Société;Notes\r\nAnne Petit;anne@petit.test;Petit SA;x\r\nBruno Petit;ANNE@petit.test;;y\r\nChloé;pas-un-email;;z\r\n'
const SIMULATION = [
	{ line: 1, outcome: 'created', code: null, organization_created: true },
	{ line: 2, outcome: 'skipped', code: 'duplicate_email', organization_created: false },
	{ line: 3, outcome: 'refused', code: 'invalid_email', organization_created: false },
]

function client() {
	const appels: Record<string, unknown>[] = []
	const faux = {
		rpc: (_nom: string, args: Record<string, unknown>) => {
			appels.push(args)
			return Promise.resolve({ data: SIMULATION, error: null, status: 200 })
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

describe('le panneau d’import (§5.77)', () => {
	it('lit le fichier, reconnaît les colonnes, vérifie, importe et rend le rapport', async () => {
		const { client: c, appels } = client()
		const onFermer = vi.fn()
		render(<PanneauImport client={c} idWorkspace="ws-1" onFermer={onFermer} />)
		const champ = screen.getByLabelText(fr['import.fichier'])
		expect(document.activeElement).toBe(champ)
		await userEvent.upload(champ, new File([FICHIER], 'salon.csv', { type: 'text/csv' }))

		const champs = (await screen.findAllByTestId('champ-colonne-import')) as HTMLSelectElement[]
		expect(champs.map((s) => s.value)).toEqual(['full_name', 'email', 'organization_name', 'ignorer'])
		await waitFor(() => expect(document.activeElement).toBe(champs[0]))

		await userEvent.click(screen.getByTestId('import-verifier'))
		expect((await screen.findByTestId('import-comptes')).textContent).toBe('1 ligne sera créée, 1 doublon ignoré, 1 ligne refusée.')
		expect(appels[0]).toMatchObject({
			p_workspace: 'ws-1',
			p_dry_run: true,
			p_rows: [
				{ full_name: 'Anne Petit', email: 'anne@petit.test', organization_name: 'Petit SA' },
				{ full_name: 'Bruno Petit', email: 'ANNE@petit.test', organization_name: '' },
				{ full_name: 'Chloé', email: 'pas-un-email', organization_name: '' },
			],
		})
		const ecartees = screen.getAllByTestId('ligne-ecartee-import').map((l) => l.textContent)
		expect(ecartees).toEqual([`2Bruno Petit${fr['import.motif.duplicate_email']}`, `3Chloé${fr['import.motif.invalid_email']}`])
		const confirmer = screen.getByTestId('import-confirmer')
		expect(confirmer.textContent).toBe('Importer 1 ligne')
		await waitFor(() => expect(document.activeElement).toBe(confirmer))

		await userEvent.click(confirmer)
		expect((await screen.findByTestId('import-rapport')).textContent).toBe(
			'1 ligne créée, dont 1 organisation ; 1 doublon ignoré ; 1 ligne refusée.',
		)
		expect(appels[1]).toMatchObject({ p_dry_run: false })
		expect(screen.getByTestId('import-telecharger-rapport')).toBeTruthy()
		await userEvent.click(screen.getByTestId('import-terminer'))
		expect(onFermer).toHaveBeenCalledWith(true)
	})

	it('un fichier sans ligne sous ses en-têtes est refusé sous le champ', async () => {
		render(<PanneauImport client={client().client} idWorkspace="ws-1" onFermer={() => {}} />)
		await userEvent.upload(screen.getByLabelText(fr['import.fichier']), new File(['Nom;Email\r\n'], 'vide.csv', { type: 'text/csv' }))
		expect((await screen.findByTestId('import-erreur-fichier')).textContent).toContain(fr['import.fichier.vide'])
		expect(screen.queryByTestId('tableau-colonnes-import')).toBeNull()
	})

	it('sans colonne de nom ni d’organisation, « Vérifier » reste éteint et dit pourquoi', async () => {
		render(<PanneauImport client={client().client} idWorkspace="ws-1" onFermer={() => {}} />)
		await userEvent.upload(screen.getByLabelText(fr['import.fichier']), new File(['Email\r\na@b.test\r\n'], 'mails.csv', { type: 'text/csv' }))
		expect(((await screen.findByTestId('import-verifier')) as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByText(fr['import.colonnes.aide'])).toBeTruthy()
	})

	it('Échap referme le panneau sans relire le carnet quand rien n’a été importé', async () => {
		const onFermer = vi.fn()
		render(<PanneauImport client={client().client} idWorkspace="ws-1" onFermer={onFermer} />)
		await userEvent.keyboard('{Escape}')
		expect(onFermer).toHaveBeenCalledWith(false)
	})
})

describe('la commande « Importer un fichier » (§5.77, §5.59)', () => {
	const monter = (edition: Capacite) =>
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: false, capacites: { ...CAPACITES_INCONNUES, edition } }}>
				<span id="motif-carnet">motif</span>
				<CommandeImport idMotif="motif-carnet" onOuvrir={() => {}} />
			</FournisseurEspace>,
		)

	it('refusée par la base, elle est éteinte et cite le motif du carnet', () => {
		monter('refusee')
		const commande = screen.getByTestId('importer-contacts') as HTMLButtonElement
		expect(commande.disabled).toBe(true)
		expect(commande.getAttribute('aria-describedby')).toBe('motif-carnet')
	})

	it('permise, elle est offerte', () => {
		monter('permise')
		expect((screen.getByTestId('importer-contacts') as HTMLButtonElement).disabled).toBe(false)
	})
})
