// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : les dépendances réelles de la fonction `ia`
// @spec docs/SPEC-ia.md §11.2 (le jeton de l'appelant pour décider, la clé de service pour écrire la fin
//       d'une génération sur la suggestion autorisée), §11.4 (verrou, échec) ; docs/JOURNAL.md décision 617
// @spec CRM-097 tranche T2.b — docs/SPEC-ia.md §12.1 (la révision écrite rend les défauts que la BASE a
//       calculés), §12.6 (la dernière révision relue avec ses défauts) ; décision 618
// @spec CRM-097 tranche T3.b — docs/SPEC-ia.md §13.2 et §13.5 (la composition vivante et l'occupation, lues par les
//       deux RPC `security invoker` avec le jeton de l'appelant) ; décision 620
//
// Tout passe par PostgREST, comme un client : aucune connexion directe à PostgreSQL. Avec le jeton de
// l'appelant, c'est la RLS qui répond ; la clé de service ne sert qu'à écrire l'issue d'une génération
// que la base a déjà autorisée, sur la suggestion qu'elle a désignée.

import { lireConfiguration } from './configuration.ts'
import type { DependancesIa, ResultatCreation, Suggestion } from './handler.ts'
import type { Defaut } from './proposition.ts'
import { generer, lireEtat } from './ollama.ts'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
type LireEnv = (nom: string) => string | undefined

/** Un appel à la base ne retient jamais l'appelant plus de 10 s. */
export const DELAI_BASE_MS = 10_000
const COLONNES = 'id,workspace_id,workflow_id,portee,statut,demande,generation_depuis,created_by'

/** Le battement du flux : bien au-dessous des 60 s de lecture de Kong (docs/SPEC-ia.md §11.1). */
export const BATTEMENT_MS = 15_000

