// @verifies CRM-068 (docs/BACKLOG.md) — tranche T4b1 : « Enregistrer comme modèle » sur la fiche — la commande dans la
//           rangée de « Mettre en sommeil », sa capacité, son panneau, son succès annoncé et ses refus
// @verifies docs/SPEC-checklists.md §3.6 (`save_card_as_template`) ; docs/DESIGN_SYSTEM.md §5.71, §5.59 (capacité
//           d'administrer l'espace ; motif porté par la commande), §5.3 quater (panneau dans le flux, `Échap`), §5.13
//
// L'en-tête RÉEL est monté : la commande y est observée à sa place, et le retour du focus après fermeture aussi. La pile
// réelle est éprouvée par `e2e/ui/modeles-affaires.spec.ts`.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { CardOuverte } from '../lib/formulaire'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { EnTeteCard } from './EnTeteCard'

afterEach(cleanup)

const CARD = {
	id: 'card-1',
	title: 'Audit flash — Cerfrance',
	workflow_id: 'wf-1',
	workspace_id: 'ws-1',
	current_step_id: 'step-1',
	email_local_part: 'c-cvk2w2a1',
	amount: 4800,
	currency: 'EUR',
	next_action: null,
	next_action_at: null,
	archived_at: null,
	snoozed_until: null,
	profiles: null,
	workspaces: { inbound_domain: 'crm.p2enjoy.test' },
	card_placements: [{ id: 'rattachement-1', created_at: '2026-10-01T09:00:00+00:00' }],
} as unknown as CardOuverte

type Reponse = { readonly data: unknown; readonly error: { readonly code?: string; readonly message: string } | null; readonly status: number }

function client(reponse: Reponse) {
	const appels: [string, unknown][] = []
	const faux = {
		rpc: (nom: string, args: unknown) => {
			appels.push([nom, args])
			return Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

function monter(c: ClientCrm, administration: Capacite = 'permise') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: administration === 'permise', capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<EnTeteCard card={CARD} client={c} copier={() => Promise.resolve(true)} />
		</FournisseurEspace>,
	)
}

const commande = () => screen.getByTestId('entete-card-enregistrer-modele') as HTMLButtonElement

describe('la commande « Enregistrer comme modèle »', () => {
	it('vit dans la rangée de « Mettre en sommeil », juste après elle, avec son libellé', () => {
		monter(client({ data: null, error: null, status: 200 }).client)
		const endormir = screen.getByTestId('entete-card-endormir')
		expect(commande().parentElement).toBe(endormir.parentElement)
		expect(endormir.nextElementSibling).toBe(commande())
		expect(commande().textContent).toBe(fr['card.template.save.open'])
	})

	it('refusée par la base, elle reste montée, éteinte, et cite son motif (§5.59)', () => {
		monter(client({ data: null, error: null, status: 200 }).client, 'refusee')
		expect(commande().disabled).toBe(true)
		const motif = document.getElementById(commande().getAttribute('aria-describedby')!)
		expect(motif?.textContent).toBe(fr['card.template.save.readonly'])
		expect(commande().title).toBe(fr['card.template.save.readonly'])
	})

	it('pendant la lecture de la capacité, éteinte SANS motif ; inconnue, offerte', () => {
		monter(client({ data: null, error: null, status: 200 }).client, 'en-lecture')
		expect(commande().disabled).toBe(true)
		expect(commande().getAttribute('aria-describedby')).toBeNull()
		cleanup()
		monter(client({ data: null, error: null, status: 200 }).client, 'inconnue')
		expect(commande().disabled).toBe(false)
	})
})

describe('le panneau', () => {
	it('s’ouvre prérempli du titre, dit ce qui est repris, enregistre et annonce le modèle', async () => {
		const { client: c, appels } = client({ data: 'm-9', error: null, status: 200 })
		monter(c)
		await userEvent.click(commande())
		const nom = screen.getByLabelText(fr['card.template.save.name']) as HTMLInputElement
		expect(nom.value).toBe('Audit flash — Cerfrance')
		expect(document.activeElement).toBe(nom)
		expect(screen.getByTestId('entete-card-panneau-modele').textContent).toContain(fr['card.template.save.hint'])
		await userEvent.clear(nom)
		await userEvent.type(nom, '  Audit flash  {Enter}')
		expect(appels).toEqual([['save_card_as_template', { p_placement: 'rattachement-1', p_name: 'Audit flash' }]])
		const annonce = screen.getByTestId('entete-card-modele-enregistre')
		expect(annonce.getAttribute('role')).toBe('status')
		await waitFor(() => expect(annonce.textContent).toBe('Modèle « Audit flash » enregistré.'))
		expect(screen.getByTestId('entete-card-modele-annuler').textContent).toBe(fr['card.template.save.close'])
	})

	it('un nom déjà pris : le refus s’écrit sous le champ, la saisie gardée', async () => {
		monter(client({ data: null, error: { code: '23505', message: 'duplicate key' }, status: 409 }).client)
		await userEvent.click(commande())
		await userEvent.click(screen.getByTestId('entete-card-modele-enregistrer'))
		const refus = await screen.findByRole('alert')
		expect(refus.textContent).toContain(fr['card.template.save.refus.nom'])
		expect((screen.getByLabelText(fr['card.template.save.name']) as HTMLInputElement).value).toBe('Audit flash — Cerfrance')
	})

	it('un nom blanc éteint « Enregistrer » ; `Échap` referme et rend le focus à la commande', async () => {
		const { client: c, appels } = client({ data: 'm-9', error: null, status: 200 })
		monter(c)
		await userEvent.click(commande())
		await userEvent.clear(screen.getByLabelText(fr['card.template.save.name']))
		expect((screen.getByTestId('entete-card-modele-enregistrer') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('entete-card-panneau-modele')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(commande()))
		expect(appels).toEqual([])
	})
})
