// @verifies CRM-103 (docs/BACKLOG.md) — tranche T3 : les quatre fonctions d'administration du connecteur, aux VRAIS
//           jetons, en requête directe — `mcp_comptes_liste`, `mcp_compte`, `mcp_poser_droits`, `mcp_journal_liste`
// @verifies docs/SPEC-mcp.md §8.2 (contrat exact : garde en premier, fiche d'un profil, refus `profil_introuvable`,
//           `espace_introuvable`, `droit_invalide`, `issue_invalide`, remplacement, doublons confondus, ordre du §6.1,
//           remplacement à l'identique sans journal, avant et après au journal, curseur exclusif, borne 200), §8 (D9 : un
//           compte sans profil ne reçoit pas de matrice) ; docs/SPEC-plateforme.md §6 (garde des fonctions), §6.1
//           (dictionnaire des refus) ; CLAUDE.md §10 (requêtes directes, vrais identifiants)
//
// Aucune de ces preuves ne passe par l'interface. Les jetons sont ceux de vraies connexions PKCE au Keycloak de
// développement (`jetonDe`). La matrice de la lectrice est relevée avant le parcours et rendue EXACTEMENT, lignes
// comprises, par la clé de service dans un `finally` : le parcours ne laisse que ses lignes au journal de la plateforme.

import { expect, test } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'
import { DOMAINE } from './sso'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const SABINE = { adresse: `plateforme@${DOMAINE}`, sub: '5eed0000-0000-4000-8000-000000000018' }
const FARIDA = { adresse: `viewer@${DOMAINE}`, sub: '5eed0000-0000-4000-8000-000000000013' }
/** L'exploitante a un rôle `admin` LeLabs et un compte au connecteur, mais aucun profil dans le CRM (§8, D9). */
const EXPLOITANTE = '5eed0000-0000-4000-8000-000000000017'
const INCONNU = '00000000-0000-4000-8000-0000000000ff'

type Reponse = { statut: number; texte: string; corps: unknown }

/**
 * Le statut HTTP que PostgREST donne à `P0002` : la famille `P0` hors `P0001` lui vaut 500. Le contrat fixe le SQLSTATE et
 * le MESSAGE (docs/SPEC-plateforme.md §6.1), que la webapp classe (`classerRefus`) ; le statut est constaté, pas choisi —
 * les refus `espace_introuvable` de `CRM-101` rendent le même.
 */
const STATUT_P0002 = 500
type LigneDroit = { sub: string; workspace_id: string; famille: string; action: string; accorde_par: string | null; accorde_le: string }
type Fiche = {
	sub: string
	nom: string
	email: string | null
	avec_profil: boolean
	connecte: boolean
	superadmin: boolean
	espaces: { workspace_id: string; slug: string; nom: string; role: string | null; droits: [string, string][] }[]
}

async function appel(enTetes: Record<string, string>, fonction: string, corps: Record<string, unknown>): Promise<Reponse> {
	const reponse = await fetch(`${URL_API}/rest/v1/rpc/${fonction}`, {
		method: 'POST',
		headers: { ...enTetes, 'content-type': 'application/json' },
		body: JSON.stringify(corps),
	})
	const texte = await reponse.text()
	return { statut: reponse.status, texte, corps: texte === '' ? null : (JSON.parse(texte) as unknown) }
}

const rpc = async (jeton: string, fonction: string, corps: Record<string, unknown> = {}) =>
	appel(enTetesAuthentifies(jeton), fonction, corps)

async function lireService<T>(chemin: string): Promise<T> {
	const reponse = await fetch(`${URL_API}/rest/v1/${chemin}`, { headers: enTetesService() })
	expect(reponse.status, `lecture ${chemin} par la clé de service`).toBe(200)
	return (await reponse.json()) as T
}

const droitsDeFarida = () =>
	lireService<LigneDroit[]>(`mcp_droits?sub=eq.${FARIDA.sub}&workspace_id=eq.${ESPACE}&select=*&order=famille,action`)

/** Rend la matrice relevée, lignes comprises (auteur et date), sans passer par la fonction qui journaliserait. */
async function rendreDroitsDeFarida(lignes: LigneDroit[]): Promise<void> {
	const retrait = await fetch(`${URL_API}/rest/v1/mcp_droits?sub=eq.${FARIDA.sub}&workspace_id=eq.${ESPACE}`, {
		method: 'DELETE',
		headers: enTetesService(),
	})
	expect(retrait.status, 'retrait de la matrice de la lectrice').toBe(204)
	if (lignes.length === 0) return
	const pose = await fetch(`${URL_API}/rest/v1/mcp_droits`, {
		method: 'POST',
		headers: { ...enTetesService(), 'content-type': 'application/json', prefer: 'return=minimal' },
		body: JSON.stringify(lignes),
	})
	expect(pose.status, 'restauration de la matrice de la lectrice').toBe(201)
}

