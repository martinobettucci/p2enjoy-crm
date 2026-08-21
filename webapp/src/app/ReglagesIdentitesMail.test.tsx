// @verifies CRM-089 (docs/BACKLOG.md) — écran de configuration des identités sortantes SMTP
// @verifies docs/SPEC-mail-subsystem.md §22.3 (ce que l'écran lit), §22.4 (la clé est un TRIPLET,
//           et changer l'adresse déclare une seconde identité), §22.5 (le formulaire et son
//           sélecteur), §22.6 (le mot de passe n'est jamais affiché, un champ vide conserve),
//           §22.8 (le refus est traduit, jamais recopié), §22.9 (les états)
// @verifies docs/DESIGN_SYSTEM.md §5.35 (cette surface), §5.8 (états), §5.13 (focus)
//
// Ces preuves montent le VRAI écran avec un client factice qui enregistre les requêtes émises,
// comme `ReglagesComptesMail.test.tsx`. Le parcours connecté complet relève de
// `e2e/ui/reglages-identites-mail.spec.ts`, qui ne peut pas être exécuté sans la pile.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ReglagesIdentitesMail } from './ReglagesIdentitesMail'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

type Reponse = { data: unknown; error: { message: string } | null; status: number }

const IDENTITES = [
	{
		id: 'i-1',
		label: 'Envoi de Driss Lemoine',
		owner_id: DRISS,
		smtp_host: 'stalwart',
		smtp_port: 587,
		smtp_security: 'none',
		smtp_username: 'bizdev@p2enjoy.test',
		from_address: 'contact@p2enjoy.test',
		from_name: null,
		is_default: true,
		status: 'pending',
		last_error: null,
		last_checked_at: null,
	},
	{
		id: 'i-2',
		label: 'Identité de service',
		owner_id: null,
		smtp_host: 'stalwart',
		smtp_port: 587,
		smtp_security: 'starttls',
		smtp_username: 'systeme@crm.p2enjoy.test',
		from_address: 'systeme@crm.p2enjoy.test',
		from_name: 'Service CRM',
		is_default: false,
		status: 'error',
		last_error: 'auth_failed',
		last_checked_at: '2026-08-21T02:00:00Z',
	},
]

/** Client factice : un workspace, une liste d'identités, et un RPC dont la réponse est fournie. */
function client({
	identites = { data: IDENTITES, error: null, status: 200 },
	rpc = { data: 'i-1', error: null, status: 200 },
	espionRpc,
	espionLecture,
}: {
	identites?: Reponse
	rpc?: Reponse
	espionRpc?: (fonction: string, arguments_: Record<string, unknown>) => void
	espionLecture?: (colonnes: string) => void
} = {}): ClientCrm {
	return {
		from: (table: string) => {
			if (table === 'workspaces') {
				return {
					select: () => ({
						order: () =>
							Promise.resolve({
								data: [{ id: WORKSPACE, name: 'P2Enjoy', slug: 'p2enjoy' }],
								error: null,
								status: 200,
							}),
					}),
				}
			}
			if (table === 'mail_outbound_identities') {
				return {
					select: (colonnes: string) => {
						espionLecture?.(colonnes)
						return { order: () => Promise.resolve(identites) }
					},
				}
			}
			throw new Error(`table inattendue : ${table}`)
		},
		rpc: (fonction: string, arguments_: Record<string, unknown>) => {
			espionRpc?.(fonction, arguments_)
			return Promise.resolve(rpc)
		},
	} as unknown as ClientCrm
}

function monter(c: ClientCrm, idUtilisateur: string | null = CAMILLE) {
	return render(
		<MemoryRouter>
			<ReglagesIdentitesMail client={c} idUtilisateur={idUtilisateur} />
		</MemoryRouter>,
	)
}

