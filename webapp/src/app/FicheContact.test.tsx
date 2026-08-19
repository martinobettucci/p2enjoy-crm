// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4, sous-tranches 4f
//           (la fiche) et 4g (la MODIFICATION depuis la fiche)
// @verifies docs/SPEC-contacts.md §16.3 (ce que l'écriture envoie, et le silence des mesures 3,
//           12 et 19), §16.4 (dictionnaire fermé des six refus), §16.5 (le retour du focus),
//           §16.7 (ce que la fiche fait de la ligne rendue), §16.9 (contrat, cas a à r)
// @verifies docs/DESIGN_SYSTEM.md §5.25 (le formulaire de modification dans le flux)
// @verifies docs/SPEC-contacts.md §15.5 (de quoi l'écran a l'air : deux zones, l'organisation en
//           lien, l'affaire en lien, la pilule d'archive), §15.8 (limites nommées),
//           §15.9 (contrat de comportement, cas a à l)
// @verifies docs/DESIGN_SYSTEM.md §5.24 (cette surface), §5.9 (cellule sans valeur VIDE),
//           §5.8 (états explicites), §5.6 (pilule), §2 (données techniques)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, jamais une erreur)
//
// Les données injectées sont celles du SEED, à l'identique — Léo Marchand avec son organisation et
// son affaire, Sophie Dupont sans organisation, Élise Fabre sans aucune affaire. Ce n'est pas une
// commodité : ce sont les cas a, b, d et e du §15.9, et les mêmes que la preuve E2E exerce sur la
// pile réelle.
//
// UNE SEULE BRANCHE N'EST PAS SEEDÉE, et c'est ici qu'elle est éprouvée : l'affaire ARCHIVÉE
// rattachée à un contact. Le §15.7 dit pourquoi le seed ne la porte pas — le seul rattachement
// supplémentaire possible déplacerait une garde de convergence et le compteur que lit la règle 3
// du classement. La preuve unitaire est donc le lieu où le cas f du §15.9 se vérifie.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ContenuFicheContact } from './FicheContact'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

/**
 * Client minimal : une seule lecture, `from().select().eq().is().order()`.
 *
 * `is` figure dans la chaîne parce que la fiche pose le filtre qui écarte la corbeille (§15.3) :
 * un espion qui l'ignorerait laisserait passer un code qui aurait oublié ce filtre.
 */
function clientQuiRend(...reponses: Reponse[]): ClientCrm {
	let rang = 0
	const chaine = {
		eq: () => chaine,
		is: () => chaine,
		order: () => chaine,
		then: (resoudre: (valeur: Reponse) => unknown) => {
			const reponse = reponses[Math.min(rang, reponses.length - 1)]
			rang += 1
			if (reponse === undefined) throw new Error('client espion appelé sans réponse')
			return Promise.resolve(reponse).then(resoudre)
		},
	}
	return { from: () => ({ select: () => chaine }) } as unknown as ClientCrm
}

const ID_LEO = '5eed0000-0000-4000-8000-000000000091'
const ID_SOPHIE = '5eed0000-0000-4000-8000-000000000092'
const ID_ELISE = '5eed0000-0000-4000-8000-000000000093'
const ID_SOGEXIA = '5eed0000-0000-4000-8000-000000000081'
const ID_CARD_ERP = '5eed0000-0000-4000-8000-0000000000c2'
const ID_WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

/** Léo Marchand, tel que la pile réelle le rend — mesure 1 du §15.3. */
const LEO = {
	id: ID_LEO,
	full_name: 'Léo Marchand',
	email: 'leo.marchand@sogexia.example',
	phone: null,
	role_title: 'Directeur achats',
	organization_id: ID_SOGEXIA,
	// Porté depuis 4h (§17.5) : le rattachement l'exige, et la fiche le lit dans la même requête.
	workspace_id: ID_WORKSPACE,
	organizations: { id: ID_SOGEXIA, name: 'Sogexia', domain: 'sogexia.example' },
	card_contacts: [
		{
			role: 'decideur',
			cards: {
				id: ID_CARD_ERP,
				title: 'Migration ERP Sogexia',
				archived_at: null,
				channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
			},
		},
	],
}

/** Sophie Dupont : AUCUNE organisation, une affaire — mesure 3 du §15.3. */
const SOPHIE = {
	id: ID_SOPHIE,
	full_name: 'Sophie Dupont',
	email: 'sophie@dupont.test',
	phone: null,
	role_title: null,
	organization_id: null,
	workspace_id: ID_WORKSPACE,
	organizations: null,
	card_contacts: [
		{
			role: 'prescripteur',
			cards: {
				id: '5eed0000-0000-4000-8000-0000000000c4',
				title: 'Refonte intranet Ville de Lyon',
				archived_at: null,
				channels: { slug: 'refonte', tracks: { slug: 'studio-web' } },
			},
		},
	],
}

/** Élise Fabre : une organisation, AUCUNE affaire, aucun email — mesure 4 du §15.3. */
const ELISE = {
	id: ID_ELISE,
	full_name: 'Élise Fabre',
	email: null,
	phone: '+33 6 12 34 56 78',
	role_title: "Cheffe d'atelier",
	organization_id: '5eed0000-0000-4000-8000-000000000082',
	workspace_id: ID_WORKSPACE,
	organizations: { id: '5eed0000-0000-4000-8000-000000000082', name: 'Studio Meunier', domain: null },
	card_contacts: [],
}

const OK = (ligne: unknown) => ({ data: [ligne], error: null, status: 200 })
const VIDE = { data: [], error: null, status: 200 }

function monter(client: ClientCrm | null, idContact: string | undefined) {
	return render(
		<MemoryRouter>
			<ContenuFicheContact client={client} idContact={idContact} />
		</MemoryRouter>,
	)
}

