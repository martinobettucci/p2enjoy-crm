// @verifies CRM-136 (docs/BACKLOG.md) — tranche T3 : le panneau « Dossiers relevés » — la lecture en vol, une case par dossier
//           dans l'ordre du serveur et en retrait, les dossiers relevés absents de la boîte, le focus sur la première case,
//           l'échec du test et sa reprise, l'enregistrement de la liste cochée dans l'ordre affiché, le refus « aucun
//           dossier » traduit, l'annulation et `Échap`
// @verifies docs/SPEC-mail-subsystem.md §25.3, §25.5, §25.9 (ligne « Vitest ») ; docs/DESIGN_SYSTEM.md §5.99

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CleTraduction } from '../i18n'
import { casesDossiers, type CompteEntrant, type IssueEnregistrement } from '../lib/mail-comptes'
import type { ClientCrm } from '../lib/supabase'
import type { AccesTest } from '../lib/test-connexion-mail'
import { PanneauDossiersReleves } from './DossiersReleves'

afterEach(cleanup)

const COMPTE: CompteEntrant = {
	id: 'c-1',
	label: 'Boîte de Camille Aubert',
	owner_id: 'u-camille',
	imap_host: 'stalwart',
	imap_port: 143,
	imap_security: 'none',
	imap_username: 'admin@p2enjoy.test',
	status: 'ok',
	last_error: null,
	last_checked_at: null,
	watch_folders: ['INBOX', 'Ancien dossier'],
	backfill_months: 0,
}

const REFUS = new Proxy({}, { get: (_cible, cle) => (cle === 'aucun-dossier' ? 'admin.mailAccounts.refusal.noFolder' : 'admin.mailAccounts.refusal.unknown') }) as Readonly<
	Record<Exclude<IssueEnregistrement, 'enregistre'>, CleTraduction>
>

function acces(statut: number, corps: unknown): AccesTest {
	return {
		url: 'http://crm.test',
		cleAnonyme: 'anon',
		jeton: () => 'jwt',
		requete: async () => new Response(JSON.stringify(corps), { status: statut }),
	}
}

function client(reponse: { data: unknown; error: { message: string } | null; status: number }) {
	const appels: Record<string, unknown>[] = []
	const c = {
		rpc: async (_fonction: string, arguments_: Record<string, unknown>) => {
			appels.push(arguments_)
			return reponse
		},
	} as unknown as ClientCrm
	return { c, appels }
}

const VERDICT = { status: 'ok', error: null, checked_at: 't', folder_names: ['INBOX', 'Archives', 'Archives/2025', 'Junk Mail'] }

function monter(accesTest: AccesTest, c: ClientCrm, rappels: { onFermer?: () => void; onEnregistre?: () => void } = {}) {
	return render(
		<PanneauDossiersReleves
			client={c}
			accesTest={accesTest}
			idWorkspace="ws-1"
			compte={COMPTE}
			refus={REFUS}
			onFermer={rappels.onFermer ?? (() => undefined)}
			onEnregistre={rappels.onEnregistre ?? (() => undefined)}
		/>,
	)
}

describe('casesDossiers (§25.5)', () => {
	it('garde l’ordre du serveur, met en retrait selon la hiérarchie, et finit par les relevés absents', () => {
		expect(casesDossiers(['INBOX', 'Archives', 'Archives/2025', 'A/B/C/D'], ['INBOX', 'Disparu'])).toEqual([
			{ nom: 'INBOX', libelle: 'INBOX', niveau: 0, absent: false },
			{ nom: 'Archives', libelle: 'Archives', niveau: 0, absent: false },
			{ nom: 'Archives/2025', libelle: '2025', niveau: 1, absent: false },
			{ nom: 'A/B/C/D', libelle: 'D', niveau: 2, absent: false },
			{ nom: 'Disparu', libelle: 'Disparu', niveau: 0, absent: true },
		])
	})
	it('reconnaît le point comme séparateur quand aucun nom ne porte de barre', () => {
		expect(casesDossiers(['INBOX', 'INBOX.Sent'], [])[1]).toMatchObject({ libelle: 'Sent', niveau: 1 })
	})
})

