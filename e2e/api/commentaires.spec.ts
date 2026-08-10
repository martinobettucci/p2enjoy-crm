// @verifies CRM-043 (docs/BACKLOG.md) — commentaires d'une card, hors interface
// @verifies docs/SPEC-cards.md §13.4 (la pierre tombale), §13.5 (`edited_at`), §13.6
//           (autorisations), §13.7 (colonnes protégées), §13.8 (contrat d'API mesuré),
//           §13.9 (le temps réel, et son témoin), §13.14 (preuves attendues)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves hors interface, jetons réels), §3.7
//           (`app.can_write_card`)
// @verifies docs/SPEC-seed.md §2.14 (commentaires du seed)
// @verifies docs/INCONSISTENCY_REPORT.md INC-071 (le refus opposé au `viewer`), INC-072
//           (la modération), INC-026 (le refus divulgue la commande `GRANT`)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La suite pgTAP prouve les mêmes règles **dans la
// base**, avec `set local role` : elle ne traverse ni PostgREST, ni Kong, ni GoTrue. Un privilège
// de colonne rendu `403` par la pile, un `USING` qui rend `200` et un corps vide plutôt qu'une
// erreur, un trigger dont le refus arrive en `400` et non en `403` — rien de cela ne se voit
// depuis `psql`. Ce fichier rejoue le contrat du §13.8 **par la vraie route**, avec les jetons
// réels obtenus par la véritable connexion.
//
// IL ÉCRIT, ET IL NETTOIE. Contrairement à `liste-cards.spec.ts`, ce fichier crée des lignes : la
// moitié du contrat porte sur l'écriture. Toutes portent le préfixe `f00d…` et sont retirées en
// fin de fichier, y compris en cas d'échec. C'est la leçon d'INC-061, dont le coût a été mesuré
// trois fois : un jeu d'essai laissé en base fait tomber les preuves des autres unités. Aucune
// ligne du seed n'est modifiée — les scénarios d'édition et de suppression travaillent sur des
// commentaires que ce fichier a lui-même créés.

import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
	CLE_ANONYME,
	URL_API,
	enTetesAnonymes,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from './jetons'

const COMMENTAIRES = '/rest/v1/card_comments'

/** Identifiants du seed, mesurés en base le 2026-08-05 (docs/SPEC-seed.md §2.14). */
const CARD_GRANDS_COMPTES = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_MAINTENANCE = '5eed0000-0000-4000-8000-0000000000c5'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const ADMIN = '5eed0000-0000-4000-8000-000000000011'
const BIZDEV = '5eed0000-0000-4000-8000-000000000012'
const COMMENTAIRE_SEED_D1 = '5eed0000-0000-4000-8000-0000000000d1'
const COMMENTAIRE_SEED_D4 = '5eed0000-0000-4000-8000-0000000000d4'
const COMMENTAIRE_SEED_D5 = '5eed0000-0000-4000-8000-0000000000d5'

/**
 * Préfixe des lignes de ce fichier.
 *
 * Il n'emploie **pas** `5eed`, et ce n'est pas cosmétique : les assertions de conformité du seed de
 * `supabase/tests/0017_commentaires.test.sql` comptent les lignes dont l'identifiant commence par
 * `5eed`. Une ligne d'essai qui porterait ce préfixe ferait tomber la suite pgTAP — exactement le
 * mécanisme d'INC-061, en sens inverse.
 */
const PREFIXE_ESSAI = 'f00d0000-0000-4000-8000-0000000000'
const essai = (rang: string) => `${PREFIXE_ESSAI}${rang}`

/**
 * Les identifiants d'essai sont ÉNUMÉRÉS, et le nettoyage porte sur cette liste.
 *
 * MESURÉ le 2026-08-05 : `?id=like.f00d*` rend **404** et
 * `operator does not exist: uuid ~~ unknown` — PostgREST ne sait pas appliquer `like` à une
 * colonne `uuid`. Un nettoyage écrit ainsi échouerait EN SILENCE dans un `afterAll`, et laisserait
 * exactement le jeu d'essai qu'INC-061 a déjà fait payer trois fois. La liste explicite est ce qui
 * rend le nettoyage vérifiable.
 */
