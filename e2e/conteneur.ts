// @spec CRM-115 (docs/BACKLOG.md) — tranche T2 : plus aucun nom de conteneur en développement
// @spec docs/SPEC-pile-par-session.md §6 (un conteneur se désigne par son service Compose) ; docs/JOURNAL.md décision 702
//
// Le pendant TypeScript de `scripts/lib/conteneur.sh` : une preuve qui doit parler à un conteneur (`docker exec`,
// `docker inspect`, `docker logs`) le désigne par son SERVICE Compose. Compose le nomme à partir du projet ; aucune
// preuve ne répète une convention de nommage, et deux piles de deux projets ne se confondent pas.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { RACINE } from './env'

const noms = new Map<string, string>()

/**
 * Le nom du conteneur du service, arrêté compris. Le nom et non l'identifiant : une reconstruction de la base recrée
 * le conteneur sous le même nom (docs/SPEC-test-harness.md §3.6). Échoue en nommant le service et la commande qui
 * monte la pile, plutôt que de rendre une chaîne vide que `docker` interpréterait de travers.
 */
export function conteneur(service: string): string {
	const connu = noms.get(service)
	if (connu) return connu
	const sortie = execFileSync(
		'docker',
		[
			'compose',
			'--env-file',
			join(RACINE, '.env'),
			'-f',
			join(RACINE, 'docker-compose.yml'),
			'-f',
			join(RACINE, 'docker-compose.dev.yml'),
			'ps',
			'-a',
			'--format',
			'{{.Name}}',
			service,
		],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
	)
	const nom = sortie.split('\n')[0]?.trim() ?? ''
	if (!nom) {
		throw new Error(
			`Aucun conteneur du service « ${service} » dans la pile de développement : lancez ./runDev.sh.`,
		)
	}
	noms.set(service, nom)
	return nom
}
