// @verifies CRM-141 (docs/BACKLOG.md) — tranche T4 : les pastilles dans l'inbox — la ligne d'un fil (trois au plus, puis
//           « +n » qui nomme les masquées), le message ouvert
//           (pastilles et origine en mots, état d'évaluation, « Réévaluer les pastilles » absente d'un envoyé, le panneau
//           et ses cases qui écrivent au clic et reviennent au refus, `Échap`, la commande refusée avec son motif, et
//           l'exclusion avec la confirmation d'« Effacer »)
// @verifies docs/SPEC-mail-subsystem.md §31.4, §31.7 ; docs/DESIGN_SYSTEM.md §5.103, §5.73, §5.59 ; décision 926
//
// Les composants RÉELS sont montés ; le client ne simule que les deux lectures et les deux fonctions de la base. La pile
// réelle est éprouvée par `e2e/ui/pastilles-inbox.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PastilleMail } from '../lib/pastilles-mail'
import type { ClientCrm } from '../lib/supabase'

const injecte = vi.hoisted(() => ({
	lignes: [] as unknown[],
	etat: 'done' as string | null,
	rpc: [] as { nom: string; args: unknown }[],
	reponseRpc: { error: null, status: 204 } as unknown,
}))

vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		return {
			from: (table: string) => {
				const maillon: Record<string, unknown> = {}
				for (const m of ['select', 'eq', 'limit']) maillon[m] = () => maillon
				maillon.then = (resoudre: (r: unknown) => unknown) =>
					resoudre(
						table === 'mail_message_labels'
							? { data: injecte.lignes, error: null, status: 200 }
							: { data: injecte.etat === null ? [] : [{ state: injecte.etat }], error: null, status: 200 },
					)
				return maillon
			},
			rpc: (nom: string, args: unknown) => {
				injecte.rpc.push({ nom, args })
				return Promise.resolve(injecte.reponseRpc)
			},
		} as unknown as ClientCrm
	},
}))

const {
	FiltresPastilles,
	PastillesLigne,
	PastillesMessageOuvert,
	VidePastilles,
	adresseDemandeUnFiltre,
	basculerDansFiltre,
	lirePastillesFiltre,
	nomsEnDisjonction,
} = await import('./PastillesInbox')

afterEach(() => {
	cleanup()
	injecte.lignes = []
	injecte.etat = 'done'
	injecte.rpc = []
	injecte.reponseRpc = { error: null, status: 204 }
})

const p = (id: string, nom: string, archivee = false, idEspace = 'ws-1'): PastilleMail => ({
	id,
	idEspace,
	nom,
	couleur: 'brand',
	descriptif: 'x',
	archivee,
})

const CATALOGUE = new Map(
	[
		p('p-adm', 'Administratif'),
		p('p-devis', 'Devis / commande'),
		p('p-lead', 'Lead'),
		p('p-spam', 'Spam'),
		p('p-autre', 'Autre espace', false, 'ws-2'),
		p('p-news', 'Newsletter', true),
		p('p-vieux', 'Ancienne', true),
	].map((x) => [x.id, x]),
)

describe('la ligne d’un fil (§5.103)', () => {
	it('trois pastilles au plus dans l’ordre du nom, puis « +n » qui nomme les masquées ; aucune : rien', () => {
		const { container } = render(<PastillesLigne ids={['p-spam', 'p-lead', 'p-adm', 'p-devis']} catalogue={CATALOGUE} />)
		const ligne = screen.getByTestId('inbox-pastilles-ligne')
		expect(within(ligne).getAllByTestId('pastille-etiquette').map((e) => e.textContent)).toEqual([
			'Administratif',
			'Devis / commande',
			'Lead',
		])
		const reste = within(ligne).getByTestId('pastille-etiquettes-reste')
		expect(reste.textContent).toBe('+1')
		expect(reste.getAttribute('aria-label')).toBe('1 autres pastilles : Spam')
		cleanup()
		const vide = render(<PastillesLigne ids={[]} catalogue={CATALOGUE} />)
		expect(vide.container.innerHTML).toBe('')
		expect(container).toBeTruthy()
	})

	it('une archivée garde sa pilule, et son nom accessible le dit', () => {
		render(<PastillesLigne ids={['p-news']} catalogue={CATALOGUE} />)
		expect(screen.getByRole('img', { name: 'Newsletter, pastille archivée' })).toBeTruthy()
	})
})

