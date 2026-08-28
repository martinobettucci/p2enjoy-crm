// @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 3c : le montage
//           de la sous-surface de gestion des occurrences
// @verifies docs/SPEC-costs.md §2.2 (périodes et enveloppe facultatives, clôture indépendante du
//           budget), §4.1 bis.1 (ce que la liste montre, les occurrences closes NON masquées),
//           §4.1 bis.2 (les cinq gestes), §4.1 bis.3 (seul le retrait est confirmé),
//           §4.1 bis.4 (le dictionnaire fermé des refus)
// @verifies docs/DESIGN_SYSTEM.md §5.47 (la forme de la sous-surface), §5.13 (formulaires dans le
//           flux, focus entrant dans le premier champ, refus DANS la surface concernée),
//           §5.8 (les quatre états), §1 (l'état est un mot, pas une teinte)
//
// CE FICHIER ÉPROUVE LE MONTAGE, PAS LE MODULE. `occurrences.test.ts` couvre déjà la forme des
// requêtes, la classification des refus et l'envoi des attributs facultatifs ; les répéter ici les
// ferait diverger. Ce qui est éprouvé ici est ce que le montage ajoute : les quatre états, ce que la
// liste rend et ce qu'elle laisse vide, la place du refus, et le fait que seul le retrait demande
// confirmation.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanneauOccurrences, texteRefusOccurrence } from './PanneauOccurrences'
import { t } from '../i18n'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}

const OUVERTE = {
	id: 'o-fevrier',
	budget_id: 'b-pub',
	label: 'Février 2026',
	period_start: '2026-02-01',
	period_end: '2026-02-28',
	planned_amount: 2500,
	closed_at: null,
}

const CLOSE = {
	id: 'o-janvier',
	budget_id: 'b-pub',
	label: 'Janvier 2026',
	period_start: '2026-01-01',
	period_end: '2026-01-31',
	planned_amount: 2000,
	closed_at: '2026-02-05T17:00:00+00:00',
}

const NUE = {
	id: 'o-nue',
	budget_id: 'b-pub',
	label: 'Hors période',
	period_start: null,
	period_end: null,
	planned_amount: null,
	closed_at: null,
}

/**
 * Client factice rendant les réponses en séquence.
 *
 * Il est volontairement plus pauvre que l'espion d'`occurrences.test.ts`, qui enregistre chaque
 * filtre : la forme des requêtes est le contrat du module et se prouve là-bas.
 */
function clientQuiRend(reponses: readonly Reponse[]): ClientCrm {
	let rang = 0
	return {
		from: () => {
			const reponse = reponses[rang++] ?? { data: [], error: null, status: 200 }
			const chaine: Record<string, unknown> = {}
			const rendre = () => chaine
			chaine.eq = rendre
			chaine.is = rendre
			chaine.order = rendre
			chaine.select = rendre
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponse).then(resoudre)
			return {
				select: rendre,
				insert: rendre,
				update: rendre,
				delete: rendre,
			}
		},
	} as unknown as ClientCrm
}

const liste = (lignes: readonly unknown[]): Reponse => ({ data: [...lignes], error: null, status: 200 })

function monter(client: ClientCrm, onAnnonce = vi.fn(), onComptesPerimes = vi.fn()) {
	render(
		<PanneauOccurrences
			client={client}
			idBudget="b-pub"
			nomBudget="Publicité 2026"
			onAnnonce={onAnnonce}
			onComptesPerimes={onComptesPerimes}
		/>,
	)
	return { onAnnonce, onComptesPerimes }
}

// ---------------------------------------------------------------------------------------------
// Les quatre états du §5.8
// ---------------------------------------------------------------------------------------------

