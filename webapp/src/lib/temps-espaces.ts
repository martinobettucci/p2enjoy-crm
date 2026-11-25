// @spec CRM-161 (docs/BACKLOG.md) — tranche T3.d : « Saisir pour » et le choix de la personne du rapport de temps, à plusieurs
//       espaces — les membres des espaces que la personne ADMINISTRE, rangés par espace (docs/SPEC-espace-courant.md §16.9.2 ;
//       décision 981 ; docs/SPEC-temps.md §7.1, §7.2 ; docs/DESIGN_SYSTEM.md §5.54, §5.115)
//
// CE MODULE NE DÉCIDE AUCUN DROIT (`CLAUDE.md` §10) : il demande à la base le rôle de la personne dans chaque espace lu
// (`mon_role_espace`), puis les membres de ceux qu'elle administre. La liste n'est qu'une aide d'interface ; qui écrit pour
// qui, et sur quelle cible, c'est `app.saisie_temps_permise` (migration `0087`), et ce que le rapport rend, la RLS.

import { useEffect, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import { lireMembresAffectables, type MembreAffectable } from './entete-card'
import { estAdministrateur, lireRoleWorkspace } from './roles'
import type { ClientCrm } from './supabase'
import type { Workspace } from './workspaces'

/** Un espace que la personne administre, et ses membres, rangés par nom. */
export type EspaceAdministre = { readonly espace: Workspace; readonly membres: readonly MembreAffectable[] }

/**
 * Les espaces lus que la personne administre, dans l'ordre donné (celui du menu, §5.113), chacun avec ses membres. Un espace
 * qu'elle n'administre pas n'y figure pas — et la lectrice, ou un business developer, n'en a aucun. **Une lecture qui échoue
 * rend l'erreur** : un espace omis en silence ferait disparaître une option sans que rien ne le dise.
 */
export async function lireEspacesAdministres(
	client: ClientCrm,
	espaces: readonly Workspace[],
	idUtilisateur: string,
): Promise<EtatAsync<readonly EspaceAdministre[]>> {
	try {
		const roles = await Promise.all(espaces.map((espace) => lireRoleWorkspace(client, espace.id, idUtilisateur)))
		const erreur = roles.find((role) => role.statut === 'erreur')
		if (erreur !== undefined && erreur.statut === 'erreur') return enErreur(erreur.erreur)
		const administres = espaces.filter((_, i) => {
			const role = roles[i]
			return role !== undefined && estAdministrateur(role)
		})
		const membres = await Promise.all(administres.map((espace) => lireMembresAffectables(client, espace.id)))
		const echec = membres.find((lu) => lu.statut === 'erreur')
		if (echec !== undefined && echec.statut === 'erreur') return enErreur(echec.erreur)
		return pret(
			administres.map((espace, i) => {
				const lu = membres[i]
				return { espace, membres: lu !== undefined && lu.statut === 'pret' ? lu.donnees : [] }
			}),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les membres de tous les espaces administrés, SANS DOUBLON — une personne membre de deux d'entre eux n'est offerte qu'une fois
 * —, la personne connectée écartée, rangés par nom : la liste du rapport de temps, dont la lecture, sous la RLS, ne rend à un
 * administrateur que le temps des espaces qu'il administre.
 */
export function membresDesEspaces(
	espaces: readonly EspaceAdministre[],
	idUtilisateur: string,
): readonly MembreAffectable[] {
	const parId = new Map<string, MembreAffectable>()
	for (const { membres } of espaces) {
		for (const membre of membres) if (membre.id !== idUtilisateur && !parId.has(membre.id)) parId.set(membre.id, membre)
	}
	return [...parId.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}

/**
 * Les espaces administrés, lus pour un écran à plusieurs espaces. `actif` faux (un seul espace lu) : rien n'est lu, l'état est
 * celui d'une réponse vide — l'écran garde son chemin d'avant.
 */
export function useEspacesAdministres(
	client: ClientCrm,
	espaces: readonly Workspace[],
	idUtilisateur: string,
	actif: boolean,
): EtatAsync<readonly EspaceAdministre[]> {
	const [etat, setEtat] = useState<EtatAsync<readonly EspaceAdministre[]>>(actif ? enChargement() : pret([]))
	// La clé textuelle des espaces dit seule quand relire : la liste est recréée à chaque rendu du contexte.
	const cle = espaces.map((e) => e.id).join(',')
	useEffect(() => {
		if (!actif) {
			setEtat(pret([]))
			return
		}
		let courant = true
		setEtat(enChargement())
		void lireEspacesAdministres(client, espaces, idUtilisateur).then((lu) => {
			if (courant) setEtat(lu)
		})
		return () => {
			courant = false
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `cle` porte les espaces
	}, [client, cle, idUtilisateur, actif])
	return etat
}