// @verifies CRM-155 (docs/BACKLOG.md) — tranche T1 : les filtres rapides — l'adresse lue et nettoyée (liste, doublons,
//           valeurs mal formées ou d'un autre espace), la bascule, les bascules `aria-pressed` de l'espace courant, le volet
//           des archivées replié puis ouvert d'office, « Toutes les pastilles » et le focus, le vide à une et à plusieurs
//           pastilles (docs/SPEC-mail-subsystem.md §31.12.1, §31.12.3, §31.12.4 ; docs/DESIGN_SYSTEM.md §5.108)
const U = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const CATALOGUE_UUID = new Map(
	[
		p(U(1), 'Administratif'),
		p(U(2), 'Lead'),
		p(U(3), 'Spam'),
		p(U(4), 'Autre espace', false, 'ws-2'),
		p(U(5), 'Newsletter', true),
	].map((x) => [x.id, x]),
)

describe('l’adresse du filtre (§31.12.3)', () => {
	it('une liste : l’ordre gardé, les doublons tombent, la casse est ramenée', () => {
		expect(lirePastillesFiltre([U(3), U(2), U(3).toUpperCase()], CATALOGUE_UUID, 'ws-1')).toEqual([U(3), U(2)])
	})

	it('une valeur mal formée, d’un autre espace ou inconnue est ignorée, une à une ; une archivée de l’espace compte', () => {
		expect(lirePastillesFiltre(['x', U(4), U(99), U(5), U(1)], CATALOGUE_UUID, 'ws-1')).toEqual([U(5), U(1)])
		expect(lirePastillesFiltre(['x', U(4)], CATALOGUE_UUID, 'ws-1')).toEqual([])
	})

	it('sans espace courant, aucun filtre ; une adresse à une seule valeur (`CRM-141`) reste valide', () => {
		expect(lirePastillesFiltre([U(2)], CATALOGUE_UUID, null)).toEqual([])
		expect(lirePastillesFiltre([U(2)], CATALOGUE_UUID, 'ws-1')).toEqual([U(2)])
	})

	it('la liste attend le catalogue seulement si l’adresse porte une valeur bien formée', () => {
		expect(adresseDemandeUnFiltre([])).toBe(false)
		expect(adresseDemandeUnFiltre(['x'])).toBe(false)
		expect(adresseDemandeUnFiltre(['x', U(2)])).toBe(true)
	})

	it('une bascule ajoute ou retire', () => {
		expect(basculerDansFiltre([U(1)], U(2))).toEqual([U(1), U(2)])
		expect(basculerDansFiltre([U(1), U(2)], U(1))).toEqual([U(2)])
	})

	it('les noms en disjonction, entre guillemets à espaces insécables', () => {
		expect(nomsEnDisjonction(['Lead', 'Spam'])).toBe('« Lead » ou « Spam »')
		expect(nomsEnDisjonction(['A', 'B', 'C'])).toBe('« A », « B » ou « C »')
	})
})

function monterFiltres(filtreInitial: readonly string[] = [], catalogue = CATALOGUE_UUID) {
	const onChange = vi.fn()
	const rendu = render(<FiltresPastilles catalogue={catalogue} idEspace="ws-1" filtre={filtreInitial} onChange={onChange} />)
	return { onChange, rendu }
}

const bascules = () => screen.getAllByTestId('inbox-bascule-pastille')