/** Les quatre fonctions, avec des arguments plausibles : une fonction refusée ne laisse rien filtrer, ni rien écrire. */
const APPELS: readonly [string, Record<string, unknown>][] = [
	['mcp_comptes_liste', {}],
	['mcp_compte', { p_sub: FARIDA.sub }],
	['mcp_poser_droits', { p_sub: FARIDA.sub, p_ws: ESPACE, p_droits: [['affaires', 'supprimer']] }],
	['mcp_journal_liste', {}],
]

test.describe('La garde des quatre fonctions, en requête directe (docs/SPEC-mcp.md §8.2, CLAUDE.md §10)', () => {
	test('l’anonyme est refusé par le PRIVILÈGE, avant toute garde', async () => {
		for (const [fonction, corps] of APPELS) {
			const { statut, texte } = await appel({ apikey: CLE_ANONYME }, fonction, corps)
			expect(statut, fonction).toBe(401)
			// La garde rendrait AUSSI 401 à l'anonyme : seul le message distingue le privilège révoqué (mutation mesurée).
			expect(texte, fonction).toContain(`permission denied for function ${fonction}`)
		}
	})

	for (const [libelle, adresse] of [
		['la lectrice, sur sa propre fiche comme sur les autres', FARIDA.adresse],
		['l’administratrice d’espace : un pouvoir d’espace n’est pas un pouvoir de plateforme', `admin@${DOMAINE}`],
	] as const) {
		test(`${libelle} est refusée par la garde, sur les quatre fonctions, et rien n’est écrit`, async () => {
			const avant = await droitsDeFarida()
			const jeton = await jetonDe(adresse)
			for (const [fonction, corps] of APPELS) {
				const { statut, texte } = await rpc(jeton, fonction, corps)
				expect(statut, fonction).toBe(403)
				expect(texte, fonction).toContain('reserve_aux_superadministrateurs')
			}
			expect(await droitsDeFarida(), 'la matrice de la lectrice est intacte').toEqual(avant)
		})
	}
})

test.describe('Ce que lit une superadministratrice, aux vrais jetons (docs/SPEC-mcp.md §8.2)', () => {
	test('la liste des comptes : ceux venus au connecteur, leur profil, leur drapeau et leurs espaces ouverts', async () => {
		const jeton = await jetonDe(SABINE.adresse)
		const { statut, corps } = await rpc(jeton, 'mcp_comptes_liste')
		expect(statut).toBe(200)
		const comptes = corps as { sub: string; avec_profil: boolean; superadmin: boolean; espaces_ouverts: number; derniere_activite: string }[]
		const registre = await lireService<{ sub: string }[]>('mcp_comptes?select=sub')
		expect(comptes.map((c) => c.sub).sort(), 'exactement les comptes du registre').toEqual(registre.map((c) => c.sub).sort())
		const dates = comptes.map((c) => c.derniere_activite)
		expect(dates, 'la dernière activité d’abord').toEqual([...dates].sort().reverse())

		const droits = await lireService<{ sub: string; workspace_id: string }[]>('mcp_droits?select=sub,workspace_id')
		for (const compte of comptes) {
			const ouverts = new Set(droits.filter((d) => d.sub === compte.sub).map((d) => d.workspace_id)).size
			expect(compte.espaces_ouverts, `espaces ouverts de ${compte.sub}`).toBe(ouverts)
		}
		const exploitante = comptes.find((c) => c.sub === EXPLOITANTE)
		if (exploitante !== undefined) {
			// Son `admin` LeLabs ne se lit que dans un jeton : le drapeau rendu est celui EN BASE.
			expect(exploitante).toMatchObject({ avec_profil: false, superadmin: false })
		}
		const sabine = comptes.find((c) => c.sub === SABINE.sub)
		if (sabine !== undefined) expect(sabine).toMatchObject({ avec_profil: true, superadmin: true })

		const bornee = await rpc(jeton, 'mcp_comptes_liste', { p_limite: 1 })
		expect((bornee.corps as unknown[]).length).toBe(Math.min(1, comptes.length))
	})

	test('la fiche d’un utilisateur : tous les espaces, son rôle ou « pas membre », sa matrice, sa venue au connecteur', async () => {
		const jeton = await jetonDe(SABINE.adresse)
		const registre = await lireService<{ sub: string }[]>('mcp_comptes?select=sub')
		const venus = new Set(registre.map((c) => c.sub))

		const farida = (await rpc(jeton, 'mcp_compte', { p_sub: FARIDA.sub })).corps as Fiche
		expect(farida).toMatchObject({ sub: FARIDA.sub, nom: 'Farida Nowak', avec_profil: true, superadmin: false })
		expect(farida.connecte, 'venue au connecteur, d’après le registre').toBe(venus.has(FARIDA.sub))
		const espaces = await lireService<{ id: string }[]>('workspaces?select=id')
		expect(farida.espaces.map((e) => e.workspace_id).sort(), 'TOUS les espaces').toEqual(espaces.map((e) => e.id).sort())
		expect(farida.espaces.find((e) => e.workspace_id === ESPACE)).toMatchObject({ slug: 'p2enjoy', role: 'viewer' })

		// Superadministratrice en base, membre d'aucun espace : « pas membre » se lit `role: null` (§8.1).
		const sabine = (await rpc(jeton, 'mcp_compte', { p_sub: SABINE.sub })).corps as Fiche
		expect(sabine.superadmin).toBe(true)
		expect(sabine.espaces.every((e) => e.role === null)).toBe(true)

		const inconnu = await rpc(jeton, 'mcp_compte', { p_sub: INCONNU })
		expect(inconnu.statut, 'ni profil ni compte').toBe(STATUT_P0002)
		expect(inconnu.texte).toContain('profil_introuvable')

		if (venus.has(EXPLOITANTE)) {
			const exploitante = (await rpc(jeton, 'mcp_compte', { p_sub: EXPLOITANTE })).corps as Fiche
			expect(exploitante, 'venue sans profil : la fiche existe, sans matrice possible').toMatchObject({
				avec_profil: false,
				connecte: true,
				email: `exploitante@${DOMAINE}`,
			})
		}
	})
})

