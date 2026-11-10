// @verifies CRM-137 (docs/BACKLOG.md) — la lecture des affaires candidates : ce qui est envoyé à
//           `classification_candidates`, la ligne de plus qui dit la troncature, la traduction des refus, la présélection
// @verifies docs/SPEC-mail-subsystem.md §26.2, §26.3 ; docs/JOURNAL.md décision 893

import { describe, expect, it } from 'vitest'
import { CANDIDATES_AFFICHEES, lireCandidates, preselection, type Candidate } from './candidats-classement'

type Ligne = { card_id: string; title: string; path: string; known_sender: boolean }

function client(reponse: { data: Ligne[] | null; error: { message: string } | null; status: number }) {
	const appels: { nom: string; args: unknown }[] = []
	return {
		appels,
		client: {
			rpc: (nom: 'classification_candidates', args: unknown) => {
				appels.push({ nom, args })
				return Promise.resolve(reponse)
			},
		},
	}
}

const ligne = (n: number, connue = true): Ligne => ({
	card_id: `c${n}`,
	title: `Affaire ${n}`,
	path: n % 2 === 0 ? '' : 'Conseil IA › Grands comptes',
	known_sender: connue,
})

describe('lireCandidates', () => {
	it('demande une ligne de plus que l’écran n’en montre, avec la case et le terme rogné', async () => {
		const { client: c, appels } = client({ data: [ligne(1)], error: null, status: 200 })
		await lireCandidates(c, { messageId: 'm1', connues: true, terme: '  vitri ' })
		expect(appels).toEqual([
			{
				nom: 'classification_candidates',
				args: { p_message_id: 'm1', p_known_sender: true, p_search: 'vitri', p_limit: CANDIDATES_AFFICHEES + 1 },
			},
		])
	})

	it('n’envoie pas un terme blanc', async () => {
		const { client: c, appels } = client({ data: [], error: null, status: 200 })
		await lireCandidates(c, { messageId: 'm1', connues: false, terme: '   ' })
		expect(appels[0]?.args).toEqual({ p_message_id: 'm1', p_known_sender: false, p_limit: CANDIDATES_AFFICHEES + 1 })
	})

	it('réduit les lignes, et la ligne de plus dit la troncature sans être montrée', async () => {
		const lignes = Array.from({ length: CANDIDATES_AFFICHEES + 1 }, (_, i) => ligne(i + 1, i < 2))
		const { client: c } = client({ data: lignes, error: null, status: 200 })
		const resultat = await lireCandidates(c, { messageId: 'm1', connues: false, terme: '' })
		expect(resultat.ok).toBe(true)
		if (!resultat.ok) return
		expect(resultat.tronquee).toBe(true)
		expect(resultat.candidates).toHaveLength(CANDIDATES_AFFICHEES)
		expect(resultat.candidates[0]).toEqual({ id: 'c1', titre: 'Affaire 1', chemin: 'Conseil IA › Grands comptes', connue: true })
		expect(resultat.candidates[1]).toEqual({ id: 'c2', titre: 'Affaire 2', chemin: '', connue: true })
		expect(resultat.candidates[2]?.connue).toBe(false)
	})

	it('une liste entière n’est pas tronquée', async () => {
		const { client: c } = client({ data: [ligne(1), ligne(2)], error: null, status: 200 })
		const resultat = await lireCandidates(c, { messageId: 'm1', connues: true, terme: '' })
		expect(resultat.ok && resultat.tronquee).toBe(false)
	})

	it('traduit un refus sans jamais rendre de lignes', async () => {
		const { client: c } = client({ data: null, error: { message: 'message_not_found' }, status: 404 })
		const resultat = await lireCandidates(c, { messageId: 'm1', connues: true, terme: '' })
		expect(resultat).toEqual({ ok: false, erreur: { nature: 'unknown', detail: 'message_not_found' } })
	})

	it('une panne réseau est une erreur, jamais une liste vide', async () => {
		const c = { rpc: () => Promise.reject(new Error('Failed to fetch')) }
		const resultat = await lireCandidates(c, { messageId: 'm1', connues: true, terme: '' })
		expect(resultat).toEqual({ ok: false, erreur: { nature: 'network', detail: 'Failed to fetch' } })
	})

	it('sans client, elle le dit', async () => {
		expect((await lireCandidates(null, { messageId: 'm1', connues: true, terme: '' })).ok).toBe(false)
	})
})

describe('preselection', () => {
	const une: Candidate = { id: 'c1', titre: 'A', chemin: '', connue: true }
	const deux: Candidate = { id: 'c2', titre: 'B', chemin: '', connue: true }

	it('choisit l’affaire unique d’une liste cochée et sans terme', () => {
		expect(preselection({ messageId: 'm', connues: true, terme: '' }, [une])).toBe(une)
	})

	it('ne choisit rien entre plusieurs affaires, ni case décochée, ni avec un terme', () => {
		expect(preselection({ messageId: 'm', connues: true, terme: '' }, [une, deux])).toBeNull()
		expect(preselection({ messageId: 'm', connues: false, terme: '' }, [une])).toBeNull()
		expect(preselection({ messageId: 'm', connues: true, terme: 'a' }, [une])).toBeNull()
		expect(preselection({ messageId: 'm', connues: true, terme: '' }, [])).toBeNull()
	})
})
