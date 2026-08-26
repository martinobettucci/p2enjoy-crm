// @verifies CRM-064 (docs/BACKLOG.md) — tranche 3a : la composition de la boîte de réception
// @verifies docs/SPEC-notifications.md §24.1 (deux requêtes, et deux seulement), §24.2 (ce qui
//           n'est PAS demandé), §24.3 (les trois cas de ligne, dont un impossible),
//           §25.3 (le canal, son nom et son filtre), §26.1 (le compteur et sa borne),
//           §26.2 (l'ordre), §26.4 (les trois issues du marquage), §26.5 (la borne de lecture),
//           §31 (preuves unitaires attendues)
// @verifies docs/SPEC-notifications.md §13.4 (aucune copie dans la charge utile),
//           §14.4 (une notification survit au retrait de sa mention)
// @verifies docs/DESIGN_SYSTEM.md §5.43 (la cloche et le panneau)
//
// Ces tests portent sur la LOGIQUE, sans navigateur : c'est ce que la séparation du module rend
// possible. Le rendu est éprouvé par `webapp/src/app/Notifications.test.tsx`, et la pile réelle par
// `e2e/api/notifications-surface.spec.ts`.

import { describe, expect, it, vi } from 'vitest'
import {
	BORNE_COMPTEUR,
	BORNE_LISTE,
	COLONNES_COMMENTAIRE_MENTION,
	COLONNES_NOTIFICATION,
	adresseChannelNotification,
	apparier,
	filtreCanalNotifications,
	formaterCompteur,
	idCommentaireCite,
	lireBoite,
	marquerNotification,
	nomCanalNotifications,
	type LigneCommentaireCite,
	type LigneNotificationLue,
} from './notifications'
import type { ClientCrm } from './supabase'

/** Une notification telle que la requête 1 la rend, avec son affaire embarquée. */
const ligne = (
	partiel: Partial<LigneNotificationLue> & { id: string },
): LigneNotificationLue => ({
	type: 'mention',
	read_at: null,
	created_at: '2026-08-26T16:25:30.556393+00:00',
	subject_card_id: 'c1',
	payload: { comment_id: 'd1', author_id: 'p11' },
	cards: {
		id: 'c1',
		title: 'Refonte du site vitrine',
		channels: {
			slug: 'grands-comptes',
			name: 'Grands comptes',
			tracks: { slug: 'conseil-ia', name: 'Conseil & IA' },
		},
	},
	...partiel,
})

/** Un commentaire cité, tel que la requête 2 le rend. */
const cite = (partiel: Partial<LigneCommentaireCite> & { id: string }): LigneCommentaireCite => ({
	body: 'La DSI a confirmé le périmètre.',
	deleted_at: null,
	author_id: 'p11',
	auteur: { id: 'p11', full_name: 'Camille Aubert', avatar_url: '/avatars/camille-aubert.svg' },
	...partiel,
})

describe('ce que la boîte demande (docs/SPEC-notifications.md §24.1, §24.2)', () => {
	// LES DEUX SLUGS SONT EXIGÉS PAR L'ADRESSE D'UNE AFFAIRE, et aucun ne se déduit de l'autre.
	// Sans eux, la ligne perdrait son lien — le §5.32 du design system refuse un lien vers une
	// adresse incomplète.
	it('embarque le titre de l’affaire ET les deux slugs', () => {
		expect(COLONNES_NOTIFICATION).toContain('cards(')
		expect(COLONNES_NOTIFICATION).toContain('channels!cards_channel_id_workspace_id_fkey')
		expect(COLONNES_NOTIFICATION).toContain('tracks(slug, name)')
	})

	// CE QUI N'EST PAS DEMANDÉ EST AUSSI UNE DÉCISION (§24.2) : `recipient_id` est garanti par la
	// politique, et le redemander laisserait croire qu'on pourrait lire celui d'un autre.
	it('ne demande NI workspace_id NI recipient_id', () => {
		expect(COLONNES_NOTIFICATION).not.toContain('workspace_id,')
		expect(COLONNES_NOTIFICATION).not.toContain('recipient_id')
	})

	// `deleted_at` EST DEMANDÉE ET SEULEMENT COMPARÉE : sans elle, un corps vidé par une pierre
	// tombale et un corps réellement vide seraient indistinguables (§13.4).
	it('demande deleted_at et embarque l’auteur du commentaire cité', () => {
		expect(COLONNES_COMMENTAIRE_MENTION).toContain('deleted_at')
		expect(COLONNES_COMMENTAIRE_MENTION).toContain('profiles!card_comments_author_id_fkey')
	})
})

