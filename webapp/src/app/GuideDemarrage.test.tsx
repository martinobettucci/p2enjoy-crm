// @verifies CRM-079 (docs/BACKLOG.md) — guide de démarrage : l'écran et ses deux surfaces
// @verifies docs/SPEC-onboarding.md §4.1 (le guide est toujours rendu à son adresse),
//           §4.2 (les quatre cas de l'accueil), §5 (interruption limitée à la session),
//           §6.1 (états), §6.2 (les trois états d'une étape), §6.3 (aucune étape désactivée),
//           §7 (accessibilité : une `ol`, un mot et non une icône seule)
// @verifies docs/DESIGN_SYSTEM.md §5.17 (cette surface)
// @verifies CLAUDE.md §10 (aucun lien éteint d'après un rôle), §11 (rien hors de la session)
// @verifies CRM-094 (docs/BACKLOG.md) tranche T2 — docs/SPEC-onboarding.md §10.1 (six étapes), §10.3 (le
//           geste « Créer le workflow de départ », rendu aux seuls administrateurs, ses issues — dont
//           « existant », qui s'annonce sans alerte —, et le focus rendu au lien de sa ligne) ;
//           docs/DESIGN_SYSTEM.md §5.49 ; docs/JOURNAL.md décisions 606 et 607
//
// Ces preuves montent le VRAI écran avec un client factice, comme `Corbeille.test.tsx`. Le parcours
// connecté sur la vraie base relève de `e2e/ui/demarrage.spec.ts`.
//
// LA PREUVE LA PLUS UTILE DE CE FICHIER EST CELLE DU `localStorage` INTACT. Le guide est la première
// surface du produit à mémoriser un choix de l'utilisateur ; le faire survivre à la fermeture de
// l'onglet demanderait un consentement que rien ne justifie (`CLAUDE.md` §11).

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { FournisseurEspace } from './ContexteEspace'
import { AccueilDemarrage, GuideDemarrage } from './GuideDemarrage'
import { CLE_PREFERENCE_DEMARRAGE_MASQUE } from './preferences'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)
beforeEach(() => {
	globalThis.sessionStorage.clear()
	globalThis.localStorage.clear()
})

type ReponseCompte = { count: number | null; error: { message: string } | null; status: number }

const ok = (count: number): ReponseCompte => ({ count, error: null, status: 200 })

/** Le seed réel vu par `admin@p2enjoy.test`, mesuré le 2026-08-15 (docs/SPEC-onboarding.md §3.1). */
const SEED_ADMIN: Readonly<Record<string, ReponseCompte>> = {
	workspaces: ok(1),
	tracks: ok(3),
	workflows: ok(2),
	channels: ok(6),
	cards: ok(14),
	mail_inbound_accounts: ok(3),
}

/** Le seed réel vu par `viewer@p2enjoy.test` : la dernière étape lui paraît toujours à faire. */
const SEED_VIEWER: Readonly<Record<string, ReponseCompte>> = {
	...SEED_ADMIN,
	channels: ok(5),
	cards: ok(9),
	mail_inbound_accounts: ok(0),
}

/** Un espace de travail neuf : tout reste à faire. */
const NEUF: Readonly<Record<string, ReponseCompte>> = {
	workspaces: ok(1),
	tracks: ok(0),
	workflows: ok(0),
	channels: ok(0),
	cards: ok(0),
	mail_inbound_accounts: ok(0),
}

function client(reponses: Readonly<Record<string, ReponseCompte>>): ClientCrm {
	return {
		from: (table: string) => ({
			select: () => {
				const reponse = reponses[table]
				if (reponse === undefined) throw new Error(`table non attendue : ${table}`)
				const chaine = {
					is: () => chaine,
					then: (resoudre: (valeur: ReponseCompte) => unknown) =>
						Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
}

function monter(element: React.ReactElement) {
	return render(<MemoryRouter>{element}</MemoryRouter>)
}

describe('le guide, à son adresse — docs/SPEC-onboarding.md §4.1', () => {
	it('rend les six étapes dans une liste ORDONNÉE', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(NEUF)} />)
		const liste = await screen.findByRole('list')
		expect(liste.tagName).toBe('OL')
		expect(await screen.findAllByRole('listitem')).toHaveLength(6)
	})

	it('est rendu MÊME intégralement accompli : c’est ce qui le rend relançable', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(SEED_ADMIN)} />)
		expect(await screen.findByTestId('guide-demarrage')).toBeTruthy()
		await waitFor(() =>
			expect(screen.getByTestId('progression-demarrage').textContent).toContain('6'),
		)
	})

	it('est rendu MÊME masqué pour la session : l’adresse ignore la préférence', async () => {
		globalThis.sessionStorage.setItem(CLE_PREFERENCE_DEMARRAGE_MASQUE, '1')
		monter(<GuideDemarrage sessionOuverte client={client(NEUF)} />)
		expect(await screen.findByTestId('guide-demarrage')).toBeTruthy()
	})

	it('n’offre PAS le masquage : la commande n’aurait aucun effet observable ici', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(NEUF)} />)
		await screen.findByTestId('guide-demarrage')
		expect(screen.queryByTestId('masquer-guide')).toBeNull()
	})
})

