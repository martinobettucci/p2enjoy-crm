// @verifies CRM-155 (docs/BACKLOG.md) — tranche T1 : le filtre à plusieurs pastilles, tel que la webapp le demande, sur la
//           vraie base avec les vrais jetons — deux pastilles en OU rendent l'union, un message qui porte les deux n'est rendu
//           qu'une fois, une pastille posée puis RETIRÉE à la main ne retient pas le message, une pastille archivée filtre,
//           et la lectrice ne voit que ce que la RLS lui ouvre
// @verifies docs/SPEC-mail-subsystem.md §31.12.2, §31.12.6 (preuve d'API) ; §31.3 (qui lit) ; CLAUDE.md §10, §15
//
// LES MAILS SONT PROPRES À LA PREUVE, posés par la clé de service et retirés à la fin quoi qu'il arrive ; leurs pastilles
// sont posées par `set_message_label` sous le jeton de l'administratrice — le vrai geste, une ligne `manual` que la passe
// de la minute ne touche jamais. Leurs objets et leurs corps ne contiennent aucun mot d'un nom de pastille : le simulateur
// de développement ne leur en pose aucune (`supabase/docker/ollama-simule/serveur.py`, scénario `pastilles`).

import { type APIRequestContext, expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
// « Formation Data & IA », que la lectrice lit.
const CARD_C7 = '5eed0000-0000-4000-8000-0000000000c7'
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })
const suffixe = Date.now().toString(36)
// La requête de la webapp, recopiée : le projet des E2E ne compile pas les modules de la webapp (`import.meta.env`). Sa
// valeur est épinglée par `webapp/src/lib/inbox.test.ts`.
const COLONNES_LISTE_INBOX_FILTREE =
	'id, workspace_id, card_id, classification, subject, from_address, from_name, received_at, references_ids, rfc822_message_id, is_read, pastilles:mail_message_labels(label_id, applied), filtre_pastille:mail_message_labels!inner(label_id, applied)'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.describe.configure({ mode: 'serial' })

const crees: string[] = []

