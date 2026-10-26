// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : le contrat de la construction du manuel, pour les appelants typés
// @spec docs/SPEC-manual.md §15 (le format construit) ; docs/DAT.md §12 bis (les clés, en anglais)

export type ImageDuManifeste = { readonly fichier: string; readonly largeur: number; readonly hauteur: number }

export type Construction = {
	readonly contents: {
		readonly introduction: ReadonlyArray<Record<string, unknown>>
		readonly chapters: ReadonlyArray<{
			readonly slug: string
			readonly title: string
			readonly sections: ReadonlyArray<{ readonly anchor: string; readonly title: string }>
		}>
	}
	readonly chapters: ReadonlyArray<{ readonly slug: string; readonly title: string; readonly blocks: ReadonlyArray<Record<string, unknown>> }>
	readonly erreurs: readonly string[]
	readonly avertissements: readonly string[]
}

export function identifiant(titre: string): string
export function construire(
	source: string,
	manifeste?: { readonly images?: readonly ImageDuManifeste[] },
	options?: { readonly imageExiste?: (chemin: string) => boolean },
): Construction
export function serialiser(objet: unknown): string
