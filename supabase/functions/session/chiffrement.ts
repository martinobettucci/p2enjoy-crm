// @spec CRM-092 (docs/BACKLOG.md) — poignée de session, empreinte, chiffrement du jeton LeLabs au repos
// @spec docs/SPEC-session-sso.md §5.6 (poignée, empreinte), §5.7 (chiffrement AES-GCM, clé HKDF)
// @spec docs/JOURNAL.md décision 586 (le jeton de rafraîchissement ne quitte jamais le serveur)
// @spec CLAUDE.md §19 (WebCrypto suffit : aucune dépendance)
//
// Module pur. La poignée est ce que le navigateur tient, dans un cookie `httpOnly` ; la base n'en
// garde que l'empreinte, si bien qu'une fuite de table ne livre aucune poignée utilisable. Le jeton de
// rafraîchissement LeLabs est chiffré AVANT d'atteindre la base : une sauvegarde seule ne le livre pas.

import { decoderBase64url, encoderBase64url } from './jws.ts'

const SEL = new TextEncoder().encode('p2enjoy-crm/sel-sessions-sso')
const INFORMATION = new TextEncoder().encode('p2enjoy-crm/sessions-sso/v1')
const VERSION = 'v1'

/** 32 octets tirés par le générateur cryptographique, en base64url. */
export function tirerPoignee(): string {
	return encoderBase64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** Empreinte SHA-256 d'une poignée, au format hexadécimal `\x…` que PostgreSQL lit en `bytea`. */
export async function empreinteDe(poignee: string): Promise<string> {
	const octets = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(poignee)))
	return `\\x${Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Clé AES-GCM 256 dérivée de `JWT_SECRET` par HKDF-SHA-256. Ce n'est pas un secret de plus : qui
 * détient `JWT_SECRET` frappe déjà tout jeton interne ; la dérivation sépare seulement les usages.
 */
export async function cleDeChiffrement(secretJwt: string): Promise<CryptoKey> {
	const materiau = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretJwt), 'HKDF', false, ['deriveKey'])
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: SEL, info: INFORMATION },
		materiau,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	)
}

/** `v1.<vecteur>.<chiffré>` ; un vecteur de 12 octets neuf à chaque écriture. */
export async function chiffrer(texte: string, cle: CryptoKey): Promise<string> {
	const vecteur = crypto.getRandomValues(new Uint8Array(12))
	const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: vecteur }, cle, new TextEncoder().encode(texte)))
	return `${VERSION}.${encoderBase64url(vecteur)}.${encoderBase64url(chiffre)}`
}

/** Rend le texte clair, ou `null` si la forme est inconnue ou si l'authentification GCM échoue. */
export async function dechiffrer(enveloppe: string, cle: CryptoKey): Promise<string | null> {
	const [version, segVecteur, segChiffre] = enveloppe.split('.')
	if (version !== VERSION || segVecteur === undefined || segChiffre === undefined) return null
	const vecteur = decoderBase64url(segVecteur)
	const chiffre = decoderBase64url(segChiffre)
	if (vecteur === null || chiffre === null || vecteur.length !== 12) return null
	try {
		return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: vecteur }, cle, chiffre))
	} catch {
		return null
	}
}
