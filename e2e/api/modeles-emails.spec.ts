// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 1 : le modèle d'email
// @verifies docs/SPEC-modeles-emails.md §2.7 (les quatorze lignes du contrat d'API), §2.5 (ce que
//           la base refuse), §2.6 (autorisations), §2.8 (le jeu de démonstration)
// @verifies docs/SPEC-seed.md §14 (les deux modèles du seed, et ce qu'ils démontrent)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0053_modeles_emails.test.sql` prouve la
// règle **en base**, sous des rôles endossés. Rien n'y garantit que la pile la rende par la vraie
// route : une table absente du cache de schéma rendrait `404 / PGRST205`, un privilège mal posé
// rendrait `201` là où le contrat annonce `401`, et la suite pgTAP resterait verte dans les deux
// cas. C'est exactement le défaut que la première écriture de la migration 53 portait, et que seule
// la mesure par l'API avait trouvé (`docs/JOURNAL.md`, décision 504).
//
// CE FICHIER ÉCRIT, ET IL REND LE SEED INTACT. Chaque ligne qu'il crée porte un nom préfixé et est
// retirée par le scénario `m`, qui relit ensuite le compte. Le seed pose DEUX modèles ; il en pose
// deux à la sortie, et l'assertion le constate plutôt que de le supposer.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const MODELES = '/rest/v1/mail_templates'

/** Identifiants du seed — `docs/SPEC-seed.md` §2.3, §14.1. */
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

/** « Relance sans réponse » — le modèle du seed qui porte des variables dans les DEUX colonnes. */
const MODELE_SEED = '7e11a7e0-0000-4000-8000-000000000001'
/** Le nombre de modèles que le seed pose, et auquel la suite doit revenir (`docs/SPEC-seed.md` §14.3). */
const MODELES_DU_SEED = 2

/**
 * Préfixe commun aux lignes que cette suite crée.
 *
 * Il sert à deux choses : rendre le nettoyage du scénario `m` sûr — il ne peut pas emporter une
 * ligne du seed —, et rendre lisible, dans une base de développement, ce qui vient d'une preuve.
 */
const PREFIXE = 'preuve-api-0063'