async function poserMail(request: APIRequestContext, objet: string, card = CARD_C1): Promise<string> {
	const reponse = await request.post(rest('mail_messages'), {
		headers: json({ ...enTetesService(), Prefer: 'return=representation' }),
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `<tst-crm155-api-${suffixe}-${crees.length}@sonde.test>`,
			card_id: card,
			classification: 'manual',
			from_address: 'contact@sonde.test',
			subject: objet,
			body_text: 'Preuve des filtres rapides.',
			direction: 'inbound',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const id = ((await reponse.json()) as { id: string }[])[0]!.id
	crees.push(id)
	return id
}

async function pastille(request: APIRequestContext, nom: string): Promise<string> {
	const reponse = await request.get(
		rest(`mail_labels?workspace_id=eq.${ESPACE}&name=eq.${encodeURIComponent(nom)}&select=id`),
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

async function poser(request: APIRequestContext, jeton: string, message: string, label: string, applied = true) {
	const reponse = await request.post(rest('rpc/set_message_label'), {
		headers: json(enTetesAuthentifies(jeton)),
		data: { p_message_id: message, p_label_id: label, p_applied: applied },
	})
	expect(reponse.status(), await reponse.text()).toBe(204)
}

/** La lecture de la webapp (§31.12.2) : `in` sur l'embarquement filtrant, `applied`, bornée ici aux messages donnés. */
async function filtrer(
	request: APIRequestContext,
	jeton: string,
	pastilles: readonly string[],
	messages: readonly string[],
): Promise<string[]> {
	const reponse = await request.get(
		rest(
			`mail_messages?select=${encodeURIComponent(COLONNES_LISTE_INBOX_FILTREE)}` +
				`&id=in.(${messages.join(',')})` +
				`&filtre_pastille.label_id=in.(${pastilles.join(',')})&filtre_pastille.applied=eq.true` +
				'&order=received_at.desc,id.desc',
		),
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(reponse.status(), await reponse.text()).toBe(200)
	return ((await reponse.json()) as { id: string }[]).map((m) => m.id)
}

test.afterAll(async ({ request }) => {
	// PAR PRÉFIXE, et non par la liste `crees` : après un échec, Playwright relance le worker, et `afterAll` y tourne avec
	// une liste vide — trois sondes étaient ainsi restées en base (relevé par la session fc, 2026-11-18).
	const prefixe = encodeURIComponent('<tst-crm155-api-*')
	await request.delete(`${URL_API}/rest/v1/mail_messages?rfc822_message_id=like.${prefixe}`, { headers: enTetesService() })
})

test('deux pastilles en OU : l’union, chaque message une seule fois ; une pastille retirée à la main ne retient rien', async ({
	request,
}) => {
	const camille = await jetonDe('admin@p2enjoy.test')
	const lead = await pastille(request, 'Lead')
	const spam = await pastille(request, 'Spam')
	const avecLead = await poserMail(request, `ZZ 155 un ${suffixe}`)
	const avecSpam = await poserMail(request, `ZZ 155 deux ${suffixe}`)
	const avecLesDeux = await poserMail(request, `ZZ 155 trois ${suffixe}`)
	const retiree = await poserMail(request, `ZZ 155 quatre ${suffixe}`)
	const sans = await poserMail(request, `ZZ 155 cinq ${suffixe}`)
	await poser(request, camille, avecLead, lead)
	await poser(request, camille, avecSpam, spam)
	await poser(request, camille, avecLesDeux, lead)
	await poser(request, camille, avecLesDeux, spam)
	await poser(request, camille, retiree, lead)
	await poser(request, camille, retiree, lead, false)
	const tous = [avecLead, avecSpam, avecLesDeux, retiree, sans]

	const union = await filtrer(request, camille, [lead, spam], tous)
	expect(new Set(union)).toEqual(new Set([avecLead, avecSpam, avecLesDeux]))
	// PostgREST rend UNE ligne par message, quel que soit le nombre de pastilles qui le retiennent (§31.12.2).
	expect(union).toHaveLength(3)
	// Une seule pastille : la même requête, la même règle.
	expect(new Set(await filtrer(request, camille, [lead], tous))).toEqual(new Set([avecLead, avecLesDeux]))
	expect(new Set(await filtrer(request, camille, [spam], tous))).toEqual(new Set([avecSpam, avecLesDeux]))
})

test('une pastille archivée filtre : le message du seed qui porte « Newsletter » est retenu', async ({ request }) => {
	const camille = await jetonDe('admin@p2enjoy.test')
	const newsletter = await pastille(request, 'Newsletter')
	const reponse = await request.get(
		rest(`mail_labels?id=eq.${newsletter}&select=archived_at`),
		{ headers: enTetesService() },
	)
	expect(((await reponse.json()) as { archived_at: string | null }[])[0]?.archived_at, 'le seed archive Newsletter').not.toBeNull()
	const portes = await request.get(
		rest(`mail_message_labels?label_id=eq.${newsletter}&applied=is.true&select=message_id`),
		{ headers: enTetesService() },
	)
	const ids = ((await portes.json()) as { message_id: string }[]).map((l) => l.message_id)
	expect(ids.length, 'le seed porte une archivée sur un mail (docs/SPEC-seed.md §46)').toBeGreaterThan(0)
	expect(new Set(await filtrer(request, camille, [newsletter], ids))).toEqual(new Set(ids))
})

test('la lectrice : le filtre ne lui rend que les messages que la RLS lui ouvre', async ({ request }) => {
	const camille = await jetonDe('admin@p2enjoy.test')
	const farida = await jetonDe('viewer@p2enjoy.test')
	const lead = await pastille(request, 'Lead')
	const lisible = await poserMail(request, `ZZ 155 lectrice lisible ${suffixe}`, CARD_C7)
	const ferme = await poserMail(request, `ZZ 155 lectrice fermé ${suffixe}`)
	await poser(request, camille, lisible, lead)
	await poser(request, camille, ferme, lead)
	expect(new Set(await filtrer(request, camille, [lead], [lisible, ferme]))).toEqual(new Set([lisible, ferme]))
	expect(await filtrer(request, farida, [lead], [lisible, ferme])).toEqual([lisible])
})
