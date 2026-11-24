// @verifies CRM-165 (docs/BACKLOG.md) — tranche T3 : le bloc « Consignes aux assistants » — le texte lu dans le champ, le
//           compteur, « Enregistrer » qui envoie la saisie, l'annonce, l'auteur et la date relus, « Jamais modifiées. »,
//           l'auteur parti, le socle replié et son absence, les refus du dictionnaire fermé avec la saisie gardée et le
//           focus au champ, l'erreur de lecture avec reprise ; le geste `connector_instructions_set` en mot, son détail sans
//           le texte
// @verifies docs/SPEC-mcp.md §18.3, §18.5 ; docs/DESIGN_SYSTEM.md §5.114, §5.56 ; CLAUDE.md §10 (l'écran envoie et traduit
//           le refus de la base)

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { EntreeJournal } from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { cleRefusConsignes, PlateformeMcpConsignes, texteModification } from './PlateformeMcpConsignes'
import { detailJournal, libelleGeste, texteRefus } from './presentation-plateforme'

afterEach(cleanup)

type Reponse = { readonly data: unknown; readonly error: { readonly message: string } | null; readonly status: number }
type Gestionnaire = (args: Record<string, unknown>) => Reponse
const ok = (data: unknown): Reponse => ({ data, error: null, status: 200 })
const refus = (message: string, status = 400): Reponse => ({ data: null, error: { message }, status })

function client(gestionnaires: Readonly<Record<string, Gestionnaire>>): ClientCrm {
	return {
		rpc: (nom: string, args: Record<string, unknown>) => {
			const gestionnaire = gestionnaires[nom]
			return Promise.resolve(gestionnaire === undefined ? refus('non_simule', 500) : gestionnaire(args))
		},
	} as unknown as ClientCrm
}

const SOCLE = 'P2Enjoy CRM, operated by verified lelabs SSO users.\n- Une règle fixe.'
const LIGNE = {
	body: 'Répondez en français.',
	updated_at: '2026-11-24T10:00:00Z',
	updated_by_name: 'Sabine Morel',
	base: SOCLE,
	base_published_at: '2026-11-24T09:03:29Z',
}

