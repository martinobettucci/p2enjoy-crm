// @verifies CRM-149 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Prompts du connecteur — la liste dans l'ordre du titre, avec
//           l'identifiant et la description ; la fiche dans le flux (titre, identifiant, description, texte) et l'envoi
//           resserré ; la modification qui garde la saisie sur un refus ; la suppression confirmée dans le flux, son bouton
//           « Supprimer », `Échap` ; les refus traduits ; l'écran lisible par tout membre, ses commandes éteintes avec
//           motif ; les états
// @verifies docs/SPEC-mcp.md §17.3, §17.7 ; docs/DESIGN_SYSTEM.md §5.104, §5.59, §5.8 ; docs/JOURNAL.md décision 930
//
// L'écran RÉEL est monté sur un client espion qui sert la liste et note chaque écriture. La pile réelle est éprouvée par
// `e2e/ui/prompts-connecteur.spec.ts` et, pour les droits, par `e2e/api/prompts-connecteur.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesPromptsConnecteur } from './ReglagesPromptsConnecteur'

afterEach(cleanup)

const LUS = [
	{ workspace_id: 'ws-1', id: 'p-point', key: 'faire-le-point', title: 'Faire le point sur une affaire', description: 'Résume une affaire.', body: 'Fais le point.' },
	{ workspace_id: 'ws-1', id: 'p-creer', key: 'creer-une-affaire', title: 'Créer une affaire complète', description: 'Crée une affaire.', body: 'Crée.' },
]

type Ecriture = { methode: string; valeur: unknown; filtres: unknown[][] }
type Reponse = { data: unknown; error: unknown; status: number }

function client(lus: readonly unknown[] | Reponse = LUS, ecriture: Reponse = { data: [{ id: 'n' }], error: null, status: 201 }) {
	const ecritures: Ecriture[] = []
	const faux = {
		from: () => {
			const maillon: Record<string, unknown> = {}
			let courante: Ecriture | null = null
			maillon.select = () => maillon
			maillon.eq = (...args: unknown[]) => {
				courante?.filtres.push(args)
				return maillon
			}
			for (const methode of ['insert', 'update', 'delete']) {
				maillon[methode] = (valeur?: unknown) => {
					courante = { methode, valeur, filtres: [] }
					ecritures.push(courante)
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) =>
				resoudre(courante !== null ? ecriture : Array.isArray(lus) ? { data: lus, error: null, status: 200 } : lus)
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures }
}

function monter(c: ClientCrm, administration: Capacite = 'permise') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<ReglagesPromptsConnecteur client={c} />
		</FournisseurEspace>,
	)
}