describe('fiche de contact (docs/SPEC-contacts.md §15.9)', () => {
	it('cas a : le contact, ses caractéristiques et ses affaires sont rendus', async () => {
		monter(clientQuiRend(OK(LEO)), ID_LEO)
		expect(await screen.findByTestId('caracteristiques-contact')).toBeTruthy()
		expect(screen.getByText('Directeur achats')).toBeTruthy()
		expect(screen.getByText('leo.marchand@sogexia.example')).toBeTruthy()
		const lignes = screen.getAllByTestId('ligne-affaire-contact')
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.getAttribute('data-card')).toBe(ID_CARD_ERP)
		expect(screen.getByText('Migration ERP Sogexia')).toBeTruthy()
		// Le rôle DU RATTACHEMENT, distinct de la fonction rendue en zone 1 (§15.3).
		expect(screen.getByText('decideur')).toBeTruthy()
	})

	it("cas c : l'organisation est un LIEN vers sa fiche", async () => {
		monter(clientQuiRend(OK(LEO)), ID_LEO)
		const lien = await screen.findByTestId('lien-organisation-contact')
		expect(lien.getAttribute('href')).toBe(`/contacts/organisations/${ID_SOGEXIA}`)
		expect(lien.textContent).toBe('Sogexia')
	})

	it("cas b : sans organisation, la valeur reste VIDE et SANS LIEN — jamais un tiret", async () => {
		monter(clientQuiRend(OK(SOPHIE)), ID_SOPHIE)
		expect(await screen.findByTestId('caracteristiques-contact')).toBeTruthy()
		expect(screen.queryByTestId('lien-organisation-contact')).toBeNull()
		expect(screen.queryByText('—')).toBeNull()
		expect(screen.queryByText('-')).toBeNull()
	})

	it('cas d : une fonction absente laisse la cellule vide, sans texte de remplacement', async () => {
		monter(clientQuiRend(OK(SOPHIE)), ID_SOPHIE)
		const zone = await screen.findByTestId('caracteristiques-contact')
		// `role_title` est nul pour Sophie : le libellé est rendu, la valeur ne l'est pas.
		expect(zone.textContent).toContain(fr['contact.field.role'])
		expect(zone.textContent).not.toContain('non renseigné')
	})

	it("cas a bis : le titre d'une affaire est un LIEN construit sur les slugs embarqués", async () => {
		monter(clientQuiRend(OK(LEO)), ID_LEO)
		const lien = await screen.findByTestId('lien-affaire-contact')
		expect(lien.getAttribute('href')).toBe(
			`/tracks/conseil-ia/grands-comptes/cards/${ID_CARD_ERP}`,
		)
	})

	it("cas e : sans affaire, la zone rend l'état vide SANS action", async () => {
		monter(clientQuiRend(OK(ELISE)), ID_ELISE)
		expect(await screen.findByText(fr['contact.deals.empty.title'])).toBeTruthy()
		expect(screen.queryByTestId('tableau-affaires-contact')).toBeNull()
		// Les caractéristiques restent rendues : l'absence d'affaire n'efface pas le contact.
		expect(screen.getByTestId('caracteristiques-contact')).toBeTruthy()
		// ASSERTION RÉVISÉE PAR LIVRAISON, le 2026-08-19 (mécanisme de la décision 51).
		//
		// Elle exigeait « aucun bouton sur la page » pour dire ce que le §15.8 posait : cette
		// surface ne livre AUCUN geste. La sous-tranche 4g livre le geste de MODIFICATION (§16.2),
		// et la condition de la règle a donc cessé d'être vraie. Ce qu'il fallait réellement
		// prouver est plus étroit et reste vrai : l'ÉTAT VIDE DE LA ZONE DES AFFAIRES n'offre
		// aucune action — aucun rattachement n'est livré depuis cette page (§16.8), et un bouton
		// y serait un chemin vers nulle part.
		//
		// L'assertion n'est pas retirée : elle est resserrée sur la zone qu'elle décrit, et elle
		// gagne son pendant — le geste de modification, lui, est bien là.
		const zoneVide = screen.getByText(fr['contact.deals.empty.title']).closest('div')
		expect(zoneVide?.querySelector('button')).toBeNull()
		expect(zoneVide?.querySelector('a')).toBeNull()
		expect(screen.getByTestId('ouvrir-modification-contact')).toBeTruthy()
	})

	it("cas f : une affaire ARCHIVÉE porte sa pilule, et son titre reste un lien", async () => {
		const archivee = {
			...LEO,
			card_contacts: [
				{
					role: null,
					cards: {
						id: '5eed0000-0000-4000-8000-0000000000c8',
						title: 'Contrat cadre 2025',
						archived_at: '2026-03-31T16:00:00+00:00',
						channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
					},
				},
			],
		}
		monter(clientQuiRend(OK(archivee)), ID_LEO)
		expect(await screen.findByTestId('pilule-affaire-archivee')).toBeTruthy()
		expect(screen.getByTestId('lien-affaire-contact').getAttribute('href')).toBe(
			'/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c8',
		)
	})

	it("cas f bis : une affaire NON archivée ne porte AUCUNE pilule", async () => {
		monter(clientQuiRend(OK(LEO)), ID_LEO)
		expect(await screen.findByTestId('tableau-affaires-contact')).toBeTruthy()
		expect(screen.queryByTestId('pilule-affaire-archivee')).toBeNull()
	})

	it("cas h : un identifiant inexistant rend « contact introuvable », avec un retour au carnet", async () => {
		monter(clientQuiRend(VIDE), '00000000-0000-4000-8000-000000000000')
		expect(await screen.findByText(fr['contact.notFound.title'])).toBeTruthy()
		const retour = screen.getByRole('link', { name: fr['contact.notFound.action'] })
		expect(retour.getAttribute('href')).toBe('/contacts')
	})

	it("cas i : un identifiant MAL FORMÉ rend le même écran, et n'émet AUCUNE requête", async () => {
		let appels = 0
		const client = {
			from: () => {
				appels += 1
				return { select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve(VIDE) }) }) }) }
			},
		} as unknown as ClientCrm
		monter(client, 'pas-un-uuid')
		expect(await screen.findByText(fr['contact.notFound.title'])).toBeTruthy()
		expect(appels).toBe(0)
	})

	it("cas j : la lecture en vol rend des squelettes, jamais un spinner plein écran", () => {
		const client = {
			from: () => ({
				select: () => ({ eq: () => ({ is: () => ({ order: () => new Promise(() => {}) }) }) }),
			}),
		} as unknown as ClientCrm
		monter(client, ID_LEO)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it("cas k : la lecture en échec rend l'erreur, et la reprise RELANCE réellement la lecture", async () => {
		const client = clientQuiRend(
			{ data: null, error: { message: 'panne' }, status: 500 },
			OK(LEO),
		)
		monter(client, ID_LEO)
		expect(await screen.findByText(fr['contact.error.title'])).toBeTruthy()
		await userEvent.click(screen.getByRole('button', { name: fr['contact.error.retry'] }))
		// La reprise relit : la seconde réponse est celle de Léo, et l'écran la rend.
		expect(await screen.findByTestId('caracteristiques-contact')).toBeTruthy()
	})

	it("cas l : sans client, l'état vide dédié est rendu et aucune lecture n'est tentée", () => {
		monter(null, ID_LEO)
		expect(screen.getByText(fr['contact.noWorkspace.title'])).toBeTruthy()
	})
})

// ================================================================================================
// SOUS-TRANCHE 4g — LA MODIFICATION D'UN CONTACT DEPUIS SA FICHE (docs/SPEC-contacts.md §16.9)
// ================================================================================================

/**
 * Client espion qui LIT puis ÉCRIT : `from().select()…` pour la fiche,
 * `from().update().eq().select().maybeSingle()` pour la modification, et `from().select()` pour la
 * liste des organisations.
 *
 * `maybeSingle` figure dans la chaîne parce que le module l'emploie DÉLIBÉRÉMENT (§16.3) : zéro
 * ligne est un résultat attendu, et `single()` le déguiserait en erreur `PGRST116`. Un espion qui
 * ne l'exposerait pas laisserait passer un code revenu à `single()`.
 *
 * `ecritures` est consommée dans l'ordre ; la charge réellement envoyée est retenue dans
 * `envois`, pour que la preuve porte sur ce qui part et non seulement sur ce qui revient.
 */
function clientQuiEcrit(options: {
	lecture: Reponse
	organisations?: Reponse
	ecritures: Array<{ data: unknown; error: { message: string; code?: string } | null; status: number }>
}) {
	const envois: unknown[] = []
	let rangEcriture = 0
	const lectureChaine = {
		eq: () => lectureChaine,
		is: () => lectureChaine,
		order: () => lectureChaine,
		then: (resoudre: (valeur: Reponse) => unknown) =>
			Promise.resolve(options.lecture).then(resoudre),
	}
	const organisationsChaine = {
		eq: () => organisationsChaine,
		is: () => organisationsChaine,
		order: () => organisationsChaine,
		then: (resoudre: (valeur: Reponse) => unknown) =>
			Promise.resolve(options.organisations ?? { data: [], error: null, status: 200 }).then(
				resoudre,
			),
	}
	return {
		envois,
		client: {
			from: (table: string) => ({
				select: () => (table === 'organizations' ? organisationsChaine : lectureChaine),
				update: (charge: unknown) => {
					envois.push(charge)
					const reponse = options.ecritures[Math.min(rangEcriture, options.ecritures.length - 1)]
					rangEcriture += 1
					const chaine = {
						eq: () => chaine,
						select: () => chaine,
						maybeSingle: () => Promise.resolve(reponse),
					}
					return chaine
				},
			}),
		} as unknown as ClientCrm,
	}
}

