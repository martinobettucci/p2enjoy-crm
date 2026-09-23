// @spec CRM-092 (docs/BACKLOG.md) — cookie de la poignée de session
// @spec docs/SPEC-session-sso.md §5.6 (HttpOnly, SameSite=Strict, Path, Secure sur https, sans durée)
// @spec CLAUDE.md §11 (catégorie 1 : strictement nécessaire à la session, sans traçage)
//
// Module pur. Le cookie n'est lu par aucun script de la page (`HttpOnly`), n'est envoyé qu'à
// l'échangeur (`Path`), jamais depuis un autre site (`SameSite=Strict`), et n'a pas de durée : il vit
// jusqu'à la fermeture du navigateur ou à la déconnexion.

export const NOM_COOKIE = 'p2enjoy_crm_session'
export const CHEMIN_COOKIE = '/functions/v1/session'
const POIGNEE = /^[A-Za-z0-9_-]{43}$/

/** La poignée portée par l'en-tête `Cookie`, ou `null` si elle manque ou n'a pas la forme attendue. */
export function lirePoignee(enTeteCookie: string | null): string | null {
	if (enTeteCookie === null) return null
	for (const morceau of enTeteCookie.split(';')) {
		const egal = morceau.indexOf('=')
		if (egal < 0) continue
		if (morceau.slice(0, egal).trim() !== NOM_COOKIE) continue
		const valeur = morceau.slice(egal + 1).trim()
		return POIGNEE.test(valeur) ? valeur : null
	}
	return null
}

/** `Secure` dès que l'origine appelante est `https` — toujours en production, jamais en `http` local. */
export function origineSecurisee(origine: string | null): boolean {
	return origine !== null && origine.startsWith('https://')
}

function attributs(securise: boolean): string {
	return `Path=${CHEMIN_COOKIE}; HttpOnly; SameSite=Strict${securise ? '; Secure' : ''}`
}

export function cookieDePoignee(poignee: string, securise: boolean): string {
	return `${NOM_COOKIE}=${poignee}; ${attributs(securise)}`
}

export function cookieEfface(securise: boolean): string {
	return `${NOM_COOKIE}=; ${attributs(securise)}; Max-Age=0`
}
