// @verifies CRM-092 (docs/BACKLOG.md) — échangeur de session contre la pile réelle, hors interface
// @verifies docs/SPEC-session-sso.md §5 (échangeur), §6 (admission, rattachement des attentes),
//           §10 (realm préchargé), §13 (preuves API : refus, jeton interne accepté par PostgREST,
//           Realtime et Storage, rôle et appartenance retirés, rotation de clés)
// @verifies docs/SSO-client-lelabs-crm.md (« À vérifier côté application »)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve par une requête directe, vrais identifiants)
//
// Aucune de ces preuves ne passe par l'interface. Les jetons LeLabs sont émis par le Keycloak de
// développement au terme d'une vraie connexion PKCE ; l'échangeur est appelé par la vraie passerelle.
// Les comptes jetables, rôles retirés et clés ajoutées sont rendus dans un `finally`.

import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { CLE_ANONYME, COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService } from './jetons'
import {
	ajouterCleRs256Prioritaire,
	creerCompteJetable,
	effacerActionsRequises,
	exigerVerificationAdresse,
	idUtilisateur,
	retirerRoles,
	supprimerCompte,
} from './keycloak-dev'
import { DOMAINE, connexionPkce, echangerSession, rafraichir, revendications } from './sso'

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const CARD_GRANDS_COMPTES = '5eed0000-0000-4000-8000-0000000000c1'
const BIZDEV = '5eed0000-0000-4000-8000-000000000012'
const INCONNU = '5eed0000-0000-4000-8000-000000000014'
const ATTENDU = '5eed0000-0000-4000-8000-000000000015'

async function jetonInterne(adresse: string): Promise<string> {
	const { accessToken } = await connexionPkce(adresse)
	const { statut, corps } = await echangerSession(accessToken)
	expect(statut, `échange pour ${adresse}`).toBe(200)
	return corps.jeton as string
}

/** Un jeton de la forme exacte du jeton interne, signé par une AUTRE clé : ce qu'un faussaire obtiendrait. */
function jetonForge(sub: string): string {
	const texte = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
	const maintenant = Math.floor(Date.now() / 1000)
	const signe = `${texte({ alg: 'HS256', typ: 'JWT' })}.${texte({
		iss: 'p2enjoy-crm/session', sub, aud: 'authenticated', role: 'authenticated', iat: maintenant, exp: maintenant + 300,
	})}`
	return `${signe}.${createHmac('sha256', 'pas-le-secret-de-la-pile-0123456789abcdef').update(signe).digest('base64url')}`
}

async function lireService<T>(chemin: string): Promise<T[]> {
	const reponse = await fetch(`${URL_API}/rest/v1/${chemin}`, { headers: enTetesService() })
	expect(reponse.status, chemin).toBe(200)
	return (await reponse.json()) as T[]
}

