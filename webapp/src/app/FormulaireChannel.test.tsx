// @verifies CRM-100 (docs/BACKLOG.md) tranche T1 — le formulaire de channel PARTAGÉ
// @verifies CRM-116 (docs/BACKLOG.md) tranche T3 — la couleur du channel, envoyée et confiée au brouillon
//           (docs/SPEC-administration-arborescence.md §14.3 ; docs/DESIGN_SYSTEM.md §5.68)
// @verifies docs/SPEC-administration-arborescence.md §13.2 (« Nouveau workflow » rendu dans les quatre états de la
//           liste quand l'hôte fournit l'adresse, absent sinon ; le workflow attendu présélectionné une seule fois, ou
//           dit non affectable), §13.4 (le slug confié seulement s'il a été saisi), §7.2 (aucun défaut présélectionné)
// @verifies docs/DESIGN_SYSTEM.md §5.55 (un lien, une information et non une alerte), §5.13
//
// Le formulaire est monté SEUL, avec des états de liste fabriqués : l'arborescence et la vue d'un track l'éprouvent
// chacune dans son écran (`AdministrationArborescence.test.tsx`, `NouveauChannelTrack.test.tsx`).

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { FormulaireChannel, type ProprietesFormulaireChannel } from './FormulaireChannel'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import type { WorkflowAffectable } from '../lib/administration-arborescence'
import type { SaisiePortee } from '../lib/nouveau-channel'

const WORKFLOWS: readonly WorkflowAffectable[] = [
	{ id: 'wf-1', name: 'Pipeline standard', scope: 'global', is_default: true },
	{ id: 'wf-2', name: 'Partenariats', scope: 'track', is_default: false },
]

afterEach(cleanup)

/** Rend l'adresse composée à partir de la saisie : la preuve lit ce que le formulaire a confié. */
const cheminEspion = (saisie: SaisiePortee) =>
	`/reglages/workflows?nom=${encodeURIComponent(saisie.nom)}&slug=${encodeURIComponent(saisie.slug)}`

function monter(
	workflows: EtatAsync<readonly WorkflowAffectable[]>,
	options: Partial<ProprietesFormulaireChannel> = {},
) {
	const proprietes: ProprietesFormulaireChannel = {
		titre: 'Nouveau channel',
		initial: { nom: '', slug: '', description: '', idWorkflow: '', couleur: 'neutral' },
		slugModifiable: true,
		workflows,
		refus: null,
		enCours: false,
		onValider: () => undefined,
		onAnnuler: () => undefined,
		...options,
	}
	const rendu = render(
		<MemoryRouter>
			<FormulaireChannel {...proprietes} />
		</MemoryRouter>,
	)
	return {
		rerendre: (suivantes: Partial<ProprietesFormulaireChannel>) =>
			rendu.rerender(
				<MemoryRouter>
					<FormulaireChannel {...proprietes} {...suivantes} />
				</MemoryRouter>,
			),
	}
}

const lienNouveauWorkflow = () => screen.queryByRole('link', { name: 'Nouveau workflow' })

describe('« Nouveau workflow » (§13.2)', () => {
	const ETATS: readonly (readonly [string, EtatAsync<readonly WorkflowAffectable[]>])[] = [
		['chargement', enChargement()],
		['erreur', enErreur({ nature: 'network', detail: 'coupure' })],
		['vide', pret([])],
		['prête', pret(WORKFLOWS)],
	]
	it.each(ETATS)('est rendu quand la liste est en état « %s »', (_etat, workflows) => {
		monter(workflows, { cheminNouveauWorkflow: cheminEspion })
		expect(lienNouveauWorkflow()).not.toBeNull()
	})

	it('n’est pas rendu sans adresse fournie — le formulaire de modification', () => {
		monter(pret(WORKFLOWS), { slugModifiable: false })
		expect(lienNouveauWorkflow()).toBeNull()
	})

	it('l’erreur de lecture de la liste est DITE, et non un blanc', () => {
		monter(enErreur({ nature: 'network', detail: 'coupure' }), { cheminNouveauWorkflow: cheminEspion })
		expect(screen.getByRole('alert').textContent).toBe('Les workflows n’ont pas pu être chargés.')
	})

	it('liste vide : l’éditeur nu n’est plus offert à côté de l’aller-retour', () => {
		monter(pret([]), { cheminNouveauWorkflow: cheminEspion })
		expect(within(screen.getByTestId('admin-sans-workflow')).queryByRole('link')).toBeNull()
		expect(screen.getAllByRole('link')).toHaveLength(1)
	})

	it('liste vide SANS aller-retour : le lien de `CRM-094` vers l’éditeur demeure', () => {
		monter(pret([]))
		expect(
			within(screen.getByTestId('admin-sans-workflow')).getByRole('link').getAttribute('href'),
		).toBe('/reglages/workflows')
	})

	it('confie la saisie courante, le slug PROPOSÉ n’étant pas confié (§13.4)', async () => {
		const utilisateur = userEvent.setup()
		monter(pret(WORKFLOWS), { cheminNouveauWorkflow: cheminEspion })
		await utilisateur.type(screen.getByLabelText('Nom'), 'Équipe nord')
		expect(lienNouveauWorkflow()?.getAttribute('href')).toBe('/reglages/workflows?nom=%C3%89quipe%20nord&slug=')
		await utilisateur.clear(screen.getByLabelText('Slug'))
		await utilisateur.type(screen.getByLabelText('Slug'), 'nord')
		expect(lienNouveauWorkflow()?.getAttribute('href')).toBe('/reglages/workflows?nom=%C3%89quipe%20nord&slug=nord')
	})
})

