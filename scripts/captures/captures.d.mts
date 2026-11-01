// @spec CRM-122 (docs/BACKLOG.md) — tranche T2 : le contrat du module des captures, pour les appelants typés
// @spec docs/SPEC-captures.md §2, §3

export declare const SEUIL_CANAL: number
export declare const SEUIL_CHANGEE: number
export declare function destinationsCapture(
	unite: string,
	environnement: Record<string, string | undefined>,
): { readonly sortie: string; readonly versionner: boolean }
export declare function ecartPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, seuil?: number): number
export declare function classer(ecart: number): 'changée' | 'bruit'