describe('l’état d’une étape est un MOT — §6.2, docs/DESIGN_SYSTEM.md §5.17', () => {
	it('écrit « Fait » sur une étape accomplie, et lui LAISSE son lien', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(SEED_ADMIN)} />)
		const ligne = await screen.findByTestId('etape-track')
		await waitFor(() => expect(ligne.textContent).toContain('Fait'))
		// Une étape accomplie garde son chemin : on ajoute un second track après le premier.
		expect(screen.getByTestId('lien-track')).toBeTruthy()
	})

	it('écrit « À faire » sur une étape non accomplie, sans affirmer que rien n’existe', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(NEUF)} />)
		const ligne = await screen.findByTestId('etape-track')
		await waitFor(() => expect(ligne.textContent).toContain('À faire'))
		// La phrase dit ce que l'appelant VOIT : le `viewer` seedé compte 5 channels là où la base
		// en porte 6 (docs/SPEC-onboarding.md §3.1, fait 1).
		expect(ligne.textContent).toContain('Vous n’en voyez aucun pour le moment.')
	})

	it('n’écrit PAS la phrase d’absence sur une étape accomplie', async () => {
		// Défaut TROUVÉ EN REGARDANT `docs/captures/CRM-079/guide-viewer-1440.jpg` : la ligne
		// affichait « Fait » et « Vous n'en voyez aucun » l'une sous l'autre. Les deux textes
		// étaient corrects séparément, et aucune assertion existante ne pouvait les opposer.
		monter(<GuideDemarrage sessionOuverte client={client(SEED_ADMIN)} />)
		const ligne = await screen.findByTestId('etape-track')
		await waitFor(() => expect(ligne.textContent).toContain('Fait'))
		expect(ligne.textContent).not.toContain('Vous n’en voyez aucun')
	})

	it('nomme une étape non mesurable, et ne la laisse pas passer pour « à faire »', async () => {
		monter(
			<GuideDemarrage
			sessionOuverte
				client={client({ ...NEUF, tracks: { count: null, error: { message: 'panne' }, status: 500 } })}
			/>,
		)
		const ligne = await screen.findByTestId('etape-track')
		await waitFor(() =>
			expect(ligne.textContent).toContain('Cette étape n’a pas pu être vérifiée'),
		)
		expect(ligne.textContent).not.toContain('À faire')
	})

	it('offre une reprise sur une PANNE, et aucune sur un REFUS', async () => {
		const { unmount } = monter(
			<GuideDemarrage
			sessionOuverte
				client={client({ ...NEUF, tracks: { count: null, error: { message: 'panne' }, status: 500 } })}
			/>,
		)
		await waitFor(() =>
			expect(screen.getByTestId('etape-track').textContent).toContain('Réessayer'),
		)
		unmount()

		// Un refus est définitif tant que la session ne change pas : proposer de réessayer
		// promettrait un aboutissement que le backend a déjà refusé (§6.1).
		monter(
			<GuideDemarrage
			sessionOuverte
				client={client({
					...NEUF,
					mail_inbound_accounts: { count: null, error: { message: 'refus' }, status: 401 },
				})}
			/>,
		)
		const ligne = await screen.findByTestId('etape-messagerie')
		await waitFor(() =>
			expect(ligne.textContent).toContain('Cette étape n’a pas pu être vérifiée'),
		)
		expect(ligne.textContent).not.toContain('Réessayer')
	})

	it('n’éteint AUCUN lien, quel que soit l’état de l’étape — CLAUDE.md §10', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(SEED_VIEWER)} />)
		await screen.findByTestId('guide-demarrage')
		for (const cle of ['track', 'workflow', 'channel', 'affaire', 'messagerie']) {
			const lien = await screen.findByTestId(`lien-${cle}`)
			expect(lien.getAttribute('aria-disabled')).toBeNull()
			expect(lien.getAttribute('href')).toBeTruthy()
		}
	})

	it('la première étape ne porte aucun lien : elle est accomplie par la connexion', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(NEUF)} />)
		await screen.findByTestId('etape-espace')
		expect(screen.queryByTestId('lien-espace')).toBeNull()
	})
})

