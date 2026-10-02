// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : ce qui est envoyé au modèle, et rien d'autre ; tranche T2.b : les
//       défauts relevés par la base accompagnent une revue (docs/SPEC-ia.md §12.6, décision 618)
// @spec docs/SPEC-ia.md §2 (rectifier : la dernière révision et la consigne), §3 (« ce qui est envoyé au
//       modèle » : jamais une affaire, un contact, un message ni une donnée personnelle), §6.1 (le format) ;
//       docs/JOURNAL.md décision 617
//
// Module pur. Les règles écrites ici guident le modèle ; elles ne garantissent rien : c'est la base, à
// l'écriture de chaque révision puis à l'acceptation, qui juge (docs/SPEC-ia.md §2, §12.1).

import type { Message } from './ollama.ts'
import type { Defaut } from './proposition.ts'

export type NoeudDuCatalogue = { readonly cle: string; readonly libelle: string; readonly nature: string }

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

function catalogueEnTexte(catalogue: readonly NoeudDuCatalogue[]): string {
	if (catalogue.length === 0) return 'Le catalogue de nœuds de l’espace est vide.'
	return [
		'Nœuds déjà au catalogue de l’espace (une étape peut les viser par leur clé, sans les redéclarer) :',
		...catalogue.map((n) => `- ${n.cle} — ${n.libelle} (${n.nature})`),
	].join('\n')
}

/** La première génération : la demande de l'administrateur. */
export function messagesDeCreation(demande: string, catalogue: readonly NoeudDuCatalogue[]): Message[] {
	return [
		{ role: 'system', content: `${REGLES}\n\n${catalogueEnTexte(catalogue)}` },
		{ role: 'user', content: demande },
	]
}

/**
 * Une revue : la DERNIÈRE révision — corrigée à la main ou non —, les défauts que la base y a relevés, et la
 * consigne. Le modèle reprend la proposition telle que l'administrateur l'a laissée, pas sa propre version
 * précédente. Les défauts sont transmis tels que la base les écrit — un code et ses valeurs —, sans phrase :
 * le modèle n'a pas à lire l'interface.
 */
export function messagesDeRevue(
	demande: string,
	derniere: unknown,
	defauts: readonly Defaut[],
	consigne: string,
	catalogue: readonly NoeudDuCatalogue[],
): Message[] {
	return [
		{ role: 'system', content: `${REGLES}\n\n${catalogueEnTexte(catalogue)}` },
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