const RANGS_ESSAI = ['01', '02', '03', '04', '05', '10', '11', '12', '20', '21'] as const
const IDS_ESSAI = RANGS_ESSAI.map((rang) => essai(rang))

/** Les cinq commentaires du seed, énumérés pour la même raison. */
const IDS_SEED = ['d1', 'd2', 'd3', 'd4', 'd5'].map(
	(rang) => `5eed0000-0000-4000-8000-0000000000${rang}`,
)

/**
 * Première ligne d'une réponse PostgREST, ou un échec qui NOMME la cause.
 *
 * `noUncheckedIndexedAccess` interdit de lire `lignes[0]` sans le prouver. Une assertion
 * non nulle (`!`) ferait taire le compilateur sans rien vérifier ; ce garde-fou échoue en disant
 * ce qui manquait, ce qui est la différence entre une preuve et un silence.
 */
function premiere<T>(lignes: T[], quoi: string): T {
	const ligne = lignes[0]
	if (ligne === undefined) throw new Error(`${quoi} : la réponse ne porte aucune ligne.`)
	return ligne
}

let jetonAdmin = ''
let jetonBizdev = ''
let jetonViewer = ''

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test.afterAll(async ({ request }) => {
	// Par la clé de service : `DELETE` n'est exposé à personne d'autre, et c'est précisément ce que
	// le scénario « o » prouve.
	await request.delete(`${URL_API}${COMMENTAIRES}?id=in.(${IDS_ESSAI.join(',')})`, {
		headers: enTetesService(),
	})

	// Le nettoyage est CONSTATÉ, non supposé : c'est la contrepartie de la leçon d'INC-061.
	const reste = await request.get(
		`${URL_API}${COMMENTAIRES}?id=in.(${IDS_ESSAI.join(',')})&select=id`,
		{ headers: enTetesService() },
	)
	expect(await reste.json()).toEqual([])
})