describe('la progression s’écrit en toutes lettres — §7', () => {
	it('n’écrit aucun chiffre tant qu’une mesure est en vol', () => {
		monter(<AccueilDemarrage sessionOuverte client={client(NEUF)} />)
		expect(screen.getByTestId('progression-demarrage').textContent).toContain('Mesure des étapes')
	})

	it('écrit le compte et le total une fois les six mesures rendues', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(SEED_VIEWER)} />)
		// admin : 6 sur 6 ; viewer : 5 sur 6, faute de voir une boîte entrante (§3.1, fait 2).
		await waitFor(() =>
			expect(screen.getByTestId('progression-demarrage').textContent).toBe('5 étape(s) sur 6'),
		)
	})
})

describe('l’accueil et sa décision — §4.2', () => {
	it('rend le guide tant qu’une étape reste à faire', async () => {
		monter(<AccueilDemarrage sessionOuverte client={client(NEUF)} />)
		expect(await screen.findByTestId('guide-demarrage')).toBeTruthy()
		expect(screen.getByTestId('masquer-guide')).toBeTruthy()
	})

	it('rend l’état vide du board une fois les six étapes accomplies', async () => {
		monter(<AccueilDemarrage sessionOuverte client={client(SEED_ADMIN)} />)
		await waitFor(() => expect(screen.queryByTestId('guide-demarrage')).toBeNull())
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
		// Rien à rouvrir : le guide n'a plus rien à enseigner.
		expect(screen.queryByTestId('rouvrir-guide')).toBeNull()
	})

	it('ne rend JAMAIS l’état vide pendant le chargement', () => {
		// Sinon l'écran d'arrivée clignoterait et afficherait « aucun board » à qui en a.
		monter(<AccueilDemarrage sessionOuverte client={client(SEED_ADMIN)} />)
		expect(screen.queryByTestId('etat-vide')).toBeNull()
		expect(screen.getByTestId('guide-demarrage')).toBeTruthy()
	})

	it('masqué, il cède la place à l’état vide ET laisse un chemin de retour', async () => {
		const utilisateur = userEvent.setup()
		monter(<AccueilDemarrage sessionOuverte client={client(NEUF)} />)
		await utilisateur.click(await screen.findByTestId('masquer-guide'))
		await waitFor(() => expect(screen.queryByTestId('guide-demarrage')).toBeNull())
		expect(screen.getByTestId('rouvrir-guide').getAttribute('href')).toBe('/demarrage')
	})

	it('reste masqué au remontage : la préférence survit à un rechargement d’onglet', async () => {
		const utilisateur = userEvent.setup()
		const { unmount } = monter(<AccueilDemarrage sessionOuverte client={client(NEUF)} />)
		await utilisateur.click(await screen.findByTestId('masquer-guide'))
		await waitFor(() => expect(screen.queryByTestId('guide-demarrage')).toBeNull())
		unmount()

		monter(<AccueilDemarrage sessionOuverte client={client(NEUF)} />)
		await waitFor(() => expect(screen.getByTestId('rouvrir-guide')).toBeTruthy())
		expect(screen.queryByTestId('guide-demarrage')).toBeNull()
	})
})