describe('CRM-165 — le bloc « Consignes aux assistants »', () => {
	it('lit le texte dans le champ, compte ses caractères, nomme l’auteur ; le socle est replié', async () => {
		render(<PlateformeMcpConsignes client={client({ platform_connector_instructions: () => ok([LIGNE]) })} />)
		const champ = (await screen.findByRole('textbox', { name: 'Consignes de la plateforme' })) as HTMLTextAreaElement
		expect(champ.value).toBe('Répondez en français.')
		expect(champ.maxLength).toBe(4000)
		expect(champ.rows).toBe(12)
		expect(screen.getByRole('heading', { level: 2, name: 'Consignes aux assistants' })).toBeTruthy()
		// L'aide et le compteur décrivent le champ ; le compteur n'est pas une région vivante.
		const description = (champ.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent)
		expect(description[0]).toBe('N’y écrivez ni donnée personnelle ni secret : tout assistant connecté le lit.')
		expect(description[1]?.replace(/\s/g, ' ')).toBe('21 / 4 000 caractères')
		expect(screen.getByTestId('consignes-compteur').getAttribute('aria-live')).toBeNull()
		expect(screen.getByTestId('consignes-auteur').textContent).toMatch(/^Modifiées par Sabine Morel le /)
		const socle = screen.getByTestId('consignes-socle') as HTMLDetailsElement
		expect(socle.open).toBe(false)
		expect(socle.querySelector('pre')?.textContent).toBe(SOCLE)
		expect(screen.getByText(/^Publiées par le connecteur le /)).toBeTruthy()
	})

	it('« Enregistrer » envoie la saisie, annonce, puis relit l’auteur et la date', async () => {
		const utilisateur = userEvent.setup()
		const envoyes: unknown[] = []
		let ligne: Record<string, unknown> = { ...LIGNE, body: '', updated_at: null, updated_by_name: null }
		render(
			<PlateformeMcpConsignes
				client={client({
					platform_connector_instructions: () => ok([ligne]),
					platform_set_connector_instructions: (args) => {
						envoyes.push(args['p_body'])
						ligne = { ...LIGNE, body: String(args['p_body']).trim() }
						return ok(null)
					},
				})}
			/>,
		)
		expect((await screen.findByTestId('consignes-auteur')).textContent).toBe('Jamais modifiées.')
		const champ = screen.getByRole('textbox', { name: 'Consignes de la plateforme' })
		await utilisateur.type(champ, '  Citez l’affaire.  ')
		expect(screen.getByTestId('consignes-compteur').textContent?.replace(/\s/g, ' ')).toBe('20 / 4 000 caractères')
		await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))
		expect(envoyes).toEqual(['  Citez l’affaire.  '])
		await waitFor(() =>
			expect(screen.getByTestId('annonce-consignes').textContent).toBe(
				'Consignes enregistrées. Elles valent à la prochaine connexion d’un assistant.',
			),
		)
		await waitFor(() => expect(screen.getByTestId('consignes-auteur').textContent).toMatch(/^Modifiées par Sabine Morel le /))
		expect((champ as HTMLTextAreaElement).value).toBe('Citez l’affaire.')
	})

	it.each([
		['connector_instructions_too_long', 'Le texte dépasse 4 000 caractères.'],
		['reserve_aux_superadministrateurs', 'Réservé aux superadministrateurs.'],
		['connector_instructions_invalid', 'Le texte n’a pas pu être enregistré. Réessayez.'],
		['un message brut de la base', 'Le texte n’a pas pu être enregistré. Réessayez.'],
	])('le refus « %s » est dit en clair ; la saisie est gardée, le focus revient au champ', async (message, attendu) => {
		const utilisateur = userEvent.setup()
		render(
			<PlateformeMcpConsignes
				client={client({
					platform_connector_instructions: () => ok([LIGNE]),
					platform_set_connector_instructions: () => refus(message, message === 'reserve_aux_superadministrateurs' ? 403 : 400),
				})}
			/>,
		)
		const champ = (await screen.findByRole('textbox', { name: 'Consignes de la plateforme' })) as HTMLTextAreaElement
		await utilisateur.type(champ, ' Encore.')
		await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }))
		expect((await screen.findByRole('alert')).textContent).toBe(attendu)
		expect(champ.value).toBe('Répondez en français. Encore.')
		expect(document.activeElement).toBe(champ)
		expect(champ.getAttribute('aria-invalid')).toBe('true')
		expect(screen.getByTestId('annonce-consignes').textContent).toBe('')
	})

	it('un socle jamais publié le dit ; une erreur de lecture offre « Réessayer »', async () => {
		const utilisateur = userEvent.setup()
		let lectures = 0
		render(
			<PlateformeMcpConsignes
				client={client({
					platform_connector_instructions: () => {
						lectures += 1
						return lectures === 1 ? refus('panne', 500) : ok([{ ...LIGNE, base: null, base_published_at: null }])
					},
				})}
			/>,
		)
		expect(await screen.findByText('Les consignes n’ont pas pu être lues')).toBeTruthy()
		await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }))
		expect(await screen.findByText('Le connecteur ne les a pas encore publiées : il le fait à son démarrage.')).toBeTruthy()
		expect(screen.getByTestId('consignes-socle').querySelector('pre')).toBeNull()
	})
})

describe('CRM-165 — le texte de l’auteur, les refus, le journal', () => {
	it('l’auteur parti : la date seule', () => {
		expect(texteModification({ modifieesLe: '2026-11-24T10:00:00Z', modifieesPar: null })).toMatch(/^Modifiées le /)
		expect(texteModification({ modifieesLe: null, modifieesPar: null })).toBe('Jamais modifiées.')
	})

	it('le dictionnaire fermé du bloc, et celui de la plateforme', () => {
		expect(cleRefusConsignes('network')).toBe('platform.mcp.consignes.refus.panne')
		expect(texteRefus('connector_instructions_too_long')).toBe('Le texte dépasse 4 000 caractères.')
		expect(texteRefus('connector_instructions_invalid')).toBe('Le texte n’a pas pu être enregistré. Réessayez.')
	})

	it('`connector_instructions_set` en mot ; son détail dit les longueurs, jamais le texte', () => {
		const entree = (cible: Record<string, unknown>): EntreeJournal => ({
			id: 1,
			acteur: 'Sabine Morel',
			geste: 'connector_instructions_set',
			cible,
			creeLe: '2026-11-24T10:00:00Z',
		})
		expect(libelleGeste('connector_instructions_set')).toBe('Consignes du connecteur modifiées')
		expect(detailJournal(entree({ length_before: 0, length_after: 182 }))).toBe('Consignes de la plateforme : aucun caractère → 182 caractères')
		expect(detailJournal(entree({ length_before: 1, length_after: 0 }))).toBe('Consignes de la plateforme : 1 caractère → aucun caractère')
		expect(detailJournal(entree({}))).toBe('Consignes de la plateforme : aucun caractère → aucun caractère')
	})
})
