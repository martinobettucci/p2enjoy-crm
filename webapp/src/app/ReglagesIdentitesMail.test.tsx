// @verifies CRM-136 (docs/BACKLOG.md) — tranche T3 : le quota lu et toujours envoyé avec son drapeau (§25.6)
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
// @verifies CRM-093 (docs/BACKLOG.md) — tranche T4 : la boîte système et celles des autres s'éteignent avec leur motif
//           quand la base refuse l'administration ; la sienne reste offerte (famille P) ; docs/SPEC-droits-interface.md
//           §4, §5 (« Comptes entrants, identités mail ») ; docs/DESIGN_SYSTEM.md §5.59
// @verifies INC-335 (docs/BACKLOG.md, correctif de la décision 805, T2) — chaque ligne nomme son propriétaire, et la case
//           dit ce qu'elle règle selon l'identité visée (docs/SPEC-mail-subsystem.md §22.14 ; docs/DESIGN_SYSTEM.md §5.35)
// @verifies CRM-127 (docs/BACKLOG.md) — tranche T4 : « Tester la connexion » sur chaque identité, nommée par son adresse,
//           le test `outbound`, le verdict sous la ligne et la liste relue, l'incident d'une identité en erreur, `pending`
//           lu « Non testée » ; docs/SPEC-mail-subsystem.md §23.5 ; docs/DESIGN_SYSTEM.md §5.93

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ReglagesIdentitesMail } from './ReglagesIdentitesMail'
import { FournisseurEspace } from './ContexteEspace'
import type { Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import type { AccesTest } from '../lib/test-connexion-mail'

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
		proprietaire: { full_name: 'Driss Lemoine' },
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
		proprietaire: null,
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
		// `pending` se lit « Non testée » depuis CRM-127 T4 (§23.5).
		expect(screen.getByText('Non testée')).toBeTruthy()
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

	// INC-335 (décision 805) : une administratrice lit le service et chaque personne, chacun avec son défaut. La pilule ne
	// se lit qu'avec son propriétaire, que chaque ligne nomme (§22.14).
	it('nomme le propriétaire de chaque ligne : « Service », ou le nom de la personne', async () => {
		monter(client({
			identites: {
				data: [
					{ ...IDENTITES[0]! },
					{ ...IDENTITES[1]!, is_default: true },
					{ ...IDENTITES[0]!, id: 'i-3', owner_id: CAMILLE, from_address: 'admin@p2enjoy.test', proprietaire: { full_name: 'Camille Aubert' } },
					{ ...IDENTITES[0]!, id: 'i-4', owner_id: 'inconnu', from_address: 'x@p2enjoy.test', is_default: false, proprietaire: null },
				],
				error: null,
				status: 200,
			},
		}))

		await screen.findByTestId('liste-identites-mail')
		const proprietaires = screen.getAllByTestId('proprietaire-identite').map((element) => element.textContent)
		expect(proprietaires).toEqual(['Driss Lemoine', 'Service', 'Camille Aubert', 'Propriétaire non lisible'])
		expect(screen.getAllByText('Par défaut')).toHaveLength(3)
		const ligneService = screen.getAllByTestId('ligne-identite-mail')[1]!
		expect(ligneService.textContent).toContain('Service')
		expect(ligneService.textContent).toContain('Par défaut')
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
	// RÉVISÉE PAR `CRM-136` T3 (décision 51), non relâchée : le quota, devenu effaçable (`0178`), est lu (§25.6).
	it('ne demande jamais `secret_id`, et lit le quota et la signature', async () => {
		let colonnes = ''
		monter(client({ espionLecture: (c) => (colonnes = c) }))

		await screen.findByTestId('liste-identites-mail')
		expect(colonnes).not.toContain('secret_id')
		expect(colonnes).toContain('daily_quota')
		// `CRM-063` §10.6 — la signature, elle, EST demandée depuis la tranche 3 : l'écran ne peut
		// pas proposer de la modifier sans montrer celle qui est enregistrée. L'assertion qui
		// exigeait son absence est RÉVISÉE en celle qui exige sa présence, jamais retirée.
		expect(colonnes).toContain('signature_text')
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

	// INC-335 (décision 805) : « pour cet expéditeur » disait l'adresse là où la règle porte sur le PROPRIÉTAIRE. La case
	// dit désormais ce qu'elle règle : le défaut d'une personne, ou celui des envois automatiques du service (§22.14).
	it('dit ce que règle la case : le défaut de la personne, ou celui des envois automatiques', async () => {
		monter(client())

		await screen.findByTestId('liste-identites-mail')
		await userEvent.click(screen.getByTestId('ouvrir-identite'))
		expect(await screen.findByText('Identité par défaut de cette personne')).toBeTruthy()

		await userEvent.selectOptions(screen.getByTestId('champ-identite-visee'), 'i-2')
		expect(await screen.findByText('Identité par défaut des envois automatiques')).toBeTruthy()
		expect(screen.queryByText('Identité par défaut de cette personne')).toBeNull()

		await userEvent.selectOptions(screen.getByTestId('champ-identite-visee'), 'nouvelle-service')
		expect(await screen.findByText('Identité par défaut des envois automatiques')).toBeTruthy()

		await userEvent.selectOptions(screen.getByTestId('champ-identite-visee'), 'i-1')
		expect(await screen.findByText('Identité par défaut de cette personne')).toBeTruthy()
		expect(screen.queryByText(/pour cet expéditeur/)).toBeNull()
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
		// RÉVISÉ PAR `CRM-136` T3 (décision 51) : le quota est TOUJOURS envoyé, avec son drapeau (§25.6) ; l'identité de la
		// preuve n'a pas de plafond, et le champ vide renvoie « aucun plafond », sans rien écraser.
		expect('p_daily_quota' in recu).toBe(true)
		expect(recu['p_daily_quota_set']).toBe(true)
		// `CRM-063` §10.4 — la signature est TOUJOURS envoyée depuis que la migration 58 l'a rendue
		// effaçable.
		expect('p_signature_text' in recu).toBe(true)
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

describe('ReglagesIdentitesMail — la capacité d’administration rendue par la base (CRM-093 T4)', () => {
	const monterAvec = (administration: Capacite) =>
		render(
			<MemoryRouter>
				<FournisseurEspace valeur={{ idWorkspace: WORKSPACE, estAdmin: false, capacites: { administration, edition: 'permise' } }}>
					<ReglagesIdentitesMail client={client()} idUtilisateur={DRISS} />
				</FournisseurEspace>
			</MemoryRouter>,
		)
	const ligneDe = (id: string) =>
		document.querySelector(`[data-identite="${id}"] [data-testid="configurer-identite"]`) as HTMLButtonElement

	it('refusée : la ligne système s’éteint et cite le motif ; la sienne reste offerte', async () => {
		monterAvec('refusee')
		const motif = await screen.findByTestId('motif-identites-mail')
		expect(ligneDe('i-2').disabled).toBe(true)
		expect(ligneDe('i-2').getAttribute('aria-describedby')).toBe(motif.id)
		expect(ligneDe('i-1').disabled).toBe(false)
	})

	it('refusée : le formulaire ouvert sur la sienne s’enregistre ; visant la boîte système, « Enregistrer » s’éteint', async () => {
		monterAvec('refusee')
		await screen.findAllByTestId('configurer-identite')
		await userEvent.click(ligneDe('i-1'))
		expect((screen.getByTestId('valider-identite-mail') as HTMLButtonElement).disabled).toBe(false)
		await userEvent.selectOptions(screen.getByTestId('champ-identite-visee'), 'i-2')
		const valider = screen.getByTestId('valider-identite-mail') as HTMLButtonElement
		expect(valider.disabled).toBe(true)
		expect(valider.getAttribute('aria-describedby')).toBe(screen.getByTestId('motif-identites-mail').id)
	})

	it('permise ou inconnue : rien n’est éteint, aucun motif', async () => {
		for (const administration of ['permise', 'inconnue'] as const) {
			monterAvec(administration)
			await waitFor(() => expect(ligneDe('i-2')).not.toBeNull())
			expect(ligneDe('i-2').disabled).toBe(false)
			expect(screen.queryByTestId('motif-identites-mail')).toBeNull()
			cleanup()
		}
	})
})

describe('ReglagesIdentitesMail — « Tester la connexion » (CRM-127 T4)', () => {
	it('teste l’identité par son adresse, écrit le verdict sous la ligne et relit la liste', async () => {
		let lectures = 0
		const relue = IDENTITES.map((identite) => (identite.id === 'i-2' ? { ...identite, status: 'ok', last_error: null } : identite))
		const c = client() as unknown as { from: (table: string) => unknown }
		const de = c.from.bind(c)
		c.from = (table: string) =>
			table === 'mail_outbound_identities'
				? { select: () => ({ order: () => Promise.resolve({ data: lectures++ === 0 ? IDENTITES : relue, error: null, status: 200 }) }) }
				: de(table)
		const appels: unknown[] = []
		const acces: AccesTest = {
			url: 'http://crm.test',
			cleAnonyme: 'anon',
			jeton: () => 'jwt',
			requete: async (_url, init) => {
				appels.push(JSON.parse(String(init?.body)))
				return new Response(JSON.stringify({ status: 'ok', error: null, checked_at: 't' }), { status: 200 })
			},
		}
		render(
			<MemoryRouter>
				<ReglagesIdentitesMail client={c as unknown as ClientCrm} accesTest={acces} idUtilisateur={CAMILLE} />
			</MemoryRouter>,
		)
		await screen.findAllByTestId('tester-connexion')
		const ligne = () => document.querySelector('[data-identite="i-2"]') as HTMLElement
		const commande = ligne().querySelector('[data-testid="tester-connexion"]') as HTMLButtonElement
		expect(commande.getAttribute('aria-label')).toBe('Tester la connexion de systeme@crm.p2enjoy.test')
		expect(ligne().querySelector('[data-testid="incident-identite"]')?.textContent).toBe('Authentification refusée')

		await userEvent.click(commande)
		expect(appels).toEqual([{ target: 'outbound', id: 'i-2' }])
		await waitFor(() => expect(ligne().textContent).toContain('Connectée'))
		expect(lectures).toBe(2)
		expect(ligne().querySelector('[data-testid="verdict-test-connexion"]')?.textContent).toBe('Connexion réussie.')
		// Relue sans erreur, la ligne ne porte plus d'incident : l'écran dit ce que la base retient.
		expect(ligne().querySelector('[data-testid="incident-identite"]')).toBeNull()
	})
})
