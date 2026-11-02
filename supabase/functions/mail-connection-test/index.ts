// @spec CRM-127 (docs/BACKLOG.md) — tranche T3 : adaptation Deno de la fonction `mail-connection-test`
// @spec docs/SPEC-mail-subsystem.md §23.4 ; docs/SPEC-edge-functions.md §3 (arborescence)

import { creerDependances } from './dependances.ts'
import { traiterTestConnexion } from './handler.ts'

declare const Deno: {
	serve(handler: (request: Request) => Response | Promise<Response>): void
	env: { get(name: string): string | undefined }
}

const dependances = creerDependances((nom) => Deno.env.get(nom))

Deno.serve((requete) => traiterTestConnexion(requete, dependances))
