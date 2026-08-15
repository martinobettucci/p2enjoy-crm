// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, sixième tranche :
//            la prévisualisation des effets, éprouvée HORS INTERFACE
// @verifies docs/SPEC-workflow-engine.md §7 bis.13.2 (`security invoker` est une propriété de
//            SÉCURITÉ, pas un détail d'implémentation), §7 bis.13.3 (contrat, refus, exclusions),
//            §7 bis.13.6 (preuves attendues)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus se prouve avec le jeton réel du profil)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, sans passer par l'écran)
//
// POURQUOI CETTE SUITE EXISTE ALORS QUE `0034_previsualisation_exigence.test.sql` PROUVE DÉJÀ LA
// FONCTION.
//
// La suite pgTAP endosse un rôle avec `set local role` : elle prouve le calcul, et elle prouve que
// la RLS s'applique. Elle ne prouve PAS ce que le produit expose réellement — le chemin
// PostgREST → Kong, ses codes HTTP, et surtout le fait qu'un jeton d'un autre profil obtienne un
// nombre DIFFÉRENT. C'est cette différence qui donne sa valeur au choix `security invoker` : sans
// elle, « invoker » resterait une déclaration d'intention.
//
// LA MESURE CENTRALE DE CETTE SUITE, prise sur la pile le 2026-08-15 : sur le même couple
// `date-signature-prevue` × `Perdu`, l'administratrice reçoit **1 et 8**, le `viewer` reçoit
// **1 et 4**. Le `viewer` ne voit pas les mêmes affaires, donc il ne reçoit pas le même compte. Un
// `security definer` lui aurait annoncé huit affaires bloquées quand il ne peut en ouvrir que
// quatre — un nombre qu'il n'aurait eu aucun moyen de vérifier, sur des affaires dont l'existence
// ne le regarde pas.
//
// AUCUN SCÉNARIO N'ÉCRIT : la fonction est en lecture seule, et le seed est rendu intact sans
// aucune purge.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const RPC = '/rest/v1/rpc/previsualiser_exigence'

/** Identifiants STABLES du seed (`docs/SPEC-seed.md`). */
const CHAMP_DATE_SIGNATURE = '5eed0000-0000-4000-8000-000000000083'
const CHAMP_ARCHIVE = '5eed0000-0000-4000-8000-000000000087'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_SIGNATURE = '5eed0000-0000-4000-8000-000000000064'
const ETAPE_PERDU = '5eed0000-0000-4000-8000-000000000067'
const TRANSITION_PROSPECTION_PERDU = '5eed0000-0000-4000-8000-000000000077'

type Effets = { sur_place: number; a_l_entree: number }

/** Appelle la fonction avec le jeton donné, et rend la réponse brute. */
async function previsualiser(
	request: APIRequestContext,
	jeton: string | null,
	corps: Record<string, string>,
) {
	return request.post(RPC, {
		headers: {
			...(jeton === null ? enTetesAnonymes() : enTetesAuthentifies(jeton)),
			'Content-Type': 'application/json',
		},
		data: corps,
	})
}

/** Les deux nombres rendus, après avoir constaté le `200`. */
async function effets(
	request: APIRequestContext,
	jeton: string,
	corps: Record<string, string>,
): Promise<Effets> {
	const reponse = await previsualiser(request, jeton, corps)
	expect(reponse.status()).toBe(200)
	const lignes = (await reponse.json()) as Effets[]
	expect(lignes).toHaveLength(1)
	return lignes[0]!
}

test.describe('P1 — la prévisualisation rend les deux effets, et ils ne sont pas le même nombre', () => {
	test('l’administratrice obtient les comptes mesurés du seed sur trois étapes', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')

		// `Prospection` est l'étape INITIALE : aucune arête n'y mène, donc rien « à l'entrée ».
		expect(await effets(request, jeton, {
			p_field_id: CHAMP_DATE_SIGNATURE,
			p_step_id: ETAPE_PROSPECTION,
		})).toEqual({ sur_place: 4, a_l_entree: 0 })

		// `Signature` rend l'INVERSE EXACT : personne sur place, une affaire empêchée d'entrer. Ces
		// deux lignes ensemble sont la preuve qu'un seul nombre n'aurait pas suffi.
		expect(await effets(request, jeton, {
			p_field_id: CHAMP_DATE_SIGNATURE,
			p_step_id: ETAPE_SIGNATURE,
		})).toEqual({ sur_place: 0, a_l_entree: 1 })

		// `Perdu` porte les deux à la fois.
		expect(await effets(request, jeton, {
			p_field_id: CHAMP_DATE_SIGNATURE,
			p_step_id: ETAPE_PERDU,
		})).toEqual({ sur_place: 1, a_l_entree: 8 })
	})

	test('une cible de TRANSITION ne compte que son chemin, jamais l’étape d’arrivée', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const parChemin = await effets(request, jeton, {
			p_field_id: CHAMP_DATE_SIGNATURE,
			p_transition_id: TRANSITION_PROSPECTION_PERDU,
		})

		// `sur_place` est TOUJOURS nul pour une transition : elle ne porte pas sur une étape.
		expect(parChemin.sur_place).toBe(0)
		// Et son compte est strictement inférieur à celui de l'étape d'arrivée, qui agrège ses cinq
		// chemins : 4 contre 8. Un écran qui aurait confondu les deux cibles aurait doublé l'effet
		// annoncé sur le geste le plus courant du bloc des exigences.
		expect(parChemin.a_l_entree).toBe(4)
	})
})

