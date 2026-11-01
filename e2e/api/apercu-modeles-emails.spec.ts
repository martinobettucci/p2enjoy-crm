// @verifies CRM-125 (docs/BACKLOG.md) T2 — `public.render_mail_template_sample` par la vraie route, aux vrais jetons
// @verifies docs/SPEC-modeles-emails.md §14.2 (contrat, zéro ligne, privilèges), §14.3 (le jeu d'exemple), §14.4
//           (l'identité de la personne) ; docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10
//
// `supabase/tests/` prouve la règle en base sous des rôles endossés ; ce fichier prouve que la pile la rend par la
// vraie route (cache de schéma, privilèges de `anon`). Il n'écrit rien : la fonction est `STABLE`.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const APERCU = '/rest/v1/rpc/render_mail_template_sample'

/** « Relance sans réponse », modèle du seed — `docs/SPEC-seed.md` §14. */
const MODELE_RELANCE = '7e11a7e0-0000-4000-8000-000000000001'
const INCONNU = '00000000-0000-4000-8000-000000000000'

type Apercu = { subject: string; body_text: string; signature_text: string | null; identity_is_sample: boolean }

async function apercu(request: import('@playwright/test').APIRequestContext, email: string, modele: string) {
	const jeton = await jetonDe(email)
	const reponse = await request.post(APERCU, { headers: enTetesAuthentifies(jeton), data: { p_template_id: modele } })
	expect(reponse.status(), `${email} — statut`).toBe(200)
	return (await reponse.json()) as Apercu[]
}

test.describe('l’aperçu d’un modèle sur un jeu d’exemple (§14.2)', () => {
	test('l’administratrice et la lectrice rendent le même texte d’exemple', async ({ request }) => {
		const [admin] = await apercu(request, 'admin@p2enjoy.test', MODELE_RELANCE)
		const [lectrice] = await apercu(request, 'viewer@p2enjoy.test', MODELE_RELANCE)
		expect(admin, 'une ligne pour l’administratrice').toBeDefined()
		expect(lectrice, 'une ligne pour la lectrice').toBeDefined()
		expect(admin!.subject).toBe('Où en est Projet exemple ?')
		expect(admin!.body_text).toContain('Bonjour M. Dupont,')
		expect(lectrice!.subject).toBe(admin!.subject)
		// LA LECTRICE N'A AUCUNE IDENTITÉ AU SEED : l'expéditeur est fictif, et le retour le dit.
		expect(lectrice!.identity_is_sample).toBe(true)
		expect(lectrice!.signature_text).toBeNull()
	})

	test('Driss voit sa propre identité et sa signature', async ({ request }) => {
		const [driss] = await apercu(request, 'bizdev@p2enjoy.test', MODELE_RELANCE)
		expect(driss).toBeDefined()
		expect(driss!.identity_is_sample).toBe(false)
		expect(driss!.signature_text ?? '').toContain('Driss Lemoine')
	})

	test('un modèle inconnu rend zéro ligne ; l’anonyme est refusé', async ({ request }) => {
		expect(await apercu(request, 'admin@p2enjoy.test', INCONNU)).toEqual([])
		const anonyme = await request.post(APERCU, { headers: enTetesAnonymes(), data: { p_template_id: MODELE_RELANCE } })
		expect(anonyme.status(), 'anon n’exécute pas la fonction').toBe(401)
	})
})
