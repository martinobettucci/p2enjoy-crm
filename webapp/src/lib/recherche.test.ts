// @verifies CRM-065 (docs/BACKLOG.md) — tranche 2, sous-tranche 2a : le moteur d'appel
// @verifies docs/SPEC-recherche.md §13.1 (une lecture puis au plus deux résolutions, et les
//           résolutions OMISES quand leur famille est absente), §13.2 (la garde d'ordre),
//           §13.3 (le délai de frappe est un contrat, pas un réglage caché), §13.4 (la
//           destination famille par famille, et la ligne SANS LIEN), §13.5 (le message mène à
//           l'inbox, et son adresse porte le message), §13.6 (aucun rôle)
// @verifies docs/SPEC-recherche.md §11 M14 (la RPC ne rend aucune adresse), M15 (l'embarquement
//           est NOMMÉ), M18 (le générateur déclare non nul ce qui est nullable), §14.2 (la borne)
// @verifies docs/DESIGN_SYSTEM.md §5.46 (la ligne sans destination reste rendue)
//
// Ces tests portent sur la LOGIQUE, sans navigateur : c'est ce que la séparation du module rend
// possible (§10.2). La pile réelle est éprouvée par `e2e/api/recherche-palette.spec.ts`, et la
// surface par `e2e/ui/recherche.spec.ts`.

import { describe, expect, it } from 'vitest'
import {
	BORNE_PALETTE,
	DELAI_FRAPPE_MS,
	FAMILLES,
	PARAMETRE_MESSAGE,
	composerResultat,
	creerSequenceur,
	estFamilleConnue,
	rechercher,
	type LigneRecherche,
} from './recherche'
import {
	COLONNES_ADRESSE_AFFAIRE,
	COLONNES_ADRESSE_COMMENTAIRE,
} from './colonnes-recherche'
import type { ClientCrm } from './supabase'

/** Une ligne de la RPC, aux valeurs par défaut du contrat (§6.1). */
const ligne = (partiel: Partial<LigneRecherche> & Pick<LigneRecherche, 'objet' | 'id'>): LigneRecherche => ({
	workspace_id: 'ws-1',
	titre: null,
	sous_titre: null,
	extrait: null,
	rang: 1,
	...partiel,
})

/** Ce qu'un appel émis vers la pile a demandé. */
type AppelEmis = { readonly table: string; readonly colonnes: string; readonly ids: readonly string[] }

/**
 * Un double du client, qui retient TOUT ce qui a été émis.
 *
 * Il retient les appels plutôt que de les compter : le §13.1 pose que les résolutions sont
 * **omises** quand leur famille est absente, et un compteur ne dirait pas laquelle a été omise.
 */
function clientDouble(options: {
	readonly lignes?: readonly LigneRecherche[]
	readonly erreurRpc?: { readonly message: string; readonly status: number }
	readonly cards?: readonly unknown[]
	readonly erreurCards?: boolean
	readonly commentaires?: readonly unknown[]
}) {
	const appels: AppelEmis[] = []
	const rpc: { nom?: string; arguments?: Record<string, unknown> } = {}
	const client = {
		rpc: (nom: string, args: Record<string, unknown>) => {
			rpc.nom = nom
			rpc.arguments = args
			if (options.erreurRpc !== undefined) {
				return Promise.resolve({
					data: null,
					error: { message: options.erreurRpc.message },
					status: options.erreurRpc.status,
				})
			}
			return Promise.resolve({ data: options.lignes ?? [], error: null, status: 200 })
		},
		from: (table: string) => ({
			select: (colonnes: string) => ({
				in: (_colonne: string, ids: readonly string[]) => {
					appels.push({ table, colonnes, ids: [...ids] })
					if (table === 'cards') {
						if (options.erreurCards === true) {
							return Promise.resolve({ data: null, error: { message: 'boum' }, status: 500 })
						}
						return Promise.resolve({ data: options.cards ?? [], error: null, status: 200 })
					}
					return Promise.resolve({ data: options.commentaires ?? [], error: null, status: 200 })
				},
			}),
		}),
	} as unknown as ClientCrm
	return { client, appels, rpc }
}

