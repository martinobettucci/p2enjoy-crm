// @spec CRM-114 (docs/BACKLOG.md) — tranche T2 : le formulaire d'une organisation, commun à la création et à la
//       modification
// @spec docs/SPEC-organisations.md §2, §3 (refus traduits) ; docs/DESIGN_SYSTEM.md §5.64 (trois champs à libellé visible,
//       aides, « Créer » désactivé tant que le nom est blanc), §5.23 (dans le flux, focus entrant, refus dans le
//       formulaire, saisie conservée), §5.7 (contrôles)
//
// `noValidate` : un refus se dit par le dictionnaire, dans le formulaire, jamais par la bulle du navigateur (§5.63).

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { t, type CleTraduction } from '../i18n'
import type { NatureRefusOrganisation, SaisieOrganisation } from '../lib/organisations'

/** Le dictionnaire fermé des refus (docs/SPEC-organisations.md §3). */
export const MESSAGES_REFUS_ORGANISATION: Readonly<Record<NatureRefusOrganisation, CleTraduction>> = {
	'nom-invalide': 'organizations.refus.nom',
	'domaine-invalide': 'organizations.refus.domaine',
	'site-invalide': 'organizations.refus.site',
	'domaine-pris': 'organizations.refus.domainePris',
	interdit: 'organizations.refus.interdit',
	reseau: 'organizations.refus.reseau',
	inconnu: 'organizations.refus.inconnu',
}

const CLASSES_CONTROLE = [
	'min-h-[var(--size-target)] w-full rounded-sm border border-border bg-surface px-3',
	'focus:outline-none focus:ring-2 focus:ring-brand',
].join(' ')

export type ProprietesFormulaireOrganisation = {
	readonly prefixe: string
	readonly titre: string
	readonly saisieInitiale: SaisieOrganisation
	readonly libelleEnvoi: string
	readonly libelleEnvoiEnCours: string
	/** Rend `null` quand l'écriture a porté — le formulaire est alors démonté —, ou la nature du refus. */
	readonly onEnvoyer: (saisie: SaisieOrganisation) => Promise<NatureRefusOrganisation | null>
	readonly onAnnuler: () => void
}

export function FormulaireOrganisation({
	prefixe,
	titre,
	saisieInitiale,
	libelleEnvoi,
	libelleEnvoiEnCours,
	onEnvoyer,
	onAnnuler,
}: ProprietesFormulaireOrganisation) {
	const [saisie, setSaisie] = useState<SaisieOrganisation>(saisieInitiale)
	const [enVol, setEnVol] = useState(false)
	const [refus, setRefus] = useState<NatureRefusOrganisation | null>(null)
	const champNom = useRef<HTMLInputElement>(null)
	const boutonEnvoi = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		champNom.current?.focus()
	}, [])

	// Après un refus, le focus revient au bouton d'envoi, réactivé : désactivé pendant le vol, il l'avait perdu (§5.63).
	useEffect(() => {
		if (!enVol && refus !== null) boutonEnvoi.current?.focus()
	}, [enVol, refus])

	const envoyer = async (evenement: FormEvent) => {
		evenement.preventDefault()
		if (enVol || saisie.nom.trim() === '') return
		setEnVol(true)
		setRefus(null)
		const nature = await onEnvoyer(saisie)
		if (nature === null) return
		setEnVol(false)
		setRefus(nature)
	}

	const modifier = (champ: keyof SaisieOrganisation, valeur: string) =>
		setSaisie((precedente) => ({ ...precedente, [champ]: valeur }))

	const echap = (evenement: KeyboardEvent<HTMLElement>) => {
		if (evenement.key === 'Escape') onAnnuler()
	}

	return (
		<form
			noValidate
			data-testid="formulaire-organisation"
			aria-label={titre}
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 max-w-[60ch]"
			onKeyDown={echap}
			onSubmit={(evenement) => void envoyer(evenement)}
		>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-nom`} className="text-sm text-text-2">
					{t('organizations.form.name')}
				</label>
				<input
					id={`${prefixe}-nom`}
					ref={champNom}
					type="text"
					required
					maxLength={200}
					value={saisie.nom}
					onChange={(evenement) => modifier('nom', evenement.target.value)}
					className={CLASSES_CONTROLE}
					data-testid="champ-nom-organisation"
				/>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-domaine`} className="text-sm text-text-2">
					{t('organizations.form.domain')}
				</label>
				<input
					id={`${prefixe}-domaine`}
					type="text"
					inputMode="url"
					autoCapitalize="none"
					spellCheck={false}
					value={saisie.domaine}
					onChange={(evenement) => modifier('domaine', evenement.target.value)}
					aria-describedby={`${prefixe}-domaine-aide`}
					className={CLASSES_CONTROLE}
					data-testid="champ-domaine-organisation"
				/>
				<p id={`${prefixe}-domaine-aide`} className="text-sm text-text-2">
					{t('organizations.form.domain.help')}
				</p>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-site`} className="text-sm text-text-2">
					{t('organizations.form.website')}
				</label>
				<input
					id={`${prefixe}-site`}
					type="url"
					inputMode="url"
					spellCheck={false}
					value={saisie.siteWeb}
					onChange={(evenement) => modifier('siteWeb', evenement.target.value)}
					aria-describedby={`${prefixe}-site-aide`}
					className={CLASSES_CONTROLE}
					data-testid="champ-site-organisation"
				/>
				<p id={`${prefixe}-site-aide`} className="text-sm text-text-2">
					{t('organizations.form.website.help')}
				</p>
			</div>
			{refus === null ? null : (
				<p role="alert" data-testid="refus-organisation" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					{t(MESSAGES_REFUS_ORGANISATION[refus])}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<button
					ref={boutonEnvoi}
					type="submit"
					disabled={enVol || saisie.nom.trim() === ''}
					data-testid="envoyer-organisation"
					className="min-h-[var(--size-target)] rounded-md bg-brand px-4 text-surface disabled:cursor-not-allowed disabled:opacity-70"
				>
					{enVol ? libelleEnvoiEnCours : libelleEnvoi}
				</button>
				<button
					type="button"
					data-testid="annuler-organisation"
					className="min-h-[var(--size-target)] rounded-md border border-border px-4"
					onClick={onAnnuler}
				>
					{t('organizations.form.cancel')}
				</button>
			</div>
		</form>
	)
}
