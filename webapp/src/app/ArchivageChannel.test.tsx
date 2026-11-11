// @verifies CRM-134 (docs/BACKLOG.md) tranche T1 — « Archiver le channel » et sa confirmation, le panneau des archivés et
//           « Désarchiver »
// @verifies docs/SPEC-channels.md §11.2 (la confirmation dans le flux, `Échap`, l'écriture de Réglages et ses trois
//           issues : réussite, refus, zéro ligne), §11.3 (le panneau : noms non cliquables, mention « Archivé »,
//           désarchiver sans confirmation), §11.4 (les commandes éteintes avec leur motif quand la base refuse
//           l'administration) ; docs/DESIGN_SYSTEM.md §5.101, §5.59 ; docs/SPEC-webapp.md §10 (aucun texte en dur)
//
// Le client est un double qui ENREGISTRE l'écriture envoyée : la table, la valeur d'`archived_at` et la ligne visée sont
// ce que la base recevra. Le refus réel de la base est prouvé par `e2e/api/channels-archivage.spec.ts`.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n'
import type { Capacite } from '../lib/capacites'
import type { Channel } from '../lib/channels'
import type { ClientCrm } from '../lib/supabase'
import { BarreOutilsChannel, PanneauArchives } from './ArchivageChannel'
import { FournisseurEspace } from './ContexteEspace'

const CHANNEL: Channel = {
	id: 'c-2',
	name: 'Grands comptes',
	slug: 'grands-comptes',
	position: 2,
	workflow_id: 'wf-1',
	description: null,
	color: 'brand',
}
const ARCHIVE: Channel = { ...CHANNEL, id: 'c-3', name: "Appels d'offres", slug: 'appels-offres', color: 'accent' }

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }
type Ecriture = { table: string; valeurs: Record<string, unknown>; id: unknown }

function clientEcrivant(reponse: Reponse): { client: ClientCrm; ecritures: Ecriture[] } {
	const ecritures: Ecriture[] = []
	const client = {
		from: (table: string) => ({
			update: (valeurs: Record<string, unknown>) => ({
				eq: (_colonne: string, id: unknown) => ({
					select: () => {
						ecritures.push({ table, valeurs, id })
						return Promise.resolve(reponse)
					},
				}),
			}),
		}),
	} as unknown as ClientCrm
	return { client, ecritures }
}

const APPLIQUE: Reponse = { data: [{ id: 'c-2' }], error: null, status: 200 }
const SANS_EFFET: Reponse = { data: [], error: null, status: 200 }

function dansEspace(administration: Capacite, enfant: React.ReactNode) {
	return (
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: false, capacites: { administration, edition: administration } }}>
			{enfant}
		</FournisseurEspace>
	)
}

afterEach(cleanup)