/** Léo modifié tel que PostgREST le rend — colonnes du carnet, organisation embarquée. */
const LEO_MODIFIE = {
	id: ID_LEO,
	full_name: 'Léo Marchand-Vasseur',
	email: 'leo.marchand@sogexia.example',
	phone: null,
	role_title: 'Directeur général',
	organization_id: ID_SOGEXIA,
	organizations: { id: ID_SOGEXIA, name: 'Sogexia' },
}

const ACCEPTE = { data: LEO_MODIFIE, error: null, status: 200 }
/** Le SILENCE des mesures 3, 12 et 19 : `200`, aucune ligne, AUCUNE erreur (§16.3). */
const SANS_EFFET = { data: null, error: null, status: 200 }

async function ouvrirLeFormulaire() {
	await userEvent.click(await screen.findByTestId('ouvrir-modification-contact'))
	return screen.getByTestId('formulaire-modification-contact')
}

describe('modification d’un contact depuis sa fiche (docs/SPEC-contacts.md §16.9)', () => {
	it('cas a : la fiche porte UNE commande, et le formulaire est replié', async () => {
		const { client } = clientQuiEcrit({ lecture: OK(LEO), ecritures: [ACCEPTE] })
		monter(client, ID_LEO)
		expect(await screen.findByTestId('ouvrir-modification-contact')).toBeTruthy()
		expect(screen.queryByTestId('formulaire-modification-contact')).toBeNull()
		// Les deux zones sont inchangées : le geste ne pousse rien hors de l'écran.
		expect(screen.getByTestId('caracteristiques-contact')).toBeTruthy()
		expect(screen.getByTestId('tableau-affaires-contact')).toBeTruthy()
	})

	it('cas b : le formulaire s’ouvre PRÉREMPLI, le focus entre, la commande disparaît', async () => {
		const { client } = clientQuiEcrit({ lecture: OK(LEO), ecritures: [ACCEPTE] })
		monter(client, ID_LEO)
		await ouvrirLeFormulaire()
		const nom = screen.getByTestId('champ-nom-contact') as HTMLInputElement
		expect(nom.value).toBe('Léo Marchand')
		expect((screen.getByTestId('champ-fonction-contact') as HTMLInputElement).value).toBe(
			'Directeur achats',
		)
		expect((screen.getByTestId('champ-email-contact') as HTMLInputElement).value).toBe(
			'leo.marchand@sogexia.example',
		)
		// Le téléphone de Léo est `null` en base : le champ est VIDE, jamais la chaîne « null ».
		expect((screen.getByTestId('champ-telephone-contact') as HTMLInputElement).value).toBe('')
		expect(document.activeElement).toBe(nom)
		// La commande et le formulaire s'EXCLUENT (§16.5).
		expect(screen.queryByTestId('ouvrir-modification-contact')).toBeNull()
	})

	it('cas c : à la fermeture, le focus REVIENT à la commande d’ouverture', async () => {
		const { client } = clientQuiEcrit({ lecture: OK(LEO), ecritures: [ACCEPTE] })
		monter(client, ID_LEO)
		await ouvrirLeFormulaire()
		await userEvent.click(screen.getByTestId('annuler-modification-contact'))
		// La commande est REMONTÉE, et c'est elle qui porte le focus — non le document. C'est le
		// défaut trouvé au carnet par la décision 453, éprouvé ici avant qu'il ne se reproduise.
		const commande = await screen.findByTestId('ouvrir-modification-contact')
		expect(document.activeElement).toBe(commande)
	})

	it('cas d : un nom vidé est refusé PAR L’ÉCRAN, sans aucun appel réseau', async () => {
		const { client, envois } = clientQuiEcrit({ lecture: OK(LEO), ecritures: [ACCEPTE] })
		monter(client, ID_LEO)
		await ouvrirLeFormulaire()
		await userEvent.clear(screen.getByTestId('champ-nom-contact'))
		await userEvent.type(screen.getByTestId('champ-nom-contact'), '   ')
		await userEvent.click(screen.getByTestId('envoyer-modification-contact'))
		expect(envois).toHaveLength(0)
		expect(screen.getByTestId('champ-nom-contact').getAttribute('aria-invalid')).toBe('true')
		expect(screen.getByTestId('formulaire-modification-contact')).toBeTruthy()
	})

	it('cas e, f, q : l’envoi accepté met à jour la zone 1 et le NOM, sans relire, zone 2 intacte', async () => {
		const { client, envois } = clientQuiEcrit({ lecture: OK(LEO), ecritures: [ACCEPTE] })
		let nomVu: string | null | undefined
		render(
			<MemoryRouter>
				<ContenuFicheContact
					client={client}
					idContact={ID_LEO}
					onNomConnu={(nom) => {
						nomVu = nom
					}}
				/>
			</MemoryRouter>,
		)
		await ouvrirLeFormulaire()
		await userEvent.clear(screen.getByTestId('champ-nom-contact'))
		await userEvent.type(screen.getByTestId('champ-nom-contact'), 'Léo Marchand-Vasseur')
		await userEvent.clear(screen.getByTestId('champ-fonction-contact'))
		await userEvent.type(screen.getByTestId('champ-fonction-contact'), 'Directeur général')
		await userEvent.click(screen.getByTestId('envoyer-modification-contact'))

		// LES CINQ COLONNES PARTENT D'UN BLOC (§16.3, mesures 16 à 18), `workspace_id` jamais.
		expect(envois).toHaveLength(1)
		expect(envois[0]).toEqual({
			full_name: 'Léo Marchand-Vasseur',
			organization_id: ID_SOGEXIA,
			role_title: 'Directeur général',
			email: 'leo.marchand@sogexia.example',
			phone: null,
		})
		// Cas e : la zone 1 rend la NOUVELLE valeur, et le formulaire se referme.
		expect(await screen.findByText('Directeur général')).toBeTruthy()
		expect(screen.queryByTestId('formulaire-modification-contact')).toBeNull()
		// Cas f : le titre de la route suit le nouveau nom — il est une donnée (§16.7).
		expect(nomVu).toBe('Léo Marchand-Vasseur')
		// Cas q : la zone 2 est INCHANGÉE, et aucune seconde lecture n'a eu lieu.
		expect(screen.getByText('Migration ERP Sogexia')).toBeTruthy()
		expect(screen.getAllByTestId('ligne-affaire-contact')).toHaveLength(1)
	})

	it('cas h : une organisation détachée rend la valeur VIDE et SANS lien', async () => {
		const detache = {
			data: { ...LEO_MODIFIE, organization_id: null, organizations: null },
			error: null,
			status: 200,
		}
		const { client, envois } = clientQuiEcrit({ lecture: OK(LEO), ecritures: [detache] })
		monter(client, ID_LEO)
		await ouvrirLeFormulaire()
		await userEvent.selectOptions(screen.getByTestId('champ-organisation-contact'), '')
		await userEvent.click(screen.getByTestId('envoyer-modification-contact'))
		// Un facultatif blanc part à `null`, JAMAIS à `''` (§16.3, mesures 7 et 8).
		expect((envois[0] as { organization_id: unknown }).organization_id).toBeNull()
		await screen.findByTestId('ouvrir-modification-contact')
		expect(screen.queryByTestId('lien-organisation-contact')).toBeNull()
	})

	it('cas m et n : le SILENCE du serveur est DIT, et la saisie est conservée', async () => {
		const { client } = clientQuiEcrit({ lecture: OK(LEO), ecritures: [SANS_EFFET] })
		monter(client, ID_LEO)
		await ouvrirLeFormulaire()
		await userEvent.clear(screen.getByTestId('champ-nom-contact'))
		await userEvent.type(screen.getByTestId('champ-nom-contact'), 'Écrit par la lectrice')
		await userEvent.click(screen.getByTestId('envoyer-modification-contact'))

		// `200` ET ZÉRO LIGNE, SANS ERREUR : c'est la mesure 3 (lectrice) et la mesure 12 (contact
		// disparu), indistinguables par construction — un seul message les couvre (§16.4). Sans
		// cette branche, le formulaire se refermerait sur une modification qui n'a jamais eu lieu.
		const refus = await screen.findByTestId('refus-modification-contact')
		expect(refus.textContent).toBe(fr['contact.modification.refus.sansEffet'])
		// La saisie est CONSERVÉE : elle est ce que la personne perdrait sans l'avoir enregistré.
		expect((screen.getByTestId('champ-nom-contact') as HTMLInputElement).value).toBe(
			'Écrit par la lectrice',
		)
		expect(screen.getByTestId('formulaire-modification-contact')).toBeTruthy()
	})

	it('cas j, k, l : les trois refus d’erreur sont traduits par le dictionnaire FERMÉ', async () => {
		const cas = [
			{ code: '23505', statut: 409, cle: 'contact.modification.refus.doublon' },
			{ code: '23503', statut: 409, cle: 'contact.modification.refus.organisation' },
			{ code: '23514', statut: 400, cle: 'contact.modification.refus.saisie' },
		] as const
		for (const attendu of cas) {
			const { client } = clientQuiEcrit({
				lecture: OK(LEO),
				ecritures: [
					{ data: null, error: { message: 'refus', code: attendu.code }, status: attendu.statut },
				],
			})
			monter(client, ID_LEO)
			await ouvrirLeFormulaire()
			await userEvent.click(screen.getByTestId('envoyer-modification-contact'))
			const refus = await screen.findByTestId('refus-modification-contact')
			expect(refus.textContent).toBe(fr[attendu.cle])
			cleanup()
		}
	})

	it('cas o : pendant l’envoi, la commande est aria-busy et l’envoi ne part QU’UNE fois', async () => {
		// `debloquer` est déclaré hors de la promesse et typé explicitement : TypeScript réduirait
		// sinon son type à `never` après l'affectation faite dans l'exécuteur, qu'il ne suit pas.
		let debloquer: () => void = () => undefined
		const enAttente = new Promise<void>((resoudre) => {
			debloquer = resoudre
		})
		const envois: unknown[] = []
		const lectureChaine = {
			eq: () => lectureChaine,
			is: () => lectureChaine,
			order: () => lectureChaine,
			then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(OK(LEO)).then(resoudre),
		}
		const client = {
			from: () => ({
				select: () => lectureChaine,
				update: (charge: unknown) => {
					envois.push(charge)
					const chaine = {
						eq: () => chaine,
						select: () => chaine,
						maybeSingle: () => enAttente.then(() => ACCEPTE),
					}
					return chaine
				},
			}),
		} as unknown as ClientCrm
		monter(client, ID_LEO)
		await ouvrirLeFormulaire()
		const envoyer = screen.getByTestId('envoyer-modification-contact')
		await userEvent.click(envoyer)
		expect(envoyer.getAttribute('aria-busy')).toBe('true')
		// Un second déclenchement pendant l'aller-retour écrirait deux fois la même chose.
		await userEvent.click(envoyer)
		expect(envois).toHaveLength(1)
		debloquer()
	})

	it('cas r : ni sur l’introuvable, ni sur l’erreur, ni sans client, aucune commande', async () => {
		const { client } = clientQuiEcrit({ lecture: VIDE, ecritures: [ACCEPTE] })
		monter(client, ID_LEO)
		expect(await screen.findByText(fr['contact.notFound.title'])).toBeTruthy()
		expect(screen.queryByTestId('ouvrir-modification-contact')).toBeNull()
		cleanup()

		const enErreur = clientQuiEcrit({
			lecture: { data: null, error: { message: 'panne' }, status: 500 },
			ecritures: [ACCEPTE],
		})
		monter(enErreur.client, ID_LEO)
		expect(await screen.findByText(fr['contact.error.title'])).toBeTruthy()
		expect(screen.queryByTestId('ouvrir-modification-contact')).toBeNull()
		cleanup()

		monter(null, ID_LEO)
		expect(screen.getByText(fr['contact.noWorkspace.title'])).toBeTruthy()
		expect(screen.queryByTestId('ouvrir-modification-contact')).toBeNull()
	})
})

