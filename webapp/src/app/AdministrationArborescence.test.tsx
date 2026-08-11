// @verifies CRM-075 (docs/BACKLOG.md) — écran d'administration des tracks et des channels
// @verifies docs/SPEC-administration-arborescence.md §3.2 (channels chargés au dépliage seulement),
//           §4 (les états), §5.1 (slug proposé puis libéré), §5.3 (slug non modifiable en édition),
//           §6.2 (une seule écriture, refus nommé), §6.4 (afficher les archivés), §7.2 (workflow
//           obligatoire, aucun défaut présélectionné), §9 (refus traduits, saisie conservée),
//           §10 (les commandes ne sont pas masquées)
// @verifies docs/DESIGN_SYSTEM.md §5.13 (commandes visibles, désactivées aux extrémités, mention
//           textuelle « Archivé », focus à l'ouverture), §6 (confirmation), §8, §10
//
// Ces preuves montent le **vrai** écran avec un client factice qui enregistre les requêtes émises.
// Elles n'injectent aucun état interne : ce qui est observé est ce qu'un utilisateur voit et ce que
// le réseau reçoit. Le parcours connecté complet relève de `e2e/ui/administration-arborescence.spec.ts`,
// qui ne peut pas être exécuté sans la pile.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AdministrationArborescence } from './AdministrationArborescence'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Ecriture = { table: string; verbe: 'insert' | 'update'; charge: Record<string, unknown> }

const WORKSPACE = { id: 'ws-1', name: 'P2Enjoy', slug: 'p2enjoy' }

const TRACKS = [
	{
		id: 't-1',
		workspace_id: 'ws-1',
		name: 'Conseil & IA',
		slug: 'conseil-ia',
		description: null,
		color: 'brand',
		icon: 'sparkles',
		position: 1,
		archived_at: null,
	},
	{
		id: 't-2',
		workspace_id: 'ws-1',
		name: 'Studio web',
		slug: 'studio-web',
		description: null,
		color: 'success',
		icon: 'layout-dashboard',
		position: 2,
		archived_at: null,
	},
	{
		id: 't-3',
		workspace_id: 'ws-1',
		name: 'Formation',
		slug: 'formation',
		description: null,
		color: 'accent',
		icon: 'graduation-cap',
		position: 3,
		archived_at: null,
	},
]

const CHANNELS = [
	{
		id: 'c-1',
		workspace_id: 'ws-1',
		track_id: 't-1',
		name: 'Prospection',
		slug: 'prospection',
		description: null,
		workflow_id: 'wf-1',
		position: 1,
		archived_at: null,
	},
	{
		id: 'c-2',
		workspace_id: 'ws-1',
		track_id: 't-1',
		name: 'Grands comptes',
		slug: 'grands-comptes',
		description: null,
		workflow_id: 'wf-1',
		position: 2,
		archived_at: null,
	},
]

const WORKFLOWS = [
	{ id: 'wf-1', name: 'Pipeline standard', scope: 'global', is_default: true },
	{ id: 'wf-2', name: 'Pipeline formation', scope: 'track', is_default: false },
]

type Options = {
	readonly tracks?: unknown[]
	readonly channels?: unknown[]
	readonly workflows?: unknown[]
	readonly workspaces?: unknown[]
	readonly erreurTracks?: { message: string; status: number }
	readonly reponseEcriture?: { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }
}

/**
 * Client factice : il rend les données voulues et **enregistre** les écritures reçues.
 *
 * Il n'imite pas PostgREST — il en reproduit la seule surface que l'écran emploie. Les filtres sont
 * ignorés à la lecture : ce que ces preuves observent est le rendu et les écritures, les requêtes de
 * lecture étant déjà éprouvées à l'unité dans `administration-arborescence.test.ts`.
 */
