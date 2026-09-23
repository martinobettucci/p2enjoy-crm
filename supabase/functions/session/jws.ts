// @spec CRM-092 (docs/BACKLOG.md) — lecture, vérification et signature des jetons de l'échangeur
// @spec docs/SPEC-session-sso.md §5.2 (points 1, 2 et 5 : forme, algorithme, signature), §5.3 (jeton interne)
// @spec docs/SSO-client-lelabs-crm.md (« algorithme asymétrique ; refuser tout jeton symétrique »)
// @spec CLAUDE.md §19 (aucune dépendance quand le runtime suffit)
//
// Module pur : aucune API Deno, aucun réseau. WebCrypto fournit tout ce qu'il faut — RSA et ECDSA
// pour vérifier le jeton LeLabs, HMAC pour signer le jeton interne —, si bien qu'aucune bibliothèque
// JOSE n'entre dans le runtime.

/** Les seuls algorithmes qu'un jeton LeLabs peut porter (§5.2, point 2). */
export const ALGORITHMES_ACCEPTES = ['RS256', 'ES256'] as const
export type AlgorithmeAccepte = (typeof ALGORITHMES_ACCEPTES)[number]

export type Jws = {
	readonly entete: Readonly<Record<string, unknown>>
	readonly charge: Readonly<Record<string, unknown>>
	/** Octets signés : `base64url(entête) + '.' + base64url(charge)`. */
	readonly signe: Uint8Array<ArrayBuffer>
	readonly signature: Uint8Array<ArrayBuffer>
}

const SEGMENT = /^[A-Za-z0-9_-]+$/

/** base64url sans remplissage (RFC 7515 §2) ; `null` si un caractère sort de l'alphabet. */
export function decoderBase64url(segment: string): Uint8Array<ArrayBuffer> | null {
	if (!SEGMENT.test(segment) || segment.length % 4 === 1) return null
	const base64 = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4)
	let binaire: string
	try {
		binaire = atob(base64)
	} catch {
		return null
	}
	const octets = new Uint8Array(binaire.length)
	for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
	return octets
}

export function encoderBase64url(octets: Uint8Array): string {
	let binaire = ''
	for (const octet of octets) binaire += String.fromCharCode(octet)
	return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function objetJson(octets: Uint8Array | null): Record<string, unknown> | null {
	if (octets === null) return null
	try {
		const valeur: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(octets))
		return valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur)
			? (valeur as Record<string, unknown>)
			: null
	} catch {
		return null
	}
}

/** Découpe un JWS compact ; `null` s'il n'a pas trois segments ou si l'entête ou la charge n'est pas un objet JSON. */
export function lireJws(jeton: string): Jws | null {
	const segments = jeton.split('.')
	if (segments.length !== 3) return null
	const [segEntete, segCharge, segSignature] = segments as [string, string, string]
	const entete = objetJson(decoderBase64url(segEntete))
	const charge = objetJson(decoderBase64url(segCharge))
	const signature = decoderBase64url(segSignature)
	if (entete === null || charge === null || signature === null) return null
	return { entete, charge, signe: new TextEncoder().encode(`${segEntete}.${segCharge}`), signature }
}

export function algorithmeAccepte(alg: unknown): alg is AlgorithmeAccepte {
	return typeof alg === 'string' && (ALGORITHMES_ACCEPTES as readonly string[]).includes(alg)
}

/** La clé publiée convient-elle à l'algorithme ? `use` absent ou `sig` (§5.2, point 4). */
export function cleCompatible(alg: AlgorithmeAccepte, cle: Readonly<Record<string, unknown>>): boolean {
	if (cle.use !== undefined && cle.use !== 'sig') return false
	if (alg === 'RS256') return cle.kty === 'RSA' && typeof cle.n === 'string' && typeof cle.e === 'string'
	return cle.kty === 'EC' && cle.crv === 'P-256' && typeof cle.x === 'string' && typeof cle.y === 'string'
}

/**
 * Vérifie la signature par WebCrypto. Seuls les paramètres publics de la clé sont importés : les
 * champs annexes d'un JWKS (`x5c`, `alg`, `key_ops`…) ne peuvent pas faire échouer l'import. Toute
 * erreur — clé invalide, signature de mauvaise longueur — rend `false`.
 */
export async function verifierSignature(
	alg: AlgorithmeAccepte,
	cle: Readonly<Record<string, unknown>>,
	signe: Uint8Array<ArrayBuffer>,
	signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
	try {
		if (alg === 'RS256') {
			const publique = await crypto.subtle.importKey(
				'jwk',
				{ kty: 'RSA', n: cle.n as string, e: cle.e as string },
				{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
				false,
				['verify'],
			)
			return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publique, signature, signe)
		}
		const publique = await crypto.subtle.importKey(
			'jwk',
			{ kty: 'EC', crv: 'P-256', x: cle.x as string, y: cle.y as string },
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify'],
		)
		return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publique, signature, signe)
	} catch {
		return false
	}
}

/**
 * Signe le jeton INTERNE en `HS256` avec la clé que PostgREST, Realtime et Storage connaissent déjà
 * (§5.3). Ce jeton ne prouve rien au SSO et ne sort pas du CRM ; l'échangeur, lui, n'accepte aucun
 * jeton symétrique en entrée.
 */
export async function signerHs256(charge: Readonly<Record<string, unknown>>, secret: string): Promise<string> {
	const texte = (valeur: unknown) => encoderBase64url(new TextEncoder().encode(JSON.stringify(valeur)))
	const signe = `${texte({ alg: 'HS256', typ: 'JWT' })}.${texte(charge)}`
	const cle = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(signe)))
	return `${signe}.${encoderBase64url(signature)}`
}
