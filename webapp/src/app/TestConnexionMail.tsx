// @spec CRM-127 (docs/BACKLOG.md) — tranche T4 : « Tester la connexion » sur chaque ligne des comptes entrants et des
//       identités sortantes, son vol, son verdict et ses refus traduits
// @spec docs/SPEC-mail-subsystem.md §23.5 (l'écran), §23.4 (les codes de la fonction edge), §13.7 (le dictionnaire fermé
//       des incidents) ; docs/DESIGN_SYSTEM.md §5.93 (cette commande), §5.34 et §5.35 (les lignes qui la portent), §5.59
//       (la capacité d'écrire la ligne), §5.52 (le focus d'un élément qui se réactive) ; CLAUDE.md §10 (la base décide)
//
// Composant partagé par `ReglagesComptesMail` et `ReglagesIdentitesMail` : les deux lignes portent le même geste, et deux
// écrans qui le portent le portent de la même façon. Le verdict dit ce qui vient de se passer ; la pilule de la ligne,
// relue en base par l'écran, dit ce que la base retient (§23.5).

import { useCallback, useEffect, useRef, useState } from 'react'
import { PlugZap } from 'lucide-react'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import type { ProprietesCommande } from '../lib/capacites'
import {
	accesTestCrm,
	estCodeIncident,
	testerConnexion,
	type AccesTest,
	type CibleTest,
	type CodeIncident,
	type IssueTest,
	type MotifRefusTest,
} from '../lib/test-connexion-mail'

/** Ce que l'écran sait d'une ligne : son test en vol, et la dernière issue reçue. */
export type EtatTestLigne = { readonly enVol: boolean; readonly issue: IssueTest | null }

const REFUS: Readonly<Record<MotifRefusTest, CleTraduction>> = {
	trop_tot: 'admin.mailTest.refusal.tooSoon',
	introuvable: 'admin.mailTest.refusal.notFound',
	desactivee: 'admin.mailTest.refusal.disabled',
	secret_absent: 'admin.mailTest.refusal.secretMissing',
	session: 'admin.mailTest.refusal.session',
	service: 'admin.mailTest.refusal.service',
}

/** Le dictionnaire fermé des six codes (§13.7), le même que l'écran d'état (§20.11.4). */
const INCIDENTS: Readonly<Record<CodeIncident, CleTraduction>> = {
	auth_failed: 'admin.mail.incident.auth_failed',
	host_unreachable: 'admin.mail.incident.host_unreachable',
	connection_refused: 'admin.mail.incident.connection_refused',
	tls_failed: 'admin.mail.incident.tls_failed',
	timeout: 'admin.mail.incident.timeout',
	protocol_error: 'admin.mail.incident.protocol_error',
}

/** L'incident d'une ligne ou d'un verdict, en mots : un code inconnu n'est jamais recopié (§13.7, §23.5). */
export function libelleIncident(code: unknown): string {
	return estCodeIncident(code) ? t(INCIDENTS[code]) : t('admin.mail.incident.unknown')
}

/** La phrase du verdict ou du refus (§23.5). */
export function phraseIssue(issue: IssueTest): string {
	if (issue.type === 'reussi') return t('admin.mailTest.success')
	if (issue.type === 'echoue') {
		return issue.incident === null
			? t('admin.mailTest.failure.unknown')
			: t('admin.mailTest.failure', { incident: libelleIncident(issue.incident) })
	}
	return t(REFUS[issue.motif])
}

/**
 * Les tests de connexion d'un écran, une entrée par ligne.
 *
 * Chaque ligne a son propre vol : tester une boîte n'éteint pas les autres (§23.5). Au retour, `relire` est appelé — la
 * liste est relue en base, sans squelette, et la pilule montre ce que le service a écrit.
 */
export function useTestsConnexion(cible: CibleTest, relire: () => void, acces: AccesTest | null = accesTestCrm) {
	const [etats, setEtats] = useState<Readonly<Record<string, EtatTestLigne>>>({})
	const enVol = useRef(new Set<string>())
	const monte = useRef(true)
	useEffect(() => {
		monte.current = true
		return () => {
			monte.current = false
		}
	}, [])

	const tester = useCallback(
		async (id: string) => {
			if (enVol.current.has(id)) return
			enVol.current.add(id)
			setEtats((precedents) => ({ ...precedents, [id]: { enVol: true, issue: precedents[id]?.issue ?? null } }))
			const issue = await testerConnexion(acces, cible, id)
			enVol.current.delete(id)
			if (!monte.current) return
			setEtats((precedents) => ({ ...precedents, [id]: { enVol: false, issue } }))
			relire()
		},
		[acces, cible, relire],
	)

	return { etats, tester }
}

/**
 * La commande de la ligne (§5.93) : discrète compacte, avant « Configurer », avec les propriétés de capacité de
 * « Configurer ». Pendant le vol, elle est désactivée, porte `aria-busy` et dit « Test en cours… » ; elle reprend le
 * focus en se réactivant si elle l'avait au moment du clic (un bouton désactivé le perd, §5.52).
 */
export function CommandeTestConnexion({
	nomLigne,
	etat,
	commande,
	classes,
	onTester,
}: {
	/** Ce que la ligne nomme : le libellé de la boîte, ou l'adresse de l'identité. */
	readonly nomLigne: string
	readonly etat: EtatTestLigne | undefined
	/** Les propriétés de « Configurer » sur la même ligne : le droit de tester est celui d'écrire (§23.3). */
	readonly commande: ProprietesCommande
	readonly classes: string
	readonly onTester: () => void
}) {
	const bouton = useRef<HTMLButtonElement | null>(null)
	const focusARendre = useRef(false)
	const vol = etat?.enVol === true

	useEffect(() => {
		if (vol || !focusARendre.current) return
		focusARendre.current = false
		bouton.current?.focus()
	}, [vol])

	return (
		<button
			ref={bouton}
			type="button"
			data-testid="tester-connexion"
			{...commande}
			disabled={commande.disabled === true || vol}
			aria-busy={vol || undefined}
			onClick={() => {
				focusARendre.current = document.activeElement === bouton.current
				onTester()
			}}
			aria-label={vol ? undefined : t('admin.mailTest.command.aria', { ligne: nomLigne })}
			className={classes}
		>
			<PlugZap aria-hidden="true" className="size-4" />
			{vol ? t('admin.mailTest.inFlight') : t('admin.mailTest.command')}
		</button>
	)
}

/**
 * Le verdict sous la ligne, dans une région `role="status"` TOUJOURS RENDUE : une région vivante qui naît avec son texte
 * n'est pas annoncée de façon sûre (§5.93). Vide, elle est `sr-only` — hors du flux, elle n'ajoute pas à la ligne
 * repliée une rangée vide et son écart.
 */
export function VerdictTestConnexion({ etat }: { readonly etat: EtatTestLigne | undefined }) {
	const issue = etat?.issue ?? null
	return (
		<div role="status" data-testid="verdict-test-connexion" className={issue === null ? 'sr-only' : 'basis-full'}>
			{issue === null ? null : issue.type === 'reussi' ? (
				<p className="text-sm text-success-on-soft">{phraseIssue(issue)}</p>
			) : (
				<p className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">{phraseIssue(issue)}</p>
			)}
		</div>
	)
}
