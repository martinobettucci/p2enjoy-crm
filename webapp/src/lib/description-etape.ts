// @spec CRM-133 (docs/BACKLOG.md) — tranche T2 : la description EFFECTIVE d'une étape, commune au board et à la fiche
//       (docs/SPEC-workflow-engine.md §7 sexies.1, §7 sexies.4)

/**
 * `coalesce(description_override, node.description)` — `docs/SPEC-workflow-engine.md` §7 sexies.1. Une valeur faite de
 * blancs n'en est pas une (la base la refuse, l'écran ne la montre pas) : elle vaut absence, des deux côtés. `null`
 * sans l'une ni l'autre, et aucun bouton d'information n'est alors rendu (`docs/DESIGN_SYSTEM.md` §5.58).
 */
export function descriptionEffective(
	surcharge: string | null | undefined,
	duNoeud: string | null | undefined,
): string | null {
	for (const valeur of [surcharge, duNoeud]) {
		if (typeof valeur === 'string' && valeur.trim() !== '') return valeur
	}
	return null
}
