// @verifies CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHE 1
// @verifies docs/SPEC-relances.md §2.2 (seuil effectif, et jamais de défaut inventé), §2.5 (jours
//           révolus, borne LARGE), §2.1 (la moitié TypeScript de la règle n'a qu'une déclaration)
// @verifies docs/SPEC-workflow-engine.md §7.4 (pastille d'ancienneté, comportement inchangé)
//
// CE FICHIER ÉPROUVE LA RÈGLE SANS PILE, ET C'EST SA RAISON D'ÊTRE. `e2e/api/relances.spec.ts`
// confronte ce module au SQL sur la donnée réelle ; mais la donnée réelle du seed ne porte qu'UNE
// affaire figée, et ne visite donc ni les bornes, ni les valeurs illisibles, ni l'absence de seuil.
// Ces cas-là se posent ici, où l'instant est injectable.

import { describe, expect, it } from 'vitest'

import { ancienneteDepassee, joursDansEtape, seuilEffectif } from './carte-figee'

const MAINTENANT = new Date('2026-08-24T12:00:00.000Z')

/** Une date d'entrée dans l'étape, à `jours` jours et `heures` heures avant `MAINTENANT`. */
function ilYA(jours: number, heures = 0): string {
	return new Date(
		MAINTENANT.getTime() - jours * 24 * 60 * 60 * 1000 - heures * 60 * 60 * 1000,
	).toISOString()
}

describe('seuilEffectif (§2.2)', () => {
	it('retient le seuil de l’étape lorsqu’elle en pose un', () => {
		// Le cas du seed : « Négociation » porte 5 là où son nœud porte 10.
		expect(seuilEffectif(5, 10)).toBe(5)
	})

	it('se replie sur celui du nœud lorsque l’étape n’en pose aucun', () => {
		expect(seuilEffectif(null, 14)).toBe(14)
	})

	it('rend `null` quand ni l’étape ni le nœud n’en posent — aucun défaut n’est inventé', () => {
		// C'est l'étape « Livré » du seed. Inventer un seuil ici serait une règle de produit que
		// personne n'a prise.
		expect(seuilEffectif(null, null)).toBeNull()
	})

	it('traite `undefined` comme `null` : le nœud embarqué peut manquer', () => {
		expect(seuilEffectif(undefined, undefined)).toBeNull()
		expect(seuilEffectif(null, undefined)).toBeNull()
		expect(seuilEffectif(undefined, 7)).toBe(7)
	})

	it('ZÉRO N’EST PAS NUL, et le `??` le respecte', () => {
		// La base interdit un seuil nul (`CHECK (x > 0)`), mais un `||` aurait ici replié 0 sur le
		// nœud sans que rien ne le dise. L'assertion fige le choix de l'opérateur.
		expect(seuilEffectif(0, 14)).toBe(0)
	})
})

describe('joursDansEtape (§2.5)', () => {
	it('compte des jours RÉVOLUS, jamais arrondis', () => {
		expect(joursDansEtape(ilYA(6, 23), MAINTENANT)).toBe(6)
		expect(joursDansEtape(ilYA(7), MAINTENANT)).toBe(7)
	})

	it('ne rend jamais de valeur négative pour une entrée future', () => {
		expect(joursDansEtape(ilYA(-3), MAINTENANT)).toBe(0)
	})

	it('rend zéro sur une date illisible, jamais `NaN`', () => {
		// Une carte dont l'horodatage est illisible n'est pas « en retard depuis toujours ».
		expect(joursDansEtape('pas une date', MAINTENANT)).toBe(0)
	})
})

describe('ancienneteDepassee (§2.5)', () => {
	it('la borne est LARGE : atteindre le seuil suffit', () => {
		expect(ancienneteDepassee(7, 7)).toBe(true)
	})

	it('un jour de moins ne suffit pas', () => {
		expect(ancienneteDepassee(6, 7)).toBe(false)
	})

	it('un seuil absent n’est jamais dépassé, si vieille que soit la carte', () => {
		expect(ancienneteDepassee(900, null)).toBe(false)
	})

	it('les deux fonctions composent le verdict que le SQL rend', () => {
		// Le cas exact du seed : `…00c3`, trente jours dans une étape de seuil quatorze.
		const jours = joursDansEtape(ilYA(30), MAINTENANT)
		expect(jours).toBe(30)
		expect(ancienneteDepassee(jours, seuilEffectif(null, 14))).toBe(true)
	})
})
