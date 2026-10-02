// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : adaptation Deno de la fonction `ia`
// @spec docs/SPEC-ia.md §11.1 (la génération vit dans sa requête : `oneshot` retire le worker après sa réponse) ;
//       docs/SPEC-edge-functions.md §3 (arborescence)

import { creerDependances } from './dependances.ts'
import { traiterIa } from './handler.ts'

declare const Deno: {
	serve(handler: (request: Request) => Response | Promise<Response>): void
	env: { get(name: string): string | undefined }
}

const dependances = creerDependances((nom) => Deno.env.get(nom))

Deno.serve((requete) => traiterIa(requete, dependances))
