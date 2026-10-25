// @verifies CRM-001 (docs/BACKLOG.md) tranche INC-299 — la webapp ne compte jamais par `HEAD`
// @verifies docs/DAT.md §3.5 bis (seconde cause, décision 700) ; docs/INCONSISTENCY_REPORT.md INC-299
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// PostgREST répond à un `HEAD` sans longueur puis ferme la connexion sans l'annoncer ; Kong la
// remettait au pool, et la requête suivante rendait `502`. La webapp compte donc par un `GET` borné à
// zéro ligne (`webapp/src/lib/compter.ts`). Ce parcours, sur la vraie pile et le seed, ouvre chacun des
// écrans qui comptent et relève les requêtes RÉELLEMENT émises par le navigateur : chaque écran doit
// avoir émis son compte sous la forme nouvelle — sans quoi l'absence de `HEAD` ne prouverait rien —,
// et aucune requête `HEAD` ne doit avoir atteint `/rest/v1/`. Aucun scénario n'écrit : la clôture
// d'un budget est ouverte puis annulée.

import { connecterAvecLeLabs, estUnCompte, expect, test, type Page } from './fixtures'

const ADMIN = 'admin@p2enjoy.test'

type RequeteVue = { methode: string; table: string; compte: boolean }

/** Note chaque requête vers `/rest/v1/` : méthode, table, et si c'est un compte au nouveau format. */
function relever(page: Page): RequeteVue[] {
	const vues: RequeteVue[] = []
	page.on('request', (requete) => {
		const adresse = new URL(requete.url())
		const prefixe = '/rest/v1/'
		if (!adresse.pathname.startsWith(prefixe)) return
		vues.push({
			methode: requete.method(),
			table: adresse.pathname.slice(prefixe.length),
			compte: estUnCompte(requete),
		})
	})
	return vues
}

/** Les tables comptées au nouveau format depuis le rang `depuis` du relevé. */
function tablesComptees(vues: readonly RequeteVue[], depuis: number): Set<string> {
	return new Set(vues.slice(depuis).filter((vue) => vue.compte).map((vue) => vue.table))
}

test.describe('les comptes de la webapp sont des GET bornés, jamais des HEAD (docs/DAT.md §3.5 bis)', () => {
	test('cinq écrans qui comptent : chacun émet son compte, aucun HEAD ne part vers /rest/v1/', async ({
		page,
	}) => {
		const vues = relever(page)
		await connecterAvecLeLabs(page, ADMIN)

		// 1. Le guide de démarrage compte ses six étapes ; la cloche de la coquille, les non-lues.
		let depuis = vues.length
		await page.goto('/demarrage')
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
		await expect.poll(() => [...tablesComptees(vues, depuis)].sort()).toEqual(
			expect.arrayContaining(['cards', 'channels', 'mail_inbound_accounts', 'notifications', 'tracks', 'workflows', 'workspaces']),
		)

		// 2. La corbeille énumère ce que le track en corbeille rend inaccessible : un compte d'affaires.
		depuis = vues.length
		await page.goto('/reglages/corbeille')
		await expect(page.getByRole('heading', { name: 'Corbeille' })).toBeVisible()
		await expect.poll(() => tablesComptees(vues, depuis).has('cards')).toBe(true)

		// 3. L'état de la messagerie compte la file sortante : en attente et échecs.
		depuis = vues.length
		await page.goto('/reglages')
		await page.getByRole('link', { name: 'État de la messagerie' }).click()
		await expect(page.getByRole('heading', { name: 'État de la messagerie' })).toBeVisible()
		await expect
			.poll(() => vues.slice(depuis).filter((vue) => vue.compte && vue.table === 'mail_outbox').length)
			.toBe(2)

		// 4. La confirmation de clôture d'un budget compte ses lignes sans coût réel ; elle est annulée.
		depuis = vues.length
		await page.goto('/reglages/arborescence')
		await expect(page.getByRole('heading', { name: "Administration de l'arborescence" })).toBeVisible()
		await page.getByRole('button', { name: 'Déplier Studio web' }).click()
		const bloc = page.getByRole('region', { name: 'Budgets du track Studio web' })
		await bloc.getByRole('button', { name: 'Clôturer le budget Publicité 2026' }).click()
		const confirmation = bloc.getByTestId('confirmation-cloture-budget')
		await expect(confirmation).toBeVisible()
		await expect.poll(() => tablesComptees(vues, depuis).has('card_costs')).toBe(true)
		await confirmation.getByRole('button', { name: 'Annuler' }).click()
		await expect(confirmation).toBeHidden()

		// Le verdict : sur tout le parcours, aucune requête HEAD n'a atteint l'API.
		const head = vues.filter((vue) => vue.methode === 'HEAD').map((vue) => vue.table)
		expect(head, 'aucun HEAD vers /rest/v1/ (PostgREST en ferme la connexion sans l’annoncer)').toEqual([])
		expect(vues.length, 'le relevé a bien vu les requêtes de l’API').toBeGreaterThan(10)
	})
})
