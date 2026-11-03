// @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.b : les filtres de champ de la vue liste — l'adresse lue avec tolérance et
//           réécrite à l'identique, le filtre selon le type, le texte ramené à la forme de `value_search`, et la requête de
//           la page : un plongement par filtre, sa condition, « vide » sans `!inner`
// @verifies docs/SPEC-champs-communs.md §8 (précision T4.b) ; docs/DESIGN_SYSTEM.md §5.92 ; docs/SPEC-cards.md §12.2, §12.5

import { describe, expect, it } from 'vitest'
import type { ChampCommun } from './champs-communs'
import {
	champsFiltrables,
	filtresActifs,
	formaterFiltre,
	interpreterFiltre,
	lireFiltresBruts,
	lireNombre,
	minuitLocal,
	motifContient,
	operandeOu,
} from './filtres-communs'
import { COLONNES_RATTACHEMENT_LISTE, PARAMETRES_PAR_DEFAUT, colonnesAvecFiltresCommuns, ecrireParametres, lireParametres, lirePageCards } from './liste-cards'
import type { ClientCrm } from './supabase'

const champ = (partiel: Partial<ChampCommun>): ChampCommun => ({
	id: `id-${partiel.key ?? 'k'}`,
	key: 'k',
	label: 'Champ',
	type: 'text',
	options: {},
	help_text: null,
	position: 1,
	archived_at: null,
	is_listed: false,
	...partiel,
})
const CHOIX = { choices: [{ key: 'btp', label: 'BTP' }, { key: 'sante', label: 'Santé' }, { key: 'a,b', label: 'A et B' }] }

describe('l’adresse des filtres de champ (§8, précision T4.b)', () => {
	it('lit les paramètres c.<clé>, ignore une clé hors de forme ou une valeur vide', () => {
		const adresse = new URLSearchParams('c.siret=123&c.Mauvaise=1&c.vide=&tri=amount&c.ca=10..20')
		expect(lireFiltresBruts(adresse)).toEqual({ siret: '123', ca: '10..20' })
	})

	it('les paramètres de la liste les portent, et les réécrivent dans l’ordre des clés', () => {
		const lus = lireParametres(new URLSearchParams('c.zeta=1&c.alpha=oui'))
		expect(lus.communs).toEqual({ zeta: '1', alpha: 'oui' })
		expect(ecrireParametres(lus).toString()).toBe('c.alpha=oui&c.zeta=1')
		expect(ecrireParametres(PARAMETRES_PAR_DEFAUT).toString()).toBe('')
	})
})

