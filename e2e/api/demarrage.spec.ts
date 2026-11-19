// @verifies CRM-079 (docs/BACKLOG.md) — guide de démarrage : les cinq mesures, HORS INTERFACE
// @verifies docs/SPEC-onboarding.md §3 (les cinq étapes, leurs tables et leurs filtres),
//           §3.1 (ce qui a été mesuré le 2026-08-15, et ses trois conséquences),
//           §3.2 (cinq comptages indépendants, et le `count` absent qui est un contrat rompu),
//           §8 (ligne « Hors interface »), §9 (première limite connue)
// @verifies docs/SPEC-seed.md §2.3 (les comptes du seed), §2.5 (les droits fins du `viewer`)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec les vrais jetons)
// @verifies CRM-157 (docs/BACKLOG.md) — tranche T3 : les trois lectures de la messagerie, dans l'espace courant et pour la
//           personne, sous les vrais jetons (docs/SPEC-onboarding.md §11.1 ; docs/SPEC-seed.md §51)
// @verifies CRM-094 (docs/BACKLOG.md) tranche T2 — docs/SPEC-onboarding.md §10.1 : la sixième mesure,
//           `workflows` vivants sous la politique existante (`workflows_lecture_membre`), hors interface
//
// CE QUE CE FICHIER ÉTABLIT, ET QUE L'ÉCRAN NE PEUT PAS ÉTABLIR LUI-MÊME.
//
// `e2e/ui/demarrage.spec.ts` prouve que le guide REND les états qu'il reçoit. Il ne peut pas prouver
// que les écarts entre deux profils viennent du BACKEND : un écran interrogé sur ce qu'il affiche
// répondrait la même chose si l'écart était fabriqué côté client. Ce fichier interroge donc PostgREST
// directement, avec les jetons réels obtenus par la véritable route de connexion, et mesure les six
// comptages exactement comme `webapp/src/lib/demarrage.ts` les émet — `HEAD`, `count=exact`. Le
// sixième, celui des workflows, est ajouté par `CRM-094` (§10.1).
//
// Les trois faits du §3.1 sont ici des ASSERTIONS et non des souvenirs :
//
//   1. un comptage n'est pas un inventaire, c'est ce que l'appelant peut voir — la lectrice compte
//      MOINS de channels et MOINS d'affaires que l'administratrice, sur la même base ;
//   2. la lectrice compte ZÉRO boîte entrante là où trois existent — c'est la première limite
//      connue du §9, et elle est produite par la RLS, pas par l'écran ;
//   3. `mail_inbound_accounts` est la SEULE des six tables à refuser la clé anonyme — c'est ce
//      qui rend la mesure des boîtes seule capable d'un état de refus plutôt que d'un état vide.
//
// AUCUNE ÉCRITURE. Le guide lit et renvoie (docs/SPEC-onboarding.md §1.2) : cette suite est
// rejouable indéfiniment et rend le seed strictement intact — il n'y a rien à défaire.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
// `CRM-157` (§11.1) : les trois étapes de la messagerie se mesurent dans l'ESPACE COURANT, pour la PERSONNE.
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const PERSONNES: Readonly<Record<string, string>> = {
	[ADMIN]: '5eed0000-0000-4000-8000-000000000011',
	[VIEWER]: '5eed0000-0000-4000-8000-000000000013',
}

/**
 * Les six lectures, RECOPIÉES DE LA SPÉCIFICATION §3 et §10.1 et non du module : une preuve qui importerait
 * `FILTRES_ETAPES_DEMARRAGE` serait verte quel que soit le filtre écrit dans le produit, et ne
 * dirait plus rien du contrat. C'est la table du §3 qui fait foi ici.
 *
 * Les filtres sont ceux des lectures existantes : l'archivage masque, la corbeille retire.
 */
const LECTURES = {
	espace: 'workspaces?select=id',
	track: 'tracks?select=id&archived_at=is.null&deleted_at=is.null',
	// `workflows` s'archive et n'a pas de corbeille (§10.1) : un workflow archivé n'accomplit rien.
	workflow: 'workflows?select=id&archived_at=is.null',
	channel: 'channels?select=id&archived_at=is.null&deleted_at=is.null',
	affaire: 'cards?select=id&deleted_at=is.null',
	// RÉVISÉ par `CRM-157` (§11.1) : la boîte SYSTÈME de l'espace courant, testée avec succès…
	'boite-systeme': `mail_inbound_accounts?select=id&owner_id=is.null&status=eq.ok&workspace_id=eq.${ESPACE}`,
	// … le domaine de l'espace courant…
	domaine: `workspaces?select=id&inbound_domain=not.is.null&id=eq.${ESPACE}`,
	// … et l'adresse d'expédition DE LA PERSONNE, testée avec succès (le propriétaire est ajouté par `compter`).
	identite: `mail_outbound_identities?select=id&status=eq.ok&workspace_id=eq.${ESPACE}`,
} as const

