// @verifies CRM-057 (docs/BACKLOG.md) — inbox globale : arbre, réduction du HTML, requêtes, refus
// @verifies docs/SPEC-mail-subsystem.md §18.3 (l'arborescence ne montre que ce qui porte du
//           courrier, et « Non classés » reste), §18.4 (le HTML n'est jamais affiché), §18.8
// @verifies docs/DESIGN_SYSTEM.md §5.4 (inbox) ; docs/SPEC-webapp.md §6.4
// @verifies docs/JOURNAL.md décision 327
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue — même motif que
// `commentaires.test.ts` : la borne, le filtre et l'ordre total sont portés par la requête, et un
// test qui n'observerait que la réponse les laisserait disparaître sans bruit.
//
// LA RÉDUCTION DU HTML EST ÉPROUVÉE SANS NAVIGATEUR : c'est tout l'objet de la séparation entre
// `inbox.ts` et `RouteInbox.tsx`, et c'est la garantie de sécurité la plus importante de l'unité.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_LISTE,
	COLONNES_MESSAGE,
	MEME_SELECTION,
	MESSAGES_PAR_PAGE,
	OBJET_ABSENT,
	classerRefusClassement,
	construireArbre,
	corpsAffichable,
	lireArborescence,
	lireMessages,
	projeterMessage,
	reduireHtmlEnTexte,
} from './inbox'
import type { ClientCrm } from './supabase'

// TROIS CHAMPS AJOUTÉS PAR `CRM-081` TRANCHE 2 e (docs/SPEC-cards.md §16.15.3) : la projection
// calcule désormais la clé du fil, qui exige `references_ids` et `rfc822_message_id`, et rattache le
// message à son workspace. Le seed porte `references_ids` VIDE — mesure A du §16.15.1 —, et la
// fixture le reproduit plutôt que d'inventer une chaîne de références que le produit ne voit jamais.
const ligne = (partiel: Partial<Parameters<typeof projeterMessage>[0]> = {}) => ({
	id: 'm1',
	workspace_id: 'w1',
	references_ids: [] as string[],
	rfc822_message_id: '<m1@p2enjoy.test>',
	card_id: null,
	classification: 'unclassified',
	subject: 'Demande de devis',
	from_address: 'bizdev@p2enjoy.test',
	from_name: null,
	received_at: '2026-08-11T09:00:00.000Z',
	...partiel,
})

describe('la projection d’un message', () => {
	it('nomme l’expéditeur quand il a un nom, et son adresse seule sinon', () => {
		expect(projeterMessage(ligne()).expediteur).toBe('bizdev@p2enjoy.test')
		expect(projeterMessage(ligne({ from_name: 'Driss Lemoine' })).expediteur).toBe(
			'Driss Lemoine <bizdev@p2enjoy.test>',
		)
		// Un nom blanc ne vaut pas un nom : « ` ` <adresse> » serait un trou visible dans la liste.
		expect(projeterMessage(ligne({ from_name: '   ' })).expediteur).toBe('bizdev@p2enjoy.test')
	})

	it('remplace un objet absent ou blanc par un repli, jamais par une ligne muette', () => {
		expect(projeterMessage(ligne({ subject: null })).objet).toBe(OBJET_ABSENT)
		expect(projeterMessage(ligne({ subject: '  ' })).objet).toBe(OBJET_ABSENT)
	})
})

// --- La réduction du HTML — §18.4 ---------------------------------------------------------------

describe('la réduction du HTML en texte (§18.4)', () => {
	it('NE RESTITUE JAMAIS de balise : le HTML d’un expéditeur ne doit pas atteindre le DOM', () => {
		const reduit = reduireHtmlEnTexte('<p>Bonjour <b>Camille</b></p><p>Merci</p>')
		expect(reduit).toBe('Bonjour Camille\nMerci')
		expect(reduit).not.toContain('<')
	})

	it('retire un `script` AVEC son contenu — le laisser afficherait du code au fil du courrier', () => {
		const reduit = reduireHtmlEnTexte('<p>Avant</p><script>alert("xss")</script><p>Après</p>')
		expect(reduit).not.toContain('alert')
		expect(reduit).toBe('Avant\nAprès')
	})

	it('retire un `style` AVEC son contenu', () => {
		expect(reduireHtmlEnTexte('<style>p{color:red}</style><p>Texte</p>')).toBe('Texte')
	})

	it('ne laisse passer ni gestionnaire d’événement, ni source d’image distante', () => {
		const reduit = reduireHtmlEnTexte(
			'<img src="https://pisteur.example/p.gif" onerror="voler()"><div onclick="voler()">Clic</div>',
		)
		expect(reduit).toBe('Clic')
		expect(reduit).not.toContain('pisteur')
		expect(reduit).not.toContain('onerror')
	})

	it('transforme les balises de bloc et les sauts en retours à la ligne', () => {
		expect(reduireHtmlEnTexte('Une<br>Deux<br/>Trois')).toBe('Une\nDeux\nTrois')
		expect(reduireHtmlEnTexte('<ul><li>a</li><li>b</li></ul>')).toBe('a\nb')
	})

	it('décode les entités les plus courantes, sans réintroduire de balise', () => {
		expect(reduireHtmlEnTexte('<p>Conseil &amp; IA</p>')).toBe('Conseil & IA')
		// `&lt;script&gt;` était du TEXTE chez l'expéditeur : il le reste, décodé, et n'est jamais
		// réinterprété — la réduction produit une chaîne, que React échappe à l'affichage.
		expect(reduireHtmlEnTexte('<p>&lt;script&gt;</p>')).toBe('<script>')
	})

	it('réduit les lignes vides en excès plutôt que d’étirer le message', () => {
		expect(reduireHtmlEnTexte('<p>a</p><p></p><p></p><p></p><p>b</p>')).toBe('a\n\nb')
	})
})