describe('les filtres rapides (§5.108)', () => {
	it('« Filtrer par pastille » nomme le groupe ; une bascule par ACTIVE de l’espace courant, dans l’ordre du nom, toutes éteintes', () => {
		monterFiltres()
		const groupe = screen.getByRole('group', { name: 'Filtrer par pastille' })
		const boutons = within(groupe).getAllByRole('button', { pressed: false })
		expect(boutons.map((b) => b.textContent)).toEqual(['Administratif', 'Lead', 'Spam'])
		expect(bascules().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
		expect(screen.queryByText('Autre espace')).toBeNull()
		expect(screen.queryByTestId('inbox-filtre-pastille-toutes')).toBeNull()
	})

	it('cliquer bascule : la pastille entre dans le filtre ; une active se dit `aria-pressed` et sort au clic', async () => {
		const { onChange, rendu } = monterFiltres()
		await userEvent.click(screen.getByRole('button', { name: 'Lead' }))
		expect(onChange).toHaveBeenLastCalledWith([U(2)])
		rendu.rerender(<FiltresPastilles catalogue={CATALOGUE_UUID} idEspace="ws-1" filtre={[U(2), U(3)]} onChange={onChange} />)
		expect(screen.getByRole('button', { name: 'Lead' }).getAttribute('aria-pressed')).toBe('true')
		expect(screen.getByRole('button', { name: 'Spam' }).getAttribute('aria-pressed')).toBe('true')
		await userEvent.click(screen.getByRole('button', { name: 'Lead' }))
		expect(onChange).toHaveBeenLastCalledWith([U(3)])
	})

	it('au clavier : `Espace` et `Entrée` basculent, le focus reste sur la bascule', async () => {
		const { onChange } = monterFiltres()
		await userEvent.tab()
		expect(document.activeElement?.textContent).toBe('Administratif')
		await userEvent.keyboard(' ')
		expect(onChange).toHaveBeenLastCalledWith([U(1)])
		await userEvent.tab()
		await userEvent.keyboard('{Enter}')
		expect(onChange).toHaveBeenLastCalledWith([U(2)])
		expect(document.activeElement?.textContent).toBe('Lead')
	})

	it('le volet des archivées : replié par défaut, il déplie un groupe nommé ; chaque archivée le dit dans son nom', async () => {
		const { onChange } = monterFiltres()
		const volet = screen.getByRole('button', { name: 'Pastilles archivées (1)' })
		expect(volet.getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByText('Newsletter')).toBeNull()
		await userEvent.click(volet)
		expect(volet.getAttribute('aria-expanded')).toBe('true')
		const groupe = screen.getByRole('group', { name: 'Pastilles archivées' })
		expect(volet.getAttribute('aria-controls')).toBe(groupe.id)
		const archivee = within(groupe).getByRole('button', { name: 'Newsletter, pastille archivée' })
		await userEvent.click(archivee)
		expect(onChange).toHaveBeenLastCalledWith([U(5)])
	})

	it('ouvert d’office quand l’adresse active une archivée', () => {
		monterFiltres([U(5)])
		expect(screen.getByRole('button', { name: 'Pastilles archivées (1)' }).getAttribute('aria-expanded')).toBe('true')
		expect(screen.getByRole('button', { name: 'Newsletter, pastille archivée' }).getAttribute('aria-pressed')).toBe('true')
	})

	it('ouvert d’office aussi quand le catalogue arrive après le premier rendu', () => {
		const onChange = vi.fn()
		const { rerender } = render(<FiltresPastilles catalogue={new Map()} idEspace="ws-1" filtre={[]} onChange={onChange} />)
		rerender(<FiltresPastilles catalogue={CATALOGUE_UUID} idEspace="ws-1" filtre={[U(5)]} onChange={onChange} />)
		expect(screen.getByRole('button', { name: 'Pastilles archivées (1)' }).getAttribute('aria-expanded')).toBe('true')
	})

	it('aucun volet sans archivée dans l’espace ; aucun bloc sans pastille dans l’espace courant', () => {
		const sansArchivee = new Map([...CATALOGUE_UUID].filter(([, x]) => !x.archivee))
		monterFiltres([], sansArchivee)
		expect(screen.queryByTestId('inbox-volet-archivees')).toBeNull()
		cleanup()
		const { container } = render(
			<FiltresPastilles catalogue={CATALOGUE_UUID} idEspace="ws-3" filtre={[]} onChange={vi.fn()} />,
		)
		expect(container.innerHTML).toBe('')
		cleanup()
		const vide = render(<FiltresPastilles catalogue={new Map()} idEspace="ws-1" filtre={[]} onChange={vi.fn()} />)
		expect(vide.container.innerHTML).toBe('')
	})

	it('« Toutes les pastilles » : rendue sous un filtre, elle le vide et rend le focus à la première bascule', async () => {
		const { onChange } = monterFiltres([U(3)])
		await userEvent.click(screen.getByRole('button', { name: 'Toutes les pastilles' }))
		expect(onChange).toHaveBeenLastCalledWith([])
		await waitFor(() => expect(document.activeElement?.textContent).toBe('Administratif'))
	})
})

describe('le vide sous le filtre (§5.108)', () => {
	it('une pastille : le texte de `CRM-141` ; plusieurs : « l’une des pastilles », en disjonction ; le geste efface', async () => {
		const onToutes = vi.fn()
		render(<VidePastilles noms={['Lead']} onToutes={onToutes} />)
		expect(screen.getByText('Aucun message ne porte la pastille « Lead » dans ce dossier.')).toBeTruthy()
		cleanup()
		render(<VidePastilles noms={['Lead', 'Spam']} onToutes={onToutes} />)
		// Testing Library ramène l'espace insécable à une espace : le texte exact se lit sur le nœud.
		expect(screen.getByText(/l’une des pastilles/).textContent).toBe(
			'Aucun message ne porte l’une des pastilles «\u00a0Lead\u00a0» ou «\u00a0Spam\u00a0» dans ce dossier.',
		)
		await userEvent.click(screen.getByRole('button', { name: 'Toutes les pastilles' }))
		expect(onToutes).toHaveBeenCalledTimes(1)
	})
})

function monterMessage({
	envoye = false,
	edition = 'permise' as const,
	onAnnonce = vi.fn(),
}: { envoye?: boolean; edition?: 'permise' | 'refusee'; onAnnonce?: (t: string) => void } = {}) {
	const signaux = { refermer: 0, confirmation: () => {} }
	render(
		<PastillesMessageOuvert
			idMessage="m1"
			idEspace="ws-1"
			envoye={envoye}
			catalogue={CATALOGUE}
			edition={edition}
			onAnnonce={onAnnonce}
			rangee={({ commandes, refermerConfirmation, onConfirmationOuverte }) => {
				signaux.refermer = refermerConfirmation
				signaux.confirmation = onConfirmationOuverte
				return (
					<div data-testid="rangee">
						<button type="button">Marquer comme non lu</button>
						{commandes}
						<button type="button">Effacer</button>
					</div>
				)
			}}
		/>,
	)
	return signaux
}

describe('le message ouvert (§5.103)', () => {
	it('ses pastilles posées, l’origine en mots ; l’état « en attente » ; les commandes entre la lecture et « Effacer »', async () => {
		injecte.lignes = [
			{ label_id: 'p-lead', source: 'llm', applied: true },
			{ label_id: 'p-spam', source: 'manual', applied: true },
			{ label_id: 'p-devis', source: 'manual', applied: false },
		]
		injecte.etat = 'pending'
		monterMessage()
		const ligne = await screen.findByTestId('inbox-pastilles-message')
		expect(within(ligne).getByRole('img', { name: "Lead, posée par l'IA" })).toBeTruthy()
		expect(within(ligne).getByRole('img', { name: 'Spam, posée à la main' })).toBeTruthy()
		expect(within(ligne).queryByText('Devis / commande')).toBeNull()
		expect(screen.getByTestId('inbox-pastilles-etat').textContent).toBe("Pastilles en attente d'évaluation")
		const boutons = Array.from(screen.getByTestId('rangee').querySelectorAll('button')).map((b) => b.textContent)
		expect(boutons).toEqual(['Marquer comme non lu', 'Réévaluer les pastilles', 'Pastilles', 'Effacer'])
	})

	it('l’échec de l’évaluation se dit en mots ; un mail envoyé n’a ni état ni « Réévaluer les pastilles »', async () => {
		injecte.etat = 'failed'
		monterMessage()
		expect((await screen.findByTestId('inbox-pastilles-etat')).textContent).toBe("Les pastilles n'ont pas pu être évaluées")
		cleanup()
		injecte.etat = null
		monterMessage({ envoye: true })
		await screen.findByTestId('inbox-pastilles')
		expect(screen.queryByTestId('inbox-reevaluer-pastilles')).toBeNull()
		expect(screen.queryByTestId('inbox-pastilles-etat')).toBeNull()
	})

	it('« Réévaluer les pastilles » appelle la base sans confirmation, et l’annonce', async () => {
		const onAnnonce = vi.fn()
		monterMessage({ onAnnonce })
		await userEvent.click(await screen.findByTestId('inbox-reevaluer-pastilles'))
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith('Réévaluation demandée.'))
		expect(injecte.rpc).toEqual([{ nom: 'request_label_evaluation', args: { p_message_id: 'm1' } }])
	})

	it('« Pastilles » ouvre le panneau : les actives de l’espace, l’archivée encore posée, l’origine ; la case écrit au clic', async () => {
		injecte.lignes = [
			{ label_id: 'p-lead', source: 'llm', applied: true },
			{ label_id: 'p-devis', source: 'manual', applied: false },
			{ label_id: 'p-news', source: 'llm', applied: true },
		]
		const onAnnonce = vi.fn()
		monterMessage({ onAnnonce })
		await screen.findByTestId('inbox-pastilles-message')
		const commande = screen.getByTestId('inbox-pastilles')
		await userEvent.click(commande)
		expect(commande.getAttribute('aria-expanded')).toBe('true')
		const panneau = screen.getByRole('group', { name: 'Pastilles de ce message' })
		const cases = within(panneau).getAllByTestId('inbox-case-pastille')
		// L'autre espace n'est pas proposé ; l'archivée non posée non plus ; l'archivée posée vient en dernier.
		expect(cases.map((c) => within(c).getByTestId('pastille-etiquette').textContent)).toEqual([
			'Administratif',
			'Devis / commande',
			'Lead',
			'Spam',
			'Newsletter',
		])
		expect(document.activeElement).toBe(within(cases[0]!).getByRole('checkbox'))
		expect(cases[1]!.textContent).toContain('retirée à la main')
		expect(cases[2]!.textContent).toContain("posée par l'IA")
		expect((within(cases[4]!).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)

		await userEvent.click(within(cases[3]!).getByRole('checkbox'))
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith('Pastille « Spam » posée.'))
		expect(injecte.rpc).toEqual([{ nom: 'set_message_label', args: { p_message_id: 'm1', p_label_id: 'p-spam', p_applied: true } }])
	})

	it('un refus de la base : la case revient, et le refus est écrit dessous', async () => {
		injecte.reponseRpc = { error: { code: '42501', message: 'forbidden' }, status: 403 }
		monterMessage()
		await userEvent.click(await screen.findByTestId('inbox-pastilles'))
		const caseLead = screen.getByRole('checkbox', { name: /Lead/ }) as HTMLInputElement
		await userEvent.click(caseLead)
		expect((await screen.findByRole('alert')).textContent).toBe(
			"Seuls les administrateurs et les business developers de l'espace posent ou retirent une pastille.",
		)
		expect(caseLead.checked).toBe(false)
	})

	it('au clavier, la case GARDE le focus pendant l’appel, et `Échap` referme ensuite', async () => {
		monterMessage()
		const commande = await screen.findByTestId('inbox-pastilles')
		await userEvent.click(commande)
		const premiere = screen.getAllByRole('checkbox')[0] as HTMLInputElement
		expect(document.activeElement).toBe(premiere)
		await userEvent.keyboard(' ')
		expect(premiere.disabled).toBe(false)
		expect(document.activeElement).toBe(premiere)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('inbox-panneau-pastilles')).toBeNull()
	})

	it('`Échap` et « Fermer » referment ; le focus revient à « Pastilles »', async () => {
		monterMessage()
		const commande = await screen.findByTestId('inbox-pastilles')
		await userEvent.click(commande)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('inbox-panneau-pastilles')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(commande))
		await userEvent.click(commande)
		await userEvent.click(screen.getByTestId('inbox-pastilles-fermer'))
		expect(screen.queryByTestId('inbox-panneau-pastilles')).toBeNull()
	})

	it('sans la capacité d’éditer l’espace : « Réévaluer » éteinte et décrite par le motif ; le panneau s’ouvre, ses cases éteintes', async () => {
		monterMessage({ edition: 'refusee' })
		const reevaluer = (await screen.findByTestId('inbox-reevaluer-pastilles')) as HTMLButtonElement
		expect(reevaluer.disabled).toBe(true)
		const motifCache = document.getElementById(reevaluer.getAttribute('aria-describedby') ?? '')
		expect(motifCache?.textContent).toContain('réservées aux administrateurs et aux business developers')
		await userEvent.click(screen.getByTestId('inbox-pastilles'))
		expect(screen.getByTestId('motif-lecture-seule')).toBeTruthy()
		for (const c of screen.getAllByRole('checkbox')) expect((c as HTMLInputElement).disabled).toBe(true)
	})

	it('le panneau et la confirmation d’« Effacer » s’excluent', async () => {
		const signaux = monterMessage()
		const avant = signaux.refermer
		await userEvent.click(await screen.findByTestId('inbox-pastilles'))
		// Ouvrir le panneau referme la confirmation…
		expect(signaux.refermer).toBe(avant + 1)
		// … et ouvrir la confirmation referme le panneau.
		signaux.confirmation()
		await waitFor(() => expect(screen.queryByTestId('inbox-panneau-pastilles')).toBeNull())
	})
})
