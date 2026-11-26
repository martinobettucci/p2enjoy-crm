// @spec CRM-016 (docs/BACKLOG.md) — résolution sûre d'une fonction edge
// @spec docs/SPEC-edge-functions.md §4 (routeur principal)
// @spec CRM-166 (docs/BACKLOG.md) — `repertoireDe` : le plan de l'assistant de l'inbox servi depuis `_ia-inbox` (docs/SPEC-ia.md §17.6)
// @spec CRM-163 (docs/BACKLOG.md) — `repertoireDe` : la passe des pastilles servie depuis sa propre voie, `_ia-pastilles`
//       (docs/SPEC-ia.md §16.2 ; docs/SPEC-edge-functions.md §4)

const FUNCTION_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62})$/
const RESERVED_NAMES = new Set(['main'])

export type FunctionRoute =
	| { ok: true; functionName: string }
	| { ok: false; status: 400 | 404; error: 'missing_function' | 'function_not_found' }

/** Résout le premier segment sans jamais le transformer en chemin arbitraire. */
export function resolveFunctionRoute(pathname: string): FunctionRoute {
	const [functionName] = pathname.split('/').filter(Boolean)
	if (functionName === undefined) {
		return { ok: false, status: 400, error: 'missing_function' }
	}
	if (!FUNCTION_NAME.test(functionName) || RESERVED_NAMES.has(functionName)) {
		return { ok: false, status: 404, error: 'function_not_found' }
	}
	return { ok: true, functionName }
}

/**
 * Le répertoire qui sert une requête. Le runtime ne sert qu'un worker à la fois par répertoire (`oneshot`, docs/SPEC-ia.md
 * §16.1) : la passe des pastilles — `ia/pastilles/…` — a le sien, pour ne jamais retenir l'assistant. Son nom commence par
 * `_`, que `resolveFunctionRoute` refuse : seul ce routage y mène. L'environnement et la borne restent ceux de la fonction.
 */
export function repertoireDe(functionName: string, pathname: string): string {
	const [, deuxieme] = pathname.split('/').filter(Boolean)
	if (functionName === 'ia' && deuxieme === 'pastilles') return '_ia-pastilles'
	// `CRM-166` : le plan de l'assistant de l'inbox a sa voie, pour ne bloquer ni l'assistant de conception ni la passe (docs/SPEC-ia.md §17.6).
	if (functionName === 'ia' && deuxieme === 'inbox') return '_ia-inbox'
	return functionName
}

/** Un identifiant entrant n'est repris que s'il reste court et sans caractère de contrôle. */
export function safeRequestId(candidate: string | null, generated: string): string {
	return candidate !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : generated
}
