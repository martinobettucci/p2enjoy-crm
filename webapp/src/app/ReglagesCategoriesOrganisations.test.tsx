// @verifies CRM-153 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Catégories d'organisations — la liste et ses pilules, les
//           archivées sous leur case (mention textuelle, « Désarchiver » seul), la fiche dans le flux (nom, couleur),
//           l'archivage et le désarchivage SANS confirmation, le focus rendu à une ancre qui survit, les refus (dans la
//           fiche, dans la ligne), l'écran lisible par tout membre et ses commandes éteintes avec motif, les états
// @verifies docs/SPEC-organisations.md §9.1, §9.3 ; docs/DESIGN_SYSTEM.md §5.107, §5.103, §5.73, §5.59, §5.29, §5.29 bis,
//           §5.13, §5.8
//
// L'écran RÉEL est monté sur un client espion qui sert le catalogue et note chaque écriture. La pile réelle est éprouvée
// par `e2e/ui/categories-organisations-reglages.spec.ts` ; les droits, par `e2e/api/commentaires-categories-organisations.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesCategoriesOrganisations } from './ReglagesCategoriesOrganisations'

afterEach(cleanup)

const LUES = [
	{ id: 'c-part', name: 'Partenaire', color: 'success', archived_at: null },
	{ id: 'c-client', name: 'Client', color: 'brand', archived_at: null },
	{ id: 'c-ancien', name: 'Ancien client', color: 'neutral', archived_at: '2026-11-18T09:00:00Z' },
]

type Ecriture = { methode: string; valeur: unknown }
type Reponse = { data: unknown; error: unknown; status: number }