describe('le canal de temps réel (docs/SPEC-notifications.md §25.3)', () => {
	// LE NOM PORTE L'IDENTIFIANT DU DESTINATAIRE : deux sessions du même navigateur s'abonneraient
	// sinon au MÊME canal, `supabase-js` réutilisant un canal par son nom.
	it('nomme le canal par le destinataire, jamais par un nom fixe', () => {
		expect(nomCanalNotifications('p12')).toBe('notifications:p12')
		expect(nomCanalNotifications('p11')).not.toBe(nomCanalNotifications('p12'))
	})

	// LE FILTRE N'EST PAS UNE GARDE D'ACCÈS — la politique l'est, et `realtime.apply_rls`
	// l'évalue quoi qu'il arrive. C'est une économie.
	it('filtre sur le destinataire', () => {
		expect(filtreCanalNotifications('p12')).toBe('recipient_id=eq.p12')
	})
})

describe('le compteur (docs/SPEC-notifications.md §26.1)', () => {
	// ABSENT À ZÉRO : l'absence dit déjà ce que « 0 » répéterait.
	it('ne dessine RIEN à zéro', () => {
		expect(formaterCompteur(0)).toBeNull()
	})

	it('dessine le compte tant qu’il tient', () => {
		expect(formaterCompteur(1)).toBe('1')
		expect(formaterCompteur(BORNE_COMPTEUR)).toBe('99')
	})

	// LA BORNE BORNE LE DESSIN, JAMAIS LA MESURE : le nom accessible de la cloche porte le compte
	// exact, et c'est `libelleCloche` qui en répond.
	it('écrit « 99+ » au-delà de la borne', () => {
		expect(formaterCompteur(BORNE_COMPTEUR + 1)).toBe('99+')
		expect(formaterCompteur(4321)).toBe('99+')
	})

	// L'ÉCRAN NE REND JAMAIS UNE VALEUR QU'IL NE SAIT PAS EXPLIQUER. Rien ne produit ces valeurs ;
	// les dessiner serait pire que de les taire.
	it('ne dessine rien pour une valeur que rien ne produit', () => {
		expect(formaterCompteur(-3)).toBeNull()
		expect(formaterCompteur(Number.NaN)).toBeNull()
	})
})

describe('la charge utile (docs/SPEC-notifications.md §13.4, §24.3)', () => {
	it('lit l’identifiant du commentaire cité', () => {
		expect(idCommentaireCite({ comment_id: 'd1', author_id: 'p11' })).toBe('d1')
	})

	// ELLE NE FAIT CONFIANCE À RIEN : `payload` est un `jsonb` dont aucune contrainte ne garantit
	// la forme. Une charge amputée produit la ligne dégradée, jamais un échec de page.
	it('ne se fie à AUCUNE forme : une charge amputée ne cite rien', () => {
		expect(idCommentaireCite(null)).toBeNull()
		expect(idCommentaireCite({})).toBeNull()
		expect(idCommentaireCite({ comment_id: '' })).toBeNull()
		expect(idCommentaireCite({ comment_id: 42 })).toBeNull()
	})
})

describe('les adresses (docs/DESIGN_SYSTEM.md §5.32)', () => {
	it('compose l’adresse du dossier depuis les deux slugs', () => {
		expect(adresseChannelNotification(ligne({ id: 'n1' }).cards)).toBe(
			'/tracks/conseil-ia/grands-comptes',
		)
	})

	it('ne compose AUCUNE adresse quand un slug manque', () => {
		expect(
			adresseChannelNotification({
				id: 'c1',
				title: 'X',
				channels: { slug: 'grands-comptes', name: 'Grands comptes', tracks: null },
			}),
		).toBeNull()
		expect(adresseChannelNotification(null)).toBeNull()
	})
})

