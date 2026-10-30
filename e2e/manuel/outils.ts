// @spec CRM-117 (docs/BACKLOG.md) — tranche T4 : ce que les scénarios des images du manuel partagent
// @spec docs/SPEC-manual.md §11.2 (un générateur, joué sur la pile de développement et le seed, connecté avec le profil
//       qui convient au passage), §11.4 (le projet Playwright `manuel`)
//
// Les scénarios de `e2e/manuel/` PRODUISENT des images ; ils ne prouvent pas le produit, ce que font ceux de `e2e/ui/`.
// Ils se connectent donc par la même porte — la vraie page du SSO de développement —, et rendent la base dans l'état du
// seed : tout ce qu'un scénario pose pour faire paraître un écran, il le retire.

import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { lireEnv } from '../env'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { creerCompteJetable, supprimerCompte } from '../api/keycloak-dev'

export { connecterAvecLeLabs } from '../ui/fixtures'

export const ADMIN = 'admin@p2enjoy.test'
export const BIZDEV = 'bizdev@p2enjoy.test'
export const VIEWER = 'viewer@p2enjoy.test'
export const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** L'affaire « Migration ERP Sogexia », du channel « Grands comptes » du track « Conseil & IA ». */
export const AFFAIRE_SOGEXIA = '/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c2'

export const EMETTEUR_SSO = lireEnv('SSO_OIDC_ISSUER')

export const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

/** Une écriture de service, pour poser ou retirer ce qu'aucun écran ne pose : son statut est vérifié, jamais supposé. */
export async function service(
	requete: APIRequestContext,
	methode: 'post' | 'delete' | 'patch',
	chemin: string,
	data?: unknown,
): Promise<void> {
	const reponse = await requete[methode](rest(chemin), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
		...(data === undefined ? {} : { data }),
	})
	expect(reponse.status(), `${methode} ${chemin} : ${await reponse.text()}`).toBeLessThan(300)
}

export async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), `lecture de service ${chemin}`).toBe(200)
	return (await reponse.json()) as T
}

/**
 * Remplit la vraie page de connexion de LeLabs depuis `/connexion`, sans exiger que l'entrée réussisse : une attente ou un
 * refus est un écran que le manuel décrit.
 */
export async function tenterConnexion(page: Page, adresse: string): Promise<void> {
	await page.context().clearCookies()
	await page.goto('/connexion')
	await page.getByRole('button', { name: 'Se connecter avec LeLabs' }).click()
	await page.waitForURL((url) => url.href.startsWith(EMETTEUR_SSO))
	await page.locator('#username').fill(adresse)
	await page.locator('#password').fill(MOT_DE_PASSE_SEED)
	await page.locator('#kc-login').click()
}

/** Attend la fin des animations d'un élément : une image prise pendant un fondu montrerait ce que personne ne voit. */
export async function immobile(page: Page, testid: string): Promise<void> {
	await page.getByTestId(testid).evaluate((noeud) =>
		Promise.all(noeud.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined),
	)
}

/** Retient une requête jusqu'à ce que le scénario la libère : la réponse reste la vraie, seulement retardée. */
export function retenir(): { attendre: Promise<void>; liberer: () => void } {
	let liberer = () => {}
	const attendre = new Promise<void>((resolve) => {
		liberer = resolve
	})
	return { attendre, liberer }
}

export type Compte = { readonly adresse: string; readonly sub: string }
export type EspaceNeuf = { readonly id: string; readonly slug: string; readonly nom: string }

/**
 * Un espace vide et son administrateur, comme `e2e/ui/guide-flottant.spec.ts` les monte : le workspace et l'attente par la
 * clé de service — aucun écran ne crée d'espace —, le compte dans le Keycloak de développement ; l'appartenance naît de la
 * vraie connexion. Ce que le scénario y fait naître ensuite passe par l'écran.
 */
export async function monterEspaceNeuf(
	requete: APIRequestContext,
	espace: EspaceNeuf,
	personne: { readonly prenom: string; readonly nom: string },
): Promise<Compte> {
	await viderEspaceNeuf(requete, espace)
	const compte = await creerCompteJetable('manuel', personne.prenom, personne.nom)
	await service(requete, 'post', 'workspaces', [{ id: espace.id, name: espace.nom, slug: espace.slug }])
	await service(requete, 'post', 'workspace_invitations', [{ workspace_id: espace.id, email: compte.adresse, role: 'admin' }])
	return compte
}

