// @verifies CRM-092 (docs/BACKLOG.md) — échangeur de session, client CONFIDENTIEL, contre la pile réelle
// @verifies docs/SPEC-session-sso.md §5.1 (trois gestes), §5.2 (ouvrir : code, vérificateur, secret),
//           §5.3 (prolonger, fermer), §5.4 (jeton interne), §5.5 (refus), §5.6 (poignée, cookie),
//           §6 (admission rejouée), §7.4 (sessions serveur chiffrées), §10 (realm), §13 (preuves API)
// @verifies docs/SSO-client-lelabs-crm.md (« À vérifier côté application ») ; décision 586
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve par une requête directe, vrais identifiants)
//
// Aucune de ces preuves ne passe par l'interface. Le code est émis par le Keycloak de développement au
// terme d'une vraie connexion PKCE, puis remis à l'échangeur par la vraie passerelle, comme la webapp
// le fait : c'est l'échangeur, avec son secret, qui l'échange. Aucun jeton LeLabs n'est présenté à
// l'échangeur. Les comptes jetables, rôles retirés et clés ajoutées sont rendus dans un `finally`.

import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { CLE_ANONYME, COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService } from './jetons'
import {
	ajouterCleRs256Prioritaire,
	attribuerRoles,
	creerCompteJetable,
	effacerActionsRequises,
	exigerVerificationAdresse,
	fermerSessionsLeLabs,
	idUtilisateur,
	retirerRoles,
	supprimerCompte,
} from './keycloak-dev'
import {
	CLIENT_ETRANGER,
	DOMAINE,
	NOM_COOKIE,
	RETOUR,
	autorisation,
	connexionPkce,
	empreinte,
	fermer,
	gesteBrut,
	obtenirCode,
	ouvrir,
	ouvrirSession,
	prolonger,
	revendications,
} from './sso'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const CARD_GRANDS_COMPTES = '5eed0000-0000-4000-8000-0000000000c1'
const IDENTIFIANTS_SEED: Readonly<Record<string, string>> = {
	admin: '5eed0000-0000-4000-8000-000000000011',
	business_developer: '5eed0000-0000-4000-8000-000000000012',
	viewer: '5eed0000-0000-4000-8000-000000000013',
}
const BIZDEV = IDENTIFIANTS_SEED.business_developer ?? ''
const INCONNU = '5eed0000-0000-4000-8000-000000000014'
const ATTENDU = '5eed0000-0000-4000-8000-000000000015'
const ADMIN = COMPTES_SEED[0].adresse

type LigneSession = { sub: string; poignee_empreinte: string; rafraichissement: string; expire_le: string }