describe('l’appariement des deux lectures (docs/SPEC-notifications.md §24.3)', () => {
	// CAS 1 — COMPLET.
	it('rend l’auteur, l’extrait, l’affaire et le lien', () => {
		const vue = apparier(ligne({ id: 'n1' }), new Map([['d1', cite({ id: 'd1' })]]))
		expect(vue.auteur?.full_name).toBe('Camille Aubert')
		expect(vue.extrait).toBe('La DSI a confirmé le périmètre.')
		expect(vue.titreAffaire).toBe('Refonte du site vitrine')
		expect(vue.adresse).toBe('/tracks/conseil-ia/grands-comptes/cards/c1')
		expect(vue.adresseChannel).toBe('/tracks/conseil-ia/grands-comptes')
		expect(vue.nomTrack).toBe('Conseil & IA')
		expect(vue.nomChannel).toBe('Grands comptes')
		expect(vue.lue).toBe(false)
	})

	// CAS 2 — LE COMMENTAIRE N'EST PLUS LISIBLE. Il ARRIVE RÉELLEMENT : le §14.4 conserve la
	// notification quand la mention est retirée. La ligne garde sa place, son affaire et son lien.
	it('garde la ligne d’un commentaire que la seconde lecture n’a pas rapporté', () => {
		const vue = apparier(ligne({ id: 'n1' }), new Map())
		expect(vue.auteur).toBeNull()
		expect(vue.extrait).toBeNull()
		expect(vue.titreAffaire).toBe('Refonte du site vitrine')
		expect(vue.adresse).toBe('/tracks/conseil-ia/grands-comptes/cards/c1')
	})

	// UNE PIERRE TOMBALE EST TRAITÉE COMME UN COMMENTAIRE ABSENT, et ce n'est pas un raccourci : la
	// base a réellement VIDÉ son corps (§13.4). Un extrait rendu depuis elle serait une chaîne vide.
	it('traite une pierre tombale comme un commentaire absent', () => {
		const vue = apparier(
			ligne({ id: 'n1' }),
			new Map([['d1', cite({ id: 'd1', body: '', deleted_at: '2026-08-20T10:00:00Z' })]]),
		)
		expect(vue.auteur).toBeNull()
		expect(vue.extrait).toBeNull()
		expect(vue.adresse).not.toBeNull()
	})

	// UN CORPS BLANC NE REND AUCUN EXTRAIT plutôt qu'un extrait vide : le §5.9 du design system
	// réserve le vide à ce qui n'existe pas, et un extrait blanc se lirait comme un défaut.
	it('ne rend AUCUN extrait pour un corps vide', () => {
		const vue = apparier(ligne({ id: 'n1' }), new Map([['d1', cite({ id: 'd1', body: '' })]]))
		expect(vue.extrait).toBeNull()
	})

	it('rend « lue » quand read_at est posé', () => {
		const vue = apparier(
			ligne({ id: 'n1', read_at: '2026-08-26T17:00:00Z' }),
			new Map([['d1', cite({ id: 'd1' })]]),
		)
		expect(vue.lue).toBe(true)
	})

	// UNE NOTIFICATION SANS AFFAIRE EST PRÉVUE PAR LA COLONNE, qui est nullable (§13.5) : aucune
	// n'existe aujourd'hui, et le type ne prétend pas le contraire. Elle ne rend aucun lien.
	it('ne compose aucun lien pour une notification sans affaire', () => {
		const vue = apparier(
			ligne({ id: 'n1', subject_card_id: null, cards: null }),
			new Map([['d1', cite({ id: 'd1' })]]),
		)
		expect(vue.titreAffaire).toBeNull()
		expect(vue.adresse).toBeNull()
	})
})

