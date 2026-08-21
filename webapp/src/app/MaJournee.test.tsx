// @verifies CRM-061 (docs/BACKLOG.md) — tranche 1 : l'écran « Ma journée »
// @verifies docs/SPEC-cards.md §17.2 (la portée vit dans l'adresse), §17.5 (les trois sections),
//           §17.6 (ce que chaque ligne rend), §17.8 (les six états, dont DEUX vides distincts),
//           §17.9 (accessibilité : sections titrées, compte écrit, `aria-current`, annonce)
// @verifies docs/DESIGN_SYSTEM.md §5.36 (cette surface : sections, compte dans son propre
//           élément, section vide non rendue, teinte de retard sur l'ÉCHÉANCE, portée en liens),
//           §5.8 (états systématiques), §5.9 (cellule sans valeur VIDE)
//
// Les données injectées sont celles du SEED, à l'identique — « Audit sécurité applicative » en
// retard, « Formation Data & IA » aujourd'hui, « Hébergement infogéré » à venir. Ce n'est pas une
// commodité : ce sont les trois lignes du contrat de `docs/SPEC-seed.md` §13.5, et les mêmes que
// la preuve E2E exerce sur la pile réelle.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { MaJournee } from './MaJournee'
import { FournisseurAuthentification } from './Authentification'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

/**
 * Client minimal : une seule lecture, `from().select()` puis des filtres et des tris chaînés.
 *
 * Les noms de filtres sont posés pour que leur emploi n'échoue pas sur un
 * « undefined is not a function », qui ne dirait pas lequel a été employé — même procédé que
 * `ma-journee.test.ts`, où c'est en revanche la requête émise qui est mesurée.
 */