describe('ce que le guide N’ÉCRIT PAS sur l’appareil — CLAUDE.md §11', () => {
	it('n’écrit RIEN en `localStorage`, y compris après avoir été masqué', async () => {
		const utilisateur = userEvent.setup()
		monter(<AccueilDemarrage sessionOuverte client={client(NEUF)} />)
		await utilisateur.click(await screen.findByTestId('masquer-guide'))
		await waitFor(() => expect(screen.queryByTestId('guide-demarrage')).toBeNull())
		expect(globalThis.localStorage.length).toBe(0)
	})

	it('écrit sa seule préférence en `sessionStorage`, sous une clé nommée', async () => {
		const utilisateur = userEvent.setup()
		monter(<AccueilDemarrage sessionOuverte client={client(NEUF)} />)
		await utilisateur.click(await screen.findByTestId('masquer-guide'))
		await waitFor(() =>
			expect(globalThis.sessionStorage.getItem(CLE_PREFERENCE_DEMARRAGE_MASQUE)).toBe('1'),
		)
	})

	it('n’écrit AUCUNE progression : elle est mesurée, jamais mémorisée — §2', async () => {
		monter(<GuideDemarrage sessionOuverte client={client(SEED_ADMIN)} />)
		await waitFor(() =>
			expect(screen.getByTestId('progression-demarrage').textContent).toBe('6 étape(s) sur 6'),
		)
		expect(globalThis.sessionStorage.length).toBe(0)
		expect(globalThis.localStorage.length).toBe(0)
	})
})

describe('aucune mesure sans session — docs/SPEC-onboarding.md §4.4', () => {
	/**
	 * Un client qui COMPTE ses appels : la preuve porte sur l'absence de requête, et non sur
	 * l'absence d'affichage. Un écran qui n'afficherait rien tout en interrogeant la base laisserait
	 * le défaut intact — c'est précisément lui qui salissait la console de l'accueil.
	 */
	function clientEspion(): { readonly client: ClientCrm; appels: () => number } {
		let appels = 0
		const espion = {
			from: () => {
				appels += 1
				const chaine = {
					is: () => chaine,
					then: (resoudre: (valeur: ReponseCompte) => unknown) =>
						Promise.resolve(ok(0)).then(resoudre),
				}
				return { select: () => chaine }
			},
		} as unknown as ClientCrm
		return { client: espion, appels: () => appels }
	}

	it('l’accueil rend l’état vide EXISTANT et n’interroge pas la base', async () => {
		// DÉFAUT RÉEL, MESURÉ PAR LA CAMPAGNE : un visiteur sans session déclenchait les cinq
		// comptages, et `mail_inbound_accounts` rendait `401` à la clé anonyme (§3.1, fait 3). Le
		// navigateur écrivait alors une erreur dans la console de l'écran d'ARRIVÉE du produit.
		const espion = clientEspion()
		monter(<AccueilDemarrage sessionOuverte={false} client={espion.client} />)

		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		expect(screen.queryByTestId('guide-demarrage')).toBeNull()
		// L'état vide est celui de `CRM-007`, inchangé : il ne porte donc AUCUN lien de réouverture,
		// qui n'aurait de sens que si le guide avait été masqué (§4.2, troisième ligne).
		expect(screen.queryByTestId('rouvrir-guide')).toBeNull()
		expect(espion.appels(), 'aucune des six mesures n’est émise sans session').toBe(0)
	})

	it('l’adresse du guide le rend QUAND MÊME, mais sans poser aucune question', async () => {
		// §4.1 reste intact : `/demarrage` rend toujours le guide. Ce que le §4.4 lui retire est la
		// mesure, pas l'écran — les six étapes restent en chargement, et rien n'est affirmé.
		const espion = clientEspion()
		monter(<GuideDemarrage sessionOuverte={false} client={espion.client} />)

		expect(await screen.findByTestId('guide-demarrage')).toBeTruthy()
		expect(screen.getByTestId('progression-demarrage').textContent).toBe(
			'Mesure des étapes en cours',
		)
		// Aucun chiffre n'est écrit : « 0 étape sur 6 » serait une affirmation non mesurée.
		expect(screen.getByTestId('progression-demarrage').textContent).not.toContain('sur 6')
		expect(espion.appels(), 'aucune des six mesures n’est émise sans session').toBe(0)
	})

	it('la session ouverte rétablit les six mesures, et rien d’autre ne change', async () => {
		// La garde est un INTERRUPTEUR, pas une extinction : la même surface, le même client, la
		// seule session ouverte, et les six comptages repartent.
		const espion = clientEspion()
		monter(<GuideDemarrage sessionOuverte client={espion.client} />)

		await waitFor(() =>
			expect(screen.getByTestId('progression-demarrage').textContent).toBe('0 étape(s) sur 6'),
		)
		expect(espion.appels(), 'les six tables sont interrogées, une fois chacune').toBe(6)
	})
})

