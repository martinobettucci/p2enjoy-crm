// @verifies CRM-013 (docs/BACKLOG.md) — colonnes protégées, hors interface
// @verifies docs/SPEC-permissions-rls.md §4.4.4 (contrat d'API, lignes a à l), §4.3 (le
//           mécanisme), §4.4.2 (le chemin d'insertion est déjà sûr), §4.4.3 (la forme retenue),
//           §4.4.6 (preuves attendues), §7 (preuves de refus n° 4 et n° 11)
// @verifies docs/SPEC-cards.md §3.2 (forme de l'adresse), §3.3 (non-devinabilité), §3.4 (le
//           trigger génère, il ne protège pas)
// @verifies docs/SPEC-workflow-engine.md §5.5 (bloc `GRANT`, INC-050)
// @verifies docs/SPEC-seed.md §2.3 (comptes), docs/SPEC-cards.md §9 (cards du seed)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies docs/INCONSISTENCY_REPORT.md INC-026 (le refus divulgue le `GRANT`), INC-049,
//           INC-050 (**close par exécution**)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé — et
// pour cause : cette unité ne livre aucun écran (INC-021).
//
// Ils reprennent une à une les douze lignes du tableau de `docs/SPEC-permissions-rls.md` §4.4.4,
// écrit **avant** le code. Deux d'entre elles y étaient signalées comme des **prédictions**, et
// une troisième a été **révisée par la mesure** — voir la ligne g.
//
// DEUX PIÈGES, hérités des unités précédentes et actifs ici :
//
//   * un refus de PRIVILÈGE lève une erreur (`403`, `42501`), là où un refus de POLITIQUE rend
//     `200` ou `204` sans rien modifier. Les deux formes coexistent dans ce fichier, et chaque
//     refus relit la ligne pour la constater **inchangée** — un test qui n'observerait que le
//     code HTTP ne distinguerait pas les deux ;
//   * chaque scénario qui écrit **nettoie derrière lui**. Le seed est un contrat maintenu ; le
//     laisser modifié ferait échouer les suivants pour la mauvaise raison.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'

/** Channels et étapes du seed (`docs/SPEC-seed.md` §2.6, §2.8). */
// `grands-comptes` appartient au track `conseil-ia`, que le seed FERME au viewer par un droit fin
// `none` (`docs/SPEC-seed.md` §2.11) : c'est le seul channel qui porte à la fois des cards et une
// restriction opposable, donc le seul où la preuve n° 4 se mesure.
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'

/** Cards du seed (`docs/SPEC-cards.md` §9). */
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1' // grands-comptes, relance
const CARD_C4 = '5eed0000-0000-4000-8000-0000000000c4' // refonte — visible du viewer

const CARDS = '/rest/v1/cards'

/** Forme imposée à l'adresse par `docs/SPEC-cards.md` §3.2 — alphabet de Crockford, 8 signes. */
const FORME_ADRESSE = /^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$/

type Card = { id: string; title: string; email_local_part: string }
type Erreur = { code: string; message: string; hint: string | null }

/**
 * Première ligne d'une réponse PostgREST.
 *
 * Le dépôt compile avec `noUncheckedIndexedAccess` : `lignes[0]` est `T | undefined`. Plutôt que
 * de disperser des `?.` qui transformeraient une réponse vide en assertion silencieusement verte,
 * l'absence de ligne **échoue en nommant son contexte**.
 */
function premiere<T>(lignes: T[], contexte: string): T {
	const ligne = lignes[0]
	if (ligne === undefined) {
		throw new Error(`${contexte} : la réponse ne porte aucune ligne.`)
	}
	return ligne
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

/** Adresse réellement seedée de `CARD_C1`, relevée avant tout scénario et restituée après. */
let adresseC1: string

test.beforeAll(async ({ playwright }) => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')

	// L'état de départ est constaté avec la clé de service, qui ne sert **jamais** à prouver un
	// refus (décision 50) : elle sert ici à savoir ce qu'il faudra restituer.
	const service = await playwright.request.newContext({ extraHTTPHeaders: enTetesService() })
	try {
		const reponse = await service.get(`${CARDS}?id=eq.${CARD_C1}&select=email_local_part`)
		expect(reponse.status(), 'la card C1 du seed doit exister').toBe(200)
		const lignes = (await reponse.json()) as Card[]
		expect(lignes, 'le seed est-il appliqué ? Voir supabase/seed/apply-seed.sh').toHaveLength(1)
		adresseC1 = premiere(lignes, 'card C1 du seed').email_local_part
		expect(adresseC1, "l'adresse seedée a la forme générée").toMatch(FORME_ADRESSE)
	} finally {
		await service.dispose()
	}
})

