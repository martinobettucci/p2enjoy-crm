// @verifies CRM-101 (docs/BACKLOG.md) — tranche T3 : les appels de la plateforme, leurs refus, et la logique de l'écran
// @verifies docs/SPEC-plateforme.md §6 (fonctions, dictionnaire des refus §6.1), §7 (écran) ; docs/DESIGN_SYSTEM.md §5.56
//           (dictionnaire fermé, confirmation par l'identifiant court, attente en suspens, journal paginé)
// @verifies CRM-101 T6 — docs/SPEC-plateforme.md §6.5 (`plateforme_utilisateurs` : terme nettoyé, borne de 200, rôle
//           confronté à la liste, connecteur absent rendu `null`)
// @verifies CRM-103 T2 — docs/SPEC-mcp.md §8.2 (lectures du connecteur, couples envoyés dans l'ordre du §6.1, refus
//           `droit_invalide` et `issue_invalide` reconnus), §7.1 (issue inconnue rendue `null`)
// @verifies CRM-108 T3 — docs/SPEC-recettes.md §7 (la famille `recettes`, envoyée entre `budgets` et `temps`)
// @verifies CRM-114 T4 — docs/SPEC-organisations.md §5 (la famille `organizations`, envoyée entre `contacts` et `budgets`)
// @verifies CRM-118 T2.a — docs/SPEC-mcp.md §9.2 undecies (la famille `workflows`, envoyée entre `structure` et `affaires`)
// @verifies CRM-109 (docs/BACKLOG.md) — tranche T3 : `lireAttentes` lit la trace du dernier refus (docs/SPEC-refus-admission.md §3)

import { describe, expect, it } from 'vitest'
import { CLES_APPARTENANCES, compter, detailJournal, libelleActeur, libelleGeste, texteRefus } from '../app/presentation-plateforme'
import {
	PAGE_JOURNAL,
	attenteEnSuspens,
	classerRefus,
	confirmationSuppressionValide,
	creerEspace,
	curseurSuivant,
	lireAttentes,
	lireEspaces,
	lireEstSuperadmin,
	lireUtilisateurs,
	lireComptesMcp,
	lireFicheMcp,
	lireJournalMcp,
	poserDroitsMcp,
	caseMcp,
	curseurSuivantMcp,
	rechercheEmissible,
	roleConnu,
	type EntreeJournal,
} from './plateforme'
import type { ClientCrm } from './supabase'

type Appel = { readonly nom: string; readonly args: Record<string, unknown> }

function client(reponse: (nom: string) => unknown, appels: Appel[] = []): ClientCrm {
	return {
		rpc: (nom: string, args: Record<string, unknown>) => {
			appels.push({ nom, args })
			return Promise.resolve(reponse(nom))
		},
	} as unknown as ClientCrm
}

const entree = (geste: EntreeJournal['geste'], cible: Record<string, unknown>, acteur: string | null = 'Sabine Plateforme'): EntreeJournal => ({
	id: 1,
	acteur,
	geste,
	cible,
	creeLe: '2026-10-20T10:00:00Z',
})

describe('classerRefus', () => {
	it('reconnaît chaque code du dictionnaire par le message exact que la fonction lève', () => {
		expect(classerRefus(403, 'reserve_aux_superadministrateurs')).toBe('reserve_aux_superadministrateurs')
		expect(classerRefus(409, 'identifiant_pris')).toBe('identifiant_pris')
		expect(classerRefus(400, 'last_workspace_admin')).toBe('last_workspace_admin')
		expect(classerRefus(400, 'dernier_superadministrateur')).toBe('dernier_superadministrateur')
	})

	it('ne laisse jamais passer un message inconnu, et distingue la panne de transport', () => {
		expect(classerRefus(400, 'duplicate key value violates unique constraint "workspaces_slug_key"')).toBe('unknown')
		expect(classerRefus(undefined, 'Failed to fetch')).toBe('network')
		expect(classerRefus(0, '')).toBe('network')
	})
})