test.describe('P2 — `security invoker` : le compte est celui de ce que l’appelant peut lire', () => {
	test('LE `viewer` REÇOIT UN AUTRE NOMBRE QUE L’ADMINISTRATRICE, sur le même couple', async ({
		request,
	}) => {
		// C'EST LA PREUVE CENTRALE DE LA SIXIÈME TRANCHE, et elle ne peut pas être faite ailleurs
		// qu'ici : ni l'écran ni pgTAP ne montrent deux jetons réels recevant deux comptes.
		const admin = await jetonDe('admin@p2enjoy.test')
		const viewer = await jetonDe('viewer@p2enjoy.test')
		const couple = { p_field_id: CHAMP_DATE_SIGNATURE, p_step_id: ETAPE_PERDU }

		const vuParLAdmin = await effets(request, admin, couple)
		const vuParLeViewer = await effets(request, viewer, couple)

		expect(vuParLAdmin).toEqual({ sur_place: 1, a_l_entree: 8 })
		expect(vuParLeViewer).toEqual({ sur_place: 1, a_l_entree: 4 })
		// L'inégalité est écrite explicitement : si un jour la fonction passait en
		// `security definer`, les deux nombres deviendraient égaux et cette assertion tomberait
		// AVANT que quiconque ne s'aperçoive que le produit annonce des affaires interdites.
		expect(vuParLeViewer.a_l_entree).toBeLessThan(vuParLAdmin.a_l_entree)
	})

	test('le `business_developer` obtient bien un compte, la fonction n’étant pas réservée aux administrateurs', async ({
		request,
	}) => {
		// La prévisualisation est une LECTURE : rien ne justifierait de la réserver, et l'écran qui
		// l'appelle est de toute façon fermé en écriture par les politiques de `CRM-035`.
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		expect(await effets(request, jeton, {
			p_field_id: CHAMP_DATE_SIGNATURE,
			p_step_id: ETAPE_PERDU,
		})).toEqual({ sur_place: 1, a_l_entree: 8 })
	})

	test('l’appelant ANONYME est refusé par le privilège, avant toute politique', async ({
		request,
	}) => {
		const reponse = await previsualiser(request, null, {
			p_field_id: CHAMP_DATE_SIGNATURE,
			p_step_id: ETAPE_PERDU,
		})

		// MESURÉ : `401` et `42501` — « permission denied for function ». Le refus vient du
		// `revoke ... from anon` de la migration `0036`, non d'une politique : `anon` n'a jamais le
		// droit d'exécuter la fonction, donc aucune ligne n'est même évaluée.
		expect(reponse.status()).toBe(401)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('42501')
		expect(corps.message).toContain('previsualiser_exigence')
	})
})

test.describe('P3 — les refus de cible et les cas sans effet', () => {
	test('sans cible et avec DEUX cibles, la fonction refuse — même code, même message', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')

		for (const [intitule, corps] of [
			['aucune cible', { p_field_id: CHAMP_DATE_SIGNATURE }],
			[
				'deux cibles',
				{
					p_field_id: CHAMP_DATE_SIGNATURE,
					p_step_id: ETAPE_PERDU,
					p_transition_id: TRANSITION_PROSPECTION_PERDU,
				},
			],
		] as const) {
			const reponse = await previsualiser(request, jeton, corps)
			expect(reponse.status(), intitule).toBe(400)
			const erreur = (await reponse.json()) as { code: string; message: string }
			expect(erreur.code, intitule).toBe('P0001')
			expect(erreur.message, intitule).toBe('previsualisation_cible')
		}
	})

	test('un champ ARCHIVÉ ne promet aucune contrainte, et une cible inconnue ne lève pas', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')

		// La sixième garde de `move_card` filtre `archived_at is null` : l'exigence serait sans
		// effet, et annoncer un nombre reviendrait à promettre une contrainte jamais appliquée.
		expect(await effets(request, jeton, {
			p_field_id: CHAMP_ARCHIVE,
			p_step_id: ETAPE_PERDU,
		})).toEqual({ sur_place: 0, a_l_entree: 0 })

		// Une cible disparue entre la lecture de l'écran et l'appel est une course ordinaire :
		// l'écriture qui suit la signalera par son `23503`, et prévisualiser n'est pas le moment de
		// s'en plaindre.
		expect(await effets(request, jeton, {
			p_field_id: CHAMP_DATE_SIGNATURE,
			p_step_id: '00000000-0000-4000-8000-0000000000ff',
		})).toEqual({ sur_place: 0, a_l_entree: 0 })
	})
})