describe('la lecture (docs/SPEC-notifications.md §24.1, §26.2, §26.5)', () => {
	/** Un client minimal : les notifications, le compteur, puis les commentaires cités. */
	const clientDouble = (options: {
		notifications?: { data?: unknown; error?: unknown; status?: number }
		commentaires?: { data?: unknown; error?: unknown }
		compte?: number | null
		espion?: (trace: string) => void
	}) => {
		const espion = options.espion ?? (() => {})
		return {
			from: (table: string) => {
				if (table === 'card_comments') {
					return {
						select: (colonnes: string) => {
							espion(`card_comments.select:${colonnes}`)
							return {
								in: (colonne: string, valeurs: readonly string[]) => {
									espion(`card_comments.in:${colonne}:${valeurs.join('|')}`)
									return Promise.resolve({
										data: options.commentaires?.data ?? [],
										error: options.commentaires?.error ?? null,
									})
								},
							}
						},
					}
				}
				return {
					select: (colonnes: string, extra?: { count?: string; head?: boolean }) => {
						if (extra?.head === true) {
							espion(`notifications.count:${extra.count}`)
							return {
								is: (colonne: string, valeur: unknown) => {
									espion(`notifications.is:${colonne}:${String(valeur)}`)
									return Promise.resolve({ count: options.compte ?? null, error: null })
								},
							}
						}
						espion(`notifications.select:${colonnes}`)
						return {
							order: (colonne: string, sens: { ascending: boolean }) => {
								espion(`notifications.order:${colonne}:${sens.ascending ? 'asc' : 'desc'}`)
								return {
									limit: (borne: number) => {
										espion(`notifications.limit:${borne}`)
										return Promise.resolve({
											data: options.notifications?.data ?? [],
											error: options.notifications?.error ?? null,
											status: options.notifications?.status,
										})
									},
								}
							},
						}
					},
				}
			},
		} as unknown as ClientCrm
	}

	// L'ORDRE EST LE PLUS RÉCENT EN HAUT, ET C'EST L'INVERSE DU FIL DE COMMENTAIRES (§26.2). Une
	// boîte de réception se lit en commençant par ce qui vient d'arriver.
	it('demande l’ordre décroissant et la borne du §26.5', async () => {
		const traces: string[] = []
		await lireBoite(
			clientDouble({ notifications: { data: [] }, espion: (trace) => traces.push(trace) }),
		)
		expect(traces).toContain('notifications.order:created_at:desc')
		expect(traces).toContain(`notifications.limit:${BORNE_LISTE}`)
	})

	// LE COMPTEUR SE LIT SANS CORPS (§21, M4) : `head` avec `count: exact` porte le nombre dans
	// l'en-tête, et aucune ligne ne traverse le réseau.
	it('compte les non-lues sans ramener une seule ligne', async () => {
		const traces: string[] = []
		const boite = await lireBoite(
			clientDouble({
				notifications: { data: [] },
				compte: 7,
				espion: (trace) => traces.push(trace),
			}),
		)
		expect(traces).toContain('notifications.count:exact')
		expect(traces).toContain('notifications.is:read_at:null')
		expect(boite.statut === 'pret' ? boite.donnees.nonLues : undefined).toBe(7)
	})

	// AUCUNE SECONDE REQUÊTE QUAND RIEN N'EST CITÉ : demander `id=in.()` serait une requête dont on
	// connaît déjà la réponse.
	it('n’émet AUCUNE seconde requête quand la boîte est vide', async () => {
		const traces: string[] = []
		await lireBoite(
			clientDouble({ notifications: { data: [] }, espion: (trace) => traces.push(trace) }),
		)
		expect(traces.some((trace) => trace.startsWith('card_comments.'))).toBe(false)
	})

	// UNE SEULE REQUÊTE POUR TOUTE LA PAGE, ET LES IDENTIFIANTS SONT DÉDOUBLONNÉS (§21, M8). C'est
	// la mesure qui a corrigé l'estimation « une lecture par notification affichée » du §13.4.
	it('groupe TOUS les commentaires cités en une requête, sans doublon', async () => {
		const traces: string[] = []
		await lireBoite(
			clientDouble({
				notifications: {
					data: [
						ligne({ id: 'n1', payload: { comment_id: 'd1' } }),
						ligne({ id: 'n2', payload: { comment_id: 'd2' } }),
						ligne({ id: 'n3', payload: { comment_id: 'd1' } }),
					],
				},
				espion: (trace) => traces.push(trace),
			}),
		)
		const groupee = traces.filter((trace) => trace.startsWith('card_comments.in:'))
		expect(groupee).toHaveLength(1)
		expect(groupee[0]).toBe('card_comments.in:id:d1|d2')
	})

	// LA SECONDE LECTURE N'EST PAS BLOQUANTE : son échec ne doit pas effacer une boîte que la
	// première a déjà rendue. L'écran vaut mieux dégradé que remplacé par une erreur.
	it('rend la boîte DÉGRADÉE quand la seconde lecture échoue', async () => {
		const boite = await lireBoite(
			clientDouble({
				notifications: { data: [ligne({ id: 'n1' })] },
				commentaires: { error: { message: 'panne' } },
			}),
		)
		expect(boite.statut).toBe('pret')
		if (boite.statut !== 'pret') return
		expect(boite.donnees.notifications).toHaveLength(1)
		expect(boite.donnees.notifications[0]?.extrait).toBeNull()
		expect(boite.donnees.notifications[0]?.adresse).not.toBeNull()
	})

	// LE COMPTEUR VAUT `null` EN CAS D'ÉCHEC, JAMAIS ZÉRO : un zéro affirmerait que tout est lu
	// alors que rien n'a été mesuré (`CLAUDE.md` §18).
	it('rend un compteur INCONNU plutôt qu’un zéro qu’il n’a pas mesuré', async () => {
		const boite = await lireBoite(
			clientDouble({ notifications: { data: [ligne({ id: 'n1' })] }, compte: null }),
		)
		expect(boite.statut === 'pret' ? boite.donnees.nonLues : undefined).toBeNull()
	})

	// LA TRONCATURE EST SIGNALÉE (§26.5) : une liste bornée qui se tairait se lirait comme une
	// boîte complète.
	it('signale la troncature quand la lecture atteint sa borne', async () => {
		const pleine = Array.from({ length: BORNE_LISTE }, (_, rang) => ligne({ id: `n${rang}` }))
		const boite = await lireBoite(clientDouble({ notifications: { data: pleine } }))
		expect(boite.statut === 'pret' ? boite.donnees.tronquee : undefined).toBe(true)
	})

	it('ne signale AUCUNE troncature sous la borne', async () => {
		const boite = await lireBoite(clientDouble({ notifications: { data: [ligne({ id: 'n1' })] } }))
		expect(boite.statut === 'pret' ? boite.donnees.tronquee : undefined).toBe(false)
	})

	// UN ÉCHEC DE LA PREMIÈRE LECTURE EST UN ÉCHEC : aucune valeur par défaut ne le masque
	// (`CLAUDE.md` §18, `docs/SPEC-webapp.md` §6.4).
	it('rend une ERREUR quand la première lecture échoue', async () => {
		const boite = await lireBoite(
			clientDouble({ notifications: { error: { message: 'refus' }, status: 403 } }),
		)
		expect(boite.statut).toBe('erreur')
		expect(boite.statut === 'erreur' ? boite.erreur.nature : undefined).toBe('forbidden')
	})
})

