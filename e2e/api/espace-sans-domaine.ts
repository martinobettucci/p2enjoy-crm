// @spec CRM-157 (docs/BACKLOG.md) — tranche T1 : l'espace jetable sans domaine d'adresses d'affaire, monté par les preuves
//       du refus au lieu d'un seed étendu (docs/SPEC-mail-subsystem.md §33.6 : le seed garde son espace unique, `CRM-005`)
// @spec docs/SPEC-mail-subsystem.md §33.2, §33.7 ; docs/SPEC-onboarding.md §8 ter.2 (le patron de l'espace neuf monté par
//       une preuve) ; docs/JOURNAL.md décisions 951 et 953
//
// CAMILLE Y EST ADMINISTRATRICE, et tout ce qu'un utilisateur fait passe par SON jeton et par les vrais chemins : le
// workflow de départ (`creer_workflow_de_depart`), l'affaire (`creer_affaire`). La clé de service ne pose que ce qu'aucun
// écran ne crée pour un espace neuf sans session : l'espace, l'appartenance, le track, le channel, et l'identité d'envoi
// (dont le secret SMTP n'intéresse pas un refus qui tombe avant tout envoi).

import { expect, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

export const ESPACE_SANS_DOMAINE = {
	id: 'e1570000-0000-4000-8000-000000000001',
	nom: 'Sonde 157 — sans domaine',
	slug: 'sonde-157-sans-domaine',
} as const
export const CAMILLE = { id: '5eed0000-0000-4000-8000-000000000011', adresse: 'admin@p2enjoy.test' } as const

export type MontageSansDomaine = {
	readonly idAffaire: string
	readonly idIdentite: string
	readonly titreAffaire: string
	readonly slugTrack: string
	readonly slugChannel: string
}

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

/** Retire l'espace et ce qu'il porte, dans l'ordre que les `RESTRICT` imposent (le patron de `premier-lancement`). */
export async function demonterEspaceSansDomaine(requete: APIRequestContext): Promise<void> {
	const filtre = `workspace_id=eq.${ESPACE_SANS_DOMAINE.id}`
	for (const table of [
		'mail_drafts',
		'mail_outbox',
		'cards',
		'channels',
		'tracks',
		'workflows',
		'workflow_nodes_catalog',
		'mail_outbound_identities',
		'workspace_members',
	]) {
		await requete.delete(rest(`${table}?${filtre}`), { headers: enTetesService() })
	}
	await requete.delete(rest(`workspaces?id=eq.${ESPACE_SANS_DOMAINE.id}`), { headers: enTetesService() })
	const restants = await requete.get(rest(`workspaces?id=eq.${ESPACE_SANS_DOMAINE.id}&select=id`), {
		headers: enTetesService(),
	})
	expect(await restants.json(), 'l’espace jetable ne doit pas rester dans la base').toEqual([])
}

export async function monterEspaceSansDomaine(requete: APIRequestContext): Promise<MontageSansDomaine> {
	await demonterEspaceSansDomaine(requete)
	const service = json({ ...enTetesService(), Prefer: 'return=representation' })
	const espace = await requete.post(rest('workspaces'), {
		headers: service,
		data: { id: ESPACE_SANS_DOMAINE.id, name: ESPACE_SANS_DOMAINE.nom, slug: ESPACE_SANS_DOMAINE.slug },
	})
	expect(espace.status(), await espace.text()).toBe(201)
	expect(((await espace.json()) as { inbound_domain: string | null }[])[0]?.inbound_domain, 'aucun domaine').toBeNull()
	const membre = await requete.post(rest('workspace_members'), {
		headers: service,
		data: { workspace_id: ESPACE_SANS_DOMAINE.id, user_id: CAMILLE.id, role: 'admin' },
	})
	expect(membre.status(), await membre.text()).toBe(201)

	const camille = json(enTetesAuthentifies(await jetonDe(CAMILLE.adresse)))
	const workflow = await requete.post(rest('rpc/creer_workflow_de_depart'), {
		headers: camille,
		data: { p_workspace: ESPACE_SANS_DOMAINE.id },
	})
	expect(workflow.status(), await workflow.text()).toBe(200)
	const idWorkflow = (await workflow.json()) as string

	const slugTrack = 'sonde-157'
	const slugChannel = 'envois'
	const track = await requete.post(rest('tracks'), {
		headers: service,
		data: { workspace_id: ESPACE_SANS_DOMAINE.id, name: 'Sonde 157', slug: slugTrack, position: 1 },
	})
	expect(track.status(), await track.text()).toBe(201)
	const idTrack = ((await track.json()) as { id: string }[])[0]!.id
	const channel = await requete.post(rest('channels'), {
		headers: service,
		data: {
			workspace_id: ESPACE_SANS_DOMAINE.id,
			track_id: idTrack,
			name: 'Envois',
			slug: slugChannel,
			workflow_id: idWorkflow,
			position: 1,
		},
	})
	expect(channel.status(), await channel.text()).toBe(201)
	const idChannel = ((await channel.json()) as { id: string }[])[0]!.id

	const titreAffaire = 'Sonde 157 — Atelier sans domaine'
	const affaire = await requete.post(rest('rpc/creer_affaire'), {
		headers: camille,
		data: { p_channel: idChannel, p_titre: titreAffaire },
	})
	expect(affaire.status(), await affaire.text()).toBe(200)
	const idAffaire = (await affaire.json()) as string

	const identite = await requete.post(rest('mail_outbound_identities'), {
		headers: service,
		data: {
			workspace_id: ESPACE_SANS_DOMAINE.id,
			owner_id: CAMILLE.id,
			label: 'Envoi de Camille — sonde 157',
			smtp_host: 'smtp.sonde-157.test',
			smtp_port: 587,
			smtp_username: 'camille',
			from_address: 'camille@sonde-157.test',
			from_name: 'Camille Aubert',
			is_default: true,
			status: 'ok',
		},
	})
	expect(identite.status(), await identite.text()).toBe(201)
	const idIdentite = ((await identite.json()) as { id: string }[])[0]!.id

	return { idAffaire, idIdentite, titreAffaire, slugTrack, slugChannel }
}
