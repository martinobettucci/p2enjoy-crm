// @verifies CRM-065 (docs/BACKLOG.md) — recherche globale, TRANCHE 1, hors interface
// @verifies docs/SPEC-recherche.md §6.1 (la signature et les sept colonnes), §6.2 (le terme
//           devient une requête), §6.3 (`stable` donc joignable en GET, et les privilèges),
//           §6.4 (titre et sous-titre), §6.5 (l'extrait), §6.6 (ordre et bornes),
//           §6.7 (les quinze lignes du contrat), §9 (preuves dues)
// @verifies docs/SPEC-permissions-rls.md §4.3 (règle de discrétion : le refus est une absence)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La suite pgTAP `0065_recherche_globale.test.sql`
// prouve les mêmes règles DANS la base, avec `set local role` : elle ne traverse ni Kong, ni
// PostgREST, ni GoTrue. Or la ligne *a* du §6.7 est un contrat d'API — un refus par le PRIVILÈGE,
// que PostgREST rend `401` — et un privilège d'exécution absent ne se voit pas depuis `psql`
// autrement que dans le catalogue. C'est ici, et ici seulement, qu'il se mesure comme un code HTTP.
//
// CE FICHIER N'ÉCRIT RIEN. La recherche est une lecture, et aucun de ses scénarios ne pose ni ne
// retire de ligne : le seed sort intact par construction, sans nettoyage à écrire — donc sans
// nettoyage qui puisse échouer. La borne de CINQUANTE lignes du §6.7 ligne *h* est la seule du
// contrat qui n'est pas rejouée ici : elle exige soixante lignes correspondantes, que le seed ne
// porte pas et que les poser reviendrait à écrire. Elle est tenue par l'assertion 26 de la suite
// pgTAP, qui les pose dans sa propre transaction et les emporte.