test.describe('CRM-013 — `cards.email_local_part` n’est plus modifiable', () => {
	test('ligne a — `admin` ne peut pas réécrire l’adresse, et la ligne reste inchangée', async ({
		playwright,
	}) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonAdmin),
		})
		try {
			const reponse = await contexte.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { email_local_part: 'c-00000000' },
			})
			expect(reponse.status(), 'refus de PRIVILÈGE : une erreur, non un filtrage').toBe(403)

			const erreur = (await reponse.json()) as Erreur
			expect(erreur.code).toBe('42501')
			expect(erreur.message).toBe('permission denied for table cards')

			// INC-026, CINQUIÈME occurrence : PostgREST place dans son `hint` la commande `GRANT`
			// à exécuter. Le constater plutôt que l'ignorer, c'est refuser de laisser une
			// divulgation devenir invisible à force d'être habituelle.
			expect(erreur.hint, 'INC-026 : le refus divulgue la commande GRANT').toContain(
				'GRANT UPDATE ON public.cards',
			)

			const relecture = await contexte.get(`${CARDS}?id=eq.${CARD_C1}&select=email_local_part`)
			const lignes = (await relecture.json()) as Card[]
			expect(
				premiere(lignes, 'relecture de C1').email_local_part,
				"l'adresse seedée est intacte",
			).toBe(adresseC1)
		} finally {
			await contexte.dispose()
		}
	})

	test('ligne b — les douze colonnes ouvertes le restent : le `revoke` n’a pas été trop large', async ({
		playwright,
	}) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonAdmin),
		})
		try {
			const reponse = await contexte.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { description: 'sonde colonnes-protegees' },
			})
			// CONTRE-ÉPREUVE. Sans elle, tous les refus de ce fichier seraient verts même si
			// l'unité avait tout fermé — ce qui serait une régression, pas une protection.
			expect(reponse.status(), 'une colonne ouverte s’écrit toujours').toBe(204)
		} finally {
			// Restitution de l'état seedé : `description` de C1 vaut `null` dans le seed.
			const service = await playwright.request.newContext({ extraHTTPHeaders: enTetesService() })
			await service.patch(`${CARDS}?id=eq.${CARD_C1}`, { data: { description: null } })
			await service.dispose()
			await contexte.dispose()
		}
	})

	test('ligne c — le refus porte sur l’instruction ENTIÈRE, le titre compris', async ({
		playwright,
	}) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonAdmin),
		})
		try {
			const avant = await contexte.get(`${CARDS}?id=eq.${CARD_C1}&select=title`)
			const titreAvant = premiere((await avant.json()) as Card[], 'titre de C1 avant').title

			const reponse = await contexte.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { title: 'TITRE QUI NE DOIT PAS PASSER', email_local_part: 'c-00000000' },
			})
			expect(reponse.status()).toBe(403)

			// LE POINT DE CE SCÉNARIO. Une écriture mixte pourrait très bien n'appliquer que sa
			// partie permise : ce serait une fuite silencieuse. Elle ne le fait pas.
			const apres = await contexte.get(`${CARDS}?id=eq.${CARD_C1}&select=title,email_local_part`)
			const ligne = premiere((await apres.json()) as Card[], 'relecture de C1 après')
			expect(ligne.title, 'le titre n’a PAS été modifié non plus').toBe(titreAvant)
			expect(ligne.email_local_part).toBe(adresseC1)
		} finally {
			await contexte.dispose()
		}
	})

	test('ligne d — réécrire la valeur COURANTE est refusé aussi', async ({ playwright }) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonAdmin),
		})
		try {
			// PRÉDICTION DU §4.4.4, CONFIRMÉE PAR LA MESURE : le privilège se vérifie sur les
			// colonnes **nommées**, pas sur les valeurs changées. Sans ce scénario, on pourrait
			// croire à une garde de valeur — et écrire demain un contournement qui « ne change
			// rien » en croyant rester dans les clous.
			const reponse = await contexte.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { email_local_part: adresseC1 },
			})
			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as Erreur).code).toBe('42501')
		} finally {
			await contexte.dispose()
		}
	})

	test('ligne e — `business_developer` est refusé sur une card qu’il écrit', async ({
		playwright,
	}) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonBizdev),
		})
		try {
			// Le bizdev écrit sur `grands-comptes` : le refus ne vient donc PAS d'un défaut de
			// droit sur la card, mais bien du privilège de colonne. La contre-épreuve suit.
			const permis = await contexte.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { next_action: 'sonde colonnes-protegees' },
			})
			expect(permis.status(), 'le bizdev écrit bien sur cette card').toBe(204)

			const reponse = await contexte.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { email_local_part: 'c-00000000' },
			})
			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as Erreur).code).toBe('42501')
		} finally {
			const service = await playwright.request.newContext({ extraHTTPHeaders: enTetesService() })
			await service.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { next_action: 'Relancer la DSI après la démo' },
			})
			await service.dispose()
			await contexte.dispose()
		}
	})

	test('ligne f — `viewer` est refusé sur une card qu’il VOIT', async ({ playwright }) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonViewer),
		})
		try {
			// La card est choisie parmi celles que le viewer voit réellement : un refus sur une
			// card invisible ne prouverait rien du privilège de colonne, seulement de la RLS.
			const visible = await contexte.get(`${CARDS}?id=eq.${CARD_C4}&select=id`)
			expect(((await visible.json()) as Card[]), 'le viewer voit bien C4').toHaveLength(1)

			const reponse = await contexte.patch(`${CARDS}?id=eq.${CARD_C4}`, {
				data: { email_local_part: 'c-00000000' },
			})
			// Profil AUTHENTIFIÉ, donc `403` et non `401` — même distinction qu'au §2.8 de
			// `CRM-035`.
			expect(reponse.status()).toBe(403)
			expect(((await reponse.json()) as Erreur).code).toBe('42501')
		} finally {
			await contexte.dispose()
		}
	})

	test('ligne g — l’appelant anonyme est refusé, et le code est `401` et non `403`', async ({
		playwright,
	}) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAnonymes(),
		})
		try {
			const reponse = await contexte.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { email_local_part: 'c-00000000' },
			})
			// LIGNE RÉVISÉE PAR LA MESURE. Le §4.4.4 annonçait « refus » sans préciser le code ;
			// MESURÉ, PostgREST rend `401` à un appelant sans session et `403` à un profil
			// authentifié — la distinction du §2.8 de `CRM-035`. Le contrat a été corrigé, non le
			// test relâché.
			expect(reponse.status()).toBe(401)
			expect(((await reponse.json()) as Erreur).code).toBe('42501')
		} finally {
			await contexte.dispose()
		}
	})
})

