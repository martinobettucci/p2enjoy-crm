// @spec CRM-107 (docs/BACKLOG.md) — tranche T2 : le calculateur du coût par quart, dans « Nouvelle version »
// @spec docs/SPEC-temps.md §7.4 bis (1 : les cinq champs ; 2 : la formule ; 3 : rien n'est enregistré ; 4 : le résultat
//       en direct, « Utiliser ce coût » ; 5 : les bornes ; 6 : rien ne persiste côté client) ; docs/DESIGN_SYSTEM.md
//       §5.54 ter (dépli, fieldset, `<output>`, formule, erreurs, paliers), §5.5 ; décision 631
//
// LE CALCULATEUR N'ÉCRIT RIEN. Il ne tient ses valeurs qu'en mémoire du composant — ni en base, ni dans le navigateur
// (`CLAUDE.md` §11) — et ne touche au champ « Coût par quart » que par le geste « Utiliser ce coût ».

import { Calculator } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import {
	ENTREES_VIDES,
	JOURS_TRAVAILLES_PAR_AN,
	calculerCoutQuart,
	type ChampCalcul,
	type EntreesCalcul,
	type MotifCalcul,
} from '../lib/cout-personnel'

const FORMAT_MONTANT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** La valeur à placer dans « Coût par quart » : virgule décimale, sans séparateur de milliers (le champ la relit). */
export const valeurDeCout = (quart: number) => quart.toFixed(2).replace('.', ',')

const CHAMPS: ReadonlyArray<{ readonly champ: ChampCalcul; readonly libelle: CleTraduction; readonly numerique?: boolean }> = [
	{ champ: 'brut', libelle: 'staffCost.calc.gross' },
	{ champ: 'charges', libelle: 'staffCost.calc.charges' },
	{ champ: 'frais', libelle: 'staffCost.calc.fees' },
	{ champ: 'avantages', libelle: 'staffCost.calc.benefits' },
	{ champ: 'jours', libelle: 'staffCost.calc.days', numerique: true },
]

function motif(champ: ChampCalcul, raison: MotifCalcul): CleTraduction {
	if (raison === 'format') return 'staffCost.calc.invalid.format'
	if (raison === 'entier') return 'staffCost.calc.invalid.integer'
	return champ === 'charges' ? 'staffCost.calc.invalid.percent' : 'staffCost.calc.invalid.days'
}

export function CalculateurCoutQuart({ devise, onUtiliser }: { readonly devise: string; readonly onUtiliser: (valeur: string) => void }) {
	const [ouvert, setOuvert] = useState(false)
	const [entrees, setEntrees] = useState<EntreesCalcul>(ENTREES_VIDES)
	const [utilise, setUtilise] = useState(false)
	const idZone = useId()
	const idChamps = useId()
	const resultat = calculerCoutQuart(entrees)
	const erreurs = resultat.statut === 'invalide' ? resultat.erreurs : {}

	return (
		<div className="basis-full" data-testid="cout-calculateur">
			<Button
				type="button"
				variante="discret"
				taille="compacte"
				aria-expanded={ouvert}
				aria-controls={idZone}
				onClick={() => {
					// Refermer oublie les valeurs (§7.4 bis, point 6).
					if (ouvert) setEntrees(ENTREES_VIDES)
					setUtilise(false)
					setOuvert(!ouvert)
				}}
			>
				<Calculator aria-hidden="true" size={16} />
				{t('staffCost.calc.toggle')}
			</Button>
			{ouvert ? (
				<fieldset id={idZone} className="mt-2 flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
					<legend className="px-1 text-sm font-medium">{t('staffCost.calc.legend')}</legend>
					<div className="flex flex-wrap items-start gap-3">
						{CHAMPS.map(({ champ, libelle, numerique }) => {
							const raison = erreurs[champ]
							const idMotif = `${idChamps}-${champ}`
							return (
								<label key={champ} className="flex w-full flex-col gap-1 text-sm md:w-auto">
									{t(libelle, { devise })}
									<input
										inputMode={numerique === true ? 'numeric' : 'decimal'}
										value={entrees[champ]}
										onChange={(e) => {
											setEntrees({ ...entrees, [champ]: e.target.value })
											setUtilise(false)
										}}
										aria-invalid={raison !== undefined}
										{...(raison === undefined ? {} : { 'aria-describedby': idMotif })}
										data-testid={`cout-calc-${champ}`}
										className={`min-h-[var(--size-target)] w-full rounded-sm bg-surface px-3 text-right tabular-nums md:w-[14ch] ${
											raison === undefined ? 'border border-border' : 'border-2 border-danger'
										}`}
									/>
									{raison === undefined ? null : (
										<span id={idMotif} className="text-[13px] text-danger md:max-w-[14ch]">
											{t(motif(champ, raison))}
										</span>
									)}
								</label>
							)
						})}
					</div>
					<output aria-live="polite" className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="cout-calc-resultat">
						{resultat.statut === 'calcule' ? (
							<>
								<span>{t('staffCost.calc.monthly', { montant: FORMAT_MONTANT.format(resultat.mensuel), devise })}</span>
								<span className="font-medium">{t('staffCost.calc.quarter', { montant: FORMAT_MONTANT.format(resultat.quart), devise })}</span>
							</>
						) : resultat.statut === 'incomplet' ? (
							<span className="text-text-2">{t('staffCost.calc.missingGross')}</span>
						) : null}
					</output>
					<p className="text-[13px] text-text-2">
						{t('staffCost.calc.formula', {
							jours: resultat.statut === 'calcule' ? String(resultat.jours) : entrees.jours.trim() === '' ? String(JOURS_TRAVAILLES_PAR_AN) : entrees.jours,
						})}
					</p>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							type="button"
							variante="secondaire"
							taille="compacte"
							disabled={resultat.statut !== 'calcule'}
							onClick={() => {
								if (resultat.statut !== 'calcule') return
								onUtiliser(valeurDeCout(resultat.quart))
								setUtilise(true)
							}}
							data-testid="cout-calc-utiliser"
						>
							{t('staffCost.calc.use')}
						</Button>
						<span role="status" className="text-[13px] text-success-on-soft">
							{utilise ? t('staffCost.calc.used') : ''}
						</span>
					</div>
				</fieldset>
			) : null}
		</div>
	)
}