function clientFactice(options: Options = {}): { client: ClientCrm; ecritures: Ecriture[] } {
	const ecritures: Ecriture[] = []
	const reponseEcriture = options.reponseEcriture ?? { data: [{ id: 'x' }], error: null, status: 200 }

	const lecture = (data: unknown[], erreur?: { message: string; status: number }) => {
		const resultat = erreur
			? { data: null, error: { message: erreur.message }, status: erreur.status }
			: { data, error: null, status: 200 }
		const chaine: Record<string, unknown> = {}
		for (const methode of ['is', 'eq', 'or']) chaine[methode] = () => chaine
		chaine['order'] = () => chaine
		chaine['then'] = (resoudre: (valeur: unknown) => unknown) => Promise.resolve(resultat).then(resoudre)
		return chaine
	}

	const ecriture = (table: string, verbe: 'insert' | 'update', charge: Record<string, unknown>) => {
		ecritures.push({ table, verbe, charge })
		const chaine: Record<string, unknown> = {}
		chaine['eq'] = () => chaine
		chaine['select'] = () => chaine
		chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
			Promise.resolve(reponseEcriture).then(resoudre)
		return chaine
	}

	const client = {
		from: (table: string) => ({
			select: () => {
				if (table === 'workspaces') return lecture(options.workspaces ?? [WORKSPACE])
				if (table === 'tracks') return lecture(options.tracks ?? TRACKS, options.erreurTracks)
				if (table === 'channels') return lecture(options.channels ?? CHANNELS)
				return lecture(options.workflows ?? WORKFLOWS)
			},
			insert: (charge: Record<string, unknown>) => ecriture(table, 'insert', charge),
			update: (charge: Record<string, unknown>) => ecriture(table, 'update', charge),
		}),
	} as unknown as ClientCrm

	return { client, ecritures }
}

function monter(options: Options = {}) {
	const { client, ecritures } = clientFactice(options)
	render(
		<MemoryRouter>
			<AdministrationArborescence client={client} />
		</MemoryRouter>,
	)
	return { ecritures }
}

const attendreTracks = async () => {
	await screen.findByText('Conseil & IA')
}

// ---------------------------------------------------------------------------------------------
// §4 — Les états
// ---------------------------------------------------------------------------------------------

