// @spec CRM-140 (docs/BACKLOG.md) — tranche T3 : le corps d'un message dans le panneau de lecture — le cadre isolé et ses
//       attributs, le bandeau « Afficher les images » qui vaut pour ce message seulement et sa phrase d'état, l'attente des
//       images intégrées, le repli sur le texte, les adresses web d'un corps texte (docs/SPEC-mail-subsystem.md §30.2 à
//       §30.8 ; docs/DESIGN_SYSTEM.md §5.100, §12.7 ; décisions 881 et 918)
//
// LE HTML DE L'EXPÉDITEUR N'ATTEINT JAMAIS LE DOM DE L'ÉCRAN. Il est nettoyé (`nettoyerHtml`), puis servi par `srcdoc` à un
// cadre SANS `allow-scripts` NI `allow-same-origin` : l'origine opaque lui retire cookies, stockage et jeton de session. Le
// composant ne pose aucun `dangerouslySetInnerHTML` — `scripts/verify-mail-inbox.sh` le vérifie sur le code.
//
// LE CHOIX « AFFICHER LES IMAGES » VIT DANS L'ÉTAT DU COMPOSANT, ET NULLE PART AILLEURS (`CLAUDE.md` §11) : le parent le
// monte avec la clé du message, si bien qu'ouvrir un autre message le rend à son premier état.

import { ImageOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import { decouperLiens, documentDuCadre, lireImagesIntegrees, nettoyerHtml } from '../lib/corps-html'
import type { PieceJointe } from '../lib/inbox'
import type { ClientCrm } from '../lib/supabase'

/** Les seuls droits du cadre (§30.3) : un lien ouvre un onglet ORDINAIRE, et rien d'autre n'est permis. */
export const BAC_A_SABLE = 'allow-popups allow-popups-to-escape-sandbox'

const HAUTEUR_CADRE = 'h-[60vh] md:h-[min(70vh,720px)]'

/** Le corps texte, ses adresses `http(s)://` devenues des liens (§30.7). Aucun HTML n'y est injecté. */
export function TexteAvecLiens({ texte }: { readonly texte: string }) {
	return (
		<p data-testid="inbox-corps" className="whitespace-pre-wrap break-words text-ink">
			{texte === ''
				? t('inbox.message.empty.body')
				: decouperLiens(texte).map((morceau, rang) =>
						morceau.type === 'lien' ? (
							<a
								// Le rang suffit : la liste est recalculée en entier à chaque texte, jamais réordonnée.
								key={rang}
								href={morceau.valeur}
								target="_blank"
								rel="noopener noreferrer"
								className="text-brand underline"
							>
								{morceau.valeur}
							</a>
						) : (
							<span key={rang}>{morceau.valeur}</span>
						),
					)}
		</p>
	)
}

export function CorpsMessage({
	html,
	texte,
	pieces,
	client,
}: {
	/** `body_html`, tel que reçu ; `null` ou vide pour un message sans HTML. */
	readonly html: string | null
	/** Le corps texte : `body_text`, ou à défaut le HTML réduit (§18.4) — le repli quand le cadre n'a rien à montrer. */
	readonly texte: string
	readonly pieces: readonly PieceJointe[]
	readonly client: ClientCrm | null
}) {
	const nettoye = useMemo(() => (html === null || html.trim() === '' ? null : nettoyerHtml(html)), [html])
	const [images, setImages] = useState<ReadonlyMap<string, string | null> | null>(() =>
		nettoye === null || nettoye.cids.length === 0 ? new Map() : null,
	)
	const [imagesAffichees, setImagesAffichees] = useState(false)
	const phrase = useRef<HTMLParagraphElement | null>(null)

	useEffect(() => {
		if (nettoye === null || nettoye.cids.length === 0) return
		let vivant = true
		void lireImagesIntegrees(client, nettoye.cids, pieces).then((lues) => {
			if (vivant) setImages(lues)
		})
		return () => {
			vivant = false
		}
	}, [client, nettoye, pieces])

	// LE FOCUS SE POSE SUR LA PHRASE D'ÉTAT : le bouton qui l'avait vient de disparaître (§5.100, §5.13).
	useEffect(() => {
		if (imagesAffichees) phrase.current?.focus()
	}, [imagesAffichees])

	const document_ = useMemo(
		() =>
			nettoye === null || nettoye.vide || images === null
				? null
				: documentDuCadre({ html: nettoye.html, images, imagesAffichees, mentionIndisponible: t('inbox.message.html.cidUnavailable') }),
		[images, imagesAffichees, nettoye],
	)

	// UN HTML ABSENT, OU QUE LE NETTOYAGE VIDE, SE RABAT SUR LE TEXTE (§30.2) : le cadre n'est jamais montré vide.
	if (nettoye === null || nettoye.vide) return <TexteAvecLiens texte={texte} />

	return (
		<div className="flex flex-col gap-3" data-testid="inbox-corps-html">
			{nettoye.imagesDistantes > 0 ? (
				<div data-testid="bandeau-images" className="rounded-sm border border-border bg-surface p-3">
					{imagesAffichees ? (
						<p ref={phrase} role="status" tabIndex={-1} data-testid="images-affichees" className="text-sm text-text-2">
							{t('inbox.message.html.imagesShown')}
						</p>
					) : (
						<div className="flex flex-col items-start gap-2 md:flex-row md:items-center">
							<p className="flex flex-1 items-start gap-2 text-sm text-text-2">
								<ImageOff aria-hidden="true" className="mt-1 size-4 shrink-0" />
								<span>{t('inbox.message.html.imagesBlocked')}</span>
							</p>
							<Button variante="secondaire" taille="compacte" data-testid="afficher-images" onClick={() => setImagesAffichees(true)}>
								{t('inbox.message.html.showImages')}
							</Button>
						</div>
					)}
				</div>
			) : null}

			{document_ === null ? (
				<div
					role="status"
					aria-label={t('inbox.message.html.preparing')}
					data-testid="corps-preparation"
					className={`${HAUTEUR_CADRE} w-full animate-pulse rounded-sm bg-hover`}
				/>
			) : (
				<iframe
					data-testid="inbox-corps-cadre"
					title={t('inbox.message.html.frameTitle')}
					sandbox={BAC_A_SABLE}
					referrerPolicy="no-referrer"
					srcDoc={document_}
					className={`${HAUTEUR_CADRE} w-full rounded-sm border border-border bg-surface`}
				/>
			)}
		</div>
	)
}
