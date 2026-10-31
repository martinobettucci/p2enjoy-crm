// @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : aucune adresse interne — la falsification de requête côté serveur refusée
// @spec docs/SPEC-webhooks.md §6 (bouclage, privées, lien local, pile, métadonnées de nuage refusées ; nom résolu avant
//       chaque essai ; `WEBHOOKS_ALLOWED_HOSTS` en développement seulement)
//
// Module pur : la résolution est injectée. Une adresse interdite parmi celles que le nom désigne suffit à refuser l'essai —
// un nom qui pointerait à la fois dehors et dedans ne passe pas.

export type Resoudre = (hote: string, type: 'A' | 'AAAA') => Promise<string[]>
export type Verdict = 'ok' | 'address_forbidden' | 'dns_error'

const octets4 = (ip: string): number[] | null => {
	const parties = ip.split('.')
	if (parties.length !== 4) return null
	const nombres = parties.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN))
	return nombres.every((n) => n >= 0 && n <= 255) ? nombres : null
}

/** Les blocs IPv4 qui ne sont pas l'Internet public (RFC 6890 et suivantes). */
export function ipv4Interdite(ip: string): boolean {
	const o = octets4(ip)
	if (!o) return true
	const [a, b] = o as [number, number, number, number]
	return (
		a === 0 || a === 10 || a === 127 || a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && o[2] === 0) ||
		(a === 198 && (b === 18 || b === 19))
	)
}

/** Développe une adresse IPv6 en huit groupes de 16 bits ; nul si elle ne se lit pas. */
function groupes6(ip: string): number[] | null {
	let texte = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? ''
	const v4 = texte.match(/(\d+\.\d+\.\d+\.\d+)$/)
	if (v4) {
		const o = octets4(v4[1] ?? '')
		if (!o) return null
		texte = texte.slice(0, -(v4[1] ?? '').length) + ((o[0]! << 8) | o[1]!).toString(16) + ':' + ((o[2]! << 8) | o[3]!).toString(16)
	}
	const moities = texte.split('::')
	if (moities.length > 2) return null
	const lire = (s: string) => (s === '' ? [] : s.split(':'))
	const tete = lire(moities[0] ?? '')
	const queue = moities.length === 2 ? lire(moities[1] ?? '') : []
	const manquants = 8 - tete.length - queue.length
	if (moities.length === 1 ? manquants !== 0 : manquants < 1) return null
	const tous = [...tete, ...Array(moities.length === 2 ? manquants : 0).fill('0'), ...queue]
	if (tous.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
	return tous.map((g) => Number.parseInt(g, 16))
}

/** Les blocs IPv6 qui ne sont pas l'Internet public ; une IPv4 enveloppée est jugée comme IPv4. */
export function ipv6Interdite(ip: string): boolean {
	const g = groupes6(ip)
	if (!g) return true
	const premier = g[0]!
	const toutNul = g.slice(0, 7).every((x) => x === 0)
	if (toutNul && (g[7] === 0 || g[7] === 1)) return true // :: et ::1
	const enveloppe = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff
	if (enveloppe) return ipv4Interdite(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`)
	return (
		(premier & 0xfe00) === 0xfc00 || // fc00::/7, unique locale
		(premier & 0xffc0) === 0xfe80 || // fe80::/10, lien local
		(premier & 0xff00) === 0xff00 || // ff00::/8, multidiffusion
		(premier === 0x64 && g[1] === 0xff9b) || // 64:ff9b::/96, traduction vers IPv4
		(premier === 0x2001 && g[1] === 0x0db8) // 2001:db8::/32, documentation
	)
}

export const estIpv4 = (hote: string) => octets4(hote) !== null
export const estIpv6 = (hote: string) => hote.includes(':')

export function adresseInterdite(ip: string): boolean {
	return estIpv4(ip) ? ipv4Interdite(ip) : ipv6Interdite(ip)
}

/**
 * Le verdict d'un hôte avant un essai : un hôte autorisé (développement) passe ; une adresse littérale est jugée
 * telle quelle ; un nom est résolu (A et AAAA) et refusé si l'une de ses adresses est interdite, ou s'il n'en a aucune.
 */
export async function verifierHote(hote: string, resoudre: Resoudre, autorises: ReadonlySet<string>): Promise<Verdict> {
	const nom = hote.toLowerCase().replace(/^\[|\]$/g, '')
	if (autorises.has(nom)) return 'ok'
	if (estIpv4(nom) || estIpv6(nom)) return adresseInterdite(nom) ? 'address_forbidden' : 'ok'
	if (nom === 'localhost' || nom.endsWith('.localhost')) return 'address_forbidden'
	const adresses: string[] = []
	for (const type of ['A', 'AAAA'] as const) {
		try {
			adresses.push(...(await resoudre(nom, type)))
		} catch {
			// Un type sans enregistrement n'est pas une erreur ; l'absence de TOUT enregistrement en est une.
		}
	}
	if (adresses.length === 0) return 'dns_error'
	return adresses.some(adresseInterdite) ? 'address_forbidden' : 'ok'
}
