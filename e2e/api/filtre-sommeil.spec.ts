// @verifies CRM-081 (docs/BACKLOG.md) — tranche 2 b : le filtre du sommeil, hors interface
// @verifies docs/SPEC-cards.md §16.2 (« en sommeil » = non nulle ET future), §16.12.1 (le prédicat
//           d'exclusion et sa mesure), §16.12.2 (l'instant est envoyé comme VALEUR, et pourquoi ce
//           n'est pas une règle d'accès), §16.12.3 (la liste filtre au serveur, le total suit),
//           §16.12.9 (les preuves exigées de la tranche)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves hors interface, jetons réels)
// @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface — et voir ci-dessous
//           pourquoi le sommeil n'en est PAS une)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La vue liste écarte les affaires en sommeil par un
// filtre `or=` construit dans `webapp/src/lib/filtre-sommeil.ts`, et
// `webapp/src/lib/liste-cards.test.ts` éprouve cette construction **contre un client factice** :
// rien n'y garantit que PostgREST réponde ce qu'on croit. Trois façons de se tromper sans qu'un
// test unitaire bronche : un `or=` dont la virgule serait mal interprétée, un horodatage à
// millisecondes refusé, et surtout un `Content-Range` qui ne suivrait PAS le filtre — auquel cas
// la pagination annoncerait des pages inexistantes (§12.5).
//
// CE QUE CE FICHIER NE PROUVE PAS, ET QUI EST VOULU. Le sommeil n'est pas une règle d'accès : il
// RANGE, il n'autorise pas (§16.12.2). Un appelant qui fausserait l'instant envoyé ne verrait rien
// qu'il n'ait déjà le droit de voir — il retrouverait ses propres affaires endormies, exactement ce
// que la bascule lui offre d'un clic. Aucun refus n'est donc attendu ici, et en attendre un
// laisserait croire à une garde que la base ne porte pas. Les refus de la tranche 1, eux, sont
// prouvés par `e2e/api/snooze.spec.ts`.
//
// AUCUNE ÉCRITURE. Ce fichier ne pose ni ne retire aucune ligne, et n'appelle ni `snooze_card` ni
// `wake_card` : le seed sort intact, et les empreintes de convergence ne bougent pas. C'est ce qui
// lui permet de tourner à côté des autres preuves sans les déplacer.

import { expect, test } from '@playwright/test'
import { enTetesAuthentifies, jetonDe } from './jetons'

/**
 * La chaîne de colonnes et le filtre d'exclusion **du produit**, importés depuis les modules qu'il
 * emploie. Un test qui réécrirait son propre `or=` prouverait qu'un filtre quelconque fonctionne,
 * pas que **celui du produit** fonctionne (décision 177).
 */
import { COLONNES_CARD_LISTE } from '../../webapp/src/lib/colonnes-liste'
import { filtreExclusionSommeil } from '../../webapp/src/lib/filtre-sommeil'

const CARDS = '/rest/v1/cards'

/** Identifiants du seed, mesurés en base le 2026-08-17 (docs/SPEC-seed.md, docs/SPEC-cards.md §9). */
const CHANNEL_PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'

/** Les deux affaires que le seed endort (`docs/SPEC-cards.md` §16.11.6). */
const CARD_ENDORMIE = '5eed0000-0000-4000-8000-0000000000ca'
const TITRE_ENDORMIE = 'Cadrage data — Groupe Vallier'
const CARD_ECHUE = '5eed0000-0000-4000-8000-0000000000c1'
const TITRE_ECHUE = 'Refonte du site vitrine'

/** Les filtres d'activité, écrits une fois : ils sont la définition d'« active » du §5. */
const FILTRES_ACTIVES = 'archived_at=is.null&deleted_at=is.null'

/**
 * Les volumes du seed, MESURÉS le 2026-08-17 avec la clé de service, et identiques à ceux que le
 * §16.12.1 consigne.
 *
 * `prospection` porte l'affaire réellement endormie — échéance à dix jours —, `grands-comptes`
 * l'affaire au sommeil ÉCHU, à deux jours en arrière. Les deux sont nécessaires : sans la seconde,
 * rien ne distinguerait « masquer les endormies » de « masquer toute affaire portant une échéance ».
 */
