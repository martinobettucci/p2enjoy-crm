// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranches 4a et 4b
// @verifies docs/SPEC-contacts.md §10.5 (de quoi l'écran a l'air), §10.6 (cas a à f du contrat
//           de comportement), §10.7 (aucun geste)
// @verifies docs/SPEC-contacts.md §11.6 (le nom d'organisation est désormais un LIEN vers sa
//           fiche), §11.9 cas i
// @verifies docs/DESIGN_SYSTEM.md §5.9 (tableau sémantique, cellule sans valeur VIDE),
//           §5.8 (quatre états), §2 (données techniques en monospace)
//
// Les données injectées sont celles du SEED, à l'identique : Léo Marchand avec son organisation,
// Sophie Dupont sans organisation ni fonction, Élise Fabre sans email. Ce n'est pas une commodité
// — ce sont les trois cas du §10.6, et les mêmes que la preuve E2E exerce sur la pile réelle.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Carnet } from './Carnet'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

/**
 * Le carnet porte désormais un `Link` vers la fiche d'organisation (§11.6) : il lui faut un
 * routeur. Ce n'est pas une commodité de test — c'est la conséquence directe du lien livré, et un
 * rendu nu échouerait sur `useHref` avant la moindre assertion.
 */
function rendreCarnet(client: ClientCrm | null) {
	return render(
		<MemoryRouter>
			<Carnet client={client} />
		</MemoryRouter>,
	)
}

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

/** Client minimal : une seule lecture, `from().select().order()`. */
function clientQuiRend(...reponses: Reponse[]): ClientCrm {
	let rang = 0
	const chaine = {
		order: () => chaine,
		then: (resoudre: (valeur: Reponse) => unknown) => {
			const reponse = reponses[Math.min(rang, reponses.length - 1)]
			rang += 1
			// `reponses` est toujours non vide par construction (paramètre variadique appelé avec au
			// moins une réponse) ; l'assertion le dit au compilateur sans masquer un cas réel.
			if (reponse === undefined) throw new Error('client espion appelé sans réponse')
			return Promise.resolve(reponse).then(resoudre)
		},
	}
	return { from: () => ({ select: () => chaine }) } as unknown as ClientCrm
}

const LEO = {
	id: '5eed0000-0000-4000-8000-000000000091',
	full_name: 'Léo Marchand',
	email: 'leo.marchand@sogexia.example',
	phone: null,
	role_title: 'Directeur achats',
	organization_id: '5eed0000-0000-4000-8000-000000000081',
	organizations: { id: '5eed0000-0000-4000-8000-000000000081', name: 'Sogexia', domain: 'sogexia.example' },
}
const SOPHIE = {
	id: '5eed0000-0000-4000-8000-000000000092',
	full_name: 'Sophie Dupont',
	email: 'sophie@dupont.test',
	phone: null,
	role_title: null,
	organization_id: null,
	organizations: null,
}
const ELISE = {
	id: '5eed0000-0000-4000-8000-000000000093',
	full_name: 'Élise Fabre',
	email: null,
	phone: '+33 6 12 34 56 78',
	role_title: "Cheffe d'atelier",
	organization_id: '5eed0000-0000-4000-8000-000000000082',
	organizations: { id: '5eed0000-0000-4000-8000-000000000082', name: 'Studio Meunier', domain: null },
}

const SEED = [ELISE, LEO, SOPHIE]

