// @spec CRM-064 (docs/BACKLOG.md) — sous-tranche 3b : l'état vide du sélecteur de mentions
// @spec docs/SPEC-notifications.md §50 (le point ouvert n° 4 du §39, tranché), §50.3 (ce que la
//       fixture pose, ligne à ligne), §50.4 (le membre unique est Driss, et ce n'est pas
//       indifférent), §50.5 (la destruction est un contrat, et MA7 le mesure)
// @spec docs/SPEC-notifications.md §36.4 (les quatre états de la liste, dont le vide)
// @spec docs/SPEC-seed.md §8 (le seed n'est pas étendu : une preuve fabrique et détruit)
// @spec CLAUDE.md §15 (créer un chemin déterministe quand un comportement n'est pas observable)
//
// POURQUOI CE MODULE EXISTE. Le §36.4 décrit un quatrième état du sélecteur — « personne d'autre ne
// peut lire cette affaire » — qu'aucune affaire du jeu de démonstration n'exerce : l'administratrice
// lit toutes les affaires, si bien qu'un non-administrateur a toujours au moins elle. L'état n'était
// donc éprouvé que par la suite unitaire, et le §39 point 4 l'a nommé comme un écart.
//
// LA TROISIÈME VOIE, MESURÉE (§50.2). Le point 4 raisonnait à l'intérieur du seed, où les deux seules
// issues étaient d'exclure l'administratrice — ce que son rôle interdit — ou d'ajouter un quatrième
// profil. Une preuve n'est pourtant pas obligée de vivre dans le seed : un SECOND espace de travail
// jetable, posé et détruit par la clé de service, laisse son unique membre seul lecteur de sa propre
// affaire. C'est le chemin qu'empruntent déjà `preuves-refus.spec.ts` (`CRM-014`) et
// `demarrage.spec.ts` (`CRM-079`), et il ne touche pas au jeu de démonstration.
//
// LA CLÉ DE SERVICE N'EST PAS UN CONTOURNEMENT ICI. Aucun écran ne crée d'espace de travail, et
// aucune politique ne l'autorise à un client (`CRM-012`, `docs/SPEC-seed.md` §8) : le montage est une
// opération d'exploitation, nommée comme telle. Ce que les preuves observent ensuite est émis avec le
// JETON RÉEL de Driss, sous les politiques inchangées.
//
// LA DESTRUCTION EST UN CONTRAT, PAS DE L'HYGIÈNE, ET C'EST MESURÉ (MA7, §50.5). Laissée en base, la
// sonde rend ROUGE une preuve d'une autre unité : `e2e/ui/demarrage.spec.ts` assère que la base ne
// porte qu'un espace — « la base doit être rendue à son unique workspace seedé (CRM-005) » —, et
// cette assertion est juste, puisqu'elle protège l'écran du premier lancement. Toute preuve qui monte
// cette fixture la démonte donc dans un `finally`, et CONSTATE l'état rendu au lieu de le supposer.

import { expect, type APIRequestContext } from '@playwright/test'
import { CLE_SERVICE, URL_API } from './jetons'

/** Le profil du seed qui sera l'unique membre de l'espace jetable — `docs/SPEC-seed.md` §2.3. */
export const DRISS_SOLITAIRE = '5eed0000-0000-4000-8000-000000000012'

/** L'espace du seed socle, celui qui doit rester SEUL après le démontage. */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/**
 * Les sept lignes de la chaîne, dans l'ordre du §50.3.
 *
 * LES IDENTIFIANTS SONT FIXES ET PRÉFIXÉS `e0640000-…`, et c'est une décision du §50.5 : une
 * exécution interrompue au pire moment laisse une trace reconnaissable, que l'exécution suivante
 * écrase au lieu de dupliquer. Des identifiants tirés au hasard rendraient toute trace résiduelle
 * anonyme, donc introuvable.
 */
export const ESPACE_SOLITAIRE = {
	workspace: 'e0640000-0000-4000-8000-0000000000b1',
	track: 'e0640000-0000-4000-8000-0000000000b2',
	channel: 'e0640000-0000-4000-8000-0000000000b3',
	workflow: 'e0640000-0000-4000-8000-0000000000b4',
	etape: 'e0640000-0000-4000-8000-0000000000b5',
	noeud: 'e0640000-0000-4000-8000-0000000000b6',
	card: 'e0640000-0000-4000-8000-0000000000b7',
	slugTrack: 'sonde-3b-track',
	slugChannel: 'sonde-3b-channel',
	titreCard: 'Affaire sans témoin',
} as const

/** L'adresse de la fiche de l'affaire jetable, telle que la webapp la résout. */
export const ADRESSE_CARD_SOLITAIRE = `/tracks/${ESPACE_SOLITAIRE.slugTrack}/${ESPACE_SOLITAIRE.slugChannel}/cards/${ESPACE_SOLITAIRE.card}`

const ENTETES_SERVICE = {
	apikey: CLE_SERVICE,
	Authorization: `Bearer ${CLE_SERVICE}`,
	'Content-Type': 'application/json',
}

