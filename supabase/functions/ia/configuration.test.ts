// @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : la configuration de l'assistant et sa cible
// @verifies docs/SPEC-ia.md §3 (variables et défauts), §4 (mode dégradé), §11.6 (le simulateur n'est visé
//           qu'en développement, et l'en-tête est ignoré en production)

import { describe, expect, it } from 'vitest'
import { CONTEXTE_PAR_DEFAUT, MODELE_PAR_DEFAUT, cibleDe, lireConfiguration } from './configuration.ts'

const env = (valeurs: Record<string, string>) => (nom: string) => valeurs[nom]
const avecScenario = (scenario: string) => new Headers({ 'x-ia-simulateur': scenario })

describe('lireConfiguration', () => {
	it('prend les défauts du gabarit pour le modèle et le contexte, et retire la barre finale de l’hôte', () => {
		const c = lireConfiguration(env({ OLLAMA_HOST: 'https://llm.example.test:21434/', OLLAMA_API_KEY: 'sk-x' }))
		expect(c).toEqual({
			hote: 'https://llm.example.test:21434',
			cle: 'sk-x',
			modele: MODELE_PAR_DEFAUT,
			contexte: CONTEXTE_PAR_DEFAUT,
			hoteSimulateur: null,
		})
	})

	it('un contexte illisible ou négatif retombe sur le défaut, jamais sur une valeur absurde', () => {
		expect(lireConfiguration(env({ OLLAMA_CONTEXT_LENGTH: 'beaucoup' })).contexte).toBe(CONTEXTE_PAR_DEFAUT)
		expect(lireConfiguration(env({ OLLAMA_CONTEXT_LENGTH: '-5' })).contexte).toBe(CONTEXTE_PAR_DEFAUT)
		expect(lireConfiguration(env({ OLLAMA_CONTEXT_LENGTH: '8192' })).contexte).toBe(8192)
	})
})

describe('cibleDe', () => {
	it('sans clé, ou sans serveur, aucune cible : l’assistant est indisponible', () => {
		expect(cibleDe(lireConfiguration(env({ OLLAMA_HOST: 'https://h' })), new Headers())).toBeNull()
		expect(cibleDe(lireConfiguration(env({ OLLAMA_API_KEY: '  ' , OLLAMA_HOST: 'https://h' })), new Headers())).toBeNull()
		expect(cibleDe(lireConfiguration(env({ OLLAMA_API_KEY: 'sk-x' })), new Headers())).toBeNull()
	})

	it('vise le serveur réel avec sa clé', () => {
		expect(cibleDe(lireConfiguration(env({ OLLAMA_HOST: 'https://h', OLLAMA_API_KEY: 'sk-x' })), new Headers())).toEqual({
			hote: 'https://h',
			cle: 'sk-x',
			simulee: false,
		})
	})

	it('EN PRODUCTION — sans `IA_SIMULATEUR_HOST` —, l’en-tête du simulateur est ignoré', () => {
		const production = lireConfiguration(env({ OLLAMA_HOST: 'https://h', OLLAMA_API_KEY: 'sk-x' }))
		expect(cibleDe(production, avecScenario('valide'))).toEqual({ hote: 'https://h', cle: 'sk-x', simulee: false })
	})

	it('en développement, un scénario connu vise le simulateur et voyage comme clé', () => {
		const dev = lireConfiguration(env({ OLLAMA_HOST: 'https://h', OLLAMA_API_KEY: 'sk-x', IA_SIMULATEUR_HOST: 'http://ollama-simule:11434' }))
		expect(cibleDe(dev, avecScenario('incoherente'))).toEqual({
			hote: 'http://ollama-simule:11434',
			cle: 'simule-incoherente',
			simulee: true,
		})
	})

	it('un scénario inconnu n’ouvre pas le simulateur, même en développement', () => {
		const dev = lireConfiguration(env({ OLLAMA_HOST: 'https://h', OLLAMA_API_KEY: 'sk-x', IA_SIMULATEUR_HOST: 'http://s' }))
		expect(cibleDe(dev, avecScenario('../../etc'))?.simulee).toBe(false)
	})
})
