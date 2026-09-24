// @spec docs/BACKLOG.md « Correctifs arbitrés », INC-189 c ; docs/JOURNAL.md décision 594 — le journal
//       d'une exécution unitaire rouge est conservé, quel que soit l'appelant
// @spec CRM-008 (docs/BACKLOG.md) — harnais de tests ; docs/SPEC-test-harness.md §6.1 ;
//       README.md §7 (tests) ; docs/INCONSISTENCY_REPORT.md INC-189
//
// POURQUOI CE RAPPORTEUR EXISTE. Trente harnais lancent `npm run test:unit`. Les uns jettent la
// sortie (`>/dev/null`), les autres l'écrivent dans un répertoire temporaire qu'ils effacent en
// sortant : quand un rejeu rougissait sous charge, sa cause n'était même pas nommable — INC-189 a
// vécu un mois sur UN seul journal survivant. Plutôt que de réécrire trente harnais, l'exécution
// elle-même dépose, lorsqu'elle est rouge, les tests en échec et leurs erreurs dans
// `e2e/output/journaux-unitaires/`, répertoire non versionné. Une exécution verte n'écrit rien.
//
// Les journaux les plus récents sont gardés, les plus anciens retirés : les harnais dégradent
// volontairement le produit et rendent donc des exécutions rouges attendues, qui ne doivent pas
// s'accumuler sans fin. Le journal dit la commande, le répertoire et le fuseau de l'exécution —
// un harnais de « Ma journée » rejoue la suite sous un fuseau décalé.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SerializedError } from 'vitest'
import type { Reporter, TestModule, TestRunEndReason } from 'vitest/node'

export const REPERTOIRE_JOURNAUX = resolve(import.meta.dirname, '../e2e/output/journaux-unitaires')
export const JOURNAUX_GARDES = 30
const PREFIXE = 'unitaires-'
const SUFFIXE = '.log'

export type EchecUnitaire = {
	readonly fichier: string
	readonly test: string
	readonly erreurs: readonly string[]
}

/** Nom horodaté : l'ordre alphabétique des noms est l'ordre chronologique des exécutions. */
export function nomJournal(instant: Date, pid: number): string {
	return `${PREFIXE}${instant.toISOString().replace(/[:.]/g, '-')}-${pid}${SUFFIXE}`
}

/** L'erreur telle qu'un humain la lit : sa pile, ou à défaut son nom et son message, puis l'écart. */
export function texteErreur(erreur: SerializedError): string {
	const tete = erreur.stack ?? `${erreur.name ?? 'Error'}: ${erreur.message}`
	const ecart = erreur['diff']
	return typeof ecart === 'string' && ecart !== '' ? `${tete}\n${ecart}` : tete
}

/** Les tests en échec, et les erreurs qui ne sont rattachées à aucun test — un import raté, par exemple. */
export function echecsDe(modules: ReadonlyArray<TestModule>): {
	readonly echecs: readonly EchecUnitaire[]
	readonly horsTests: readonly string[]
} {
	const echecs: EchecUnitaire[] = []
	const horsTests: string[] = []
	for (const module of modules) {
		for (const erreur of module.errors()) horsTests.push(`${module.relativeModuleId}\n${texteErreur(erreur)}`)
		for (const test of module.children.allTests()) {
			const resultat = test.result()
			if (resultat.state !== 'failed') continue
			echecs.push({
				fichier: module.relativeModuleId,
				test: test.fullName,
				erreurs: resultat.errors.map(texteErreur),
			})
		}
	}
	return { echecs, horsTests }
}

export function composerJournal(contenu: {
	readonly instant: Date
	readonly commande: string
	readonly repertoire: string
	readonly fuseau: string
	readonly raison: TestRunEndReason
	readonly echecs: readonly EchecUnitaire[]
	readonly horsTests: readonly string[]
}): string {
	const lignes = [
		`Exécution unitaire ROUGE — ${contenu.instant.toISOString()}`,
		`Commande   : ${contenu.commande}`,
		`Répertoire : ${contenu.repertoire}`,
		`Fuseau     : ${contenu.fuseau}`,
		`Issue      : ${contenu.raison} — ${contenu.echecs.length} test(s) en échec, ${contenu.horsTests.length} erreur(s) hors test`,
	]
	for (const echec of contenu.echecs) {
		lignes.push('', `× ${echec.fichier} › ${echec.test}`)
		for (const erreur of echec.erreurs) lignes.push(erreur)
	}
	for (const erreur of contenu.horsTests) lignes.push('', '× hors test', erreur)
	return `${lignes.join('\n')}\n`
}

/** Les journaux de ce rapporteur à retirer pour n'en garder que `garder`, les plus récents. */
export function journauxASupprimer(noms: readonly string[], garder: number): readonly string[] {
	return noms
		.filter((nom) => nom.startsWith(PREFIXE) && nom.endsWith(SUFFIXE))
		.sort()
		.reverse()
		.slice(garder)
}

export type OptionsRapporteur = {
	readonly repertoire?: string
	readonly garder?: number
	readonly maintenant?: () => Date
	/** Où dire le chemin du journal écrit — la sortie d'erreur par défaut. */
	readonly annoncer?: (message: string) => void
}

export default class RapporteurEchecs implements Reporter {
	readonly repertoire: string
	readonly garder: number
	readonly maintenant: () => Date
	readonly annoncer: (message: string) => void
	/** Chemin du dernier journal écrit — `null` tant qu'aucune exécution n'a été rouge. */
	dernierJournal: string | null = null

	// VITEST INSTANCIE UN RAPPORTEUR AVEC UN OBJET D'OPTIONS — `{}` par défaut, ou le second membre
	// de `['chemin', options]` dans `reporters`. Mesuré en exécutant la preuve du §9.5 : des
	// paramètres positionnels recevaient cet objet comme répertoire, et `mkdirSync` levait.
	constructor(options: OptionsRapporteur = {}) {
		this.repertoire = options.repertoire ?? REPERTOIRE_JOURNAUX
		this.garder = options.garder ?? JOURNAUX_GARDES
		this.maintenant = options.maintenant ?? (() => new Date())
		this.annoncer = options.annoncer ?? ((message) => process.stderr.write(message))
	}

	onTestRunEnd(
		modules: ReadonlyArray<TestModule>,
		erreursNonGerees: ReadonlyArray<SerializedError>,
		raison: TestRunEndReason,
	): void {
		const { echecs, horsTests } = echecsDe(modules)
		const toutesHorsTests = [...horsTests, ...erreursNonGerees.map(texteErreur)]
		// UNE EXÉCUTION INTERROMPUE SANS ÉCHEC N'EST PAS ROUGE : rien n'a été démenti.
		if (echecs.length === 0 && toutesHorsTests.length === 0 && raison !== 'failed') return
		const instant = this.maintenant()
		mkdirSync(this.repertoire, { recursive: true })
		const chemin = join(this.repertoire, nomJournal(instant, process.pid))
		writeFileSync(
			chemin,
			composerJournal({
				instant,
				commande: process.argv.slice(1).join(' '),
				repertoire: process.cwd(),
				fuseau: process.env['TZ'] ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
				raison,
				echecs,
				horsTests: toutesHorsTests,
			}),
		)
		for (const ancien of journauxASupprimer(readdirSync(this.repertoire), this.garder)) {
			rmSync(join(this.repertoire, ancien), { force: true })
		}
		this.dernierJournal = chemin
		this.annoncer(`Journal de l'exécution rouge conservé : ${chemin}\n`)
	}
}