describe('les quatre états de la liste', () => {
	it('rend la liste quand la lecture aboutit, et NOMME le budget dont elle parle (§5.47)', async () => {
		monter(clientQuiRend([liste([OUVERTE, CLOSE])]))
		expect(await screen.findByTestId('liste-occurrences')).toBeTruthy()
		expect(screen.getAllByTestId('ligne-occurrence')).toHaveLength(2)
		// Détachée de la ligne qui l'a ouverte, la sous-surface doit dire de quel budget elle parle.
		expect(screen.getByText(t('admin.occurrences.title', { budget: 'Publicité 2026' }))).toBeTruthy()
	})

	it('rend une erreur annoncée quand la lecture est refusée', async () => {
		monter(clientQuiRend([{ data: null, error: { message: 'refusé' }, status: 403 }]))
		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe(t('admin.occurrences.error'))
	})

	it("l'état vide N'EST PAS un défaut : il dit la conséquence et garde le geste", async () => {
		// « Tant qu'il n'en porte pas, aucune ligne de coût ne peut lui être rattachée » — c'est le
		// §2.2, et c'est précisément le trou que cette tranche bouche.
		monter(clientQuiRend([liste([])]))
		expect(await screen.findByTestId('occurrences-vide')).toBeTruthy()
		expect(screen.getByRole('button', { name: t('admin.occurrences.action.new') })).toBeTruthy()
	})

	it("garde la commande d'ouverture dans les QUATRE états, l'erreur comprise", async () => {
		monter(clientQuiRend([{ data: null, error: { message: 'refusé' }, status: 403 }]))
		await screen.findByRole('alert')
		expect(screen.getByRole('button', { name: t('admin.occurrences.action.new') })).toBeTruthy()
	})
})

// ---------------------------------------------------------------------------------------------
// Ce que la liste rend — §4.1 bis.1
// ---------------------------------------------------------------------------------------------

describe('la liste', () => {
	it("NE MASQUE PAS les occurrences closes, contrairement aux budgets (§4.1 bis.1)", async () => {
		// L'onglet « À saisir » du §4.8 liste précisément les lignes des occurrences closes : une
		// liste qui les cacherait ferait chercher ailleurs ce qui est là.
		monter(clientQuiRend([liste([OUVERTE, CLOSE])]))
		await screen.findByTestId('liste-occurrences')
		expect(screen.getByText('Janvier 2026')).toBeTruthy()
		expect(screen.getByText('Février 2026')).toBeTruthy()
	})

	it("rend l'état par un MOT et non par une teinte (§1)", async () => {
		monter(clientQuiRend([liste([OUVERTE, CLOSE])]))
		await screen.findByTestId('liste-occurrences')
		const etats = screen.getAllByTestId('occurrence-etat').map((noeud) => noeud.textContent)
		expect(etats).toContain(t('admin.occurrences.state.open'))
		expect(etats).toContain(t('admin.occurrences.state.closed'))
	})

	it('laisse période et enveloppe VIDES quand rien ne les porte (§2.2)', async () => {
		// Un tiret y serait une donnée que personne n'a saisie, et « 0 » une décision que personne
		// n'a prise.
		monter(clientQuiRend([liste([NUE])]))
		await screen.findByTestId('liste-occurrences')
		expect(screen.getByTestId('occurrence-periode').textContent).toBe('')
		expect(screen.getByTestId('occurrence-enveloppe').textContent).toBe('')
	})

	it('rend une période complète, et une période à demi renseignée sans inventer la borne absente', async () => {
		monter(
			clientQuiRend([liste([OUVERTE, { ...NUE, id: 'o-demi', period_start: '2026-04-01' }])]),
		)
		await screen.findByTestId('liste-occurrences')
		const periodes = screen.getAllByTestId('occurrence-periode').map((n) => n.textContent)
		expect(periodes).toContain(
			t('admin.occurrences.period.range', { debut: '2026-02-01', fin: '2026-02-28' }),
		)
		expect(periodes).toContain(t('admin.occurrences.period.from', { debut: '2026-04-01' }))
	})

	it('offre les trois commandes sur chaque ligne, toujours visibles (§5.13)', async () => {
		monter(clientQuiRend([liste([OUVERTE])]))
		await screen.findByTestId('liste-occurrences')
		const ligne = within(screen.getByTestId('ligne-occurrence'))
		expect(ligne.getByRole('button', { name: t('admin.occurrences.action.edit', { nom: 'Février 2026' }) })).toBeTruthy()
		expect(ligne.getByRole('button', { name: t('admin.occurrences.action.close', { nom: 'Février 2026' }) })).toBeTruthy()
		expect(ligne.getByRole('button', { name: t('admin.occurrences.action.remove', { nom: 'Février 2026' }) })).toBeTruthy()
	})

	it('offre ROUVRIR et non CLÔTURER sur une ligne close — deux commandes, jamais une bascule', async () => {
		monter(clientQuiRend([liste([CLOSE])]))
		await screen.findByTestId('liste-occurrences')
		const ligne = within(screen.getByTestId('ligne-occurrence'))
		expect(ligne.getByRole('button', { name: t('admin.occurrences.action.reopen', { nom: 'Janvier 2026' }) })).toBeTruthy()
		expect(ligne.queryByRole('button', { name: t('admin.occurrences.action.close', { nom: 'Janvier 2026' }) })).toBeNull()
	})

	it("garde MODIFIER sur une ligne close — mesure M8 : la base ne s'y oppose pas", async () => {
		// Aucun trigger n'interdit de renommer ou de doter une occurrence close, et le §4.8 suppose
		// précisément que les factures arrivent après la clôture. Éteindre la commande ici poserait
		// une garde que la base n'a pas.
		monter(clientQuiRend([liste([CLOSE])]))
		await screen.findByTestId('liste-occurrences')
		const ligne = within(screen.getByTestId('ligne-occurrence'))
		expect(ligne.getByRole('button', { name: t('admin.occurrences.action.edit', { nom: 'Janvier 2026' }) })).toBeTruthy()
	})
})