describe('logique de l’écran', () => {
	it('n’ouvre la suppression qu’à la saisie EXACTE de l’identifiant court', () => {
		expect(confirmationSuppressionValide('atelier', 'atelier')).toBe(true)
		expect(confirmationSuppressionValide(' atelier', 'atelier')).toBe(false)
		expect(confirmationSuppressionValide('Atelier', 'atelier')).toBe(false)
		expect(confirmationSuppressionValide('', '')).toBe(false)
	})

	it('met en suspens une attente non administratrice dans un espace sans administrateur, et seulement elle', () => {
		const attente = { email: 'a@b.test', role: 'viewer' as const, invitePar: null, depuis: '', refus: null }
		expect(attenteEnSuspens(attente, 0)).toBe(true)
		expect(attenteEnSuspens({ ...attente, role: 'admin' }, 0)).toBe(false)
		expect(attenteEnSuspens(attente, 1)).toBe(false)
	})

	it('n’émet une recherche de personne qu’à partir de deux caractères', () => {
		expect(rechercheEmissible('C')).toBe(false)
		expect(rechercheEmissible('  C ')).toBe(false)
		expect(rechercheEmissible('Ca')).toBe(true)
	})

	it('confronte un rôle lu à la liste, jamais une conversion', () => {
		expect(roleConnu('admin')).toBe('admin')
		expect(roleConnu('owner')).toBeNull()
		expect(roleConnu(null)).toBeNull()
	})

	it('donne le curseur de la page suivante quand la page est pleine, et aucun sinon', () => {
		const pleine = Array.from({ length: PAGE_JOURNAL }, (_, i) => ({ ...entree('espace_cree', {}), id: 100 - i }))
		expect(curseurSuivant(pleine)).toBe(100 - PAGE_JOURNAL + 1)
		expect(curseurSuivant(pleine.slice(1))).toBeNull()
	})
})

describe('appels', () => {
	it('lit les espaces et rend un domaine absent comme `null`, jamais une chaîne vide', async () => {
		const etat = await lireEspaces(
			client(() => ({
				data: [{ id: 'w1', nom: 'Atelier', slug: 'atelier', domaine_entrant: null, membres: 0, administrateurs: 0, attentes: 1 }],
				error: null,
				status: 200,
			})),
		)
		expect(etat).toEqual({
			statut: 'pret',
			donnees: [{ id: 'w1', nom: 'Atelier', slug: 'atelier', domaineEntrant: null, membres: 0, administrateurs: 0, attentes: 1 }],
		})
	})

	// `CRM-109` T3 (docs/SPEC-refus-admission.md §3, §5) : `plateforme_attentes` rend la trace du dernier refus.
	it('lit les attentes avec la trace de leur dernier refus, et `null` sans trace', async () => {
		const etat = await lireAttentes(
			client(() => ({
				data: [
					{ email: 'a@x.test', role: 'viewer', invite_par: 'Sabine', depuis: '2026-10-01', refus_motif: 'attente_verification', refus_premier: '2026-10-18', refus_dernier: '2026-10-21', refus_nombre: 3 },
					{ email: 'b@x.test', role: 'admin', invite_par: null, depuis: '2026-10-02', refus_motif: null, refus_premier: null, refus_dernier: null, refus_nombre: null },
				],
				error: null,
				status: 200,
			})),
			'w1',
		)
		expect(etat.statut === 'pret' && etat.donnees.map((attente) => attente.refus)).toEqual([
			{ motif: 'attente_verification', premier: '2026-10-18', dernier: '2026-10-21', nombre: 3 },
			null,
		])
	})

	it('envoie `null` pour un domaine laissé blanc, et rend le refus par son code', async () => {
		const appels: Appel[] = []
		const issue = await creerEspace(
			client(() => ({ data: null, error: { message: 'identifiant_pris' }, status: 409 }), appels),
			'Atelier',
			'atelier',
			'   ',
		)
		expect(appels).toEqual([{ nom: 'plateforme_creer_espace', args: { p_nom: 'Atelier', p_slug: 'atelier', p_domaine_entrant: null } }])
		expect(issue).toEqual({ statut: 'refus', refus: 'identifiant_pris' })
	})

	it('classe une exception de transport comme une panne réseau', async () => {
		const enPanne = { rpc: () => Promise.reject(new Error('Failed to fetch')) } as unknown as ClientCrm
		expect(await creerEspace(enPanne, 'A', 'ab', '')).toEqual({ statut: 'refus', refus: 'network' })
	})

	it('ne tient le drapeau pour vrai que si la base rend exactement `true`', async () => {
		expect(await lireEstSuperadmin(client(() => ({ data: true, error: null, status: 200 })))).toEqual({ statut: 'pret', donnees: true })
		expect(await lireEstSuperadmin(client(() => ({ data: 'true', error: null, status: 200 })))).toEqual({ statut: 'pret', donnees: false })
	})
})

