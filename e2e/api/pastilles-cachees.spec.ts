// @verifies CRM-159 (docs/BACKLOG.md) — tranche T1 : les pastilles cachées sur la vraie base, sous les vrais jetons — la
//           liste de l'inbox (`rpc/inbox_messages`) masque les fils Spam, « Lead » ne montre pas le fil Spam et Lead,
//           « Spam » le montre ; la mention (`rpc/inbox_hidden_counts`), les compteurs (`rpc/inbox_arborescence`) et la
//           recherche (`rpc/recherche_globale`, `rpc/search_hidden_mail_counts`) suivent la même règle ; la lectrice qui
//           écrit le drapeau ne touche aucune ligne, l'administratrice l'écrit
// @verifies docs/SPEC-mail-subsystem.md §31.13.1 à §31.13.6, §31.13.9 (preuve d'API) ; CLAUDE.md §10, §15
//
// LES MAILS SONT PROPRES À LA PREUVE, posés par la clé de service dans « Refonte du site vitrine » (`…c1`, que Camille lit
// et que la lectrice ne lit pas), et retirés à la fin par leur préfixe ; leurs pastilles sont posées par
// `set_message_label` sous le jeton de l'administratrice — le vrai geste. Leurs objets et leurs corps ne contiennent aucun
// mot d'un nom de pastille : le simulateur de développement ne leur en pose aucune (le patron de
// `filtres-rapides-pastilles.spec.ts`). Le mot de leur objet, tiré au hasard, ne répond qu'à eux dans la recherche.