async function viderEspaceNeuf(requete: APIRequestContext, espace: EspaceNeuf): Promise<void> {
	const filtre = `workspace_id=eq.${espace.id}`
	// Les étapes et les transitions partent avec leur workflow ; le catalogue, après les étapes qui le référencent.
	for (const table of ['channels', 'tracks', 'workflows', 'workflow_nodes_catalog']) await service(requete, 'delete', `${table}?${filtre}`)
	await service(requete, 'delete', `workspaces?id=eq.${espace.id}`)
}

/** Démonte l'espace et son compte, puis CONSTATE que la base est rendue à son unique espace seedé. */
export async function demonterEspaceNeuf(requete: APIRequestContext, espace: EspaceNeuf, compte: Compte | null): Promise<void> {
	await viderEspaceNeuf(requete, espace)
	if (compte !== null) {
		await service(requete, 'delete', `profiles?id=eq.${compte.sub}`)
		await supprimerCompte(compte.sub)
	}
	expect(await lireService<{ id: string }[]>(requete, 'workspaces?select=id'), 'la base est rendue à son espace seedé').toEqual([
		{ id: WORKSPACE_SEED },
	])
}

/**
 * Pose une affaire jetable à une étape donnée, par la clé de service.
 *
 * LE SEUL ENDROIT des scénarios du manuel qui écrit une affaire. Depuis la bascule de `CRM-111` T2.4.5, `cards` ne porte
 * plus le rattachement : l'affaire, puis son rattachement dans `card_placements` (channel, workflow, étape ; le rang est
 * attribué). La clé de service y a le droit (décision 746) et n'est pas soumise à l'invariant « au moins un
 * rattachement » entre les deux requêtes (décision 770).
 */
export async function poserAffaire(
	requete: APIRequestContext,
	affaire: { readonly id: string; readonly titre: string; readonly channel: string; readonly workflow: string; readonly etape: string },
): Promise<void> {
	await service(requete, 'post', 'cards', [{ id: affaire.id, workspace_id: WORKSPACE_SEED, title: affaire.titre }])
	await service(requete, 'post', 'card_placements', [
		{
			card_id: affaire.id,
			workspace_id: WORKSPACE_SEED,
			channel_id: affaire.channel,
			workflow_id: affaire.workflow,
			current_step_id: affaire.etape,
		},
	])
}

/** Les repères du seed où une affaire jetable se pose : « Grands comptes », le workflow global, l'étape Signature. */
export const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
export const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
export const ETAPE_SIGNATURE = '5eed0000-0000-4000-8000-000000000064'

/**
 * Retire une affaire jetable : tout ce que les gestes du scénario y ont attaché part en cascade — rattachement,
 * contacts, commentaires, activités, et le fil. Le fil est en ajout seul (`card_events` : la clé de service n'y a que la
 * lecture, migration 0016) ; c'est pourquoi un geste qui écrit dans un fil se joue sur une affaire jetable, jamais sur
 * une affaire du seed.
 */
export async function detruireAffaire(requete: APIRequestContext, id: string): Promise<void> {
	await service(requete, 'delete', `cards?id=eq.${id}`)
}

/**
 * Remet le seed partagé dans son état après un scénario : Driss Lemoine rendu à son rôle, les affaires jetables nommées
 * retirées. À appeler depuis un `test.afterEach` : un test interrompu par son délai ne joue plus utilement son `finally`
 * — son contexte de requête est déjà fermé quand l'attente rejette —, tandis que le hook tourne avant le démontage.
 * Constaté le 2026-10-30 : Driss était resté « viewer » dans la base partagée.
 */
export async function retablirLeSeed(requete: APIRequestContext, titresJetables: readonly string[] = []): Promise<void> {
	const [driss] = await lireService<{ id: string }[]>(requete, `profiles?full_name=eq.${encodeURIComponent('Driss Lemoine')}&select=id`)
	if (driss !== undefined)
		await service(requete, 'patch', `workspace_members?workspace_id=eq.${WORKSPACE_SEED}&user_id=eq.${driss.id}`, { role: 'business_developer' })
	for (const titre of titresJetables) await service(requete, 'delete', `cards?title=eq.${encodeURIComponent(titre)}`)
}