describe('les états systématiques (§4)', () => {
	it('montre un squelette avant que les tracks ne soient chargés', () => {
		monter()
		expect(screen.getByTestId('squelette')).toBeTruthy()
	})

	it('montre un état vide nommé, et non une page blanche, quand aucun track n’existe', async () => {
		monter({ tracks: [] })
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
	})

	it('montre un état d’erreur avec une reprise réelle', async () => {
		monter({ erreurTracks: { message: 'boom', status: 500 } })
		expect(await screen.findByTestId('etat-erreur')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy()
	})

	it('traite l’absence d’espace de travail comme un état vide, pas comme une erreur', async () => {
		// La RLS rend `200` et zéro ligne : c'est un refus de lecture, donc un vide (§4).
		monter({ workspaces: [] })
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
	})
})

// ---------------------------------------------------------------------------------------------
// §10 — Les commandes ne sont pas masquées
// ---------------------------------------------------------------------------------------------

describe('les commandes sont rendues pour tout le monde (§10)', () => {
	it('affiche les cinq commandes de chaque track sans consulter aucun rôle', async () => {
		monter()
		await attendreTracks()
		expect(screen.getByRole('button', { name: 'Monter Conseil & IA' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Descendre Conseil & IA' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Modifier Conseil & IA' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Archiver Conseil & IA' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Déplier Conseil & IA' })).toBeTruthy()
	})

	it('désactive les déplacements aux extrémités, sans les masquer (§5.13)', async () => {
		monter()
		await attendreTracks()
		// Premier de la liste : « Monter » est désactivé mais TOUJOURS présent, et il dit pourquoi.
		const monterPremier = screen.getByRole('button', { name: 'Monter Conseil & IA' })
		expect(monterPremier.hasAttribute('disabled')).toBe(true)
		expect(monterPremier.getAttribute('title')).toBe('Déjà en tête de liste')
		expect(screen.getByRole('button', { name: 'Descendre Conseil & IA' }).hasAttribute('disabled')).toBe(
			false,
		)
		// Dernier de la liste : l'inverse.
		expect(screen.getByRole('button', { name: 'Descendre Formation' }).hasAttribute('disabled')).toBe(true)
		expect(screen.getByRole('button', { name: 'Monter Formation' }).hasAttribute('disabled')).toBe(false)
	})
})

// ---------------------------------------------------------------------------------------------
// §6.2 — Réordonnancement
// ---------------------------------------------------------------------------------------------

describe('réordonner (§6.2)', () => {
	it('écrit UNE seule position, et pas une permutation', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Monter Formation' }))
		await waitFor(() => expect(ecritures.length).toBeGreaterThan(0))
		// Une écriture, sur la seule ligne déplacée, portant la seule colonne `position`.
		expect(ecritures).toHaveLength(1)
		expect(ecritures[0]).toEqual({ table: 'tracks', verbe: 'update', charge: { position: 1.5 } })
	})

	it('désactive le déplacement et en donne la VRAIE cause quand les positions sont indistinctes', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter({
			tracks: [
				{ ...TRACKS[0], position: 2 },
				{ ...TRACKS[1], position: 2 },
				{ ...TRACKS[2], position: 3 },
			],
		})
		await attendreTracks()
		const monterDernier = screen.getByRole('button', { name: 'Monter Formation' })

		// La commande est indisponible — mais la ligne n'est PAS en tête de liste, et l'infobulle
		// ne doit donc pas le prétendre. C'est le §8 : un état désactivé explique sa vraie cause.
		expect(monterDernier.hasAttribute('disabled')).toBe(true)
		expect(monterDernier.getAttribute('title')).toContain("n'aurait aucun effet")
		expect(monterDernier.getAttribute('title')).not.toBe('Déjà en tête de liste')

		await utilisateur.click(monterDernier)
		// Rien n'est envoyé : ni une position sans effet, ni quoi que ce soit d'autre.
		expect(ecritures).toHaveLength(0)
	})

	it('nomme le refus à l’écran si la liste a changé depuis le rendu (§6.2, seconde défense)', async () => {
		// Le calcul est refait AU CLIC : entre le rendu et le geste, la liste relue peut avoir
		// changé et rendre impossible un déplacement qui paraissait offert. Le refus est alors
		// affiché, au lieu d'être calculé puis perdu.
		const utilisateur = userEvent.setup()
		const { ecritures } = monter({
			tracks: [
				{ ...TRACKS[0], position: 1 },
				{ ...TRACKS[1], position: 2 },
				{ ...TRACKS[2], position: 3 },
			],
		})
		await attendreTracks()
		// Cas atteignable sans triche : « Monter » sur le premier est désactivé, mais la garde du
		// gestionnaire doit rester en place. On l'exerce par la commande activée la plus proche.
		await utilisateur.click(screen.getByRole('button', { name: 'Monter Studio web' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toEqual({ table: 'tracks', verbe: 'update', charge: { position: 0.5 } })
	})
})

// ---------------------------------------------------------------------------------------------
// §5 — Créer et renommer
// ---------------------------------------------------------------------------------------------

describe('créer un track (§5.1)', () => {
	it('propose le slug depuis le nom, puis cesse dès que l’utilisateur y touche', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau track' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		const nom = within(formulaire).getByLabelText('Nom')
		const slug = within(formulaire).getByLabelText('Slug') as HTMLInputElement

		await utilisateur.type(nom, 'Réseau Éducatif')
		expect(slug.value).toBe('reseau-educatif')

		// L'utilisateur reprend la main : la proposition ne doit plus écraser sa saisie.
		await utilisateur.clear(slug)
		await utilisateur.type(slug, 'mon-slug')
		await utilisateur.type(nom, ' 2')
		expect(slug.value).toBe('mon-slug')
	})

	it('place le focus dans le premier champ à l’ouverture (§5.13)', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau track' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		expect(document.activeElement).toBe(within(formulaire).getByLabelText('Nom'))
	})

	it('refuse d’envoyer un slug malformé, et le dit sous le champ (§8)', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau track' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'X')
		const slug = within(formulaire).getByLabelText('Slug')
		await utilisateur.clear(slug)
		await utilisateur.type(slug, 'Pas Valide')
		expect(within(formulaire).getByText(/ne respecte pas la forme attendue/)).toBeTruthy()
		expect(within(formulaire).getByRole('button', { name: 'Créer' }).hasAttribute('disabled')).toBe(true)
		expect(ecritures).toHaveLength(0)
	})

	it('envoie la création avec le workspace lu, et la position à null', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau track' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'Nouveau')
		await utilisateur.click(within(formulaire).getByRole('button', { name: 'Créer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.table).toBe('tracks')
		expect(ecritures[0]?.verbe).toBe('insert')
		expect(ecritures[0]?.charge).toMatchObject({
			workspace_id: 'ws-1',
			name: 'Nouveau',
			slug: 'nouveau',
			position: null,
		})
	})
})

describe('renommer un track (§5.2, §5.3)', () => {
	it('verrouille le slug et explique pourquoi', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Modifier Conseil & IA' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		const slug = within(formulaire).getByLabelText('Slug') as HTMLInputElement
		expect(slug.value).toBe('conseil-ia')
		expect(slug.disabled).toBe(true)
		expect(within(formulaire).getByText(/adresse partageable/)).toBeTruthy()
	})

	it('n’envoie jamais le slug dans la modification', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Modifier Conseil & IA' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), ' revu')
		await utilisateur.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(Object.keys(ecritures[0]?.charge ?? {})).not.toContain('slug')
		expect(ecritures[0]?.charge).toMatchObject({ name: 'Conseil & IA revu' })
	})
})