test.describe('Lecture — §13.6', () => {
	test('a. le seed est là, et il porte ses cinq commentaires', async ({ request }) => {
		const reponse = await request.get(
			`${URL_API}${COMMENTAIRES}?id=in.(${IDS_SEED.join(',')})&select=id,card_id,author_id,body,edited_at,deleted_at&order=created_at`,
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as {
			id: string
			card_id: string
			author_id: string
			body: string
			edited_at: string | null
			deleted_at: string | null
		}[]
		expect(lignes).toHaveLength(5)
		expect(new Set(lignes.map((l) => l.card_id)).size).toBe(3)
		expect(new Set(lignes.map((l) => l.author_id)).size).toBe(3)
		expect(lignes.filter((l) => l.edited_at !== null)).toHaveLength(1)

		// La pierre tombale du seed, vue depuis l'API : la ligne est SERVIE, et son corps est vide.
		const supprime = lignes.find((l) => l.id === COMMENTAIRE_SEED_D4)
		expect(supprime?.deleted_at).not.toBeNull()
		expect(supprime?.body).toBe('')
	})

	test('e. le `viewer` LIT les commentaires d’une card qu’il voit', async ({ request }) => {
		const reponse = await request.get(
			`${URL_API}${COMMENTAIRES}?card_id=eq.${CARD_MAINTENANCE}&select=id`,
			{ headers: enTetesAuthentifies(jetonViewer) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as { id: string }[]
		// Le témoin du seed : sans lui, l'assertion serait verte sur une table vide (décision 50).
		expect(lignes.map((l) => l.id)).toContain(COMMENTAIRE_SEED_D5)
	})

	test('f. …et ne voit RIEN d’une card dont le track lui est fermé', async ({ request }) => {
		// La ligne est d'abord constatée PRÉSENTE avec la clé de service : sans ce constat, le `[]`
		// prouverait aussi bien la RLS qu'une table vide (décision 50).
		const avecService = await request.get(
			`${URL_API}${COMMENTAIRES}?card_id=eq.${CARD_GRANDS_COMPTES}&select=id`,
			{ headers: enTetesService() },
		)
		expect(((await avecService.json()) as unknown[]).length).toBeGreaterThan(0)

		const reponse = await request.get(
			`${URL_API}${COMMENTAIRES}?card_id=eq.${CARD_GRANDS_COMPTES}&select=id`,
			{ headers: enTetesAuthentifies(jetonViewer) },
		)
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('g. l’anonyme obtient `200` et `[]`, jamais une erreur de privilège', async ({ request }) => {
		const reponse = await request.get(`${URL_API}${COMMENTAIRES}?select=id`, {
			headers: enTetesAnonymes(),
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})
})

test.describe('Écriture — §13.6, INC-071', () => {
	test('a. l’administratrice écrit, et le workspace est DÉRIVÉ', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: {
				id: essai('01'),
				card_id: CARD_GRANDS_COMPTES,
				// Un workspace INVENTÉ, envoyé exprès : le trigger doit l'ignorer (§13.3).
				workspace_id: '00000000-0000-4000-8000-000000000999',
				body: 'Premier commentaire de la preuve d’API.',
			},
		})
		expect(reponse.status()).toBe(201)
		const ligne = premiere(
			(await reponse.json()) as {
				author_id: string
				workspace_id: string
				edited_at: string | null
				deleted_at: string | null
				mentions: string[]
			}[],
			'création du premier commentaire',
		)
		expect(ligne.author_id).toBe(ADMIN)
		expect(ligne.workspace_id).toBe(WORKSPACE)
		expect(ligne.edited_at).toBeNull()
		expect(ligne.deleted_at).toBeNull()
		expect(ligne.mentions).toEqual([])
	})

	test('b. …et ne peut pas signer du nom d’un autre', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { id: essai('02'), card_id: CARD_GRANDS_COMPTES, author_id: BIZDEV, body: 'Signé du nom d’un autre.' },
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('d. LE `viewer` EST REFUSÉ sur une card qu’il VOIT — la preuve exigée par la DoD', async ({
		request,
	}) => {
		// La card est d'abord constatée LISIBLE par lui : sans cela, le refus prouverait seulement
		// qu'il ne voit pas la card, et non que commenter exige le droit d'ÉCRITURE (INC-071).
		const lecture = await request.get(`${URL_API}/rest/v1/cards?id=eq.${CARD_MAINTENANCE}&select=id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(((await lecture.json()) as unknown[]).length).toBe(1)

		const reponse = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { id: essai('03'), card_id: CARD_MAINTENANCE, body: 'Un viewer qui commente.' },
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('h. l’anonyme n’écrit rien', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: enTetesAnonymes(),
			data: { id: essai('04'), card_id: CARD_GRANDS_COMPTES, body: 'Écrit sans jeton.' },
		})
		expect([401, 403]).toContain(reponse.status())
	})

	test('p. le `CHECK` refuse un corps vide et un corps de 10 001 caractères', async ({ request }) => {
		for (const corps of ['   ', 'x'.repeat(10001)]) {
			const reponse = await request.post(`${URL_API}${COMMENTAIRES}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { card_id: CARD_GRANDS_COMPTES, body: corps },
			})
			expect(reponse.status()).toBe(400)
			expect((await reponse.json()).code).toBe('23514')
		}

		// La borne haute est bien à 10 000, non à 9 999 : sans cette contre-épreuve, l'assertion
		// ci-dessus serait verte même si la limite était fixée n'importe où en deçà.
		const limite = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { id: essai('05'), card_id: CARD_GRANDS_COMPTES, body: 'x'.repeat(10000) },
		})
		expect(limite.status()).toBe(201)
	})
})

test.describe('Édition et suppression — §13.4, §13.5, INC-072', () => {
	test('i. l’auteur modifie le sien, et `edited_at` est posé par le trigger', async ({ request }) => {
		const creation = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { id: essai('10'), card_id: CARD_GRANDS_COMPTES, body: 'Avant correction.' },
		})
		expect(creation.status()).toBe(201)

		const reponse = await request.patch(`${URL_API}${COMMENTAIRES}?id=eq.${essai('10')}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			// `edited_at` est envoyé EXPRÈS : la colonne est fermée au client, et le trigger l'écrit
			// malgré tout (décision 197). Un envoi doit donc échouer, ce que le scénario `n` montre ;
			// ici il n'est pas envoyé, et la valeur apparaît quand même.
			data: { body: 'Après correction.' },
		})
		expect(reponse.status()).toBe(200)
		const ligne = premiere(
			(await reponse.json()) as { body: string; edited_at: string | null }[],
			'modification par l’auteur',
		)
		expect(ligne.body).toBe('Après correction.')
		expect(ligne.edited_at).not.toBeNull()
	})

	test('j. un tiers qui a pourtant le droit d’écrire ne modifie RIEN, et sans erreur', async ({
		request,
	}) => {
		// Driss écrit bien sur ce channel — la contre-épreuve est le scénario suivant.
		const reponse = await request.patch(`${URL_API}${COMMENTAIRES}?id=eq.${COMMENTAIRE_SEED_D1}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { body: 'Réécrit par quelqu’un d’autre.' },
		})
		// `200` et un corps VIDE : le `USING` a filtré. Ce n'est pas un succès silencieux — c'est un
		// `UPDATE … WHERE faux` —, et la preuve ne s'en contente pas : elle RELIT la ligne.
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		const relecture = await request.get(
			`${URL_API}${COMMENTAIRES}?id=eq.${COMMENTAIRE_SEED_D1}&select=body`,
			{ headers: enTetesService() },
		)
		const ligne = premiere((await relecture.json()) as { body: string }[], 'relecture du seed')
		expect(ligne.body).not.toBe('Réécrit par quelqu’un d’autre.')
	})

	test('j′. …et le même Driss écrit bien son PROPRE commentaire sur la même card', async ({
		request,
	}) => {
		const reponse = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { id: essai('11'), card_id: CARD_GRANDS_COMPTES, body: 'Driss commente son affaire.' },
		})
		// Sans cette contre-épreuve, le refus du scénario `j` prouverait peut-être seulement que
		// Driss n'écrit pas sur ce channel.
		expect(reponse.status()).toBe(201)
	})

	test('k. supprimer VIDE le corps, et la date envoyée est ignorée', async ({ request }) => {
		await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { id: essai('12'), card_id: CARD_GRANDS_COMPTES, body: 'À supprimer.' },
		})

		const reponse = await request.patch(`${URL_API}${COMMENTAIRES}?id=eq.${essai('12')}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { deleted_at: '2001-01-01T00:00:00Z' },
		})
		expect(reponse.status()).toBe(200)
		const ligne = premiere(
			(await reponse.json()) as { body: string; deleted_at: string }[],
			'suppression',
		)
		expect(ligne.body).toBe('')
		expect(new Date(ligne.deleted_at).getFullYear()).toBeGreaterThan(2020)
	})

	test('l. une pierre tombale refuse toute écriture, et m. toute résurrection', async ({
		request,
	}) => {
		for (const charge of [{ body: 'Je reviens dessus.' }, { deleted_at: null }]) {
			const reponse = await request.patch(`${URL_API}${COMMENTAIRES}?id=eq.${essai('12')}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: charge,
			})
			expect(reponse.status()).toBe(400)
			const corps = await reponse.json()
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('comment_deleted')
		}
	})

	test('n. les colonnes fermées rendent `403` — privilège, non politique', async ({ request }) => {
		for (const charge of [{ author_id: BIZDEV }, { created_at: '2020-01-01T00:00:00Z' }]) {
			const reponse = await request.patch(`${URL_API}${COMMENTAIRES}?id=eq.${essai('10')}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: charge,
			})
			expect(reponse.status()).toBe(403)
			// INC-026, reconduite : le refus divulgue la commande `GRANT` qui l'ouvrirait.
			expect((await reponse.text()).toLowerCase()).toContain('permission denied')
		}
	})

	test('o. `DELETE` est refusé à tous — aucun privilège, aucune politique', async ({ request }) => {
		for (const jeton of [jetonAdmin, jetonBizdev]) {
			const reponse = await request.delete(`${URL_API}${COMMENTAIRES}?id=eq.${essai('10')}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status()).toBe(403)
		}
		const anonyme = await request.delete(`${URL_API}${COMMENTAIRES}?id=eq.${essai('10')}`, {
			headers: enTetesAnonymes(),
		})
		expect([401, 403]).toContain(anonyme.status())
	})
})