describe('le filtre selon le type (§8)', () => {
	it('contient, pour les types texte', () => {
		expect(interpreterFiltre(champ({ type: 'email' }), ' dupont ')).toEqual({ sorte: 'contient', texte: 'dupont' })
	})

	it('choix : les clés connues, encodées dans l’adresse ; une clé inconnue est ignorée', () => {
		const c = champ({ type: 'multiselect', options: CHOIX })
		expect(interpreterFiltre(c, 'btp,inconnu')).toEqual({ sorte: 'choix', cles: ['btp'] })
		expect(interpreterFiltre(c, 'inconnu')).toBeNull()
		const brut = formaterFiltre({ sorte: 'choix', cles: ['a,b', 'sante'] })
		expect(brut).toBe('a%2Cb,sante')
		expect(interpreterFiltre(c, brut ?? '')).toEqual({ sorte: 'choix', cles: ['a,b', 'sante'] })
		expect(interpreterFiltre(c, '%E0%A4%A')).toBeNull()
	})

	it('bornes : deux, une seule, aucune ; une borne illisible annule le filtre', () => {
		const c = champ({ type: 'money', options: { currency: 'EUR' } })
		expect(interpreterFiltre(c, '1000..5000')).toEqual({ sorte: 'bornes', de: 1000, a: 5000 })
		expect(interpreterFiltre(c, '1000.5..')).toEqual({ sorte: 'bornes', de: 1000.5, a: null })
		expect(interpreterFiltre(c, '..-3')).toEqual({ sorte: 'bornes', de: null, a: -3 })
		expect(interpreterFiltre(c, '..')).toBeNull()
		expect(interpreterFiltre(c, 'douze..20')).toBeNull()
		expect(interpreterFiltre(c, '1000')).toBeNull()
		expect(formaterFiltre({ sorte: 'bornes', de: null, a: 20 })).toBe('..20')
	})

	it('dates : la forme AAAA-MM-JJ seule', () => {
		const c = champ({ type: 'datetime' })
		expect(interpreterFiltre(c, '2026-01-01..2026-03-31')).toEqual({ sorte: 'dates', du: '2026-01-01', au: '2026-03-31' })
		expect(interpreterFiltre(c, '01/01/2026..')).toBeNull()
	})

	it('case : oui, non, vide', () => {
		const c = champ({ type: 'checkbox' })
		expect(interpreterFiltre(c, 'vide')).toEqual({ sorte: 'case', etat: 'vide' })
		expect(interpreterFiltre(c, 'peut-etre')).toBeNull()
	})

	it('personne, contact et fichier ne sont pas filtrés par T4.b ; un champ archivé non plus', () => {
		const champs = [
			champ({ key: 'b', type: 'text', position: 2 }),
			champ({ key: 'a', type: 'number', position: 1 }),
			champ({ key: 'u', type: 'user' }),
			champ({ key: 'f', type: 'file' }),
			champ({ key: 'x', type: 'text', archived_at: '2026-01-01T00:00:00Z' }),
		]
		expect(champsFiltrables(champs).map((c) => c.key)).toEqual(['a', 'b'])
		expect(filtresActifs(champs, { u: 'quelqu-un', x: 'texte', b: 'texte', inconnu: '1' }).map((f) => f.champ.key)).toEqual(['b'])
	})

	it('un nombre saisi accepte la virgule ; illisible : NaN ; vide : null', () => {
		expect(lireNombre(' 1 500,5 ')).toBe(1500.5)
		expect(lireNombre('')).toBeNull()
		expect(Number.isNaN(lireNombre('douze'))).toBe(true)
	})
})

describe('le texte et les opérandes envoyés à PostgREST', () => {
	it('contient : minuscules, sans accents, caractères spéciaux du like neutralisés', () => {
		expect(motifContient('  Société ÉLAN ')).toBe('%societe elan%')
		expect(motifContient('50 %_\\')).toBe('%50 \\%\\_\\\\%')
	})

	it('un opérande de or=(…) entre guillemets, ses guillemets échappés', () => {
		expect(operandeOu('["a,b"]')).toBe('"[\\"a,b\\"]"')
	})

	it('minuit, heure de l’appareil, et le lendemain', () => {
		expect(new Date(minuitLocal('2026-03-31')).getDate()).toBe(31)
		expect(new Date(minuitLocal('2026-03-31', 1)).getDate()).toBe(1)
	})
})

