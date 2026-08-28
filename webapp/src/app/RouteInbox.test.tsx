// @verifies CRM-081 (docs/BACKLOG.md) — sommeil des fils et des cards, tranche 2 f : LE GROUPEMENT
// @verifies docs/SPEC-cards.md §16.16.3 (la liste énumère des fils, le badge n'apparaît qu'au-delà
//           de un), §16.16.4 (ouvrir un fil ouvre son message le plus récent, le sélecteur existe
//           au-delà d'un message et pas en deçà, `aria-current` porté par le FIL du message
//           ouvert), §16.16.6 (le compteur du dossier compte toujours des messages)
// @verifies docs/DESIGN_SYSTEM.md §5.4 bis (de quoi le fil a l'air), §10 (la sélection s'annonce)
// @verifies CRM-065 (docs/BACKLOG.md) — sous-tranche 2c : l'inbox adressable
// @verifies docs/SPEC-recherche.md §15 (le paramètre est lu au montage et une seule fois, le
//           `card_id` décide du dossier, l'identifiant inconnu ne rend AUCUNE erreur), §15.1 (le
//           paramètre est retiré même quand il n'est pas honoré), M16 (les deux cas de classement)
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
import { MemoryRouter, useLocation } from 'react-router'

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
 * Un message NON CLASSÉ — l'autre moitié de M16, et le seed porte réellement les deux cas.
 *
 * Une amorce qui ne vaudrait que pour les messages classés laisserait la moitié de la famille
 * `message` de la palette sans dossier ; c'est cette ligne qui l'éprouve.
 */
const NON_CLASSE = {
	...ligne('msg-libre', 'Prise de contact', '2026-08-19T10:00:00.000Z', [], '<libre@client.test>'),
	card_id: null,
	classification: 'unclassified',
}

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
		rpc: (nom: string) => {
			// `CRM-055` tranche 2 §16.5.5 — le RETRAIT. Le double rend ce que PostgREST rendrait :
			// `data` porte la card quittée en cas de succès, et `error` porte le code de refus.
			// C'est la seule voie par laquelle ces preuves peuvent éprouver la TRADUCTION du refus,
			// qui est précisément ce que la décision 535 a montré fautif ailleurs.
			if (nom === 'unclassify_message') {
				return refusRetrait === null
					? reponse(CARD)
					: Promise.resolve({ data: null, error: { code: undefined, message: 'refus' }, status: refusRetrait })
			}
			return nom === 'inbox_arborescence'
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
				: reponse(null)
		},
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

/** `null` = le retrait réussit ; un nombre = le statut HTTP que le serveur oppose. */
let refusRetrait: number | null = null

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

// =================================================================================================
// CRM-065 sous-tranche 2c — l'inbox adressable, docs/SPEC-recherche.md §15 et §15.1
// =================================================================================================

/**
 * Le témoin d'adresse — il rend la chaîne de requête pour que la preuve la LISE.
 *
 * Sans lui, le retrait du paramètre ne se vérifierait que par son effet indirect, c'est-à-dire pas
 * du tout : un écran qui ouvre le bon message ET garde le paramètre passerait toutes les autres
 * assertions de ce fichier. Or c'est ce paramètre resté qui rouvrirait le message au rechargement.
 */
function TemoinAdresse() {
	return <span data-testid="temoin-adresse">{useLocation().search}</span>
}

function ouvrirParAdresse(adresse: string) {
	render(
		<MemoryRouter initialEntries={[adresse]}>
			<RouteInbox />
			<TemoinAdresse />
		</MemoryRouter>,
	)
}

const adresse = () => screen.getByTestId('temoin-adresse').textContent