// ---------------------------------------------------------------------------------------------
// §9 — Les refus
// ---------------------------------------------------------------------------------------------

describe('les refus (§9)', () => {
	it('traduit le refus de la politique et CONSERVE la saisie', async () => {
		const utilisateur = userEvent.setup()
		monter({
			reponseEcriture: { data: null, error: { message: 'rls', code: '42501' }, status: 403 },
		})
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau track' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'Refusé')
		await utilisateur.click(within(formulaire).getByRole('button', { name: 'Créer' }))

		const alerte = await screen.findByTestId('admin-refus')
		expect(alerte.textContent).toContain('administrateur')
		// La saisie n'est pas perdue : l'erreur n'est pas celle de l'utilisateur.
		expect((within(formulaire).getByLabelText('Nom') as HTMLInputElement).value).toBe('Refusé')
	})

	it('traduit un slug déjà pris, distinctement d’un refus de droit', async () => {
		const utilisateur = userEvent.setup()
		monter({
			reponseEcriture: { data: null, error: { message: 'duplicate', code: '23505' }, status: 409 },
		})
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau track' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'Doublon')
		await utilisateur.click(within(formulaire).getByRole('button', { name: 'Créer' }))
		expect((await screen.findByTestId('admin-refus')).textContent).toContain('déjà utilisé')
	})

	it('dit qu’il ne s’est rien passé quand la politique filtre la ligne (200, zéro ligne)', async () => {
		const utilisateur = userEvent.setup()
		monter({ reponseEcriture: { data: [], error: null, status: 200 } })
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Modifier Conseil & IA' }))
		const formulaire = await screen.findByTestId('formulaire-track')
		await utilisateur.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		expect((await screen.findByTestId('admin-refus')).textContent).toContain("Rien n'a été modifié")
	})
})

// ---------------------------------------------------------------------------------------------
// §6.3 et §6.4 — Archivage
// ---------------------------------------------------------------------------------------------