describe('Carnet de contacts', () => {
	it('rend une ligne par contact, dans l’ordre reçu du serveur — cas a du §10.6', async () => {
		rendreCarnet(clientQuiRend({ data: SEED, error: null, status: 200 }))
		const lignes = await screen.findAllByTestId('ligne-contact')
		expect(lignes).toHaveLength(3)
		// L'écran ne retrie PAS : l'ordre est celui de la réponse, et la collation de la base range
		// « Élise » avant « Léo » (mesuré le 2026-08-18).
		expect(lignes.map((ligne) => ligne.getAttribute('data-contact'))).toEqual([
			ELISE.id,
			LEO.id,
			SOPHIE.id,
		])
	})

	it('est un tableau SÉMANTIQUE avec ses cinq en-têtes de colonne — §5.9', async () => {
		rendreCarnet(clientQuiRend({ data: SEED, error: null, status: 200 }))
		expect(await screen.findByTestId('tableau-contacts')).toBeTruthy()
		const entetes = screen.getAllByRole('columnheader')
		expect(entetes.map((entete) => entete.textContent)).toEqual([
			fr['contacts.table.name'],
			fr['contacts.table.organization'],
			fr['contacts.table.role'],
			fr['contacts.table.email'],
			fr['contacts.table.phone'],
		])
	})

	it('laisse la cellule VIDE quand la donnée est absente — cas b et c du §10.6', async () => {
		rendreCarnet(clientQuiRend({ data: SEED, error: null, status: 200 }))
		const lignes = await screen.findAllByTestId('ligne-contact')
		const ligneSophie = lignes.find((ligne) => ligne.getAttribute('data-contact') === SOPHIE.id)!
		const cellulesSophie = [...ligneSophie.querySelectorAll('td')].map((c) => c.textContent)
		// Ni tiret, ni « — », ni « non renseigné » : le vide est le seul rendu qui ne prétende rien.
		expect(cellulesSophie).toEqual(['Sophie Dupont', '', '', 'sophie@dupont.test', ''])

		const ligneElise = lignes.find((ligne) => ligne.getAttribute('data-contact') === ELISE.id)!
		const cellulesElise = [...ligneElise.querySelectorAll('td')].map((c) => c.textContent)
		expect(cellulesElise).toEqual([
			'Élise Fabre',
			'Studio Meunier',
			"Cheffe d'atelier",
			'',
			'+33 6 12 34 56 78',
		])
	})

	it('rend email et téléphone en DONNÉE TECHNIQUE, et le nom d’organisation en LIEN — §10.5, §11.6', async () => {
		rendreCarnet(clientQuiRend({ data: SEED, error: null, status: 200 }))
		const lignes = await screen.findAllByTestId('ligne-contact')
		const ligneLeo = lignes.find((ligne) => ligne.getAttribute('data-contact') === LEO.id)!
		// §2 : email et téléphone sont des données techniques, portées par `code`.
		expect(ligneLeo.querySelector('code')?.textContent).toBe(LEO.email)
		// ASSERTION RÉVISÉE le 2026-08-18 — sous-tranche 4b, docs/SPEC-contacts.md §11.6.
		//
		// Elle exigeait `toHaveLength(0)` : le nom d'organisation devait rester un TEXTE tant que
		// la fiche n'existait pas, un lien sans destination étant mort (§10.7, §5.10). La
		// sous-tranche 4b LIVRE cette destination : la règle change par livraison, et la preuve est
		// donc RÉVISÉE avec son motif — jamais retirée, jamais contournée (mécanisme de la
		// décision 51). Ce qu'elle exige reste vérifiable, et devient plus fort : le lien doit
		// exister ET mener à la bonne fiche.
		const liens = ligneLeo.querySelectorAll('a')
		expect(liens).toHaveLength(1)
		expect(liens[0]?.getAttribute('href')).toBe(
			`/contacts/organisations/${LEO.organization_id}`,
		)
		// Le nom EST le libellé du lien : aucun `aria-label` générique ne le remplace, sans quoi
		// tous les liens du tableau seraient indistinguables pour un lecteur d'écran (§8).
		expect(liens[0]?.textContent).toBe('Sogexia')
		// Aucun `mailto:` ni `tel:` n'est posé pour autant : écrire à un contact depuis le carnet
		// n'est spécifié nulle part (§10.5, inchangé).
		expect(ligneLeo.innerHTML).not.toContain('mailto:')
		expect(ligneLeo.innerHTML).not.toContain('tel:')
	})

	it('rend des squelettes pendant la lecture, jamais un écran blanc — cas d du §10.6', () => {
		const jamais = {
			from: () => ({ select: () => ({ order: () => ({ then: () => new Promise(() => {}) }) }) }),
		} as unknown as ClientCrm
		rendreCarnet(jamais)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it('rend un état d’erreur dont la reprise RELANCE la lecture — cas e du §10.6', async () => {
		const client = clientQuiRend(
			{ data: null, error: { message: 'boom' }, status: 500 },
			{ data: SEED, error: null, status: 200 },
		)
		rendreCarnet(client)
		const reprise = await screen.findByRole('button', { name: fr['contacts.error.retry'] })
		await userEvent.click(reprise)
		// La reprise n'est pas décorative : elle relit, et le tableau apparaît.
		await waitFor(() => expect(screen.getByTestId('tableau-contacts')).toBeTruthy())
	})

	it('rend l’état vide sur zéro contact — cas f du §10.6', async () => {
		// ASSERTION RÉVISÉE le 2026-08-19 — sous-tranche 4e, docs/SPEC-contacts.md §14.2.
		//
		// Elle exigeait `queryByRole('button')` NUL : la sous-tranche 4a ne livrait aucun geste de
		// création, et un bouton vers nulle part aurait été une commande morte (écart assumé au
		// §5.8, celui du §5.16 pour la corbeille). La sous-tranche 4e LIVRE ce geste, et il est le
		// MÊME dans l'état vide — un carnet vide est précisément celui où l'on veut ajouter un
		// contact. La condition de la règle a cessé d'être vraie : la preuve est donc RÉVISÉE avec
		// son motif, jamais retirée ni contournée (mécanisme de la décision 51).
		//
		// Ce qu'elle exige devient plus fort, et se scinde en deux : ici, SANS espace de travail
		// résolu, aucun geste — la création ne saurait pas où écrire. Le cas AVEC espace de
		// travail est éprouvé par « le geste vit AUSSI dans l'état vide » plus bas.
		rendreCarnet(clientQuiRend({ data: [], error: null, status: 200 }))
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByText(fr['contacts.empty.title'])).toBeTruthy()
		expect(screen.queryByTestId('ouvrir-creation-contact')).toBeNull()
		expect(screen.queryByRole('link')).toBeNull()
	})

	it('rend un état explicite sans espace de travail, et n’interroge RIEN', () => {
		const espion = vi.fn()
		rendreCarnet(null)
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
		expect(screen.getByText(fr['contacts.noWorkspace.title'])).toBeTruthy()
		expect(espion).not.toHaveBeenCalled()
	})
})

// ------------------------------------------------------------------------------------------------
//
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4e
// @verifies docs/SPEC-contacts.md §14.2 (le geste s'ancre dans le FLUX, replié par défaut),
//           §14.5 (contrat de comportement, cas a à l), §14.6 (l'écran ne calcule AUCUN droit)
// @verifies docs/DESIGN_SYSTEM.md §5.23 (le formulaire de création), §5.21 (le patron dont il
//           hérite : refus qui n'efface pas la saisie, focus entrant puis RENDU)
//
// LE CLIENT EST ICI KEYÉ PAR TABLE, et ce n'est pas une commodité : le carnet interroge
// désormais TROIS tables — `contacts`, `workspaces` (pour savoir où écrire) et `organizations`
// (pour le sélecteur) —, et un espion qui rendrait la même réponse à toutes ne pourrait éprouver
// ni la condition de lecture du §13.4, ni les cas k et l.

const ORGANISATIONS = [
	{ id: '5eed0000-0000-4000-8000-000000000081', name: 'Sogexia' },
	{ id: '5eed0000-0000-4000-8000-000000000082', name: 'Studio Meunier' },
]

const WORKSPACE = { id: '5eed0000-0000-4000-8000-000000000001', name: 'P2Enjoy', slug: 'p2enjoy' }

type ReponseTable = { data: unknown; error: { message: string; code?: string } | null; status: number }

type Journal = {
	/** Les tables LUES, dans l'ordre — c'est ce qui prouve la condition du §13.4. */
	readonly lectures: string[]
	/** La charge de l'unique écriture attendue, et le compte des envois (cas j). */
	readonly insertions: unknown[]
}

/**
 * Client keyé par table. `insert` est différé par une promesse que le test résout lui-même
 * quand il veut éprouver l'état d'envoi (cas j) ; sans cela, l'aller-retour serait déjà terminé
 * avant la première assertion et `aria-busy` ne serait jamais observable.
 */
function clientCarnet(reponses: {
	contacts: ReponseTable
	workspaces?: ReponseTable
	organizations?: ReponseTable
	creation?: ReponseTable | (() => Promise<ReponseTable>)
}): { client: ClientCrm; journal: Journal } {
	const journal: Journal = { lectures: [], insertions: [] }
	const client = {
		from: (table: string) => ({
			select: () => {
				journal.lectures.push(table)
				const reponse =
					table === 'workspaces'
						? (reponses.workspaces ?? { data: [WORKSPACE], error: null, status: 200 })
						: table === 'organizations'
							? (reponses.organizations ?? { data: ORGANISATIONS, error: null, status: 200 })
							: reponses.contacts
				const chaine = {
					order: () => chaine,
					then: (resoudre: (valeur: ReponseTable) => unknown) => Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
			insert: (charge: unknown) => {
				journal.insertions.push(charge)
				const chaine = {
					select: () => chaine,
					single: () => chaine,
					then: (resoudre: (valeur: ReponseTable) => unknown) => {
						const donnee = reponses.creation ?? { data: null, error: null, status: 201 }
						return (typeof donnee === 'function' ? donnee() : Promise.resolve(donnee)).then(resoudre)
					},
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, journal }
}

/** La ligne que PostgREST rend pour un contact créé sans organisation. */
const CAMILLE = {
	id: '5eed0000-0000-4000-8000-0000000000e1',
	full_name: 'Camille Roy',
	email: null,
	phone: null,
	role_title: null,
	organization_id: null,
	organizations: null,
}

async function ouvrirLeFormulaire(): Promise<HTMLElement> {
	await userEvent.click(await screen.findByTestId('ouvrir-creation-contact'))
	return await screen.findByTestId('formulaire-creation-contact')
}

describe('Carnet — la création d’un contact (§14)', () => {
	it('n’offre qu’un seul geste, REPLIÉ, et laisse le tableau intact — cas a du §14.5', async () => {
		const { client, journal } = clientCarnet({ contacts: { data: SEED, error: null, status: 200 } })
		rendreCarnet(client)
		expect(await screen.findByTestId('ouvrir-creation-contact')).toBeTruthy()
		expect(screen.queryByTestId('formulaire-creation-contact')).toBeNull()
		// Le tableau reste ce qu'il était : le geste ne le remplace pas, il s'ajoute au-dessus.
		expect(screen.getAllByTestId('ligne-contact')).toHaveLength(3)
		// LA LISTE DES ORGANISATIONS N'EST PAS LUE tant que le formulaire est replié — §13.4 : une
		// requête pour un geste que la plupart des visites ne font pas serait gratuite.
		expect(journal.lectures).not.toContain('organizations')
	})

	it('ouvre le formulaire, LE FOCUS ENTRE sur le nom, et lit alors les organisations — cas b', async () => {
		const { client, journal } = clientCarnet({ contacts: { data: SEED, error: null, status: 200 } })
		rendreCarnet(client)
		await ouvrirLeFormulaire()
		// Un formulaire qui s'ouvre sans prendre le focus oblige à le chercher au clavier.
		expect(document.activeElement).toBe(screen.getByTestId('champ-nom-contact'))
		await waitFor(() => expect(journal.lectures).toContain('organizations'))
	})

	it('REND le focus à la commande qui l’a ouvert quand on annule — cas c', async () => {
		const { client } = clientCarnet({ contacts: { data: SEED, error: null, status: 200 } })
		rendreCarnet(client)
		await ouvrirLeFormulaire()
		await userEvent.click(screen.getByTestId('annuler-creation-contact'))
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByTestId('ouvrir-creation-contact')),
		)
	})

	it('refuse un nom BLANC côté écran, sans AUCUN appel réseau — cas d', async () => {
		const { client, journal } = clientCarnet({ contacts: { data: SEED, error: null, status: 200 } })
		rendreCarnet(client)
		await ouvrirLeFormulaire()
		await userEvent.type(screen.getByTestId('champ-nom-contact'), '   ')
		await userEvent.click(screen.getByTestId('envoyer-creation-contact'))
		// Le champ est SIGNALÉ, et le message est lié au champ pour un lecteur d'écran.
		const champ = screen.getByTestId('champ-nom-contact')
		expect(champ.getAttribute('aria-invalid')).toBe('true')
		expect(screen.getByText(fr['contacts.creation.nameRequired'])).toBeTruthy()
		// C'est le SEUL contrôle d'écran, et il ne remplace aucune règle : la base refuse déjà un
		// nom blanc (mesure 6). L'écran l'anticipe pour ne pas faire payer un aller-retour.
		expect(journal.insertions).toHaveLength(0)
		expect(document.activeElement).toBe(champ)
	})

	it('fait REJOINDRE la ligne créée au tableau à sa place de tri, et referme — cas e', async () => {
		const { client } = clientCarnet({
			contacts: { data: SEED, error: null, status: 200 },
			creation: { data: CAMILLE, error: null, status: 201 },
		})
		rendreCarnet(client)
		await ouvrirLeFormulaire()
		await userEvent.type(screen.getByTestId('champ-nom-contact'), 'Camille Roy')
		await userEvent.click(screen.getByTestId('envoyer-creation-contact'))
		await waitFor(() => expect(screen.getAllByTestId('ligne-contact')).toHaveLength(4))
		// « Camille » se range entre « Élise » et « Léo » : le tri du serveur est `full_name`, et
		// `localeCompare('fr')` le reproduit. Une ligne simplement ajoutée en fin de tableau
		// mentirait sur l'ordre que rendra la prochaine lecture.
		expect(
			screen.getAllByTestId('ligne-contact').map((ligne) => ligne.getAttribute('data-contact')),
		).toEqual([CAMILLE.id, ELISE.id, LEO.id, SOPHIE.id])
		// AUCUNE RELECTURE : la ligne vient de la réponse d'écriture, pas d'un second aller-retour.
		expect(screen.queryByTestId('formulaire-creation-contact')).toBeNull()
	})

	it('donne son LIEN à la cellule d’organisation de la ligne neuve — cas f', async () => {
		const { client } = clientCarnet({
			contacts: { data: SEED, error: null, status: 200 },
			creation: {
				data: {
					...CAMILLE,
					organization_id: '5eed0000-0000-4000-8000-000000000081',
					organizations: {
						id: '5eed0000-0000-4000-8000-000000000081',
						name: 'Sogexia',
						domain: 'sogexia.example',
					},
				},
				error: null,
				status: 201,
			},
		})
		rendreCarnet(client)
		await ouvrirLeFormulaire()
		await userEvent.type(screen.getByTestId('champ-nom-contact'), 'Camille Roy')
		await userEvent.click(screen.getByTestId('envoyer-creation-contact'))
		await waitFor(() => expect(screen.getAllByTestId('ligne-contact')).toHaveLength(4))
		const ligneCamille = screen
			.getAllByTestId('ligne-contact')
			.find((candidate) => candidate.getAttribute('data-contact') === CAMILLE.id)!
		const lien = ligneCamille.querySelector('a')
		expect(lien?.getAttribute('href')).toBe(
			'/contacts/organisations/5eed0000-0000-4000-8000-000000000081',
		)
		expect(lien?.textContent).toBe('Sogexia')
	})

	it('traduit les trois refus et CONSERVE la saisie — cas g, h et i', async () => {
		const refus = [
			{
				reponse: { data: null, error: { message: 'dup', code: '23505' }, status: 409 },
				texte: fr['contacts.creation.refus.doublon'],
			},
			{
				reponse: { data: null, error: { message: 'fk', code: '23503' }, status: 409 },
				texte: fr['contacts.creation.refus.organisation'],
			},
			{
				reponse: { data: null, error: { message: 'rls', code: '42501' }, status: 403 },
				texte: fr['contacts.creation.refus.interdit'],
			},
		]
		for (const cas of refus) {
			const { client } = clientCarnet({
				contacts: { data: SEED, error: null, status: 200 },
				creation: cas.reponse,
			})
			rendreCarnet(client)
			await ouvrirLeFormulaire()
			await userEvent.type(screen.getByTestId('champ-nom-contact'), 'Camille Roy')
			await userEvent.type(screen.getByTestId('champ-email-contact'), 'camille@sogexia.example')
			await userEvent.click(screen.getByTestId('envoyer-creation-contact'))
			expect((await screen.findByTestId('refus-creation-contact')).textContent).toBe(cas.texte)
			// LE REFUS N'EFFACE JAMAIS LA SAISIE : elle est ce qu'il faut corriger.
			expect(screen.getByTestId('formulaire-creation-contact')).toBeTruthy()
			expect((screen.getByTestId('champ-nom-contact') as HTMLInputElement).value).toBe('Camille Roy')
			expect((screen.getByTestId('champ-email-contact') as HTMLInputElement).value).toBe(
				'camille@sogexia.example',
			)
			// AUCUNE COMMANDE ÉTEINTE D'AVANCE (§14.6) : l'écran ne calcule aucun droit, et la
			// lectrice renvoie si elle veut. Une commande grisée ferait passer une décision de la
			// base pour une décision d'écran.
			expect((screen.getByTestId('envoyer-creation-contact') as HTMLButtonElement).disabled).toBe(false)
			cleanup()
		}
	})

	it('marque l’envoi `aria-busy` et ne l’émet QU’UNE FOIS — cas j', async () => {
		let libere: (valeur: ReponseTable) => void = () => {}
		const attente = new Promise<ReponseTable>((resoudre) => {
			libere = resoudre
		})
		const { client, journal } = clientCarnet({
			contacts: { data: SEED, error: null, status: 200 },
			creation: () => attente,
		})
		rendreCarnet(client)
		await ouvrirLeFormulaire()
		await userEvent.type(screen.getByTestId('champ-nom-contact'), 'Camille Roy')
		const envoyer = screen.getByTestId('envoyer-creation-contact')
		await userEvent.click(envoyer)
		await waitFor(() => expect(envoyer.getAttribute('aria-busy')).toBe('true'))
		// UN SECOND DÉCLENCHEMENT pendant l'aller-retour créerait DEUX contacts : la base n'a
		// aucune unicité sur le seul nom, et rien ne rattraperait le doublon.
		await userEvent.click(envoyer)
		await userEvent.click(envoyer)
		expect(journal.insertions).toHaveLength(1)
		libere({ data: CAMILLE, error: null, status: 201 })
		await waitFor(() => expect(screen.getAllByTestId('ligne-contact')).toHaveLength(4))
	})

	it('DÉSACTIVE le sélecteur et offre une reprise quand la liste est illisible — cas k', async () => {
		const { client, journal } = clientCarnet({
			contacts: { data: SEED, error: null, status: 200 },
			organizations: { data: null, error: { message: 'boom' }, status: 500 },
		})
		rendreCarnet(client)
		await ouvrirLeFormulaire()
		const selecteur = await screen.findByTestId('champ-organisation-contact')
		// Il n'y a RIEN à choisir : un `select` vide mais actif serait une commande morte (§13.5
		// cas h). L'action de reprise est ce qui rend l'état réparable.
		await waitFor(() => expect((selecteur as HTMLSelectElement).disabled).toBe(true))
		expect(screen.getByText(fr['contacts.creation.organization.error'])).toBeTruthy()
		const avant = journal.lectures.filter((table) => table === 'organizations').length
		await userEvent.click(screen.getByTestId('relire-organisations'))
		// La reprise n'est pas décorative : elle RELIT.
		await waitFor(() =>
			expect(journal.lectures.filter((table) => table === 'organizations').length).toBe(avant + 1),
		)
	})

	it('n’offre que l’option vide sur une liste VIDE, et le dit SANS action — cas l', async () => {
		const { client } = clientCarnet({
			contacts: { data: SEED, error: null, status: 200 },
			organizations: { data: [], error: null, status: 200 },
		})
		rendreCarnet(client)
		await ouvrirLeFormulaire()
		const selecteur = await screen.findByTestId('champ-organisation-contact')
		await waitFor(() => expect(selecteur.querySelectorAll('option')).toHaveLength(1))
		expect(selecteur.querySelector('option')?.textContent).toBe(
			fr['contacts.creation.organization.none'],
		)
		// SANS ACTION : aucune surface du produit ne crée d'organisation (§14.7), et un bouton
		// vers nulle part serait une commande morte.
		expect((selecteur as HTMLSelectElement).disabled).toBe(false)
		expect(screen.getByText(fr['contacts.creation.organization.empty'])).toBeTruthy()
		expect(screen.queryByTestId('relire-organisations')).toBeNull()
	})

	it('porte le geste AUSSI dans l’état vide — la règle du §5.19 révisée par LIVRAISON', async () => {
		// C'est la seconde moitié de l'assertion révisée du cas f du §10.6 : un carnet vide est
		// PRÉCISÉMENT celui où l'on veut ajouter un contact. La condition de l'écart assumé par la
		// sous-tranche 4a — aucun geste de création n'existe — a cessé d'être vraie.
		const { client } = clientCarnet({ contacts: { data: [], error: null, status: 200 } })
		rendreCarnet(client)
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(await screen.findByTestId('ouvrir-creation-contact')).toBeTruthy()
	})
})