const ACTIVES_PROSPECTION = 2
const EVEILLEES_PROSPECTION = 1
const ACTIVES_GRANDS_COMPTES = 4

type LigneLue = { id: string; title: string; snoozed_until: string | null }

let jetonAdmin: string
/** La lectrice : elle voit `prospection`, et son verdict doit être le même que celui de l'admin. */
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/** L'adresse d'une page de liste, avec ou sans le filtre d'exclusion du produit. */
function adresse(channelId: string, maintenant: Date | null): string {
	const base =
		`${CARDS}?select=${encodeURIComponent(COLONNES_CARD_LISTE)}` +
		`&channel_id=eq.${channelId}&${FILTRES_ACTIVES}&order=title.asc.nullslast,id.asc.nullslast`
	if (maintenant === null) return base
	return `${base}&or=(${encodeURIComponent(filtreExclusionSommeil(maintenant))})`
}

/** Le total exact que le `Content-Range` annonce — c'est lui que la pagination divise (§12.5). */
function totalDe(contentRange: string | undefined): number | null {
	const apres = contentRange?.split('/')[1]
	if (apres === undefined || apres === '*') return null
	return Number(apres)
}

async function lire(
	request: import('@playwright/test').APIRequestContext,
	jeton: string,
	url: string,
): Promise<{ lignes: LigneLue[]; total: number | null; statut: number }> {
	const reponse = await request.get(url, {
		headers: { ...enTetesAuthentifies(jeton), Prefer: 'count=exact' },
	})
	return {
		statut: reponse.status(),
		lignes: reponse.status() === 200 ? ((await reponse.json()) as LigneLue[]) : [],
		total: totalDe(reponse.headers()['content-range']),
	}
}

// --- L'état du seed, sans lequel les deux modes ne prouveraient rien --------------------------

test.describe('l’état du seed que cette tranche éprouve (§16.12.1)', () => {
	// Un préalable qui fige une PROPRIÉTÉ et non un volume : la leçon de la tranche 2 a, où quatre
	// preuves ont été liées à l'état du seed pour avoir compté des lignes en absolu.
	test('le seed porte bien une affaire endormie et une affaire au sommeil échu', async ({ request }) => {
		const { lignes } = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, null))
		const endormie = lignes.find((ligne) => ligne.id === CARD_ENDORMIE)
		expect(endormie?.snoozed_until).not.toBeNull()
		expect(new Date(endormie?.snoozed_until ?? 0).getTime()).toBeGreaterThan(Date.now())

		const autre = await lire(request, jetonAdmin, adresse(CHANNEL_GRANDS_COMPTES, null))
		const echue = autre.lignes.find((ligne) => ligne.id === CARD_ECHUE)
		expect(echue?.snoozed_until).not.toBeNull()
		expect(new Date(echue?.snoozed_until ?? 0).getTime()).toBeLessThan(Date.now())
	})
})

// --- Les deux modes, sur les deux channels (§16.12.9) -----------------------------------------