describe('le corps affichable', () => {
	it('préfère le texte de l’expéditeur au HTML réduit', () => {
		expect(corpsAffichable('Bonjour', '<p>Bonjour en HTML</p>')).toEqual({
			corps: 'Bonjour',
			reduitDepuisHtml: false,
		})
	})

	it('réduit le HTML quand il n’y a que lui, et le DIT', () => {
		expect(corpsAffichable(null, '<p>Bonjour</p>')).toEqual({
			corps: 'Bonjour',
			reduitDepuisHtml: true,
		})
		// Un texte blanc n'est pas un texte : sans cela, l'écran afficherait un message vide alors
		// que le HTML en porte le contenu.
		expect(corpsAffichable('   ', '<p>Bonjour</p>').reduitDepuisHtml).toBe(true)
	})

	it('rend un corps vide quand le message n’a ni texte ni HTML — sans prétendre à une erreur', () => {
		expect(corpsAffichable(null, null)).toEqual({ corps: '', reduitDepuisHtml: false })
	})
})

// --- L'arborescence — §18.3 ---------------------------------------------------------------------

const ligneArbre = (partiel: Record<string, unknown>) => ({
	track_id: null,
	track_name: null,
	channel_id: null,
	channel_name: null,
	card_id: null,
	card_title: null,
	nombre: 0,
	...partiel,
}) as never

describe('la construction de l’arbre (§18.3)', () => {
	it('porte le compte des non classés, et le garde MÊME À ZÉRO', () => {
		expect(construireArbre([ligneArbre({ nombre: 0 })])).toEqual({ nonClasses: 0, tracks: [] })
		expect(construireArbre([ligneArbre({ nombre: 3 })]).nonClasses).toBe(3)
	})

	it('cumule les comptes des cards vers leur channel, puis vers leur track', () => {
		const arbre = construireArbre([
			ligneArbre({ nombre: 1 }),
			ligneArbre({
				track_id: 't1', track_name: 'Studio web', channel_id: 'h1', channel_name: 'Prospection',
				card_id: 'c1', card_title: 'Refonte', nombre: 2,
			}),
			ligneArbre({
				track_id: 't1', track_name: 'Studio web', channel_id: 'h1', channel_name: 'Prospection',
				card_id: 'c2', card_title: 'Intranet', nombre: 5,
			}),
			ligneArbre({
				track_id: 't1', track_name: 'Studio web', channel_id: 'h2', channel_name: 'Maintenance',
				card_id: 'c3', card_title: 'Support', nombre: 4,
			}),
		])
		expect(arbre.nonClasses).toBe(1)
		expect(arbre.tracks).toHaveLength(1)
		expect(arbre.tracks[0]?.nombre).toBe(11)
		expect(arbre.tracks[0]?.channels.map((channel) => [channel.nom, channel.nombre])).toEqual([
			['Prospection', 7],
			['Maintenance', 4],
		])
	})

	// L'arborescence ne rejoue PAS le board : une inbox est une vue du courrier, pas un second
	// board. Seules les branches qui portent du courrier apparaissent (§18.3).
	it('ne fabrique aucune branche : un track sans courrier n’a pas de ligne, donc pas de nœud', () => {
		const arbre = construireArbre([ligneArbre({ nombre: 0 })])
		expect(arbre.tracks).toEqual([])
	})

	it('conserve l’ORDRE rendu par la base, sans le retrier', () => {
		const arbre = construireArbre([
			ligneArbre({ nombre: 0 }),
			ligneArbre({ track_id: 'tz', track_name: 'Zèbre', channel_id: 'h', channel_name: 'C', card_id: 'a', card_title: 'A', nombre: 1 }),
			ligneArbre({ track_id: 'ta', track_name: 'Alpha', channel_id: 'h2', channel_name: 'C', card_id: 'b', card_title: 'B', nombre: 1 }),
		])
		expect(arbre.tracks.map((track) => track.nom)).toEqual(['Zèbre', 'Alpha'])
	})
})