type CleEtape = keyof typeof LECTURES

const CLES: readonly CleEtape[] = [
	'espace',
	'track',
	'workflow',
	'channel',
	'affaire',
	'boite-systeme',
	'domaine',
	'identite',
]

type Comptage = {
	readonly statut: number
	/** `null` quand la réponse n'a rendu AUCUN total — le contrat rompu du §3.2. */
	readonly compte: number | null
}

/**
 * Un comptage, émis exactement comme le module l'émet : `HEAD`, `count=exact`, aucune ligne
 * rapportée. Le total est LU dans `Content-Range`, jamais déduit d'un corps.
 */
async function compter(
	requete: APIRequestContext,
	enTetes: Record<string, string>,
	cle: CleEtape,
	personne?: string,
): Promise<Comptage> {
	const proprietaire = cle === 'identite' && personne !== undefined ? `&owner_id=eq.${PERSONNES[personne]}` : ''
	const reponse = await requete.fetch(`${URL_API}/rest/v1/${LECTURES[cle]}${proprietaire}`, {
		method: 'HEAD',
		headers: { ...enTetes, Prefer: 'count=exact', Range: '0-0' },
	})
	const plage = reponse.headers()['content-range'] ?? ''
	const total = plage.includes('/') ? plage.split('/')[1] : ''
	return {
		statut: reponse.status(),
		compte: total === undefined || total === '' || total === '*' ? null : Number(total),
	}
}

/** Le total d'une mesure qui DOIT avoir abouti — sinon la preuve nomme laquelle a échoué. */
async function total(
	requete: APIRequestContext,
	enTetes: Record<string, string>,
	cle: CleEtape,
	personne?: string,
): Promise<number> {
	const mesure = await compter(requete, enTetes, cle, personne)
	expect([200, 206], `la mesure « ${cle} » doit aboutir`).toContain(mesure.statut)
	expect(mesure.compte, `la mesure « ${cle} » doit rendre un total`).not.toBeNull()
	return mesure.compte ?? -1
}

