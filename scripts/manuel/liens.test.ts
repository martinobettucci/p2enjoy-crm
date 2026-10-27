// @verifies CRM-117 (docs/BACKLOG.md) — tranche T3.1 : le numéro écrit dans le texte d'un lien interne suit sa cible
// @verifies docs/SPEC-manual.md §10 bis (le numéro d'un lien suit le titre visé ; le mot de l'auteur est gardé ; une
//           section au titre répété est désignée par son chapitre avec son propre numéro)
//
// Le module est pur : chaque cas lui donne une source et lit le texte rendu et les décalages relevés.

import { describe, expect, it } from 'vitest'
import { renumeroter } from './liens.mjs'

const MANUEL = [
	'## 3. Naviguer',
	'### 3.1 La disposition',
	'### 3.4 Les onglets d’un track',
	'### 3.5 Ce qui n’est pas encore là',
	'## 9. L’affaire',
	'### 9.10 Le tableau kanban',
	'### 9.16 Ce qui n’est pas encore là',
	'',
].join('\n')

const avec = (paragraphe: string) => `${MANUEL}\n${paragraphe}\n`

describe('renumeroter (§10 bis)', () => {
	it('aligne le numéro d’un lien sur le titre de sa cible, et relève la ligne', () => {
		const { texte, decalages } = renumeroter(avec('Voir le [chapitre 3.6](#les-onglets-d-un-track).'))
		expect(texte).toContain('Voir le [chapitre 3.4](#les-onglets-d-un-track).')
		expect(decalages).toEqual([
			{ ligne: 9, avant: '[chapitre 3.6](#les-onglets-d-un-track)', apres: '[chapitre 3.4](#les-onglets-d-un-track)' },
		])
	})

	it('garde le mot de l’auteur, pour l’accord de la phrase', () => {
		const { texte } = renumeroter(avec('Voir la [section 3.2](#les-onglets-d-un-track), puis le [§9.1](#le-tableau-kanban).'))
		expect(texte).toContain('la [section 3.4](#les-onglets-d-un-track)')
		expect(texte).toContain('le [§9.10](#le-tableau-kanban)')
	})

	it('ne touche ni un lien juste, ni un lien sans numéro, ni un lien externe', () => {
		const paragraphe =
			'Le [chapitre 9](#l-affaire), le [tableau](#le-tableau-kanban), le [site](https://exemple.fr) et la [section 9.10](#le-tableau-kanban).'
		const { texte, decalages } = renumeroter(avec(paragraphe))
		expect(decalages).toEqual([])
		expect(texte).toBe(avec(paragraphe))
	})

	it('laisse le numéro d’une section au titre répété, désignée par son chapitre', () => {
		const { decalages } = renumeroter(avec('Voir le [§9.16](#l-affaire).'))
		expect(decalages).toEqual([])
	})

	it('ne prend pour cible ni un titre répété, ni un titre écrit dans un bloc de code', () => {
		const source = `${MANUEL}\n\`\`\`\n## 7. Faux titre\n\`\`\`\nVoir le [§8](#faux-titre) et le [§3](#ce-qui-n-est-pas-encore-la).\n`
		expect(renumeroter(source).decalages).toEqual([])
	})
})