describe('l’appel à la RPC (§13.1, §14.2)', () => {
	it('appelle `recherche_globale` avec le terme TEL QUEL et la borne d’affichage', async () => {
		const { client, rpc } = clientDouble({ lignes: [] })
		await rechercher(client, '  Amélie  Dupont!! ')

		expect(rpc.nom).toBe('recherche_globale')
		// LE TERME EST ENVOYÉ TEL QUEL (§14.2) : le §6.2 pose que la normalisation est entièrement
		// écrite en base. En poser une seconde ici ferait deux définitions du même découpage.
		expect(rpc.arguments).toEqual({ p_terme: '  Amélie  Dupont!! ', p_limite: BORNE_PALETTE })
	})

	it('classe un refus du transport, et ne rend PAS une liste vide à sa place', async () => {
		const { client } = clientDouble({ erreurRpc: { message: 'permission denied', status: 401 } })
		const etat = await rechercher(client, 'vitrine')

		// Aucune valeur par défaut ne masque une erreur (`CLAUDE.md` §18) : une liste vide dirait
		// « rien ne correspond » là où la recherche n'a pas eu lieu.
		expect(etat.statut).toBe('erreur')
		if (etat.statut !== 'erreur') throw new Error('état inattendu')
		expect(etat.erreur.nature).toBe('forbidden')
	})
})

describe('les résolutions d’adresse (§13.1, M15)', () => {
	it('N’ÉMET AUCUNE résolution quand aucune affaire ni commentaire n’est trouvé', async () => {
		const { client, appels } = clientDouble({
			lignes: [ligne({ objet: 'contact', id: 'c-1' }), ligne({ objet: 'organisation', id: 'o-1' })],
		})
		await rechercher(client, 'sogexia')

		// Une frappe qui ne rend que des contacts n'émet QU'UNE requête (§13.1).
		expect(appels).toEqual([])
	})

	it('émet UNE seule lecture groupée par famille, avec la relation NOMMÉE (M15)', async () => {
		const { client, appels } = clientDouble({
			lignes: [
				ligne({ objet: 'affaire', id: 'a-1' }),
				ligne({ objet: 'affaire', id: 'a-2' }),
				ligne({ objet: 'commentaire', id: 'k-1' }),
			],
		})
		await rechercher(client, 'refonte')

		const cards = appels.filter((appel) => appel.table === 'cards')
		const commentaires = appels.filter((appel) => appel.table === 'card_comments')
		// CE N'EST PAS `N + 1` : deux affaires, UNE requête.
		expect(cards).toHaveLength(1)
		expect(cards[0]?.ids).toEqual(['a-1', 'a-2'])
		expect(commentaires).toHaveLength(1)
		expect(commentaires[0]?.ids).toEqual(['k-1'])
		// LA RELATION EST NOMMÉE, et c'est mesuré (M15) : `cards` porte deux clés étrangères vers
		// `channels`, et l'embarquement nu rend `PGRST201`.
		expect(cards[0]?.colonnes).toBe(COLONNES_ADRESSE_AFFAIRE)
		expect(cards[0]?.colonnes).toContain('channels!cards_channel_id_workspace_id_fkey')
		expect(commentaires[0]?.colonnes).toBe(COLONNES_ADRESSE_COMMENTAIRE)
	})

	it('un ÉCHEC de résolution ne fait pas échouer la recherche : la ligne reste, sans lien', async () => {
		const { client } = clientDouble({
			lignes: [ligne({ objet: 'affaire', id: 'a-1', titre: 'Refonte' })],
			erreurCards: true,
		})
		const etat = await rechercher(client, 'refonte')

		// Cacher les résultats parce que leur adresse n'a pas pu être lue serait perdre ce que la
		// recherche a trouvé (§13.4).
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') throw new Error('état inattendu')
		expect(etat.donnees.resultats).toHaveLength(1)
		expect(etat.donnees.resultats[0]?.titre).toBe('Refonte')
		expect(etat.donnees.resultats[0]?.adresse).toBeNull()
	})
})

