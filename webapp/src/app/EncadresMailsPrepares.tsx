// @spec CRM-128 (docs/BACKLOG.md) — tranche T4 : sur la fiche d'une affaire, un encadré par mail préparé en attente de la
//       personne, avec le lien « Relire et envoyer » vers la relecture de l'inbox — docs/SPEC-mails-prepares.md §6.2 ;
//       docs/DESIGN_SYSTEM.md §5.90 (la carte discrète du §5.4 ter, un lien et non un bouton, §12.1) ; décision 829
//
// AUCUN MAIL PRÉPARÉ, OU UNE LECTURE EN ÉCHEC : RIEN N'EST RENDU (§5.36). La fiche reste entière, et l'inbox porte
// l'entrée « Mails préparés » qui y mène aussi. La RLS ne rend que les mails de la personne : les autres membres ne
// voient rien.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { MailCheck } from 'lucide-react'
import { t } from '../i18n'
import { adresseRelecture, lireMailsPrepares, type MailPrepare } from '../lib/mails-prepares'
import { clientCrm } from '../lib/supabase'

export function EncadresMailsPrepares({ idCard }: { readonly idCard: string }) {
	const [mails, setMails] = useState<readonly MailPrepare[]>([])
	useEffect(() => {
		let vivant = true
		void lireMailsPrepares(clientCrm, idCard).then((etat) => {
			if (vivant) setMails(etat.statut === 'pret' ? etat.donnees : [])
		})
		return () => {
			vivant = false
		}
	}, [idCard])

	if (mails.length === 0) return null
	return (
		<ul className="flex flex-col gap-2" data-testid="fiche-mails-prepares">
			{mails.map((mail) => (
				<li
					key={mail.id}
					className="flex flex-col gap-1 rounded-sm border border-border bg-surface p-3"
					data-testid="fiche-mail-prepare"
				>
					<p className="flex items-center gap-2 font-medium">
						<MailCheck aria-hidden="true" size={16} className="shrink-0 text-brand" />
						{t('mailsPrepares.fiche.titre')}
					</p>
					<p className="text-sm text-text-2 break-words">{mail.destinataires.join(', ')}</p>
					<p className="text-sm text-text-2 break-words">{mail.objet}</p>
					<Link
						to={adresseRelecture(mail.id)}
						aria-label={t('mailsPrepares.fiche.relire.aria', { objet: mail.objet })}
						className="self-start inline-flex items-center min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 text-sm font-medium text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
					>
						{t('mailsPrepares.fiche.relire')}
					</Link>
				</li>
			))}
		</ul>
	)
}
