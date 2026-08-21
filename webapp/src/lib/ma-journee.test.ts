// @verifies CRM-061 (docs/BACKLOG.md) — tranche 1 : composition et lecture de « Ma journée »
// @verifies docs/SPEC-cards.md §17.2 (la portée vit dans l'adresse, et sa liste est CLOSE),
//           §17.3 (la portée par défaut, et ce que « moi » sans session veut dire),
//           §17.4 (ce que la vue lit : colonnes, filtres, ordre TOTAL, une seule requête),
//           §17.5 (les trois sections, les deux bornes, l'horizon de sept jours),
//           §17.6 (une prochaine action absente ne rend rien), §17.7 lignes f, g et h
// @verifies docs/SPEC-webapp.md §6.4 (contrat asynchrone : l'erreur est classée sur le code HTTP)
//
// Comme `contacts.test.ts` et `mail-etat.test.ts`, ce fichier éprouve la requête RÉELLEMENT ÉMISE
// et pas seulement la valeur rendue : les colonnes demandées, la borne d'horizon, l'exclusion du
// sommeil, la présence ou l'absence du filtre par responsable et l'ordre total sont des exigences
// du §17 portées par la requête elle-même. Une lecture qui rendrait les bonnes données en trichant
// sur la requête violerait le §17.4 sans qu'aucune assertion de valeur ne s'en aperçoive.

import { describe, expect, it } from 'vitest'
import {
	CLE_URL_PORTEE,
	COLONNES_CARD_JOURNEE,
	HORIZON_JOURS,
	PORTEE_PAR_DEFAUT,
	SECTIONS_JOURNEE,
	VALEUR_URL_PORTEE_TOUS,
	adresseAffaire,
	bornesJournee,
	classerEcheance,
	decouperEnSections,
	lireJournee,
	lirePortee,
	projeterAffaire,
	type AffaireDuJour,
} from './ma-journee'
import { filtreExclusionSommeil } from './filtre-sommeil'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

type Appel = { table?: string; colonnes?: string; tris: string[]; filtres: string[] }

/**
 * Client espion : il enregistre la table, les colonnes, les tris et **chaque filtre posé**.
 *
 * C'est le procédé de `contacts.test.ts`, repris sans changement : le filtre est ce que la
 * spécification exige, et une assertion de valeur ne le verrait pas.
 */
