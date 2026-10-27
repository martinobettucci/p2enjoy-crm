// @spec CRM-117 (docs/BACKLOG.md) — tranche T3.1 : le numéro écrit dans le texte d'un lien interne suit sa cible
// @spec docs/SPEC-manual.md §10 bis (les renvois deviennent des liens, et leur numéro suit le titre visé), §10 point 7
//       (l'identifiant d'un titre), §16 (la preuve du manuel)
//
// Module pur. Un renvoi s'écrit « [la section 3.4](#les-onglets-d-un-track) » : la construction vérifie que la cible
// existe, ceci vérifie que le NUMÉRO écrit est celui que porte le titre visé. Sans cela, un chapitre renuméroté laisse
// des renvois justes par leur cible et faux par leur texte, et rien ne le dit.

import { identifiant } from './construction.mjs'

const TITRE = /^(##|###) (\d+(?:\.\d+)?)\.? (.*)$/
const LIEN = /\[(chapitres?|sections?|§)(\s*)(\d+(?:\.\d+)?)\]\(#([a-z0-9-]+)\)/g

/** Le numéro de chaque titre numéroté, par identifiant ; un identifiant répété n'est pas une cible. */
function cibles(source) {
	const numeros = new Map()
	const comptes = new Map()
	let dansCode = false
	for (const ligne of source.split('\n')) {
		if (/^```/.test(ligne)) dansCode = !dansCode
		if (dansCode) continue
		const m = TITRE.exec(ligne)
		if (!m) continue
		const id = identifiant(m[3])
		comptes.set(id, (comptes.get(id) ?? 0) + 1)
		numeros.set(id, { numero: m[2], chapitre: m[1] === '##' })
	}
	for (const [id, n] of comptes) if (n > 1) numeros.delete(id)
	return numeros
}

/**
 * Recalcule le numéro des liens internes numérotés. Le mot de l'auteur — « chapitre », « section », « § » — est gardé :
 * le changer casserait l'accord de la phrase (« le chapitre », « la section »). Un lien vers un chapitre qui écrit le
 * numéro d'une de ses sections est laissé tel quel : c'est le renvoi vers une section au titre répété, qui n'a pas
 * d'adresse propre.
 */
export function renumeroter(source) {
	const numeros = cibles(source)
	const decalages = []
	const lignes = source.split('\n')
	const texte = lignes
		.map((ligne, i) =>
			ligne.replace(LIEN, (tout, mot, espace, numero, ancre) => {
				const cible = numeros.get(ancre)
				if (!cible || numero === cible.numero) return tout
				if (cible.chapitre && numero.startsWith(`${cible.numero}.`)) return tout
				const juste = `[${mot}${espace}${cible.numero}](#${ancre})`
				decalages.push({ ligne: i + 1, avant: tout, apres: juste })
				return juste
			}),
		)
		.join('\n')
	return { texte, decalages }
}