describe('le workflow de départ, en un geste — docs/SPEC-onboarding.md §10.3', () => {
	type ReponseRpc = { data: unknown; error: { code: string; message: string } | null; status: number }

	/**
	 * Un client dont les comptages CHANGENT après le geste : la preuve porte sur la re-mesure, et non
	 * sur un état que l'écran se donnerait à lui-même en supposant le succès.
	 */
	function clientAvecGeste(reponseRpc: ReponseRpc | Promise<ReponseRpc>): {
		readonly client: ClientCrm
		readonly appelsRpc: () => number
	} {
		let apres = false
		let appelsRpc = 0
		// Le client factice route sur le NOM de table, reçu comme une chaîne : on l'appelle hors du
		// typage de `ClientCrm`, qui n'accepte qu'un nom de table littéral.
		const lire = (reponses: Readonly<Record<string, ReponseCompte>>, table: string) =>
			(client(reponses) as unknown as { from: (nom: string) => unknown }).from(table)
		const client_ = {
			from: (table: string) => lire(apres && table === 'workflows' ? { ...NEUF, workflows: ok(1) } : NEUF, table),
			rpc: async () => {
				appelsRpc += 1
				const reponse = await reponseRpc
				if (reponse.error === null) apres = true
				return reponse
			},
		} as unknown as ClientCrm
		return { client: client_, appelsRpc: () => appelsRpc }
	}

	const ADMIN = { idWorkspace: 'e0940000-0000-4000-8000-0000000000c1', estAdmin: true }

	function monterAdmin(element: React.ReactElement, valeur = ADMIN) {
		return monter(<FournisseurEspace valeur={valeur}>{element}</FournisseurEspace>)
	}

	it('est offert à l’administratrice sur l’étape « Workflow » À FAIRE, avec ce qu’il pose', async () => {
		monterAdmin(<GuideDemarrage sessionOuverte client={clientAvecGeste({ data: 'w', error: null, status: 200 }).client} />)
		const ligne = await screen.findByTestId('etape-workflow')
		await waitFor(() => expect(screen.getByTestId('creer-workflow-depart').textContent).toBe('Créer le workflow de départ'))
		expect(ligne.textContent).toContain('Prospection, Relance, Négociation')
		// Le lien vers l'éditeur reste offert à côté du geste : on peut aussi composer le sien.
		expect(screen.getByTestId('lien-workflow').getAttribute('href')).toBe('/reglages/workflows')
	})

	it('n’est PAS rendu à qui la base ne rend pas `admin` — le lien, lui, reste', async () => {
		monterAdmin(<GuideDemarrage sessionOuverte client={client(NEUF)} />, { ...ADMIN, estAdmin: false })
		await waitFor(() => expect(screen.getByTestId('etape-workflow').textContent).toContain('À faire'))
		expect(screen.queryByTestId('creer-workflow-depart')).toBeNull()
		expect(screen.getByTestId('lien-workflow')).toBeTruthy()
	})

	it('n’est PAS rendu sur une étape accomplie : un second workflow serait refusé', async () => {
		monterAdmin(<GuideDemarrage sessionOuverte client={client(SEED_ADMIN)} />)
		await waitFor(() => expect(screen.getByTestId('etape-workflow').textContent).toContain('Fait'))
		expect(screen.queryByTestId('creer-workflow-depart')).toBeNull()
	})

	it('réussi, il ANNONCE le succès et l’étape passe à « Fait » par une nouvelle mesure', async () => {
		const utilisateur = userEvent.setup()
		const espion = clientAvecGeste({ data: 'w', error: null, status: 200 })
		monterAdmin(<GuideDemarrage sessionOuverte client={espion.client} />)
		await utilisateur.click(await screen.findByTestId('creer-workflow-depart'))
		await waitFor(() => expect(screen.getByTestId('etape-workflow').textContent).toContain('Fait'))
		expect(screen.getByTestId('annonce-demarrage').textContent).toBe('Workflow de départ créé')
		expect(screen.queryByTestId('creer-workflow-depart')).toBeNull()
		expect(espion.appelsRpc()).toBe(1)
	})

	it('réussi, il rend le focus au lien de sa ligne : le bouton qui a agi disparaît', async () => {
		const utilisateur = userEvent.setup()
		monterAdmin(<GuideDemarrage sessionOuverte client={clientAvecGeste({ data: 'w', error: null, status: 200 }).client} />)
		await utilisateur.click(await screen.findByTestId('creer-workflow-depart'))
		await waitFor(() => expect(screen.getByTestId('etape-workflow').textContent).toContain('Fait'))
		// Sans ce déplacement, le focus retombait sur le document, et la tabulation suivante repartait
		// du lien d'évitement (docs/DESIGN_SYSTEM.md §5.49).
		expect(document.activeElement).toBe(screen.getByTestId('lien-workflow'))
	})

	it('« existant » n’est PAS un refus : il s’annonce, sans alerte, et l’étape passe à « Fait »', async () => {
		const utilisateur = userEvent.setup()
		let apres = false
		const lire = (reponses: Readonly<Record<string, ReponseCompte>>, table: string) =>
			(client(reponses) as unknown as { from: (nom: string) => unknown }).from(table)
		// Un collègue a posé un workflow entre la mesure et le clic : la base refuse le second, et la
		// re-mesure, elle, le trouve.
		const client_ = {
			from: (table: string) => lire(apres && table === 'workflows' ? { ...NEUF, workflows: ok(1) } : NEUF, table),
			rpc: async () => {
				apres = true
				return { data: null, error: { code: 'P0001', message: 'workflow existant' }, status: 400 }
			},
		} as unknown as ClientCrm
		monterAdmin(<GuideDemarrage sessionOuverte client={client_} />)
		await utilisateur.click(await screen.findByTestId('creer-workflow-depart'))
		await waitFor(() => expect(screen.getByTestId('etape-workflow').textContent).toContain('Fait'))
		expect(screen.getByTestId('annonce-demarrage').textContent).toBe(
			'Cet espace a déjà un workflow : ouvrez l’éditeur pour le composer.',
		)
		// Ni « Workflow de départ créé » — il ne l'a pas été —, ni une alerte de refus sous une étape
		// accomplie : les deux diraient faux.
		expect(screen.queryByTestId('refus-workflow-depart')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('lien-workflow'))
	})

	it('désactive le bouton pendant l’envoi, et le dit', async () => {
		const utilisateur = userEvent.setup()
		let repondre!: (reponse: ReponseRpc) => void
		const espion = clientAvecGeste(new Promise<ReponseRpc>((r) => (repondre = r)))
		monterAdmin(<GuideDemarrage sessionOuverte client={espion.client} />)
		await utilisateur.click(await screen.findByTestId('creer-workflow-depart'))
		const bouton = screen.getByTestId('creer-workflow-depart')
		expect(bouton.textContent).toBe('Création…')
		expect((bouton as HTMLButtonElement).disabled).toBe(true)
		repondre({ data: 'w', error: null, status: 200 })
		await waitFor(() => expect(screen.getByTestId('etape-workflow').textContent).toContain('Fait'))
	})

	it('refusé par la base, il écrit le refus sur la ligne et reste offert', async () => {
		const utilisateur = userEvent.setup()
		const espion = clientAvecGeste({ data: null, error: { code: '42501', message: 'reserve aux administrateurs' }, status: 403 })
		monterAdmin(<GuideDemarrage sessionOuverte client={espion.client} />)
		await utilisateur.click(await screen.findByTestId('creer-workflow-depart'))
		expect((await screen.findByTestId('refus-workflow-depart')).textContent).toBe(
			'Seul un administrateur de l’espace peut créer le workflow de départ.',
		)
		expect(screen.getByTestId('creer-workflow-depart')).toBeTruthy()
	})

	it('nomme le nœud archivé qui l’empêche, pour dire quoi restaurer', async () => {
		const utilisateur = userEvent.setup()
		const espion = clientAvecGeste({ data: null, error: { code: 'P0001', message: 'noeud archive : perdu' }, status: 400 })
		monterAdmin(<GuideDemarrage sessionOuverte client={espion.client} />)
		await utilisateur.click(await screen.findByTestId('creer-workflow-depart'))
		expect((await screen.findByTestId('refus-workflow-depart')).textContent).toBe(
			'Le nœud « perdu » est archivé dans le catalogue : restaurez-le, ou composez votre workflow depuis l’éditeur.',
		)
	})
})

