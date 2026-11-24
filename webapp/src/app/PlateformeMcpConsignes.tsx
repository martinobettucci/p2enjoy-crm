// @spec CRM-165 (docs/BACKLOG.md) — tranche T3 : le bloc « Consignes aux assistants » de Plateforme ▸ Connecteur MCP — lire
//       le texte de la plateforme, l'écrire, son auteur et sa date, le socle du connecteur replié
// @spec docs/SPEC-mcp.md §18.1 (le socle, puis l'ajout), §18.3 (les deux fonctions, leurs refus), §18.5 (l'écran) ;
//       docs/DESIGN_SYSTEM.md §5.114 (la place, le champ, le compteur, l'annonce, l'auteur, le socle replié, les refus),
//       §5.56, §5.34 (aucune garde de saisie de plus que la base), §5.8 (états) ; décisions 980 et 983
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : `app.exiger_superadmin()` garde la lecture et l'écriture en base, et
//       son refus est traduit sous le champ

import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	LONGUEUR_CONSIGNES,
	lireConsignesConnecteur,
	poserConsignesConnecteur,
	type ConsignesConnecteur,
	type RefusPlateforme,
} from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { formaterDate } from './presentation-plateforme'

const CLASSES_AIDE = 'text-sm text-text-3'
const nombre = new Intl.NumberFormat('fr-FR')

/** Le dictionnaire fermé du bloc (§5.114) : la borne, le drapeau, et tout le reste en panne. */
export function cleRefusConsignes(refus: RefusPlateforme): CleTraduction {
	if (refus === 'connector_instructions_too_long') return 'platform.mcp.consignes.refus.longueur'
	if (refus === 'reserve_aux_superadministrateurs') return 'platform.mcp.consignes.refus.reserve'
	return 'platform.mcp.consignes.refus.panne'
}

/** « Modifiées par {nom} le {date} », « Modifiées le {date} » pour un auteur parti, ou « Jamais modifiées. » */
export function texteModification(consignes: Pick<ConsignesConnecteur, 'modifieesLe' | 'modifieesPar'>): string {
	if (consignes.modifieesLe === null) return t('platform.mcp.consignes.jamais')
	const date = formaterDate(consignes.modifieesLe)
	return consignes.modifieesPar === null
		? t('platform.mcp.consignes.modifieesSansAuteur', { date })
		: t('platform.mcp.consignes.modifiees', { nom: consignes.modifieesPar, date })
}

