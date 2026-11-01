// @spec CRM-007 (docs/BACKLOG.md) — production des captures de référence
// @spec CRM-020 (docs/BACKLOG.md) — captures rangées par unité livrante
// @spec CRM-122 (docs/BACKLOG.md) — tranche T2 : rien n'est recopié dans `docs/captures/` sans demande explicite
// @spec docs/DESIGN_SYSTEM.md §11 (captures dans e2e/output, observées à chaque livraison) ; docs/SPEC-captures.md §2
// @spec docs/SPEC-webapp.md §14 (preuves) ; CLAUDE.md §16 (vérification visuelle)
//
// Les captures sont écrites dans `e2e/output/<unité>/`, que le dépôt ignore : c'est là qu'on les observe. Elles ne sont
// recopiées dans `docs/captures/<unité>/`, versionné, que sur DEMANDE (docs/SPEC-captures.md §2) : `CAPTURES_UNITES`
// nomme l'unité qui livre, `CAPTURES_RENOUVELLEMENT=1` demande le renouvellement de toutes. Avant `CRM-122`, chaque
// passage recopiait tout : une campagne de régression salissait l'arbre de captures que personne n'observait.
//
// L'unité est un **paramètre** depuis `CRM-020` : une capture rangée sous l'unité qui ne l'a pas produite rend la trace
// inutilisable pour relire une livraison. Le défaut reste `CRM-007`, de sorte que les captures existantes gardent leur
// emplacement.

import type { Page } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { destinationsCapture } from '../../scripts/captures/captures.mjs'

const RACINE = dirname(dirname(import.meta.dirname))
const SORTIE = join(RACINE, 'e2e', 'output')

export async function capturer(page: Page, nom: string, unite = 'CRM-007'): Promise<string> {
	const { sortie, versionner } = destinationsCapture(unite, process.env)
	const dossier = join(SORTIE, sortie)
	mkdirSync(dossier, { recursive: true })
	const chemin = join(dossier, `${nom}.jpg`)
	await page.screenshot({ path: chemin, type: 'jpeg', quality: 85, fullPage: false })
	if (versionner) {
		const reference = join(RACINE, 'docs', 'captures', unite)
		mkdirSync(reference, { recursive: true })
		copyFileSync(chemin, join(reference, `${nom}.jpg`))
	}
	return chemin
}

/**
 * Dépose une vidéo `.webm` enregistrée par un scénario, sous la MÊME règle que les captures (docs/SPEC-captures.md §2) :
 * toujours dans `e2e/output/<unité>/`, dans `docs/captures/<unité>/` seulement sur demande. Mesuré par la campagne
 * ordinaire de `CRM-122` T2 : la vidéo du board, recopiée sans condition, était la seule image versionnée réécrite.
 */
export function deposerVideo(source: string, nom: string, unite: string): string {
	const { sortie, versionner } = destinationsCapture(unite, process.env)
	const dossier = join(SORTIE, sortie)
	mkdirSync(dossier, { recursive: true })
	const chemin = join(dossier, `${nom}.webm`)
	copyFileSync(source, chemin)
	if (versionner) {
		const reference = join(RACINE, 'docs', 'captures', unite)
		mkdirSync(reference, { recursive: true })
		copyFileSync(chemin, join(reference, `${nom}.webm`))
	}
	return chemin
}

/** Les quatre paliers de docs/DESIGN_SYSTEM.md §7, chacun représenté par une largeur réelle. */
export const PALIERS = [
	{ nom: 'xl-1440', largeur: 1440, hauteur: 900 },
	{ nom: 'lg-1152', largeur: 1152, hauteur: 800 },
	{ nom: 'md-900', largeur: 900, hauteur: 800 },
	{ nom: 'sm-390', largeur: 390, hauteur: 780 },
] as const