async function jetonInterne(adresse: string): Promise<string> {
	const { statut, corps } = await ouvrirSession(adresse)
	expect(statut, `ouverture pour ${adresse}`).toBe(200)
	return corps?.jeton as string
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

const sessionsDe = (sub: string) =>
	lireService<LigneSession>(`sessions_sso?select=sub,poignee_empreinte,rafraichissement,expire_le&sub=eq.${sub}`)

/** Le cookie d'une poignée : `HttpOnly`, `SameSite=Strict`, chemin de l'échangeur, sans durée (§5.6). */
function attendreCookieDePoignee(setCookie: string | null, poignee: string | null) {
	expect(poignee, 'une poignée est posée').toMatch(/^[A-Za-z0-9_-]{43}$/)
	expect(setCookie).toBe(`${NOM_COOKIE}=${poignee}; Path=/functions/v1/session; HttpOnly; SameSite=Strict`)
}

test.describe('Ouvrir, prolonger, fermer : les comptes du seed, et la pile de données qui accepte le jeton', () => {
	for (const compte of COMPTES_SEED) {
		test(`${compte.role} : 200, identité stable, cookie de poignée, jeton interne lu par PostgREST sous RLS`, async () => {
			const { statut, corps, setCookie, poignee } = await ouvrirSession(compte.adresse)
			expect(statut).toBe(200)
			const sub = IDENTIFIANTS_SEED[compte.role] ?? ''
			expect(corps?.identite).toMatchObject({ id: sub, adresse: compte.adresse })
			attendreCookieDePoignee(setCookie, poignee)
			expect(Object.keys(corps ?? {}).sort()).toEqual(['expire_a', 'identite', 'jeton'])

			const interne = revendications(corps?.jeton as string)
			expect(interne).toMatchObject({ iss: 'p2enjoy-crm/session', sub, role: 'authenticated', aud: 'authenticated' })
			expect(interne.exp).toBe(corps?.expire_a)
			expect(interne.exp as number).toBeLessThanOrEqual((interne.iat as number) + 300)
			expect(Object.keys(interne).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sub'])

			const appartenances = await fetch(`${URL_API}/rest/v1/workspace_members?select=user_id,role&user_id=eq.${sub}`, {
				headers: enTetesAuthentifies(corps?.jeton as string),
			})
			expect(appartenances.status).toBe(200)
			expect(await appartenances.json()).toEqual([{ user_id: sub, role: compte.role }])
			expect((await fermer(poignee)).statut).toBe(204)
		})
	}

	test('la session serveur : empreinte de la poignée seule, jeton de rafraîchissement chiffré, prolongée par le cookie', async () => {
		const sub = IDENTIFIANTS_SEED.admin ?? ''
		const ouverte = await ouvrirSession(ADMIN)
		expect(ouverte.statut).toBe(200)
		const poignee = ouverte.poignee ?? ''

		const lignes = (await sessionsDe(sub)).filter((l) => l.poignee_empreinte === empreinte(poignee))
		expect(lignes, 'une ligne par session, désignée par l’empreinte de sa poignée').toHaveLength(1)
		const ligne = lignes[0] as LigneSession
		expect(JSON.stringify(ligne), 'la poignée elle-même n’est jamais gardée').not.toContain(poignee)
		// `v1.<vecteur de 12 octets>.<chiffré>` : AES-GCM, jamais le jeton LeLabs en clair (un JWT `eyJ…`).
		const [version, vecteur, chiffre] = ligne.rafraichissement.split('.')
		expect(version).toBe('v1')
		expect(Buffer.from(vecteur ?? '', 'base64url')).toHaveLength(12)
		expect((chiffre ?? '').length).toBeGreaterThan(100)
		expect(ligne.rafraichissement.startsWith('eyJ')).toBe(false)

		// Prolonger : un nouveau jeton interne, la même personne, et aucun nouveau cookie.
		const prolongee = await prolonger(poignee)
		expect(prolongee.statut).toBe(200)
		expect(prolongee.setCookie).toBeNull()
		expect(revendications(prolongee.corps?.jeton as string).sub).toBe(sub)
		expect(prolongee.corps?.identite).toMatchObject({ id: sub, adresse: ADMIN })
		// LeLabs rend un nouveau jeton de rafraîchissement à chaque fois : il remplace l'ancien.
		const apres = (await sessionsDe(sub)).find((l) => l.poignee_empreinte === empreinte(poignee))
		expect(apres?.rafraichissement).not.toBe(ligne.rafraichissement)
		expect((await prolonger(poignee)).statut, 'le jeton remplacé se prolonge encore').toBe(200)

		// Fermer : 204, cookie effacé, la poignée ne désigne plus rien.
		const fermee = await fermer(poignee)
		expect(fermee.statut).toBe(204)
		expect(fermee.setCookie).toBe(`${NOM_COOKIE}=; Path=/functions/v1/session; HttpOnly; SameSite=Strict; Max-Age=0`)
		expect((await sessionsDe(sub)).filter((l) => l.poignee_empreinte === empreinte(poignee))).toEqual([])
		expect(await prolonger(poignee), 'aucune session : 204, jamais une erreur (décision 587)').toMatchObject({ statut: 204, corps: null })
		// Fermer ce qui n'existe pas n'est pas une erreur.
		expect((await fermer(poignee)).statut).toBe(204)
		expect((await fermer(null)).statut).toBe(204)
	})

	test('le cookie porte Secure quand l’origine appelante est https, et seulement là', async () => {
		const efface = await gesteBrut('fermer', { enTetes: { origin: 'https://crm.exemple.tld' } })
		expect(efface.statut).toBe(204)
		expect(efface.setCookie).toBe(`${NOM_COOKIE}=; Path=/functions/v1/session; HttpOnly; SameSite=Strict; Secure; Max-Age=0`)
	})

	test('la table des sessions n’est lisible ni par anon, ni par une personne connectée', async () => {
		const interne = await jetonInterne(ADMIN)
		for (const enTetes of [{ apikey: CLE_ANONYME, Authorization: `Bearer ${CLE_ANONYME}` }, enTetesAuthentifies(interne)]) {
			const reponse = await fetch(`${URL_API}/rest/v1/sessions_sso?select=sub`, { headers: enTetes })
			expect([401, 403]).toContain(reponse.status)
		}
		const appel = await fetch(`${URL_API}/rest/v1/rpc/lire_session_serveur`, {
			method: 'POST',
			headers: { ...enTetesAuthentifies(interne), 'content-type': 'application/json' },
			body: JSON.stringify({ p_empreinte: '\\x00' }),
		})
		expect([401, 403, 404]).toContain(appel.status)
	})

	test('le jeton LeLabs présenté DIRECTEMENT à PostgREST est refusé : seul le jeton interne y entre', async () => {
		const { accessToken } = await connexionPkce(ADMIN)
		const reponse = await fetch(`${URL_API}/rest/v1/workspaces?select=id`, { headers: enTetesAuthentifies(accessToken) })
		expect(reponse.status).toBe(401)
	})

	test('Storage accepte le jeton interne et refuse un jeton forgé', async () => {
		const interne = await jetonInterne(ADMIN)
		const lister = (jeton: string) =>
			fetch(`${URL_API}/storage/v1/object/list/mail-attachments`, {
				method: 'POST',
				headers: { ...enTetesAuthentifies(jeton), 'content-type': 'application/json' },
				body: JSON.stringify({ prefix: '', limit: 1 }),
			})
		expect((await lister(interne)).status).toBe(200)
		expect((await lister(jetonForge(IDENTIFIANTS_SEED.admin ?? ''))).status).not.toBe(200)
	})

	test('Realtime accepte le jeton interne : le destinataire reçoit, l’abonné au jeton forgé est refusé', async () => {
		const interneAdmin = await jetonInterne(ADMIN)
		const interneBizdev = await jetonInterne(COMPTES_SEED[1].adresse)

		// MESURÉ (décision 584, K18) : `supabase-js` pose le jeton sur Realtime de façon ASYNCHRONE à la
		// création du client, sans l'attendre ; un abonnement lancé aussitôt rejoint le canal EN ANONYME.
		// Le jeton est donc posé, et attendu, avant l'abonnement — c'est ce que la webapp fait.
		// Un jeton refusé ne rend AUCUN état : l'attente est bornée, et « AUCUN » est un refus.
		const abonner = async (jeton: string, nom: string) => {
			const client = createClient(URL_API, CLE_ANONYME, { accessToken: async () => jeton })
			await client.realtime.setAuth()
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
})

test.describe('Les attentes et les refus du dictionnaire fermé (§5.5)', () => {
	test('inconnu@ : vérifié, attendu par aucun espace — 403 attente_espace, aucune trace, aucun cookie', async () => {
		const { statut, corps, setCookie } = await ouvrirSession(`inconnu@${DOMAINE}`)
		expect(statut).toBe(403)
		expect(corps).toEqual({ erreur: 'attente_espace', adresse: `inconnu@${DOMAINE}` })
		expect(setCookie).toBeNull()
		expect(await lireService(`profiles?select=id&id=eq.${INCONNU}`)).toEqual([])
		expect(await sessionsDe(INCONNU)).toEqual([])
	})

	test('attendu@ : pas vérifié par LeLabs — 403 attente_verification, et rien n’est écrit', async () => {
		const { statut, corps, setCookie } = await ouvrirSession(`attendu@${DOMAINE}`)
		expect(statut).toBe(403)
		expect(corps).toEqual({ erreur: 'attente_verification', adresse: `attendu@${DOMAINE}` })
		expect(setCookie).toBeNull()
		expect(await lireService(`profiles?select=id&id=eq.${ATTENDU}`)).toEqual([])
	})

	test('une adresse non prouvée — 403 adresse_non_verifiee', async () => {
		const adresse = `adresse-non-verifiee@${DOMAINE}`
		const sub = await idUtilisateur(adresse)
		await effacerActionsRequises(sub)
		await exigerVerificationAdresse(false)
		try {
			const { statut, corps } = await ouvrirSession(adresse)
			expect(statut).toBe(403)
			expect(corps).toEqual({ erreur: 'adresse_non_verifiee', adresse })
		} finally {
			await exigerVerificationAdresse(true)
			await effacerActionsRequises(sub)
		}
	})

	test('un code émis pour une autre application du realm est refusé : 401 jeton_refuse', async () => {
		const etranger = await obtenirCode(ADMIN, { client: CLIENT_ETRANGER })
		expect(await ouvrir(etranger)).toMatchObject({ statut: 401, corps: { erreur: 'jeton_refuse' }, setCookie: null })
	})

	test('un code rejoué, ou présenté avec un autre vérificateur, est refusé : 401 jeton_refuse', async () => {
		const obtenu = await obtenirCode(ADMIN)
		const premiere = await ouvrir(obtenu)
		expect(premiere.statut).toBe(200)
		expect(await ouvrir(obtenu)).toMatchObject({ statut: 401, corps: { erreur: 'jeton_refuse' } })
		await fermer(premiere.poignee)

		const autre = await obtenirCode(ADMIN)
		expect(await ouvrir({ ...autre, verificateur: `${autre.verificateur}x` })).toMatchObject({
			statut: 401,
			corps: { erreur: 'jeton_refuse' },
		})
	})

	test('le realm refuse une autorisation sans PKCE, et le dit par une redirection (M2)', async () => {
		const reponse = await fetch(autorisation({ sansPkce: true }).url, { redirect: 'manual' })
		expect(reponse.status).toBe(302)
		const location = new URL(reponse.headers.get('location') ?? '')
		expect(`${location.origin}${location.pathname}`).toBe(RETOUR)
		expect(location.searchParams.get('error')).toBe('invalid_request')
		expect(location.searchParams.get('error_description')).toBe('Missing parameter: code_challenge_method')
	})

	test('un jeton LeLabs présenté à l’échangeur n’ouvre rien : il n’en lit aucun', async () => {
		const { accessToken, idToken } = await connexionPkce(ADMIN)
		for (const jeton of [accessToken, idToken, await jetonInterne(ADMIN)]) {
			const enTetes = { authorization: `Bearer ${jeton}` }
			expect(await gesteBrut('ouvrir', { enTetes })).toMatchObject({ statut: 400, corps: { erreur: 'requete_invalide' } })
			expect(await gesteBrut('prolonger', { enTetes })).toMatchObject({ statut: 204, corps: null, setCookie: null })
		}
	})

	test('corps d’ouverture mal formé : 400 requete_invalide', async () => {
		const valide = { code: 'c', verificateur: 'v', redirect_uri: RETOUR }
		for (const corps of [
			{},
			{ ...valide, code: '' },
			{ ...valide, verificateur: 42 },
			{ ...valide, redirect_uri: 'https://ailleurs.tld/autre' },
			{ ...valide, redirect_uri: `${RETOUR}?x=1` },
			[valide],
		]) {
			expect(await gesteBrut('ouvrir', { corps })).toMatchObject({ statut: 400, corps: { erreur: 'requete_invalide' } })
		}
	})

	// Décision 587 : la restauration de chaque page anonyme passe par là. Un `4xx` serait journalisé en
	// erreur par le navigateur à chaque chargement ; l'absence de session n'est pas un refus.
	test('sans cookie, ou avec une poignée inconnue : 204 sans corps, et le cookie inconnu est effacé', async () => {
		expect(await prolonger(null)).toMatchObject({ statut: 204, corps: null, setCookie: null })
		const inconnue = await prolonger('A'.repeat(43))
		expect(inconnue).toMatchObject({ statut: 204, corps: null })
		expect(inconnue.setCookie).toContain('Max-Age=0')
	})

	test('toute autre méthode que POST : 405 ; tout autre chemin : 404', async () => {
		expect(await gesteBrut('prolonger', { methode: 'GET' })).toMatchObject({ statut: 405, corps: { erreur: 'methode' } })
		expect(await gesteBrut('autre')).toMatchObject({ statut: 404, corps: { erreur: 'geste_inconnu' } })
		expect(await gesteBrut('')).toMatchObject({ statut: 404, corps: { erreur: 'geste_inconnu' } })
	})
})

test.describe('Une attente se consomme, et l’accès se ferme quand sa cause disparaît (§5.3, §6)', () => {
	test('attente rattachée au sub ; session LeLabs close, verified retiré, appartenance retirée : la prolongation refuse', async () => {
		const compte = await creerCompteJetable('preuve-crm092', 'Prune', 'Attendue')
		try {
			const inscription = await fetch(`${URL_API}/rest/v1/workspace_invitations`, {
				method: 'POST',
				headers: { ...enTetesService(), 'content-type': 'application/json' },
				body: JSON.stringify({ workspace_id: WORKSPACE_SEED, email: compte.adresse, role: 'viewer' }),
			})
			expect(inscription.status).toBe(201)

			// Première connexion : l'attente devient une appartenance, le profil naît du `sub`.
			const premiere = await ouvrirSession(compte.adresse)
			expect(premiere.statut).toBe(200)
			expect(await lireService(`profiles?select=id,full_name&id=eq.${compte.sub}`)).toEqual([
				{ id: compte.sub, full_name: 'Prune Attendue' },
			])
			expect(await lireService(`workspace_members?select=role&user_id=eq.${compte.sub}`)).toEqual([{ role: 'viewer' }])
			expect(await lireService(`workspace_invitations?select=email&email=eq.${compte.adresse}`)).toEqual([])

			// Seconde connexion : rien de neuf n'est créé, hormis sa propre session.
			const seconde = await ouvrirSession(compte.adresse)
			expect(seconde.statut).toBe(200)
			expect(await lireService(`workspace_members?select=role&user_id=eq.${compte.sub}`)).toHaveLength(1)
			expect(await sessionsDe(compte.sub)).toHaveLength(2)

			// La session LeLabs est close : la prolongation rend `session_expiree`, supprime la session
			// serveur et efface le cookie ; la poignée ne désigne plus rien.
			await fermerSessionsLeLabs(compte.sub)
			const expiree = await prolonger(premiere.poignee)
			expect(expiree).toMatchObject({ statut: 401, corps: { erreur: 'session_expiree' } })
			expect(expiree.setCookie).toContain('Max-Age=0')
			expect(await prolonger(premiere.poignee)).toMatchObject({ statut: 204, corps: null })

			// `verified` retiré chez LeLabs : la prolongation suivante refuse et ferme la session.
			const avantRetrait = await ouvrirSession(compte.adresse)
			expect(avantRetrait.statut).toBe(200)
			await retirerRoles(compte.sub, ['verified'])
			expect(await prolonger(avantRetrait.poignee)).toMatchObject({
				statut: 403,
				corps: { erreur: 'attente_verification', adresse: compte.adresse },
			})
			expect(await prolonger(avantRetrait.poignee)).toMatchObject({ statut: 204, corps: null })
			expect(await ouvrirSession(compte.adresse)).toMatchObject({ statut: 403, corps: { erreur: 'attente_verification' } })
			await attribuerRoles(compte.sub, ['verified'])

			// Appartenance retirée : la prolongation suivante refuse, et la base a supprimé la session.
			const avantSortie = await ouvrirSession(compte.adresse)
			expect(avantSortie.statut).toBe(200)
			await fetch(`${URL_API}/rest/v1/workspace_members?user_id=eq.${compte.sub}`, { method: 'DELETE', headers: enTetesService() })
			const sansEspace = await prolonger(avantSortie.poignee)
			expect(sansEspace).toMatchObject({ statut: 403, corps: { erreur: 'attente_espace', adresse: compte.adresse } })
			expect(sansEspace.setCookie).toContain('Max-Age=0')
			expect((await sessionsDe(compte.sub)).filter((l) => l.poignee_empreinte === empreinte(avantSortie.poignee ?? ''))).toEqual([])
			expect(await ouvrirSession(compte.adresse)).toMatchObject({ statut: 403, corps: { erreur: 'attente_espace' } })
		} finally {
			await fetch(`${URL_API}/rest/v1/workspace_invitations?email=eq.${compte.adresse}`, { method: 'DELETE', headers: enTetesService() })
			await fetch(`${URL_API}/rest/v1/profiles?id=eq.${compte.sub}`, { method: 'DELETE', headers: enTetesService() })
			await supprimerCompte(compte.sub)
		}
		// Le profil supprimé emporte ses sessions (cascade, §7.4).
		expect(await sessionsDe(compte.sub)).toEqual([])
	})
})

test.describe('La rotation des clés est suivie sans redémarrage (§5.2, point 4)', () => {
	test('une nouvelle clé prioritaire est suivie aussitôt, et l’ancienne désactivée ne gêne aucune session', async () => {
		const kid = (jeton: string) => JSON.parse(Buffer.from(jeton.split('.')[0] ?? '', 'base64url').toString()).kid as string
		const kidAvant = kid((await connexionPkce(ADMIN)).accessToken)
		const ouverteAvant = await ouvrirSession(ADMIN)
		expect(ouverteAvant.statut).toBe(200)
		const rotation = await ajouterCleRs256Prioritaire()
		try {
			// Le realm signe désormais avec la nouvelle clé ; l'échangeur, sans redémarrer, la lit.
			expect(kid((await connexionPkce(ADMIN)).accessToken)).not.toBe(kidAvant)
			const ouverteApres = await ouvrirSession(ADMIN)
			expect(ouverteApres.statut).toBe(200)
			expect((await prolonger(ouverteAvant.poignee)).statut, 'une session ouverte avant la rotation se prolonge').toBe(200)

			await rotation.desactiverAnciennes()
			expect((await ouvrirSession(ADMIN)).statut).toBe(200)
			expect((await prolonger(ouverteAvant.poignee)).statut).toBe(200)
			expect((await prolonger(ouverteApres.poignee)).statut).toBe(200)
		} finally {
			await rotation.restaurer()
		}
		expect((await ouvrirSession(ADMIN)).statut).toBe(200)
	})
})