import { expect, test } from '@playwright/test'
import {
	URL_API,
	enTetesAnonymes,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from './jetons'

const RPC = '/rest/v1/rpc/recherche_globale'

/** Une ligne du résultat, telle que le §6.1 la décrit. */
type Ligne = {
	objet: string
	id: string
	workspace_id: string
	titre: string | null
	sous_titre: string | null
	extrait: string | null
	rang: number
}

/** Identifiants du seed, stables par contrat (`docs/SPEC-seed.md`). */
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_VITRINE = '5eed0000-0000-4000-8000-0000000000c1'

/**
 * Les trois termes qui portent l'asymétrie du seed — MESURÉE le 2026-08-27
 * (`docs/SPEC-recherche.md` §2 M6), et présente AVANT cette unité : aucune donnée n'est fabriquée.
 *
 * `vitrine`     — deux affaires de « Grands comptes », fermées à la lectrice ;
 * `gabarit`     — le commentaire `…0d1` de l'une d'elles, fermé à la lectrice ;
 * `candidature` — le message non classé, fermé à la lectrice ET au business developer.
 *
 * Trois familles différentes, trois politiques différentes. Une fonction qui aurait oublié le
 * filtre sur UNE famille passerait une preuve qui n'en éprouverait qu'une.
 */
const TERME_AFFAIRE = 'vitrine'
const TERME_COMMENTAIRE = 'gabarit'
const TERME_MESSAGE = 'candidature'

const chercher = async (
	request: import('@playwright/test').APIRequestContext,
	enTetes: Record<string, string>,
	terme: string | null,
	limite: number | null = 20,
) =>
	request.post(`${URL_API}${RPC}`, {
		headers: enTetes,
		data: { p_terme: terme, p_limite: limite },
	})

test.describe('CRM-065 tranche 1 — la recherche globale, hors interface', () => {
	let jetonAdmin = ''
	let jetonBizdev = ''
	let jetonViewer = ''

	test.beforeAll(async () => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')
	})

	/**
	 * LIGNE *a* — LE REFUS DE L'ANONYME EST UN REFUS PAR LE PRIVILÈGE, ET C'EST PLUS STRICT QU'UNE
	 * LISTE VIDE. `pg_default_acl` accorde `execute` à `anon` sur toute fonction neuve de `public`,
	 * et `revoke … from public` ne lui retire rien : sans la révocation NOMMÉE de la migration,
	 * cette assertion rendrait `200 []`. C'est la leçon payée par la migration `0053`, et c'est le
	 * seul endroit du dépôt où elle se mesure comme un code HTTP.
	 */
	test('a — l’appelant anonyme est refusé par le privilège, pas par une liste vide', async ({
		request,
	}) => {
		const reponse = await chercher(request, enTetesAnonymes(), 'audi')
		expect(reponse.status()).toBe(401)
		const corps = await reponse.json()
		expect(corps.code).toBe('42501')
	})

	/**
	 * LIGNES *b* et *m*, et la forme du §6.1. Le préfixe est ce qui rend une palette utilisable :
	 * « audi » doit trouver « Audit… » avant que l'utilisateur ait fini de taper.
	 */
	test('b et m — « audi » trouve les deux affaires par préfixe, et la ligne a sa forme', async ({
		request,
	}) => {
		const reponse = await chercher(request, enTetesAuthentifies(jetonAdmin), 'audi')
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Ligne[]

		expect(lignes.map((l) => l.titre).sort()).toEqual([
			'Audit de performance — portail Meunier',
			'Audit sécurité applicative',
		])

		for (const ligne of lignes) {
			expect(Object.keys(ligne).sort()).toEqual([
				'extrait',
				'id',
				'objet',
				'rang',
				'sous_titre',
				'titre',
				'workspace_id',
			])
			expect(ligne.objet).toBe('affaire')
			expect(ligne.workspace_id).toBe(WORKSPACE)
			expect(ligne.rang).toBeGreaterThan(0)
			// §6.5 — une affaire n'a pas d'extrait : `null`, et non une chaîne vide qui se
			// confondrait avec un corps sans correspondance.
			expect(ligne.extrait).toBeNull()
			// §6.4 — le sous-titre d'une affaire est le nom de son channel.
			expect(ligne.sous_titre).not.toBeNull()
		}
	})

	/**
	 * LIGNE *j*, et l'extrait du §6.5. Trois familles pour un même terme, classées entre elles :
	 * c'est ce qui distingue une recherche transverse du filtre local de chaque écran.
	 */
	test('j — « refonte » traverse trois familles, et l’extrait est replié sur une ligne', async ({
		request,
	}) => {
		const reponse = await chercher(request, enTetesAuthentifies(jetonAdmin), 'refonte')
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Ligne[]

		expect([...new Set(lignes.map((l) => l.objet))].sort()).toEqual([
			'affaire',
			'commentaire',
			'message',
		])

		// §6.6 — l'ordre est décroissant par rang, et il est STABLE : sans les deux critères
		// secondaires, deux rangs égaux s'ordonneraient au gré du plan d'exécution et la palette
		// changerait d'ordre d'une frappe à l'autre.
		const rangs = lignes.map((l) => l.rang)
		expect(rangs).toEqual([...rangs].sort((a, b) => b - a))

		for (const ligne of lignes.filter((l) => l.objet !== 'affaire')) {
			expect(ligne.extrait).not.toBeNull()
			// Ni retour à la ligne, ni double blanc : `ts_headline` rend un corps court EN ENTIER
			// (§2 M11), et une palette n'affiche qu'une ligne.
			expect(ligne.extrait).not.toMatch(/\s\s|\n/)
		}
	})

	/**
	 * LIGNE *c*, SUR LES TROIS FAMILLES ASYMÉTRIQUES. Chaque terme est mesuré des DEUX côtés dans
	 * le même scénario : ce que l'administratrice voit, ce que la lectrice ne voit pas. Une
	 * fonction qui rendrait zéro partout passerait la moitié droite de chacun.
	 */
	test('c — la lectrice ne trouve ni l’affaire, ni son commentaire, ni le message', async ({
		request,
	}) => {
		for (const [terme, attenduAdmin] of [
			[TERME_AFFAIRE, 2],
			[TERME_COMMENTAIRE, 1],
			[TERME_MESSAGE, 1],
		] as const) {
			const cote = await chercher(request, enTetesAuthentifies(jetonAdmin), terme)
			expect(cote.status()).toBe(200)
			expect(((await cote.json()) as Ligne[]).length).toBe(attenduAdmin)

			const refus = await chercher(request, enTetesAuthentifies(jetonViewer), terme)
			// ZÉRO LIGNE, JAMAIS UNE ERREUR : un objet qu'on ne peut pas lire ne se distingue en
			// rien d'un objet qui n'existe pas (`docs/SPEC-permissions-rls.md` §4.3).
			expect(refus.status()).toBe(200)
			expect(await refus.json()).toEqual([])
		}

		// ET LA FONCTION N'EST PAS MUETTE POUR AUTANT : le même jeton trouve les cinq lignes que la
		// lectrice a le droit de lire. Sans cette contre-épreuve, les trois refus ci-dessus
		// seraient également verts sur une fonction cassée.
		const contreEpreuve = await chercher(request, enTetesAuthentifies(jetonViewer), 'astreint')
		expect(((await contreEpreuve.json()) as Ligne[]).length).toBe(5)
	})

	/**
	 * LE FILTRAGE EST CELUI DE CHAQUE TABLE, JAMAIS UN FILTRAGE GLOBAL. Le business developer lit
	 * les deux affaires que la lectrice ne lit pas, et ne lit pas le message qu'elle ne lit pas
	 * non plus : trois profils, trois découpes différentes.
	 */
	test('c bis — le business developer lit les affaires, pas le message non classé', async ({
		request,
	}) => {
		const affaires = await chercher(request, enTetesAuthentifies(jetonBizdev), TERME_AFFAIRE)
		const lignes = (await affaires.json()) as Ligne[]
		expect(lignes.length).toBe(2)
		expect(lignes.map((l) => l.id)).toContain(CARD_VITRINE)

		const message = await chercher(request, enTetesAuthentifies(jetonBizdev), TERME_MESSAGE)
		expect(message.status()).toBe(200)
		expect(await message.json()).toEqual([])
	})

	/**
	 * LIGNES *k* et *l* — les accents, dans les DEUX SENS. Avec la configuration `french` seule,
	 * l'un des deux sens échouerait sur d'autres mots (`docs/SPEC-recherche.md` §2 M2) : c'est
	 * l'écart mesuré qui motive `app.francais_sans_accent`.
	 */
	test('k et l — « Élise Fabre » se trouve saisie sans accent comme avec', async ({ request }) => {
		for (const terme of ['elise', 'Élise', 'ELISE']) {
			const reponse = await chercher(request, enTetesAuthentifies(jetonAdmin), terme)
			expect(reponse.status()).toBe(200)
			const lignes = (await reponse.json()) as Ligne[]
			expect(lignes.length).toBe(1)
			expect(lignes[0]?.objet).toBe('contact')
			expect(lignes[0]?.titre).toBe('Élise Fabre')
		}
	})

	/**
	 * LIGNES *d*, *e*, *f*, *n* et *g* — tous les silences légitimes, dans un seul scénario, parce
	 * qu'ils partagent la même forme : `200` et une liste vide, jamais une erreur.
	 *
	 * `to_tsquery` LÈVE sur une syntaxe invalide, et une erreur serveur à chaque frappe d'une
	 * palette serait un défaut visible : c'est la découpe du §6.2 qui l'interdit, en ne laissant
	 * passer que des caractères alphanumériques.
	 */
	test('d, e, f, n et g — les silences légitimes rendent 200 et une liste vide', async ({
		request,
	}) => {
		const silences: [string | null, number | null][] = [
			[null, 20], // *d* — terme nul
			['', 20], // *e* — terme vide
			['   !!  ---  ', 20], // *e* — blancs et ponctuation seuls
			["&|!():'*", 20], // *e* — les métacaractères de `tsquery`, qui n'atteignent jamais `to_tsquery`
			['le la de', 20], // *f* — mots vides français seuls
			['audit zzzzz', 20], // *n* — conjonction : un seul des deux mots est présent
			['astreint', 0], // *g* — borne nulle
			['astreint', -3], // *g* — borne négative
			['astreint', null], // *g* — borne absente
		]

		for (const [terme, limite] of silences) {
			const reponse = await chercher(request, enTetesAuthentifies(jetonAdmin), terme, limite)
			expect(
				reponse.status(),
				`« ${terme ?? 'null'} » / limite ${limite ?? 'null'} doit rendre 200`,
			).toBe(200)
			expect(await reponse.json()).toEqual([])
		}
	})

	/**
	 * LA BORNE DEMANDÉE EST RESPECTÉE. Le plafond de cinquante, lui, est tenu par la suite pgTAP :
	 * l'éprouver ici demanderait d'écrire soixante lignes dans le seed.
	 */
	test('h — la borne demandée s’applique sous le plafond du serveur', async ({ request }) => {
		const complet = await chercher(request, enTetesAuthentifies(jetonAdmin), 'astreint', 20)
		expect(((await complet.json()) as Ligne[]).length).toBe(5)

		const borne = await chercher(request, enTetesAuthentifies(jetonAdmin), 'astreint', 2)
		expect(((await borne.json()) as Ligne[]).length).toBe(2)
	})

	/**
	 * LIGNE *o* — la clé de service traverse la RLS et voit le message que deux profils sur trois
	 * ne voient pas. La fonction ne pose AUCUN filtre qui lui soit propre : elle laisse décider les
	 * politiques, et c'est ce que cette assertion établit.
	 */
	test('o — la clé de service voit ce que la RLS cache aux profils', async ({ request }) => {
		const reponse = await chercher(request, enTetesService(), TERME_MESSAGE)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Ligne[]
		expect(lignes.length).toBe(1)
		expect(lignes[0]?.objet).toBe('message')
	})

	/**
	 * `STABLE` N'EST PAS UN DÉTAIL DE CATALOGUE (§6.3) : c'est ce qui rend la fonction joignable en
	 * `GET`, donc cacheable et journalisable comme une lecture. Une conversion en `volatile` la
	 * ferait basculer en `POST` seul, et cette assertion rougirait — ce qu'aucune preuve de
	 * comportement ne verrait.
	 */
	test('la fonction est joignable en GET, parce qu’elle est `stable`', async ({ request }) => {
		const reponse = await request.get(`${URL_API}${RPC}?p_terme=audi&p_limite=20`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Ligne[]
		expect(lignes.length).toBe(2)
		expect(lignes.every((l) => l.objet === 'affaire')).toBe(true)
	})
})