describe('présentation', () => {
	it('traduit chaque refus, et un code inconnu par le texte générique', () => {
		expect(texteRefus('dernier_superadministrateur')).toContain('au moins un superadministrateur')
		expect(texteRefus('unknown')).toBe(texteRefus('unknown'))
		expect(texteRefus('unknown')).not.toContain('unknown')
	})

	it('compose le détail par une clé par geste, sans jamais rendre `undefined`', () => {
		expect(detailJournal(entree('membre_pose', { nom: 'Driss Lemoine', espace: 'Atelier', avant: null, apres: 'admin' }))).toBe(
			'Driss Lemoine dans «\u00a0Atelier\u00a0»\u00a0: Administrateur',
		)
		expect(detailJournal(entree('membre_pose', { nom: 'Driss Lemoine', espace: 'Atelier', avant: 'viewer', apres: 'admin' }))).toBe(
			'Driss Lemoine dans «\u00a0Atelier\u00a0»\u00a0: Lecteur → Administrateur',
		)
		expect(detailJournal(entree('espace_modifie', { avant: { nom: 'A' }, apres: { nom: 'B' } }))).toBe('A → B')
		expect(detailJournal(entree('membre_retire', {}))).not.toContain('undefined')
		expect(detailJournal(entree(null, { nom: 'x' }))).toBe('')
	})

	it('accorde un compte par clé, jamais par un gabarit à « (s) » (§10) — défaut trouvé sur la capture', () => {
		expect([0, 1, 4].map((n) => compter(n, CLES_APPARTENANCES))).toEqual(['aucune appartenance', 'une appartenance', '4 appartenances'])
	})

	it('nomme l’acteur absent : « Amorçage » pour l’amorçage, « Compte supprimé » sinon', () => {
		expect(libelleActeur(entree('superadmin_amorce', {}, null))).toBe('Amorçage')
		expect(libelleActeur(entree('espace_cree', {}, null))).toBe('Compte supprimé')
		expect(libelleGeste(null)).toBe('')
	})
})

describe('utilisateurs (T6)', () => {
	it('envoie le terme nettoyé et la borne, et lit espaces, rôles et connecteur sans rien deviner', async () => {
		const appels: Appel[] = []
		const etat = await lireUtilisateurs(
			client(
				() => ({
					data: [
						{
							id: 'u-12',
							nom: 'Driss Lemoine',
							cree_le: '2026-10-01T09:00:00Z',
							superadmin: false,
							espaces: [{ slug: 'p2enjoy', nom: 'P2Enjoy', role: 'roi' }],
							connecteur_derniere_activite: null,
						},
					],
					error: null,
					status: 200,
				}),
				appels,
			),
			'  Driss ',
		)
		expect(appels).toEqual([{ nom: 'plateforme_utilisateurs', args: { p_recherche: 'Driss', p_limite: 200 } }])
		expect(etat.statut === 'pret' && etat.donnees).toEqual([
			{
				id: 'u-12',
				nom: 'Driss Lemoine',
				creeLe: '2026-10-01T09:00:00Z',
				superadmin: false,
				espaces: [{ slug: 'p2enjoy', nom: 'P2Enjoy', role: null }],
				connecteurDerniereActivite: null,
			},
		])
	})
})