describe('ReglagesIdentitesMail — la liste', () => {
	it('rend une ligne par identité visible, avec sa connexion et son état', async () => {
		monter(client())

		expect(await screen.findByTestId('liste-identites-mail')).toBeTruthy()
		expect(screen.getAllByTestId('ligne-identite-mail')).toHaveLength(2)
		expect(screen.getAllByTestId('connexion-identite')[0]?.textContent).toBe('stalwart:587')
		// Le mode de sécurité est un MOT, jamais une teinte (§5.34, §5.35).
		expect(screen.getByText('STARTTLS')).toBeTruthy()
		expect(screen.getByText('En attente')).toBeTruthy()
		expect(screen.getByText('En erreur')).toBeTruthy()
	})

	// L'ADRESSE EST EN TÊTE, dans la forme `Nom <adresse>` — celle dans laquelle un destinataire
	// lira l'expéditeur (§5.35). Un nom absent ne produit ni tiret ni chevrons orphelins (§5.9).
	it('rend l’expéditeur en « Nom <adresse> », ou l’adresse seule sans nom', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		const expediteurs = screen.getAllByTestId('expediteur-identite').map((n) => n.textContent)
		expect(expediteurs).toContain('contact@p2enjoy.test')
		expect(expediteurs).toContain('Service CRM <systeme@crm.p2enjoy.test>')
	})

	// UNE SEULE LIGNE PORTE LA PILULE : une pilule « Secondaire » sur les autres dirait ce que son
	// absence dit déjà (§5.35).
	it('ne porte la pilule « Par défaut » que sur l’identité par défaut', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		expect(screen.getAllByText('Par défaut')).toHaveLength(1)
	})

	// Un cinquième état serait un défaut de la contrainte : la pilule est ABSENTE, jamais remplie
	// du code brut (§5.35, règle du §5.14).
	it('n’affiche AUCUNE pilule pour un état que la contrainte n’admet pas', async () => {
		monter(
			client({
				identites: { data: [{ ...IDENTITES[0], status: 'inventé' }], error: null, status: 200 },
			}),
		)

		expect(await screen.findByTestId('liste-identites-mail')).toBeTruthy()
		expect(screen.queryByText('inventé')).toBeNull()
	})

	// PREUVE DE REFUS N° 6, côté écran : citer `secret_id` rendrait `403` même à l'administratrice,
	// et la liste entière disparaîtrait (§22.3, §22.7).
	it('ne demande jamais `secret_id`, ni le quota, ni la signature', async () => {
		let colonnes = ''
		monter(client({ espionLecture: (c) => (colonnes = c) }))

		await screen.findByTestId('liste-identites-mail')
		expect(colonnes).not.toContain('secret_id')
		expect(colonnes).not.toContain('daily_quota')
		expect(colonnes).not.toContain('signature_html')
	})

	it('sur une erreur de lecture, propose une reprise qui RELIT réellement', async () => {
		let appels = 0
		const c = {
			from: (table: string) => {
				if (table === 'workspaces') {
					return {
						select: () => ({
							order: () =>
								Promise.resolve({
									data: [{ id: WORKSPACE, name: 'P2Enjoy', slug: 'p2enjoy' }],
									error: null,
									status: 200,
								}),
						}),
					}
				}
				return {
					select: () => ({
						order: () => {
							appels += 1
							return Promise.resolve({ data: null, error: { message: 'boom' }, status: 500 })
						},
					}),
				}
			},
		} as unknown as ClientCrm

		monter(c)
		const reprise = await screen.findByRole('button', { name: 'Réessayer' })
		expect(appels).toBe(1)
		await userEvent.click(reprise)
		await waitFor(() => expect(appels).toBe(2))
	})

	// L'ÉTAT VIDE PORTE LE GESTE — c'est le cas de Farida, qui n'a aucune identité (§22.9, §22.11).
	it('sur une lecture vide, rend l’état vide AVEC son geste', async () => {
		monter(client({ identites: { data: [], error: null, status: 200 } }))

		expect(await screen.findByText('Aucune identité d’expédition')).toBeTruthy()
		expect(screen.getByTestId('ouvrir-identite')).toBeTruthy()
	})
})