// =================================================================================================
// SOUS-TRANCHE 4h — LE RATTACHEMENT D'UNE AFFAIRE DEPUIS LA FICHE
// =================================================================================================
//
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4h
// @verifies docs/SPEC-contacts.md §17.2 (où le geste s'ancre), §17.3 (la liste n'est lue qu'à
//           l'ouverture), §17.4 (le refus EXPLICITE, et non le silence de 4g),
//           §17.6 (l'exclusion des déjà rattachées, la relecture, aucune commande éteinte),
//           §17.7 (contrat de comportement, cas a à n)
// @verifies docs/DESIGN_SYSTEM.md §5.26 (ce geste)

/**
 * Client qui LIT la fiche, LIT les affaires et ÉCRIT un rattachement.
 *
 * `insert` est distingué de `update` : la sous-tranche 4h insère dans `card_contacts`, là où 4g
 * met à jour `contacts`. Un espion qui confondrait les deux laisserait passer un code qui écrirait
 * dans la mauvaise table.
 */
function clientQuiRattache(options: {
	lectures: Reponse[]
	affaires: Reponse
	insertion?: { error: { message: string; code?: string } | null; status: number }
}) {
	const envois: unknown[] = []
	let rangLecture = 0
	const faire = (reponse: () => Reponse) => {
		const chaine: Record<string, unknown> = {
			then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse()).then(resoudre),
		}
		for (const nom of ['eq', 'is', 'order', 'limit']) chaine[nom] = () => chaine
		return chaine
	}
	return {
		envois,
		client: {
			from: (table: string) => ({
				select: () =>
					table === 'cards'
						? faire(() => options.affaires)
						: faire(() => {
								const reponse = options.lectures[Math.min(rangLecture, options.lectures.length - 1)]
								rangLecture += 1
								// La dernière réponse est REJOUÉE indéfiniment : une relecture déclenchée
								// par un rattachement réussi (cas f) en demande une de plus que la liste
								// n'en porte, et rendre `undefined` ferait échouer la lecture sur un état
								// que la pile ne produit jamais.
								return reponse ?? { data: [], error: null, status: 200 }
							}),
				insert: (charge: unknown) => {
					envois.push({ table, charge })
					return Promise.resolve(options.insertion ?? { error: null, status: 201 })
				},
			}),
		} as unknown as ClientCrm,
	}
}

const ERP = { id: ID_CARD_ERP, title: 'Migration ERP Sogexia', archived_at: null }
const VITRINE = { id: '5eed0000-0000-4000-8000-0000000000c1', title: 'Refonte du site vitrine', archived_at: null }
/** « Contrat cadre 2025 » du seed : la seule affaire ARCHIVÉE lisible (§17.3, mesure 15). */
const CONTRAT_ARCHIVE = {
	id: '5eed0000-0000-4000-8000-0000000000c8',
	title: 'Contrat cadre 2025',
	archived_at: '2026-03-31T16:00:00+00:00',
}

const AFFAIRES = (...lignes: unknown[]) => ({ data: lignes, error: null, status: 200 })

async function ouvrirLeRattachement() {
	await userEvent.click(await screen.findByTestId('ouvrir-rattachement-affaire'))
	return screen.getByTestId('formulaire-rattachement-affaire')
}