test.describe('Les comptes du seed ouvrent une session, et la pile de données l’accepte', () => {
	for (const compte of COMPTES_SEED) {
		test(`${compte.role} : 200, identité stable, jeton interne lu par PostgREST sous RLS`, async () => {
			const { accessToken } = await connexionPkce(compte.adresse)
			const { statut, corps } = await echangerSession(accessToken)
			expect(statut).toBe(200)
			const sub = revendications(accessToken).sub as string
			expect(corps.identite).toMatchObject({ id: sub, adresse: compte.adresse })

			const interne = revendications(corps.jeton as string)
			expect(interne).toMatchObject({ iss: 'p2enjoy-crm/session', sub, role: 'authenticated', aud: 'authenticated' })
			expect(interne.exp).toBe(corps.expire_a)
			expect(interne.exp as number).toBeLessThanOrEqual(revendications(accessToken).exp as number)

			const appartenances = await fetch(`${URL_API}/rest/v1/workspace_members?select=user_id,role&user_id=eq.${sub}`, {
				headers: enTetesAuthentifies(corps.jeton as string),
			})
			expect(appartenances.status).toBe(200)
			expect(await appartenances.json()).toEqual([{ user_id: sub, role: compte.role }])
		})
	}

	test('le jeton LeLabs présenté DIRECTEMENT à PostgREST est refusé : seul le jeton interne y entre', async () => {
		const { accessToken } = await connexionPkce(COMPTES_SEED[0].adresse)
		const reponse = await fetch(`${URL_API}/rest/v1/workspaces?select=id`, { headers: enTetesAuthentifies(accessToken) })
		expect(reponse.status).toBe(401)
	})

	test('Storage accepte le jeton interne et refuse un jeton forgé', async () => {
		const interne = await jetonInterne(COMPTES_SEED[0].adresse)
		const lister = (jeton: string) =>
			fetch(`${URL_API}/storage/v1/object/list/mail-attachments`, {
				method: 'POST',
				headers: { ...enTetesAuthentifies(jeton), 'content-type': 'application/json' },
				body: JSON.stringify({ prefix: '', limit: 1 }),
			})
		expect((await lister(interne)).status).toBe(200)
		expect((await lister(jetonForge('5eed0000-0000-4000-8000-000000000011'))).status).not.toBe(200)
	})

	test('Realtime accepte le jeton interne : le destinataire reçoit, l’abonné au jeton forgé est refusé', async () => {
		const interneAdmin = await jetonInterne(COMPTES_SEED[0].adresse)
		const interneBizdev = await jetonInterne(COMPTES_SEED[1].adresse)

		// MESURÉ (décision 584, K18) : `supabase-js` pose le jeton sur Realtime de façon ASYNCHRONE à la
		// création du client, sans l'attendre ; un abonnement lancé aussitôt rejoint le canal EN ANONYME.
		// Le jeton est donc posé, et attendu, avant l'abonnement — c'est ce que la webapp devra faire.
		// Un jeton refusé ne rend AUCUN état : l'attente est bornée, et « AUCUN » est un refus.
		const abonner = async (jeton: string, nom: string) => {
			const client = createClient(URL_API, CLE_ANONYME, { accessToken: async () => jeton })
			await client.realtime.setAuth(jeton)
			const recues: Array<Record<string, unknown>> = []
			const canal = client
				.channel(`preuve-session-${nom}`)
				.on(
					'postgres_changes',
					{ event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${BIZDEV}` },
					(charge) => recues.push((charge as unknown as { new: Record<string, unknown> }).new),
				)
			const statut = await new Promise<string>((resolve) => {
				const borne = setTimeout(() => resolve('AUCUN'), 10_000)
				canal.subscribe((etat) => {
					if (etat === 'SUBSCRIBED' || etat === 'CHANNEL_ERROR' || etat === 'TIMED_OUT') {
						clearTimeout(borne)
						resolve(etat)
					}
				})
			})
			return { statut, recues, fermer: () => client.removeAllChannels() }
		}

		const destinataire = await abonner(interneBizdev, 'destinataire')
		const faussaire = await abonner(jetonForge(BIZDEV), 'faussaire')
		const idCommentaire = `e2e00092-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}`
		try {
			expect(destinataire.statut).toBe('SUBSCRIBED')
			expect(faussaire.statut).not.toBe('SUBSCRIBED')

			// Le commentaire et la mention passent par le vrai chemin, avec le jeton interne de
			// l'administratrice : la notification naît du trigger, jamais d'une insertion directe.
			const commentaire = await fetch(`${URL_API}/rest/v1/card_comments`, {
				method: 'POST',
				headers: { ...enTetesAuthentifies(interneAdmin), 'content-type': 'application/json' },
				body: JSON.stringify({ id: idCommentaire, card_id: CARD_GRANDS_COMPTES, body: 'Preuve CRM-092 : jeton interne.' }),
			})
			expect(commentaire.status).toBe(201)
			const mention = await fetch(`${URL_API}/rest/v1/card_comment_mentions`, {
				method: 'POST',
				headers: { ...enTetesAuthentifies(interneAdmin), 'content-type': 'application/json' },
				body: JSON.stringify({ comment_id: idCommentaire, profile_id: BIZDEV }),
			})
			expect(mention.status).toBe(201)

			await expect.poll(() => destinataire.recues.length, { timeout: 30_000 }).toBeGreaterThan(0)
			expect(destinataire.recues.at(-1)?.recipient_id).toBe(BIZDEV)
			expect(faussaire.recues).toHaveLength(0)
		} finally {
			await destinataire.fermer()
			await faussaire.fermer()
			await fetch(`${URL_API}/rest/v1/card_comment_mentions?comment_id=eq.${idCommentaire}`, { method: 'DELETE', headers: enTetesService() })
			await fetch(`${URL_API}/rest/v1/notifications?payload->>comment_id=eq.${idCommentaire}`, { method: 'DELETE', headers: enTetesService() })
			await fetch(`${URL_API}/rest/v1/card_comments?id=eq.${idCommentaire}`, { method: 'DELETE', headers: enTetesService() })
		}
	})

	test('un jeton rafraîchi chez LeLabs se rééchange : la session se prolonge sans nouvelle connexion', async () => {
		const { refreshToken } = await connexionPkce(COMPTES_SEED[1].adresse)
		const rafraichi = await rafraichir(refreshToken)
		expect(rafraichi.statut).toBe(200)
		const { statut } = await echangerSession(rafraichi.accessToken ?? '')
		expect(statut).toBe(200)
	})
})

test.describe('Les attentes et les refus du dictionnaire fermé (§5.4)', () => {
	test('inconnu@ : vérifié, attendu par aucun espace — 403 attente_espace, et aucune trace', async () => {
		const { statut, corps } = await echangerSession((await connexionPkce(`inconnu@${DOMAINE}`)).accessToken)
		expect(statut).toBe(403)
		expect(corps).toEqual({ erreur: 'attente_espace', adresse: `inconnu@${DOMAINE}` })
		expect(await lireService(`profiles?select=id&id=eq.${INCONNU}`)).toEqual([])
	})

	test('attendu@ : pas vérifié par LeLabs — 403 attente_verification, et rien n’est écrit', async () => {
		const { statut, corps } = await echangerSession((await connexionPkce(`attendu@${DOMAINE}`)).accessToken)
		expect(statut).toBe(403)
		expect(corps).toEqual({ erreur: 'attente_verification', adresse: `attendu@${DOMAINE}` })
		expect(await lireService(`profiles?select=id&id=eq.${ATTENDU}`)).toEqual([])
	})

	test('une adresse non prouvée — 403 adresse_non_verifiee', async () => {
		const adresse = `adresse-non-verifiee@${DOMAINE}`
		const sub = await idUtilisateur(adresse)
		await effacerActionsRequises(sub)
		await exigerVerificationAdresse(false)
		try {
			const { accessToken } = await connexionPkce(adresse)
			expect(revendications(accessToken).email_verified).toBe(false)
			const { statut, corps } = await echangerSession(accessToken)
			expect(statut).toBe(403)
			expect(corps).toEqual({ erreur: 'adresse_non_verifiee', adresse })
		} finally {
			await exigerVerificationAdresse(true)
			await effacerActionsRequises(sub)
		}
	})

	test('jeton d’une autre application, id_token, jeton interne, jeton absent : 401 jeton_refuse', async () => {
		const etranger = await connexionPkce(COMPTES_SEED[0].adresse, { client: 'crm-audience-etrangere' })
		expect((await echangerSession(etranger.accessToken)).corps).toEqual({ erreur: 'jeton_refuse' })
		expect((await echangerSession(etranger.accessToken)).statut).toBe(401)

		const { idToken } = await connexionPkce(COMPTES_SEED[0].adresse)
		expect((await echangerSession(idToken)).statut).toBe(401)

		const interne = await jetonInterne(COMPTES_SEED[0].adresse)
		expect((await echangerSession(interne)).statut).toBe(401)

		expect((await echangerSession(null)).statut).toBe(401)
	})

	test('toute autre méthode que POST : 405', async () => {
		const { statut, corps } = await echangerSession(null, 'GET')
		expect(statut).toBe(405)
		expect(corps).toEqual({ erreur: 'methode' })
	})
})

test.describe('Une attente se consomme, et l’accès se ferme quand sa cause disparaît (§6)', () => {
	test('attente rattachée au sub, une seule fois ; appartenance retirée puis verified retiré : refus', async () => {
		const compte = await creerCompteJetable('preuve-crm092', 'Prune', 'Attendue')
		try {
			const inscription = await fetch(`${URL_API}/rest/v1/workspace_invitations`, {
				method: 'POST',
				headers: { ...enTetesService(), 'content-type': 'application/json' },
				body: JSON.stringify({ workspace_id: WORKSPACE_SEED, email: compte.adresse, role: 'viewer' }),
			})
			expect(inscription.status).toBe(201)

			// Première connexion : l'attente devient une appartenance, le profil naît du `sub`.
			const premiere = await echangerSession((await connexionPkce(compte.adresse)).accessToken)
			expect(premiere.statut).toBe(200)
			expect(await lireService(`profiles?select=id,full_name&id=eq.${compte.sub}`)).toEqual([
				{ id: compte.sub, full_name: 'Prune Attendue' },
			])
			expect(await lireService(`workspace_members?select=role&user_id=eq.${compte.sub}`)).toEqual([{ role: 'viewer' }])
			expect(await lireService(`workspace_invitations?select=email&email=eq.${compte.adresse}`)).toEqual([])

			// Seconde connexion : rien de neuf n'est créé.
			expect((await echangerSession((await connexionPkce(compte.adresse)).accessToken)).statut).toBe(200)
			expect(await lireService(`workspace_members?select=role&user_id=eq.${compte.sub}`)).toHaveLength(1)

			// Appartenance retirée : l'échange suivant est refusé.
			await fetch(`${URL_API}/rest/v1/workspace_members?user_id=eq.${compte.sub}`, { method: 'DELETE', headers: enTetesService() })
			const sansEspace = await echangerSession((await connexionPkce(compte.adresse)).accessToken)
			expect(sansEspace).toEqual({ statut: 403, corps: { erreur: 'attente_espace', adresse: compte.adresse } })

			// `verified` retiré chez LeLabs : refusé avant même de consulter la base.
			await retirerRoles(compte.sub, ['verified'])
			const nonVerifie = await echangerSession((await connexionPkce(compte.adresse)).accessToken)
			expect(nonVerifie).toEqual({ statut: 403, corps: { erreur: 'attente_verification', adresse: compte.adresse } })
		} finally {
			await fetch(`${URL_API}/rest/v1/workspace_invitations?email=eq.${compte.adresse}`, { method: 'DELETE', headers: enTetesService() })
			await fetch(`${URL_API}/rest/v1/profiles?id=eq.${compte.sub}`, { method: 'DELETE', headers: enTetesService() })
			await supprimerCompte(compte.sub)
		}
	})
})

test.describe('La rotation des clés est suivie sans redémarrage (§5.2, point 4)', () => {
	test('une nouvelle clé est acceptée aussitôt ; l’ancienne, désactivée, ne vaut plus rien', async () => {
		const avant = await connexionPkce(COMPTES_SEED[0].adresse)
		const kidAvant = JSON.parse(Buffer.from(avant.accessToken.split('.')[0] ?? '', 'base64url').toString()).kid as string
		const rotation = await ajouterCleRs256Prioritaire()
		try {
			const apres = await connexionPkce(COMPTES_SEED[0].adresse)
			const kidApres = JSON.parse(Buffer.from(apres.accessToken.split('.')[0] ?? '', 'base64url').toString()).kid as string
			expect(kidApres).not.toBe(kidAvant)
			expect((await echangerSession(apres.accessToken)).statut).toBe(200)
			// L'ancienne clé est encore publiée : l'ancien jeton, non échu, vaut encore.
			expect((await echangerSession(avant.accessToken)).statut).toBe(200)

			await rotation.desactiverAnciennes()
			expect((await echangerSession(avant.accessToken)).statut).toBe(401)
			expect((await echangerSession(apres.accessToken)).statut).toBe(200)
		} finally {
			await rotation.restaurer()
		}
		expect((await echangerSession((await connexionPkce(COMPTES_SEED[0].adresse)).accessToken)).statut).toBe(200)
	})
})