import { type APIRequestContext, expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
// Un mot que rien d'autre ne porte, et que la découpe de la recherche garde entier : des lettres seulement.
const MOT = `zorvex${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`
const PREFIXE = '<tst-crm159-api-'

test.describe.configure({ mode: 'serial' })

type Mails = { readonly spam: string; readonly spamLead: string; readonly lead: string }
let mails: Mails | null = null
let pastilles: { readonly spam: string; readonly lead: string } | null = null

async function poserMail(request: APIRequestContext, rang: number): Promise<string> {
	const reponse = await request.post(rest('mail_messages'), {
		headers: json({ ...enTetesService(), Prefer: 'return=representation' }),
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `${PREFIXE}${MOT}-${rang}@sonde.test>`,
			card_id: CARD_C1,
			classification: 'manual',
			from_address: `contact-${rang}@sonde.test`,
			subject: `Sonde ${MOT} numéro ${rang}`,
			body_text: 'Preuve des fils masqués.',
			direction: 'inbound',
			received_at: new Date(Date.now() - rang * 60_000).toISOString(),
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

async function idPastille(request: APIRequestContext, nom: string): Promise<string> {
	const reponse = await request.get(
		rest(`mail_labels?workspace_id=eq.${ESPACE}&name=eq.${encodeURIComponent(nom)}&select=id`),
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne, `la pastille « ${nom} » du seed`).toBeDefined()
	return ligne?.id ?? ''
}

async function poser(request: APIRequestContext, jeton: string, message: string, label: string): Promise<void> {
	const reponse = await request.post(rest('rpc/set_message_label'), {
		headers: json(enTetesAuthentifies(jeton)),
		data: { p_message_id: message, p_label_id: label, p_applied: true },
	})
	expect(reponse.status(), await reponse.text()).toBe(204)
}

async function rpc<T>(request: APIRequestContext, jeton: string, fonction: string, corps: object): Promise<T> {
	const reponse = await request.post(rest(`rpc/${fonction}`), { headers: json(enTetesAuthentifies(jeton)), data: corps })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as T
}

/** La liste de l'inbox telle que la webapp la lit (§31.13.4), restreinte aux mails de la preuve. */
async function liste(request: APIRequestContext, jeton: string, labels: readonly string[]): Promise<string[]> {
	const lignes = await rpc<{ id: string }[]>(request, jeton, 'inbox_messages', {
		p_card_id: CARD_C1,
		p_label_ids: labels,
		p_limit: 200,
	})
	const notres = new Set(Object.values(mails ?? {}))
	return lignes.map((l) => l.id).filter((id) => notres.has(id))
}

async function drapeau(request: APIRequestContext, label: string): Promise<boolean> {
	const reponse = await request.get(rest(`mail_labels?id=eq.${label}&select=hidden`), { headers: enTetesService() })
	return ((await reponse.json()) as { hidden: boolean }[])[0]!.hidden
}

test.beforeAll(async ({ request }) => {
	await request.delete(rest(`mail_messages?rfc822_message_id=like.${encodeURIComponent(PREFIXE)}*`), { headers: enTetesService() })
	const spam = await idPastille(request, 'Spam')
	const lead = await idPastille(request, 'Lead')
	pastilles = { spam, lead }
	const jeton = await jetonDe(ADMIN)
	mails = { spam: await poserMail(request, 1), spamLead: await poserMail(request, 2), lead: await poserMail(request, 3) }
	await poser(request, jeton, mails.spam, spam)
	await poser(request, jeton, mails.spamLead, spam)
	await poser(request, jeton, mails.spamLead, lead)
	await poser(request, jeton, mails.lead, lead)
})

test.afterAll(async ({ request }) => {
	// PAR PRÉFIXE, et non par la liste : après un échec, Playwright relance le worker (le patron de `CRM-155`).
	await request.delete(rest(`mail_messages?rfc822_message_id=like.${encodeURIComponent(PREFIXE)}*`), { headers: enTetesService() })
	if (pastilles !== null) {
		await request.patch(rest(`mail_labels?id=eq.${pastilles.lead}`), {
			headers: json(enTetesService()),
			data: { hidden: false },
		})
	}
})

test('Spam est cachée dans l’espace du seed, et Lead visible', async ({ request }) => {
	if (pastilles === null) throw new Error('montage absent')
	expect(await drapeau(request, pastilles.spam)).toBe(true)
	expect(await drapeau(request, pastilles.lead)).toBe(false)
})

test('la liste masque les fils Spam ; « Lead » ne montre pas le fil Spam et Lead ; « Spam » le montre', async ({ request }) => {
	if (mails === null || pastilles === null) throw new Error('montage absent')
	const jeton = await jetonDe(ADMIN)
	expect(await liste(request, jeton, [])).toEqual([mails.lead])
	expect(await liste(request, jeton, [pastilles.lead]), 'le caché l’emporte').toEqual([mails.lead])
	expect(await liste(request, jeton, [pastilles.spam])).toEqual([mails.spam, mails.spamLead])
	expect(await liste(request, jeton, [pastilles.lead, pastilles.spam])).toEqual([mails.spam, mails.spamLead, mails.lead])
})

test('la mention compte les fils masqués, et les compteurs ne les comptent pas', async ({ request }) => {
	if (pastilles === null) throw new Error('montage absent')
	const jeton = await jetonDe(ADMIN)
	const mention = await rpc<{ label_id: string; thread_count: number }[]>(request, jeton, 'inbox_hidden_counts', {
		p_card_id: CARD_C1,
	})
	expect(mention).toContainEqual({ label_id: pastilles.spam, thread_count: 2 })
	const sousSpam = await rpc<unknown[]>(request, jeton, 'inbox_hidden_counts', {
		p_card_id: CARD_C1,
		p_label_ids: [pastilles.spam],
	})
	expect(sousSpam).toEqual([])

	const arbre = await rpc<{ card_id: string | null; nombre: number }[]>(request, jeton, 'inbox_arborescence', { p_only_me: false })
	const dossier = arbre.find((ligne) => ligne.card_id === CARD_C1)
	const montres = await rpc<unknown[]>(request, jeton, 'inbox_messages', { p_card_id: CARD_C1, p_limit: 200 })
	expect(dossier?.nombre, 'le dossier compte ce que la liste montre sans filtre').toBe(montres.length)
})

test('la recherche n’offre pas les mails masqués, et le dit', async ({ request }) => {
	if (mails === null || pastilles === null) throw new Error('montage absent')
	const jeton = await jetonDe(ADMIN)
	const resultats = await rpc<{ id: string }[]>(request, jeton, 'recherche_globale', { p_terme: MOT, p_limite: 50 })
	expect(resultats.map((r) => r.id)).toEqual([mails.lead])
	const masques = await rpc<{ label_id: string; mail_count: number }[]>(request, jeton, 'search_hidden_mail_counts', {
		p_terme: MOT,
	})
	expect(masques).toMatchObject([{ label_id: pastilles.spam, workspace_id: ESPACE, label_name: 'Spam', mail_count: 2 }])
})

test('la lectrice ne voit rien de l’affaire : ni résultat, ni compte de mails masqués', async ({ request }) => {
	const jeton = await jetonDe(LECTRICE)
	expect(await rpc<unknown[]>(request, jeton, 'recherche_globale', { p_terme: MOT, p_limite: 50 })).toEqual([])
	expect(await rpc<unknown[]>(request, jeton, 'search_hidden_mail_counts', { p_terme: MOT })).toEqual([])
})

test('le drapeau : la lectrice ne touche aucune ligne, l’administratrice l’écrit', async ({ request }) => {
	if (mails === null || pastilles === null) throw new Error('montage absent')
	const lectrice = await request.patch(rest(`mail_labels?id=eq.${pastilles.lead}`), {
		headers: json({ ...enTetesAuthentifies(await jetonDe(LECTRICE)), Prefer: 'return=representation' }),
		data: { hidden: true },
	})
	expect(lectrice.status(), await lectrice.text()).toBe(200)
	expect(await lectrice.json(), 'la politique des administrateurs écarte la ligne').toEqual([])
	expect(await drapeau(request, pastilles.lead)).toBe(false)

	const jeton = await jetonDe(ADMIN)
	const admin = await request.patch(rest(`mail_labels?id=eq.${pastilles.lead}`), {
		headers: json({ ...enTetesAuthentifies(jeton), Prefer: 'return=representation' }),
		data: { hidden: true },
	})
	expect(admin.status(), await admin.text()).toBe(200)
	expect(await drapeau(request, pastilles.lead)).toBe(true)
	// Lead cachée à son tour : le fil Lead seul se masque, et « Lead » le montre.
	expect(await liste(request, jeton, [])).toEqual([])
	expect(await liste(request, jeton, [pastilles.lead])).toEqual([mails.spamLead, mails.lead])
})