describe('la destination, famille par famille (§13.4, §13.5)', () => {
	const adressesAffaires = new Map([['a-1', '/tracks/conseil-ia/grands-comptes/cards/a-1']])
	const adressesCommentaires = new Map([['k-1', '/tracks/conseil-ia/grands-comptes/cards/a-1']])

	it('mène une AFFAIRE à sa fiche, par l’adresse résolue', () => {
		const resultat = composerResultat(
			ligne({ objet: 'affaire', id: 'a-1' }),
			adressesAffaires,
			adressesCommentaires,
		)
		expect(resultat.adresse).toBe('/tracks/conseil-ia/grands-comptes/cards/a-1')
	})

	it('mène un COMMENTAIRE à l’affaire commentée, JAMAIS à lui-même', () => {
		const resultat = composerResultat(
			ligne({ objet: 'commentaire', id: 'k-1' }),
			adressesAffaires,
			adressesCommentaires,
		)
		// Aucune adresse du produit ne désigne un commentaire ; le fil de l'affaire est l'endroit
		// où il se lit. La tranche 1 a préparé cela en excluant le commentaire d'une affaire à la
		// corbeille (§6.7 ligne *i*), sans quoi la palette offrirait une DESTINATION MORTE.
		expect(resultat.adresse).toBe('/tracks/conseil-ia/grands-comptes/cards/a-1')
		expect(resultat.adresse).not.toContain('k-1')
	})

	it('mène un CONTACT et une ORGANISATION par leur seul identifiant — aucune résolution due', () => {
		const contact = composerResultat(ligne({ objet: 'contact', id: 'c-1' }), new Map(), new Map())
		const organisation = composerResultat(
			ligne({ objet: 'organisation', id: 'o-1' }),
			new Map(),
			new Map(),
		)
		expect(contact.adresse).toBe('/contacts/c-1')
		expect(organisation.adresse).toBe('/contacts/organisations/o-1')
	})

	it('mène un MESSAGE à l’inbox, et son adresse PORTE le message (§13.5)', () => {
		const resultat = composerResultat(ligne({ objet: 'message', id: 'm-1' }), new Map(), new Map())
		expect(resultat.adresse).toBe(`/inbox?${PARAMETRE_MESSAGE}=m-1`)
	})

	it('échappe l’identifiant du message : une adresse ne se construit jamais par collage', () => {
		const resultat = composerResultat(
			ligne({ objet: 'message', id: 'm 1&x=2' }),
			new Map(),
			new Map(),
		)
		expect(resultat.adresse).toBe(`/inbox?${PARAMETRE_MESSAGE}=m%201%26x%3D2`)
	})

	it('rend une ligne SANS LIEN quand l’adresse d’une affaire ne se résout pas', () => {
		// Trois absences produisent la même réponse — pas de channel, pas de track, pas de slug —
		// et les distinguer à l'écran divulguerait ce que la RLS ferme.
		const resultat = composerResultat(
			ligne({ objet: 'affaire', id: 'a-inconnue', titre: 'Affaire hors de portée' }),
			adressesAffaires,
			adressesCommentaires,
		)
		expect(resultat.titre).toBe('Affaire hors de portée')
		expect(resultat.adresse).toBeNull()
	})

	it('rend une ligne SANS FAMILLE et sans lien quand la base rend un discriminant inconnu', () => {
		// Une sixième famille que la base rendrait un jour ne doit ni faire échouer la lecture, ni
		// atteindre l'écran sous sa forme brute (§5.14 du design system).
		const resultat = composerResultat(ligne({ objet: 'budget', id: 'b-1' }), new Map(), new Map())
		expect(resultat.famille).toBeNull()
		expect(resultat.adresse).toBeNull()
	})

	it('reconnaît les cinq familles du contrat, et elles seules', () => {
		expect([...FAMILLES]).toEqual(['affaire', 'contact', 'organisation', 'commentaire', 'message'])
		for (const famille of FAMILLES) expect(estFamilleConnue(famille)).toBe(true)
		expect(estFamilleConnue('budget')).toBe(false)
	})
})