/** Le client espion : chaque lecture rend `lues()` — qui peut changer entre deux lectures —, chaque écriture `ecriture`. */
function client(lues: () => readonly unknown[] = () => LUES, ecriture: Reponse = { data: [{ id: 'n' }], error: null, status: 201 }) {
	const ecritures: Ecriture[] = []
	const faux = {
		from: () => {
			const maillon: Record<string, unknown> = {}
			let ecrit = false
			for (const methode of ['select', 'eq']) maillon[methode] = () => maillon
			for (const methode of ['insert', 'update']) {
				maillon[methode] = (valeur: unknown) => {
					ecrit = true
					ecritures.push({ methode, valeur })
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => resoudre(ecrit ? ecriture : { data: lues(), error: null, status: 200 })
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures }
}

function monter(c: ClientCrm, administration: Capacite = 'permise') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<ReglagesCategoriesOrganisations client={c} />
		</FournisseurEspace>,
	)
}

const noms = () => screen.getAllByTestId('ligne-categorie-organisation').map((l) => within(l).getByTestId('pastille-etiquette').textContent)

describe('Réglages ▸ Catégories d’organisations (docs/DESIGN_SYSTEM.md §5.107)', () => {
	it('la liste montre les actives ; « Afficher les archivées » ramène les autres, mention textuelle et « Désarchiver » seul', async () => {
		monter(client().client)
		await screen.findAllByTestId('ligne-categorie-organisation')
		expect(noms()).toEqual(['Client', 'Partenaire'])
		await userEvent.click(screen.getByLabelText(fr['admin.orgCategories.showArchived']))
		const archivee = screen.getAllByTestId('ligne-categorie-organisation')[2]!
		expect(archivee.textContent).toContain(fr['admin.orgCategories.archived'])
		expect(within(archivee).queryByRole('button', { name: /^Modifier/ })).toBeNull()
		expect(within(archivee).getByRole('button', { name: 'Désarchiver la catégorie Ancien client' })).toBeTruthy()
		expect(within(archivee).getByRole('img').getAttribute('aria-label')).toBe('Ancien client, catégorie archivée')
	})

	it('« Nouvelle catégorie » ouvre la fiche dans le flux ; l’envoi porte le nom rogné et la couleur ; le focus revient à l’ancre', async () => {
		const { client: c, ecritures } = client()
		monter(c)
		await screen.findAllByTestId('ligne-categorie-organisation')
		await userEvent.click(screen.getByTestId('nouvelle-categorie'))
		expect(screen.queryByTestId('nouvelle-categorie')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('categorie-nom'))
		// Aucun descriptif : la fiche porte le nom et la couleur seulement (§5.107).
		expect(within(screen.getByTestId('fiche-categorie-organisation')).queryByRole('textbox', { name: /Descriptif/ })).toBeNull()
		await userEvent.type(screen.getByTestId('categorie-nom'), '  Fournisseur ')
		await userEvent.click(screen.getByRole('radio', { name: /Jaune/ }))
		await userEvent.click(screen.getByTestId('categorie-enregistrer'))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toEqual({ methode: 'insert', valeur: { workspace_id: 'ws-1', name: 'Fournisseur', color: 'accent' } })
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('nouvelle-categorie')))
		expect(screen.getByTestId('annonce-categories').textContent).toBe('Catégorie « Fournisseur » enregistrée.')
	})

	it('« Modifier » ouvre la fiche à la place de la ligne, préremplie ; Échap la referme et rend le focus à « Modifier »', async () => {
		const { client: c, ecritures } = client()
		monter(c)
		await screen.findAllByTestId('ligne-categorie-organisation')
		await userEvent.click(screen.getByRole('button', { name: 'Modifier la catégorie Client' }))
		const champ = screen.getByTestId('categorie-nom') as HTMLInputElement
		expect(champ.value).toBe('Client')
		expect((screen.getByRole('radio', { name: /Bleu/ }) as HTMLInputElement).checked).toBe(true)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('fiche-categorie-organisation')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Modifier la catégorie Client' })))
		expect(ecritures).toHaveLength(0)
	})

	it('un nom pris par une ARCHIVÉE : le refus nomme « Afficher les archivées », la saisie est gardée, le focus sur le nom', async () => {
		monter(client(() => LUES, { data: null, error: { code: '23505', message: 'duplicate' }, status: 409 }).client)
		await screen.findAllByTestId('ligne-categorie-organisation')
		await userEvent.click(screen.getByTestId('nouvelle-categorie'))
		await userEvent.type(screen.getByTestId('categorie-nom'), 'ancien CLIENT')
		await userEvent.click(screen.getByTestId('categorie-enregistrer'))
		const refus = await screen.findByTestId('refus-categorie')
		expect(refus.textContent).toBe(fr['admin.orgCategories.refus.nomArchivee'])
		expect(refus.textContent).toContain('« Afficher les archivées »')
		expect((screen.getByTestId('categorie-nom') as HTMLInputElement).value).toBe('ancien CLIENT')
		expect(document.activeElement).toBe(screen.getByTestId('categorie-nom'))
	})

	it('un nom pris par une ACTIVE garde le refus ordinaire ; une forme refusée a le sien', async () => {
		monter(client(() => LUES, { data: null, error: { code: '23505', message: 'duplicate' }, status: 409 }).client)
		await screen.findAllByTestId('ligne-categorie-organisation')
		await userEvent.click(screen.getByTestId('nouvelle-categorie'))
		await userEvent.type(screen.getByTestId('categorie-nom'), 'client')
		await userEvent.click(screen.getByTestId('categorie-enregistrer'))
		expect((await screen.findByTestId('refus-categorie')).textContent).toBe(fr['admin.orgCategories.refus.nom'])
		cleanup()
		monter(client(() => LUES, { data: null, error: { code: '23514', message: 'check' }, status: 400 }).client)
		await screen.findAllByTestId('ligne-categorie-organisation')
		await userEvent.click(screen.getByTestId('nouvelle-categorie'))
		// Le bouton n'est jamais éteint par l'état du champ : un nom vide part, et la base tranche (§5.34).
		await userEvent.click(screen.getByTestId('categorie-enregistrer'))
		expect((await screen.findByTestId('refus-categorie')).textContent).toBe(fr['admin.orgCategories.refus.forme'])
	})

	it('« Archiver » écrit AUSSITÔT, sans confirmation ; la ligne quitte la liste et le focus va à « Nouvelle catégorie »', async () => {
		let catalogue: readonly unknown[] = LUES
		const { client: c, ecritures } = client(() => catalogue, { data: [{ id: 'c-client' }], error: null, status: 200 })
		monter(c)
		await screen.findAllByTestId('ligne-categorie-organisation')
		catalogue = LUES.map((l) => (l.id === 'c-client' ? { ...l, archived_at: '2026-11-18T10:00:00Z' } : l))
		await userEvent.click(screen.getByRole('button', { name: 'Archiver la catégorie Client' }))
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]!.methode).toBe('update')
		expect(typeof (ecritures[0]!.valeur as { archived_at: unknown }).archived_at).toBe('string')
		await waitFor(() => expect(noms()).toEqual(['Partenaire']))
		expect(document.activeElement).toBe(screen.getByTestId('nouvelle-categorie'))
		expect(screen.getByTestId('annonce-categories').textContent).toContain('archivée')
	})

	it('« Désarchiver » écrit aussitôt ; la ligne reste et le focus va à sa commande, devenue « Archiver »', async () => {
		let catalogue: readonly unknown[] = LUES
		const { client: c, ecritures } = client(() => catalogue, { data: [{ id: 'c-ancien' }], error: null, status: 200 })
		monter(c)
		await screen.findAllByTestId('ligne-categorie-organisation')
		await userEvent.click(screen.getByLabelText(fr['admin.orgCategories.showArchived']))
		catalogue = LUES.map((l) => (l.id === 'c-ancien' ? { ...l, archived_at: null } : l))
		await userEvent.click(screen.getByRole('button', { name: 'Désarchiver la catégorie Ancien client' }))
		await waitFor(() => expect(ecritures).toEqual([{ methode: 'update', valeur: { archived_at: null } }]))
		const commande = await screen.findByRole('button', { name: 'Archiver la catégorie Ancien client' })
		await waitFor(() => expect(document.activeElement).toBe(commande))
	})

	it('un archivage refusé se lit DANS la ligne, role="alert", et la ligne reste', async () => {
		monter(client(() => LUES, { data: [], error: null, status: 200 }).client)
		await screen.findAllByTestId('ligne-categorie-organisation')
		await userEvent.click(screen.getByRole('button', { name: 'Archiver la catégorie Client' }))
		const ligneClient = screen.getAllByTestId('ligne-categorie-organisation')[0]!
		const refus = await within(ligneClient).findByRole('alert')
		expect(refus.textContent).toBe(fr['admin.orgCategories.refus.sansEffet'])
		expect(noms()).toEqual(['Client', 'Partenaire'])
	})

	it('qui n’administre pas l’espace LIT l’écran ; les commandes sont rendues, éteintes, avec le motif', async () => {
		monter(client().client, 'refusee')
		await screen.findAllByTestId('ligne-categorie-organisation')
		const motif = screen.getByTestId('motif-lecture-seule')
		expect(motif.textContent).toBe(fr['rights.readonly.administration'])
		const nouvelle = screen.getByTestId('nouvelle-categorie') as HTMLButtonElement
		expect(nouvelle.disabled).toBe(true)
		expect(nouvelle.getAttribute('aria-describedby')).toBe(motif.id)
		for (const bouton of screen.getAllByRole('button', { name: /^(Modifier|Archiver) la catégorie/ })) {
			expect((bouton as HTMLButtonElement).disabled).toBe(true)
			expect(bouton.getAttribute('aria-describedby')).toBe(motif.id)
		}
	})

	it('pendant la lecture de la capacité, les commandes sont éteintes SANS motif (§5.59)', async () => {
		monter(client().client, 'en-lecture')
		await screen.findAllByTestId('ligne-categorie-organisation')
		expect(screen.queryByTestId('motif-lecture-seule')).toBeNull()
		expect((screen.getByTestId('nouvelle-categorie') as HTMLButtonElement).disabled).toBe(true)
	})

	it('les états : l’erreur de lecture offre « Réessayer » ; un catalogue vide le dit, « Nouvelle catégorie » restant offerte', async () => {
		const enPanne = {
			from: () => {
				const maillon: Record<string, unknown> = {}
				for (const methode of ['select', 'eq']) maillon[methode] = () => maillon
				maillon.then = (resoudre: (r: unknown) => unknown) => resoudre({ data: null, error: { message: 'fetch failed' }, status: 0 })
				return maillon
			},
		} as unknown as ClientCrm
		monter(enPanne)
		expect(await screen.findByRole('button', { name: fr['state.error.retry'] })).toBeTruthy()
		cleanup()
		monter(client(() => []).client)
		expect(await screen.findByText(fr['admin.orgCategories.empty.title'])).toBeTruthy()
		expect(screen.getByTestId('nouvelle-categorie')).toBeTruthy()
	})
})