test.describe('le mode masqué écarte les endormies, et le total suit (§16.12.3)', () => {
	test('`prospection` rend 1 ligne sur 2, et son total vaut 1', async ({ request }) => {
		const sans = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, null))
		expect(sans.lignes).toHaveLength(ACTIVES_PROSPECTION)
		expect(sans.total).toBe(ACTIVES_PROSPECTION)

		const avec = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, new Date()))
		expect(avec.statut).toBe(200)
		expect(avec.lignes).toHaveLength(EVEILLEES_PROSPECTION)
		expect(avec.lignes.map((ligne) => ligne.title)).not.toContain(TITRE_ENDORMIE)
		// LE TOTAL SUIT LE FILTRE, et c'est la propriété que la pagination exige (§12.5) : un total
		// qui resterait à 2 annoncerait une page dont la seconde ligne serait introuvable.
		expect(avec.total).toBe(EVEILLEES_PROSPECTION)
	})

	// UNE ÉCHÉANCE ÉCHUE N'EST PAS UN SOMMEIL (§16.2) : `grands-comptes` rend ses quatre lignes dans
	// les deux modes, et c'est ce qui distingue le prédicat du produit d'un simple
	// « snoozed_until is null ».
	test('`grands-comptes` rend ses 4 lignes dans les DEUX modes, échéance échue comprise', async ({
		request,
	}) => {
		const sans = await lire(request, jetonAdmin, adresse(CHANNEL_GRANDS_COMPTES, null))
		const avec = await lire(request, jetonAdmin, adresse(CHANNEL_GRANDS_COMPTES, new Date()))
		expect(sans.lignes).toHaveLength(ACTIVES_GRANDS_COMPTES)
		expect(avec.lignes).toHaveLength(ACTIVES_GRANDS_COMPTES)
		expect(sans.total).toBe(ACTIVES_GRANDS_COMPTES)
		expect(avec.total).toBe(ACTIVES_GRANDS_COMPTES)
		expect(avec.lignes.map((ligne) => ligne.title)).toContain(TITRE_ECHUE)
	})

	// Un `not.gt` aurait écarté toutes les affaires qui n'ont jamais dormi : la moitié du filtre
	// existe pour les colonnes NULLES, et c'est ici qu'on le constate sur la pile réelle.
	test('les affaires qui n’ont jamais dormi restent toutes rendues', async ({ request }) => {
		const { lignes } = await lire(request, jetonAdmin, adresse(CHANNEL_GRANDS_COMPTES, new Date()))
		const jamais = lignes.filter((ligne) => ligne.snoozed_until === null)
		expect(jamais.length).toBeGreaterThan(0)
		expect(lignes.length).toBeGreaterThanOrEqual(jamais.length)
	})
})

test.describe('les deux côtés de l’échéance, avec un instant choisi (§16.2, §16.12.2)', () => {
	// L'instant est un PARAMÈTRE, et c'est ce qui rend les deux côtés éprouvables sans dépendre de
	// l'heure d'exécution : la même affaire est masquée par un instant antérieur à son échéance, et
	// rendue par un instant postérieur. Aucune date figée ne pourrait tenir cette promesse.
	test('la même affaire est masquée avant son échéance et rendue après', async ({ request }) => {
		const { lignes } = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, null))
		const endormie = lignes.find((ligne) => ligne.id === CARD_ENDORMIE)
		expect(endormie?.snoozed_until).toBeTruthy()
		const echeance = new Date(endormie?.snoozed_until ?? 0)

		const avant = new Date(echeance.getTime() - 60_000)
		const apres = new Date(echeance.getTime() + 60_000)

		const masquee = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, avant))
		expect(masquee.lignes.map((ligne) => ligne.id)).not.toContain(CARD_ENDORMIE)

		const rendue = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, apres))
		expect(rendue.lignes.map((ligne) => ligne.id)).toContain(CARD_ENDORMIE)
		expect(rendue.total).toBe(ACTIVES_PROSPECTION)
	})

	// L'ÉCHÉANCE EXACTE N'EST PAS UN SOMMEIL : le prédicat est « strictement postérieure », et le
	// filtre en est la négation — donc `lte`, qui inclut l'égalité. C'est le seul endroit où la
	// frontière se mesure au millième de seconde près.
	test('l’instant exact de l’échéance rend l’affaire, il ne la masque pas', async ({ request }) => {
		const { lignes } = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, null))
		const endormie = lignes.find((ligne) => ligne.id === CARD_ENDORMIE)
		const echeance = new Date(endormie?.snoozed_until ?? 0)
		const pile = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, echeance))
		expect(pile.lignes.map((ligne) => ligne.id)).toContain(CARD_ENDORMIE)
	})

	// MESURÉ le 2026-08-16, et remesuré ici : PostgREST accepte l'horodatage avec ses millisecondes,
	// la forme que rend `toISOString()`. Sans cela, le filtre du produit rendrait `400` en production
	// alors que le test unitaire resterait vert.
	//
	// La forme est éprouvée par sa GRAMMAIRE et non par un littéral : `toISOString` rend les
	// millisecondes réelles de l'instant, et attendre « .000Z » ne serait vrai qu'une milliseconde
	// sur mille — défaut de cette preuve, corrigé après l'avoir vue rougir.
	test('PostgREST accepte l’horodatage à millisecondes que `toISOString` produit', async ({
		request,
	}) => {
		const maintenant = new Date()
		expect(filtreExclusionSommeil(maintenant)).toMatch(
			/snoozed_until\.lte\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
		)
		const reponse = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, maintenant))
		expect(reponse.statut).toBe(200)
	})

	// CE SCÉNARIO CONSIGNE UNE MESURE QUI CONTREDIT LE MOTIF ÉCRIT AU §16.12.2 — voir **INC-137**.
	//
	// Le §16.12.2 écarte `now()` en affirmant qu'il « compare à la chaîne « now() », pas à l'heure du
	// serveur ». PostgREST n'évalue effectivement rien, mais il transmet la chaîne à Postgres, dont
	// l'analyseur de date accepte la valeur spéciale `now` et tolère les parenthèses. MESURÉ le
	// 2026-08-17 : `'now()'::timestamptz` rend l'instant courant, et ce filtre rend `200` avec
	// exactement le même résultat que l'instant envoyé comme valeur.
	//
	// La preuve n'affirme donc PAS le motif contesté : elle éprouve ce qui est mesurable — les deux
	// chemins s'accordent au même instant —, et laisse l'arbitrage au responsable. Le comportement du
	// produit reste inchangé (CloudWorker §3.1 : consigner, ne pas trancher).
	test('MESURÉ : `lte.now()` est bel et bien résolu par Postgres, et s’accorde au filtre du produit (INC-137)', async ({
		request,
	}) => {
		const parNow = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_PROSPECTION}&${FILTRES_ACTIVES}` +
				`&or=${encodeURIComponent('(snoozed_until.is.null,snoozed_until.lte.now())')}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(parNow.status()).toBe(200)
		const lignesNow = ((await parNow.json()) as { id: string }[]).map((ligne) => ligne.id)

		const parValeur = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, new Date()))
		expect(lignesNow.sort()).toEqual(parValeur.lignes.map((ligne) => ligne.id).sort())
		// Et l'endormie est écartée par les DEUX chemins : c'est ce qui rend la contradiction du
		// motif visible plutôt que théorique.
		expect(lignesNow).not.toContain(CARD_ENDORMIE)
	})
})

