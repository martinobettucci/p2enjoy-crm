// @verifies CRM-060 (docs/BACKLOG.md) — sous-tranche 2 bis : la SURFACE de la suggestion
// @verifies docs/SPEC-contacts.md §8.8.2 (le bloc s'ancre au-dessus de la commande manuelle),
//           §8.8.3 (aucune requête quand il n'y a rien à résoudre), §8.8.4 (les quatre états),
//           §8.8.5 (l'affaire nommée et adressable, la règle écrite, aucune date),
//           §8.8.6 (le geste appelle `classify_message`, le refus laisse le bloc rendu),
//           §8.8.9 (contrat de comportement, cas a à j)
// @verifies docs/DESIGN_SYSTEM.md §5.4 ter (de quoi le bloc a l'air, la hiérarchie des deux
//           actions du pied), §5.4 (un message classé porte sa pilule, non une suggestion)
//
// CES PREUVES MONTENT LE VRAI ÉCRAN avec un client factice, comme `RouteInbox.test.tsx`. Le
// parcours connecté complet relève de `e2e/ui/inbox.spec.ts`, qui exige la pile.
//
// CE QU'ELLES ÉPROUVENT ET QU'AUCUNE PREUVE DE BASE NE PEUT : le RENDU. La règle 3 peut être
// parfaitement juste en base — elle l'est, et `0044_regle3_suggestion.test.sql` le prouve — et
// l'écran n'en montrer aucune trace, ou pire, nommer une affaire que l'appelant n'a pas le droit
// de voir. Seule l'inspection du DOM écarte ces deux défauts.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_SUGGEREE = '5eed0000-0000-4000-8000-0000000000c2'
const CARD_CLASSEE = '5eed0000-0000-4000-8000-0000000000c1'

/**
 * Une ligne de `mail_messages` telle que la base la rend.
 *
 * `suggested_card_id` VIT SUR UN MESSAGE NON CLASSÉ, et jamais ailleurs : l'invariant de la
 * migration 46 le tient en base (`docs/SPEC-contacts.md` §8.3), et ce double le respecte plutôt
 * que de construire un état que la base refuserait.
 */
const ligne = (
	id: string,
	objet: string,
	cardId: string | null,
	suggeree: string | null,
) => ({
	id,
	workspace_id: WORKSPACE,
	card_id: cardId,
	classification: cardId === null ? 'unclassified' : 'auto',
	subject: objet,
	from_address: 'leo.marchand@sogexia.example',
	from_name: 'Léo Marchand',
	received_at: '2026-08-20T08:00:00.000Z',
	references_ids: [],
	rfc822_message_id: `<${id}@sogexia.example>`,
	to_addresses: ['systeme@crm.p2enjoy.test'],
	cc_addresses: [],
	body_text: `Corps de ${objet}`,
	body_html: null,
	sent_at: '2026-08-20T08:00:00.000Z',
	suggested_card_id: suggeree,
})

const SUGGERE = ligne('msg-suggere', 'Point d’avancement', null, CARD_SUGGEREE)
const NON_SUGGERE = ligne('msg-nu', 'Candidature spontanée', null, null)
const CLASSE = ligne('msg-classe', 'Demande de devis', CARD_CLASSEE, null)

/** Ce que le double consent à rendre : la liste des messages, et la lisibilité des affaires. */
let messagesRendus: readonly unknown[] = [SUGGERE]
let affairesLisibles = true
/** Les appels réellement passés — c'est ce qui prouve qu'aucun n'est fait pour rien (§8.8.3). */
let lecturesCards = 0
let classements: Array<{ message: string; card: string }> = []
/** Le refus que `classify_message` doit opposer, ou `null` pour un succès. */
let refusClassement: { code: string; status: number } | null = null

/**
 * Le client factice — il rend ce que la base rendrait.
 *
 * IL EST CONSTRUIT UNE SEULE FOIS, et c'est une contrainte du produit et non une commodité :
 * `useLecture` prend le client dans ses dépendances d'effet, si bien qu'un double reconstruit à
 * chaque accès relancerait la lecture sans fin (`RouteInbox.test.tsx`, mesure de la décision 470).
 */