// ---------------------------------------------------------------------------------------------
// Les surfaces — §4.1 bis.3 et §5.47
// ---------------------------------------------------------------------------------------------

describe('les surfaces ouvertes', () => {
	it('ouvre le formulaire de création et y place le focus (§5.13)', async () => {
		monter(clientQuiRend([liste([])]))
		await screen.findByTestId('occurrences-vide')
		fireEvent.click(screen.getByRole('button', { name: t('admin.occurrences.action.new') }))
		const formulaire = await screen.findByTestId('formulaire-occurrence')
		expect(formulaire).toBeTruthy()
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByLabelText(t('admin.occurrences.form.label')),
			),
		)
	})

	it('préremplit le formulaire de modification des valeurs courantes', async () => {
		monter(clientQuiRend([liste([OUVERTE])]))
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.edit', { nom: 'Février 2026' }) }),
		)
		await screen.findByTestId('formulaire-occurrence')
		expect((screen.getByLabelText(t('admin.occurrences.form.label')) as HTMLInputElement).value).toBe(
			'Février 2026',
		)
		expect((screen.getByLabelText(t('admin.occurrences.form.start')) as HTMLInputElement).value).toBe(
			'2026-02-01',
		)
		expect(
			(screen.getByLabelText(t('admin.occurrences.form.planned')) as HTMLInputElement).value,
		).toBe('2500')
	})

	it('refuse la validation tant que le libellé est vide, sans envoyer de requête', async () => {
		monter(clientQuiRend([liste([])]))
		await screen.findByTestId('occurrences-vide')
		fireEvent.click(screen.getByRole('button', { name: t('admin.occurrences.action.new') }))
		await screen.findByTestId('formulaire-occurrence')
		const valider = screen.getByRole('button', { name: t('admin.action.create') })
		expect((valider as HTMLButtonElement).disabled).toBe(true)
	})

	it("nomme l'enveloppe illisible sous le champ, plutôt que d'envoyer `NaN`", async () => {
		monter(clientQuiRend([liste([])]))
		await screen.findByTestId('occurrences-vide')
		fireEvent.click(screen.getByRole('button', { name: t('admin.occurrences.action.new') }))
		await screen.findByTestId('formulaire-occurrence')
		fireEvent.change(screen.getByLabelText(t('admin.occurrences.form.label')), {
			target: { value: 'Mars 2026' },
		})
		fireEvent.change(screen.getByLabelText(t('admin.occurrences.form.planned')), {
			target: { value: 'douze' },
		})
		expect(screen.getByText(t('admin.occurrences.form.planned.invalid'))).toBeTruthy()
		expect(
			(screen.getByRole('button', { name: t('admin.action.create') }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
	})

	it("N'OUVRE QU'UNE SURFACE À LA FOIS (§5.47)", async () => {
		monter(clientQuiRend([liste([OUVERTE])]))
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.edit', { nom: 'Février 2026' }) }),
		)
		await screen.findByTestId('formulaire-occurrence')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.remove', { nom: 'Février 2026' }) }),
		)
		await screen.findByTestId('confirmation-retrait-occurrence')
		expect(screen.queryByTestId('formulaire-occurrence')).toBeNull()
	})
})

