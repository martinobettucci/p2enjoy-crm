// @verifies CRM-144 (docs/BACKLOG.md) — tranche T3 : l'outbox dans l'inbox, à la souris et au clavier — les trois entrées
//           de tête et leurs comptes, « En file » et « Annuler l'envoi » confirmé dans le flux (constaté en base, et la
//           ligne « Envoi annulé » au fil de l'affaire), « Échecs », le motif en toutes lettres et « Réessayer », « Envoyés »,
//           l'issue incertaine sans commande, la commande éteinte avec son motif pour un collègue non administrateur,
//           l'adresse `?envois=`, et les captures aux quatre paliers
// @verifies docs/SPEC-mail-subsystem.md §28.6, §28.7, §28.11 (ligne « E2E ui ») ; docs/DESIGN_SYSTEM.md §5.98, §5.59, §5.13 ;
//           décision 906 ; CLAUDE.md §15, §16
//
// LES ENVOIS SONT POSÉS PAR LA CLÉ DE SERVICE, comme la file les pose (le départ dans un jour : le worker local ne les prend
// pas pendant la preuve), sur l'affaire c1 du seed, auteur Driss. Chaque scénario retire les envois qu'il a posés. CE QUE LA
// REMISE EN ÉTAT NE PEUT PAS DÉFAIRE, et qui est nommé plutôt que tu : la ligne `mail_cancelled` écrite au fil de c1 par une
// annulation réussie — `card_events` n'accorde aucun privilège d'écriture, `service_role` compris (`CRM-044`, la règle de
// `declassement.spec.ts`). Les preuves ne comptent donc jamais ces lignes : elles cherchent la leur, par son objet. L'inbox s'ouvre `courrier=tous` : « Seulement moi » ne s'applique pas à l'outbox, et le sujet est ailleurs.