function clientFactice() {
	const reponse = (data: unknown) => Promise.resolve({ data, error: null, status: 200 })
	return {
		rpc: (nom: string, args?: Record<string, string>) => {
			if (nom === 'inbox_arborescence') {
				return reponse([
					{
						track_id: 'track-1',
						track_name: 'Conseil & IA',
						channel_id: 'channel-1',
						channel_name: 'Grands comptes',
						card_id: CARD_CLASSEE,
						card_title: 'Refonte du site vitrine',
						nombre: messagesRendus.length,
					},
				])
			}
			if (nom === 'classify_message') {
				classements.push({
					message: args?.p_message_id ?? '',
					card: args?.p_card_id ?? '',
				})
				if (refusClassement !== null) {
					return Promise.resolve({
						data: null,
						error: { code: refusClassement.code, message: 'refus' },
						status: refusClassement.status,
					})
				}
				return reponse(null)
			}
			return reponse(null)
		},
		from: (table: string) => {
			if (table === 'mail_messages') {
				const chaine = {
					is: () => chaine,
					eq: (colonne: string, valeur: string) =>
						colonne === 'id'
							? {
									limit: () =>
										reponse(messagesRendus.filter((m) => (m as { id: string }).id === valeur)),
								}
							: chaine,
					order: () => chaine,
					limit: () => reponse(messagesRendus),
					then: undefined,
				}
				return { select: () => chaine }
			}
			if (table === 'mail_thread_snoozes') return { select: () => reponse([]) }
			if (table === 'mail_attachments') {
				return { select: () => ({ eq: () => ({ order: () => reponse([]) }) }) }
			}
			if (table === 'cards') {
				lecturesCards += 1
				return {
					select: () => ({
						eq: () => ({
							limit: () =>
								reponse(
									affairesLisibles
										? [{ id: CARD_SUGGEREE, title: 'Migration ERP Sogexia', channel_id: 'channel-1' }]
										: [],
								),
						}),
						is: () => ({ is: () => ({ order: () => ({ limit: () => reponse([]) }) }) }),
						then: undefined,
					}),
				}
			}
			if (table === 'channels') {
				return {
					select: () => ({
						eq: () => ({ limit: () => reponse([{ slug: 'grands-comptes', track_id: 'track-1' }]) }),
					}),
				}
			}
			if (table === 'tracks') {
				return { select: () => ({ eq: () => ({ limit: () => reponse([{ slug: 'conseil-ia' }]) }) }) }
			}
			return {
				select: () => ({
					eq: () => ({ limit: () => reponse([]) }),
					is: () => ({ is: () => ({ order: () => ({ limit: () => reponse([]) }) }) }),
					then: undefined,
				}),
			}
		},
	}
}

const CLIENT = clientFactice()

vi.mock('../lib/supabase', () => ({ clientCrm: CLIENT }))

const { RouteInbox } = await import('./RouteInbox')

beforeEach(() => {
	messagesRendus = [SUGGERE]
	affairesLisibles = true
	lecturesCards = 0
	classements = []
	refusClassement = null
})

afterEach(cleanup)

async function ouvrirLeMessage() {
	render(
		<MemoryRouter>
			<RouteInbox />
		</MemoryRouter>,
	)
	await userEvent.click(await screen.findByRole('button', { name: /Non classés/ }))
	await userEvent.click((await screen.findAllByTestId('inbox-message'))[0] as HTMLElement)
	await waitFor(() => expect(screen.getByTestId('inbox-message-ouvert')).not.toBeNull())
}