// ---------------------------------------------------------------------------------------------
// Seul le retrait est confirmé — §4.1 bis.3
// ---------------------------------------------------------------------------------------------

describe('la confirmation', () => {
	it('le RETRAIT demande confirmation, et la confirmation nomme la clôture comme issue', async () => {
		monter(clientQuiRend([liste([OUVERTE])]))
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.remove', { nom: 'Février 2026' }) }),
		)
		const confirmation = await screen.findByTestId('confirmation-retrait-occurrence')
		expect(confirmation.textContent).toContain(
			t('admin.occurrences.remove.confirm', { nom: 'Février 2026' }),
		)
		expect(confirmation.textContent).toContain(t('admin.occurrences.remove.body'))
	})

	it('la CLÔTURE ne demande AUCUNE confirmation : elle se défait d’un clic (§4.1 bis.3)', async () => {
		const { onAnnonce } = monter(
			clientQuiRend([liste([OUVERTE]), liste([{ id: 'o-fevrier' }]), liste([])]),
		)
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.close', { nom: 'Février 2026' }) }),
		)
		expect(screen.queryByTestId('confirmation-retrait-occurrence')).toBeNull()
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith(t('live.admin.occurrence.closed')))
	})

	it('la RÉOUVERTURE non plus', async () => {
		const { onAnnonce } = monter(
			clientQuiRend([liste([CLOSE]), liste([{ id: 'o-janvier' }]), liste([])]),
		)
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.reopen', { nom: 'Janvier 2026' }) }),
		)
		expect(screen.queryByTestId('confirmation-retrait-occurrence')).toBeNull()
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith(t('live.admin.occurrence.reopened')))
	})

	it("le bouton de confirmation N'EST PAS ÉTEINT : la borne est celle de la base, pas de l'écran", async () => {
		monter(clientQuiRend([liste([CLOSE])]))
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.remove', { nom: 'Janvier 2026' }) }),
		)
		await screen.findByTestId('confirmation-retrait-occurrence')
		expect(
			(screen.getByRole('button', { name: t('admin.occurrences.remove.action') }) as HTMLButtonElement)
				.disabled,
		).toBe(false)
	})
})

// ---------------------------------------------------------------------------------------------
// Le refus, et sa place — §5.13
// ---------------------------------------------------------------------------------------------