describe('les colonnes nullables que le générateur déclare non nulles (M18)', () => {
	it('accepte `titre`, `sous_titre` et `extrait` nuls sans rien inventer', () => {
		const resultat = composerResultat(
			ligne({ objet: 'commentaire', id: 'k-9', titre: null, sous_titre: null, extrait: null }),
			new Map(),
			new Map(),
		)
		// Le §6.1 les rend nullables PAR CONTRAT, et M1 le mesure. Un type ne garantit jamais une
		// valeur (`docs/SPEC-types.md`) : le module ne substitue ni chaîne vide, ni tiret.
		expect(resultat.titre).toBeNull()
		expect(resultat.sousTitre).toBeNull()
		expect(resultat.extrait).toBeNull()
	})
})

describe('la troncature écrite (§14.2)', () => {
	it('ne l’annonce PAS tant que la liste n’est pas pleine', async () => {
		const { client } = clientDouble({ lignes: [ligne({ objet: 'contact', id: 'c-1' })] })
		const etat = await rechercher(client, 'x', 3)
		if (etat.statut !== 'pret') throw new Error('état inattendu')
		expect(etat.donnees.tronque).toBe(false)
	})

	it('l’annonce dès que la liste est pleine — jamais laissée à deviner', async () => {
		const { client } = clientDouble({
			lignes: [
				ligne({ objet: 'contact', id: 'c-1' }),
				ligne({ objet: 'contact', id: 'c-2' }),
				ligne({ objet: 'contact', id: 'c-3' }),
			],
		})
		const etat = await rechercher(client, 'x', 3)
		if (etat.statut !== 'pret') throw new Error('état inattendu')
		expect(etat.donnees.tronque).toBe(true)
	})
})

describe('LA GARDE D’ORDRE (§13.2), qui est la règle la plus importante du module', () => {
	it('reconnaît le rang le plus récemment émis, et lui seul', () => {
		const sequenceur = creerSequenceur()
		const premier = sequenceur.suivant()
		const second = sequenceur.suivant()

		expect(sequenceur.estCourant(second)).toBe(true)
		// La réponse à `refont` arrive après celle de `refonte` : elle est JETÉE. Sans cette garde,
		// la liste afficherait le résultat d'un terme que l'utilisateur a déjà dépassé.
		expect(sequenceur.estCourant(premier)).toBe(false)
	})

	it('éprouve le cas réel : deux réponses revenant dans l’ORDRE INVERSE de leur émission', async () => {
		const sequenceur = creerSequenceur()
		const rendu: string[] = []

		// Deux recherches émises dans l'ordre `refont`, puis `refonte`. La PREMIÈRE répond en
		// dernier — c'est exactement ce que le réseau peut faire.
		const rangA = sequenceur.suivant()
		const rangB = sequenceur.suivant()

		const reponseB = Promise.resolve('refonte')
		const reponseA = reponseB.then(() => 'refont')

		const valeurB = await reponseB
		if (sequenceur.estCourant(rangB)) rendu.push(valeurB)
		const valeurA = await reponseA
		if (sequenceur.estCourant(rangA)) rendu.push(valeurA)

		// C'est la DERNIÈRE ÉMISE qui gagne, jamais la dernière arrivée.
		expect(rendu).toEqual(['refonte'])
	})

	it('le délai de frappe est un CONTRAT, pas un réglage caché (§13.3)', () => {
		// Ce n'est pas la temporisation arbitraire que `CLAUDE.md` §18 interdit : celle-là masque
		// une erreur ou simule un succès, celle-ci ne masque rien et n'affirme rien. Sa valeur est
		// écrite dans la spécification, et cette assertion la tient.
		expect(DELAI_FRAPPE_MS).toBe(200)
	})
})
