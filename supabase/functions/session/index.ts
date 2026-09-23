// @spec CRM-092 (docs/BACKLOG.md) — adaptation Deno de l'échangeur de session
// @spec docs/SPEC-session-sso.md §5 (échangeur) ; docs/SPEC-edge-functions.md §3 (arborescence)

import { creerDependances } from './dependances.ts'
import { traiterSession } from './handler.ts'

declare const Deno: {
	serve(handler: (request: Request) => Response | Promise<Response>): void
	env: { get(name: string): string | undefined }
}

const dependances = creerDependances((nom) => Deno.env.get(nom))

Deno.serve((requete) => traiterSession(requete, dependances))