function espion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { tris: [], filtres: [] }
	const chaine: Record<string, unknown> = {
		order: (colonne: string, options?: { ascending?: boolean }) => {
			appel.tris.push(`${colonne}.${options?.ascending === false ? 'desc' : 'asc'}`)
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	for (const nom of ['is', 'eq', 'lt', 'gte', 'not', 'or', 'limit', 'range', 'filter']) {
		chaine[nom] = (...arguments_: unknown[]) => {
			appel.filtres.push(`${nom}(${arguments_.map(String).join(',')})`)
			return chaine
		}
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

/** L'identifiant de Camille Aubert dans le seed — `docs/SPEC-seed.md` §2.3. */
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'

/** Un instant fixe : les bornes sont calculées dans le fuseau du lecteur, jamais en UTC (§17.5). */
const MIDI = new Date(2026, 7, 21, 12, 0, 0)

/** « Audit sécurité applicative », du seed : le cas nominal, avec ses deux slugs. */
const AUDIT = {
	id: '5eed0000-0000-4000-8000-0000000000c3',
	title: 'Audit sécurité applicative',
	next_action: 'Premier appel de qualification',
	next_action_at: new Date(2026, 7, 7, 14, 0, 0).toISOString(),
	channels: {
		slug: 'grands-comptes',
		name: 'Grands comptes',
		tracks: { slug: 'conseil-ia', name: 'Conseil & IA' },
	},
}

describe('lirePortee — la liste est CLOSE (§17.2)', () => {
	it('rend « tous » pour la seule valeur qui s’écrit dans l’adresse', () => {
		expect(lirePortee(VALEUR_URL_PORTEE_TOUS)).toBe('tous')
	})

	it('replie TOUT le reste sur le défaut, sans erreur — une adresse tapée à la main n’est pas une panne', () => {
		for (const valeur of ['moi', 'MOI', 'TOUS', 'couleur_préférée', '', null, undefined]) {
			expect(lirePortee(valeur)).toBe(PORTEE_PAR_DEFAUT)
		}
	})

	it('le défaut est « moi », et la clé d’adresse est nommée une seule fois (§17.3)', () => {
		expect(PORTEE_PAR_DEFAUT).toBe('moi')
		expect(CLE_URL_PORTEE).toBe('qui')
	})
})

describe('bornesJournee — les deux bornes et l’horizon (§17.5)', () => {
	it('pose le début du jour à minuit LOCAL, et le lendemain vingt-quatre heures plus tard', () => {
		const bornes = bornesJournee(MIDI)
		expect(bornes.debutJour.getHours()).toBe(0)
		expect(bornes.debutJour.getMinutes()).toBe(0)
		expect(bornes.debutJour.getSeconds()).toBe(0)
		expect(bornes.debutJour.getMilliseconds()).toBe(0)
		expect(bornes.debutJour.getDate()).toBe(21)
		expect(bornes.debutLendemain.getDate()).toBe(22)
		expect(bornes.debutLendemain.getHours()).toBe(0)
	})

	it('borne la lecture au début du HUITIÈME jour — horizon exclusif de sept jours', () => {
		const bornes = bornesJournee(MIDI)
		expect(HORIZON_JOURS).toBe(7)
		// 21 + 7 + 1 = 29 : le 28 entier est « à venir », le 29 est hors de la lecture.
		expect(bornes.horizon.getDate()).toBe(29)
		expect(bornes.horizon.getHours()).toBe(0)
	})

	it('traverse un changement de mois sans arithmétique de millisecondes', () => {
		// `+ 86400000` casserait sur un jour d'été de vingt-trois ou vingt-cinq heures ; l'écriture
		// retenue passe par `setDate`, qui compte des JOURS.
		const bornes = bornesJournee(new Date(2026, 7, 30, 9, 0, 0))
		expect(bornes.debutLendemain.getMonth()).toBe(7)
		expect(bornes.debutLendemain.getDate()).toBe(31)
		expect(bornes.horizon.getMonth()).toBe(8)
		// 30 août + 8 jours = 7 septembre : le 6 entier est encore « à venir ».
		expect(bornes.horizon.getDate()).toBe(7)
	})
})

describe('classerEcheance — les trois sections, et leurs bords (§17.5)', () => {
	const bornes = bornesJournee(MIDI)

	it('range une échéance passée en « retard », SANS aucune borne inférieure', () => {
		expect(classerEcheance(new Date(2026, 7, 20, 23, 59, 59), bornes)).toBe('retard')
		// Une échéance oubliée depuis trois mois est précisément celle qu'il faut voir.
		expect(classerEcheance(new Date(2026, 4, 1, 8, 0, 0), bornes)).toBe('retard')
	})

	it('range minuit pile et la fin du jour en « aujourd’hui » — les DEUX bords', () => {
		expect(classerEcheance(bornes.debutJour, bornes)).toBe('aujourdhui')
		expect(classerEcheance(new Date(2026, 7, 21, 23, 59, 59, 999), bornes)).toBe('aujourdhui')
	})

	it('range le lendemain et le septième jour en « à venir » — les DEUX bords', () => {
		expect(classerEcheance(bornes.debutLendemain, bornes)).toBe('avenir')
		expect(classerEcheance(new Date(2026, 7, 28, 23, 59, 59, 999), bornes)).toBe('avenir')
	})

	it('écarte ce qui dépasse l’horizon — ligne h du contrat §17.7, éprouvée dans les DEUX sens', () => {
		expect(classerEcheance(bornes.horizon, bornes)).toBeNull()
		expect(classerEcheance(new Date(2026, 9, 6, 10, 0, 0), bornes)).toBeNull()
		// La même affaire ramenée dans l'horizon paraît.
		expect(classerEcheance(new Date(2026, 7, 26, 10, 0, 0), bornes)).toBe('avenir')
	})
})

describe('projeterAffaire — ce que chaque ligne rend (§17.6)', () => {
	it('projette les quatre données et compose l’adresse de la fiche', () => {
		const affaire = projeterAffaire(AUDIT)
		expect(affaire).not.toBeNull()
		expect(affaire?.titre).toBe('Audit sécurité applicative')
		expect(affaire?.prochaineAction).toBe('Premier appel de qualification')
		expect(affaire?.adresse).toBe(
			'/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c3',
		)
		expect(affaire?.adresseChannel).toBe('/tracks/conseil-ia/grands-comptes')
		expect(affaire?.nomTrack).toBe('Conseil & IA')
		expect(affaire?.nomChannel).toBe('Grands comptes')
		// Les deux adresses partagent leur préfixe, et une seule fonction les compose : deux
		// compositions divergeraient au premier changement de route (décision 167).
		expect(affaire?.adresse?.startsWith(affaire.adresseChannel ?? 'x')).toBe(true)
	})

	it('garde une affaire SANS prochaine action : l’échéance seule est une information', () => {
		const affaire = projeterAffaire({ ...AUDIT, next_action: null })
		expect(affaire).not.toBeNull()
		expect(affaire?.prochaineAction).toBeNull()
	})

	it('écarte une ligne SANS échéance plutôt que de lui inventer une section', () => {
		expect(projeterAffaire({ ...AUDIT, next_action_at: null })).toBeNull()
	})

	it('écarte une échéance illisible plutôt que de rendre une date invalide', () => {
		expect(projeterAffaire({ ...AUDIT, next_action_at: 'pas-une-date' })).toBeNull()
	})

	it('rend l’affaire SANS adresse quand un slug manque, plutôt que de la masquer', () => {
		// Un lien vers une adresse incomplète mènerait à un écran que l'utilisateur croirait cassé ;
		// la masquer retrancherait une échéance de la journée.
		expect(adresseAffaire({ ...AUDIT, channels: null })).toBeNull()
		expect(adresseAffaire({ ...AUDIT, channels: { ...AUDIT.channels, tracks: null } })).toBeNull()
		const sansTrack = projeterAffaire({ ...AUDIT, channels: { ...AUDIT.channels, tracks: null } })
		expect(sansTrack).not.toBeNull()
		expect(sansTrack?.adresse).toBeNull()
		expect(sansTrack?.adresseChannel).toBeNull()
		expect(sansTrack?.nomTrack).toBeNull()
	})
})

describe('decouperEnSections — le découpage se fait à la COMPOSITION (§17.5)', () => {
	const bornes = bornesJournee(MIDI)
	const affaire = (id: string, echeance: Date): AffaireDuJour => ({
		id,
		titre: id,
		prochaineAction: null,
		echeance,
		adresse: null,
		adresseChannel: null,
		nomTrack: null,
		nomChannel: null,
	})

	it('rend les trois sections dans l’ordre de l’écran, même vides', () => {
		const sections = decouperEnSections([], bornes)
		expect(sections.map((groupe) => groupe.section)).toEqual([...SECTIONS_JOURNEE])
		expect(sections.every((groupe) => groupe.affaires.length === 0)).toBe(true)
	})

	it('répartit chaque affaire dans une seule section, et n’en perd aucune', () => {
		const affaires = [
			affaire('en-retard', new Date(2026, 7, 7, 14, 0, 0)),
			affaire('aujourdhui', new Date(2026, 7, 21, 9, 0, 0)),
			affaire('a-venir', new Date(2026, 7, 24, 11, 0, 0)),
		]
		const sections = decouperEnSections(affaires, bornes)
		expect(sections.map((groupe) => groupe.affaires.map((une) => une.id))).toEqual([
			['en-retard'],
			['aujourdhui'],
			['a-venir'],
		])
	})

	it('CONSERVE l’ordre du serveur à l’intérieur d’une section, sans le rejouer', () => {
		// La lecture ordonne déjà par échéance, puis par titre, puis par identifiant (§17.4). Le
		// rejouer ici le ferait diverger le jour où la requête changera.
		const affaires = [
			affaire('b', new Date(2026, 7, 21, 8, 0, 0)),
			affaire('a', new Date(2026, 7, 21, 9, 0, 0)),
		]
		const sections = decouperEnSections(affaires, bornes)
		expect(sections[1]?.affaires.map((une) => une.id)).toEqual(['b', 'a'])
	})
})

describe('lireJournee — la requête réellement émise (§17.4)', () => {
	it('interroge `cards` et demande EXACTEMENT les colonnes du §17.4', async () => {
		const { client, appel } = espion({ data: [AUDIT], error: null, status: 200 })
		await lireJournee(client, { portee: 'tous', idUtilisateur: CAMILLE, maintenant: MIDI })
		expect(appel.table).toBe('cards')
		expect(appel.colonnes).toBe(COLONNES_CARD_JOURNEE)
		// Les deux slugs sont EXIGÉS par l'adresse d'une affaire, et les deux noms par la pilule.
		expect(COLONNES_CARD_JOURNEE).toContain('channels!cards_channel_id_workspace_id_fkey')
		expect(COLONNES_CARD_JOURNEE).toContain('tracks(slug, name)')
		// Ce qui n'est PAS demandé est aussi une décision : cette vue range par le temps.
		expect(COLONNES_CARD_JOURNEE).not.toContain('amount')
		expect(COLONNES_CARD_JOURNEE).not.toContain('current_step_id')
	})

	it('applique les quatre filtres de la lecture, dont la borne d’horizon', async () => {
		const { client, appel } = espion({ data: [], error: null, status: 200 })
		await lireJournee(client, { portee: 'tous', idUtilisateur: null, maintenant: MIDI })
		expect(appel.filtres).toContain('not(next_action_at,is,null)')
		expect(appel.filtres).toContain('is(archived_at,null)')
		expect(appel.filtres).toContain('is(deleted_at,null)')
		expect(appel.filtres).toContain(`lt(next_action_at,${bornesJournee(MIDI).horizon.toISOString()})`)
	})

	it('RÉEMPLOIE le filtre d’exclusion du sommeil, il ne le réécrit pas (§16.12.1)', async () => {
		const { client, appel } = espion({ data: [], error: null, status: 200 })
		await lireJournee(client, { portee: 'tous', idUtilisateur: null, maintenant: MIDI })
		expect(appel.filtres).toContain(`or(${filtreExclusionSommeil(MIDI)})`)
	})

	it('ordonne de façon TOTALE : échéance, puis titre, puis identifiant (§17.4)', async () => {
		const { client, appel } = espion({ data: [], error: null, status: 200 })
		await lireJournee(client, { portee: 'tous', idUtilisateur: null, maintenant: MIDI })
		expect(appel.tris).toEqual(['next_action_at.asc', 'title.asc', 'id.asc'])
	})

	it('n’envoie AUCUN filtre par responsable sous la portée « tous »', async () => {
		const { client, appel } = espion({ data: [], error: null, status: 200 })
		await lireJournee(client, { portee: 'tous', idUtilisateur: CAMILLE, maintenant: MIDI })
		expect(appel.filtres.some((filtre) => filtre.startsWith('eq(owner_id'))).toBe(false)
	})

	it('envoie le filtre par responsable sous la portée « moi », et lui SEUL change', async () => {
		const { client, appel } = espion({ data: [], error: null, status: 200 })
		await lireJournee(client, { portee: 'moi', idUtilisateur: CAMILLE, maintenant: MIDI })
		expect(appel.filtres).toContain(`eq(owner_id,${CAMILLE})`)
	})

	it('n’émet AUCUNE requête sous « moi » sans session, et rend une liste vide (§17.3)', async () => {
		// Envoyer `owner_id=eq.null` demanderait les affaires SANS responsable, ce que l'écran ne
		// promet pas ; ne rien envoyer ouvrirait une portée que l'utilisateur n'a pas demandée.
		const { client, appel } = espion({ data: [AUDIT], error: null, status: 200 })
		const lu = await lireJournee(client, { portee: 'moi', idUtilisateur: null, maintenant: MIDI })
		expect(appel.table).toBeUndefined()
		expect(lu).toEqual({ statut: 'pret', donnees: [] })
	})

	it('classe un refus explicite sur le code HTTP, jamais sur le texte du message', async () => {
		const { client } = espion({ data: null, error: { message: 'refus' }, status: 403 })
		const lu = await lireJournee(client, { portee: 'tous', idUtilisateur: null, maintenant: MIDI })
		expect(lu.statut).toBe('erreur')
		if (lu.statut === 'erreur') expect(lu.erreur.nature).toBe('forbidden')
	})

	it('classe une requête qui n’aboutit pas en « network », et non en erreur inconnue', async () => {
		const client = {
			from: () => {
				throw new Error('coupure')
			},
		} as unknown as ClientCrm
		const lu = await lireJournee(client, { portee: 'tous', idUtilisateur: null, maintenant: MIDI })
		expect(lu.statut).toBe('erreur')
		if (lu.statut === 'erreur') expect(lu.erreur.nature).toBe('network')
	})

	it('un refus par RLS n’est PAS une erreur : zéro ligne est une liste vide (§17.8)', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		const lu = await lireJournee(client, { portee: 'tous', idUtilisateur: null, maintenant: MIDI })
		expect(lu).toEqual({ statut: 'pret', donnees: [] })
	})

	it('écarte silencieusement une ligne sans échéance rendue par le serveur', async () => {
		const { client } = espion({
			data: [AUDIT, { ...AUDIT, id: 'sans-echeance', next_action_at: null }],
			error: null,
			status: 200,
		})
		const lu = await lireJournee(client, { portee: 'tous', idUtilisateur: null, maintenant: MIDI })
		expect(lu.statut).toBe('pret')
		if (lu.statut === 'pret') expect(lu.donnees.map((une) => une.id)).toEqual([AUDIT.id])
	})
})