test.describe('CRM-013 — ce que l’unité ne devait PAS changer', () => {
	test('ligne h — une adresse CHOISIE à l’insertion est ignorée, et l’insertion reste acceptée', async ({
		playwright,
	}) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonAdmin),
		})
		let sonde: string | undefined
		try {
			const reponse = await contexte.post(CARDS, {
				headers: { Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE_SEED,
					channel_id: CHANNEL_GRANDS_COMPTES,
					workflow_id: WORKFLOW_GLOBAL,
					current_step_id: ETAPE_RELANCE,
					title: 'tst-crm013-insertion',
					email_local_part: 'c-zzzzzzzz',
				},
			})
			// §4.4.2, décision 140 : le privilège `INSERT` reste **de table**, parce que le trigger
			// de `CRM-040` écrase déjà la valeur fournie. Fermer ce chemin refuserait une requête
			// que le produit accepte sans dommage.
			expect(reponse.status(), 'l’insertion reste ACCEPTÉE').toBe(201)
			const ligne = premiere((await reponse.json()) as Card[], 'card insérée')
			sonde = ligne.id
			expect(ligne.email_local_part, 'la valeur choisie ne survit pas').not.toBe('c-zzzzzzzz')
			expect(ligne.email_local_part, 'et la valeur retenue est bien générée').toMatch(
				FORME_ADRESSE,
			)
		} finally {
			if (sonde) {
				// `authenticated` n'a pas le privilège `DELETE` sur `cards` : le ménage passe par la
				// clé de service, ce qui est dit plutôt que masqué.
				const service = await playwright.request.newContext({
					extraHTTPHeaders: enTetesService(),
				})
				await service.delete(`${CARDS}?id=eq.${sonde}`)
				await service.dispose()
			}
			await contexte.dispose()
		}
	})

	test('ligne i — l’adresse se LIT toujours : c’est une identité, pas un secret', async ({
		playwright,
	}) => {
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonAdmin),
		})
		try {
			const reponse = await contexte.get(`${CARDS}?id=eq.${CARD_C1}&select=email_local_part`)
			expect(reponse.status()).toBe(200)
			expect(premiere((await reponse.json()) as Card[], 'lecture de C1').email_local_part).toBe(adresseC1)
		} finally {
			await contexte.dispose()
		}
	})

	test('ligne l — `service_role` conserve l’écriture : le chemin du seed reste ouvert', async ({
		playwright,
	}) => {
		const service = await playwright.request.newContext({ extraHTTPHeaders: enTetesService() })
		try {
			// La limite est NOMMÉE au §4.4.3 : un service qui se tromperait de colonne ne serait
			// arrêté par rien. Elle est prouvée ici plutôt que laissée à la prose.
			const reponse = await service.patch(`${CARDS}?id=eq.${CARD_C1}`, {
				data: { email_local_part: adresseC1 },
			})
			expect(reponse.status()).toBe(204)

			const relecture = await service.get(`${CARDS}?id=eq.${CARD_C1}&select=email_local_part`)
			expect(premiere((await relecture.json()) as Card[], 'relecture service_role').email_local_part).toBe(adresseC1)
		} finally {
			await service.dispose()
		}
	})
})