test.describe('guide de démarrage — les six comptages hors interface (docs/SPEC-onboarding.md §3, §10.1)', () => {
	// RÉVISÉ par `CRM-157` : huit étapes ; l'adresse d'expédition de Camille est testée par le seed (§51).
	test('l’administratrice voit les huit étapes accomplies, et chaque mesure aboutit', async ({
		request,
	}) => {
		const enTetes = enTetesAuthentifies(await jetonDe(ADMIN))
		for (const cle of CLES) {
			const compte = await total(request, enTetes, cle, ADMIN)
			expect(compte, `l'étape « ${cle} » est accomplie pour l'administratrice`).toBeGreaterThanOrEqual(1)
		}
	})

	test('les huit mesures sont INDÉPENDANTES : aucune n’est conditionnée à une autre (§3.2)', async ({
		request,
	}) => {
		// Le module émet les six en parallèle. Émises ensemble ici, elles aboutissent toutes :
		// aucune ne dépend de l'ordre, et aucune n'exige qu'une autre l'ait précédée.
		const enTetes = enTetesAuthentifies(await jetonDe(ADMIN))
		const mesures = await Promise.all(CLES.map((cle) => compter(request, enTetes, cle, ADMIN)))
		for (const [rang, mesure] of mesures.entries()) {
			expect([200, 206], `la mesure « ${CLES[rang]} » doit aboutir en parallèle`).toContain(mesure.statut)
			expect(mesure.compte, `la mesure « ${CLES[rang]} » doit rendre son total`).not.toBeNull()
		}
	})

	test('la LECTRICE compte MOINS que l’administratrice : le comptage est ce qu’elle voit (§3.1, fait 1)', async ({
		request,
	}) => {
		const admin = enTetesAuthentifies(await jetonDe(ADMIN))
		const lectrice = enTetesAuthentifies(await jetonDe(VIEWER))

		// L'écart est produit par les DROITS FINS (docs/SPEC-seed.md §2.5), sur la même base et à
		// la même seconde. C'est pourquoi le libellé d'une étape non accomplie dit « vous n'en
		// voyez aucun » et jamais « aucun n'existe » : l'écran ne peut pas parler de ce qu'il ne
		// voit pas sans mentir sur les droits de qui le lit.
		expect(await total(request, lectrice, 'channel')).toBeLessThan(
			await total(request, admin, 'channel'),
		)
		expect(await total(request, lectrice, 'affaire')).toBeLessThan(
			await total(request, admin, 'affaire'),
		)

		// Les cinq premières étapes lui restent accomplies : elle voit son espace, des tracks, des
		// workflows — tout membre les lit (§10.1) —, des channels et des affaires — moins, mais pas aucun.
		for (const cle of ['espace', 'track', 'workflow', 'channel', 'affaire'] as const) {
			expect(await total(request, lectrice, cle), `la lectrice voit au moins un ${cle}`).toBeGreaterThanOrEqual(1)
		}
	})

	// RÉVISÉ par `CRM-157` : la boîte SYSTÈME, et l'adresse d'expédition de la lectrice, qu'elle n'a pas.
	test('la LECTRICE compte ZÉRO boîte système alors qu’elle existe, et n’a pas d’adresse d’expédition (§3.1 fait 2, §9)', async ({
		request,
	}) => {
		const admin = enTetesAuthentifies(await jetonDe(ADMIN))
		const lectrice = enTetesAuthentifies(await jetonDe(VIEWER))

		expect(await total(request, admin, 'boite-systeme'), 'le seed porte une boîte système testée').toBeGreaterThanOrEqual(1)
		expect(await total(request, lectrice, 'identite', VIEWER), 'la lectrice n’a aucune adresse d’expédition').toBe(0)
		// Le domaine de l'espace, elle le lit : tout membre lit son espace.
		expect(await total(request, lectrice, 'domaine')).toBe(1)

		// ZÉRO, et non un refus : la réponse ABOUTIT et rend un total nul. C'est le refus par
		// défaut de la RLS (docs/SPEC-permissions-rls.md), qui rend `200` et zéro ligne — donc un
		// état VIDE à l'écran, jamais un état d'erreur (`webapp/src/lib/async.ts`).
		const mesure = await compter(request, lectrice, 'boite-systeme')
		expect([200, 206]).toContain(mesure.statut)
		expect(mesure.compte, 'l’étape des boîtes restera « À faire » pour la lectrice').toBe(0)

		// La limite du §9 est donc STRUCTURELLE, et non un défaut d'écran : quelle que soit la
		// façon dont le guide interroge, la lectrice ne peut pas accomplir cette étape en lecture.
	})

	// RÉVISÉ par `CRM-157` : `mail_outbound_identities` refuse aussi la clé anonyme — mesuré le 2026-11-19.
	test('les boîtes et les identités sont les SEULES à refuser la clé anonyme (§3.1, fait 3)', async ({
		request,
	}) => {
		// Les cinq autres rendent une réponse ABOUTIE et un total nul : `anon` a le privilège de
		// lecture — `workflows` compris, mesuré le 2026-09-28 —, et c'est la politique qui ne lui
		// accorde aucune ligne.
		for (const cle of ['espace', 'track', 'workflow', 'channel', 'affaire', 'domaine'] as const) {
			const mesure = await compter(request, enTetesAnonymes(), cle)
			expect([200, 206], `${cle} doit aboutir pour l'anonyme`).toContain(mesure.statut)
			expect(mesure.compte, `${cle} doit rendre zéro à l'anonyme`).toBe(0)
		}

		// Celle des boîtes REFUSE, `anon` n'ayant aucun privilège sur cette table : PostgREST rend
		// `401`. C'est le seul des six comptages qui peut porter l'écran à un état de refus —
		// celui que `classerErreur` nomme `forbidden`, et qui n'offre AUCUNE reprise (§6.1).
		const refus = await compter(request, enTetesAnonymes(), 'boite-systeme')
		expect(refus.statut, 'la clé anonyme n’a aucun privilège sur les boîtes entrantes').toBe(401)
		const refusIdentite = await compter(request, enTetesAnonymes(), 'identite')
		expect(refusIdentite.statut, 'ni sur les identités d’envoi').toBe(401)
	})

	test('une clé anonyme SANS apikey est refusée : le guide ne mesure rien sans session', async ({
		request,
	}) => {
		// Garde de la garde : sans `apikey`, Kong refuse avant PostgREST. La preuve ci-dessus
		// mesure donc bien un refus de POLITIQUE, et non l'absence d'en-tête.
		expect(CLE_ANONYME, 'la clé anonyme doit être configurée pour cet environnement').not.toBe('')
		const reponse = await request.fetch(`${URL_API}/rest/v1/${LECTURES.espace}`, {
			method: 'HEAD',
			headers: { Prefer: 'count=exact', Range: '0-0' },
		})
		expect([401, 403]).toContain(reponse.status())
	})
})
