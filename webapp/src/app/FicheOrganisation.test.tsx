// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4b
// @verifies docs/SPEC-contacts.md §11.5 (de quoi l'écran a l'air : deux zones, le site en lien,
//           le domaine en texte), §11.8 (limites nommées : le contact ne mène nulle part),
//           §11.9 (contrat de comportement, cas a à h)
// @verifies docs/DESIGN_SYSTEM.md §5.20 (cette surface), §5.9 (cellule sans valeur VIDE),
//           §5.8 (états explicites), §2 (données techniques)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, jamais une erreur)
//
// Les données injectées sont celles du SEED, à l'identique — Sogexia avec son site web et son
// contact, Studio Meunier sans domaine ni site, Comptoir Vasseur sans aucun contact. Ce n'est pas
// une commodité : ce sont les cas a à d du §11.9, et les mêmes que la preuve E2E exerce sur la
// pile réelle.

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ContenuFicheOrganisation } from './FicheOrganisation'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

/** Client minimal : une seule lecture, `from().select().eq().order()`. */
function clientQuiRend(...reponses: Reponse[]): ClientCrm {
	let rang = 0
	const chaine = {
		eq: () => chaine,
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

const ID_SOGEXIA = '5eed0000-0000-4000-8000-000000000081'
const ID_MEUNIER = '5eed0000-0000-4000-8000-000000000082'
const ID_VASSEUR = '5eed0000-0000-4000-8000-000000000083'

const SOGEXIA = {
	id: ID_SOGEXIA,
	name: 'Sogexia',
	domain: 'sogexia.example',
	website: 'https://www.sogexia.example',
	contacts: [
		{
			id: '5eed0000-0000-4000-8000-000000000091',
			full_name: 'Léo Marchand',
			email: 'leo.marchand@sogexia.example',
			phone: null,
			role_title: 'Directeur achats',
		},
	],
}

/** Studio Meunier : ni domaine, ni site web — le cas b du §11.9. */
const MEUNIER = {
	id: ID_MEUNIER,
	name: 'Studio Meunier',
	domain: null,
	website: null,
	contacts: [
		{
			id: '5eed0000-0000-4000-8000-000000000093',
			full_name: 'Élise Fabre',
			email: null,
			phone: '+33 6 12 34 56 78',
			role_title: "Cheffe d'atelier",
		},
	],
}

/** Comptoir Vasseur : aucun contact — le cas d du §11.9, seedé par cette sous-tranche. */
const VASSEUR = {
	id: ID_VASSEUR,
	name: 'Comptoir Vasseur',
	domain: 'comptoir-vasseur.example',
	website: null,
	contacts: [],
}

/**
 * Ces preuves montent le CONTENU de la fiche, et non la route.
 *
 * Ce n'est pas une commodité : la route pose `AppShell`, qui lit `clientCrm` — le client de
 * MODULE, non injectable — pour les espaces de travail et les tracks. Montée ici, elle rendrait
 * l'état de configuration de sa zone principale et JAMAIS la fiche : la preuve n'éprouverait
 * alors que la coquille. C'est le patron déjà tenu par `RouteCard`, dont les preuves unitaires
 * montent `BlocCorbeilleCard`. Le parcours complet, coquille et adresse comprises, est éprouvé
 * par `e2e/ui/contacts.spec.ts` sur la pile réelle.
 *
 * L'identifiant est passé tel qu'il viendrait de l'adresse — de forme quelconque —, ce qui permet
 * au cas f d'être éprouvé exactement comme l'utilisateur le produit : en éditant l'URL.
 *
 * Le routeur reste posé : le retour au carnet du cas e est un `Link`.
 */
function rendreA(idOrganisation: string | undefined, client: ClientCrm | null) {
	return render(
		<MemoryRouter>
			<ContenuFicheOrganisation client={client} idOrganisation={idOrganisation} />
		</MemoryRouter>,
	)
}

describe("Fiche d'organisation", () => {
	it('rend le nom en titre, ses caractéristiques et ses contacts — cas a du §11.9', async () => {
		rendreA(ID_SOGEXIA, clientQuiRend({ data: [SOGEXIA], error: null, status: 200 }),
		)
		// Le titre de la route — le NOM de l'organisation — est porté par la COQUILLE (§11.2), que
		// ces preuves ne montent pas : il est éprouvé par `e2e/ui/contacts.spec.ts` sur la pile
		// réelle. Ce qui est vérifié ici est le contenu que la fiche rend elle-même.
		const lignes = await screen.findAllByTestId('ligne-contact-organisation')
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.textContent).toContain('Léo Marchand')
		expect(lignes[0]?.textContent).toContain('Directeur achats')
	})

	it('laisse la valeur VIDE quand le domaine et le site manquent — cas b du §11.9', async () => {
		rendreA(ID_MEUNIER, clientQuiRend({ data: [MEUNIER], error: null, status: 200 }),
		)
		const bloc = await screen.findByTestId('caracteristiques-organisation')
		// LA RÈGLE PORTE SUR LA VALEUR, et l'assertion doit donc porter sur elle : chaque `dd` est
		// VIDE — ni tiret, ni « — », ni « non renseigné » (§5.9, §5.20). Mesurer le texte du bloc
		// entier confondrait les valeurs avec leurs libellés.
		const valeurs = [...bloc.querySelectorAll('dd')].map((dd) => dd.textContent)
		expect(valeurs).toEqual(['', ''])
		// Les deux libellés restent rendus : c'est la VALEUR qui manque, pas le champ.
		expect(bloc.textContent).toContain(fr['organization.field.domain'])
		expect(bloc.textContent).toContain(fr['organization.field.website'])
		expect(screen.queryByTestId('lien-site-organisation')).toBeNull()
	})

	it('rend le site web en LIEN externe annoncé, et le domaine en TEXTE — cas c du §11.9', async () => {
		rendreA(ID_SOGEXIA, clientQuiRend({ data: [SOGEXIA], error: null, status: 200 }),
		)
		const lien = await screen.findByTestId('lien-site-organisation')
		expect(lien.getAttribute('href')).toBe('https://www.sogexia.example')
		expect(lien.getAttribute('target')).toBe('_blank')
		// `noreferrer noopener` : une page ouverte ne doit pas garder la main sur l'ouvrante.
		expect(lien.getAttribute('rel')).toContain('noopener')
		expect(lien.getAttribute('rel')).toContain('noreferrer')
		// La sortie du produit est ANNONCÉE, jamais subie (§11.5, §8).
		expect(lien.textContent).toContain(fr['organization.website.newTab'])

		// Le DOMAINE n'est pas un lien : `sogexia.example` est un pivot de rapprochement d'emails,
		// pas une adresse à visiter — en faire un lien inventerait un schéma que la donnée ne
		// porte pas (§11.5).
		const bloc = screen.getByTestId('caracteristiques-organisation')
		const liens = [...bloc.querySelectorAll('a')].map((a) => a.getAttribute('href'))
		expect(liens).toEqual(['https://www.sogexia.example'])
	})

	it('rend un état VIDE SANS ACTION quand l’organisation n’a aucun contact — cas d du §11.9', async () => {
		rendreA(ID_VASSEUR, clientQuiRend({ data: [VASSEUR], error: null, status: 200 }),
		)
		expect(await screen.findByText(fr['organization.contacts.empty.title'])).toBeTruthy()
		// Les caractéristiques RESTENT rendues : l'organisation existe, seuls ses contacts manquent.
		expect(screen.getByTestId('caracteristiques-organisation').textContent).toContain(
			'comptoir-vasseur.example',
		)
		// Aucun bouton : cette surface ne livre aucun geste de création, et un bouton y serait un
		// chemin vers nulle part (§11.8, §5.16).
		const vide = screen.getByTestId('etat-vide')
		expect(vide.querySelectorAll('button')).toHaveLength(0)
		expect(vide.querySelectorAll('a')).toHaveLength(0)
		// Le tableau n'est pas rendu du tout — pas rendu vide.
		expect(screen.queryByTestId('tableau-contacts-organisation')).toBeNull()
	})

	it('rend « introuvable » avec un retour au carnet sur zéro ligne — cas e du §11.9', async () => {
		// MESURÉ : une organisation inexistante et un appelant anonyme rendent TOUS DEUX `200` et
		// `[]`. Le même écran pour les deux est DÉLIBÉRÉ : les distinguer renseignerait un appelant
		// sans droit sur l'EXISTENCE d'une organisation (docs/SPEC-permissions-rls.md §7).
		rendreA(ID_SOGEXIA, clientQuiRend({ data: [], error: null, status: 200 }),
		)
		expect(await screen.findByText(fr['organization.notFound.title'])).toBeTruthy()
		const retour = screen.getByRole('link', { name: fr['organization.notFound.action'] })
		expect(retour.getAttribute('href')).toBe('/contacts')
	})

	it('rend « introuvable » SANS INTERROGER quand l’identifiant n’est pas un uuid — cas f du §11.9', async () => {
		// La règle que la mesure a imposée : un `400` mènerait à un état d'erreur dont la reprise
		// relancerait la même requête pour le même `400` — une commande morte (§5.10), sur une
		// surface dont l'adresse est directement éditable par l'utilisateur.
		let interroge = false
		const client = {
			from: () => {
				interroge = true
				throw new Error('la fiche ne doit pas interroger sur un identifiant mal formé')
			},
		} as unknown as ClientCrm
		rendreA('pas-un-uuid', client)
		expect(await screen.findByText(fr['organization.notFound.title'])).toBeTruthy()
		expect(interroge).toBe(false)
	})

	it('rend des squelettes pendant la lecture, jamais un écran blanc — cas g du §11.9', () => {
		const jamais = {
			from: () => ({
				select: () => ({ eq: () => ({ order: () => ({ then: () => new Promise(() => {}) }) }) }),
			}),
		} as unknown as ClientCrm
		rendreA(ID_SOGEXIA, jamais)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it('rend un état d’erreur dont la reprise RELANCE la lecture — cas h du §11.9', async () => {
		const client = clientQuiRend(
			{ data: null, error: { message: 'boom' }, status: 500 },
			{ data: [SOGEXIA], error: null, status: 200 },
		)
		rendreA(ID_SOGEXIA, client)
		const reprise = await screen.findByRole('button', { name: fr['organization.error.retry'] })
		await userEvent.click(reprise)
		// La reprise relit RÉELLEMENT : la seconde réponse arrive, et l'écran rend la fiche.
		expect(await screen.findByTestId('tableau-contacts-organisation')).toBeTruthy()
	})

	it('fait du nom d’un contact un LIEN vers sa fiche, mais jamais un mailto — §15.6', async () => {
		rendreA(ID_SOGEXIA, clientQuiRend({ data: [SOGEXIA], error: null, status: 200 }),
		)
		const ligne = (await screen.findAllByTestId('ligne-contact-organisation'))[0]
		expect(ligne).toBeDefined()
		if (ligne === undefined) return
		// ASSERTION RÉVISÉE le 2026-08-19 — sous-tranche 4f, docs/SPEC-contacts.md §15.6.
		//
		// Elle exigeait `toHaveLength(0)` : il n'existait pas de fiche de contact, et un lien y
		// aurait été mort (§11.8) — la règle exacte que le §11.6 avait abandonnée pour
		// l'organisation, tenue ici pour la raison qui la fondait là. La sous-tranche 4f LIVRE
		// cette destination, et la condition tombe. La preuve est donc RÉVISÉE avec son motif,
		// jamais retirée ni contournée (mécanisme de la décision 51), et ce qu'elle exige devient
		// plus fort : le lien doit exister ET mener à la bonne fiche.
		const liens = ligne.querySelectorAll('a')
		expect(liens).toHaveLength(1)
		expect(liens[0]?.getAttribute('href')).toBe(
			'/contacts/5eed0000-0000-4000-8000-000000000091',
		)
		expect(liens[0]?.textContent).toBe('Léo Marchand')
		// Écrire à un contact depuis cette page n'est spécifié nulle part : inchangé.
		expect(ligne.innerHTML).not.toContain('mailto:')
		expect(ligne.innerHTML).not.toContain('tel:')
	})

	it('rend un état explicite sans espace de travail, et n’interroge RIEN', async () => {
		rendreA(ID_SOGEXIA, null)
		expect(await screen.findByText(fr['organization.noWorkspace.title'])).toBeTruthy()
	})
})