import type { APIRequestContext } from '@playwright/test'
import { connecterAvecLeLabs, expect, test } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-144'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const AFFAIRE = '5eed0000-0000-4000-8000-0000000000c1'
const CHEMIN_AFFAIRE = '/tracks/conseil-ia/grands-comptes/cards/' + AFFAIRE
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const MARQUE = 'E2E CRM-144'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function identiteDe(request: APIRequestContext, personne: string): Promise<string> {
	const reponse = await request.get(rest(`mail_outbound_identities?select=id&owner_id=eq.${personne}&order=created_at&limit=1`), {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

async function poser(
	request: APIRequestContext,
	objet: string,
	statut: 'queued' | 'failed' | 'sent',
	{ auteur = DRISS, motif = null as string | null, essais = 0 } = {},
): Promise<string> {
	const reponse = await request.post(rest('mail_outbox?select=id'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			workspace_id: WORKSPACE,
			identity_id: await identiteDe(request, auteur),
			card_id: AFFAIRE,
			to_addrs: ['client@exterieur.test'],
			subject: objet,
			body_text: `${MARQUE} — corps de l’envoi.`,
			status: statut,
			last_error: motif,
			attempts: essais,
			created_by: auteur,
			next_attempt_at: new Date(Date.now() + 86_400_000).toISOString(),
			...(statut === 'sent' ? { sent_at: new Date().toISOString() } : {}),
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

async function statut(request: APIRequestContext, id: string): Promise<string | undefined> {
	const reponse = await request.get(rest(`mail_outbox?select=status&id=eq.${id}`), { headers: enTetesService() })
	return ((await reponse.json()) as { status: string }[])[0]?.status
}

test.afterEach(async ({ request }) => {
	await request.delete(rest(`mail_outbox?body_text=like.${encodeURIComponent(MARQUE)}*`), { headers: enTetesService() })
})

test.use({ viewport: { width: 1440, height: 900 } })

test('« En file » : annuler à la souris, confirmé dans le flux, constaté en base et au fil de l’affaire', async ({ page, request }) => {
	const id = await poser(request, 'Proposition à annuler', 'queued', { motif: 'timeout', essais: 2 })
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/inbox?courrier=tous')
	const entree = page.getByTestId('inbox-envois-file')
	await expect(entree).toHaveAccessibleName(/En file\s:\s\d+\senvois?/)
	await expect(page.getByTestId('inbox-envois-envoyes')).toBeVisible()
	await expect(page.getByTestId('inbox-envois-echecs')).toBeVisible()
	await entree.click()
	await expect(page).toHaveURL(/envois=file/)
	const ligne = page.locator(`[data-testid="inbox-envoi"][data-envoi="${id}"]`)
	await expect(ligne).toContainText('Proposition à annuler')
	await expect(ligne).toContainText('2 essais — le serveur d’envoi n’a pas répondu à temps')
	await expect(ligne).toContainText('Départ prévu')
	await ligne.click()
	const detail = page.getByTestId('inbox-envoi-detail')
	await expect(detail).toContainText('Expédié depuis')
	await expect(detail.getByTestId('inbox-envoi-card')).toBeVisible()
	await detail.getByTestId('inbox-envoi-annuler').click()
	const confirmation = page.getByTestId('inbox-envoi-confirmation')
	await expect(confirmation).toContainText('Annuler l’envoi de « Proposition à annuler » ? Le message ne partira pas.')
	await expect(page.getByTestId('inbox-envoi-annuler-confirmer')).toBeFocused()
	await capturer(page, 'outbox-annuler-confirmation-xl-1440', UNITE)
	await page.getByTestId('inbox-envoi-annuler-confirmer').click()
	await expect(ligne).toHaveCount(0)
	await expect(page.getByTestId('inbox-envoi-detail')).toHaveCount(0)
	await expect(entree).toBeFocused()
	await expect(page.getByRole('status').filter({ hasText: 'Envoi annulé' })).toHaveCount(1)
	expect(await statut(request, id)).toBe('cancelled')

	// LE FIL DE L'AFFAIRE porte la ligne « Envoi annulé », avec l'objet et l'acteur.
	await page.goto(CHEMIN_AFFAIRE)
	// Le libellé et l'objet forment UNE ligne du fil (« Envoi annulé · Proposition à annuler ») : on cherche la sienne.
	const evenement = page.getByText(/Envoi annulé.*Proposition à annuler/).last()
	await expect(evenement).toBeVisible()
	await evenement.scrollIntoViewIfNeeded()
	await capturer(page, 'outbox-fil-envoi-annule-xl-1440', UNITE)
})

test('au clavier : « Garder en file » et Échap rendent le focus à la commande, rien n’est annulé', async ({ page, request }) => {
	const id = await poser(request, 'À garder en file', 'queued')
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/inbox?courrier=tous&envois=file')
	// L'ADRESSE GARDE LE DOSSIER : on arrive dans « En file ».
	await expect(page.getByTestId('inbox-envois-file')).toHaveAttribute('aria-current', 'true')
	const ligne = page.locator(`[data-testid="inbox-envoi"][data-envoi="${id}"]`)
	await ligne.focus()
	await page.keyboard.press('Enter')
	const commande = page.getByTestId('inbox-envoi-annuler')
	await commande.focus()
	await page.keyboard.press('Enter')
	await expect(page.getByTestId('inbox-envoi-annuler-confirmer')).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(page.getByTestId('inbox-envoi-confirmation')).toHaveCount(0)
	await expect(commande).toBeFocused()
	await page.keyboard.press('Enter')
	await page.keyboard.press('Tab')
	await expect(page.getByTestId('inbox-envoi-annuler-garder')).toBeFocused()
	await page.keyboard.press('Enter')
	await expect(commande).toBeFocused()
	expect(await statut(request, id)).toBe('queued')
	// Annuler au clavier, jusqu'au bout.
	await page.keyboard.press('Enter')
	await page.keyboard.press('Enter')
	await expect(ligne).toHaveCount(0)
	expect(await statut(request, id)).toBe('cancelled')
})

test('« Échecs » : le motif en toutes lettres, « Réessayer » sans confirmation ; « Envoyés »', async ({ page, request }) => {
	const echec = await poser(request, 'Envoi refusé par le serveur', 'failed', { motif: 'auth_failed', essais: 1 })
	const inconnu = await poser(request, 'Envoi au motif inconnu', 'failed', { motif: 'smtp_421' })
	const parti = await poser(request, 'Envoi parti', 'sent')
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/inbox?courrier=tous&envois=echecs')
	const entree = page.getByTestId('inbox-envois-echecs')
	await expect(entree).toHaveAccessibleName(/Échecs\s:\s\d+\senvois?/)
	const ligne = page.locator(`[data-testid="inbox-envoi"][data-envoi="${echec}"]`)
	await expect(ligne).toContainText('le serveur d’envoi a refusé l’identifiant ou le mot de passe')
	// UN CODE INCONNU N'EST JAMAIS MONTRÉ BRUT.
	const ligneInconnue = page.locator(`[data-testid="inbox-envoi"][data-envoi="${inconnu}"]`)
	await expect(ligneInconnue).toContainText('cause non reconnue')
	await expect(ligneInconnue).not.toContainText('smtp_421')
	await ligne.click()
	await capturer(page, 'outbox-echecs-xl-1440', UNITE)
	await page.getByTestId('inbox-envoi-reessayer').click()
	await expect(ligne).toHaveCount(0)
	await expect(page.getByRole('status').filter({ hasText: 'Envoi remis en file' })).toHaveCount(1)
	expect(['queued', 'sending', 'sent']).toContain(await statut(request, echec))

	await page.getByTestId('inbox-envois-envoyes').click()
	await expect(page).toHaveURL(/envois=envoyes/)
	const ligneParti = page.locator(`[data-testid="inbox-envoi"][data-envoi="${parti}"]`)
	await expect(ligneParti).toContainText('Envoyé le')
	await ligneParti.click()
	await expect(page.getByTestId('inbox-envoi-detail')).toContainText('Envoyé le')
	// UN ENVOI PARTI N'A AUCUNE COMMANDE.
	await expect(page.getByTestId('inbox-envoi-commandes')).toHaveCount(0)
})

test('l’issue incertaine n’a pas de commande ; un collègue non administrateur voit la commande éteinte avec son motif', async ({
	page,
	request,
}) => {
	const incertain = await poser(request, 'Premier essai interrompu', 'queued', { motif: 'worker_interrompu', essais: 1 })
	const deCamille = await poser(request, 'Envoi de Camille', 'queued', { auteur: CAMILLE })
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/inbox?courrier=tous&envois=file')
	await page.locator(`[data-testid="inbox-envoi"][data-envoi="${incertain}"]`).click()
	await expect(page.getByTestId('inbox-envoi-incertain')).toContainText(
		'Un premier essai a été interrompu : le message a pu partir. Il ne peut pas être annulé.',
	)
	await expect(page.getByTestId('inbox-envoi-annuler')).toHaveCount(0)
	await capturer(page, 'outbox-incertain-xl-1440', UNITE)

	await page.locator(`[data-testid="inbox-envoi"][data-envoi="${deCamille}"]`).click()
	const commande = page.getByTestId('inbox-envoi-annuler')
	await expect(commande).toBeDisabled()
	await expect(commande).toHaveAccessibleDescription(/Seuls son auteur et les administrateurs/)
	await expect(page.getByTestId('inbox-envoi-motif')).toBeVisible()
	await capturer(page, 'outbox-commande-eteinte-xl-1440', UNITE)
	expect(await statut(request, deCamille)).toBe('queued')
})

test.describe('les quatre paliers', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : la pile tient, la page ne défile pas horizontalement`, async ({ page, request }) => {
			const id = await poser(request, 'Proposition au long objet pour vérifier le repli des lignes sur un petit écran', 'queued', {
				motif: 'host_unreachable',
				essais: 3,
			})
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto('/inbox?courrier=tous')
			await page.getByTestId('inbox-envois-file').click()
			const ligne = page.locator(`[data-testid="inbox-envoi"][data-envoi="${id}"]`)
			await expect(ligne).toBeVisible()
			await capturer(page, `outbox-file-${palier.nom}`, UNITE)
			await ligne.click()
			await expect(page.getByTestId('inbox-envoi-detail')).toBeVisible()
			await capturer(page, `outbox-detail-${palier.nom}`, UNITE)
			const largeurs = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
			expect(largeurs[0], 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(largeurs[1]!)
		})
	}
})