describe('le marquage (docs/SPEC-notifications.md §26.4)', () => {
	/** Un client minimal pour un `PATCH` qui demande sa ligne en retour. */
	const clientMarquage = (options: {
		data?: unknown
		error?: unknown
		espion?: (valeurs: Record<string, unknown>) => void
	}) =>
		({
			from: () => ({
				update: (valeurs: Record<string, unknown>) => {
					options.espion?.(valeurs)
					return {
						eq: () => ({
							select: () =>
								Promise.resolve({ data: options.data ?? [], error: options.error ?? null }),
						}),
					}
				},
			}),
		}) as unknown as ClientCrm

	// LES DEUX SENS (§15.1) : un état à deux valeurs qu'on ne peut parcourir que dans un sens n'est
	// pas un état, c'est un compteur.
	it('envoie une date pour marquer lu, et null pour marquer non lu', async () => {
		const envois: Record<string, unknown>[] = []
		await marquerNotification(
			clientMarquage({ data: [{ id: 'n1' }], espion: (v) => envois.push(v) }),
			'n1',
			true,
		)
		await marquerNotification(
			clientMarquage({ data: [{ id: 'n1' }], espion: (v) => envois.push(v) }),
			'n1',
			false,
		)
		expect(typeof envois[0]?.['read_at']).toBe('string')
		expect(envois[1]?.['read_at']).toBeNull()
	})

	it('rend « appliqué » quand le serveur a rendu la ligne', async () => {
		const issue = await marquerNotification(clientMarquage({ data: [{ id: 'n1' }] }), 'n1', true)
		expect(issue.statut).toBe('applique')
	})

	// L'ISSUE « SANS EFFET » EST LA TROISIÈME, ET ELLE DOIT ÊTRE DITE : la clause `USING` filtre en
	// silence, et PostgREST rend `204` sans erreur. Sans le `select()`, l'écran ne saurait pas
	// laquelle des deux issues il a obtenue.
	it('distingue « sans effet » d’un succès sur ZÉRO ligne rendue', async () => {
		const issue = await marquerNotification(clientMarquage({ data: [] }), 'n1', true)
		expect(issue.statut).toBe('sans-effet')
	})

	it('rend un refus quand le serveur en rend un', async () => {
		const issue = await marquerNotification(
			clientMarquage({ error: { message: '42501' } }),
			'n1',
			true,
		)
		expect(issue.statut).toBe('refus')
	})

	// AUCUNE ERREUR N'EST AVALÉE : une exception du transport est un refus explicite, jamais un
	// succès silencieux (`CLAUDE.md` §18).
	it('classe une exception du transport en refus, jamais en succès', async () => {
		const client = {
			from: () => ({
				update: () => ({
					eq: () => ({
						select: () => {
							throw new Error('coupure')
						},
					}),
				}),
			}),
		} as unknown as ClientCrm
		const issue = await marquerNotification(client, 'n1', true)
		expect(issue.statut).toBe('refus')
		expect(issue.statut === 'refus' ? issue.detail : '').toContain('coupure')
	})
})

// Le module ne doit pas dépendre d'un ordre de déclaration : `vi` est importé pour l'homogénéité
// avec les autres suites du dépôt, et son absence d'emploi ici est délibérée — aucun de ces tests
// n'a besoin d'un espion de fonction, les doubles portant leur propre trace.
void vi
