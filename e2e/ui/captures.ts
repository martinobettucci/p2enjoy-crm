// @spec CRM-007 (docs/BACKLOG.md) — production des captures de référence
// @spec docs/DESIGN_SYSTEM.md §11 (captures dans e2e/output, observées à chaque livraison)
// @spec docs/SPEC-webapp.md §14 (preuves) ; CLAUDE.md §16 (vérification visuelle)
//
// Les captures sont écrites dans `e2e/output/`, que le dépôt ignore, **et** copiées dans
// `docs/captures/CRM-007/`, qui est versionné : la première destination est celle du design
// system, la seconde celle qu'utilisent les unités précédentes pour laisser une trace
// consultable sans rejouer les preuves.

import type { Page } from '@playwright/test'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RACINE = dirname(dirname(import.meta.dirname))
const SORTIE = join(RACINE, 'e2e', 'output')
const REFERENCE = join(RACINE, 'docs', 'captures', 'CRM-007')

export async function capturer(page: Page, nom: string): Promise<string> {
	mkdirSync(SORTIE, { recursive: true })
	mkdirSync(REFERENCE, { recursive: true })
	const chemin = join(SORTIE, `${nom}.jpg`)
	await page.screenshot({ path: chemin, type: 'jpeg', quality: 85, fullPage: false })
	copyFileSync(chemin, join(REFERENCE, `${nom}.jpg`))
	return chemin
}

/** Les quatre paliers de docs/DESIGN_SYSTEM.md §7, chacun représenté par une largeur réelle. */
export const PALIERS = [
	{ nom: 'xl-1440', largeur: 1440, hauteur: 900 },
	{ nom: 'lg-1152', largeur: 1152, hauteur: 800 },
	{ nom: 'md-900', largeur: 900, hauteur: 800 },
	{ nom: 'sm-390', largeur: 390, hauteur: 780 },
] as const
