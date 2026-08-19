// @verifies CRM-081 (docs/BACKLOG.md) — sommeil des fils et des cards, tranche 2 f : LE GROUPEMENT
// @verifies docs/SPEC-cards.md §16.16.3 (la liste énumère des fils, le badge n'apparaît qu'au-delà
//           de un), §16.16.4 (ouvrir un fil ouvre son message le plus récent, le sélecteur existe
//           au-delà d'un message et pas en deçà, `aria-current` porté par le FIL du message
//           ouvert), §16.16.6 (le compteur du dossier compte toujours des messages)
// @verifies docs/DESIGN_SYSTEM.md §5.4 bis (de quoi le fil a l'air), §10 (la sélection s'annonce)
//
// Ces preuves montent le VRAI écran avec un client factice, comme `EtatMessagerie.test.tsx`. Le
// parcours connecté complet relève de `e2e/ui/groupement-fils.spec.ts`, qui ne peut pas être
// exécuté sans la pile.
//
// CE QU'ELLES ÉPROUVENT ET QUE `fil-inbox.test.ts` NE PEUT PAS : le RENDU des règles de groupement.
// `grouperEnFils` peut être parfaitement juste et l'écran afficher quand même un badge « 1 », un
// sélecteur sur un fil unique, ou perdre son repère de sélection — trois défauts que seule
// l'inspection du DOM rend visibles.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD = '5eed0000-0000-4000-8000-0000000000c1'

/** Une ligne de `mail_messages` telle que la base la rend, colonnes de liste et de message. */
const ligne = (
	id: string,
	objet: string,
	recuLe: string,
	references: string[],
	messageId: string,
) => ({
	id,
	workspace_id: WORKSPACE,
	card_id: CARD,
	classification: 'classified',
	subject: objet,
	from_address: 'solene@client.test',
	from_name: 'Solène Ferrand',
	received_at: recuLe,
	references_ids: references,
	rfc822_message_id: messageId,
	to_addresses: ['c-abc@crm.p2enjoy.test'],
	cc_addresses: [],
	body_text: `Corps de ${objet}`,
	body_html: null,
	sent_at: recuLe,
})

const RACINE = ligne(
	'msg-racine',
	'Demande de devis',
	'2026-08-19T08:00:00.000Z',
	[],
	'<racine@client.test>',
)
const REPONSE = ligne(
	'msg-reponse',
	'Re: Demande de devis',
	'2026-08-19T09:00:00.000Z',
	['<racine@client.test>'],
	'<reponse@client.test>',
)

/**
 * Le client factice — il rend ce que la base rendrait, dans l'ORDRE où elle le rendrait.
 *
 * L'ORDRE EST PART DU CONTRAT, ET NON UN DÉTAIL DE MONTAGE : la mesure 10 du §16.16.1 établit que
 * la page arrive triée par récence, et c'est de là que `grouperEnFils` tire son ordre de fils. Un
 * double qui rendrait les lignes dans un autre ordre éprouverait un écran que la base ne produit
 * jamais.
 */