test.describe('Poser une matrice, aux vrais jetons (docs/SPEC-mcp.md §8.2)', () => {
	test('remplacer, dédoublonner, ordonner, journaliser l’avant et l’après — et ne rien journaliser à l’identique', async () => {
		const jeton = await jetonDe(SABINE.adresse)
		const relevee = await droitsDeFarida()
		try {
			const vide = await rpc(jeton, 'mcp_poser_droits', { p_sub: FARIDA.sub, p_ws: ESPACE, p_droits: [] })
			expect(vide.statut, 'une fonction `returns void` répond 204').toBe(204)

			const pose = await rpc(jeton, 'mcp_poser_droits', {
				p_sub: FARIDA.sub,
				p_ws: ESPACE,
				p_droits: [['contacts', 'consulter'], ['affaires', 'consulter'], ['affaires', 'consulter']],
			})
			expect(pose.statut).toBe(204)
			const fiche = (await rpc(jeton, 'mcp_compte', { p_sub: FARIDA.sub })).corps as Fiche
			expect(fiche.espaces.find((e) => e.workspace_id === ESPACE)?.droits, 'doublons confondus, ordre du §6.1').toEqual([
				['affaires', 'consulter'],
				['contacts', 'consulter'],
			])
			const lignes = await droitsDeFarida()
			expect(lignes.map((l) => l.accorde_par), 'l’auteur est la superadministratrice').toEqual([SABINE.sub, SABINE.sub])

			const journal = await rpc(jeton, 'plateforme_journal_liste', { p_limite: 1 })
			const [entree] = journal.corps as { id: number; geste: string; workspace_id: string; cible: Record<string, unknown> }[]
			expect(entree).toMatchObject({
				geste: 'mcp_droits_poses',
				workspace_id: ESPACE,
				cible: { nom: 'Farida Nowak', avant: [], apres: [['affaires', 'consulter'], ['contacts', 'consulter']] },
			})

			const identique = await rpc(jeton, 'mcp_poser_droits', {
				p_sub: FARIDA.sub,
				p_ws: ESPACE,
				p_droits: [['contacts', 'consulter'], ['affaires', 'consulter']],
			})
			expect(identique.statut).toBe(204)
			const ensuite = await rpc(jeton, 'plateforme_journal_liste', { p_limite: 1 })
			expect((ensuite.corps as { id: number }[])[0]?.id, 'à l’identique : aucune ligne de plus').toBe(entree?.id)
			expect((await droitsDeFarida()).map((l) => l.accorde_le), 'les cases inchangées gardent leur date').toEqual(
				lignes.map((l) => l.accorde_le),
			)
		} finally {
			await rendreDroitsDeFarida(relevee)
		}
		expect(await droitsDeFarida(), 'la matrice relevée est rendue').toEqual(relevee)
	})

	test('chaque refus du contrat, et aucun n’écrit', async () => {
		const jeton = await jetonDe(SABINE.adresse)
		const avant = await droitsDeFarida()
		const poser = (corps: Record<string, unknown>) =>
			rpc(jeton, 'mcp_poser_droits', { p_sub: FARIDA.sub, p_ws: ESPACE, p_droits: [], ...corps })

		for (const [cas, corps, statut, code] of [
			['un profil inconnu', { p_sub: INCONNU }, STATUT_P0002, 'profil_introuvable'],
			['un compte venu sans profil (D9)', { p_sub: EXPLOITANTE }, STATUT_P0002, 'profil_introuvable'],
			['un espace inconnu', { p_ws: INCONNU }, STATUT_P0002, 'espace_introuvable'],
			['une action hors du §6.1', { p_droits: [['affaires', 'purger']] }, 400, 'droit_invalide'],
			['une famille hors du §6.1', { p_droits: [['factures', 'consulter']] }, 400, 'droit_invalide'],
			['un couple incomplet', { p_droits: [['affaires']] }, 400, 'droit_invalide'],
			['un couple qui n’est pas de deux chaînes', { p_droits: [['affaires', 1]] }, 400, 'droit_invalide'],
			['autre chose qu’un tableau', { p_droits: { affaires: 'consulter' } }, 400, 'droit_invalide'],
		] as const) {
			const reponse = await poser(corps)
			expect(reponse.statut, cas).toBe(statut)
			expect(reponse.texte, cas).toContain(code)
		}
		expect(await droitsDeFarida(), 'aucun refus n’a écrit').toEqual(avant)
	})
})