describe('le connecteur MCP (CRM-103 T2)', () => {
	const repondre = (data: unknown) => () => ({ data, error: null, status: 200 })

	it('reconnaît les deux refus nouveaux par leur code exact', () => {
		expect(classerRefus(400, 'droit_invalide')).toBe('droit_invalide')
		expect(classerRefus(400, 'issue_invalide')).toBe('issue_invalide')
	})

	it('lit les comptes venus au connecteur, et dit un compte sans profil', async () => {
		const etat = await lireComptesMcp(
			client(
				repondre([
					{ sub: 'u-12', nom: 'Driss Lemoine', email: 'driss@exemple.test', derniere_activite: '2026-10-21T08:30:00Z', espaces_ouverts: 1, superadmin: false, avec_profil: true },
					{ sub: 'u-x', nom: 'Sans Profil', email: 'x@exemple.test', derniere_activite: '2026-10-21T08:00:00Z', espaces_ouverts: 0, superadmin: false, avec_profil: false },
				]),
			),
		)
		expect(etat.statut === 'pret' && etat.donnees.map((c) => [c.nom, c.espacesOuverts, c.avecProfil])).toEqual([
			['Driss Lemoine', 1, true],
			['Sans Profil', 0, false],
		])
	})

	it('lit une fiche : rôle confronté à la liste, cases hors des listes fermées ignorées, valeurs absentes en `null`', async () => {
		const etat = await lireFicheMcp(
			client(
				repondre({
					sub: 'u-y',
					nom: 'Yannick Témoin',
					email: null,
					avec_profil: true,
					connecte: false,
					derniere_activite: null,
					superadmin: false,
					espaces: [
						{ workspace_id: 'w-1', slug: 'p2enjoy', nom: 'P2Enjoy', role: null, droits: [['affaires', 'consulter'], ['finances', 'consulter'], ['affaires', 'purger']] },
						{ workspace_id: 'w-2', slug: 'atelier', nom: 'Atelier', role: 'viewer', droits: [] },
					],
				}),
			),
			'u-y',
		)
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect([etat.donnees.email, etat.donnees.derniereActivite, etat.donnees.connecte]).toEqual([null, null, false])
		expect([...(etat.donnees.espaces[0]?.droits ?? [])]).toEqual(['affaires:consulter'])
		expect(etat.donnees.espaces.map((e) => e.role)).toEqual([null, 'viewer'])
	})

	it('envoie la matrice entière, dans l’ordre des familles puis des actions, et rend le refus par son code', async () => {
		const appels: Appel[] = []
		const droits = new Set([caseMcp('messagerie', 'ajouter'), caseMcp('temps', 'consulter'), caseMcp('recettes', 'consulter'), caseMcp('budgets', 'consulter'), caseMcp('organizations', 'ajouter'), caseMcp('contacts', 'consulter'), caseMcp('affaires', 'modifier'), caseMcp('affaires', 'consulter'), caseMcp('workflows', 'modifier'), caseMcp('structure', 'supprimer')])
		const ok = await poserDroitsMcp(client(() => ({ data: null, error: null, status: 204 }), appels), 'u-y', 'w-1', droits)
		expect(ok).toEqual({ statut: 'ok', valeur: null })
		expect(appels[0]).toEqual({
			nom: 'mcp_poser_droits',
			args: {
				p_sub: 'u-y',
				p_ws: 'w-1',
				// `recettes` entre `budgets` et `temps` depuis `CRM-108` (docs/SPEC-recettes.md §7) ; `organizations` entre
				// `contacts` et `budgets` depuis `CRM-114` T4 (docs/SPEC-organisations.md §5) ; `workflows` entre `structure` et
				// `affaires` depuis `CRM-118` T2.a (docs/SPEC-mcp.md §9.2 undecies).
				p_droits: [['structure', 'supprimer'], ['workflows', 'modifier'], ['affaires', 'consulter'], ['affaires', 'modifier'], ['contacts', 'consulter'], ['organizations', 'ajouter'], ['budgets', 'consulter'], ['recettes', 'consulter'], ['temps', 'consulter'], ['messagerie', 'ajouter']],
			},
		})
		const refus = await poserDroitsMcp(client(() => ({ data: null, error: { message: 'profil_introuvable' }, status: 404 })), 'u-x', 'w-1', droits)
		expect(refus).toEqual({ statut: 'refus', refus: 'profil_introuvable' })
	})

	it('filtre le journal des appels, rend une issue inconnue `null`, et pagine sur une page pleine', async () => {
		const appels: Appel[] = []
		const etat = await lireJournalMcp(
			client(repondre([{ id: 7, nom: 'Driss Lemoine', outil: 'crm_workspace_list', espace_nom: null, issue: 'inconnue', duree_ms: 12, cree_le: '2026-10-21T08:30:00Z' }]), appels),
			{ sub: 'u-12', issue: 'refus_matrice' },
		)
		expect(appels[0]?.args).toEqual({ p_sub: 'u-12', p_issue: 'refus_matrice', p_avant: null, p_limite: 50 })
		expect(etat.statut === 'pret' && etat.donnees[0]?.issue).toBe(null)
		expect(curseurSuivantMcp(etat.statut === 'pret' ? etat.donnees : [])).toBe(null)
		const pleine = Array.from({ length: 50 }, (_, i) => ({ id: 100 - i, nom: '', outil: '', espaceNom: null, issue: null, dureeMs: 0, creeLe: '' }))
		expect(curseurSuivantMcp(pleine)).toBe(51)
	})
})