describe('RouteInbox — le paramètre `message` de l’adresse (§15)', () => {
	it('OUVRE LE MESSAGE DÉSIGNÉ et sélectionne le dossier de son affaire', async () => {
		messagesRendus = [REPONSE, RACINE]
		ouvrirParAdresse('/inbox?message=msg-racine')

		// LE MESSAGE DEMANDÉ EST OUVERT, et c'est bien celui de l'adresse — non le dernier du fil :
		// l'utilisateur a cherché CE message dans la palette, ouvrir sa réponse lui montrerait autre
		// chose que ce qu'il a choisi.
		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Demande de devis'),
		)

		// LE DOSSIER SUIT LE `card_id` DU MESSAGE (M16) : on arrive dans l'affaire, pas ailleurs.
		const dossier = screen.getByRole('button', { name: /Refonte du site vitrine/ })
		expect(dossier.getAttribute('aria-current')).toBe('true')
	})

	it('MÈNE AUX « NON CLASSÉS » quand le message n’a pas d’affaire — l’autre moitié de M16', async () => {
		messagesRendus = [NON_CLASSE]
		ouvrirParAdresse('/inbox?message=msg-libre')

		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Prise de contact'),
		)
		expect(
			screen.getByRole('button', { name: /Non classés/ }).getAttribute('aria-current'),
		).toBe('true')
	})

	it('RETIRE LE PARAMÈTRE DE L’ADRESSE une fois honoré', async () => {
		messagesRendus = [REPONSE, RACINE]
		ouvrirParAdresse('/inbox?message=msg-racine')

		await waitFor(() => expect(adresse()).toBe(''))
	})

	it('UN IDENTIFIANT INCONNU N’EST PAS UNE ERREUR : la boîte s’ouvre sans sélection', async () => {
		messagesRendus = [REPONSE, RACINE]
		ouvrirParAdresse('/inbox?message=msg-inexistant')

		// L'ÉTAT EST CELUI D'UNE ARRIVÉE SANS PARAMÈTRE : aucun message ouvert, aucun dossier
		// choisi, et surtout AUCUN bandeau d'erreur — un refus ne se distingue pas d'une absence.
		await waitFor(() => expect(adresse()).toBe(''))
		expect(screen.queryByTestId('inbox-message-ouvert')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
		expect(
			screen.getByRole('button', { name: /Refonte du site vitrine/ }).getAttribute('aria-current'),
		).toBeNull()
	})

	it('RETIRE LE PARAMÈTRE MÊME QUAND IL N’EST PAS HONORÉ (§15.1)', async () => {
		messagesRendus = [REPONSE, RACINE]
		ouvrirParAdresse('/inbox?message=msg-inexistant')

		// LE RETRAIT EST DÉCIDÉ PAR LE TRAITEMENT, JAMAIS PAR LE SUCCÈS : un paramètre laissé après
		// un refus dirait qu'il s'est passé là quelque chose que l'écran ne montre pas.
		await waitFor(() => expect(adresse()).toBe(''))
	})

	it('CONSERVE LES AUTRES PARAMÈTRES de l’adresse, et ne retire que le sien', async () => {
		messagesRendus = [REPONSE, RACINE]
		ouvrirParAdresse('/inbox?vue=large&message=msg-racine')

		await waitFor(() => expect(adresse()).toBe('?vue=large'))
	})

	it('NE LIT LE PARAMÈTRE QU’UNE SEULE FOIS : naviguer dans le fil ne ramène pas au départ', async () => {
		messagesRendus = [REPONSE, RACINE]
		ouvrirParAdresse('/inbox?message=msg-racine')

		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Demande de devis'),
		)
		await waitFor(() => expect(screen.queryByTestId('inbox-fil-selecteur')).not.toBeNull())

		// LE PREMIER MESSAGE DU SÉLECTEUR, dans l'ordre de la liste : la réponse, la plus récente.
		await userEvent.click(screen.getAllByTestId('inbox-fil-message')[0] as HTMLElement)
		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Re: Demande de devis'),
		)

		// C'EST LE DÉFAUT QUE CE TEST EXISTE POUR ÉCARTER (§15) : un paramètre relu à chaque rendu
		// ramènerait l'utilisateur au message de départ à chaque clic, et l'écran deviendrait
		// impossible à quitter. L'assertion tient parce qu'elle attend APRÈS le clic — un retour au
		// message d'origine se produirait au rendu suivant.
		await new Promise((resoudre) => setTimeout(resoudre, 50))
		expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Re: Demande de devis')
	})
})

