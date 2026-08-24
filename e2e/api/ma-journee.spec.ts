// @verifies CRM-061 (docs/BACKLOG.md) — tranche 1 : la lecture de « Ma journée », hors interface
// @verifies docs/SPEC-cards.md §17.4 (ce que la vue lit, en UNE requête), §17.5 (l'horizon),
//           §17.7 (les neuf lignes du contrat), §17.12 (ce que le seed doit démontrer)
// @verifies docs/SPEC-seed.md §13.5 (le contrat des échéances, mesurable en base)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves hors interface, jetons réels)
// @verifies docs/SPEC-cards.md §5 (« active »), §16.2 (« en sommeil » = non nulle ET future)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. L'écran construit une requête filtrée, bornée et
// ordonnée (§17.4). Cette construction est éprouvée par `webapp/src/lib/ma-journee.test.ts`
// **contre un client factice** : rien n'y garantit que la pile réelle réponde ce qu'on croit. Un
// `or=` mal interprété, une borne d'horizon refusée, un embarquement ambigu en `PGRST201` — le test
// unitaire resterait vert et l'écran mentirait.
//
// La lecture est donc rejouée **par la vraie route, avec les jetons réels des trois profils**, et
// confrontée au seed. Les bornes sont recalculées ici comme l'écran les calcule, et non recopiées :
// une preuve qui figerait une date serait fausse le lendemain.
//
// AUCUNE ÉCRITURE. Ce fichier ne pose ni ne retire aucune ligne — sauf la ligne *h*, qui déplace
// UNE échéance et la **restaure**, en relisant sa valeur d'origine avant de la toucher. Le seed
// sort intact, et une dernière lecture le constate plutôt que de le supposer.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/**
 * Les colonnes, l'horizon et le découpage réellement employés par la webapp, **importés depuis le
 * module qu'elle emploie**. Un test qui redéclarerait sa propre chaîne `select` ou son propre
 * horizon prouverait qu'une requête quelconque fonctionne, pas que **celle du produit** fonctionne
 * (décision 177, reprise ici).
 */
import {
	COLONNES_CARD_JOURNEE,
	bornesJournee,
	classerEcheance,
} from '../../webapp/src/lib/colonnes-ma-journee'
import { filtreExclusionSommeil } from '../../webapp/src/lib/filtre-sommeil'

const CARDS = '/rest/v1/cards'

/** Identifiants du seed — `docs/SPEC-seed.md` §2.3 et `docs/SPEC-cards.md` §9. */
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
/** « Cadrage data — Groupe Vallier » : la seule affaire ENDORMIE dont l'échéance tombe dans l'horizon. */
const CARD_ENDORMIE = '5eed0000-0000-4000-8000-0000000000ca'
/** « Contrat cadre 2025 », archivée, et « Saisie erronée », en corbeille (§9). */
const CARD_ARCHIVEE = '5eed0000-0000-4000-8000-0000000000c8'
const CARD_CORBEILLE = '5eed0000-0000-4000-8000-0000000000c9'
/** « Audit sécurité applicative » : l'affaire en retard de Camille Aubert (§13.5 ligne a). */
const CARD_EN_RETARD = '5eed0000-0000-4000-8000-0000000000c3'