describe('L’inbox montre la suggestion du classement assisté (§8.8)', () => {
	it('cas c — nomme l’affaire suggérée, l’adresse, et écrit la RÈGLE en toutes lettres', async () => {
		await ouvrirLeMessage()

		const bloc = await screen.findByTestId('inbox-suggestion')
		const lien = screen.getByTestId('inbox-suggestion-card')
		expect(lien.textContent).toBe('Migration ERP Sogexia')
		// ADRESSABLE, ET PAS SEULEMENT NOMMÉE (§8.8.5) : vérifier une suggestion suppose de pouvoir
		// ouvrir l'affaire qu'elle désigne.
		expect(lien.getAttribute('href')).toBe(
			`/tracks/conseil-ia/grands-comptes/cards/${CARD_SUGGEREE}`,
		)
		expect(bloc.textContent).toContain('L’expéditeur est un contact rattaché à cette affaire.')
	})

	it('cas j — n’affiche AUCUNE date : `suggested_at` daterait l’indice, pas l’affaire', async () => {
		await ouvrirLeMessage()

		const bloc = await screen.findByTestId('inbox-suggestion')
		// Ni la date de suggestion, ni un score : la règle 3 n'en produit aucun (§8.8.5).
		expect(bloc.textContent ?? '').not.toMatch(/\d{2}\/\d{2}\/\d{4}/)
		expect(bloc.textContent ?? '').not.toMatch(/%/)
	})

	it('cas b — un message non classé SANS suggestion ne rend aucun bloc, et l’écran d’avant est intact', async () => {
		messagesRendus = [NON_SUGGERE]
		await ouvrirLeMessage()

		expect(screen.queryByTestId('inbox-suggestion')).toBeNull()
		// LA COMMANDE MANUELLE RETROUVE SA VARIANTE PRIMAIRE (docs/DESIGN_SYSTEM.md §5.4 ter) :
		// seule action du pied, elle en est le chemin principal.
		expect(screen.getByTestId('inbox-classer').className).toContain('bg-brand')
		// AUCUNE REQUÊTE QUAND IL N'Y A RIEN À RÉSOUDRE (§8.8.3).
		expect(lecturesCards).toBe(0)
	})

	it('cas a — un message CLASSÉ ne rend aucun bloc : le pied porte alors sa pilule', async () => {
		messagesRendus = [CLASSE]
		await ouvrirLeMessage()

		await waitFor(() => expect(screen.queryByTestId('inbox-pilule-card')).not.toBeNull())
		expect(screen.queryByTestId('inbox-suggestion')).toBeNull()
	})

	it('cas d — une suggestion dont l’affaire est ILLISIBLE ne rend rien, et ne la nomme pas', async () => {
		affairesLisibles = false
		await ouvrirLeMessage()

		// L'ÉCRAN NE NOMME JAMAIS CE QU'IL CACHE (§8.8.4) : ni bloc, ni mention, ni identifiant.
		// Écrire « une affaire vous est suggérée » divulguerait son existence par la bande.
		await waitFor(() => expect(screen.getByTestId('inbox-classer')).not.toBeNull())
		expect(screen.queryByTestId('inbox-suggestion')).toBeNull()
		expect(screen.getByTestId('inbox-message-ouvert').textContent ?? '').not.toContain(CARD_SUGGEREE)
		// LE CHEMIN MANUEL RESTE OFFERT, et il est alors le seul : sa variante le dit.
		expect(screen.getByTestId('inbox-classer').className).toContain('bg-brand')
	})

	it('le bloc s’ancre AU-DESSUS de la commande manuelle, qui passe en secondaire', async () => {
		await ouvrirLeMessage()

		const bloc = await screen.findByTestId('inbox-suggestion')
		const manuelle = screen.getByTestId('inbox-classer')
		// L'ORDRE PORTE UN SENS (§8.8.2) : la suggestion est le chemin court, la commande manuelle
		// celui qui marche toujours. `compareDocumentPosition` lit l'ordre du document, non le style.
		expect(bloc.compareDocumentPosition(manuelle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		// DEUX PRIMAIRES NE DIRAIENT PLUS LEQUEL EST LE CHEMIN PRINCIPAL (§5.4 ter).
		expect(manuelle.className).toContain('bg-surface')
		expect(screen.getByTestId('inbox-suggestion-accepter').className).toContain('bg-brand')
	})

	it('cas e — accepter appelle `classify_message` avec l’affaire SUGGÉRÉE, sans contrat nouveau', async () => {
		await ouvrirLeMessage()

		await userEvent.click(await screen.findByTestId('inbox-suggestion-accepter'))

		await waitFor(() => expect(classements).toHaveLength(1))
		expect(classements[0]).toEqual({ message: 'msg-suggere', card: CARD_SUGGEREE })
	})

	it('cas g — un refus s’écrit DANS le bloc, qui reste rendu', async () => {
		refusClassement = { code: '42501', status: 403 }
		await ouvrirLeMessage()

		await userEvent.click(await screen.findByTestId('inbox-suggestion-accepter'))

		const mention = await screen.findByTestId('inbox-suggestion-refus')
		// LE REFUS EST CELUI DU CLASSEMENT MANUEL, MOT POUR MOT (§8.8.6) : un même refus ne se
		// formule pas de deux façons selon le bouton qui l'a demandé.
		expect(mention.textContent).toBe('Vous ne pouvez pas classer ce message dans cette affaire.')
		expect(mention.getAttribute('role')).toBe('alert')
		// DISPARAÎTRE RETIRERAIT LE SEUL ENDROIT OÙ LIRE LA CAUSE.
		expect(screen.getByTestId('inbox-suggestion')).not.toBeNull()
		expect(screen.getByTestId('inbox-suggestion-accepter')).not.toBeNull()
	})

	it('cas i — la commande manuelle reste offerte à côté du bloc, et l’ouvre pour de bon', async () => {
		await ouvrirLeMessage()

		await screen.findByTestId('inbox-suggestion')
		await userEvent.click(screen.getByTestId('inbox-classer'))

		// LE BLOC N'EST JAMAIS UN REMPLACEMENT (§8.8.2) : une suggestion peut désigner la mauvaise
		// affaire, et un écran qui n'offrirait que l'indice enfermerait l'utilisateur.
		expect(await screen.findByTestId('inbox-formulaire-classement')).not.toBeNull()
		expect(screen.getByTestId('inbox-suggestion')).not.toBeNull()
	})
})
