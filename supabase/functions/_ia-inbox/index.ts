// @spec CRM-166 (docs/BACKLOG.md) — tranche T1 : la voie du plan de l'assistant de l'inbox (docs/SPEC-ia.md §17.6 ; docs/SPEC-edge-functions.md §4)
// @spec CRM-163 (docs/BACKLOG.md) — le patron : la voie de la passe des pastilles, que ce répertoire reprend : la même fonction `ia`, servie depuis son propre
//       répertoire, pour que le runtime ne la compte pas avec l'assistant (docs/SPEC-ia.md §16.1, §16.2 ;
//       docs/SPEC-edge-functions.md §4)
//
// `main` n'y envoie que `ia/inbox/…`, avec l'environnement et la borne de `ia` (`repertoireDe`). Le nom commence par
// `_` : le routeur le refuse au premier segment, aucune adresse publique n'y mène.

import { creerDependances } from '../ia/dependances.ts'
import { traiterIa } from '../ia/handler.ts'

declare const Deno: {
	serve(handler: (request: Request) => Response | Promise<Response>): void
	env: { get(name: string): string | undefined }
}

const dependances = creerDependances((nom) => Deno.env.get(nom))

Deno.serve((requete) => traiterIa(requete, dependances))