function clientQuiRend(reponse: Reponse): ClientCrm {
	const chaine: Record<string, unknown> = {
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	for (const nom of ['is', 'eq', 'lt', 'not', 'or', 'order']) {
		chaine[nom] = () => chaine
	}
	return { from: () => ({ select: () => chaine }) } as unknown as ClientCrm
}

/** Un client qui ne répond jamais : l'état de chargement, sans temporisation. */
const CLIENT_MUET = {
	from: () => ({
		select: () => {
			const chaine: Record<string, unknown> = { then: () => new Promise(() => {}) }
			for (const nom of ['is', 'eq', 'lt', 'not', 'or', 'order']) chaine[nom] = () => chaine
			return chaine
		},
	}),
} as unknown as ClientCrm

const MIDI = new Date(2026, 7, 21, 12, 0, 0)

const channels = (slugTrack: string, nomTrack: string, slug: string, nom: string) => ({
	slug,
	name: nom,
	tracks: { slug: slugTrack, name: nomTrack },
})

const AUDIT = {
	id: '5eed0000-0000-4000-8000-0000000000c3',
	title: 'Audit sécurité applicative',
	next_action: 'Premier appel de qualification',
	next_action_at: new Date(2026, 7, 7, 14, 0, 0).toISOString(),
	channels: channels('conseil-ia', 'Conseil & IA', 'grands-comptes', 'Grands comptes'),
}
const FORMATION = {
	id: '5eed0000-0000-4000-8000-0000000000c7',
	title: 'Formation Data & IA — promo 2026',
	next_action: 'Faire signer la convention',
	next_action_at: new Date(2026, 7, 21, 9, 0, 0).toISOString(),
	channels: channels('formation', 'Formation', 'inter-entreprises', 'Inter-entreprises'),
}
const HEBERGEMENT = {
	id: '5eed0000-0000-4000-8000-00000000d008',
	title: 'Hébergement infogéré — Éditions Bertrand',
	// Le cas du §17.6 : une échéance SANS prochaine action. Les deux colonnes sont indépendantes.
	next_action: null,
	next_action_at: new Date(2026, 7, 24, 11, 0, 0).toISOString(),
	channels: channels('studio-web', 'Studio Web', 'maintenance', 'Maintenance'),
}

/**
 * Monte l'écran avec une session RÉELLE du fournisseur.
 *
 * Sans fournisseur, le contexte est anonyme et la portée « moi » n'a aucun sujet (§17.3) : la
 * lecture ne serait même pas émise. Le fournisseur reçoit `client = null`, ce qui le met
 * immédiatement en état anonyme — c'est exactement ce qu'il faut pour éprouver la portée « tous »
 * et l'état vide « rien pour moi », les deux seuls cas que ce fichier a besoin de distinguer.
 */
function rendre(client: ClientCrm, adresse = '/ma-journee') {
	return render(
		<MemoryRouter initialEntries={[adresse]}>
			<FournisseurAuthentification client={null}>
				<MaJournee client={client} maintenant={MIDI} />
			</FournisseurAuthentification>
		</MemoryRouter>,
	)
}

describe('MaJournee — les trois sections (§17.5, §5.36)', () => {
	it('rend les trois sections dans l’ordre, chacune avec son compte dans SON PROPRE élément', async () => {
		rendre(
			clientQuiRend({ data: [AUDIT, FORMATION, HEBERGEMENT], error: null, status: 200 }),
			'/ma-journee?qui=tous',
		)
		const sections = await screen.findAllByTestId('section-journee')
		expect(sections.map((section) => section.getAttribute('data-section'))).toEqual([
			'retard',
			'aujourdhui',
			'avenir',
		])
		// Le compte vit dans son propre élément : un nœud de texte accolé au libellé deviendrait un
		// élément flex anonyme que `gap` ne sépare pas — le défaut « Discussion1 » du §5.11.
		const comptes = screen.getAllByTestId('compte-section')
		expect(comptes.map((compte) => compte.textContent)).toEqual(['(1)', '(1)', '(1)'])
		expect(sections[0]?.querySelector('h2')?.textContent).toContain(fr['today.section.late'])
	})

	it('NE REND PAS une section vide — trois vides diraient trois fois « rien » (§17.8)', async () => {
		rendre(clientQuiRend({ data: [AUDIT], error: null, status: 200 }), '/ma-journee?qui=tous')
		const sections = await screen.findAllByTestId('section-journee')
		expect(sections).toHaveLength(1)
		expect(sections[0]?.getAttribute('data-section')).toBe('retard')
	})

	it('range chaque affaire du seed dans la section que son échéance commande', async () => {
		rendre(
			clientQuiRend({ data: [AUDIT, FORMATION, HEBERGEMENT], error: null, status: 200 }),
			'/ma-journee?qui=tous',
		)
		const sections = await screen.findAllByTestId('section-journee')
		const titresDe = (section: HTMLElement) =>
			[...section.querySelectorAll('[data-testid="ligne-journee"]')].map((ligne) =>
				ligne.getAttribute('data-affaire'),
			)
		expect(titresDe(sections[0] as HTMLElement)).toEqual([AUDIT.id])
		expect(titresDe(sections[1] as HTMLElement)).toEqual([FORMATION.id])
		expect(titresDe(sections[2] as HTMLElement)).toEqual([HEBERGEMENT.id])
	})
})

describe('MaJournee — ce que chaque ligne rend (§17.6)', () => {
	it('rend l’échéance en tête, avec son HEURE, et en donnée technique', async () => {
		rendre(clientQuiRend({ data: [AUDIT], error: null, status: 200 }), '/ma-journee?qui=tous')
		const echeance = await screen.findByTestId('echeance-journee')
		// L'heure est rendue avec la date : une échéance du jour sans heure ne dirait pas si la
		// matinée est déjà passée (§5.36).
		expect(echeance.textContent).toContain('07/08/2026')
		expect(echeance.textContent).toContain('14:00')
		expect(echeance.tagName.toLowerCase()).toBe('code')
	})

	it('teinte l’ÉCHÉANCE d’une affaire en retard, jamais la ligne entière (§5.36)', async () => {
		rendre(
			clientQuiRend({ data: [AUDIT, HEBERGEMENT], error: null, status: 200 }),
			'/ma-journee?qui=tous',
		)
		await screen.findAllByTestId('section-journee')
		const echeances = screen.getAllByTestId('echeance-journee')
		expect(echeances[0]?.className).toContain('bg-danger-soft')
		// L'affaire à venir ne porte AUCUNE teinte de danger : une échéance à venir n'est pas un
		// retard, et le §1 est tenu par le titre de la section, qui écrit « En retard » en toutes
		// lettres.
		expect(echeances[1]?.className).not.toContain('bg-danger-soft')
		// La ligne, elle, ne porte jamais la teinte : une affaire en retard est un travail à faire,
		// pas une erreur.
		const lignes = screen.getAllByTestId('ligne-journee')
		expect(lignes[0]?.className).not.toContain('danger')
	})

	it('rend le titre en LIEN vers la fiche, et le titre EST le libellé du lien (§17.9)', async () => {
		rendre(clientQuiRend({ data: [AUDIT], error: null, status: 200 }), '/ma-journee?qui=tous')
		const lien = await screen.findByTestId('lien-affaire-journee')
		expect(lien.getAttribute('href')).toBe(
			`/tracks/conseil-ia/grands-comptes/cards/${AUDIT.id}`,
		)
		expect(lien.textContent).toBe(AUDIT.title)
		// Aucun `aria-label` : il remplacerait le titre par un libellé identique sur chaque ligne,
		// rendant les liens indiscernables pour un lecteur d'écran (§5.19).
		expect(lien.getAttribute('aria-label')).toBeNull()
	})

	it('laisse la prochaine action VIDE quand elle est nulle — ni tiret, ni « non renseigné »', async () => {
		rendre(clientQuiRend({ data: [HEBERGEMENT], error: null, status: 200 }), '/ma-journee?qui=tous')
		const action = await screen.findByTestId('action-journee')
		expect(action.textContent).toBe('')
		expect(action.getAttribute('title')).toBeNull()
	})

	it('rend la pilule « Track › Channel », qui FERME la ligne et OUVRE le channel', async () => {
		rendre(clientQuiRend({ data: [AUDIT], error: null, status: 200 }), '/ma-journee?qui=tous')
		const pilule = await screen.findByTestId('pilule-situation')
		expect(pilule.textContent).toContain('Conseil & IA')
		expect(pilule.textContent).toContain('Grands comptes')
		// LA PILULE EST UN LIEN (§5.29, « ouverture du channel au clic ») : elle porte l'icône de
		// sortie, et une icône qui ne mènerait nulle part promettrait une navigation qui n'existe
		// pas — la commande morte du §5.10.
		expect(pilule.tagName.toLowerCase()).toBe('a')
		expect(pilule.getAttribute('href')).toBe('/tracks/conseil-ia/grands-comptes')
		// Son nom accessible NOMME sa destination : quatre pilules ne portant que leur libellé ne
		// diraient pas ce que chacune ouvre (§5.36).
		expect(pilule.getAttribute('aria-label')).toContain('Conseil & IA')
	})

	it('rend une affaire SANS adresse comme un texte, jamais comme un lien mort (§5.32)', async () => {
		const orpheline = { ...AUDIT, channels: null }
		rendre(clientQuiRend({ data: [orpheline], error: null, status: 200 }), '/ma-journee?qui=tous')
		await screen.findByTestId('ligne-journee')
		expect(screen.queryByTestId('lien-affaire-journee')).toBeNull()
		expect(screen.queryByTestId('pilule-situation')).toBeNull()
		expect(screen.getByText(AUDIT.title)).toBeTruthy()
	})
})

describe('MaJournee — la bascule de portée (§17.2, §5.36)', () => {
	it('est une paire de LIENS, et non un contrôle de formulaire', async () => {
		rendre(clientQuiRend({ data: [AUDIT], error: null, status: 200 }), '/ma-journee?qui=tous')
		await screen.findByTestId('ligne-journee')
		const liens = screen.getAllByTestId('lien-portee')
		expect(liens).toHaveLength(2)
		expect(liens.every((lien) => lien.tagName.toLowerCase() === 'a')).toBe(true)
		expect(liens[0]?.getAttribute('href')).toBe('/ma-journee')
		expect(liens[1]?.getAttribute('href')).toBe('/ma-journee?qui=tous')
	})

	it('pose `aria-current` sur la SEULE portée ouverte, à la main et non par NavLink', async () => {
		rendre(clientQuiRend({ data: [AUDIT], error: null, status: 200 }), '/ma-journee?qui=tous')
		await screen.findByTestId('ligne-journee')
		const liens = screen.getAllByTestId('lien-portee')
		// Les deux entrées partagent le même CHEMIN : `NavLink` poserait l'attribut sur les DEUX.
		expect(liens[0]?.getAttribute('aria-current')).toBeNull()
		expect(liens[1]?.getAttribute('aria-current')).toBe('page')
	})

	it('reste rendue sur un écran VIDE : elle est la cause possible de ce vide', async () => {
		rendre(clientQuiRend({ data: [], error: null, status: 200 }), '/ma-journee?qui=tous')
		await screen.findByTestId('etat-vide')
		expect(screen.getAllByTestId('lien-portee')).toHaveLength(2)
	})

	it('les deux états portent une bordure de MÊME épaisseur, pour que le texte ne se décale pas', async () => {
		rendre(clientQuiRend({ data: [AUDIT], error: null, status: 200 }), '/ma-journee?qui=tous')
		await screen.findByTestId('ligne-journee')
		const liens = screen.getAllByTestId('lien-portee')
		expect(liens[0]?.className).toContain('border-b-2')
		expect(liens[1]?.className).toContain('border-b-2')
	})
})

describe('MaJournee — les six états (§17.8)', () => {
	it('rend des squelettes pendant la lecture, jamais un écran vide', () => {
		rendre(CLIENT_MUET, '/ma-journee?qui=tous')
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it('rend l’état vide « aucun espace de travail » sans client configuré', () => {
		render(
			<MemoryRouter initialEntries={['/ma-journee']}>
				<MaJournee client={null} maintenant={MIDI} />
			</MemoryRouter>,
		)
		expect(screen.getByRole('heading').textContent).toBe(fr['today.noWorkspace.title'])
	})

	it('rend une erreur AVEC action de reprise, et la reprise relit réellement', async () => {
		rendre(
			clientQuiRend({ data: null, error: { message: 'coupure' }, status: 500 }),
			'/ma-journee?qui=tous',
		)
		await waitFor(() => expect(screen.getByTestId('etat-erreur')).toBeTruthy())
		expect(screen.getByRole('button', { name: fr['today.error.retry'] })).toBeTruthy()
	})

	it('DEUX VIDES DISTINCTS : « rien pour moi » porte l’action qui élargit', async () => {
		// Sans session, la portée « moi » n'a aucun sujet : la lecture rend zéro ligne (§17.3).
		rendre(clientQuiRend({ data: [], error: null, status: 200 }))
		await screen.findByTestId('etat-vide')
		expect(screen.getByRole('heading').textContent).toBe(fr['today.empty.mine.title'])
		expect(screen.getByTestId('elargir-portee').getAttribute('href')).toBe('/ma-journee?qui=tous')
	})

	it('DEUX VIDES DISTINCTS : « rien pour personne » n’offre AUCUNE action', async () => {
		rendre(clientQuiRend({ data: [], error: null, status: 200 }), '/ma-journee?qui=tous')
		await screen.findByTestId('etat-vide')
		expect(screen.getByRole('heading').textContent).toContain('7')
		// Il n'y a rien à élargir, et un bouton y serait un chemin vers nulle part (§5.16, §5.19).
		expect(screen.queryByTestId('elargir-portee')).toBeNull()
	})

	it('un refus par RLS n’est PAS une erreur : zéro ligne est l’état vide', async () => {
		rendre(clientQuiRend({ data: [], error: null, status: 200 }), '/ma-journee?qui=tous')
		await screen.findByTestId('etat-vide')
		expect(screen.queryByTestId('etat-erreur')).toBeNull()
	})
})

describe('MaJournee — accessibilité (§17.9)', () => {
	it('annonce le contenu de la journée dans la région polie déjà livrée', async () => {
		rendre(
			clientQuiRend({ data: [AUDIT, FORMATION], error: null, status: 200 }),
			'/ma-journee?qui=tous',
		)
		await screen.findAllByTestId('section-journee')
		const region = screen.getByTestId('region-annonces')
		expect(region.getAttribute('aria-live')).toBe('polite')
		expect(region.textContent).toContain('2')
		expect(region.textContent).toContain(fr['today.scope.all'])
	})

	it('titre chaque section par un `h2`, sans saut de niveau sous le titre de route', async () => {
		rendre(
			clientQuiRend({ data: [AUDIT, FORMATION], error: null, status: 200 }),
			'/ma-journee?qui=tous',
		)
		const sections = await screen.findAllByTestId('section-journee')
		for (const section of sections) {
			expect(section.querySelector('h2')).not.toBeNull()
		}
	})

	it('nomme la navigation de portée, un `nav` sans nom étant indiscernable au lecteur d’écran', async () => {
		rendre(clientQuiRend({ data: [AUDIT], error: null, status: 200 }), '/ma-journee?qui=tous')
		await screen.findByTestId('ligne-journee')
		expect(screen.getByTestId('portee-journee').getAttribute('aria-label')).toBe(
			fr['today.scope.aria'],
		)
	})
})
