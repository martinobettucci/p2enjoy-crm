// @spec CRM-007 (docs/BACKLOG.md) — lecture des espaces de travail par la coquille
// @spec docs/SPEC-webapp.md §6.3 (ce que la coquille lit), §6.4 (contrat asynchrone)
// @spec docs/SCHEMA.md §1 (socle d'identité) ; docs/SPEC-permissions-rls.md (refus par défaut)
//
// `public.workspaces` est la seule table métier existante à ce jour. Sous la clé anonyme, la
// RLS en refus par défaut de CRM-003 rend `200` et `[]` — mesuré. L'état vide affiché par
// l'interface est donc **le refus du backend**, pas un défaut de l'interface.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

export type Workspace = Pick<Database['public']['Tables']['workspaces']['Row'], 'id' | 'name' | 'slug'>

/**
 * Interroge PostgREST. Ne lève jamais : tout échec est rendu comme un état d'erreur classé.
 *
 * La classification s'appuie sur le code HTTP réellement reçu, jamais sur le texte du message
 * (voir `classerErreur`).
 */
export async function lireWorkspaces(client: ClientCrm): Promise<EtatAsync<readonly Workspace[]>> {
	try {
		const reponse = await client.from('workspaces').select('id, name, slug').order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre : un échec
		// réseau ne doit pas remonter comme une exception non traitée jusqu'à React.
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Charge les workspaces accessibles et expose un rechargement **réel** — la reprise proposée
 * par l'état d'erreur relance la requête, elle ne recharge pas la page
 * (docs/SPEC-webapp.md §7).
 */
export function useWorkspaces(client: ClientCrm | null): {
	readonly etat: EtatAsync<readonly Workspace[]>
	readonly recharger: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<readonly Workspace[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni
	// une réponse périmée écraser une réponse plus récente.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement)
		void lireWorkspaces(client).then((resultat) => {
			if (rang === courant.current) setEtat(resultat)
		})
	}, [client, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger }
}
