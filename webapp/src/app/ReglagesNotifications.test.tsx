// @verifies CRM-064 (docs/BACKLOG.md) — tranche 4 : les préférences
// @verifies docs/SPEC-notifications.md §43.4 (l'absence de ligne vaut consentement),
//           §46.3 (l'état retenu par la base), §49 (preuves attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.45 (cette surface : la case dit ce qu'on reçoit, l'écriture
//           est immédiate, la case ne se coche qu'après la réponse, elle n'est JAMAIS désactivée,
//           il n'y a pas d'état vide), §5.7 ter (la mention d'état vit sous la case)
//
// Ces preuves montent le VRAI écran avec un client factice, comme `Corbeille.test.tsx`. Le
// parcours connecté sur la vraie base relève de `e2e/ui/preferences-notifications.spec.ts`.
//
// LA PREUVE LA PLUS UTILE DE CE FICHIER EST CELLE DE LA CASE NON DÉSACTIVÉE. Le réflexe, pendant
// une écriture, est de rendre le contrôle inerte ; le §5.7 ter l'interdit parce qu'un contrôle
// désactivé PERD LE FOCUS DU CLAVIER, et qu'il faut alors retabuler pour se corriger. Aucun test
// de comportement ne verrait cette régression : la case finirait par se cocher de toute façon.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ReglagesNotifications } from './ReglagesNotifications'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type ReponseLecture = {
	data: { type: string; in_app: boolean }[] | null
	error: { message: string } | null
	status: number
}

type ReponseRpc = {
	data: { type: string; in_app: boolean } | null
	error: { message: string; code?: string } | null
	status: number
}

/**
 * Un client factice : une lecture, et une RPC dont la réponse est décidée par le test.
 *
 * `rpcs` retient les appels émis, ce qui permet d'éprouver qu'aucun destinataire n'est envoyé —
 * la propriété que le §46.3 rend impossible côté base, et qu'aucun écran ne doit tenter de
 * contourner.
 */
function clientFactice(lecture: ReponseLecture, rpc: ReponseRpc) {
	const rpcs: { nom: string; arguments: Record<string, unknown> }[] = []
	const client = {
		from: () => ({ select: () => Promise.resolve(lecture) }),
		rpc: (nom: string, args: Record<string, unknown>) => {
			rpcs.push({ nom, arguments: args })
			return Promise.resolve(rpc)
		},
	} as unknown as ClientCrm
	return { client, rpcs }
}

const LECTURE_VIDE: ReponseLecture = { data: [], error: null, status: 200 }