function clientFactice(lireMessages: () => readonly unknown[]) {
	const reponse = (data: unknown) => Promise.resolve({ data, error: null, status: 200 })
	return {
		rpc: (nom: string) =>
			nom === 'inbox_arborescence'
				? reponse([
						{
							track_id: 'track-1',
							track_name: 'Conseil & IA',
							channel_id: 'channel-1',
							channel_name: 'Grands comptes',
							card_id: CARD,
							card_title: 'Refonte du site vitrine',
							nombre: lireMessages().length,
						},
					])
				: reponse(null),
		from: (table: string) => {
			if (table === 'mail_messages') {
				const chaine = {
					is: () => chaine,
					eq: (colonne: string, valeur: string) =>
						colonne === 'id'
							? {
									limit: () =>
										reponse(lireMessages().filter((m) => (m as { id: string }).id === valeur)),
								}
							: chaine,
					order: () => chaine,
					limit: () => reponse(lireMessages()),
					then: undefined,
				}
				return { select: () => chaine }
			}
			if (table === 'mail_thread_snoozes') return { select: () => reponse([]) }
			if (table === 'mail_attachments') {
				return { select: () => ({ eq: () => ({ order: () => reponse([]) }) }) }
			}
			// `cards`, `channels`, `tracks` : la pilule de l'affaire. Aucune ligne rendue, donc
			// aucune pilule — elle n'est pas l'objet de ces preuves, et le §5.4 prévoit son absence.
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

let messagesRendus: readonly unknown[] = [REPONSE, RACINE]

// LE CLIENT EST UN SINGLETON, ET C'EST UNE CONTRAINTE DU PRODUIT, NON UNE COMMODITÉ DE TEST.
// `useLecture` prend `client` dans ses dépendances d'effet (`webapp/src/lib/inbox.ts`) : un double
// reconstruit à chaque accès change d'identité à chaque rendu, relance la lecture, provoque un
// rendu, et l'écran boucle sans fin. MESURÉ : la première rédaction de ce fichier employait un
// accesseur `get clientCrm()`, et la suite ne rendait plus la main. Le double est donc construit
// UNE fois et lit ses messages à l'appel.
const CLIENT = clientFactice(() => messagesRendus)

vi.mock('../lib/supabase', () => ({ clientCrm: CLIENT }))

const { RouteInbox } = await import('./RouteInbox')

afterEach(cleanup)

async function ouvrirLeDossier() {
	render(
		<MemoryRouter>
			<RouteInbox />
		</MemoryRouter>,
	)
	const dossier = await screen.findByRole('button', { name: /Refonte du site vitrine/ })
	await userEvent.click(dossier)
	return dossier
}

describe('RouteInbox — le groupement en fils (§16.16)', () => {
	it('rend UNE ligne pour deux messages d’un même fil, et le badge porte son compte', async () => {
		messagesRendus = [REPONSE, RACINE]
		await ouvrirLeDossier()

		const lignes = await screen.findAllByTestId('inbox-message')
		expect(lignes).toHaveLength(1)
		// LA LIGNE PORTE L'OBJET DU DERNIER MESSAGE (§16.16.3), non celui de la racine.
		expect(lignes[0]?.textContent ?? '').toContain('Re: Demande de devis')

		const compte = screen.getByTestId('inbox-fil-compte')
		expect(compte.textContent).toBe('2')
		// UNE PHRASE ENTIÈRE EN NOM ACCESSIBLE (§5.4 bis) : un chiffre nu ne dit pas ce qu'il compte.
		expect(compte.getAttribute('aria-label')).toBe('2 messages dans ce fil')
	})

	it('N’AFFICHE AUCUN BADGE sur un fil d’un seul message — un « 1 » serait du bruit', async () => {
		messagesRendus = [RACINE]
		await ouvrirLeDossier()

		expect(await screen.findAllByTestId('inbox-message')).toHaveLength(1)
		expect(screen.queryByTestId('inbox-fil-compte')).toBeNull()
	})

	it('ouvre le message le plus RÉCENT du fil, et rend son sélecteur', async () => {
		messagesRendus = [REPONSE, RACINE]
		await ouvrirLeDossier()

		await userEvent.click((await screen.findAllByTestId('inbox-message'))[0] as HTMLElement)

		// OUVRIR UN FIL OUVRE SON DERNIER MESSAGE (§16.16.4) : celui dont la ligne affiche l'objet.
		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Re: Demande de devis'),
		)
		expect(screen.getByTestId('inbox-fil-selecteur')).not.toBeNull()
		expect(screen.getAllByTestId('inbox-fil-message')).toHaveLength(2)
	})

	it('N’AFFICHE AUCUN SÉLECTEUR sur un fil d’un seul message — l’écran d’avant, inchangé', async () => {
		messagesRendus = [RACINE]
		await ouvrirLeDossier()

		await userEvent.click((await screen.findAllByTestId('inbox-message'))[0] as HTMLElement)
		await waitFor(() => expect(screen.getByTestId('inbox-message-ouvert')).not.toBeNull())
		expect(screen.queryByTestId('inbox-fil-selecteur')).toBeNull()
	})

	it('GARDE LE REPÈRE DE SÉLECTION quand le sélecteur ouvre un message plus ancien du fil', async () => {
		messagesRendus = [REPONSE, RACINE]
		await ouvrirLeDossier()

		await userEvent.click((await screen.findAllByTestId('inbox-message'))[0] as HTMLElement)
		await waitFor(() => expect(screen.getByTestId('inbox-fil-selecteur')).not.toBeNull())

		// LE SECOND MESSAGE DU SÉLECTEUR, dans l'ordre de la liste : la racine.
		await userEvent.click(screen.getAllByTestId('inbox-fil-message')[1] as HTMLElement)
		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Demande de devis'),
		)

		// C'EST LE DÉFAUT QUE CE TEST EXISTE POUR ÉCARTER (§16.16.4) : tester l'appartenance sur
		// `dernier` seul ferait perdre `aria-current` à la ligne dès qu'on navigue à l'intérieur du
		// fil qu'on vient de choisir, et le §5.4 refuse une sélection qui désigne une ligne
		// qu'aucun repère ne montre.
		expect(screen.getAllByTestId('inbox-message')[0]?.getAttribute('aria-current')).toBe('true')
		// ET LA LIGNE NE BOUGE PAS : elle montre toujours le dernier message du fil.
		expect(screen.getAllByTestId('inbox-message')[0]?.textContent ?? '').toContain('Re: Demande de devis')
	})
})