describe('la comparaison de deux sélections', () => {
	it('distingue les non classés d’une card, et deux cards entre elles', () => {
		expect(MEME_SELECTION({ genre: 'non-classes' }, { genre: 'non-classes' })).toBe(true)
		expect(MEME_SELECTION({ genre: 'non-classes' }, { genre: 'card', cardId: 'c1' })).toBe(false)
		expect(MEME_SELECTION({ genre: 'card', cardId: 'c1' }, { genre: 'card', cardId: 'c2' })).toBe(false)
		expect(MEME_SELECTION({ genre: 'card', cardId: 'c1' }, { genre: 'card', cardId: 'c1' })).toBe(true)
		expect(MEME_SELECTION(null, null)).toBe(true)
		expect(MEME_SELECTION(null, { genre: 'non-classes' })).toBe(false)
	})
})

// --- La requête réellement émise ----------------------------------------------------------------

type Appel = {
	table?: string
	colonnes?: string
	egalites: [string, unknown][]
	nuls: string[]
	tris: [string, boolean | undefined][]
	limite?: number
	rpc?: string
}

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }

function clientEspion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { egalites: [], nuls: [], tris: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.egalites.push([colonne, valeur])
			return chaine
		},
		is: (colonne: string) => {
			appel.nuls.push(colonne)
			return chaine
		},
		order: (colonne: string, options?: { ascending?: boolean }) => {
			appel.tris.push([colonne, options?.ascending])
			return chaine
		},
		limit: (valeur: number) => {
			appel.limite = valeur
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
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
		rpc: (nom: string) => {
			appel.rpc = nom
			return chaine
		},
	} as unknown as ClientCrm
	return { client, appel }
}

describe('les lectures', () => {
	it('demande l’arborescence à la FONCTION, jamais en agrégeant les messages du client', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireArborescence(client)
		expect(appel.rpc).toBe('inbox_arborescence')
	})

	it('filtre les non classés sur l’ABSENCE de card, dans un ordre TOTAL et borné', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireMessages(client, { genre: 'non-classes' })

		expect(appel.table).toBe('mail_messages')
		expect(appel.colonnes).toBe(COLONNES_LISTE)
		expect(appel.nuls).toEqual(['card_id'])
		expect(appel.egalites).toEqual([])
		// `received_at` PUIS `id`, décroissants : sans le second, l'ordre n'est pas total.
		expect(appel.tris).toEqual([
			['received_at', false],
			['id', false],
		])
		expect(appel.limite).toBe(MESSAGES_PAR_PAGE)
	})

	it('filtre un dossier de card sur son identifiant', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireMessages(client, { genre: 'card', cardId: 'c1' })
		expect(appel.egalites).toEqual([['card_id', 'c1']])
		expect(appel.nuls).toEqual([])
	})

	// L'écran DIT qu'il tronque : une liste bornée en silence se lit comme une liste complète.
	it('annonce la troncature exactement quand la page est pleine', async () => {
		const pleine = Array.from({ length: MESSAGES_PAR_PAGE }, (_, rang) => ligne({ id: `m${rang}` }))
		const { client } = clientEspion({ data: pleine, error: null, status: 200 })
		const etat = await lireMessages(client, { genre: 'non-classes' })
		expect(etat.statut === 'pret' && etat.donnees.tronquee).toBe(true)

		const { client: court } = clientEspion({ data: [ligne()], error: null, status: 200 })
		const bref = await lireMessages(court, { genre: 'non-classes' })
		expect(bref.statut === 'pret' && bref.donnees.tronquee).toBe(false)
	})

	it('ne demande PAS le corps pour une liste, et le demande pour un message', () => {
		expect(COLONNES_LISTE).not.toContain('body_text')
		expect(COLONNES_LISTE).not.toContain('body_html')
		expect(COLONNES_MESSAGE).toContain('body_text')
		expect(COLONNES_MESSAGE).toContain('body_html')
	})

	it('classe un refus du backend, et ne rend jamais une liste vide à la place', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'refusé' }, status: 403 })
		const etat = await lireMessages(client, { genre: 'non-classes' })
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})

	// Un client absent est une CONFIGURATION incomplète, pas une panne réseau : proposer
	// « réessayer » ne changerait rien (docs/SPEC-webapp.md §6.4).
	it('distingue un client absent d’une panne réseau', async () => {
		const etat = await lireArborescence(null)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') {
			expect(etat.erreur.nature).toBe('unknown')
			expect(etat.erreur.detail).toBe('configuration_absente')
		}
	})
})

// --- Les refus du classement --------------------------------------------------------------------

describe('la classification d’un refus de classement (§18.2)', () => {
	it('nomme le refus de droit, quel que soit celui des deux qui manque', () => {
		expect(classerRefusClassement(403, '42501', 'forbidden').nature).toBe('forbidden')
		expect(classerRefusClassement(401, undefined, 'not_authenticated').nature).toBe('forbidden')
	})

	it('distingue une card indisponible d’un refus de droit', () => {
		expect(classerRefusClassement(400, '23514', 'card_not_available').nature).toBe('card_indisponible')
	})

	it('distingue une requête qui n’a jamais abouti du reste', () => {
		expect(classerRefusClassement(undefined, undefined, 'offline').nature).toBe('network')
		expect(classerRefusClassement(500, undefined, 'boom').nature).toBe('unknown')
	})
})
