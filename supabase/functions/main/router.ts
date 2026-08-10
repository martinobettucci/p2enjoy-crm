// @spec CRM-016 (docs/BACKLOG.md) — résolution sûre d'une fonction edge
// @spec docs/SPEC-edge-functions.md §4 (routeur principal)

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

/** Un identifiant entrant n'est repris que s'il reste court et sans caractère de contrôle. */
export function safeRequestId(candidate: string | null, generated: string): string {
	return candidate !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : generated
}
