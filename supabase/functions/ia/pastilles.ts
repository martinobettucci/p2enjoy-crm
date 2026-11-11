// @spec CRM-141 (docs/BACKLOG.md) — tranche T2 : l'évaluation des pastilles d'un mail — ce que le modèle reçoit, et ce
//       qu'on croit de sa réponse
// @spec docs/SPEC-ia.md §15.1 (l'objet, l'expéditeur et 2 000 caractères du texte ; jamais une pièce jointe, un
//       destinataire, une affaire ni un identifiant de la base), §15.2 (la demande : sortie structurée, clés courtes),
//       §15.3 (la sortie n'est jamais crue : clé inconnue rejetée et comptée, doublons, JSON hors schéma) ;
//       docs/JOURNAL.md décisions 883 et 923 ; CLAUDE.md §20 (rien de ce contenu ne passe au journal)
//
// Module pur : ni réseau ni horloge. Les identifiants des pastilles ne sortent jamais vers le modèle : il voit des clés
// courtes (`p1`, `p2`…), que ce module retraduit.

import type { Message } from './ollama.ts'

/** Le début du texte d'un mail envoyé au modèle (décision 923). */
export const LONGUEUR_TEXTE = 2_000
/** Une évaluation est bornée à 30 s (docs/SPEC-ia.md §15.2). */
export const BORNE_PASTILLE_MS = 30_000
/** Une passe s'arrête de prendre au-delà de 100 s, sous la borne de 150 s du worker `ia` (docs/SPEC-ia.md §15.4). */
export const BUDGET_PASSE_MS = 100_000

/** Une pastille active de l'espace, telle que la base la rend à la prise. */
export type Pastille = { readonly id: string; readonly name: string; readonly description: string }

/** Un message pris dans la file, tel que la base le rend (`claim_label_evaluations`). */
export type MessageAEvaluer = {
	readonly message_id: string
	readonly subject: string | null
	readonly from_address: string | null
	readonly from_name: string | null
	readonly body_text: string | null
	readonly body_html: string | null
	readonly labels: readonly Pastille[]
}

const ENTITES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Le texte d'un HTML : scripts et styles retirés, balises ôtées, entités décodées, blancs resserrés. */
export function texteDuHtml(html: string): string {
	return html
		.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entite, nom: string) => {
			if (nom.startsWith('#x') || nom.startsWith('#X')) return String.fromCodePoint(Number.parseInt(nom.slice(2), 16) || 32)
			if (nom.startsWith('#')) return String.fromCodePoint(Number.parseInt(nom.slice(1), 10) || 32)
			return ENTITES[nom.toLowerCase()] ?? entite
		})
		.replace(/[ \t\f\v ]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.trim()
}

/** Le texte envoyé : `body_text`, à défaut le texte tiré du HTML ; tronqué à `LONGUEUR_TEXTE`. */
export function texteDuMail(bodyText: string | null, bodyHtml: string | null): string {
	const texte = bodyText !== null && bodyText.trim() !== '' ? bodyText.trim() : bodyHtml !== null ? texteDuHtml(bodyHtml) : ''
	return [...texte].slice(0, LONGUEUR_TEXTE).join('')
}

/** Une demande prête : les messages, le schéma de la sortie, et la table de retraduction des clés. */
export type Demande = {
	readonly messages: readonly Message[]
	readonly schema: unknown
	readonly cles: ReadonlyMap<string, string>
}

const CONSIGNE =
	'Tu classes un mail reçu par une entreprise. On te donne une liste de pastilles, chacune avec une clé, un nom et un ' +
	'descriptif, puis le mail. Rends les clés des pastilles dont le descriptif correspond au mail : plusieurs si plusieurs ' +
	'correspondent, aucune si aucune ne correspond. N\'invente aucune clé. Réponds par le seul objet JSON demandé.'

/** La demande au modèle : rien d'autre que l'objet, l'expéditeur, le début du texte et la liste des pastilles. */
export function demandeDePastilles(message: MessageAEvaluer): Demande {
	const cles = new Map<string, string>()
	const lignes = message.labels.map((pastille, rang) => {
		const cle = `p${rang + 1}`
		cles.set(cle, pastille.id)
		return `- ${cle} : ${pastille.name} — ${pastille.description}`
	})
	const expediteur = [message.from_name?.trim(), message.from_address ? `<${message.from_address.trim()}>` : '']
		.filter((partie) => partie !== undefined && partie !== '')
		.join(' ')
	const contenu = [
		'Pastilles possibles :',
		...lignes,
		'',
		'Mail :',
		`Objet : ${message.subject?.trim() ?? ''}`,
		`De : ${expediteur}`,
		'Texte :',
		texteDuMail(message.body_text, message.body_html),
	].join('\n')
	const schema = {
		type: 'object',
		properties: {
			pastilles: { type: 'array', items: { type: 'string', enum: [...cles.keys()] }, uniqueItems: true },
		},
		required: ['pastilles'],
		additionalProperties: false,
	}
	return { messages: [{ role: 'system', content: CONSIGNE }, { role: 'user', content: contenu }], schema, cles }
}

/** La sortie contrôlée : les pastilles gardées, et le nombre de clés rejetées ; `null` si la forme est fausse. */
export type Sortie = { readonly ids: readonly string[]; readonly rejetees: number }

/**
 * Le contrôle de la sortie (docs/SPEC-ia.md §15.3) : un objet `{ pastilles: string[] }`, rien d'autre. Une clé inconnue
 * est REJETÉE et comptée, jamais rapprochée d'une autre ; les doublons tombent ; une forme fausse rend `null`, qui est
 * l'échec `reponse_invalide`.
 */
export function controlerSortie(contenu: unknown, cles: ReadonlyMap<string, string>): Sortie | null {
	if (typeof contenu !== 'object' || contenu === null || Array.isArray(contenu)) return null
	const pastilles = (contenu as Record<string, unknown>).pastilles
	if (!Array.isArray(pastilles) || !pastilles.every((cle) => typeof cle === 'string')) return null
	const ids = new Set<string>()
	let rejetees = 0
	for (const cle of pastilles as string[]) {
		const id = cles.get(cle)
		if (id === undefined) rejetees += 1
		else ids.add(id)
	}
	return { ids: [...ids], rejetees }
}