describe('ReglagesIdentitesMail — le formulaire', () => {
	it('s’ouvre replié, et prend le focus dans son premier champ', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		expect(screen.queryByTestId('formulaire-identite-mail')).toBeNull()

		await userEvent.click(screen.getByTestId('ouvrir-identite'))
		const premier = await screen.findByTestId('champ-identite-visee')
		expect(document.activeElement).toBe(premier)
	})

	it('préremplit les valeurs d’une identité existante, le mot de passe excepté', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getAllByTestId('configurer-identite')[0]!)

		expect((await screen.findByTestId('champ-libelle-identite')).getAttribute('value')).toBe(
			'Envoi de Driss Lemoine',
		)
		expect(screen.getByTestId('champ-adresse-expedition').getAttribute('value')).toBe(
			'contact@p2enjoy.test',
		)
		// AUCUNE VALEUR DE SUBSTITUTION : pas de « ●●●●●● », qui affirmerait une longueur que
		// l'écran n'a pas (§5.35, §5.34).
		expect(screen.getByTestId('champ-mot-de-passe-smtp').getAttribute('value')).toBe('')
	})

	// LE SÉLECTEUR NOMME UNE IDENTITÉ PAR SON LIBELLÉ SUIVI DE SON ADRESSE : deux identités d'une
	// même personne peuvent porter le même libellé (§5.35).
	it('énumère les identités visibles par leurs deux données, plus les deux déclarations', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getByTestId('ouvrir-identite'))

		const options = Array.from(
			(await screen.findByTestId('champ-identite-visee')).querySelectorAll('option'),
		).map((o) => o.textContent)
		expect(options).toContain('Envoi de Driss Lemoine — contact@p2enjoy.test')
		expect(options).toContain('Identité de service — systeme@crm.p2enjoy.test')
		expect(options).toContain('Nouvelle identité personnelle')
		// L'ÉCRAN NE CALCULE AUCUN DROIT : l'entrée de service y figure pour tout le monde, et
		// c'est la base qui refuse (§22.5, mesuré §22.7).
		expect(options).toContain('Nouvelle identité de service')
	})

	// LA CASE EST COCHÉE SUR UNE DÉCLARATION : c'est le défaut de la fonction, et montrer autre
	// chose ferait mentir le formulaire sur ce que l'enregistrement va faire (§5.35).
	it('vide les champs sur une déclaration, mais COCHE « identité par défaut »', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getByTestId('ouvrir-identite'))

		expect((await screen.findByTestId('champ-libelle-identite')).getAttribute('value')).toBe('')
		expect(
			(screen.getByTestId('champ-par-defaut') as HTMLInputElement).checked,
		).toBe(true)
	})

	// L'AVERTISSEMENT DIT UN COMPORTEMENT MESURÉ DE LA BASE, et il ne paraît que là où il est vrai :
	// sur une déclaration, il n'y a rien à dédoubler (§22.4).
	it('avertit que changer l’adresse déclare une seconde identité — sur une identité existante SEULEMENT', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getByTestId('ouvrir-identite'))
		expect(screen.queryByText(/déclare une seconde/)).toBeNull()

		await userEvent.selectOptions(screen.getByTestId('champ-identite-visee'), 'i-1')
		expect(await screen.findByText(/déclare une seconde/)).toBeTruthy()
	})

	// DEUX TEXTES D'AIDE : « conservé » serait FAUX sur une déclaration, où la base refuse par
	// `password_required` (§22.6). C'est la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
	it('dit que le mot de passe est OBLIGATOIRE sur une déclaration, CONSERVÉ sur une modification', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getByTestId('ouvrir-identite'))
		expect(await screen.findByText(/Obligatoire pour une identité/)).toBeTruthy()

		await userEvent.selectOptions(screen.getByTestId('champ-identite-visee'), 'i-1')
		expect(await screen.findByText(/le mot de passe enregistré est conservé/)).toBeTruthy()
	})

	// AUCUNE GARDE DE SAISIE NE DOUBLE UNE CONTRAINTE DE LA BASE (§5.3 ter, §22.5).
	it('ne pose ni `required`, ni `pattern`, ni `type="email"` sur les champs', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getByTestId('ouvrir-identite'))

		const adresse = await screen.findByTestId('champ-adresse-expedition')
		expect(adresse.getAttribute('required')).toBeNull()
		expect(adresse.getAttribute('pattern')).toBeNull()
		expect(adresse.getAttribute('type')).not.toBe('email')

		const port = screen.getByTestId('champ-port-smtp')
		expect(port.getAttribute('min')).toBeNull()
		expect(port.getAttribute('max')).toBeNull()

		// Et la commande d'envoi n'est jamais désactivée par l'état des champs (§5.34).
		expect((screen.getByTestId('valider-identite-mail') as HTMLButtonElement).disabled).toBe(false)
	})
})

