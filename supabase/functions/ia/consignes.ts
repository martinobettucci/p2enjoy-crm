// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : ce qui est envoyé au modèle, et rien d'autre ; tranche T2.b : les
//       défauts relevés par la base accompagnent une revue (docs/SPEC-ia.md §12.6, décision 618) ; tranche T3.b :
//       le contexte d'une modification — composition vivante, occupation, portée (docs/SPEC-ia.md §13.5, décision 620)
// @spec docs/SPEC-ia.md §2 (rectifier : la dernière révision et la consigne), §3 (« ce qui est envoyé au
//       modèle » : jamais une affaire, un contact, un message ni une donnée personnelle ; pour un remappage, le
//       NOMBRE d'affaires par étape), §6.1 (le format) ; docs/JOURNAL.md décision 617
//
// Module pur. Les règles écrites ici guident le modèle ; elles ne garantissent rien : c'est la base, à
// l'écriture de chaque révision puis à l'acceptation, qui juge (docs/SPEC-ia.md §2, §12.1).

import type { Message } from './ollama.ts'
import type { Defaut } from './proposition.ts'

export type NoeudDuCatalogue = { readonly cle: string; readonly libelle: string; readonly nature: string }

/** Les portées d'une modification (docs/SPEC-ia.md §13.5) ; `workflow` est celle d'une création. */
export const PORTEES_DE_MODIFICATION = ['etapes', 'transitions', 'champs'] as const
export type PorteeDeModification = (typeof PORTEES_DE_MODIFICATION)[number]

/**
 * Le workflow qu'une suggestion fait évoluer, tel que la base le rend avec le jeton de l'appelant
 * (`proposition_du_workflow`, `occupation_du_workflow`, docs/SPEC-ia.md §13.2). L'occupation est un NOMBRE
 * d'affaires par clé d'étape : rien d'une affaire ne l'accompagne (§3).
 */
export type ContexteDeModification = {
	/**
	 * La portée de la suggestion. La base admet aussi `workflow` avec une cible (une suggestion écrite par un client
	 * hors de la fonction) : aucune phrase de portée n'est alors envoyée, le modèle n'est pas orienté.
	 */
	readonly portee: string
	readonly composition: unknown
	readonly occupation: Readonly<Record<string, number>>
}

const REGLES = `Tu conçois des workflows commerciaux pour un CRM. Réponds uniquement par le JSON demandé, en français.
Règles :
- un workflow est une suite d'étapes ; chaque étape vise un nœud (« noeud ») par sa clé ;
- une étape vise soit un nœud du catalogue existant, soit un nœud que tu déclares dans « noeuds » ;
- un nœud n'est utilisé que par une seule étape ;
- exactement une étape est initiale (« initiale » vrai) ;
- prévois des nœuds de nature « won » (gagné) et « lost » (perdu), et rends « perdu » atteignable depuis
  chaque étape ouverte où une affaire peut être abandonnée ;
- chaque transition relie deux étapes du workflow, de clé « de » vers clé « vers », avec un libellé
  d'action court ; « commentaire_requis » est vrai quand le passage exige un motif (par exemple perdu) ;
- les champs sont les informations à saisir sur une affaire ; un champ « select » ou « multiselect » a
  des « choix » ; un champ « money » a une « devise » de trois lettres (EUR par défaut) ;
- les « regles » disent sur quelle étape un champ est visible, requis ou caché ; les « exigences » disent
  quel champ doit être rempli pour franchir une transition ;
- les clés sont courtes, en minuscules, sans accent, mots séparés par des tirets.`

const REGLES_DE_MODIFICATION = `Tu fais évoluer un workflow EXISTANT, décrit plus bas. Rends la composition cible ENTIÈRE, jamais une liste de différences :
- garde la clé de chaque étape (son nœud), de chaque transition (son couple « de » → « vers ») et de chaque champ
  que tu conserves ; une clé nouvelle crée l'objet, une clé absente le retire ;
- ne change jamais le type d'un champ conservé ;
- une étape que tu retires et qui porte des affaires a besoin d'un remappage dans « remappages » :
  { « de » : la clé de l'étape retirée, « vers » : la clé d'une étape de la cible } ; sans destination sûre,
  laisse « remappages » vide, l'administrateur choisira ;
- un libellé de transition vide garde le libellé de l'étape d'arrivée.`