export function creerDependances(
	lire: LireEnv,
	requete: Fetch = fetch,
	maintenantMs: () => number = () => Date.now(),
	ecrireJournal: (ligne: string) => void = (ligne) => console.info(ligne),
): DependancesIa {
	const configuration = lireConfiguration(lire)
	const urlApi = lire('SUPABASE_URL')?.replace(/\/+$/, '') ?? ''
	const cleAnonyme = lire('SUPABASE_ANON_KEY') ?? ''
	const cleService = lire('SUPABASE_SERVICE_ROLE_KEY') ?? ''
	const rest = (chemin: string) => `${urlApi}/rest/v1/${chemin}`

	const commeAppelant = (jeton: string, extra: Record<string, string> = {}) => ({
		apikey: cleAnonyme,
		authorization: `Bearer ${jeton}`,
		'content-type': 'application/json',
		accept: 'application/json',
		...extra,
	})
	const commeService = (extra: Record<string, string> = {}) => ({
		apikey: cleService,
		authorization: `Bearer ${cleService}`,
		'content-type': 'application/json',
		...extra,
	})
	const signal = () => AbortSignal.timeout(DELAI_BASE_MS)

	async function lignes<T>(reponse: Response): Promise<T[]> {
		if (!reponse.ok) return []
		const corps: unknown = await reponse.json()
		return Array.isArray(corps) ? (corps as T[]) : []
	}

	return {
		configuration,

		async creerSuggestion(jeton, champs): Promise<ResultatCreation> {
			const reponse = await requete(rest(`suggestions_ia?select=${COLONNES}`), {
				method: 'POST',
				headers: commeAppelant(jeton, { prefer: 'return=representation' }),
				// Le verrou est posé à la création : la première génération part aussitôt.
				body: JSON.stringify({ ...champs, generation_depuis: new Date(maintenantMs()).toISOString() }),
				signal: signal(),
			})
			if (reponse.status === 401 || reponse.status === 403) return { ok: false, statut: 403 }
			const [suggestion] = await lignes<Suggestion>(reponse)
			return suggestion === undefined ? { ok: false, statut: 400 } : { ok: true, suggestion }
		},

		async verrouiller(jeton, id, avantLe) {
			// Le verrou n'est posé que sur une suggestion en revue, libre ou au verrou périmé.
			const filtre = `id=eq.${id}&statut=eq.en_revue&or=(generation_depuis.is.null,generation_depuis.lt.${encodeURIComponent(avantLe)})`
			const reponse = await requete(rest(`suggestions_ia?${filtre}&select=${COLONNES}`), {
				method: 'PATCH',
				headers: commeAppelant(jeton, { prefer: 'return=representation' }),
				body: JSON.stringify({ generation_depuis: new Date(maintenantMs()).toISOString() }),
				signal: signal(),
			})
			const [suggestion] = await lignes<Suggestion>(reponse)
			return suggestion ?? null
		},

		async lireSuggestion(jeton, id) {
			const reponse = await requete(rest(`suggestions_ia?id=eq.${id}&select=${COLONNES}`), {
				headers: commeAppelant(jeton),
				signal: signal(),
			})
			const [suggestion] = await lignes<Suggestion>(reponse)
			return suggestion ?? null
		},

		async lireDerniereRevision(jeton, id) {
			const reponse = await requete(
				rest(`suggestions_ia_revisions?suggestion_id=eq.${id}&select=proposition,defauts&order=numero.desc&limit=1`),
				{ headers: commeAppelant(jeton), signal: signal() },
			)
			const [revision] = await lignes<{ proposition: unknown; defauts: Defaut[] }>(reponse)
			return revision === undefined ? null : { proposition: revision.proposition, defauts: Array.isArray(revision.defauts) ? revision.defauts : [] }
		},

		async lireCatalogue(jeton, workspaceId) {
			const reponse = await requete(
				rest(`workflow_nodes_catalog?workspace_id=eq.${workspaceId}&archived_at=is.null&select=key,label,kind&order=position`),
				{ headers: commeAppelant(jeton), signal: signal() },
			)
			return (await lignes<{ key: string; label: string; kind: string }>(reponse)).map((n) => ({
				cle: n.key,
				libelle: n.label,
				nature: n.kind,
			}))
		},

		async lireComposition(jeton, workflowId) {
			const reponse = await requete(rest('rpc/proposition_du_workflow'), {
				method: 'POST',
				headers: commeAppelant(jeton),
				body: JSON.stringify({ p_workflow: workflowId }),
				signal: signal(),
			})
			if (!reponse.ok) return null
			const composition: unknown = await reponse.json()
			return typeof composition === 'object' && composition !== null && !Array.isArray(composition) ? composition : null
		},

		async lireOccupation(jeton, workflowId) {
			const reponse = await requete(rest('rpc/occupation_du_workflow'), {
				method: 'POST',
				headers: commeAppelant(jeton),
				body: JSON.stringify({ p_workflow: workflowId }),
				signal: signal(),
			})
			if (!reponse.ok) return {}
			const occupation: unknown = await reponse.json()
			if (typeof occupation !== 'object' || occupation === null || Array.isArray(occupation)) return {}
			return Object.fromEntries(
				Object.entries(occupation as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'),
			)
		},

		async ecrireRevision(revision) {
			// Les défauts ne sont pas envoyés : la base les calcule, et la révision écrite les rend.
			const ecrite = await requete(rest('suggestions_ia_revisions?select=defauts'), {
				method: 'POST',
				headers: commeService({ prefer: 'return=representation', accept: 'application/json' }),
				body: JSON.stringify({ ...revision, origine: 'ia' }),
				signal: signal(),
			})
			const [ligne] = await lignes<{ defauts: unknown }>(ecrite)
			// Le verrou est levé et l'échec précédent effacé, que la révision ait pu s'écrire ou non : une
			// suggestion abandonnée entre-temps refuse la révision (`suggestion figee`), et c'est voulu.
			await requete(rest(`suggestions_ia?id=eq.${revision.suggestion_id}&statut=eq.en_revue`), {
				method: 'PATCH',
				headers: commeService({ prefer: 'return=minimal' }),
				body: JSON.stringify({ generation_depuis: null, derniere_erreur: null }),
				signal: signal(),
			})
			return ligne === undefined ? { ecrite: false } : { ecrite: true, defauts: Array.isArray(ligne.defauts) ? ligne.defauts.length : 0 }
		},

		async ecrireEchec(id, echec) {
			await requete(rest(`suggestions_ia?id=eq.${id}&statut=eq.en_revue`), {
				method: 'PATCH',
				headers: commeService({ prefer: 'return=minimal' }),
				body: JSON.stringify({ generation_depuis: null, derniere_erreur: echec }),
				signal: signal(),
			})
		},

		lireEtat: (cible, modele) => lireEtat(cible, modele, requete),
		generer: (cible, messages, schema) =>
			generer(cible, configuration.modele, configuration.contexte, messages, schema, requete, maintenantMs),
		battementMs: BATTEMENT_MS,
		maintenantMs,
		journaliser: (evenement) => ecrireJournal(JSON.stringify({ fonction: 'ia', ...evenement })),
	}
}