test.describe('CRM-013 — les refus de LECTURE restent zéro ligne, non une erreur', () => {
	test('ligne j — preuve n° 11 : l’anonyme obtient `200` et `[]` sur une table peuplée', async ({
		playwright,
	}) => {
		const service = await playwright.request.newContext({ extraHTTPHeaders: enTetesService() })
		const anonyme = await playwright.request.newContext({ extraHTTPHeaders: enTetesAnonymes() })
		try {
			// Sur une table vide, « l'API rend `[]` » serait vrai que la RLS refuse ou qu'elle
			// autorise tout (décision 50). L'état est donc d'abord constaté avec la clé de service.
			const peuplee = await service.get(`${CARDS}?select=id`)
			// RÉVISÉ PAR `CRM-046` : neuf cards devenues QUATORZE (docs/SPEC-seed.md §9.3), puis
			// QUINZE par la cinquième tranche de `CRM-077` (§10.4 bis). Le contrôle garde sa
			// fonction — établir que la table n'est PAS vide avant de conclure du `[]` rendu à
			// l'anonyme.
			expect(((await peuplee.json()) as Card[]).length, 'la table porte des lignes').toBe(15)

			const reponse = await anonyme.get(`${CARDS}?select=id`)
			expect(reponse.status(), 'un refus de LECTURE n’est pas une erreur').toBe(200)
			expect(await reponse.json()).toEqual([])
		} finally {
			await anonyme.dispose()
			await service.dispose()
		}
	})

	test('ligne k — preuve n° 4 : le `viewer` fermé sur le track ne voit aucune card', async ({
		playwright,
	}) => {
		const service = await playwright.request.newContext({ extraHTTPHeaders: enTetesService() })
		const contexte = await playwright.request.newContext({
			extraHTTPHeaders: enTetesAuthentifies(jetonViewer),
		})
		try {
			const existantes = await service.get(
				`${CARDS}?channel_id=eq.${CHANNEL_GRANDS_COMPTES}&select=id`,
			)
			const total = ((await existantes.json()) as Card[]).length
			expect(total, 'le channel doit porter des cards, sinon l’assertion suivante est vide')
				.toBeGreaterThan(0)

			const reponse = await contexte.get(`${CARDS}?channel_id=eq.${CHANNEL_GRANDS_COMPTES}&select=id`)
			expect(reponse.status()).toBe(200)
			expect(await reponse.json(), 'droit fin `none` sur le track : zéro ligne').toEqual([])
		} finally {
			await contexte.dispose()
			await service.dispose()
		}
	})
})