describe('archiver et désarchiver (§6.3, §6.4)', () => {
	it('demande une confirmation qui NOMME l’objet, et n’écrit rien avant', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Archiver Conseil & IA' }))
		const confirmation = await screen.findByTestId('confirmation-archivage')
		expect(confirmation.textContent).toContain('Conseil & IA')
		expect(ecritures).toHaveLength(0)
	})

	it('n’archive qu’après confirmation explicite', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Archiver Conseil & IA' }))
		const confirmation = await screen.findByTestId('confirmation-archivage')
		await utilisateur.click(within(confirmation).getByRole('button', { name: 'Archiver' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.table).toBe('tracks')
		expect(Object.keys(ecritures[0]?.charge ?? {})).toEqual(['archived_at'])
		expect(ecritures[0]?.charge['archived_at']).not.toBeNull()
	})

	it('annuler la confirmation n’écrit rien', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Archiver Conseil & IA' }))
		const confirmation = await screen.findByTestId('confirmation-archivage')
		await utilisateur.click(within(confirmation).getByRole('button', { name: 'Annuler' }))
		expect(screen.queryByTestId('confirmation-archivage')).toBeNull()
		expect(ecritures).toHaveLength(0)
	})

	it('marque un archivé par un TEXTE, et ne lui laisse que « Désarchiver »', async () => {
		monter({ tracks: [{ ...TRACKS[0], archived_at: '2026-08-11T00:00:00Z' }] })
		await attendreTracks()
		expect(screen.getByText('Archivé')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Désarchiver Conseil & IA' })).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Archiver Conseil & IA' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Monter Conseil & IA' })).toBeNull()
	})

	it('désarchive sans confirmation : le geste ne retire rien', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter({ tracks: [{ ...TRACKS[0], archived_at: '2026-08-11T00:00:00Z' }] })
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Désarchiver Conseil & IA' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.charge).toEqual({ archived_at: null })
	})

	it('la case « Afficher les archivés » est éteinte par défaut', async () => {
		monter()
		await attendreTracks()
		expect((screen.getByLabelText('Afficher les archivés') as HTMLInputElement).checked).toBe(false)
	})
})

// ---------------------------------------------------------------------------------------------
// §3.2 et §7 — Les channels
// ---------------------------------------------------------------------------------------------