test.describe('Le journal des appels, aux vrais jetons (docs/SPEC-mcp.md §8.2, §7.1)', () => {
	test('filtré par compte et par issue, le plus récent d’abord, curseur exclusif, borné à 200 ; une issue inconnue refusée', async () => {
		const jeton = await jetonDe(SABINE.adresse)
		type Appel = { id: number; sub: string; issue: string; outil: string }
		const tous = (await rpc(jeton, 'mcp_journal_liste', { p_limite: 200 })).corps as Appel[]
		const ids = tous.map((a) => a.id)
		expect(ids, 'le plus récent d’abord').toEqual([...ids].sort((a, b) => b - a))
		expect(tous.length).toBeLessThanOrEqual(200)
		const enBase = await lireService<{ id: number }[]>('mcp_journal?select=id&order=id.desc&limit=200')
		expect(ids, 'exactement le registre').toEqual(enBase.map((l) => l.id))

		const parDefaut = (await rpc(jeton, 'mcp_journal_liste')).corps as Appel[]
		expect(parDefaut.length).toBe(Math.min(50, tous.length))
		const borne = (await rpc(jeton, 'mcp_journal_liste', { p_limite: 1000 })).corps as Appel[]
		expect(borne.length).toBeLessThanOrEqual(200)

		const premiere = (await rpc(jeton, 'mcp_journal_liste', { p_limite: 2 })).corps as Appel[]
		if (premiere.length === 2) {
			const suite = (await rpc(jeton, 'mcp_journal_liste', { p_limite: 2, p_avant: premiere[1]?.id })).corps as Appel[]
			expect(suite.every((a) => a.id < (premiere[1]?.id ?? 0)), 'curseur exclusif').toBe(true)
			expect(suite.map((a) => a.id)).toEqual(ids.slice(2, 2 + suite.length))
		}

		const ok = (await rpc(jeton, 'mcp_journal_liste', { p_issue: 'ok', p_limite: 200 })).corps as Appel[]
		expect(ok.every((a) => a.issue === 'ok')).toBe(true)
		const deSabine = (await rpc(jeton, 'mcp_journal_liste', { p_sub: SABINE.sub, p_limite: 200 })).corps as Appel[]
		expect(deSabine.every((a) => a.sub === SABINE.sub)).toBe(true)

		const inconnue = await rpc(jeton, 'mcp_journal_liste', { p_issue: 'succes' })
		expect(inconnue.statut, 'une liste vide se lirait « aucun appel »').toBe(400)
		expect(inconnue.texte).toContain('issue_invalide')
	})
})
