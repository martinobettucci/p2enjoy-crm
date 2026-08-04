// @spec CRM-007 (docs/BACKLOG.md) — lien d'évitement
// @spec docs/DESIGN_SYSTEM.md §8 (navigation clavier complète, focus visible)
// @spec docs/SPEC-webapp.md §9 (accessibilité, premier élément focusable)
//
// Premier élément focusable du document : il permet d'atteindre le contenu sans parcourir
// toute la navigation au clavier. Masqué visuellement tant qu'il n'a pas le focus, il devient
// pleinement visible dès qu'il l'obtient — un lien d'évitement invisible même focalisé
// n'aiderait que les lecteurs d'écran, pas la navigation clavier voyante.

export type ProprietesSkipLink = {
	readonly cible: string
	readonly libelle: string
}

export function SkipLink({ cible, libelle }: ProprietesSkipLink) {
	return (
		<a
			href={`#${cible}`}
			data-testid="lien-evitement"
			className={[
				'sr-only focus:not-sr-only',
				'focus:absolute focus:top-2 focus:left-2 focus:z-50',
				'focus:inline-flex focus:items-center focus:min-h-[var(--size-target)] focus:px-4',
				'focus:rounded-sm focus:bg-brand focus:text-white',
			].join(' ')}
		>
			{libelle}
		</a>
	)
}