describe('le workflow attendu (§13.2)', () => {
	it('présent dans la liste, il devient la valeur du sélecteur', () => {
		monter(pret(WORKFLOWS), { idWorkflowAttendu: 'wf-2' })
		expect((screen.getByLabelText('Workflow') as HTMLSelectElement).value).toBe('wf-2')
		expect(screen.queryByTestId('admin-workflow-non-affectable')).toBeNull()
	})

	it('attendu pendant le chargement, il est appliqué quand la liste arrive', () => {
		const { rerendre } = monter(enChargement(), { idWorkflowAttendu: 'wf-2' })
		rerendre({ workflows: pret(WORKFLOWS), idWorkflowAttendu: 'wf-2' })
		expect((screen.getByLabelText('Workflow') as HTMLSelectElement).value).toBe('wf-2')
	})

	it('appliqué UNE fois : une liste relue n’écrase pas le choix fait depuis', async () => {
		const utilisateur = userEvent.setup()
		const { rerendre } = monter(pret(WORKFLOWS), { idWorkflowAttendu: 'wf-2' })
		await utilisateur.selectOptions(screen.getByLabelText('Workflow'), 'wf-1')
		// La relecture réelle — le workflow de départ posé depuis le guide flottant — repasse par le chargement.
		rerendre({ workflows: enChargement(), idWorkflowAttendu: 'wf-2' })
		rerendre({ workflows: pret([...WORKFLOWS]), idWorkflowAttendu: 'wf-2' })
		expect((screen.getByLabelText('Workflow') as HTMLSelectElement).value).toBe('wf-1')
	})

	it('absent de la liste, le sélecteur reste sur « Choisir » et une INFORMATION le dit', () => {
		monter(pret(WORKFLOWS), { idWorkflowAttendu: 'wf-autre' })
		expect((screen.getByLabelText('Workflow') as HTMLSelectElement).value).toBe('')
		expect(screen.getByTestId('admin-workflow-non-affectable').textContent).toBe(
			'Le workflow créé n’est pas affectable à ce track : il est propre à un autre track.',
		)
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('sans workflow attendu, aucun défaut n’est présélectionné (§7.2)', () => {
		monter(pret(WORKFLOWS))
		expect((screen.getByLabelText('Workflow') as HTMLSelectElement).value).toBe('')
	})
})

describe('la couleur du channel (CRM-116)', () => {
	it('s’ouvre sur Gris, et la couleur choisie part avec la saisie validée', async () => {
		const utilisateur = userEvent.setup()
		const onValider = vi.fn()
		monter(pret(WORKFLOWS), { onValider })
		expect(screen.getByRole('radio', { name: 'Gris' })).toHaveProperty('checked', true)
		await utilisateur.type(screen.getByLabelText('Nom'), 'Partenariats')
		await utilisateur.selectOptions(screen.getByLabelText('Workflow'), 'wf-1')
		await utilisateur.click(screen.getByRole('radio', { name: 'Rouge' }))
		await utilisateur.click(screen.getByRole('button', { name: 'Créer' }))
		expect(onValider).toHaveBeenCalledWith(expect.objectContaining({ nom: 'Partenariats', couleur: 'danger' }))
	})

	it('est confiée à l’aller-retour vers l’éditeur, comme le nom (§14.3)', async () => {
		const utilisateur = userEvent.setup()
		const confiees: SaisiePortee[] = []
		monter(pret(WORKFLOWS), {
			cheminNouveauWorkflow: (saisie) => {
				confiees.push(saisie)
				return '/reglages/workflows'
			},
		})
		await utilisateur.click(screen.getByRole('radio', { name: 'Vert' }))
		expect(confiees.at(-1)?.couleur).toBe('success')
	})
})