describe('Réglages ▸ Prompts du connecteur (docs/DESIGN_SYSTEM.md §5.104)', () => {
	it('la liste suit l’ordre du titre ; chaque ligne porte son identifiant en monospace et sa description', async () => {
		monter(client().client)
		const lignes = await screen.findAllByTestId('ligne-prompt')
		expect(lignes.map((l) => l.getAttribute('data-prompt'))).toEqual(['creer-une-affaire', 'faire-le-point'])
		const cle = within(lignes[1]!).getByTestId('cle-prompt')
		expect(cle.tagName).toBe('CODE')
		expect(cle.textContent).toBe('faire-le-point')
		expect(within(lignes[1]!).getByTestId('description-prompt').textContent).toBe('Résume une affaire.')
		// Le texte n'est pas montré dans la liste : il s'ouvre avec « Modifier ».
		expect(lignes[1]!.textContent).not.toContain('Fais le point.')
	})

	it('« Nouveau prompt » ouvre la fiche dans le flux ; l’envoi porte les quatre champs resserrés', async () => {
		const { client: c, ecritures } = client()
		monter(c)
		await screen.findAllByTestId('ligne-prompt')
		await userEvent.click(screen.getByTestId('nouveau-prompt'))
		expect(document.activeElement).toBe(screen.getByTestId('prompt-titre'))
		await userEvent.type(screen.getByTestId('prompt-titre'), '  Préparer le comité ')
		await userEvent.type(screen.getByTestId('prompt-cle'), ' preparer-le-comite ')
		await userEvent.type(screen.getByTestId('prompt-description'), ' Prépare le comité du lundi. ')
		await userEvent.type(screen.getByTestId('prompt-texte'), ' Liste les affaires.{enter}Résume-les. ')
		await userEvent.click(screen.getByTestId('prompt-enregistrer'))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			methode: 'insert',
			valeur: {
				workspace_id: 'ws-1',
				key: 'preparer-le-comite',
				title: 'Préparer le comité',
				description: 'Prépare le comité du lundi.',
				body: 'Liste les affaires.\nRésume-les.',
			},
		})
		expect(await screen.findByTestId('annonce-prompts')).toHaveProperty(
			'textContent',
			fr['admin.mcpPrompts.saved'].replace('{titre}', 'Préparer le comité'),
		)
	})

	it('« Modifier » ouvre la fiche à la place de la ligne, avec le texte ; un identifiant pris est refusé sous les champs, la saisie gardée', async () => {
		const { client: c, ecritures } = client(LUS, { data: null, error: { code: '23505', message: 'duplicate' }, status: 409 })
		monter(c)
		const [, point] = await screen.findAllByTestId('ligne-prompt')
		await userEvent.click(within(point!).getByRole('button', { name: 'Modifier le prompt Faire le point sur une affaire' }))
		expect((screen.getByTestId('prompt-texte') as HTMLTextAreaElement).value).toBe('Fais le point.')
		await userEvent.clear(screen.getByTestId('prompt-cle'))
		await userEvent.type(screen.getByTestId('prompt-cle'), 'creer-une-affaire')
		await userEvent.click(screen.getByTestId('prompt-enregistrer'))
		const refus = await screen.findByTestId('refus-prompt')
		expect(refus.textContent).toBe(fr['admin.mcpPrompts.refus.cle'])
		expect(refus.getAttribute('role')).toBe('alert')
		expect((screen.getByTestId('prompt-cle') as HTMLInputElement).value).toBe('creer-une-affaire')
		expect(ecritures[0]).toMatchObject({ methode: 'update', filtres: [['id', 'p-point']] })
		// `Échap` referme la fiche, et le focus revient à « Modifier ».
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('fiche-prompt')).toBeNull()
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Modifier le prompt Faire le point sur une affaire' })),
		)
	})

	it('« Supprimer » ouvre une confirmation dans le flux, bouton « Supprimer » ; `Échap` n’écrit rien ; confirmer supprime', async () => {
		const { client: c, ecritures } = client(LUS, { data: [{ id: 'p-creer' }], error: null, status: 200 })
		monter(c)
		const [creer] = await screen.findAllByTestId('ligne-prompt')
		await userEvent.click(within(creer!).getByRole('button', { name: 'Supprimer le prompt Créer une affaire complète' }))
		let confirmation = within(creer!).getByTestId('confirmation-archivage')
		expect(confirmation.textContent).toContain(fr['admin.mcpPrompts.delete.confirm'].replace('{titre}', 'Créer une affaire complète'))
		expect(confirmation.textContent).toContain(fr['admin.mcpPrompts.delete.confirm.body'])
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
		expect(ecritures).toHaveLength(0)

		await userEvent.click(within(creer!).getByRole('button', { name: 'Supprimer le prompt Créer une affaire complète' }))
		confirmation = within(creer!).getByTestId('confirmation-archivage')
		await userEvent.click(within(confirmation).getByRole('button', { name: fr['admin.mcpPrompts.delete.confirm.action'] }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({ methode: 'delete', filtres: [['id', 'p-creer']] })
		expect(screen.getByTestId('annonce-prompts').textContent).toBe(
			fr['admin.mcpPrompts.deleted'].replace('{titre}', 'Créer une affaire complète'),
		)
		// La ligne supprimée n'a plus de commande : le focus va à « Nouveau prompt » (§5.13), jamais au bouton qui va disparaître.
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('nouveau-prompt')))
	})

	it('une suppression filtrée par la base (zéro ligne) est dite dans la confirmation', async () => {
		monter(client(LUS, { data: [], error: null, status: 200 }).client)
		const [creer] = await screen.findAllByTestId('ligne-prompt')
		await userEvent.click(within(creer!).getByRole('button', { name: 'Supprimer le prompt Créer une affaire complète' }))
		const confirmation = within(creer!).getByTestId('confirmation-archivage')
		await userEvent.click(within(confirmation).getByRole('button', { name: fr['admin.mcpPrompts.delete.confirm.action'] }))
		expect(await within(confirmation).findByText(fr['admin.mcpPrompts.refus.sansEffet'])).toBeTruthy()
	})

	it('qui n’administre pas l’espace LIT la liste ; les commandes sont rendues, éteintes, avec le motif', async () => {
		monter(client().client, 'refusee')
		const [ligne] = await screen.findAllByTestId('ligne-prompt')
		const motif = screen.getByText(fr['rights.readonly.administration'])
		const id = motif.closest('[id]')!.getAttribute('id')
		for (const commande of [
			screen.getByTestId('nouveau-prompt'),
			within(ligne!).getByRole('button', { name: /Modifier le prompt/ }),
			within(ligne!).getByRole('button', { name: /Supprimer le prompt/ }),
		]) {
			expect(commande).toHaveProperty('disabled', true)
			expect(commande.getAttribute('aria-describedby')).toBe(id)
		}
	})

	it('pendant la lecture de la capacité, les commandes sont éteintes SANS motif', async () => {
		monter(client().client, 'en-lecture')
		await screen.findAllByTestId('ligne-prompt')
		expect(screen.getByTestId('nouveau-prompt')).toHaveProperty('disabled', true)
		expect(screen.queryByText(fr['rights.readonly.administration'])).toBeNull()
	})

	it('les états : vide, puis erreur avec « Réessayer »', async () => {
		monter(client([]).client)
		expect(await screen.findByText(fr['admin.mcpPrompts.empty.title'])).toBeTruthy()
		cleanup()
		monter(client({ data: null, error: { message: 'boom' }, status: 500 }).client)
		expect(await screen.findByText(fr['admin.mcpPrompts.error.title'])).toBeTruthy()
		expect(screen.getByRole('button', { name: fr['state.error.retry'] })).toBeTruthy()
	})
})
