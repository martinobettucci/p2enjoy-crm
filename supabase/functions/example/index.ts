// @spec CRM-016 (docs/BACKLOG.md) — adaptation Deno de la fonction edge d'exemple
// @spec docs/SPEC-edge-functions.md §3, §6

import { handleExampleRequest } from './handler.ts'

declare const Deno: {
	serve(handler: (request: Request) => Response | Promise<Response>): void
}

Deno.serve(handleExampleRequest)