export function PlateformeMcpConsignes({ client }: { readonly client: ClientCrm }) {
	const id = useId()
	const [etat, setEtat] = useState<EtatAsync<ConsignesConnecteur>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [saisie, setSaisie] = useState('')
	const [enCours, setEnCours] = useState(false)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [annonce, setAnnonce] = useState('')
	const [socleOuvert, setSocleOuvert] = useState(false)
	const champ = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		let vivant = true
		void lireConsignesConnecteur(client).then((resultat) => {
			if (!vivant) return
			setEtat(resultat)
			if (resultat.statut === 'pret') setSaisie(resultat.donnees.texte)
		})
		return () => {
			vivant = false
		}
	}, [client, tentative])

	const relire = useCallback(() => setTentative((n) => n + 1), [])

	async function enregistrer(evenement: FormEvent<HTMLFormElement>) {
		evenement.preventDefault()
		setEnCours(true)
		setRefus(null)
		setAnnonce('')
		const issue = await poserConsignesConnecteur(client, saisie)
		setEnCours(false)
		if (issue.statut === 'refus') {
			// La saisie est gardée ; le focus revient au champ (§5.114).
			setRefus(cleRefusConsignes(issue.refus))
			champ.current?.focus()
			return
		}
		setAnnonce(t('platform.mcp.consignes.enregistrees'))
		// La base a normalisé le texte et posé l'auteur et la date : le bloc les relit.
		const relu = await lireConsignesConnecteur(client)
		if (relu.statut === 'pret') {
			setEtat(relu)
			setSaisie(relu.donnees.texte)
		}
	}

	return (
		<section aria-labelledby={`${id}-titre`} className="flex flex-col gap-3" data-testid="consignes-connecteur">
			<h2 id={`${id}-titre`} className="text-h2">
				{t('platform.mcp.consignes.titre')}
			</h2>
			<p className="text-sm text-text-2 max-w-[72ch]">{t('platform.mcp.consignes.intro')}</p>
			<p role="status" className="sr-only" data-testid="annonce-consignes">
				{annonce}
			</p>
			{etat.statut === 'chargement' && <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />}
			{etat.statut === 'erreur' && (
				<EtatErreur
					titre={t('platform.mcp.consignes.erreur.title')}
					corps={t('platform.mcp.consignes.erreur.body')}
					libelleReprise={t('state.error.retry')}
					onReprise={relire}
				/>
			)}
			{etat.statut === 'pret' && (
				<>
					<form className="flex flex-col gap-3" onSubmit={(evenement) => void enregistrer(evenement)} noValidate>
						<div className="flex flex-col gap-1 w-full md:max-w-[72ch]">
							<label htmlFor={`${id}-texte`} className="text-sm text-text-2">
								{t('platform.mcp.consignes.champ')}
							</label>
							<textarea
								id={`${id}-texte`}
								ref={champ}
								data-testid="consignes-texte"
								rows={12}
								maxLength={LONGUEUR_CONSIGNES}
								value={saisie}
								aria-describedby={`${id}-aide ${id}-compteur`}
								aria-invalid={refus === null ? undefined : true}
								onChange={(evenement) => setSaisie(evenement.target.value)}
								className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-base text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
							/>
							<p id={`${id}-aide`} className={CLASSES_AIDE}>
								{t('platform.mcp.consignes.aide')}
							</p>
							{/* Pas une région vivante : elle parlerait à chaque frappe ; sa valeur est dans la description du champ. */}
							<p id={`${id}-compteur`} className={`${CLASSES_AIDE} tabular-nums`} data-testid="consignes-compteur">
								{t('platform.mcp.consignes.compteur', {
									n: nombre.format(saisie.length),
									max: nombre.format(LONGUEUR_CONSIGNES),
								})}
							</p>
						</div>
						{refus === null ? null : (
							<p
								role="alert"
								data-testid="refus-consignes"
								className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3 text-sm md:max-w-[72ch]"
							>
								<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-1" />
								<span>{t(refus)}</span>
							</p>
						)}
						<div>
							{/* Jamais éteint par l'état du champ : aucune garde de saisie ne double la borne de la base (§5.34). */}
							<Button variante="primaire" type="submit" disabled={enCours} aria-busy={enCours} data-testid="consignes-enregistrer">
								{t(enCours ? 'platform.mcp.consignes.enCours' : 'platform.mcp.consignes.enregistrer')}
							</Button>
						</div>
						<p className="text-sm text-text-2" data-testid="consignes-auteur">
							{texteModification(etat.donnees)}
						</p>
					</form>
					<details
						className="md:max-w-[72ch]"
						data-testid="consignes-socle"
						onToggle={(evenement) => setSocleOuvert(evenement.currentTarget.open)}
					>
						{/* `flex` ôte le marqueur natif du résumé : le chevron le remplace (§5.114 ; défaut vu sur la capture de T3). */}
						<summary className="cursor-pointer min-h-[var(--size-target)] flex items-center gap-2 px-1 text-sm font-medium text-text rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
							{socleOuvert ? (
								<ChevronDown aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
							) : (
								<ChevronRight aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
							)}
							{t('platform.mcp.consignes.socle')}
						</summary>
						{etat.donnees.socle === '' ? (
							<p className="text-sm text-text-2 mt-2">{t('platform.mcp.consignes.socleAbsent')}</p>
						) : (
							<>
								<pre className="mt-2 font-mono text-sm whitespace-pre-wrap break-words bg-hover border border-border rounded-md p-3 text-text">
									{etat.donnees.socle}
								</pre>
								{etat.donnees.soclePublieLe !== null && (
									<p className="text-sm text-text-2 mt-2">
										{t('platform.mcp.consignes.soclePublie', { date: formaterDate(etat.donnees.soclePublieLe) })}
									</p>
								)}
							</>
						)}
					</details>
				</>
			)}
		</section>
	)
}