/** Un client qui note chaque appel de la chaîne de requête, et rend une page vide. */
function clientEnregistreur(): { client: ClientCrm; appels: [string, unknown[]][]; colonnes: () => string } {
	const appels: [string, unknown[]][] = []
	let colonnes = ''
	const chaine: object = new Proxy(
		{},
		{
			get: (_cible, nom: string) => (...args: unknown[]) => {
				appels.push([nom, args])
				if (nom === 'range') return Promise.resolve({ data: [], error: null, status: 200, count: 0 })
				return chaine
			},
		},
	)
	const client = {
		from: () => ({
			select: (c: string) => {
				colonnes = c
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, appels, colonnes: () => colonnes }
}

describe('la requête de la page (§8, §12.5)', () => {
	const texte = champ({ id: 't', key: 'siret', type: 'text' })
	const choix = champ({ id: 's', key: 'secteur', type: 'select', options: CHOIX })
	const multi = champ({ id: 'm', key: 'tags', type: 'multiselect', options: CHOIX })
	const montant = champ({ id: 'n', key: 'ca', type: 'money' })
	const date = champ({ id: 'd', key: 'echeance', type: 'date' })
	const instant = champ({ id: 'i', key: 'rdv', type: 'datetime' })
	const caseVide = champ({ id: 'c', key: 'signe', type: 'checkbox' })

	it('sans filtre de champ, la chaîne select est celle de T4.a', () => {
		expect(colonnesAvecFiltresCommuns(COLONNES_RATTACHEMENT_LISTE, [])).toBe(COLONNES_RATTACHEMENT_LISTE)
	})

	it('un plongement par filtre, sous l’affaire ; « vide » sans !inner', () => {
		const colonnes = colonnesAvecFiltresCommuns(COLONNES_RATTACHEMENT_LISTE, [
			{ champ: texte, filtre: { sorte: 'contient', texte: 'x' } },
			{ champ: caseVide, filtre: { sorte: 'case', etat: 'vide' } },
		])
		expect(colonnes).toContain('affaire:cards!inner(id, fc0:card_common_field_values!inner(field_id), fc1:card_common_field_values(field_id), title')
	})

	it('chaque filtre borne son plongement à son champ et à sa condition', async () => {
		const { client, appels } = clientEnregistreur()
		await lirePageCards(client, {
			channelId: 'ch',
			parametres: PARAMETRES_PAR_DEFAUT,
			filtresCommuns: [
				{ champ: texte, filtre: { sorte: 'contient', texte: 'Élan' } },
				{ champ: choix, filtre: { sorte: 'choix', cles: ['btp', 'sante'] } },
				{ champ: multi, filtre: { sorte: 'choix', cles: ['btp', 'a,b'] } },
				{ champ: montant, filtre: { sorte: 'bornes', de: 1000, a: null } },
				{ champ: date, filtre: { sorte: 'dates', du: '2026-01-01', au: '2026-03-31' } },
				{ champ: instant, filtre: { sorte: 'dates', du: null, au: '2026-03-31' } },
				{ champ: caseVide, filtre: { sorte: 'case', etat: 'vide' } },
			],
		})
		const filtres = appels.filter(([nom]) => !['order', 'range'].includes(nom))
		expect(filtres).toContainEqual(['eq', ['affaire.fc0.field_id', 't']])
		expect(filtres).toContainEqual(['like', ['affaire.fc0.value_search', '%elan%']])
		expect(filtres).toContainEqual(['filter', ['affaire.fc1.value', 'cd', '["btp","sante"]']])
		expect(filtres).toContainEqual(['or', ['value.cs."[\\"btp\\"]",value.cs."[\\"a,b\\"]"', { referencedTable: 'affaire.fc2' }]])
		expect(filtres).toContainEqual(['gte', ['affaire.fc3.value', '1000']])
		expect(filtres.filter(([nom, args]) => nom === 'lte' && args[0] === 'affaire.fc3.value')).toEqual([])
		expect(filtres).toContainEqual(['gte', ['affaire.fc4.value_date', '2026-01-01']])
		expect(filtres).toContainEqual(['lte', ['affaire.fc4.value_date', '2026-03-31']])
		expect(filtres).toContainEqual(['lt', ['affaire.fc5.value_timestamp', minuitLocal('2026-03-31', 1)]])
		expect(filtres).toContainEqual(['not', ['affaire.fc6.value', 'is', null]])
		expect(filtres).toContainEqual(['neq', ['affaire.fc6.value', 'null']])
		expect(filtres).toContainEqual(['is', ['affaire.fc6', null]])
	})

	it('une case oui ou non : l’égalité au booléen JSON', async () => {
		const { client, appels } = clientEnregistreur()
		await lirePageCards(client, { channelId: 'ch', parametres: PARAMETRES_PAR_DEFAUT, filtresCommuns: [{ champ: caseVide, filtre: { sorte: 'case', etat: 'non' } }] })
		expect(appels).toContainEqual(['eq', ['affaire.fc0.value', 'false']])
	})
})