// =================================================================================================
// Temps réel — §13.9, décision 195
// =================================================================================================
// LE SEUL REFUS DU PRODUIT QUI SE CONSTATE PAR UN SILENCE. Prouver que le `viewer` fermé ne reçoit
// rien n'a de valeur que si l'on établit d'abord qu'un abonné autorisé, lui, reçoit l'événement :
// sans ce témoin, le silence prouverait aussi bien la RLS qu'un temps réel en panne. C'est la
// décision 50, transposée au temps réel.

/** Ouvre un canal `postgres_changes` et rend les charges reçues. */
async function abonne(adresse: string, filtre?: string) {
	const client = createClient(URL_API, CLE_ANONYME)
	const { error } = await client.auth.signInWithPassword({
		email: adresse,
		password: 'SeedDev2026Local',
	})
	if (error) throw error

	const recues: { new: Record<string, unknown> }[] = []
	const canal = client
		.channel(`preuve-${adresse}-${filtre ?? 'tout'}`)
		.on(
			'postgres_changes',
			{ event: 'INSERT', schema: 'public', table: 'card_comments', ...(filtre ? { filter: filtre } : {}) },
			(charge) => recues.push(charge as unknown as { new: Record<string, unknown> }),
		)

	const statut = await new Promise<string>((resolve) => {
		canal.subscribe((etat) => {
			if (etat === 'SUBSCRIBED' || etat === 'CHANNEL_ERROR' || etat === 'TIMED_OUT') resolve(etat)
		})
	})

	return {
		statut,
		recues,
		fermer: async () => {
			await client.removeAllChannels()
			await client.auth.signOut()
		},
	}
}

