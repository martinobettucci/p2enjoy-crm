// @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : la correspondance entre un écran et son chapitre
// @verifies docs/SPEC-manual.md §13.2 (un seul endroit, le motif le plus précis l'emporte) et §16 (chaque identifiant de
//           `aide-ecrans.ts` existe dans le manuel construit) ; docs/DESIGN_SYSTEM.md §5.69

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ECRANS_AIDE, adresseAide, aideDeLecran } from './aide-ecrans'

const SOMMAIRE = JSON.parse(readFileSync('docs/manuel/construit/contents.json', 'utf8')) as {
	chapters: Array<{ slug: string; sections: Array<{ anchor: string }> }>
}

describe('aideDeLecran — le motif le plus précis l’emporte', () => {
	it.each([
		['/tracks/conseil-ia/prospection/cards/5eed', 'la-fiche-d-une-affaire-son-en-tete-son-formulaire-et-ce-qu-ils-montrent'],
		['/tracks/conseil-ia/prospection/liste', 'la-vue-liste-d-un-channel'],
		['/tracks/conseil-ia/prospection', 'le-tableau-kanban-d-un-channel'],
		['/tracks/conseil-ia', 'les-onglets-d-un-track'],
		['/reglages/cout-personnel', 'regler-le-cout-du-personnel'],
		['/plateforme/mcp/sub-123', 'accorder-des-droits-du-connecteur'],
	])('%s → section %s', (chemin, section) => {
		expect(aideDeLecran(chemin)?.section).toBe(section)
	})

	it('les coûts d’un track et le détail d’un budget ne passent pas pour un channel', () => {
		expect(aideDeLecran('/tracks/conseil-ia/couts')?.chapitre).toBe('les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense')
		expect(aideDeLecran('/tracks/conseil-ia/couts/abc')?.chapitre).toBe(
			'le-detail-d-un-budget-occurrence-par-occurrence-ligne-par-ligne',
		)
	})

	it('une sous-adresse du carnet, des objectifs et de la plateforme mène au chapitre de la section', () => {
		expect(aideDeLecran('/contacts/organisations/x')?.section).toBe('le-carnet-de-contacts')
		expect(aideDeLecran('/objectifs/x')?.chapitre).toBe('les-objectifs-le-tableau-blanc-de-l-equipe')
		expect(aideDeLecran('/plateforme/espaces/p2enjoy')?.chapitre).toBe('la-plateforme-espaces-membres-et-superadministrateurs')
	})

	it('l’index des réglages, l’aide elle-même et une adresse inconnue n’ont pas de chapitre', () => {
		expect(aideDeLecran('/reglages')).toBeNull()
		expect(aideDeLecran('/aide/le-board')).toBeNull()
		expect(aideDeLecran('/nulle-part/ici')).toBeNull()
	})
})

describe('adresseAide', () => {
	it('mène au chapitre, et à la section par le fragment', () => {
		expect(adresseAide({ chapitre: 'le-board' })).toBe('/aide/le-board')
		expect(adresseAide({ chapitre: 'le-board', section: 'deplacer' })).toBe('/aide/le-board#deplacer')
	})
})

describe('chaque identifiant de la table existe dans le manuel construit (§16)', () => {
	it.each(ECRANS_AIDE.map(([motif, cible]) => [motif, cible] as const))('%s', (_motif, cible) => {
		const chapitre = SOMMAIRE.chapters.find((c) => c.slug === cible.chapitre)
		expect(chapitre, `chapitre « ${cible.chapitre} »`).toBeDefined()
		if (cible.section !== undefined)
			expect(chapitre?.sections.map((s) => s.anchor), `section « ${cible.section} »`).toContain(cible.section)
	})
})