describe('ReglagesIdentitesMail — l’enregistrement', () => {
	it('envoie les arguments mesurés, OMET le mot de passe vide et ENVOIE le nom vide', async () => {
		let recu: Record<string, unknown> = {}
		monter(client({ espionRpc: (_, arguments_) => (recu = arguments_) }))

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getAllByTestId('configurer-identite')[0]!)
		await userEvent.click(await screen.findByTestId('valider-identite-mail'))

		await waitFor(() => expect(recu['p_workspace_id']).toBe(WORKSPACE))
		expect('p_password' in recu).toBe(false)
		expect('p_from_name' in recu).toBe(true)
		expect('p_daily_quota' in recu).toBe(false)
		expect('p_signature_html' in recu).toBe(false)
	})

	// LA LISTE EST RELUE, jamais complétée localement : c'est cette relecture qui rend visibles le
	// déplacement du défaut et la seconde identité qu'une adresse modifiée vient de déclarer
	// (§22.9, §22.4).
	it('relit la liste après un enregistrement réussi, et referme le formulaire', async () => {
		let lectures = 0
		const c = {
			from: (table: string) => {
				if (table === 'workspaces') {
					return {
						select: () => ({
							order: () =>
								Promise.resolve({
									data: [{ id: WORKSPACE, name: 'P2Enjoy', slug: 'p2enjoy' }],
									error: null,
									status: 200,
								}),
						}),
					}
				}
				return {
					select: () => ({
						order: () => {
							lectures += 1
							return Promise.resolve({ data: IDENTITES, error: null, status: 200 })
						},
					}),
				}
			},
			rpc: () => Promise.resolve({ data: 'i-1', error: null, status: 200 }),
		} as unknown as ClientCrm

		monter(c)
		await screen.findByTestId('liste-identites-mail')
		expect(lectures).toBe(1)

		await userEvent.click(screen.getAllByTestId('configurer-identite')[0]!)
		await userEvent.click(await screen.findByTestId('valider-identite-mail'))

		await waitFor(() => expect(lectures).toBe(2))
		expect(screen.queryByTestId('formulaire-identite-mail')).toBeNull()
	})

	// LE REFUS PORTE UNE PHRASE DU PRODUIT, jamais le corps du serveur — qui divulgue `secret_id`
	// (INC-193, §22.7). Et il n'efface pas la saisie (§5.7 ter).
	it('traduit un refus sans jamais recopier le serveur, et laisse le formulaire ouvert', async () => {
		monter(
			client({
				rpc: {
					data: null,
					error: {
						message:
							'new row for relation "mail_outbound_identities" violates check constraint "mail_outbound_identities_from_address"',
					},
					status: 400,
				},
			}),
		)

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getAllByTestId('configurer-identite')[0]!)
		await userEvent.click(await screen.findByTestId('valider-identite-mail'))

		const alerte = await screen.findByTestId('refus-identite-mail')
		expect(alerte.getAttribute('role')).toBe('alert')
		expect(alerte.textContent).toContain('adresse électronique')
		expect(alerte.textContent).not.toContain('mail_outbound_identities')
		expect(alerte.textContent).not.toContain('check constraint')
		// La saisie est intacte, et le formulaire reste ouvert.
		expect(screen.getByTestId('champ-adresse-expedition').getAttribute('value')).toBe(
			'contact@p2enjoy.test',
		)
	})

	// Le refus mesuré d'une lectrice qui vise l'identité de service (§22.7) : l'écran ne l'a pas
	// anticipé, il le traduit.
	it('traduit le refus d’autorisation mesuré, sans avoir éteint aucune commande', async () => {
		monter(
			client({ rpc: { data: null, error: { message: 'forbidden' }, status: 403 } }),
			DRISS,
		)

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getByTestId('ouvrir-identite'))
		await userEvent.selectOptions(
			await screen.findByTestId('champ-identite-visee'),
			'nouvelle-service',
		)
		await userEvent.click(screen.getByTestId('valider-identite-mail'))

		const alerte = await screen.findByTestId('refus-identite-mail')
		expect(alerte.textContent).toContain('administrateur')
	})

	it('rend le focus à la commande qui a ouvert le formulaire quand on annule', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		const commande = screen.getByTestId('ouvrir-identite')
		await userEvent.click(commande)
		await userEvent.click(await screen.findByTestId('annuler-identite-mail'))

		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByTestId('ouvrir-identite')),
		)
	})
})