/**
 * Monte l'espace jetable, son unique appartenance et la chaîne complète d'une affaire (§50.3).
 *
 * LE MEMBRE UNIQUE EST `admin` DE SON ESPACE, ET NON `viewer` (§50.4). Le rôle décide de ce qu'il
 * peut écrire, jamais de ce qu'il peut LIRE : l'état vide vient de l'absence d'autres membres. Le
 * rôle `admin` est retenu parce qu'un espace sans administrateur est un état que
 * `last_workspace_admin` (`CRM-022`) refuse par ailleurs — fabriquer une donnée que la base
 * refuserait serait fabriquer un cas impossible.
 *
 * LE WORKFLOW N'A AUCUNE TRANSITION, et c'est délibéré : l'affaire ne bouge pas, et rien de ce que
 * la preuve observe ne dépend d'un déplacement.
 */
export async function monterEspaceSolitaire(requete: APIRequestContext): Promise<void> {
	// Un démontage préalable rend la fonction rejouable après une exécution interrompue (§50.5).
	await demonterEspaceSolitaire(requete, { constater: false })

	const creer = async (table: string, corps: Record<string, unknown>) => {
		const reponse = await requete.post(`${URL_API}/rest/v1/${table}`, {
			headers: ENTETES_SERVICE,
			data: corps,
		})
		expect(
			reponse.status(),
			`fixture ${table} de l’espace solitaire : ${await reponse.text()}`,
		).toBe(201)
	}

	await creer('workspaces', {
		id: ESPACE_SOLITAIRE.workspace,
		name: 'Sonde 3b — espace solitaire',
		slug: 'sonde-3b-espace-solitaire',
	})
	await creer('workspace_members', {
		workspace_id: ESPACE_SOLITAIRE.workspace,
		user_id: DRISS_SOLITAIRE,
		role: 'admin',
	})
	await creer('tracks', {
		id: ESPACE_SOLITAIRE.track,
		workspace_id: ESPACE_SOLITAIRE.workspace,
		name: 'Sonde 3b — track',
		slug: ESPACE_SOLITAIRE.slugTrack,
		position: 1,
	})
	await creer('workflows', {
		id: ESPACE_SOLITAIRE.workflow,
		workspace_id: ESPACE_SOLITAIRE.workspace,
		name: 'Sonde 3b — workflow',
	})
	await creer('workflow_nodes_catalog', {
		id: ESPACE_SOLITAIRE.noeud,
		workspace_id: ESPACE_SOLITAIRE.workspace,
		key: 'sonde-3b-noeud',
		label: 'Sonde 3b — nœud',
	})
	await creer('workflow_steps', {
		id: ESPACE_SOLITAIRE.etape,
		workflow_id: ESPACE_SOLITAIRE.workflow,
		workspace_id: ESPACE_SOLITAIRE.workspace,
		node_id: ESPACE_SOLITAIRE.noeud,
		position: 1,
		is_initial: true,
	})
	await creer('channels', {
		id: ESPACE_SOLITAIRE.channel,
		workspace_id: ESPACE_SOLITAIRE.workspace,
		track_id: ESPACE_SOLITAIRE.track,
		name: 'Sonde 3b — channel',
		slug: ESPACE_SOLITAIRE.slugChannel,
		workflow_id: ESPACE_SOLITAIRE.workflow,
		position: 1,
	})
	await creer('cards', {
		id: ESPACE_SOLITAIRE.card,
		workspace_id: ESPACE_SOLITAIRE.workspace,
		channel_id: ESPACE_SOLITAIRE.channel,
		workflow_id: ESPACE_SOLITAIRE.workflow,
		current_step_id: ESPACE_SOLITAIRE.etape,
		title: ESPACE_SOLITAIRE.titreCard,
		position: 1,
	})
}

/**
 * Démonte la chaîne dans l'ordre inverse des dépendances, et CONSTATE l'état rendu (§50.5).
 *
 * `workspace_members` part en cascade avec l'espace — mesuré par `CRM-079` le 2026-08-16 —, et n'a
 * donc pas de ligne propre ici.
 *
 * `constater` vaut `false` pour le seul nettoyage préalable du montage : à cet instant, la base
 * porte peut-être encore une trace d'une exécution interrompue, et échouer là masquerait la cause.
 */
export async function demonterEspaceSolitaire(
	requete: APIRequestContext,
	options: { constater?: boolean } = {},
): Promise<void> {
	const cibles: Array<[string, string]> = [
		['cards', ESPACE_SOLITAIRE.card],
		['channels', ESPACE_SOLITAIRE.channel],
		['workflow_steps', ESPACE_SOLITAIRE.etape],
		['workflow_nodes_catalog', ESPACE_SOLITAIRE.noeud],
		['workflows', ESPACE_SOLITAIRE.workflow],
		['tracks', ESPACE_SOLITAIRE.track],
		['workspaces', ESPACE_SOLITAIRE.workspace],
	]
	for (const [table, id] of cibles) {
		await requete.delete(`${URL_API}/rest/v1/${table}?id=eq.${id}`, { headers: ENTETES_SERVICE })
	}

	if (options.constater === false) return

	const restants = await requete.get(`${URL_API}/rest/v1/workspaces?select=id`, {
		headers: ENTETES_SERVICE,
	})
	expect(restants.status()).toBe(200)
	expect(
		(await restants.json()) as Array<{ id: string }>,
		'la base doit être rendue à son unique workspace seedé (CRM-005) — sans quoi ' +
			'e2e/ui/demarrage.spec.ts rougirait là où plus rien ne dirait pourquoi',
	).toEqual([{ id: WORKSPACE_SEED }])
}