describe('PanneauDossiersReleves (§25.5, §5.99)', () => {
	it('lit les dossiers, coche ceux qui sont relevés, dit l’absent, et met le focus sur la première case', async () => {
		monter(acces(200, VERDICT), client({ data: 'c-1', error: null, status: 200 }).c)
		expect(screen.getByTestId('dossiers-lecture').textContent).toBe('Lecture des dossiers…')
		expect((screen.getByTestId('enregistrer-dossiers') as HTMLButtonElement).disabled).toBe(true)
		const cases = await screen.findAllByTestId('case-dossier')
		expect(cases.map((c) => c.getAttribute('data-dossier'))).toEqual(['INBOX', 'Archives', 'Archives/2025', 'Junk Mail', 'Ancien dossier'])
		expect(cases.map((c) => (c as HTMLInputElement).checked)).toEqual([true, false, false, false, true])
		expect(screen.getByTestId('dossier-absent').textContent).toBe('absent de la boîte')
		await waitFor(() => expect(document.activeElement).toBe(cases[0]))
	})

	it('enregistre la liste cochée dans l’ordre affiché, par la fonction d’écriture, sans mot de passe', async () => {
		const onEnregistre = vi.fn()
		const { c, appels } = client({ data: 'c-1', error: null, status: 200 })
		monter(acces(200, VERDICT), c, { onEnregistre })
		await screen.findAllByTestId('case-dossier')
		await userEvent.click(screen.getByLabelText('Junk Mail'))
		await userEvent.click(screen.getByLabelText('Ancien dossier, absent de la boîte'))
		await userEvent.click(screen.getByTestId('enregistrer-dossiers'))
		await waitFor(() => expect(onEnregistre).toHaveBeenCalled())
		expect(appels[0]).toMatchObject({ p_workspace_id: 'ws-1', p_owner_id: 'u-camille', p_watch_folders: ['INBOX', 'Junk Mail'] })
		expect('p_password' in appels[0]!).toBe(false)
		expect('p_backfill_months' in appels[0]!).toBe(false)
	})

	it('aucune case cochée part telle quelle, et le refus de la base est traduit, le panneau restant ouvert', async () => {
		const onEnregistre = vi.fn()
		const { c, appels } = client({
			data: null,
			error: { message: 'new row violates check constraint "mail_inbound_accounts_watch_folders_non_vide"' },
			status: 400,
		})
		monter(acces(200, VERDICT), c, { onEnregistre })
		await screen.findAllByTestId('case-dossier')
		await userEvent.click(screen.getByLabelText('INBOX'))
		await userEvent.click(screen.getByLabelText('Ancien dossier, absent de la boîte'))
		await userEvent.click(screen.getByTestId('enregistrer-dossiers'))
		expect((await screen.findByTestId('refus-dossiers')).textContent).toBe('Choisissez au moins un dossier.')
		expect(appels[0]!['p_watch_folders']).toEqual([])
		expect(onEnregistre).not.toHaveBeenCalled()
	})

	it('un test refusé ne montre aucune case, dit pourquoi, et propose « Réessayer »', async () => {
		monter(acces(429, { error: 'too_soon' }), client({ data: 'c-1', error: null, status: 200 }).c)
		expect(await screen.findByTestId('dossiers-echec')).toBeTruthy()
		expect(screen.queryAllByTestId('case-dossier')).toHaveLength(0)
		expect(screen.getByTestId('dossiers-reessayer')).toBeTruthy()
	})

	it('un succès sans liste de dossiers n’en invente aucune', async () => {
		monter(acces(200, { status: 'ok', error: null, checked_at: 't' }), client({ data: 'c-1', error: null, status: 200 }).c)
		expect(await screen.findByTestId('dossiers-echec')).toBeTruthy()
		expect(screen.queryAllByTestId('case-dossier')).toHaveLength(0)
	})

	it('« Annuler » et `Échap` referment sans rien écrire', async () => {
		const onFermer = vi.fn()
		const { c, appels } = client({ data: 'c-1', error: null, status: 200 })
		monter(acces(200, VERDICT), c, { onFermer })
		const cases = await screen.findAllByTestId('case-dossier')
		await userEvent.click(screen.getByTestId('annuler-dossiers'))
		cases[0]!.focus()
		await userEvent.keyboard('{Escape}')
		expect(onFermer).toHaveBeenCalledTimes(2)
		expect(appels).toEqual([])
	})
})