// @verifies CRM-055 tranche 2 (docs/BACKLOG.md) — le RETRAIT d'un message de son affaire
// @verifies docs/SPEC-mail-subsystem.md §16.5.5 (la commande, sa confirmation dans le flux, la
//           conséquence nommée, le dictionnaire fermé) ; docs/DESIGN_SYSTEM.md §5.3 quater
//
// CE QUE CES PREUVES ÉPRAUVENT ET QUE L'E2E NE MONTRERAIT PAS AUSSI FINEMENT : la TRADUCTION du
// refus. Un écran qui envoie et reçoit `403` peut afficher n'importe quelle phrase, et c'est
// exactement le défaut que la décision 535 a trouvé sur les objectifs — une confirmation qui
// décrivait le geste inverse. Ici l'assertion porte sur le TEXTE RENDU, jamais sur la clé.
describe('RouteInbox — retirer un message de son affaire (§16.5.5)', () => {
	afterEach(() => {
		refusRetrait = null
		messagesRendus = [REPONSE, RACINE]
	})

	/** Le dossier, puis le message : le panneau de lecture n'existe qu'une fois un message ouvert. */
	async function ouvrirLeMessage() {
		await ouvrirLeDossier()
		await userEvent.click((await screen.findAllByTestId('inbox-message'))[0] as HTMLElement)
		await waitFor(() => expect(screen.queryByTestId('inbox-message-ouvert')).not.toBeNull())
	}

	it('offre la commande sur un message CLASSÉ, sans rien envoyer avant confirmation', async () => {
		await ouvrirLeMessage()
		await waitFor(() => expect(screen.queryByTestId('inbox-retirer')).not.toBeNull())

		// AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE : le bouton est offert, et actif.
		const commande = screen.getByTestId('inbox-retirer') as HTMLButtonElement
		expect(commande.disabled).toBe(false)

		await userEvent.click(commande)
		// LE PREMIER CLIC N'AGIT PAS : il ouvre la confirmation, et rien d'autre.
		expect(screen.queryByTestId('inbox-retrait-confirmation')).not.toBeNull()
		expect(screen.queryByTestId('inbox-retirer')).toBeNull()
	})

	it('N’OFFRE PAS la commande sur un message NON CLASSÉ : il n’a aucune affaire à quitter', async () => {
		messagesRendus = [NON_CLASSE]
		render(
			<MemoryRouter>
				<RouteInbox />
			</MemoryRouter>,
		)
		const dossiers = await screen.findAllByRole('button', { name: /Non classés/ })
		await userEvent.click(dossiers[0] as HTMLElement)
		await userEvent.click((await screen.findAllByTestId('inbox-message'))[0] as HTMLElement)
		await waitFor(() => expect(screen.queryByTestId('inbox-classer')).not.toBeNull())
		expect(screen.queryByTestId('inbox-retirer')).toBeNull()
	})

	it('nomme la CONSÉQUENCE du geste, et pas seulement le geste', async () => {
		await ouvrirLeMessage()
		await waitFor(() => expect(screen.queryByTestId('inbox-retirer')).not.toBeNull())
		await userEvent.click(screen.getByTestId('inbox-retirer'))

		const bloc = screen.getByTestId('inbox-retrait-confirmation')
		// La phrase dit que rien n'est supprimé — un retrait n'est pas une destruction…
		expect(bloc.textContent).toContain('Rien n’est supprimé')
		// …et elle énonce la CONDITION de la perte de visibilité (§16.5.2, mesure 2), sans deviner
		// un rôle que l'écran n'a pas le droit de déduire.
		expect(bloc.textContent).toContain('vous ne le verrez plus')
	})

	it('ANNULER referme sans rien envoyer et rend le focus à la commande', async () => {
		await ouvrirLeMessage()
		await waitFor(() => expect(screen.queryByTestId('inbox-retirer')).not.toBeNull())
		await userEvent.click(screen.getByTestId('inbox-retirer'))
		await userEvent.click(screen.getByTestId('inbox-retirer-annuler'))

		await waitFor(() => expect(screen.queryByTestId('inbox-retrait-confirmation')).toBeNull())
		// LE FOCUS NE RESTE PAS SUR UN BOUTON DISPARU : annuler au clavier ne perd pas la place de
		// l'utilisateur dans le document (§5.13).
		expect(document.activeElement).toBe(screen.getByTestId('inbox-retirer'))
	})

	it('TRADUIT le refus par le dictionnaire DU RETRAIT, jamais par celui du classement', async () => {
		refusRetrait = 403
		await ouvrirLeMessage()
		await waitFor(() => expect(screen.queryByTestId('inbox-retirer')).not.toBeNull())
		await userEvent.click(screen.getByTestId('inbox-retirer'))
		await userEvent.click(screen.getByTestId('inbox-retirer-valider'))

		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe('Vous ne pouvez pas retirer ce message de cette affaire.')
		// C'EST LA MOITIÉ QUI COMPTE : le texte du classement décrirait le geste INVERSE de celui
		// qui vient d'être tenté, et enverrait l'utilisateur corriger ce qui n'est pas en cause.
		expect(alerte.textContent).not.toContain('classer')
		// ET LA CONFIRMATION RESTE OUVERTE : un refus n'est pas un succès, l'écran ne referme pas.
		expect(screen.queryByTestId('inbox-retrait-confirmation')).not.toBeNull()
	})
})
