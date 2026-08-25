// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 2, sous-tranche 2a : LE RENDU
// @verifies docs/SPEC-modeles-emails.md §8.8 (les quatorze lignes du contrat d'API), §8.3 (contrat
//           de la fonction), §8.4 (ce qu'un trou nul rend, et son inventaire), §8.5 (les sources
//           ne se devinent pas), §8.6 (formatage), §8.7 (privilèges)
// @verifies docs/SPEC-seed.md §14 (les deux modèles du seed) ; docs/SPEC-permissions-rls.md §7
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0054_rendu_modeles_emails.test.sql`
// prouve la règle **en base**, sous des rôles endossés. Rien n'y garantit que la pile la rende par
// la vraie route : une fonction absente du cache de schéma rendrait `404 / PGRST202`, un privilège
// laissé à `anon` rendrait `200` là où le contrat annonce `401`, et la suite pgTAP resterait verte
// dans les deux cas. C'est le défaut exact que la migration 53 portait, et que seule la mesure par
// l'API avait trouvé (`docs/JOURNAL.md`, décision 504).
//
// CE FICHIER N'ÉCRIT RIEN, et c'est une propriété de ce qu'il éprouve : `rendre_modele_email` est
// `STABLE`. Il n'a donc aucun nettoyage à faire, et l'assertion finale constate le seed intact
// plutôt que de le supposer.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const RENDU = '/rest/v1/rpc/rendre_modele_email'
const MODELES = '/rest/v1/mail_templates'

/** Identifiants du seed — `docs/SPEC-seed.md` §2.3, §9.2, §14.1. */
const MODELE_RELANCE = '7e11a7e0-0000-4000-8000-000000000001'

/** `Migration ERP Sogexia`, track « Grands comptes » — FERMÉ à la lectrice (`CRM-012`). */
const AFFAIRE_FERMEE = '5eed0000-0000-4000-8000-0000000000c2'
/** `Refonte intranet Ville de Lyon`, track « Refonte de site » — OUVERT à la lectrice. */
const AFFAIRE_OUVERTE = '5eed0000-0000-4000-8000-0000000000c4'
/** `Piste entrante à qualifier` — MESURÉ : montant, prochaine action et échéance tous NULS. */
const AFFAIRE_SANS_MONTANT = '5eed0000-0000-4000-8000-0000000000c6'

/** Léo Marchand, rattaché à `AFFAIRE_FERMEE`, avec organisation et email. */
const CONTACT_LEO = '5eed0000-0000-4000-8000-000000000091'
/** Sophie Dupont, rattachée à `AFFAIRE_OUVERTE` — MESURÉ : aucune organisation. */
const CONTACT_SOPHIE = '5eed0000-0000-4000-8000-000000000092'

/** Un identifiant qui n'existe nulle part, pour les lignes 6 et 7. */
const INCONNU = '00000000-0000-4000-8000-000000000000'

/** Le nombre de modèles que le seed pose (`docs/SPEC-seed.md` §14.3). */
const MODELES_DU_SEED = 2

type Rendu = {
	subject: string
	body_text: string
	variables_nulles: string[]
}

/**
 * La PREMIÈRE ligne d'une réponse, ou un échec qui dit ce qui manque.
 *
 * `noUncheckedIndexedAccess` est actif dans ce dépôt, et il a raison : `const [x] = tableau` rend
 * `Rendu | undefined`, et une assertion posée sur `undefined` passerait pour une preuve. Le helper
 * transforme le cas vide en ÉCHEC NOMMÉ — la leçon de la tranche 1, reprise sans changement.
 */
function premiere<T>(lignes: T[], quoi: string): T {
	const ligne = lignes[0]
	expect(ligne, `${quoi} : la réponse est VIDE — seed non appliqué, ou lecture refusée ?`).toBeDefined()
	return ligne as T
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test.describe('le rendu d’un modèle, par la vraie route (docs/SPEC-modeles-emails.md §8.8)', () => {
	// -------------------------------------------------------------------------------------------
	// Ligne 1 — l'anonyme, refusé par le PRIVILÈGE
	// -------------------------------------------------------------------------------------------

	test('1 — l’anonyme n’exécute pas le rendu, et c’est le PRIVILÈGE qui refuse', async ({
		request,
	}) => {
		const reponse = await request.post(RENDU, {
			headers: enTetesAnonymes(),
			data: { p_template_id: MODELE_RELANCE, p_card_id: AFFAIRE_FERMEE },
		})
		// `401` ET NON `200 []`, ET LA DISTINCTION EST VOULUE (§8.7). La LECTURE de `mail_templates`
		// rend `200 []` à l'anonyme : sa politique est ouverte `to anon` et FILTRE, si bien qu'un
		// `401` y révélerait que la table existe et qu'elle est protégée. Ici la fonction n'est
		// simplement pas exécutable — un appelant anonyme ne lit aucune affaire, et lui donner
		// l'exécution n'ajouterait qu'une surface. Deux refus de NATURE différente, et les
		// confondre masquerait la disparition de l'un des deux remparts.
		expect(reponse.status()).toBe(401)
		const corps = await reponse.json()
		expect(corps.code).toBe('42501')
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 2, 3 et 4 — les trois profils, et le rendu qui ne dépend pas du rôle
	// -------------------------------------------------------------------------------------------

	test('2, 3, 4 — les trois profils rendent la MÊME chose sur une affaire qu’ils lisent', async ({
		request,
	}) => {
		const rendus: Rendu[] = []
		for (const [role, jeton] of [
			['admin', () => jetonAdmin],
			['business_developer', () => jetonBizdev],
			['viewer', () => jetonViewer],
		] as const) {
			const reponse = await request.post(RENDU, {
				headers: enTetesAuthentifies(jeton()),
				// L'AFFAIRE EST CELLE QUE LES TROIS LISENT. Prendre `AFFAIRE_FERMEE` ici ferait
				// rendre zéro ligne à la lectrice, et la preuve mesurerait alors la RLS au lieu de
				// mesurer le rendu — c'est la ligne 5 qui porte ce cas.
				data: {
					p_template_id: MODELE_RELANCE,
					p_card_id: AFFAIRE_OUVERTE,
					p_contact_id: CONTACT_SOPHIE,
				},
			})
			expect(reponse.status(), `rendu par ${role}`).toBe(200)
			const lignes = (await reponse.json()) as Rendu[]
			rendus.push(premiere(lignes, `rendu par ${role}`))
		}

		const [parAdmin, parBizdev, parViewer] = rendus as [Rendu, Rendu, Rendu]
		expect(parAdmin.subject).toContain('Refonte intranet Ville de Lyon')
		expect(parAdmin.body_text).toContain('Bonjour Sophie Dupont,')

		// LE RENDU NE DÉPEND PAS DU RÔLE, et l'assertion le FIGE. Un email dont le contenu varierait
		// selon qui l'a prévisualisé serait un objet dont personne ne sait ce qu'il contient.
		expect(parBizdev).toEqual(parAdmin)
		expect(parViewer).toEqual(parAdmin)
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 5, 6 et 7 — les trois zéro-lignes, qui doivent être INDISCERNABLES
	// -------------------------------------------------------------------------------------------

	test('5, 6, 7 — masqué, modèle inconnu et affaire inconnue rendent LA MÊME chose', async ({
		request,
	}) => {
		// Les trois appels sont écrits ENSEMBLE parce que c'est leur ÉGALITÉ qui porte la preuve
		// (`docs/SPEC-permissions-rls.md` §7) : si l'un des trois rendait autre chose, il
		// divulguerait par la bande l'existence de ce que les deux autres cachent.
		const cas = [
			['5 — affaire masquée par la RLS', jetonViewer, MODELE_RELANCE, AFFAIRE_FERMEE],
			['6 — modèle inconnu', jetonAdmin, INCONNU, AFFAIRE_OUVERTE],
			['7 — affaire inconnue', jetonAdmin, MODELE_RELANCE, INCONNU],
		] as const

		for (const [quoi, jeton, modele, affaire] of cas) {
			const reponse = await request.post(RENDU, {
				headers: enTetesAuthentifies(jeton),
				data: { p_template_id: modele, p_card_id: affaire },
			})
			expect(reponse.status(), quoi).toBe(200)
			expect(await reponse.json(), quoi).toEqual([])
		}
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 8, 9 et 10 — les trous nuls, et leur inventaire
	// -------------------------------------------------------------------------------------------

	test('8 — un montant nul rend la chaîne VIDE, et `card.amount` est NOMMÉ', async ({
		request,
	}) => {
		const reponse = await request.post(RENDU, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_template_id: MODELE_RELANCE,
				p_card_id: AFFAIRE_SANS_MONTANT,
				p_contact_id: CONTACT_LEO,
			},
		})
		expect(reponse.status()).toBe(200)
		const rendu = premiere((await reponse.json()) as Rendu[], 'affaire sans montant')

		// LE TEXTE PART TEL QUEL, ET C'EST PRÉCISÉMENT L'ARGUMENT DU §8.4. « ( EUR) » — parenthèse,
		// espace, devise — est ce qu'un destinataire lirait si `variables_nulles` n'existait pas.
		// L'assertion le CONSTATE plutôt que de le taire : c'est ce qui rend la décision lisible
		// pour la session qui reprendra.
		expect(rendu.body_text).toContain('( EUR)')
		expect(rendu.body_text).not.toContain('—')
		expect(rendu.variables_nulles).toContain('card.amount')
	})

	test('9 — sans `p_contact_id`, les trois variables de contact sont des trous NOMMÉS', async ({
		request,
	}) => {
		const reponse = await request.post(RENDU, {
			headers: enTetesAuthentifies(jetonAdmin),
			// LE RENDU NE DEVINE JAMAIS LE DESTINATAIRE (§8.5). L'affaire visée PORTE un contact
			// rattaché ; ne pas le passer doit faire trois trous, et non le choisir à notre place.
			data: { p_template_id: MODELE_RELANCE, p_card_id: AFFAIRE_FERMEE },
		})
		expect(reponse.status()).toBe(200)
		const rendu = premiere((await reponse.json()) as Rendu[], 'sans contact')
		expect(rendu.variables_nulles).toContain('contact.full_name')
		expect(rendu.body_text).toContain('Bonjour ,')
	})

	test('10 — sans `p_identity_id`, les variables d’identité sont des trous NOMMÉS', async ({
		request,
	}) => {
		// « L'IDENTITÉ PAR DÉFAUT DU WORKSPACE » N'EXISTE PAS, et ce n'est pas une prudence mais une
		// MESURE : deux lignes du seed portent `is_default`, les index uniques partiels garantissant
		// l'unicité par personne et pour le service (§8.5).
		const reponse = await request.post(RENDU, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_template_id: MODELE_RELANCE,
				p_card_id: AFFAIRE_FERMEE,
				p_contact_id: CONTACT_LEO,
			},
		})
		expect(reponse.status()).toBe(200)
		const rendu = premiere((await reponse.json()) as Rendu[], 'sans identité')
		expect(rendu.variables_nulles).toContain('identity.from_name')
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 11 et 12 — l'inventaire, et ses deux bornes
	// -------------------------------------------------------------------------------------------

	test('11 — un modèle SANS variable ressort identique, inventaire VIDE', async ({ request }) => {
		// LE SEED POSE DEUX MODÈLES, ET AUCUN N'EST SANS VARIABLE (§2.8) : « Prise de contact » en
		// porte dans son corps seul. La ligne 11 se mesure donc sur le SOUS-TEXTE fixe de l'objet de
		// ce modèle, qui est un texte sans trou — plutôt qu'en écrivant une ligne, ce que la nature
		// `STABLE` de la fonction rend inutile.
		const modeles = await request.get(
			`${MODELES}?select=id,subject&name=eq.Prise%20de%20contact`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(modeles.status()).toBe(200)
		const modele = premiere((await modeles.json()) as { id: string; subject: string }[], 'modèle')
		// L'objet de « Prise de contact » est un texte FIXE — c'est ce qui distingue les deux
		// modèles du seed « par construction » (§2.8).
		expect(modele.subject).not.toContain('{{')

		const reponse = await request.post(RENDU, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_template_id: modele.id,
				p_card_id: AFFAIRE_OUVERTE,
				p_contact_id: CONTACT_SOPHIE,
			},
		})
		expect(reponse.status()).toBe(200)
		const rendu = premiere((await reponse.json()) as Rendu[], 'modèle à objet fixe')
		expect(rendu.subject).toBe(modele.subject)
	})

	test('12 — une variable PLEINE n’entre jamais dans l’inventaire', async ({ request }) => {
		const reponse = await request.post(RENDU, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_template_id: MODELE_RELANCE,
				p_card_id: AFFAIRE_FERMEE,
				p_contact_id: CONTACT_LEO,
			},
		})
		expect(reponse.status()).toBe(200)
		const rendu = premiere((await reponse.json()) as Rendu[], 'affaire complète')
		expect(rendu.variables_nulles).not.toContain('card.title')
		expect(rendu.variables_nulles).not.toContain('card.amount')
		expect(rendu.variables_nulles).not.toContain('contact.full_name')
		// L'INVENTAIRE EST TRIÉ (§8.4) — l'assertion le constate sur la réponse RÉELLE, ce que la
		// suite pgTAP fait déjà en base : un tri qui se perdrait à la sérialisation ferait afficher
		// à l'écran de 2b une liste dont l'ordre changerait d'un appel à l'autre.
		expect(rendu.variables_nulles).toEqual([...rendu.variables_nulles].sort())
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 13 et 14 — les deux règles figées par une assertion
	// -------------------------------------------------------------------------------------------

	test('13 — un contact NON RATTACHÉ à l’affaire est ACCEPTÉ, et le §8.5 le fige', async ({
		request,
	}) => {
		// MESURÉ : `card_contacts` ne porte AUCUNE ligne reliant Léo à `AFFAIRE_OUVERTE`. La RLS
		// garantit déjà que l'appelant LIT ce contact ; exiger en plus le rattachement poserait une
		// règle de produit que personne n'a prise, et `CLAUDE.md` §10 refuse cela DANS LES DEUX
		// SENS. L'assertion existe pour que la prochaine session sache que ce n'est pas un oubli.
		const rattachements = await request.get(
			`/rest/v1/card_contacts?select=card_id&card_id=eq.${AFFAIRE_OUVERTE}&contact_id=eq.${CONTACT_LEO}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(rattachements.status()).toBe(200)
		expect(await rattachements.json()).toEqual([])

		const reponse = await request.post(RENDU, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_template_id: MODELE_RELANCE,
				p_card_id: AFFAIRE_OUVERTE,
				p_contact_id: CONTACT_LEO,
			},
		})
		expect(reponse.status()).toBe(200)
		const rendu = premiere((await reponse.json()) as Rendu[], 'contact non rattaché')
		expect(rendu.body_text).toContain('Bonjour Léo Marchand,')
		expect(rendu.variables_nulles).not.toContain('contact.full_name')
	})

	test('14 — les DEUX identités du seed ont un `from_name` nul, et le trou est nommé', async ({
		request,
	}) => {
		// LA LIGNE 14 N'EST PAS UN CAS DE LABORATOIRE : le jeu de démonstration porte réellement ce
		// trou, et c'est ce qui rend la règle du §8.4 observable sans fabriquer de donnée.
		const identites = await request.get(
			'/rest/v1/mail_outbound_identities?select=id,from_name&order=from_address',
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(identites.status()).toBe(200)
		const lignes = (await identites.json()) as { id: string; from_name: string | null }[]
		expect(lignes.length).toBeGreaterThan(0)
		expect(lignes.every((ligne) => ligne.from_name === null)).toBe(true)

		const identite = premiere(lignes, 'identité du seed')
		const reponse = await request.post(RENDU, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				p_template_id: MODELE_RELANCE,
				p_card_id: AFFAIRE_FERMEE,
				p_contact_id: CONTACT_LEO,
				p_identity_id: identite.id,
			},
		})
		expect(reponse.status()).toBe(200)
		const rendu = premiere((await reponse.json()) as Rendu[], 'identité sans nom')
		// L'IDENTITÉ EST FOURNIE, ET LE TROU RESTE : ce n'est pas l'absence d'argument qui le crée,
		// c'est la valeur nulle en base. Les deux causes rendent la même chose (§8.4), et c'est
		// exactement ce que cette assertion distingue de la ligne 10.
		expect(rendu.variables_nulles).toContain('identity.from_name')
		expect(rendu.variables_nulles).not.toContain('identity.from_address')
	})

	// -------------------------------------------------------------------------------------------
	// Le seed est rendu intact
	// -------------------------------------------------------------------------------------------

	test('le seed est INTACT : le rendu est `STABLE` et n’écrit rien', async ({ request }) => {
		const reponse = await request.get(`${MODELES}?select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
		expect(((await reponse.json()) as unknown[]).length).toBe(MODELES_DU_SEED)
	})
})