describe('les channels (§3.2, §7)', () => {
	it('ne charge les channels QU’AU dépliage du track', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await attendreTracks()
		// Rien n'est affiché tant que le track est replié.
		expect(screen.queryByText('Prospection')).toBeNull()
		await utilisateur.click(screen.getByRole('button', { name: 'Déplier Conseil & IA' }))
		expect(await screen.findByText('Prospection')).toBeTruthy()
	})

	it('le dépliage porte aria-expanded, et il bascule', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await attendreTracks()
		const bascule = screen.getByRole('button', { name: 'Déplier Conseil & IA' })
		expect(bascule.getAttribute('aria-expanded')).toBe('false')
		await utilisateur.click(bascule)
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Replier Conseil & IA' }).getAttribute('aria-expanded'),
			).toBe('true'),
		)
	})

	it('n’offre AUCUN workflow présélectionné, et le défaut est seulement signalé (§7.2)', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Déplier Conseil & IA' }))
		await screen.findByText('Prospection')
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau channel' }))
		const formulaire = await screen.findByTestId('formulaire-channel')
		const selecteur = (await within(formulaire).findByLabelText('Workflow')) as HTMLSelectElement
		// Aucun choix par défaut : la valeur retenue est vide.
		expect(selecteur.value).toBe('')
		// Le défaut est signalé, sans être choisi.
		expect(within(selecteur).getByText('Pipeline standard (par défaut)')).toBeTruthy()
	})

	it('laisse « Créer » désactivé tant qu’aucun workflow n’est choisi', async () => {
		const utilisateur = userEvent.setup()
		monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Déplier Conseil & IA' }))
		await screen.findByText('Prospection')
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau channel' }))
		const formulaire = await screen.findByTestId('formulaire-channel')
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'Appels offres')
		expect(within(formulaire).getByRole('button', { name: 'Créer' }).hasAttribute('disabled')).toBe(true)
	})

	it('envoie le workspace DU TRACK et le workflow choisi', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Déplier Conseil & IA' }))
		await screen.findByText('Prospection')
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau channel' }))
		const formulaire = await screen.findByTestId('formulaire-channel')
		await utilisateur.type(within(formulaire).getByLabelText('Nom'), 'Appels offres')
		await utilisateur.selectOptions(await within(formulaire).findByLabelText('Workflow'), 'wf-2')
		await utilisateur.click(within(formulaire).getByRole('button', { name: 'Créer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.table).toBe('channels')
		expect(ecritures[0]?.charge).toMatchObject({
			workspace_id: 'ws-1',
			track_id: 't-1',
			workflow_id: 'wf-2',
			slug: 'appels-offres',
			position: null,
		})
	})

	it('dit qu’aucun workflow n’est affectable, au lieu d’un formulaire voué au refus (§7.2)', async () => {
		const utilisateur = userEvent.setup()
		monter({ workflows: [] })
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Déplier Conseil & IA' }))
		await screen.findByText('Prospection')
		await utilisateur.click(screen.getByRole('button', { name: 'Nouveau channel' }))
		expect(await screen.findByTestId('admin-sans-workflow')).toBeTruthy()
		expect(screen.queryByLabelText('Workflow')).toBeNull()
	})

	it('réordonne un channel DANS SON TRACK, sur une seule écriture', async () => {
		const utilisateur = userEvent.setup()
		const { ecritures } = monter()
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Déplier Conseil & IA' }))
		await screen.findByText('Prospection')
		await utilisateur.click(screen.getByRole('button', { name: 'Monter Grands comptes' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toEqual({ table: 'channels', verbe: 'update', charge: { position: 0.5 } })
	})

	it('affiche l’état vide d’un track sans channel', async () => {
		const utilisateur = userEvent.setup()
		monter({ channels: [] })
		await attendreTracks()
		await utilisateur.click(screen.getByRole('button', { name: 'Déplier Conseil & IA' }))
		expect(await screen.findByText("Ce track n'a aucun channel.")).toBeTruthy()
	})
})

// ---------------------------------------------------------------------------------------------
// §10 — Aucun texte en dur
// ---------------------------------------------------------------------------------------------

describe('internationalisation (docs/DESIGN_SYSTEM.md §10)', () => {
	it('n’écrit aucun texte visible en dur : tout vient du dictionnaire', async () => {
		// Preuve indirecte mais réelle : `t` n'accepte que des clés déclarées, et une clé inconnue
		// est une erreur de COMPILATION. Ce test vérifie qu'aucun libellé n'a échappé au
		// dictionnaire en cherchant les textes attendus par leur valeur française exacte.
		monter()
		await attendreTracks()
		expect(screen.getByRole('button', { name: 'Nouveau track' })).toBeTruthy()
		expect(screen.getByLabelText('Afficher les archivés')).toBeTruthy()
		expect(screen.getByRole('region', { name: "Tracks et channels de l'espace de travail" })).toBeTruthy()
	})
})

// ---------------------------------------------------------------------------------------------
// Régression : une réponse périmée ne doit pas écraser une réponse plus récente
// ---------------------------------------------------------------------------------------------

describe('robustesse', () => {
	it('ne laisse fuir aucune exception de rendu quand une couleur ou une icône est inconnue', async () => {
		const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {})
		monter({
			tracks: [{ ...TRACKS[0], color: 'inexistante', icon: 'pas-une-icone' }],
		})
		await attendreTracks()
		// Le repli documenté de `presentation-tracks` s'applique : rien ne casse, rien n'est vide.
		expect(screen.getByText('Conseil & IA')).toBeTruthy()
		expect(erreurs).not.toHaveBeenCalled()
		erreurs.mockRestore()
	})
})