describe('rattachement d’une affaire depuis la fiche (docs/SPEC-contacts.md §17.7)', () => {
	it('cas a — la commande est rendue, et AUCUNE affaire n’est lue tant qu’elle n’est pas ouverte', async () => {
		let lecturesAffaires = 0
		const chaine: Record<string, unknown> = {
			then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(OK(LEO)).then(resoudre),
		}
		for (const nom of ['eq', 'is', 'order', 'limit']) chaine[nom] = () => chaine
		const client = {
			from: (table: string) => ({
				select: () => {
					if (table === 'cards') lecturesAffaires += 1
					return chaine
				},
			}),
		} as unknown as ClientCrm
		monter(client, ID_LEO)
		expect(await screen.findByTestId('ouvrir-rattachement-affaire')).toBeTruthy()
		// Charger quarante affaires pour un geste que la plupart des visites ne font pas serait une
		// requête gratuite (§17.3). C'est la règle du §13.4, tenue par le sélecteur d'organisations.
		expect(lecturesAffaires).toBe(0)
	})

	it('cas b — l’ouverture monte le formulaire, lit la liste, et le focus ENTRE dans le sélecteur', async () => {
		const { client } = clientQuiRattache({ lectures: [OK(LEO)], affaires: AFFAIRES(ERP, VITRINE) })
		monter(client, ID_LEO)
		await ouvrirLeRattachement()
		const selecteur = await screen.findByTestId('champ-affaire')
		expect(document.activeElement).toBe(selecteur)
		// La commande et le formulaire s'EXCLUENT (§17.6) : ouvrir remplace le bouton.
		expect(screen.queryByTestId('ouvrir-rattachement-affaire')).toBeNull()
	})

	it('cas c — « Annuler » remonte la commande ET LUI REND LE FOCUS', async () => {
		const { client } = clientQuiRattache({ lectures: [OK(LEO)], affaires: AFFAIRES(VITRINE) })
		monter(client, ID_LEO)
		await ouvrirLeRattachement()
		await userEvent.click(screen.getByText(fr['contact.attach.cancel']))
		const commande = await screen.findByTestId('ouvrir-rattachement-affaire')
		// Le retour est DIFFÉRÉ d'un tour de rendu : la commande est démontée pendant que le
		// formulaire est ouvert, et l'appeler depuis le gestionnaire viserait une référence nulle.
		// C'est le défaut trouvé au carnet par la décision 453. Aucune temporisation.
		expect(document.activeElement).toBe(commande)
	})

	it('cas d — le sélecteur n’offre AUCUNE affaire déjà rattachée à ce contact', async () => {
		// Léo est rattaché à « Migration ERP Sogexia » : elle ne doit pas être offerte. Ce n'est pas
		// une garde de droit, c'est le refus d'une commande vouée au `409` (§17.4, mesure 8).
		const { client } = clientQuiRattache({ lectures: [OK(LEO)], affaires: AFFAIRES(ERP, VITRINE) })
		monter(client, ID_LEO)
		await ouvrirLeRattachement()
		const options = [...(await screen.findByTestId('champ-affaire')).querySelectorAll('option')]
		const libelles = options.map((option) => option.textContent)
		expect(libelles).toContain('Refonte du site vitrine')
		expect(libelles).not.toContain('Migration ERP Sogexia')
	})

	it('cas d — une affaire ARCHIVÉE est offerte, et son option le DIT', async () => {
		const { client } = clientQuiRattache({
			lectures: [OK(ELISE)],
			affaires: AFFAIRES(CONTRAT_ARCHIVE),
		})
		monter(client, ID_ELISE)
		await ouvrirLeRattachement()
		const options = [...(await screen.findByTestId('champ-affaire')).querySelectorAll('option')]
		// La base ACCEPTE ce rattachement (mesure 6). La mention est un TEXTE dans le libellé :
		// une `option` native ne porte ni icône ni pilule, et le §1 interdit qu'une couleur porte
		// seule une information (§5.26).
		expect(options.map((option) => option.textContent)).toContain('Contrat cadre 2025 (archivée)')
	})

	it('cas e — la commande d’envoi est éteinte tant qu’aucune affaire n’est choisie, et rien n’est envoyé', async () => {
		const { client, envois } = clientQuiRattache({
			lectures: [OK(LEO)],
			affaires: AFFAIRES(VITRINE),
		})
		monter(client, ID_LEO)
		await ouvrirLeRattachement()
		const envoyer = (await screen.findByTestId('confirmer-rattachement-affaire')) as HTMLButtonElement
		// Elle n'est PAS éteinte par un rôle (§17.6) : elle l'est faute d'objet à envoyer.
		expect(envoyer.disabled).toBe(true)
		await userEvent.click(envoyer)
		expect(envois).toEqual([])
	})

	it('cas f et h — le rattachement accepté envoie les quatre colonnes, un rôle vide valant `null`, et RELIT la fiche', async () => {
		let lectures = 0
		const chaineLecture: Record<string, unknown> = {
			then: (resoudre: (valeur: Reponse) => unknown) => {
				lectures += 1
				return Promise.resolve(OK(ELISE)).then(resoudre)
			},
		}
		for (const nom of ['eq', 'is', 'order', 'limit']) chaineLecture[nom] = () => chaineLecture
		const chaineAffaires: Record<string, unknown> = {
			then: (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(AFFAIRES(VITRINE)).then(resoudre),
		}
		for (const nom of ['eq', 'is', 'order', 'limit']) chaineAffaires[nom] = () => chaineAffaires
		const envois: unknown[] = []
		const client = {
			from: (table: string) => ({
				select: () => (table === 'cards' ? chaineAffaires : chaineLecture),
				insert: (charge: unknown) => {
					envois.push(charge)
					return Promise.resolve({ error: null, status: 201 })
				},
			}),
		} as unknown as ClientCrm
		monter(client, ID_ELISE)
		await ouvrirLeRattachement()
		await userEvent.selectOptions(screen.getByTestId('champ-affaire'), VITRINE.id)
		await userEvent.click(screen.getByTestId('confirmer-rattachement-affaire'))
		// UN RÔLE VIDE VAUT `null`, JAMAIS `""` : la contrainte `card_contacts_role_check` refuse
		// la chaîne vide par `400` / `23514` (§17.4, mesure 11).
		expect(envois).toEqual([
			{ workspace_id: ID_WORKSPACE, card_id: VITRINE.id, contact_id: ID_ELISE, role: null },
		])
		// LA FICHE EST RELUE, jamais complétée localement (§17.6) : la relecture rapporte l'état
		// d'archivage et l'adresse de l'affaire ajoutée, que le sélecteur ne connaissait pas.
		await screen.findByTestId('ouvrir-rattachement-affaire')
		expect(lectures).toBeGreaterThan(1)
	})

	it('cas i et k — un refus 403 est DIT, le formulaire RESTE ouvert et la saisie est conservée', async () => {
		const { client } = clientQuiRattache({
			lectures: [OK(LEO)],
			affaires: AFFAIRES(VITRINE),
			insertion: { error: { message: 'row-level security', code: '42501' }, status: 403 },
		})
		monter(client, ID_LEO)
		await ouvrirLeRattachement()
		await userEvent.selectOptions(screen.getByTestId('champ-affaire'), VITRINE.id)
		await userEvent.type(screen.getByTestId('champ-role-affaire'), 'sponsor')
		await userEvent.click(screen.getByTestId('confirmer-rattachement-affaire'))
		// AUCUN « SANS EFFET » ICI, et c'est l'écart mesuré avec 4g : une insertion est filtrée par
		// WITH CHECK, qui REJETTE la ligne — `403` explicite (mesure 9) —, là où une mise à jour
		// l'est par USING et rend `200` avec zéro ligne sans erreur.
		const refus = await screen.findByTestId('refus-rattachement-affaire')
		expect(refus.textContent).toBe(fr['contact.attach.refus.forbidden'])
		// UN REFUS N'EFFACE PAS LA SAISIE (§5.7 ter), et le formulaire reste ouvert.
		expect(screen.getByTestId('formulaire-rattachement-affaire')).toBeTruthy()
		expect((screen.getByTestId('champ-role-affaire') as HTMLInputElement).value).toBe('sponsor')
		expect((screen.getByTestId('champ-affaire') as HTMLSelectElement).value).toBe(VITRINE.id)
	})

	it('cas j — un doublon 409 est traduit par SON message, distinct du refus d’autorisation', async () => {
		const { client } = clientQuiRattache({
			lectures: [OK(LEO)],
			affaires: AFFAIRES(VITRINE),
			insertion: { error: { message: 'duplicate key', code: '23505' }, status: 409 },
		})
		monter(client, ID_LEO)
		await ouvrirLeRattachement()
		await userEvent.selectOptions(screen.getByTestId('champ-affaire'), VITRINE.id)
		await userEvent.click(screen.getByTestId('confirmer-rattachement-affaire'))
		// Le sélecteur exclut déjà les affaires rattachées, mais deux utilisateurs peuvent agir à
		// la même seconde : l'écran ne prétend pas connaître l'état du serveur (§17.6).
		const refus = await screen.findByTestId('refus-rattachement-affaire')
		expect(refus.textContent).toBe(fr['contact.attach.refus.alreadyAttached'])
	})

	it('cas l — une liste illisible désactive le sélecteur et porte son action de reprise', async () => {
		const { client } = clientQuiRattache({
			lectures: [OK(LEO)],
			affaires: { data: null, error: { message: 'boom' }, status: 500 },
		})
		monter(client, ID_LEO)
		await ouvrirLeRattachement()
		expect(await screen.findByTestId('erreur-affaires-rattachables')).toBeTruthy()
		expect(screen.getByTestId('relire-affaires')).toBeTruthy()
		// Un `select` vide mais actif serait la commande morte que le §5.21 refuse : il n'est pas
		// rendu du tout (§5.22).
		expect(screen.queryByTestId('champ-affaire')).toBeNull()
	})

	it('cas m — aucune affaire offerte : mention SANS action, et aucun sélecteur vide', async () => {
		// Léo est rattaché à la seule affaire lisible : il ne reste rien à offrir.
		const { client } = clientQuiRattache({ lectures: [OK(LEO)], affaires: AFFAIRES(ERP) })
		monter(client, ID_LEO)
		await ouvrirLeRattachement()
		expect(await screen.findByTestId('aucune-affaire-rattachable')).toBeTruthy()
		expect(screen.queryByTestId('champ-affaire')).toBeNull()
		expect(screen.queryByTestId('confirmer-rattachement-affaire')).toBeNull()
	})

	it('cas n — aucun geste sur l’introuvable, sur l’erreur, ni sans espace de travail', async () => {
		const { client } = clientQuiRattache({ lectures: [VIDE], affaires: AFFAIRES(VITRINE) })
		monter(client, ID_LEO)
		// Il n'y a PAS d'objet à rattacher : le rattachement a besoin de l'identifiant du contact
		// et de son workspace, qu'un contact absent ne porte pas.
		expect(await screen.findByText(fr['contact.notFound.title'])).toBeTruthy()
		expect(screen.queryByTestId('ouvrir-rattachement-affaire')).toBeNull()

		cleanup()
		const { client: enErreur } = clientQuiRattache({
			lectures: [{ data: null, error: { message: 'boom' }, status: 500 }],
			affaires: AFFAIRES(VITRINE),
		})
		monter(enErreur, ID_LEO)
		expect(await screen.findByText(fr['contact.error.title'])).toBeTruthy()
		expect(screen.queryByTestId('ouvrir-rattachement-affaire')).toBeNull()

		cleanup()
		monter(null, ID_LEO)
		expect(await screen.findByText(fr['contact.noWorkspace.title'])).toBeTruthy()
		expect(screen.queryByTestId('ouvrir-rattachement-affaire')).toBeNull()
	})

	it('le geste vit DANS la zone des affaires, et l’état vide le GARDE (§17.2, §5.24 révisé)', async () => {
		// Élise n'a AUCUNE affaire : l'état vide de la zone garde désormais son geste — c'est lui
		// qui le comble, la règle du §5.13. C'est la RÉVISION PAR LIVRAISON du §5.24.
		const { client } = clientQuiRattache({ lectures: [OK(ELISE)], affaires: AFFAIRES(VITRINE) })
		monter(client, ID_ELISE)
		expect(await screen.findByText(fr['contact.deals.empty.title'])).toBeTruthy()
		const commande = screen.getByTestId('ouvrir-rattachement-affaire')
		// Il est DANS la section des affaires, et non à côté de « Modifier » : un geste se pose près
		// de ce qu'il change (§17.2).
		const section = commande.closest('section')
		expect(section?.textContent).toContain(fr['contact.deals.title'])
		expect(section?.textContent).not.toContain(fr['contact.modification.open'])
	})
})

// =================================================================================================
// SOUS-TRANCHE 4i — LE DÉTACHEMENT D'UNE AFFAIRE DEPUIS LA FICHE
// =================================================================================================
//
// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4i
// @verifies docs/SPEC-contacts.md §18.3 (les onze mesures, et les quatre qui décident),
//           §18.4 (la quatrième colonne, la confirmation sur une ligne à elle, l'exclusivité),
//           §18.5 (dictionnaire FERMÉ), §18.6 (de quoi le geste a l'air, la relecture dans les
//           TROIS issues), §18.7 (contrat de comportement, cas a à m)
// @verifies docs/DESIGN_SYSTEM.md §5.27 (ce geste), §5.24 révisé (le tableau à QUATRE colonnes)

/**
 * Client qui LIT la fiche et SUPPRIME un rattachement.
 *
 * `delete` est distingué de `insert` et de `update` : cette sous-tranche supprime dans
 * `card_contacts`, là où 4h y insère et où 4g met à jour `contacts`. Un espion qui les confondrait
 * laisserait passer un code qui écrirait par le mauvais verbe.
 *
 * **`suppressions` porte les FILTRES réellement posés**, et non un simple compteur : le contrat du
 * §18.2 exige les deux — `card_id` ET `contact_id`. Un code qui n'en poserait qu'un détacherait
 * le contact de TOUTES ses affaires, et un compteur ne le verrait pas.
 */
function clientQuiDetache(options: {
	lectures: Reponse[]
	suppression?: Reponse
}) {
	const suppressions: Array<Record<string, unknown>> = []
	let rangLecture = 0
	const lireChaine = () => {
		const chaine: Record<string, unknown> = {
			then: (resoudre: (valeur: Reponse) => unknown) => {
				const reponse = options.lectures[Math.min(rangLecture, options.lectures.length - 1)]
				rangLecture += 1
				// La dernière réponse est REJOUÉE : la relecture des trois issues (§18.6) en demande
				// une de plus que la liste n'en porte.
				return Promise.resolve(reponse ?? VIDE).then(resoudre)
			},
		}
		for (const nom of ['eq', 'is', 'order', 'limit']) chaine[nom] = () => chaine
		return chaine
	}
	return {
		suppressions,
		client: {
			from: (table: string) => ({
				select: () => lireChaine(),
				delete: () => {
					const filtres: Record<string, unknown> = { table }
					const chaine: Record<string, unknown> = {
						eq: (colonne: string, valeur: unknown) => {
							filtres[colonne] = valeur
							return chaine
						},
						select: () => {
							suppressions.push(filtres)
							return Promise.resolve(
								options.suppression ?? { data: [{ contact_id: 'x' }], error: null, status: 200 },
							)
						},
					}
					return chaine
				},
			}),
		} as unknown as ClientCrm,
	}
}

/** Léo avec DEUX affaires, dont une ARCHIVÉE : le seed n'en porte qu'une (§15.7), et les cas d */
/** et j du §18.7 en demandent deux. */
const LEO_DEUX_AFFAIRES = {
	...LEO,
	card_contacts: [
		...LEO.card_contacts,
		{
			role: null,
			cards: {
				id: CONTRAT_ARCHIVE.id,
				title: CONTRAT_ARCHIVE.title,
				archived_at: CONTRAT_ARCHIVE.archived_at,
				channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
			},
		},
	],
}

const SILENCE: Reponse = { data: [], error: null, status: 200 }

async function ouvrirLaConfirmation(idCard: string) {
	const commandes = await screen.findAllByTestId('detacher-affaire-contact')
	const commande = commandes.find((bouton) => bouton.getAttribute('data-card') === idCard)
	if (commande === undefined) throw new Error(`aucune commande de détachement pour ${idCard}`)
	await userEvent.click(commande)
	return commande
}

describe('détachement d’une affaire depuis la fiche (docs/SPEC-contacts.md §18.7)', () => {
	it('cas a — CHAQUE ligne porte sa commande, l’archivée comprise, et aucune confirmation n’est ouverte', async () => {
		const { client } = clientQuiDetache({ lectures: [OK(LEO_DEUX_AFFAIRES)] })
		monter(client, ID_LEO)
		const commandes = await screen.findAllByTestId('detacher-affaire-contact')
		expect(commandes).toHaveLength(2)
		// TOUTES LES LIGNES PORTENT LA MÊME COMMANDE (§18.3, mesure 4) : la base accepte le
		// détachement sur une affaire archivée, `app.can_write_card` dérivant du channel et ne
		// lisant ni `archived_at` ni `deleted_at`. Rien à l'écran ne distingue cette ligne.
		expect(commandes.map((bouton) => bouton.getAttribute('data-card')).sort()).toEqual(
			[ID_CARD_ERP, CONTRAT_ARCHIVE.id].sort(),
		)
		expect(screen.queryByTestId('confirmation-detachement-affaire')).toBeNull()
		// La QUATRIÈME COLONNE porte un en-tête LISIBLE, jamais une cellule vide (§5.27, §8).
		expect(screen.getByText(fr['contact.detach.column'])).toBeTruthy()
	})

	it('cas b — la confirmation NOMME l’affaire, sur une ligne à elle, et le focus y entre', async () => {
		const { client } = clientQuiDetache({ lectures: [OK(LEO_DEUX_AFFAIRES)] })
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(ID_CARD_ERP)
		const confirmation = screen.getByTestId('confirmation-detachement-affaire')
		// ELLE NOMME L'AFFAIRE, ET NON LE CONTACT (§18.6) : c'est le §12.6 retourné, le contact
		// étant ici le décor — on lit sa fiche — et l'affaire la variable.
		expect(confirmation.textContent).toContain('Migration ERP Sogexia')
		expect(confirmation.textContent).not.toContain('Léo Marchand')
		// UNE LIGNE DE TABLEAU À ELLE, SUR TOUTE LA LARGEUR (§18.4) : dans la cellule de la
		// commande, bornée à 32ch et tronquée, le titre de l'affaire serait coupé.
		const ligne = screen.getByTestId('ligne-confirmation-detachement')
		expect(ligne.tagName).toBe('TR')
		expect(ligne.getAttribute('data-card')).toBe(ID_CARD_ERP)
		expect(ligne.querySelector('td')?.getAttribute('colspan')).toBe('4')
		expect(document.activeElement).toBe(screen.getByTestId('confirmer-detachement-affaire'))
	})

	it('cas c — « Annuler » démonte la confirmation ET rend le focus à la commande de SA ligne', async () => {
		const { client } = clientQuiDetache({ lectures: [OK(LEO_DEUX_AFFAIRES)] })
		monter(client, ID_LEO)
		const commande = await ouvrirLaConfirmation(CONTRAT_ARCHIVE.id)
		await userEvent.click(screen.getByTestId('annuler-detachement-affaire'))
		expect(screen.queryByTestId('confirmation-detachement-affaire')).toBeNull()
		// LE RETOUR EST DIFFÉRÉ, et le motif diffère de 4g et 4h : la commande n'est pas démontée,
		// elle est `disabled` — et un élément désactivé ne reçoit pas le focus.
		expect(document.activeElement).toBe(commande)
	})

	it('cas d — ouvrir la confirmation d’une AUTRE ligne ferme la précédente : une seule à tout instant', async () => {
		const { client } = clientQuiDetache({ lectures: [OK(LEO_DEUX_AFFAIRES)] })
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(ID_CARD_ERP)
		expect(screen.getAllByTestId('ligne-confirmation-detachement')).toHaveLength(1)
		await ouvrirLaConfirmation(CONTRAT_ARCHIVE.id)
		const lignes = screen.getAllByTestId('ligne-confirmation-detachement')
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.getAttribute('data-card')).toBe(CONTRAT_ARCHIVE.id)
	})

	it('cas a bis — la commande de la ligne confirmée est DÉSACTIVÉE, les autres restent actives', async () => {
		const { client } = clientQuiDetache({ lectures: [OK(LEO_DEUX_AFFAIRES)] })
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(ID_CARD_ERP)
		const commandes = screen.getAllByTestId('detacher-affaire-contact')
		const surERP = commandes.find((b) => b.getAttribute('data-card') === ID_CARD_ERP)
		const surArchive = commandes.find((b) => b.getAttribute('data-card') === CONTRAT_ARCHIVE.id)
		// Ce n'est PAS une garde de droit (§18.6) : c'est une commande sans objet, il n'y a rien à
		// rouvrir. Les autres lignes ne sont pas concernées.
		expect((surERP as HTMLButtonElement).disabled).toBe(true)
		expect((surArchive as HTMLButtonElement).disabled).toBe(false)
	})

	it('cas f — le détachement appliqué pose les DEUX filtres, referme, relit, et n’affiche AUCUN message', async () => {
		const { client, suppressions } = clientQuiDetache({
			lectures: [OK(LEO_DEUX_AFFAIRES), OK(LEO)],
		})
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(CONTRAT_ARCHIVE.id)
		await userEvent.click(screen.getByTestId('confirmer-detachement-affaire'))
		// LES DEUX FILTRES (§18.2) : sans `contact_id`, la requête détacherait TOUS les contacts de
		// l'affaire ; sans `card_id`, elle détacherait le contact de toutes ses affaires.
		expect(suppressions).toHaveLength(1)
		expect(suppressions[0]).toMatchObject({
			table: 'card_contacts',
			card_id: CONTRAT_ARCHIVE.id,
			contact_id: ID_LEO,
		})
		expect(screen.queryByTestId('confirmation-detachement-affaire')).toBeNull()
		// LA FICHE EST RELUE, JAMAIS AMPUTÉE LOCALEMENT (§18.6) : la seconde lecture ne rend plus
		// que l'affaire active, et c'est elle — non un retrait optimiste — qui vide la ligne.
		//
		// L'ATTENTE EST EXPLICITE, ET C'EST LA PREUVE MÊME DU CONTRAT : `findAllBy` rendrait la
		// main sur les DEUX lignes encore affichées, l'ancien rendu satisfaisant déjà le sélecteur.
		// C'est exactement ce qu'un retrait optimiste aurait fait disparaître sans relecture ;
		// attendre la relecture est donc ce qui distingue les deux comportements.
		await waitFor(() => expect(screen.getAllByTestId('ligne-affaire-contact')).toHaveLength(1))
		expect(screen.queryByTestId('pilule-affaire-archivee')).toBeNull()
		expect(screen.queryByTestId('message-detachement-affaire')).toBeNull()
	})

	it('cas g — détacher la DERNIÈRE affaire laisse l’état vide, qui garde le geste de rattachement', async () => {
		const { client } = clientQuiDetache({ lectures: [OK(LEO), OK({ ...LEO, card_contacts: [] })] })
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(ID_CARD_ERP)
		await userEvent.click(screen.getByTestId('confirmer-detachement-affaire'))
		expect(await screen.findByText(fr['contact.deals.empty.title'])).toBeTruthy()
		expect(screen.queryByTestId('tableau-affaires-contact')).toBeNull()
		// L'état vide GARDE le geste de rattachement (§17.6) et n'en gagne aucun de détachement :
		// un tableau sans ligne n'en a aucune à porter (§5.24, révision finale).
		expect(screen.getByTestId('ouvrir-rattachement-affaire')).toBeTruthy()
		expect(screen.queryByTestId('detacher-affaire-contact')).toBeNull()
	})

	it('cas h — le SILENCE est dit, la fiche est RELUE, et la ligne reste puisque la base l’a gardée', async () => {
		const { client } = clientQuiDetache({
			lectures: [OK(LEO)],
			suppression: SILENCE,
		})
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(ID_CARD_ERP)
		await userEvent.click(screen.getByTestId('confirmer-detachement-affaire'))
		// L'ISSUE « SANS EFFET » N'EST NI UN SUCCÈS NI UNE ERREUR (§18.3, mesures 2 et 3). La clause
		// `USING` a filtré la ligne avant la suppression : elle EXISTE toujours. Le message dit ce
		// qui est vrai des deux causes indistinguables, sans affirmer ni le refus ni la disparition.
		const message = await screen.findByTestId('message-detachement-affaire')
		expect(message.textContent).toBe(fr['contact.detach.noeffect'])
		expect(message.getAttribute('role')).toBe('alert')
		expect(screen.queryByTestId('confirmation-detachement-affaire')).toBeNull()
		// LA LIGNE RESTE — c'est tout le point : un retrait optimiste effacerait ici une ligne que
		// la base a gardée, et annoncerait un détachement qui n'a pas eu lieu.
		expect(screen.getAllByTestId('ligne-affaire-contact')).toHaveLength(1)
	})

	it('cas i — un refus est traduit par le dictionnaire FERMÉ, jamais par le message du serveur', async () => {
		const { client } = clientQuiDetache({
			lectures: [OK(LEO)],
			suppression: {
				data: null,
				error: { message: 'permission denied for table card_contacts' },
				status: 401,
			},
		})
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(ID_CARD_ERP)
		await userEvent.click(screen.getByTestId('confirmer-detachement-affaire'))
		const message = await screen.findByTestId('message-detachement-affaire')
		expect(message.textContent).toBe(fr['contact.detach.refus.forbidden'])
		// LE TEXTE DU SERVEUR N'ATTEINT JAMAIS L'ÉCRAN (§18.5) : le rendre tel quel exposerait le
		// détail de la pile (`CLAUDE.md` §20).
		expect(message.textContent).not.toContain('permission denied')
	})

	it('cas i bis — une panne réseau a son propre texte, distinct du refus', async () => {
		const { client } = clientQuiDetache({
			lectures: [OK(LEO)],
			suppression: { data: null, error: { message: 'Failed to fetch' }, status: 0 },
		})
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(ID_CARD_ERP)
		await userEvent.click(screen.getByTestId('confirmer-detachement-affaire'))
		const message = await screen.findByTestId('message-detachement-affaire')
		expect(message.textContent).toBe(fr['contact.detach.refus.network'])
	})

	it('cas e — la confirmation est DÉSACTIVÉE en vol, et n’émet jamais deux requêtes', async () => {
		// L'assertion d'affectation définie est nécessaire, et le motif est un vrai écart entre le
		// compilateur et l'exécution : `tsc` ne sait pas que l'exécuteur d'une `Promise` est appelé
		// SYNCHRONEMENT, si bien qu'il tient la variable pour encore `null` après cette ligne et
		// réduit son type à `never` à l'appel. La déclarer affectée dit ce que l'exécution garantit.
		let debloquer!: (valeur: Reponse) => void
		const enVol = new Promise<Reponse>((resoudre) => {
			debloquer = resoudre
		})
		const suppressions: unknown[] = []
		const lireChaine = () => {
			const chaine: Record<string, unknown> = {
				then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(OK(LEO)).then(resoudre),
			}
			for (const nom of ['eq', 'is', 'order', 'limit']) chaine[nom] = () => chaine
			return chaine
		}
		const client = {
			from: () => ({
				select: () => lireChaine(),
				delete: () => {
					const chaine: Record<string, unknown> = {
						eq: () => chaine,
						select: () => {
							suppressions.push(1)
							return enVol
						},
					}
					return chaine
				},
			}),
		} as unknown as ClientCrm
		monter(client, ID_LEO)
		await ouvrirLaConfirmation(ID_CARD_ERP)
		const bouton = screen.getByTestId('confirmer-detachement-affaire') as HTMLButtonElement
		await userEvent.click(bouton)
		expect(bouton.disabled).toBe(true)
		expect(bouton.textContent).toContain(fr['contact.detach.pending'])
		await userEvent.click(bouton)
		expect(suppressions).toHaveLength(1)
		debloquer({ data: [{ contact_id: ID_LEO }], error: null, status: 200 })
	})

	it('cas l — sans contact, sans client ou en erreur, AUCUNE commande n’est rendue', async () => {
		const { client: introuvable } = clientQuiDetache({ lectures: [VIDE] })
		monter(introuvable, ID_LEO)
		expect(await screen.findByText(fr['contact.notFound.title'])).toBeTruthy()
		expect(screen.queryByTestId('detacher-affaire-contact')).toBeNull()
		cleanup()

		monter(null, ID_LEO)
		expect(screen.getByText(fr['contact.noWorkspace.title'])).toBeTruthy()
		expect(screen.queryByTestId('detacher-affaire-contact')).toBeNull()
		cleanup()

		const { client: casse } = clientQuiDetache({
			lectures: [{ data: null, error: { message: 'boom' }, status: 500 }],
		})
		monter(casse, ID_LEO)
		expect(await screen.findByText(fr['contact.error.title'])).toBeTruthy()
		expect(screen.queryByTestId('detacher-affaire-contact')).toBeNull()
	})

	it('cas m — la commande est rendue ACTIVE quel que soit le rôle : l’écran ne calcule aucun droit', async () => {
		// MESURÉ (§18.3, mesure 7) : la LECTRICE RÉUSSIT ce détachement sur une affaire et reçoit
		// le silence sur une autre, toutes deux lisibles par elle. Les droits fins de `CRM-012`
		// divergent d'une affaire à l'autre POUR UN MÊME PROFIL — aucune propriété du profil ne
		// prédit l'issue, et l'écran qui grisrait « parce que lecteur » se tromperait.
		const { client } = clientQuiDetache({ lectures: [OK(LEO_DEUX_AFFAIRES)] })
		monter(client, ID_LEO)
		const commandes = await screen.findAllByTestId('detacher-affaire-contact')
		for (const commande of commandes) {
			expect((commande as HTMLButtonElement).disabled).toBe(false)
		}
	})
})
