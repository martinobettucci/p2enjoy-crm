// @spec CRM-016 (docs/BACKLOG.md) — service principal des fonctions edge
// @spec docs/SPEC-edge-functions.md §2 (bornes), §4 (dispatch), §4.1 (santé), §5 (sécurité)

import { resolveFunctionRoute, safeRequestId } from './router.ts'

type Worker = { fetch(request: Request): Promise<Response> }

declare const Deno: {
	serve(handler: (request: Request) => Response | Promise<Response>): void
	env: { get(name: string): string | undefined }
	stat(path: string): Promise<{ isDirectory: boolean }>
}

declare const EdgeRuntime: {
	userWorkers: {
		create(options: {
			servicePath: string
			memoryLimitMb: number
			workerTimeoutMs: number
			noModuleCache: boolean
			importMapPath: null
			envVars: [string, string][]
		}): Promise<Worker>
	}
}

const FUNCTION_ROOT = '/home/deno/functions'
const PASSED_ENVIRONMENT = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const

function json(body: Record<string, string>, status: number, requestId?: string): Response {
	const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' })
	if (requestId !== undefined) headers.set('x-request-id', requestId)
	return new Response(JSON.stringify(body), { status, headers })
}

function workerEnvironment(): [string, string][] {
	const values: [string, string][] = []
	for (const name of PASSED_ENVIRONMENT) {
		const value = Deno.env.get(name)
		if (value !== undefined) values.push([name, value])
	}
	return values
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		return (await Deno.stat(path)).isDirectory
	} catch {
		return false
	}
}

function withRequestId(response: Response, requestId: string): Response {
	const headers = new Headers(response.headers)
	headers.set('x-request-id', requestId)
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

Deno.serve(async (request: Request) => {
	const startedAt = performance.now()
	const pathname = new URL(request.url).pathname
	if (pathname === '/__health') return json({ status: 'ok' }, 200)

	const requestId = safeRequestId(request.headers.get('x-request-id'), crypto.randomUUID())
	const route = resolveFunctionRoute(pathname)
	if (!route.ok) return json({ error: route.error, request_id: requestId }, route.status, requestId)

	const servicePath = `${FUNCTION_ROOT}/${route.functionName}`
	if (!(await directoryExists(servicePath))) {
		return json({ error: 'function_not_found', request_id: requestId }, 404, requestId)
	}

	try {
		const worker = await EdgeRuntime.userWorkers.create({
			servicePath,
			memoryLimitMb: 128,
			workerTimeoutMs: 10_000,
			noModuleCache: false,
			importMapPath: null,
			envVars: workerEnvironment(),
		})
		const response = await worker.fetch(request)
		console.info(JSON.stringify({
			event: 'edge_request_completed',
			request_id: requestId,
			function: route.functionName,
			method: request.method,
			status: response.status,
			duration_ms: Math.round(performance.now() - startedAt),
		}))
		return withRequestId(response, requestId)
	} catch {
		console.info(JSON.stringify({
			level: 'error',
			event: 'edge_request_failed',
			request_id: requestId,
			function: route.functionName,
			method: request.method,
			duration_ms: Math.round(performance.now() - startedAt),
		}))
		return json({ error: 'function_unavailable', request_id: requestId }, 502, requestId)
	}
})