type Modele = {
	id: string
	name: string
	subject: string
	body_text: string
	created_by: string | null
	updated_at: string
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test.describe('les modèles d’email, par la vraie route (docs/SPEC-modeles-emails.md §2.7)', () => {
	// -------------------------------------------------------------------------------------------
	// Lignes 1 et 2 — l'anonyme
	// -------------------------------------------------------------------------------------------

	test('1 — l’anonyme lit `200` et ZÉRO ligne : un filtrage, jamais une erreur', async ({
		request,
	}) => {
		// LA PREMIÈRE ÉCRITURE DU CONTRAT ANNONÇAIT `401`, ET LA MESURE L'A CORRIGÉE (§2.7). La
		// politique de lecture est ouverte `to anon` délibérément, comme celle de `goal_boards` :
		// `auth.uid()` valant `null` hors session, le refus se fait par zéro ligne. La distinction
		// compte — un `401` révélerait que la table existe et qu'elle est protégée.
		const reponse = await request.get(`${MODELES}?select=id`, { headers: enTetesAnonymes() })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('2 — l’anonyme n’écrit pas, et c’est le PRIVILÈGE qui refuse', async ({ request }) => {
		const reponse = await request.post(MODELES, {
			headers: enTetesAnonymes(),
			data: {
				workspace_id: WORKSPACE,
				name: `${PREFIXE} anonyme`,
				subject: 'Objet',
				body_text: 'Corps',
			},
		})
		// `401` et non `403` : la politique n'est jamais atteinte, l'`INSERT` n'étant pas accordé au
		// rôle `anon`. C'est le point de sûreté des `alter default privileges` de la distribution,
		// et le distinguer de `403` est ce qui prouve que le privilège a bien été refermé.
		expect(reponse.status()).toBe(401)
		const corps = await reponse.json()
		expect(corps.code).toBe('42501')
		// Le `hint` de PostgREST divulgue la commande `GRANT` à exécuter. INCHANGÉ et NON MASQUÉ —
		// occurrence connue d'INC-026 : la constater vaut mieux que de la laisser devenir invisible
		// à force d'être habituelle.
		expect(corps.hint).toContain('GRANT INSERT')
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 3, 4 et 5 — les trois profils lisent
	// -------------------------------------------------------------------------------------------

	test('3, 4, 5 — les TROIS profils lisent les deux modèles du seed, la lectrice comprise', async ({
		request,
	}) => {
		for (const [role, jeton] of [
			['admin', () => jetonAdmin],
			['business_developer', () => jetonBizdev],
			['viewer', () => jetonViewer],
		] as const) {
			const reponse = await request.get(`${MODELES}?select=id,name&order=name`, {
				headers: enTetesAuthentifies(jeton()),
			})
			expect(reponse.status(), `lecture par ${role}`).toBe(200)
			const lignes = (await reponse.json()) as Modele[]
			// Le compte EXACT, et non « au moins un » : un `toBeGreaterThan(0)` resterait vert si la
			// lecture cessait d'être filtrée par workspace et rendait celle du voisin.
			expect(lignes.map((l) => l.name), `les modèles lus par ${role}`).toEqual([
				'Prise de contact',
				'Relance sans réponse',
			])
		}
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 6, 7 et 8 — la lectrice n'écrit rien, et de trois façons différentes
	// -------------------------------------------------------------------------------------------

	test('6 — la lectrice ne CRÉE pas : `403` et `42501`', async ({ request }) => {
		const reponse = await request.post(MODELES, {
			headers: enTetesAuthentifies(jetonViewer),
			data: {
				workspace_id: WORKSPACE,
				name: `${PREFIXE} lectrice`,
				subject: 'Objet',
				body_text: 'Corps',
			},
		})
		// `403` ici, et `401` à la ligne 2 : la lectrice A le privilège d'insertion, c'est la
		// POLITIQUE qui la refuse. Les deux codes disent donc deux refus de nature différente, et
		// les confondre masquerait la disparition de l'un des deux remparts.
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('7 — la mise à jour par la lectrice touche ZÉRO ligne, et la ligne est INCHANGÉE', async ({
		request,
	}) => {
		const avant = await lire(request, jetonAdmin, MODELE_SEED)

		const reponse = await request.patch(`${MODELES}?id=eq.${MODELE_SEED}`, {
			headers: { ...enTetesAuthentifies(jetonViewer), Prefer: 'return=representation' },
			data: { subject: 'Objet réécrit par qui n’en a pas le droit' },
		})
		// `200 []` et non une erreur : c'est `docs/SPEC-permissions-rls.md` §7. Un `403` ici
		// signalerait que le privilège d'`UPDATE` a été retiré à `authenticated`, donc que le refus
		// a changé de nature sans que la spécification bouge.
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		// LA RELECTURE EST LA MOITIÉ QUI COMPTE (décision 70) : un `200 []` sur une écriture qui
		// aurait tout de même abouti serait le plus silencieux des défauts.
		const apres = await lire(request, jetonAdmin, MODELE_SEED)
		expect(apres.subject).toBe(avant.subject)
		expect(apres.updated_at).toBe(avant.updated_at)
	})

	test('8 — la suppression par la lectrice rend `204` et la ligne est TOUJOURS LÀ', async ({
		request,
	}) => {
		const reponse = await request.delete(`${MODELES}?id=eq.${MODELE_SEED}`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(reponse.status()).toBe(204)

		const apres = await request.get(`${MODELES}?id=eq.${MODELE_SEED}&select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect((await apres.json()) as unknown[]).toHaveLength(1)
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 9, 10 et 11 — le business developer écrit, et la base refuse ce qu'elle doit refuser
	// -------------------------------------------------------------------------------------------

	test('9 — le business developer CRÉE un modèle valide : `201`, et la ligne se relit', async ({
		request,
	}) => {
		const reponse = await request.post(MODELES, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE,
				name: `${PREFIXE} nominal`,
				subject: 'Où en est {{card.title}} ?',
				body_text: 'Bonjour {{ contact.full_name }}, et {{card.title}} de nouveau.',
			},
		})
		expect(reponse.status()).toBe(201)
		const [cree] = (await reponse.json()) as Modele[]
		// Les blancs de bord dans les accolades sont tolérés (§2.3) : le corps est stocké TEL QUEL,
		// la tolérance vivant dans la validation et non dans une normalisation qui réécrirait le
		// texte de l'utilisateur.
		expect(cree.body_text).toContain('{{ contact.full_name }}')
	})

	test('10 — une variable inconnue est refusée, et la contrainte NOMME la colonne', async ({
		request,
	}) => {
		for (const [colonne, charge] of [
			[
				'subject',
				{ subject: 'Où en est {{card.titel}} ?', body_text: 'Corps sans variable' },
			],
			[
				'body',
				{ subject: 'Objet sans variable', body_text: 'Bonjour {{contact.fullname}}' },
			],
		] as const) {
			const reponse = await request.post(MODELES, {
				headers: enTetesAuthentifies(jetonBizdev),
				data: { workspace_id: WORKSPACE, name: `${PREFIXE} ${colonne}`, ...charge },
			})
			expect(reponse.status(), `refus de la variable inconnue dans ${colonne}`).toBe(400)
			const corps = await reponse.json()
			expect(corps.code).toBe('23514')
			// LE NOM DE LA CONTRAINTE EST LE CONTRAT : c'est lui qui dira à l'écran de la tranche 2
			// près de quel champ poser son message. Un message générique le forcerait à deviner.
			expect(corps.message).toContain(`mail_templates_${colonne}_variables`)
		}
	})

	test('11 — un nom déjà pris, aux blancs près, est refusé en `409`', async ({ request }) => {
		const reponse = await request.post(MODELES, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: {
				workspace_id: WORKSPACE,
				name: '   Relance sans réponse   ',
				subject: 'Objet',
				body_text: 'Corps',
			},
		})
		expect(reponse.status()).toBe(409)
		const corps = await reponse.json()
		expect(corps.code).toBe('23505')
		// L'unicité porte sur la forme NORMALISÉE : sans `app.btrim_blancs` dans l'index, cette
		// écriture passerait et la liste porterait deux entrées que rien ne distingue à l'œil.
		expect(corps.message).toContain('mail_templates_workspace_name_key')
	})

	// -------------------------------------------------------------------------------------------
	// Lignes 12, 13 et 14 — l'administratrice modifie, trace et supprime
	// -------------------------------------------------------------------------------------------

	test('12 — l’administratrice MODIFIE le corps, et `updated_at` AVANCE', async ({ request }) => {
		const avant = await lire(request, jetonAdmin, MODELE_SEED)

		const reponse = await request.patch(`${MODELES}?id=eq.${MODELE_SEED}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { body_text: `${avant.body_text}\n\nPost-scriptum de la preuve.` },
		})
		expect(reponse.status()).toBe(200)
		const [modifie] = (await reponse.json()) as Modele[]
		// Le trigger `mail_templates_set_updated_at` est la seule chose qui fasse avancer cette
		// date : l'assertion prouve qu'il est bien POSÉ, ce qu'aucune lecture ne dirait.
		expect(new Date(modifie.updated_at).getTime()).toBeGreaterThan(
			new Date(avant.updated_at).getTime(),
		)

		// LE SEED EST RENDU DANS L'ÉTAT OÙ IL A ÉTÉ TROUVÉ, et pas seulement en compte : c'est le
		// défaut que la décision 501 a corrigé sur `move-card.spec.ts`, et le reproduire ici serait
		// laisser une preuve future rougir sur un corps que personne n'a voulu.
		const remise = await request.patch(`${MODELES}?id=eq.${MODELE_SEED}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { body_text: avant.body_text },
		})
		expect(remise.status()).toBe(204)
	})

	test('14 — `created_by` est une TRACE : l’administratrice peut y poser autrui, sans effet de droit', async ({
		request,
	}) => {
		const reponse = await request.post(MODELES, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE,
				name: `${PREFIXE} trace`,
				subject: 'Objet',
				body_text: 'Corps',
				created_by: FARIDA,
			},
		})
		expect(reponse.status()).toBe(201)
		const [cree] = (await reponse.json()) as Modele[]
		// La colonne accepte l'identifiant d'autrui, et cela ne DONNE rien à personne : aucune
		// politique ne la lit. L'assertion FIGE ce fait plutôt que de le taire — sans elle, une
		// session future pourrait croire à un oubli de garde et en ajouter une par précaution.
		expect(cree.created_by).toBe(FARIDA)

		const refusee = await request.patch(`${MODELES}?id=eq.${cree.id}`, {
			headers: { ...enTetesAuthentifies(jetonViewer), Prefer: 'return=representation' },
			data: { subject: 'Objet réécrit par la personne citée' },
		})
		expect(refusee.status()).toBe(200)
		expect(await refusee.json()).toEqual([])
	})

	test('13, et le SEED EST RENDU INTACT — l’administratrice supprime tout ce que la suite a créé', async ({
		request,
	}) => {
		const reponse = await request.delete(`${MODELES}?name=like.${PREFIXE}*`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(204)

		const restantes = await request.get(`${MODELES}?select=id,name,created_by&order=name`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		const lignes = (await restantes.json()) as Modele[]
		expect(lignes).toHaveLength(MODELES_DU_SEED)
		expect(lignes.map((l) => l.name)).toEqual(['Prise de contact', 'Relance sans réponse'])
		// Et l'auteur du seed est celui que `docs/SPEC-seed.md` §14.1 annonce : une suppression qui
		// aurait emporté une ligne du seed, puis un rejeu, se verrait ici.
		expect(lignes.every((l) => l.created_by === CAMILLE)).toBe(true)
	})
})

/** Relit une ligne avec la clé d'un profil qui la lit, pour comparer un avant et un après. */
async function lire(
	request: import('@playwright/test').APIRequestContext,
	jeton: string,
	id: string,
): Promise<Modele> {
	const reponse = await request.get(`${MODELES}?id=eq.${id}&select=*`, {
		headers: enTetesAuthentifies(jeton),
	})
	expect(reponse.status()).toBe(200)
	const [ligne] = (await reponse.json()) as Modele[]
	expect(ligne, `le modèle ${id} doit exister — seed non appliqué ?`).toBeTruthy()
	return ligne
}
