// @verifies CRM-093 (docs/BACKLOG.md) — tranche T4 : une commande qui reçoit la capacité (`{...droit}`) ne la perd jamais
//           sous un `disabled` posé après elle dans la même balise ; docs/SPEC-droits-interface.md §3 (la commande
//           refusée reste désactivée), §4 ; docs/DESIGN_SYSTEM.md §5.59
//
// UN GARDE DE SOURCE, ET C'EST DÉLIBÉRÉ. En JSX, l'attribut écrit le dernier gagne : `<Button {...droit}
// disabled={enCours}>` rallume une commande refusée dès que rien n'est en vol. Le défaut a été trouvé dix-sept fois
// le 2026-10-21, dans des formulaires qu'un test de rendu n'atteint qu'au prix d'un banc par écran ; ce garde les
// couvre tous, et tous ceux à venir. Il exige que le `disabled` qui suit compose avec la capacité.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RACINE = join(__dirname, '..')

function sources(dossier: string): string[] {
	return readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
		const chemin = join(dossier, entree.name)
		if (entree.isDirectory()) return sources(chemin)
		return entree.name.endsWith('.tsx') && !entree.name.includes('.test.') ? [chemin] : []
	})
}

/** La fin de la balise ouvrante qui contient `depuis`, à profondeur d'accolades nulle. */
function finDeBalise(texte: string, depuis: number): number {
	let profondeur = 0
	for (let i = depuis; i < texte.length; i++) {
		const c = texte[i]
		if (c === '{') profondeur++
		else if (c === '}') profondeur--
		else if (c === '>' && profondeur === 0 && texte[i - 1] !== '=') return i
	}
	return texte.length
}

/** Les `disabled={…}` posés APRÈS une capacité étalée, qui ne la composent pas. */
export function ecrasements(texte: string): string[] {
	const trouves: string[] = []
	for (const etalement of texte.matchAll(/\{\.\.\.(droit|refus\w*|commande\w*)\}/g)) {
		const nom = etalement[1]!
		const debut = etalement.index! + etalement[0].length
		const balise = texte.slice(debut, finDeBalise(texte, debut))
		const attribut = /\sdisabled=\{([^\n]*)\}/.exec(balise)
		if (attribut !== null && !attribut[1]!.includes(`${nom}.disabled`)) {
			trouves.push(`ligne ${texte.slice(0, etalement.index).split('\n').length} : {...${nom}} puis disabled={${attribut[1]}}`)
		}
	}
	return trouves
}

describe('aucune commande ne perd sa capacité sous un `disabled` posé après elle', () => {
	it('le garde reconnaît le défaut, et la forme composée', () => {
		expect(ecrasements('<Button {...droit} disabled={enCours}>')).toHaveLength(1)
		expect(ecrasements('<Button {...droit} disabled={droit.disabled === true || enCours}>')).toEqual([])
		expect(ecrasements('<Button disabled={enCours} {...droit}>')).toEqual([])
	})

	it('aucun fichier de l’application ne le porte', () => {
		const defauts = sources(RACINE).flatMap((fichier) =>
			ecrasements(readFileSync(fichier, 'utf8')).map((defaut) => `${fichier.slice(RACINE.length + 1)} ${defaut}`),
		)
		expect(defauts).toEqual([])
	})
})
