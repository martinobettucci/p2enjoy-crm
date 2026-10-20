// @verifies CRM-101 (docs/BACKLOG.md) — tranche T2 : l'amorçage unique et l'admission révisée, par une VRAIE connexion
// @verifies docs/SPEC-plateforme.md §3 (amorçage unique par `CRM_SUPERADMINS_INITIAUX`), §4 (admis sans appartenance,
//           retrait effectif au renouvellement), §2 (le drapeau n'ouvre aucune donnée métier), §6 (garde des fonctions)
// @verifies docs/SPEC-session-sso.md §6.1 (condition 3 révisée) ; CLAUDE.md §10 (requêtes directes, vrais identifiants)
// @verifies CRM-101 (docs/BACKLOG.md) — tranche T4 : CHAQUE fonction de la plateforme refusée en requête directe à
//           l'anonyme, à la lectrice et à l'administratrice d'espace ; le parcours d'un superadministrateur, aux vrais
//           jetons, et la base rendue telle qu'il l'a trouvée (docs/SPEC-plateforme.md §6, §9)
//
// Aucune de ces preuves ne passe par l'interface. Le code est émis par le Keycloak de développement au terme d'une vraie
// connexion PKCE, puis remis à l'échangeur par la vraie passerelle : c'est la fonction `session`, avec la liste que
// l'overlay de développement lui remet (`plateforme@<domaine du seed>`), qui amorce.
//
// ÉTAT : la suite relève les lignes de `superadmins` qu'elle trouve, vide la table pour rejouer un PREMIER amorçage,
// puis rend EXACTEMENT ce qu'elle a trouvé dans un `finally`, par la clé de service.

import { expect, test } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'
import { DOMAINE, ouvrirSession, prolonger } from './sso'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

const SABINE = { adresse: `plateforme@${DOMAINE}`, sub: '5eed0000-0000-4000-8000-000000000018' }
const CAMILLE = { adresse: `admin@${DOMAINE}`, sub: '5eed0000-0000-4000-8000-000000000011' }

type LigneSuperadmin = { sub: string; accorde_par: string | null; accorde_le: string }

async function lireSuperadmins(): Promise<LigneSuperadmin[]> {
	const reponse = await fetch(`${URL_API}/rest/v1/superadmins?select=sub,accorde_par,accorde_le&order=sub`, {
		headers: enTetesService(),
	})
	expect(reponse.status, 'lecture de superadmins par la clé de service').toBe(200)
	return (await reponse.json()) as LigneSuperadmin[]
}

async function viderSuperadmins(): Promise<void> {
	const reponse = await fetch(`${URL_API}/rest/v1/superadmins?sub=not.is.null`, {
		method: 'DELETE',
		headers: enTetesService(),
	})
	expect(reponse.status, 'vidage de superadmins par la clé de service').toBe(204)
}

async function rendre(lignes: LigneSuperadmin[]): Promise<void> {
	await viderSuperadmins()
	if (lignes.length === 0) return
	const reponse = await fetch(`${URL_API}/rest/v1/superadmins`, {
		method: 'POST',
		headers: { ...enTetesService(), 'content-type': 'application/json', prefer: 'return=minimal' },
		body: JSON.stringify(lignes),
	})
	expect(reponse.status, 'restauration de superadmins').toBe(201)
}

async function rpc(jeton: string, fonction: string, corps: Record<string, unknown> = {}) {
	const reponse = await fetch(`${URL_API}/rest/v1/rpc/${fonction}`, {
		method: 'POST',
		headers: { ...enTetesAuthentifies(jeton), 'content-type': 'application/json' },
		body: JSON.stringify(corps),
	})
	const texte = await reponse.text()
	return { statut: reponse.status, corps: texte === '' ? null : (JSON.parse(texte) as unknown) }
}

async function jetonInterne(adresse: string): Promise<{ jeton: string; poignee: string | null }> {
	const { statut, corps, poignee } = await ouvrirSession(adresse)
	expect(statut, `ouverture pour ${adresse}`).toBe(200)
	return { jeton: corps?.jeton as string, poignee }
}