const PHRASES_DE_PORTEE: Readonly<Record<PorteeDeModification, string>> = {
	etapes: 'Ne fais évoluer que les étapes, et ce qui dépend d’une étape retirée ; garde les champs à l’identique.',
	transitions: 'Ne fais évoluer que les transitions et leurs exigences ; garde les étapes et les champs à l’identique.',
	champs:
		'Ne fais évoluer que les champs, leurs règles de visibilité et leurs exigences ; garde les étapes et les transitions à l’identique.',
}

function catalogueEnTexte(catalogue: readonly NoeudDuCatalogue[]): string {
	if (catalogue.length === 0) return 'Le catalogue de nœuds de l’espace est vide.'
	return [
		'Nœuds déjà au catalogue de l’espace (une étape peut les viser par leur clé, sans les redéclarer) :',
		...catalogue.map((n) => `- ${n.cle} — ${n.libelle} (${n.nature})`),
	].join('\n')
}

function systeme(catalogue: readonly NoeudDuCatalogue[], contexte: ContexteDeModification | null): Message {
	return {
		role: 'system',
		content: [REGLES, ...(contexte === null ? [] : [REGLES_DE_MODIFICATION]), catalogueEnTexte(catalogue)].join('\n\n'),
	}
}

/** Le workflow vivant, son occupation et la portée : relus par la fonction à chaque génération. */
function contexteEnMessages(contexte: ContexteDeModification | null): Message[] {
	if (contexte === null) return []
	return [
		{
			role: 'user',
			content: [
				'Le workflow actuel (JSON) :',
				JSON.stringify(contexte.composition),
				'Le nombre d’affaires par étape (JSON) :',
				JSON.stringify(contexte.occupation),
				...(Object.hasOwn(PHRASES_DE_PORTEE, contexte.portee)
					? [PHRASES_DE_PORTEE[contexte.portee as PorteeDeModification]]
					: []),
			].join('\n'),
		},
	]
}

/**
 * La première génération : la demande de l'administrateur — et, pour une modification, le workflow qu'elle
 * fait évoluer, AVANT la demande.
 */
export function messagesDePremiereGeneration(
	demande: string,
	catalogue: readonly NoeudDuCatalogue[],
	contexte: ContexteDeModification | null = null,
): Message[] {
	return [systeme(catalogue, contexte), ...contexteEnMessages(contexte), { role: 'user', content: demande }]
}

/**
 * Une revue : la DERNIÈRE révision — corrigée à la main ou non —, les défauts que la base y a relevés, et la
 * consigne. Le modèle reprend la proposition telle que l'administrateur l'a laissée, pas sa propre version
 * précédente. Les défauts sont transmis tels que la base les écrit — un code et ses valeurs —, sans phrase :
 * le modèle n'a pas à lire l'interface. Pour une modification, le workflow vivant précède la demande.
 */
export function messagesDeRevue(
	demande: string,
	derniere: unknown,
	defauts: readonly Defaut[],
	consigne: string,
	catalogue: readonly NoeudDuCatalogue[],
	contexte: ContexteDeModification | null = null,
): Message[] {
	return [
		systeme(catalogue, contexte),
		...contexteEnMessages(contexte),
		{ role: 'user', content: demande },
		{
			role: 'user',
			content: [
				'Voici la proposition actuelle, telle que l’administrateur l’a relue et éventuellement corrigée :',
				JSON.stringify(derniere),
				...(defauts.length === 0
					? []
					: ['Le produit y a relevé ces défauts (code et valeurs) ; corrige-les :', JSON.stringify(defauts.map(({ code, valeurs }) => ({ code, valeurs })))]),
				'Reprends-la en appliquant cette consigne, et rends la proposition complète :',
				consigne,
			].join('\n'),
		},
	]
}
