// @spec CRM-016 (docs/BACKLOG.md) — fonction edge d'exemple sans effet
// @spec docs/SPEC-edge-functions.md §6 (contrat HTTP)

const ALLOW = 'POST, OPTIONS'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** Réponse pure et déterministe ; aucune configuration ni donnée entrante n'est reflétée. */
export async function handleExampleRequest(request: Request): Promise<Response> {
	if (request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: { allow: ALLOW } })
	}
	if (request.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
			status: 405,
			headers: { ...JSON_HEADERS, allow: ALLOW },
		})
	}
	// Le contenu est volontairement sans effet, mais le flux est consommé avant la réponse : un
	// body abandonné peut maintenir un isolate jusqu'à sa borne murale (décision 286).
	await request.arrayBuffer()
	return new Response(JSON.stringify({
		function: 'example',
		runtime: 'edge-runtime',
		message: 'Fonction edge opérationnelle',
	}), { status: 200, headers: JSON_HEADERS })
}