describe('« Archiver le channel » (§11.2)', () => {
	function monter(client: ClientCrm, onArchive = vi.fn(), administration: Capacite = 'permise') {
		render(
			dansEspace(
				administration,
				<BarreOutilsChannel client={client} channel={CHANNEL} onArchive={onArchive}>
					<span data-testid="bascule">bascule</span>
				</BarreOutilsChannel>,
			),
		)
		return onArchive
	}

	it('partage la barre d’outils avec la bascule, et n’écrit rien avant la confirmation', () => {
		const { client, ecritures } = clientEcrivant(APPLIQUE)
		monter(client)
		expect(screen.getByTestId('bascule')).toBeTruthy()
		const commande = screen.getByTestId('commande-archiver-channel')
		expect(commande.textContent).toBe(fr['channel.archive.action'])
		fireEvent.click(commande)
		expect(ecritures).toHaveLength(0)
		const confirmation = screen.getByTestId('confirmation-archivage')
		expect(confirmation.textContent).toContain(fr['admin.archive.confirm.channel'].replace('{nom}', 'Grands comptes'))
		expect(confirmation.textContent).toContain(fr['channel.archive.confirm.body'])
	})

	it('le focus entre sur « Archiver » ; `Échap` referme et le rend à la commande', async () => {
		const { client } = clientEcrivant(APPLIQUE)
		monter(client)
		fireEvent.click(screen.getByTestId('commande-archiver-channel'))
		const archiver = screen.getByRole('button', { name: fr['admin.archive.confirm.action'] })
		expect(document.activeElement).toBe(archiver)
		fireEvent.keyDown(archiver, { key: 'Escape' })
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('commande-archiver-channel')))
	})

	it('« Annuler » referme sans écrire', () => {
		const { client, ecritures } = clientEcrivant(APPLIQUE)
		monter(client)
		fireEvent.click(screen.getByTestId('commande-archiver-channel'))
		fireEvent.click(screen.getByRole('button', { name: fr['admin.action.cancel'] }))
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
		expect(ecritures).toHaveLength(0)
	})

	it('confirmer écrit `archived_at` sur CE channel, puis rend la main à la route', async () => {
		const { client, ecritures } = clientEcrivant(APPLIQUE)
		const onArchive = monter(client)
		fireEvent.click(screen.getByTestId('commande-archiver-channel'))
		fireEvent.click(screen.getByRole('button', { name: fr['admin.archive.confirm.action'] }))
		await waitFor(() => expect(onArchive).toHaveBeenCalledWith(CHANNEL))
		expect(ecritures).toHaveLength(1)
		expect(ecritures[0]!.table).toBe('channels')
		expect(ecritures[0]!.id).toBe('c-2')
		expect(typeof ecritures[0]!.valeurs['archived_at']).toBe('string')
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
	})

	it('zéro ligne rendue est un REFUS, écrit dans la confirmation qui reste ouverte — jamais une réussite', async () => {
		const { client } = clientEcrivant(SANS_EFFET)
		const onArchive = monter(client)
		fireEvent.click(screen.getByTestId('commande-archiver-channel'))
		fireEvent.click(screen.getByRole('button', { name: fr['admin.archive.confirm.action'] }))
		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toContain(fr['admin.refus.sans-effet'])
		expect(screen.getByTestId('confirmation-archivage')).toBeTruthy()
		expect(onArchive).not.toHaveBeenCalled()
	})

	it('un refus de la base est écrit avec son texte', async () => {
		const { client } = clientEcrivant({ data: null, error: { message: 'permission denied', code: '42501' }, status: 403 })
		const onArchive = monter(client)
		fireEvent.click(screen.getByTestId('commande-archiver-channel'))
		fireEvent.click(screen.getByRole('button', { name: fr['admin.archive.confirm.action'] }))
		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toContain(fr['admin.refus.forbidden'])
		expect(onArchive).not.toHaveBeenCalled()
	})

	it('l’administration refusée par la base : la commande reste RENDUE, éteinte, avec son motif (§5.59)', () => {
		const { client } = clientEcrivant(APPLIQUE)
		monter(client, vi.fn(), 'refusee')
		const commande = screen.getByTestId('commande-archiver-channel') as HTMLButtonElement
		expect(commande.disabled).toBe(true)
		expect(commande.textContent).toBe(fr['channel.archive.action'])
		const motif = document.getElementById(commande.getAttribute('aria-describedby') ?? '')
		expect(motif?.textContent).toBe(fr['rights.readonly.administration'])
	})

	it('pendant la lecture de la capacité, la commande est éteinte sans motif prétendu', () => {
		const { client } = clientEcrivant(APPLIQUE)
		monter(client, vi.fn(), 'en-lecture')
		const commande = screen.getByTestId('commande-archiver-channel') as HTMLButtonElement
		expect(commande.disabled).toBe(true)
		expect(commande.hasAttribute('aria-describedby')).toBe(false)
	})
})

describe('le panneau des archivés et « Désarchiver » (§11.3)', () => {
	function monter(client: ClientCrm, onDesarchive = vi.fn(), administration: Capacite = 'permise') {
		render(dansEspace(administration, <PanneauArchives client={client} archives={[ARCHIVE]} onDesarchive={onDesarchive} />))
		return onDesarchive
	}

	it('nomme chaque archivé avec la mention « Archivé », sans lien', () => {
		const { client } = clientEcrivant(APPLIQUE)
		monter(client)
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(fr['channel.archives.title'])
		const ligne = screen.getByTestId('ligne-channel-archive')
		expect(ligne.textContent).toContain("Appels d'offres")
		expect(ligne.textContent).toContain(fr['admin.tree.archived'])
		expect(ligne.querySelector('a')).toBeNull()
	})

	it('« Désarchiver » écrit `archived_at = null` sans confirmation, puis rend la main avec la liste d’avant', async () => {
		const { client, ecritures } = clientEcrivant(APPLIQUE)
		const onDesarchive = monter(client)
		const bouton = screen.getByRole('button', { name: fr['channel.archives.unarchive.aria'].replace('{nom}', "Appels d'offres") })
		fireEvent.click(bouton)
		await waitFor(() => expect(onDesarchive).toHaveBeenCalledWith(ARCHIVE, [ARCHIVE]))
		expect(ecritures).toEqual([{ table: 'channels', valeurs: { archived_at: null }, id: 'c-3' }])
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
	})

	it('un refus s’écrit DANS LA LIGNE, et rien n’est rendu', async () => {
		const { client } = clientEcrivant(SANS_EFFET)
		const onDesarchive = monter(client)
		fireEvent.click(screen.getByTestId('desarchiver-channel'))
		const alerte = await screen.findByRole('alert')
		expect(screen.getByTestId('ligne-channel-archive').contains(alerte)).toBe(true)
		expect(onDesarchive).not.toHaveBeenCalled()
	})

	it('l’administration refusée : « Désarchiver » éteint, et le motif posé une fois en tête du panneau', () => {
		const { client } = clientEcrivant(APPLIQUE)
		monter(client, vi.fn(), 'refusee')
		const bouton = screen.getByTestId('desarchiver-channel') as HTMLButtonElement
		expect(bouton.disabled).toBe(true)
		const motif = screen.getByTestId('motif-lecture-seule')
		expect(motif.textContent).toBe(fr['rights.readonly.administration'])
		expect(bouton.getAttribute('aria-describedby')).toBe(motif.id)
	})
})