test.describe('Temps réel — §13.9', () => {
	test.setTimeout(60_000)

	test('le témoin reçoit l’événement, et le `viewer` fermé ne reçoit RIEN', async ({ request }) => {
		const temoin = await abonne('admin@p2enjoy.test')
		const ferme = await abonne('viewer@p2enjoy.test')

		try {
			expect(temoin.statut).toBe('SUBSCRIBED')
			expect(ferme.statut).toBe('SUBSCRIBED')

			// ÉTABLISSEMENT OBSERVÉ, ET NON TEMPORISATION ARBITRAIRE (`CLAUDE.md` §18). La décision
			// 195 a mesuré qu'un événement émis juste après `SUBSCRIBED` peut être perdu, sans que la
			// fenêtre soit caractérisée. Attendre « assez longtemps » serait deviner ; cette boucle
			// n'attend pas une durée, elle attend un FAIT : que le canal se soit montré vivant en
			// rapportant un premier événement. C'est le même principe que la règle d'interface —
			// recharger à l'abonnement plutôt que se fier au flux.
			let vivant = false
			for (let tentative = 0; tentative < 5 && !vivant; tentative += 1) {
				const canari = await request.post(`${URL_API}${COMMENTAIRES}`, {
					headers: enTetesAuthentifies(jetonAdmin),
					data: { id: essai('21'), card_id: CARD_GRANDS_COMPTES, body: `Canari ${tentative}.` },
				})
				if (canari.status() === 201) {
					for (let attente = 0; attente < 20 && temoin.recues.length === 0; attente += 1) {
						await new Promise((suite) => setTimeout(suite, 250))
					}
					vivant = temoin.recues.length > 0
				}
				if (!vivant) {
					await request.delete(`${URL_API}${COMMENTAIRES}?id=eq.${essai('21')}`, {
						headers: enTetesService(),
					})
				}
			}
			expect(vivant, 'le canal du témoin ne s’est jamais montré vivant').toBe(true)

			// Le canal est établi : ce qui suit mesure le produit, non l'établissement du canal.
			temoin.recues.length = 0
			const creation = await request.post(`${URL_API}${COMMENTAIRES}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { id: essai('20'), card_id: CARD_GRANDS_COMPTES, body: 'Événement de preuve.' },
			})
			expect(creation.status()).toBe(201)

			await expect
				.poll(() => temoin.recues.length, {
					timeout: 15_000,
					message: 'aucun événement reçu par le témoin',
				})
				.toBeGreaterThan(0)

			expect(temoin.recues.at(-1)?.new['id']).toBe(essai('20'))

			// `realtime.apply_rls` évalue la politique `SELECT` pour chaque abonné : le `viewer`,
			// fermé sur le track de `grands-comptes`, n'a RIEN reçu — ni le canari, ni la preuve.
			// Le témoin ci-dessus est ce qui rend ce silence probant (décision 50).
			expect(ferme.recues).toHaveLength(0)
		} finally {
			await temoin.fermer()
			await ferme.fermer()
		}
	})
})
