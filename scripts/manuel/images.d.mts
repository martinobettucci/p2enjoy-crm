// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.0 : le contrat des images du manuel, pour les appelants typés
// @spec docs/SPEC-manual.md §11.4 (le manifeste, la découpe, l'élément cité)

export type Rectangle = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export type EntreeManifeste = {
	readonly fichier: string
	readonly largeur: number
	readonly hauteur: number
	readonly chapitre: string
	readonly section: string | null
	readonly pleinePage: boolean
	readonly libelles: readonly string[]
}

export type Manifeste = { readonly images: readonly EntreeManifeste[] }

export type ValeursInterface = { readonly exactes: ReadonlySet<string>; readonly motifs: readonly RegExp[] }

export const MARGE: number
export function normaliserLibelle(texte: string): string
export function cadrer(cibles: readonly Rectangle[], page: { readonly largeur: number; readonly hauteur: number }, marge?: number): Rectangle
export function fusionnerManifeste(manifeste: Manifeste | null | undefined, entrees: readonly EntreeManifeste[]): Manifeste
export function valeursInterface(sourceFr: string): ValeursInterface
export function elementsCites(source: string, valeurs: ValeursInterface): Map<string, Set<string>>
export function imagesReferencees(source: string): Array<{ fichier: string; chapitre: string | null; section: string | null }>
export function controlerImages(
	source: string,
	manifeste: Manifeste | null | undefined,
	fichiersSurDisque: readonly string[],
	options?: { readonly chapitres?: ReadonlySet<string> | null },
): string[]
export function controlerIllustration(
	source: string,
	manifeste: Manifeste | null | undefined,
	valeurs: ValeursInterface,
	options?: { readonly chapitres?: ReadonlySet<string> | null; readonly exceptions?: ReadonlyArray<{ libelle: string; chapitre: string }> },
): string[]
export function exceptionsDeLaSpecification(spec: string): Array<{ libelle: string; chapitre: string; motif: string }>