describe('le refus', () => {
	it('est rendu DANS la confirmation quand le retrait est refusé par la clé étrangère (M11)', async () => {
		const { onComptesPerimes } = monter(
			clientQuiRend([
				liste([CLOSE]),
				{
					data: null,
					error: { code: '23503', message: '… "card_costs_occurrence_id_fkey" …' },
					status: 409,
				},
			]),
		)
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.remove', { nom: 'Janvier 2026' }) }),
		)
		await screen.findByTestId('confirmation-retrait-occurrence')
		fireEvent.click(screen.getByRole('button', { name: t('admin.occurrences.remove.action') }))
		const refus = await screen.findByTestId('occurrence-refus')
		expect(refus.textContent).toContain(t('admin.occurrences.refus.occurrence-referencee'))
		// La surface reste ouverte : un refus n'efface pas le geste en cours (§5.7 ter).
		expect(screen.getByTestId('confirmation-retrait-occurrence')).toBeTruthy()
		expect(onComptesPerimes).not.toHaveBeenCalled()
	})

	it("est rendu EN TÊTE quand aucune surface n'est ouverte — sinon il serait invisible", async () => {
		// Une clôture est lancée depuis une ligne, sans surface : sans ce rendu, `setRefus` serait
		// appelé, correct, et invisible (`CLAUDE.md` §18).
		monter(
			clientQuiRend([
				liste([OUVERTE]),
				{ data: null, error: { message: 'permission denied' }, status: 403 },
			]),
		)
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.close', { nom: 'Février 2026' }) }),
		)
		const refus = await screen.findByTestId('occurrence-refus')
		expect(refus.textContent).toContain(t('admin.occurrences.refus.forbidden'))
	})

	it('DIT « sans effet » plutôt que de le présenter comme un succès (§4.1 bis.3)', async () => {
		// `200` et zéro ligne : la clause `USING` de la politique a filtré, le droit d'écriture étant
		// retombé depuis le chargement. Une annonce de succès ferait croire à une écriture.
		const { onAnnonce } = monter(clientQuiRend([liste([OUVERTE]), liste([])]))
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.close', { nom: 'Février 2026' }) }),
		)
		const refus = await screen.findByTestId('occurrence-refus')
		expect(refus.textContent).toContain(t('admin.occurrences.refus.sans-effet'))
		expect(onAnnonce).not.toHaveBeenCalled()
	})
})

// ---------------------------------------------------------------------------------------------
// Le dictionnaire fermé — §4.1 bis.4
// ---------------------------------------------------------------------------------------------

describe('texteRefusOccurrence', () => {
	it('rend une phrase propre pour CHACUNE des huit natures, aucune ne retombant sur une autre', () => {
		const natures = [
			'forbidden',
			'libelle-pris',
			'libelle-vide',
			'budget-non-recurrent',
			'occurrence-referencee',
			'reference-absente',
			'network',
			'unknown',
		] as const
		const textes = natures.map((nature) => texteRefusOccurrence({ nature, detail: 'brut' }))
		expect(new Set(textes).size).toBe(natures.length)
		for (const texte of textes) expect(texte.length).toBeGreaterThan(0)
	})

	it("NE RECOPIE JAMAIS le corps du serveur, qui peut divulguer une structure interne", () => {
		for (const nature of ['forbidden', 'libelle-pris', 'occurrence-referencee'] as const) {
			expect(texteRefusOccurrence({ nature, detail: 'card_costs_occurrence_id_fkey' })).not.toContain(
				'card_costs_occurrence_id_fkey',
			)
		}
	})
})

// ---------------------------------------------------------------------------------------------
// Ce que le succès déclenche
// ---------------------------------------------------------------------------------------------

describe('après une écriture appliquée', () => {
	it('annonce, ferme la surface, et PRÉVIENT le bloc hôte que son compte est périmé', async () => {
		// Sans cette dernière, la colonne du §4.1 afficherait l'ancien nombre : l'écran dirait deux
		// choses contradictoires au même instant.
		const { onAnnonce, onComptesPerimes } = monter(
			clientQuiRend([liste([OUVERTE]), liste([{ id: 'o-fevrier' }]), liste([])]),
		)
		await screen.findByTestId('liste-occurrences')
		fireEvent.click(
			screen.getByRole('button', { name: t('admin.occurrences.action.close', { nom: 'Février 2026' }) }),
		)
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith(t('live.admin.occurrence.closed')))
		expect(onComptesPerimes).toHaveBeenCalled()
	})
})