test.describe('L’amorçage unique du superadministrateur (docs/SPEC-plateforme.md §3, §4)', () => {
	test('une adresse non listée n’amorce rien ; l’adresse listée est amorcée et admise sans appartenance', async () => {
		const trouvees = await lireSuperadmins()
		try {
			await viderSuperadmins()

			// Camille n'est pas listée : admise par son appartenance, jamais amorcée.
			const camille = await jetonInterne(CAMILLE.adresse)
			expect((await rpc(camille.jeton, 'est_superadmin')).corps).toBe(false)
			const refus = await rpc(camille.jeton, 'plateforme_espaces')
			expect(refus.statut, 'la garde refuse une administratrice d’espace').toBe(403)
			expect(JSON.stringify(refus.corps)).toContain('reserve_aux_superadministrateurs')
			expect(await lireSuperadmins()).toEqual([])

			// Sabine est listée, et membre d'AUCUN espace : la connexion l'amorce ET l'admet.
			const sabine = await jetonInterne(SABINE.adresse)
			expect((await lireSuperadmins()).map((l) => [l.sub, l.accorde_par])).toEqual([[SABINE.sub, null]])
			expect((await rpc(sabine.jeton, 'est_superadmin')).corps).toBe(true)

			const espaces = await rpc(sabine.jeton, 'plateforme_espaces')
			expect(espaces.statut).toBe(200)
			expect((espaces.corps as Array<{ slug: string }>).map((e) => e.slug)).toContain('p2enjoy')

			const journal = await rpc(sabine.jeton, 'plateforme_journal_liste', { p_limite: 1 })
			expect((journal.corps as Array<{ geste: string }>)[0]?.geste).toBe('superadmin_amorce')

			// Le drapeau n'ouvre AUCUNE donnée métier (§2) : sans appartenance, la RLS lui rend des listes vides.
			const tracks = await fetch(`${URL_API}/rest/v1/tracks?select=id`, { headers: enTetesAuthentifies(sabine.jeton) })
			expect(tracks.status).toBe(200)
			expect(await tracks.json()).toEqual([])

			// Une seconde connexion de Camille, après l'amorçage, n'y change rien.
			await jetonInterne(CAMILLE.adresse)
			expect((await lireSuperadmins()).map((l) => l.sub)).toEqual([SABINE.sub])
		} finally {
			await rendre(trouvees)
		}
	})

	test('le drapeau retiré, la prolongation suivante ferme la session de qui n’a pas d’autre motif d’entrer', async () => {
		const trouvees = await lireSuperadmins()
		try {
			await viderSuperadmins()
			const sabine = await jetonInterne(SABINE.adresse)
			expect(sabine.poignee).not.toBeNull()

			const encore = await prolonger(sabine.poignee)
			expect(encore.statut, 'tant que le drapeau tient, la prolongation rend une session').toBe(200)

			// La liste ne réamorce pas : la table n'est vidée que pour retirer Sabine, puis une autre ligne la remplit,
			// comme le ferait un second superadministrateur qui lui retire le drapeau.
			await rendre([{ sub: CAMILLE.sub, accorde_par: null, accorde_le: new Date().toISOString() }])
			const fermee = await prolonger(sabine.poignee)
			expect(fermee.statut).toBe(403)
			expect(fermee.corps?.erreur).toBe('attente_espace')
		} finally {
			await rendre(trouvees)
		}
	})
})

/**
 * Les quatorze fonctions, appelées avec des arguments plausibles : une fonction refusée ne doit rien laisser filtrer,
 * quel que soit l'argument (docs/SPEC-plateforme.md §6, la garde EN PREMIER).
 */
const APPELS: readonly [string, Record<string, unknown>][] = [
	['plateforme_espaces', {}],
	['plateforme_creer_espace', { p_nom: 'Garde', p_slug: 'garde-api' }],
	['plateforme_modifier_espace', { p_id: '5eed0000-0000-4000-8000-000000000001', p_nom: 'Garde', p_domaine_entrant: null }],
	['plateforme_supprimer_espace', { p_id: '5eed0000-0000-4000-8000-000000000001', p_slug_confirme: 'p2enjoy' }],
	['plateforme_membres', { p_ws: '5eed0000-0000-4000-8000-000000000001' }],
	['plateforme_poser_membre', { p_ws: '5eed0000-0000-4000-8000-000000000001', p_user: '5eed0000-0000-4000-8000-000000000013', p_role: 'admin' }],
	['plateforme_retirer_membre', { p_ws: '5eed0000-0000-4000-8000-000000000001', p_user: '5eed0000-0000-4000-8000-000000000013' }],
	['plateforme_attentes', { p_ws: '5eed0000-0000-4000-8000-000000000001' }],
	['plateforme_inviter', { p_ws: '5eed0000-0000-4000-8000-000000000001', p_email: 'garde@p2enjoy.test', p_role: 'admin' }],
	['plateforme_retirer_attente', { p_ws: '5eed0000-0000-4000-8000-000000000001', p_email: 'attendu@p2enjoy.test' }],
	['plateforme_profils', {}],
	['plateforme_superadmins', {}],
	['plateforme_poser_superadmin', { p_user: '5eed0000-0000-4000-8000-000000000013', p_actif: true }],
	['plateforme_journal_liste', {}],
]

async function appelBrut(enTetes: Record<string, string>, fonction: string, corps: Record<string, unknown>) {
	const reponse = await fetch(`${URL_API}/rest/v1/rpc/${fonction}`, {
		method: 'POST',
		headers: { ...enTetes, 'content-type': 'application/json' },
		body: JSON.stringify(corps),
	})
	return { statut: reponse.status, texte: await reponse.text() }
}

