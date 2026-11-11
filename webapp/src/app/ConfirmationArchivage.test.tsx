// @verifies CRM-134 (docs/BACKLOG.md) tranche T1 — la confirmation d'archivage PARTAGÉE entre Réglages et la vue du
//           channel : le corps en paramètre, `Échap` à la demande seulement (Réglages inchangé)
// @verifies docs/SPEC-channels.md §11.2 ; docs/DESIGN_SYSTEM.md §5.101, §5.13 ; décision 919

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n'
import { ConfirmationArchivage } from './ConfirmationArchivage'

afterEach(cleanup)

function monter(fermerParEchap: boolean) {
	const onAnnuler = vi.fn()
	render(
		<ConfirmationArchivage
			question="Archiver le channel « X » ?"
			corps="Le corps propre à l'écran."
			refus={null}
			enCours={false}
			onConfirmer={vi.fn()}
			onAnnuler={onAnnuler}
			{...(fermerParEchap ? { fermerParEchap: true } : {})}
		/>,
	)
	return onAnnuler
}

describe('la confirmation d’archivage partagée', () => {
	it('dit le corps que l’écran lui donne, et prend le focus sur « Archiver »', () => {
		monter(false)
		expect(screen.getByTestId('confirmation-archivage').textContent).toContain("Le corps propre à l'écran.")
		expect(document.activeElement).toBe(screen.getByRole('button', { name: fr['admin.archive.confirm.action'] }))
	})

	it('`Échap` referme quand l’écran le demande — la vue du channel', () => {
		const onAnnuler = monter(true)
		fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
		expect(onAnnuler).toHaveBeenCalledTimes(1)
	})

	it('`Échap` ne fait rien sinon — Réglages garde son comportement', () => {
		const onAnnuler = monter(false)
		fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
		expect(onAnnuler).not.toHaveBeenCalled()
	})
})
