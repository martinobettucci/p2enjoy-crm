// @verifies CRM-101 (docs/BACKLOG.md) — tranche T2 : l'amorçage unique et l'admission révisée, par une VRAIE connexion
// @verifies docs/SPEC-plateforme.md §3 (amorçage unique par `CRM_SUPERADMINS_INITIAUX`), §4 (admis sans appartenance,
//           retrait effectif au renouvellement), §2 (le drapeau n'ouvre aucune donnée métier), §6 (garde des fonctions)
// @verifies docs/SPEC-session-sso.md §6.1 (condition 3 révisée) ; CLAUDE.md §10 (requêtes directes, vrais identifiants)
//
// Aucune de ces preuves ne passe par l'interface. Le code est émis par le Keycloak de développement au terme d'une vraie
// connexion PKCE, puis remis à l'échangeur par la vraie passerelle : c'est la fonction `session`, avec la liste que
// l'overlay de développement lui remet (`plateforme@<domaine du seed>`), qui amorce.
//
// ÉTAT : la suite relève les lignes de `superadmins` qu'elle trouve, vide la table pour rejouer un PREMIER amorçage,
// puis rend EXACTEMENT ce qu'elle a trouvé dans un `finally`, par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService } from './jetons'
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
