// @verifies INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T2.b : Réglages ▸ Fuseau horaire — le fuseau lu et
//           montré (le courant toujours proposé, les options groupées par région), l'écriture par la fonction, le succès annoncé, les refus
//           traduits sous le champ avec la saisie gardée et le focus rendu au champ, l'écran lisible par tout membre, le champ et la commande
//           éteints avec leur motif, les états (chargement, erreur avec reprise, aucun espace)
// @verifies docs/SPEC-modeles-emails.md §8.6 ter ; docs/DESIGN_SYSTEM.md §5.117, §5.59, §5.8 ; docs/JOURNAL.md décision 1000
//
// L'écran RÉEL est monté sur un client espion qui sert la ligne de l'espace et note chaque appel de fonction. La pile réelle est éprouvée par
// `e2e/ui/fuseau-espace.spec.ts` et, pour les droits en base, par `e2e/api/fuseau-espace.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesFuseauEspace } from './ReglagesFuseauEspace'

afterEach(cleanup)

type Reponse = { data: unknown; error: unknown; status: number }
type AppelFonction = { fonction: string; arguments: unknown }

function client(lecture: Reponse | Reponse[] = { data: [{ id: 'ws-1', timezone: 'Europe/Paris' }], error: null, status: 200 }, ecriture: Reponse = { data: null, error: null, status: 204 }) {
	const lectures = Array.isArray(lecture) ? [...lecture] : [lecture]
	const appels: AppelFonction[] = []
	let nombreDeLectures = 0
	const faux = {
		from: () => {
			const maillon: Record<string, unknown> = {}
			maillon.select = () => maillon
			maillon.eq = () => maillon
			maillon.then = (resoudre: (r: unknown) => unknown) => {
				nombreDeLectures += 1
				return resoudre(lectures.length > 1 ? lectures.shift() : lectures[0])
			}
			return maillon
		},
		rpc: (fonction: string, arguments_: unknown) => {
			appels.push({ fonction, arguments: arguments_ })
			return Promise.resolve(ecriture)
		},
	} as unknown as ClientCrm
	return { client: faux, appels, lectures: () => nombreDeLectures }
}

function monter(c: ClientCrm, administration: Capacite = 'permise', idWorkspace: string | null = 'ws-1') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace, estAdmin: true, capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<ReglagesFuseauEspace client={c} />
		</FournisseurEspace>,
	)
}

const champ = () => screen.findByTestId('champ-fuseau') as Promise<HTMLSelectElement>

