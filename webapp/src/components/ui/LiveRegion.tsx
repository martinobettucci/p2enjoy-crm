// @spec CRM-007 (docs/BACKLOG.md) — région d'annonces accessibles
// @spec docs/DESIGN_SYSTEM.md §8 (changements importants annoncés par une région aria-live polie)
// @spec docs/SPEC-webapp.md §9 (accessibilité)
//
// **Une seule** région pour toute l'application : plusieurs régions concurrentes produisent
// des annonces qui se recouvrent et que les lecteurs d'écran arbitrent différemment.
//
// La région est présente dès le premier rendu, même vide : une région insérée en même temps
// que son message n'est pas annoncée par la plupart des lecteurs d'écran.

export type ProprietesLiveRegion = {
	readonly libelle: string
	readonly message: string
}

export function LiveRegion({ libelle, message }: ProprietesLiveRegion) {
	return (
		<div
			role="status"
			aria-live="polite"
			aria-atomic="true"
			aria-label={libelle}
			data-testid="region-annonces"
			className="sr-only"
		>
			{message}
		</div>
	)
}
