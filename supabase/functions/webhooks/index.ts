// @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : adaptation Deno de la fonction `webhooks`
// @spec docs/SPEC-webhooks.md §2 (la fonction remet), §6 (le nom résolu avant chaque essai) ;
//       docs/SPEC-edge-functions.md §3 (arborescence)

import { creerDependances } from './dependances.ts'
import { traiterWebhooks } from './handler.ts'

declare const Deno: {
	serve(handler: (request: Request) => Response | Promise<Response>): void
	env: { get(name: string): string | undefined }
	resolveDns(hote: string, type: 'A' | 'AAAA'): Promise<string[]>
	createHttpClient(options: { caCerts: string[] }): unknown
}

const dependances = creerDependances((nom) => Deno.env.get(nom), {
	resoudre: (hote, type) => Deno.resolveDns(hote, type),
	creerClient: (autorites) => Deno.createHttpClient({ caCerts: autorites }),
})

Deno.serve((requete) => traiterWebhooks(requete, dependances))