describe('l’écran des préférences de notification (§5.45)', () => {
	// L'ABSENCE DE LIGNE VAUT CONSENTEMENT (§43.4), et c'est l'état d'un compte neuf — donc de
	// TOUT LE MONDE en production le jour du déploiement.
	it('rend la case COCHÉE quand la base ne porte aucune préférence', async () => {
		const { client } = clientFactice(LECTURE_VIDE, {
			data: { type: 'mention', in_app: true },
			error: null,
			status: 200,
		})
		render(<ReglagesNotifications client={client} />)

		const case_ = await screen.findByRole('checkbox', { name: /Recevoir les mentions/ })
		expect((case_ as HTMLInputElement).checked).toBe(true)
	})

	it('rend la case DÉCOCHÉE quand la base porte une coupure', async () => {
		const { client } = clientFactice(
			{ data: [{ type: 'mention', in_app: false }], error: null, status: 200 },
			{ data: { type: 'mention', in_app: false }, error: null, status: 200 },
		)
		render(<ReglagesNotifications client={client} />)

		const case_ = await screen.findByRole('checkbox', { name: /Recevoir les mentions/ })
		expect((case_ as HTMLInputElement).checked).toBe(false)
	})

	// AUCUNE CASE POUR UN CANAL QUI N'EXISTE PAS (§42.1). Une case « par email » serait une
	// commande morte et une promesse fausse : l'utilisateur croirait avoir demandé un email.
	it('n’offre AUCUNE case pour un canal qui n’existe pas', async () => {
		const { client } = clientFactice(LECTURE_VIDE, {
			data: { type: 'mention', in_app: true },
			error: null,
			status: 200,
		})
		render(<ReglagesNotifications client={client} />)

		await screen.findByRole('checkbox', { name: /Recevoir les mentions/ })
		expect(screen.getAllByRole('checkbox')).toHaveLength(1)
		expect(screen.queryByText(/email/i)).toBeNull()
		expect(screen.queryByText(/résumé quotidien/i)).toBeNull()
	})

	// L'ÉCRITURE EST IMMÉDIATE, SANS BOUTON « ENREGISTRER » (§5.7 ter) : un réglage à une seule
	// valeur n'a rien à valider.
	it('écrit dès la bascule, sans bouton d’enregistrement, et sans envoyer de destinataire', async () => {
		const { client, rpcs } = clientFactice(LECTURE_VIDE, {
			data: { type: 'mention', in_app: false },
			error: null,
			status: 200,
		})
		render(<ReglagesNotifications client={client} />)

		const case_ = await screen.findByRole('checkbox', { name: /Recevoir les mentions/ })
		await userEvent.click(case_)

		await waitFor(() => expect((case_ as HTMLInputElement).checked).toBe(false))
		expect(screen.queryByRole('button', { name: /Enregistrer/i })).toBeNull()
		expect(rpcs).toHaveLength(1)
		expect(rpcs[0]?.nom).toBe('definir_preference_notification')
		expect(rpcs[0]?.arguments).toEqual({ p_type: 'mention', p_in_app: false })
	})

	// LA CASE NE SE COCHE QU'APRÈS LA RÉPONSE (§5.45). Ici la base retient VRAI alors que la
	// bascule demandait FAUX : un écran optimiste afficherait une case décochée qui n'existe pas.
	it('affiche l’état que la BASE a retenu, pas celui que la bascule demandait', async () => {
		const { client } = clientFactice(LECTURE_VIDE, {
			data: { type: 'mention', in_app: true },
			error: null,
			status: 200,
		})
		render(<ReglagesNotifications client={client} />)

		const case_ = await screen.findByRole('checkbox', { name: /Recevoir les mentions/ })
		await userEvent.click(case_)

		await waitFor(() => expect(screen.getByText(/Vous recevrez ces notifications/)).toBeTruthy())
		expect((case_ as HTMLInputElement).checked).toBe(true)
	})

	// LA CASE N'EST JAMAIS DÉSACTIVÉE (§5.7 ter) : un contrôle désactivé perd le focus du clavier.
	it('ne DÉSACTIVE JAMAIS la case, ni pendant l’écriture ni après', async () => {
		const { client } = clientFactice(LECTURE_VIDE, {
			data: { type: 'mention', in_app: false },
			error: null,
			status: 200,
		})
		render(<ReglagesNotifications client={client} />)

		const case_ = await screen.findByRole('checkbox', { name: /Recevoir les mentions/ })
		await userEvent.click(case_)
		expect((case_ as HTMLInputElement).disabled).toBe(false)
		await waitFor(() => expect((case_ as HTMLInputElement).checked).toBe(false))
		expect((case_ as HTMLInputElement).disabled).toBe(false)
	})

	// UN REFUS NE FAIT PAS BOUGER LA CASE, et il est NOMMÉ sous elle (§5.7 ter, §5.45). Une case
	// qui aurait bougé puis serait revenue aurait affiché un état qui n'a jamais existé.
	it('nomme le refus SOUS la case, et laisse la case à l’état que la base porte', async () => {
		const { client } = clientFactice(LECTURE_VIDE, {
			data: null,
			error: { message: 'preference_sans_session', code: 'P0001' },
			status: 400,
		})
		render(<ReglagesNotifications client={client} />)

		const case_ = await screen.findByRole('checkbox', { name: /Recevoir les mentions/ })
		await userEvent.click(case_)

		// LE MESSAGE APPARAÎT DEUX FOIS, ET C'EST VOULU : sous la case pour qui regarde, et dans la
		// région vive pour qui écoute (§5.7 ter, §8). Une assertion qui exigerait un unique nœud
		// prendrait l'annonce accessible pour un doublon et pousserait à la retirer.
		await waitFor(() => expect(screen.getAllByText(/session a expiré/).length).toBe(2))
		expect(screen.getByRole('status').textContent).toContain('session a expiré')
		expect((case_ as HTMLInputElement).checked).toBe(true)
	})

	// L'ÉTAT D'ERREUR DE LECTURE PORTE SON ACTION DE REPRISE (§5.8) — jamais une page blanche.
	it('rend l’état d’erreur et son action de reprise quand la lecture échoue', async () => {
		const { client } = clientFactice(
			{ data: null, error: { message: 'boom' }, status: 500 },
			{ data: null, error: null, status: 200 },
		)
		render(<ReglagesNotifications client={client} />)

		await screen.findByText(/n’ont pas pu être chargées|n'ont pas pu être chargées/)
		expect(screen.getByRole('button', { name: /Réessayer/ })).toBeTruthy()
	})

	// SANS CLIENT, L'ÉCRAN NOMME LE PROBLÈME plutôt que de rester en chargement perpétuel.
	it('nomme le problème quand la configuration manque, au lieu d’un sablier sans fin', async () => {
		render(<ReglagesNotifications client={null} />)
		await screen.findByText(/n’ont pas pu être chargées|n'ont pas pu être chargées/)
	})
})
