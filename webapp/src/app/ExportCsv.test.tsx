// @verifies CRM-071 (docs/BACKLOG.md) — tranche T4 : la commande « Exporter en CSV » — préparation, téléchargement annoncé,
//           refus traduit, nom accessible qui commence par le libellé visible
// @verifies docs/DESIGN_SYSTEM.md §5.76

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n'
import { CommandeExportCsv, type FichierPrepare } from './ExportCsv'

afterEach(cleanup)

let telecharges: string[] = []
beforeEach(() => {
	telecharges = []
	URL.createObjectURL = vi.fn(() => 'blob:export')
	URL.revokeObjectURL = vi.fn()
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
		telecharges.push(this.download)
	})
})

describe('« Exporter en CSV » (§5.76)', () => {
	it('dit « Préparation… » pendant le vol, télécharge le fichier sous son nom, et l’annonce', async () => {
		let liberer: (f: FichierPrepare) => void = () => {}
		const preparer = () => new Promise<FichierPrepare>((r) => (liberer = r))
		render(<CommandeExportCsv testId="exporter" nomAccessible="Exporter en CSV le carnet de contacts" preparer={preparer} />)
		const commande = screen.getByRole('button', { name: 'Exporter en CSV le carnet de contacts' })
		expect(commande.textContent).toContain(fr['export.commande'])
		await userEvent.click(commande)
		expect(commande.textContent).toContain(fr['export.preparation'])
		expect((commande as HTMLButtonElement).disabled).toBe(true)
		liberer({ nom: 'contacts-2026-10-30.csv', contenu: '﻿Nom\r\n' })
		await waitFor(() => expect(telecharges).toEqual(['contacts-2026-10-30.csv']))
		expect(screen.getByRole('status', { name: fr['export.live'] }).textContent).toContain('contacts-2026-10-30.csv')
		expect((commande as HTMLButtonElement).disabled).toBe(false)
	})

	it('un refus est dit sous la commande, sans rien télécharger', async () => {
		render(
			<CommandeExportCsv
				testId="exporter"
				nomAccessible="Exporter en CSV les affaires"
				preparer={() => Promise.resolve({ refus: 'export.refus.affaires.tropGrand' })}
			/>,
		)
		await userEvent.click(screen.getByTestId('exporter'))
		expect((await screen.findByRole('alert')).textContent).toContain(fr['export.refus.affaires.tropGrand'])
		expect(telecharges).toEqual([])
	})
})
