// @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : la signature d'une remise
// @spec docs/SPEC-webhooks.md §5.1 (`X-P2Enjoy-Signature: t=<horodatage Unix>,v1=<HMAC-SHA256 hexadécimal de "<t>.<corps>">`,
//       la clé étant le secret tel qu'il a été rendu à la création, `whsec_` compris)
//
// Module pur, sur l'API Web Crypto : le même code signe dans le runtime des fonctions et se prouve sous Vitest.

const encodeur = new TextEncoder()

const hexadecimal = (octets: ArrayBuffer) =>
	Array.from(new Uint8Array(octets), (o) => o.toString(16).padStart(2, '0')).join('')

/** Le HMAC-SHA256, en hexadécimal, de `<horodatage>.<corps>` sous le secret. */
export async function signer(secret: string, horodatage: number, corps: string): Promise<string> {
	const cle = await crypto.subtle.importKey('raw', encodeur.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	])
	return hexadecimal(await crypto.subtle.sign('HMAC', cle, encodeur.encode(`${horodatage}.${corps}`)))
}

/** La valeur de l'en-tête `X-P2Enjoy-Signature`. */
export async function enteteSignature(secret: string, horodatage: number, corps: string): Promise<string> {
	return `t=${horodatage},v1=${await signer(secret, horodatage, corps)}`
}