type LigneJournee = {
	id: string
	title: string
	next_action: string | null
	next_action_at: string | null
	channels: { slug: string; name: string; tracks: { slug: string; name: string } | null } | null
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/**
 * L'adresse EXACTE que l'écran émet, composée ici avec les mêmes constantes que lui.
 *
 * `maintenant` est un paramètre : la ligne *h* du contrat doit pouvoir déplacer une échéance et
 * constater le changement des deux côtés de la borne sans dépendre de l'heure d'exécution.
 */
function adresseJournee(options: { responsable?: string; maintenant?: Date } = {}): string {
	const maintenant = options.maintenant ?? new Date()
	const bornes = bornesJournee(maintenant)
	const filtres = [
		`select=${encodeURIComponent(COLONNES_CARD_JOURNEE)}`,
		'next_action_at=not.is.null',
		`next_action_at=lt.${encodeURIComponent(bornes.horizon.toISOString())}`,
		'archived_at=is.null',
		'deleted_at=is.null',
		`or=(${encodeURIComponent(filtreExclusionSommeil(maintenant))})`,
		'order=next_action_at.asc,title.asc,id.asc',
	]
	if (options.responsable !== undefined) filtres.push(`owner_id=eq.${options.responsable}`)
	return `${CARDS}?${filtres.join('&')}`
}

// --- Les neuf lignes du contrat (§17.7) -------------------------------------------------------

test.describe('la lecture de « Ma journée » (§17.4, §17.7)', () => {
	test('a — l’administratrice lit les affaires de tous ses channels, et la pile rend les deux slugs', async ({
		request,
	}) => {
		const reponse = await request.get(adresseJournee(), {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneJournee[]
		expect(lignes.length).toBeGreaterThan(0)
		for (const ligne of lignes) {
			for (const colonne of ['id', 'title', 'next_action', 'next_action_at']) {
				expect(Object.hasOwn(ligne, colonne)).toBe(true)
			}
			// L'EMBARQUEMENT N'EST PAS AMBIGU : `cards` porte deux clés étrangères vers `channels`, et
			// c'est la raison pour laquelle le `select` la désigne nommément. Sans elle, PostgREST
			// rendrait `PGRST201` — mesuré à `CRM-086`, §4.4.
			expect(ligne.channels).not.toBeNull()
			expect(typeof ligne.channels?.slug).toBe('string')
			expect(typeof ligne.channels?.tracks?.slug).toBe('string')
		}
	})

	test('b — la lectrice voit STRICTEMENT moins, et aucune mention ne nomme ce qui manque', async ({
		request,
	}) => {
		const [duAdmin, deLaLectrice] = await Promise.all([
			request.get(adresseJournee(), { headers: enTetesAuthentifies(jetonAdmin) }),
			request.get(adresseJournee(), { headers: enTetesAuthentifies(jetonViewer) }),
		])
		expect(duAdmin.status()).toBe(200)
		expect(deLaLectrice.status()).toBe(200)
		const admin = (await duAdmin.json()) as LigneJournee[]
		const lectrice = (await deLaLectrice.json()) as LigneJournee[]
		// Le track `conseil-ia` lui est fermé : les affaires qu'il porte disparaissent, et rien ne
		// les nomme — c'est un état vide ordinaire, jamais un refus mis en scène (§17.1).
		expect(lectrice.length).toBeLessThan(admin.length)
		const idsLectrice = new Set(lectrice.map((ligne) => ligne.id))
		expect(idsLectrice.has(CARD_EN_RETARD)).toBe(false)
	})

	test('c — l’anonyme reçoit `200` et `[]`, jamais une erreur — preuve n° 11', async ({ request }) => {
		const reponse = await request.get(adresseJournee(), { headers: enTetesAnonymes() })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('d — le filtre par responsable RETRANCHE, il n’ajoute jamais', async ({ request }) => {
		const [tous, mien] = await Promise.all([
			request.get(adresseJournee(), { headers: enTetesAuthentifies(jetonAdmin) }),
			request.get(adresseJournee({ responsable: CAMILLE }), {
				headers: enTetesAuthentifies(jetonAdmin),
			}),
		])
		const lignesTous = (await tous.json()) as LigneJournee[]
		const lignesMien = (await mien.json()) as LigneJournee[]
		expect(lignesMien.length).toBeLessThan(lignesTous.length)
		const idsTous = new Set(lignesTous.map((ligne) => ligne.id))
		for (const ligne of lignesMien) expect(idsTous.has(ligne.id)).toBe(true)
	})

	test('e — deux profils ne voient pas la même journée', async ({ request }) => {
		const [deCamille, deDriss] = await Promise.all([
			request.get(adresseJournee({ responsable: CAMILLE }), {
				headers: enTetesAuthentifies(jetonAdmin),
			}),
			request.get(adresseJournee({ responsable: DRISS }), {
				headers: enTetesAuthentifies(jetonBizdev),
			}),
		])
		const camille = ((await deCamille.json()) as LigneJournee[]).map((ligne) => ligne.id)
		const driss = ((await deDriss.json()) as LigneJournee[]).map((ligne) => ligne.id)
		expect(camille.length).toBeGreaterThan(0)
		expect(driss.length).toBeGreaterThan(0)
		// Aucune affaire n'a deux responsables : les deux journées sont disjointes.
		expect(camille.filter((id) => driss.includes(id))).toEqual([])
	})

	test('f — l’affaire ENDORMIE est absente, bien que son échéance tombe dans l’horizon', async ({
		request,
	}) => {
		const maintenant = new Date()
		const bornes = bornesJournee(maintenant)
		// La contre-épreuve d'abord : sans l'exclusion du sommeil, la même affaire EST rendue. Sans
		// elle, son absence ne prouverait rien — elle pourrait n'être qu'une échéance hors horizon.
		const sansExclusion = await request.get(
			`${CARDS}?select=id,next_action_at,snoozed_until&id=eq.${CARD_ENDORMIE}` +
				`&next_action_at=lt.${encodeURIComponent(bornes.horizon.toISOString())}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const brute = (await sansExclusion.json()) as { snoozed_until: string | null }[]
		expect(brute).toHaveLength(1)
		expect(brute[0]?.snoozed_until).not.toBeNull()
		expect(new Date(brute[0]?.snoozed_until ?? 0).getTime()).toBeGreaterThan(maintenant.getTime())

		const reponse = await request.get(adresseJournee({ maintenant }), {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		const lignes = (await reponse.json()) as LigneJournee[]
		expect(lignes.map((ligne) => ligne.id)).not.toContain(CARD_ENDORMIE)
	})

	test('g — l’affaire archivée et celle en corbeille sont absentes (§5)', async ({ request }) => {
		// CETTE ASSERTION ÉTAIT TAUTOLOGIQUE, ET C'EST MESURÉ le 2026-08-24 : les deux affaires
		// rangées du seed — `…0c8` archivée, `…0c9` en corbeille — portent `next_action_at` À NULL.
		// Le filtre `next_action_at=not.is.null` les écartait donc à lui seul, et les deux `expect`
		// ci-dessous restaient verts même si `archived_at=is.null` et `deleted_at=is.null`
		// disparaissaient de la requête. Une preuve qui tient sans la règle qu'elle prétend éprouver
		// ne prouve rien (`docs/SPEC-test-harness.md` §7.2, mécanisme de la décision 51).
		//
		// La preuve est donc RETOURNÉE, jamais retirée : les deux affaires reçoivent une échéance
		// DANS l'horizon — elles appartiennent l'une et l'autre à Camille Aubert et au channel
		// `grands-comptes`, qu'elle lit —, ce qui en fait de véritables candidates, et l'absence
		// constatée devient celle des deux filtres d'exclusion. La valeur d'origine est relue avant
		// d'être touchée et rendue dans un `finally`, comme à la ligne *h* (décision 501).
		const origines = new Map<string, string | null>()
		for (const identifiant of [CARD_ARCHIVEE, CARD_CORBEILLE]) {
			const avant = await request.get(`${CARDS}?select=next_action_at&id=eq.${identifiant}`, {
				headers: enTetesService(),
			})
			const lignes = (await avant.json()) as { next_action_at: string | null }[]
			expect(lignes).toHaveLength(1)
			origines.set(identifiant, lignes[0]?.next_action_at ?? null)
		}

		// Demain matin : dans l'horizon des sept jours, quel que soit le jour d'exécution.
		const echeance = new Date(bornesJournee(new Date()).debutLendemain.getTime())
		echeance.setHours(9, 0, 0, 0)

		try {
			for (const identifiant of [CARD_ARCHIVEE, CARD_CORBEILLE]) {
				const posee = await request.patch(`${CARDS}?id=eq.${identifiant}`, {
					headers: { ...enTetesService(), Prefer: 'return=representation' },
					data: { next_action_at: echeance.toISOString() },
				})
				expect(posee.status()).toBe(200)
			}

			const reponse = await request.get(adresseJournee(), {
				headers: enTetesAuthentifies(jetonAdmin),
			})
			const ids = ((await reponse.json()) as LigneJournee[]).map((ligne) => ligne.id)
			expect(ids).not.toContain(CARD_ARCHIVEE)
			expect(ids).not.toContain(CARD_CORBEILLE)

			// LA CONTRE-ÉPREUVE, dans le même souffle : la MÊME échéance rend une affaire ACTIVE
			// présente. Sans elle, un `select` qui ne rendrait plus rien du tout ferait passer les
			// deux assertions ci-dessus pour une preuve d'exclusion.
			expect(ids.length).toBeGreaterThan(0)
		} finally {
			for (const identifiant of [CARD_ARCHIVEE, CARD_CORBEILLE]) {
				await request.patch(`${CARDS}?id=eq.${identifiant}`, {
					headers: { ...enTetesService(), Prefer: 'return=representation' },
					data: { next_action_at: origines.get(identifiant) ?? null },
				})
			}
		}

		// LA RESTAURATION EST CONSTATÉE, PAS SUPPOSÉE (décision 501) : le §13.5 du seed rougirait au
		// passage suivant sans que rien ne dise pourquoi.
		for (const identifiant of [CARD_ARCHIVEE, CARD_CORBEILLE]) {
			const apres = await request.get(`${CARDS}?select=next_action_at&id=eq.${identifiant}`, {
				headers: enTetesService(),
			})
			const lignes = (await apres.json()) as { next_action_at: string | null }[]
			expect(lignes[0]?.next_action_at ?? null).toBe(origines.get(identifiant) ?? null)
		}
	})

	test('h — la borne d’horizon est éprouvée dans les DEUX sens, et le seed est RESTAURÉ', async ({
		request,
	}) => {
		// LA VALEUR D'ORIGINE EST RELUE AVANT D'ÊTRE TOUCHÉE, jamais supposée : c'est la leçon de la
		// décision 501, où une preuve remettait une card « à peu près » et effaçait un contrat du
		// seed. `select=*` la projette entière, et la restauration la rend à la microseconde.
		const avant = await request.get(
			`${CARDS}?select=next_action_at&id=eq.${CARD_EN_RETARD}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const origine = ((await avant.json()) as { next_action_at: string }[])[0]?.next_action_at
		expect(typeof origine).toBe('string')

		try {
			// Hors horizon : trente jours après le début du huitième jour.
			const bornes = bornesJournee(new Date())
			const loin = new Date(bornes.horizon.getTime())
			loin.setDate(loin.getDate() + 30)
			const deplacee = await request.patch(`${CARDS}?id=eq.${CARD_EN_RETARD}`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: { next_action_at: loin.toISOString() },
			})
			expect(deplacee.status()).toBe(200)

			const hors = await request.get(adresseJournee(), {
				headers: enTetesAuthentifies(jetonAdmin),
			})
			expect(((await hors.json()) as LigneJournee[]).map((ligne) => ligne.id)).not.toContain(
				CARD_EN_RETARD,
			)

			// Ramenée dans l'horizon : demain.
			const proche = new Date(bornes.debutLendemain.getTime())
			proche.setHours(10, 0, 0, 0)
			await request.patch(`${CARDS}?id=eq.${CARD_EN_RETARD}`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: { next_action_at: proche.toISOString() },
			})
			const dedans = await request.get(adresseJournee(), {
				headers: enTetesAuthentifies(jetonAdmin),
			})
			expect(((await dedans.json()) as LigneJournee[]).map((ligne) => ligne.id)).toContain(
				CARD_EN_RETARD,
			)
		} finally {
			// LA RESTAURATION EST DANS UN `finally` : une exécution interrompue entre les deux
			// assertions laisserait sinon le seed hors de son contrat, et le §13.5 rougirait au
			// passage suivant sans que rien ne dise pourquoi.
			await request.patch(`${CARDS}?id=eq.${CARD_EN_RETARD}`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: { next_action_at: origine },
			})
		}

		const apres = await request.get(`${CARDS}?select=next_action_at&id=eq.${CARD_EN_RETARD}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(((await apres.json()) as { next_action_at: string }[])[0]?.next_action_at).toBe(origine)
	})

	test('i — l’ordre est croissant par échéance, et STABLE entre deux appels identiques', async ({
		request,
	}) => {
		const [un, deux] = await Promise.all([
			request.get(adresseJournee(), { headers: enTetesAuthentifies(jetonAdmin) }),
			request.get(adresseJournee(), { headers: enTetesAuthentifies(jetonAdmin) }),
		])
		const premier = ((await un.json()) as LigneJournee[]).map((ligne) => ligne.id)
		const second = ((await deux.json()) as LigneJournee[]).map((ligne) => ligne.id)
		expect(second).toEqual(premier)
		const echeances = ((await (
			await request.get(adresseJournee(), { headers: enTetesAuthentifies(jetonAdmin) })
		).json()) as LigneJournee[]).map((ligne) => new Date(ligne.next_action_at ?? 0).getTime())
		for (let rang = 1; rang < echeances.length; rang += 1) {
			expect(echeances[rang]).toBeGreaterThanOrEqual(echeances[rang - 1] ?? 0)
		}
	})
})

// --- Ce que le seed doit démontrer (§17.12, §13.5) --------------------------------------------

test.describe('le contrat du seed, mesuré par la vraie route (§13.5)', () => {
	test('les trois sections de l’administratrice sont peuplées, quel que soit le jour', async ({
		request,
	}) => {
		const maintenant = new Date()
		const bornes = bornesJournee(maintenant)
		const reponse = await request.get(
			adresseJournee({ responsable: CAMILLE, maintenant }),
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const lignes = (await reponse.json()) as LigneJournee[]
		const parSection = new Map<string, number>()
		for (const ligne of lignes) {
			const section = classerEcheance(new Date(ligne.next_action_at ?? 0), bornes)
			if (section !== null) parSection.set(section, (parSection.get(section) ?? 0) + 1)
		}
		// Lignes a, b et c du §13.5 : la section « Aujourd'hui » est celle qui donne son nom à
		// l'écran, et c'est celle qui n'avait AUCUNE donnée avant cette tranche.
		expect(parSection.get('retard') ?? 0).toBeGreaterThanOrEqual(1)
		expect(parSection.get('aujourdhui') ?? 0).toBeGreaterThanOrEqual(1)
		expect(parSection.get('avenir') ?? 0).toBeGreaterThanOrEqual(1)
	})

	test('la portée élargie rend STRICTEMENT plus que la portée personnelle — ligne d', async ({
		request,
	}) => {
		const [tous, mien] = await Promise.all([
			request.get(adresseJournee(), { headers: enTetesAuthentifies(jetonAdmin) }),
			request.get(adresseJournee({ responsable: CAMILLE }), {
				headers: enTetesAuthentifies(jetonAdmin),
			}),
		])
		expect(((await tous.json()) as LigneJournee[]).length).toBeGreaterThan(
			((await mien.json()) as LigneJournee[]).length,
		)
	})
})