test.describe('le sommeil range, il n’autorise pas (§16.12.2, CLAUDE.md §10)', () => {
	// La lectrice obtient le MÊME verdict que l'administratrice sur le channel qu'elle peut lire : le
	// filtre est un rangement, pas un droit. Ce qu'elle voit de moins ailleurs, c'est la RLS qui le
	// décide — et `e2e/api/droits-fins.spec.ts` en porte la preuve.
	test('la lectrice obtient le même filtrage que l’administratrice', async ({ request }) => {
		const admin = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, new Date()))
		const viewer = await lire(request, jetonViewer, adresse(CHANNEL_PROSPECTION, new Date()))
		expect(viewer.statut).toBe(200)
		expect(viewer.lignes.map((ligne) => ligne.id).sort()).toEqual(
			admin.lignes.map((ligne) => ligne.id).sort(),
		)
	})

	// Une affaire endormie reste ATTEIGNABLE : c'est la seconde moitié de la Definition of Done —
	// « et reste atteignable par un filtre explicite ». Sans bascule, elle serait perdue.
	test('l’affaire endormie reste lisible sans le filtre : elle est rangée, non retirée', async ({
		request,
	}) => {
		const { lignes, statut } = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, null))
		expect(statut).toBe(200)
		expect(lignes.map((ligne) => ligne.id)).toContain(CARD_ENDORMIE)
	})

	// La colonne doit être RAPPORTÉE : le filtre est au serveur, mais la marque de la ligne rendue
	// visible a besoin de la valeur (§16.12.7).
	test('la chaîne de colonnes du produit rapporte `snoozed_until`', async ({ request }) => {
		expect(COLONNES_CARD_LISTE).toContain('snoozed_until')
		const { lignes } = await lire(request, jetonAdmin, adresse(CHANNEL_PROSPECTION, null))
		for (const ligne of lignes) {
			expect(Object.hasOwn(ligne, 'snoozed_until')).toBe(true)
		}
	})
})