describe('Réglages ▸ Fuseau horaire (docs/DESIGN_SYSTEM.md §5.117)', () => {
	it('lit le fuseau de l’espace, le montre dans un select natif libellé, et dit l’heure qu’il y est', async () => {
		monter(client().client)
		const selection = await champ()
		expect(selection.value).toBe('Europe/Paris')
		expect(screen.getByLabelText(fr['admin.timezone.field'])).toBe(selection)
		expect(selection.tagName).toBe('SELECT')
		expect(selection.disabled).toBe(false)
		const heure = screen.getByTestId('heure-fuseau')
		expect(heure.textContent).toMatch(/\d\d:\d\d/)
		expect(selection.getAttribute('aria-describedby')).toBe(heure.id)
	})

	it('groupe les options par région, en mots traduits, UTC hors de tout groupe', async () => {
		monter(client().client)
		const selection = await champ()
		const groupes = Array.from(selection.querySelectorAll('optgroup')).map((g) => g.label)
		expect(groupes).toContain(fr['admin.timezone.region.Europe'])
		expect(groupes).toContain(fr['admin.timezone.region.America'])
		expect(groupes).not.toContain('UTC')
		const utc = Array.from(selection.options).find((o) => o.value === 'UTC')
		expect(utc?.parentElement).toBe(selection)
	})

	it('propose TOUJOURS le fuseau courant, même un alias que le navigateur ne liste pas', async () => {
		monter(client({ data: [{ id: 'ws-1', timezone: 'America/Montreal' }], error: null, status: 200 }).client)
		const selection = await champ()
		expect(selection.value).toBe('America/Montreal')
		expect(Array.from(selection.options).some((o) => o.value === 'America/Montreal')).toBe(true)
	})

	it('enregistre par la fonction, avec l’espace et le fuseau choisi, annonce le succès et relit', async () => {
		const { client: c, appels, lectures } = client()
		monter(c)
		const selection = await champ()
		await userEvent.selectOptions(selection, 'Europe/Lisbon')
		await userEvent.click(screen.getByTestId('enregistrer-fuseau'))
		await waitFor(() => expect(appels).toHaveLength(1))
		expect(appels[0]).toEqual({ fonction: 'workspace_set_timezone', arguments: { p_workspace_id: 'ws-1', p_timezone: 'Europe/Lisbon' } })
		expect((await screen.findByTestId('annonce-fuseau')).textContent).toBe(fr['admin.timezone.saved'].replace('{fuseau}', 'Europe/Lisbon'))
		await waitFor(() => expect(lectures()).toBe(2))
		// Le focus reste sur la commande, jamais démontée.
		expect(document.activeElement).toBe(screen.getByTestId('enregistrer-fuseau'))
	})

	it('n’éteint pas la commande parce que le champ n’a pas changé : aucune garde de saisie ne double la base', async () => {
		const { client: c, appels } = client()
		monter(c)
		await champ()
		const bouton = screen.getByTestId('enregistrer-fuseau') as HTMLButtonElement
		expect(bouton.disabled).toBe(false)
		await userEvent.click(bouton)
		await waitFor(() => expect(appels).toHaveLength(1))
	})

	it('traduit le refus « interdit » sous le champ, garde la saisie et rend le focus au champ', async () => {
		const { client: c } = client(undefined, { data: null, error: { code: '42501', message: 'forbidden' }, status: 403 })
		monter(c)
		const selection = await champ()
		await userEvent.selectOptions(selection, 'Asia/Tokyo')
		await userEvent.click(screen.getByTestId('enregistrer-fuseau'))
		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe(fr['admin.timezone.refus.forbidden'])
		expect(selection.value).toBe('Asia/Tokyo')
		expect(document.activeElement).toBe(selection)
		// Rechoisir efface le refus : il parlait d'une autre saisie.
		await userEvent.selectOptions(selection, 'Europe/Paris')
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('traduit le fuseau inconnu, jamais le message du serveur', async () => {
		const { client: c } = client(undefined, { data: null, error: { code: '22023', message: 'invalid_timezone' }, status: 400 })
		monter(c)
		await userEvent.selectOptions(await champ(), 'Asia/Tokyo')
		await userEvent.click(screen.getByTestId('enregistrer-fuseau'))
		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe(fr['admin.timezone.refus.inconnu'])
		expect(alerte.textContent).not.toContain('invalid_timezone')
	})

	it('dit la panne générique pour un code inconnu', async () => {
		const { client: c } = client(undefined, { data: null, error: { code: 'XX000', message: 'boom' }, status: 500 })
		monter(c)
		await userEvent.click(await screen.findByTestId('enregistrer-fuseau'))
		expect((await screen.findByRole('alert')).textContent).toBe(fr['admin.timezone.refus.panne'])
	})
})

describe('l’écran se lit par tout membre, sa commande suit la capacité de la base (§5.59)', () => {
	it('refusée : le champ et la commande sont montés, éteints, lisibles, et citent le motif de l’administration', async () => {
		monter(client().client, 'refusee')
		const selection = await champ()
		expect(selection.disabled).toBe(true)
		expect(selection.value).toBe('Europe/Paris')
		const motif = screen.getByTestId('motif-lecture-seule')
		expect(motif.textContent).toContain(fr['rights.readonly.administration'])
		const bouton = screen.getByTestId('enregistrer-fuseau') as HTMLButtonElement
		expect(bouton.disabled).toBe(true)
		expect(bouton.getAttribute('aria-describedby')).toBe(motif.id)
		expect(selection.getAttribute('aria-describedby')).toContain(motif.id)
	})

	it('pendant la lecture de la capacité : éteints, sans motif — rien n’est reproché avant d’être su', async () => {
		monter(client().client, 'en-lecture')
		expect((await champ()).disabled).toBe(true)
		expect((screen.getByTestId('enregistrer-fuseau') as HTMLButtonElement).disabled).toBe(true)
		expect(screen.queryByTestId('motif-lecture-seule')).toBeNull()
	})

	it('permise : le champ et la commande sont offerts, sans motif', async () => {
		monter(client().client, 'permise')
		expect((await champ()).disabled).toBe(false)
		expect(screen.queryByTestId('motif-lecture-seule')).toBeNull()
	})
})

describe('les états (§5.8)', () => {
	it('chargement : un squelette, ni champ ni commande', () => {
		monter({ from: () => ({ select: () => ({ eq: () => new Promise(() => undefined) }) }) } as unknown as ClientCrm)
		expect(screen.queryByTestId('champ-fuseau')).toBeNull()
		expect(screen.queryByTestId('enregistrer-fuseau')).toBeNull()
		expect(screen.getByRole('status', { name: fr['state.loading.aria'] })).toBeTruthy()
	})

	it('erreur de lecture : le titre, la reprise qui RELIT, puis le champ', async () => {
		const { client: c, lectures } = client([
			{ data: null, error: { message: 'x' }, status: 500 },
			{ data: [{ id: 'ws-1', timezone: 'Europe/Paris' }], error: null, status: 200 },
		])
		monter(c)
		expect(await screen.findByText(fr['admin.timezone.error.title'])).toBeTruthy()
		expect(screen.queryByTestId('champ-fuseau')).toBeNull()
		await userEvent.click(screen.getByRole('button', { name: fr['state.error.retry'] }))
		expect((await champ()).value).toBe('Europe/Paris')
		expect(lectures()).toBe(2)
	})

	it('un espace que la RLS masque est une erreur, jamais un fuseau deviné', async () => {
		monter(client({ data: [], error: null, status: 200 }).client)
		expect(await screen.findByText(fr['admin.timezone.error.title'])).toBeTruthy()
		expect(screen.queryByTestId('champ-fuseau')).toBeNull()
	})

	it('aucun espace ouvert : l’état commun, rien n’est lu', () => {
		const { client: c, lectures } = client()
		monter(c, 'permise', null)
		expect(screen.getByText(fr['admin.timezone.noworkspace'])).toBeTruthy()
		expect(lectures()).toBe(0)
	})

	it('le titre et la phrase d’en-tête disent ce que le réglage change, et ce qu’il ne change pas', async () => {
		monter(client().client)
		await champ()
		const racine = screen.getByTestId('reglages-fuseau-espace')
		expect(within(racine).getByRole('heading', { level: 2 }).textContent).toBe(fr['admin.timezone.title'])
		expect(racine.textContent).toContain('restent celles de votre navigateur')
	})
})