test.describe('La garde de chaque fonction, en requête directe (docs/SPEC-plateforme.md §6, CLAUDE.md §10)', () => {
	test('l’anonyme est refusé par le PRIVILÈGE, avant toute garde', async () => {
		for (const [fonction, corps] of APPELS) {
			const { statut } = await appelBrut({ apikey: CLE_ANONYME }, fonction, corps)
			expect(statut, fonction).toBe(401)
		}
	})

	for (const [libelle, adresse] of [
		['la lectrice', `viewer@${DOMAINE}`],
		['l’administratrice d’espace : un pouvoir d’espace n’est pas un pouvoir de plateforme', `admin@${DOMAINE}`],
	] as const) {
		test(`${libelle} est refusée par la garde, sur les quatorze fonctions`, async () => {
			const jeton = await jetonDe(adresse)
			for (const [fonction, corps] of APPELS) {
				const { statut, texte } = await appelBrut(enTetesAuthentifies(jeton), fonction, corps)
				expect(statut, fonction).toBe(403)
				expect(texte, fonction).toContain('reserve_aux_superadministrateurs')
			}
		})
	}

	test('rien n’a été écrit par ces refus : l’espace seedé, ses membres et ses attentes sont intacts', async () => {
		const espaces = await (await fetch(`${URL_API}/rest/v1/workspaces?select=slug,name`, { headers: enTetesService() })).json()
		expect(espaces).toEqual([{ slug: 'p2enjoy', name: expect.any(String) }])
		const attentes = await (
			await fetch(`${URL_API}/rest/v1/workspace_invitations?select=email&order=email`, { headers: enTetesService() })
		).json()
		expect(attentes).toEqual([{ email: `attendu@${DOMAINE}` }])
	})
})

test.describe('Le parcours d’une superadministratrice, aux vrais jetons (docs/SPEC-plateforme.md §6)', () => {
	test('créer un espace, y poser un administrateur, inscrire et retirer une attente, le supprimer — journal compris', async () => {
		const jeton = await jetonDe(SABINE.adresse)
		const DRISS = '5eed0000-0000-4000-8000-000000000012'
		let idEspace: string | null = null
		try {
			const creation = await rpc(jeton, 'plateforme_creer_espace', { p_nom: 'Preuve API', p_slug: 'preuve-api', p_domaine_entrant: 'Crm.Preuve.TEST' })
			expect(creation.statut).toBe(200)
			idEspace = creation.corps as string

			const doublon = await rpc(jeton, 'plateforme_creer_espace', { p_nom: 'Autre', p_slug: 'preuve-api' })
			expect([doublon.statut, JSON.stringify(doublon.corps)]).toEqual([409, expect.stringContaining('identifiant_pris')])

			const premierLecteur = await rpc(jeton, 'plateforme_poser_membre', { p_ws: idEspace, p_user: DRISS, p_role: 'viewer' })
			expect(JSON.stringify(premierLecteur.corps)).toContain('last_workspace_admin')
			expect((await rpc(jeton, 'plateforme_poser_membre', { p_ws: idEspace, p_user: DRISS, p_role: 'admin' })).statut, 'une fonction `returns void` répond 204').toBe(204)

			expect((await rpc(jeton, 'plateforme_inviter', { p_ws: idEspace, p_email: ' Lea@Preuve.TEST ', p_role: 'viewer' })).statut, 'une fonction `returns void` répond 204').toBe(204)
			const attentes = await rpc(jeton, 'plateforme_attentes', { p_ws: idEspace })
			expect((attentes.corps as Array<{ email: string }>).map((a) => a.email)).toEqual(['lea@preuve.test'])
			expect((await rpc(jeton, 'plateforme_retirer_attente', { p_ws: idEspace, p_email: 'lea@preuve.test' })).statut, 'une fonction `returns void` répond 204').toBe(204)

			// Driss, administrateur du nouvel espace, ne voit pas pour autant la plateforme.
			const jetonDriss = await jetonDe(`bizdev@${DOMAINE}`)
			expect((await rpc(jetonDriss, 'plateforme_espaces')).statut).toBe(403)

			const mauvaiseSaisie = await rpc(jeton, 'plateforme_supprimer_espace', { p_id: idEspace, p_slug_confirme: 'Preuve-API' })
			expect(JSON.stringify(mauvaiseSaisie.corps)).toContain('confirmation_incorrecte')
			expect((await rpc(jeton, 'plateforme_supprimer_espace', { p_id: idEspace, p_slug_confirme: 'preuve-api' })).statut, 'une fonction `returns void` répond 204').toBe(204)
			idEspace = null

			const journal = await rpc(jeton, 'plateforme_journal_liste', { p_limite: 6 })
			expect((journal.corps as Array<{ geste: string }>).map((e) => e.geste)).toEqual([
				'espace_supprime',
				'attente_retiree',
				'attente_inscrite',
				'membre_pose',
				'espace_cree',
				expect.any(String),
			])
		} finally {
			if (idEspace !== null) {
				await fetch(`${URL_API}/rest/v1/workspaces?id=eq.${idEspace}`, { method: 'DELETE', headers: enTetesService() })
			}
		}
	})
})
