// @spec CRM-007 (docs/BACKLOG.md) — dictionnaire des textes visibles
// @spec CRM-009 (docs/BACKLOG.md) — textes de connexion, session et déconnexion
// @spec CRM-022 (docs/BACKLOG.md) — noms, avatars, responsables, auteurs et acteurs
// @spec CRM-075 (docs/BACKLOG.md) — textes de l'administration de l'arborescence
// @spec docs/DESIGN_SYSTEM.md §5.12, §5.13, §10 ; docs/SPEC-auth.md §9 ; docs/SPEC-webapp.md §10
// @spec docs/SPEC-administration-arborescence.md §9 (chaque refus a son texte)
//
// **Toute** chaîne visible de l'application est ici, et nulle part ailleurs. Les libellés
// métier — tracks, channels, nœuds, champs — sont des **données**, pas des traductions
// (docs/DESIGN_SYSTEM.md §10) : ils n'ont donc pas vocation à rejoindre ce fichier.
//
// Aucune bibliothèque d'internationalisation n'est ajoutée (docs/JOURNAL.md décision 43) :
// une clé inconnue ne compile pas, ce qu'aucun format de messages ne garantit.

export const fr = {
	'app.name': 'P2Enjoy CRM',

	// --- Navigation ---------------------------------------------------------------------
	'nav.aria': 'Navigation principale',
	'nav.sidebar.aria': 'Barre latérale',
	'nav.sidebar.collapse': 'Replier la barre latérale',
	'nav.sidebar.expand': 'Déplier la barre latérale',
	'nav.sidebar.open': 'Ouvrir la navigation',
	'nav.sidebar.close': 'Fermer la navigation',
	'nav.section.tracks': 'Tracks',
	'nav.item.board': 'Board',
	'nav.item.inbox': 'Inbox',
	'nav.item.contacts': 'Contacts',
	'nav.item.goals': 'Objectifs',
	'nav.item.costs': 'Coûts',
	'nav.item.today': 'Ma journée',
	'nav.item.stalled': 'Affaires figées',
	'nav.item.settings': 'Réglages',

	'skip.toContent': 'Aller au contenu',

	// --- En-tête ------------------------------------------------------------------------
	'header.aria': "En-tête de l'application",
	'header.breadcrumb.aria': "Fil d'Ariane",
	'header.workspace.unknown': 'Aucun workspace accessible',
	'header.workspace.loading': 'Chargement du workspace',
	'header.auth.login': 'Se connecter',
	'header.auth.logout': 'Se déconnecter',
	'header.auth.logout.error': "La déconnexion n'a pas abouti. Réessayez.",

	// --- Cloche et panneau de notifications — CRM-064 tranche 3a -------------------------------
	// docs/SPEC-notifications.md §26 ; docs/DESIGN_SYSTEM.md §5.43.
	//
	// LE NOM ACCESSIBLE DE LA CLOCHE PORTE LE COMPTE EXACT, jamais la forme tronquée « 99+ » :
	// un chiffre dessiné sur une icône n'existe pas pour un lecteur d'écran (§5.43). L'accord se
	// fait par CLÉ et jamais par un gabarit paramétré — « 1 notifications » est faux (§10).
	'notifications.bell.none': 'Notifications — aucune non lue',
	'notifications.bell.one': 'Notifications — 1 non lue',
	'notifications.bell.many': 'Notifications — {compte} non lues',
	'notifications.bell.unknown': 'Notifications',
	'notifications.panel.aria': 'Vos notifications',
	'notifications.panel.title': 'Notifications',
	'notifications.panel.close': 'Fermer les notifications',
	'notifications.loading': 'Chargement de vos notifications',
	'notifications.empty': 'Aucune notification.',
	'notifications.empty.body': 'Vous serez prévenu ici lorsqu’on vous mentionnera dans une affaire.',
	'notifications.error.title': 'Notifications indisponibles',
	'notifications.error.body': 'Vos notifications n’ont pas pu être lues.',
	'notifications.error.retry': 'Réessayer',
	// LA TRONCATURE EST ÉCRITE, jamais laissée à deviner (§26.5, §5.43).
	'notifications.truncated': 'Les {compte} plus récentes.',
	// LE PROPOS N'EST PAS RENDU quand il n'est plus lisible : la ligne garde sa place, son affaire
	// et son lien, et ne dit NI que le propos a été supprimé NI qu'il est illisible (§24.3).
	'notifications.mention.author': '{auteur} vous a mentionné',
	'notifications.mention.anonymous': 'Vous avez été mentionné',
	'notifications.item.open': 'Ouvrir {affaire}',
	'notifications.item.markRead': 'Marquer comme lue',
	'notifications.item.markUnread': 'Marquer comme non lue',
	// AUCUNE CLÉ « Non lue » : l'état de lecture est porté par le liseré du §5.43 ET par le nom
	// accessible des deux commandes ci-dessus, qui disent lequel des deux gestes elles portent. Une
	// troisième formulation du même fait divergerait au premier ajustement, et le contrôle de clés
	// mortes de ce dictionnaire l'a d'ailleurs dénoncée avant qu'elle ne soit rendue.
	// L'ISSUE « SANS EFFET » EST DITE, et elle n'affirme ni le refus ni la disparition — les deux
	// sont indistinguables (§26.4, docs/DESIGN_SYSTEM.md §5.40).
	'notifications.mark.noEffect':
		'Aucune notification n’a été modifiée. Vos droits ont peut-être changé depuis l’ouverture : rechargez la page.',
	'notifications.mark.error': 'La notification n’a pas pu être modifiée.',
	'identity.owner.aria': 'Responsable : {nom}',

	// --- Authentification ---------------------------------------------------------------
	'auth.route.title': 'Se connecter',
	'auth.intro': "L'accès est réservé aux membres invités de votre espace de travail.",
	'auth.email.label': 'Adresse email',
	'auth.email.placeholder': 'prenom@entreprise.fr',
	'auth.password.label': 'Mot de passe',
	'auth.submit': 'Se connecter',
	'auth.submitting': 'Connexion…',
	'auth.error.credentials': "L'adresse email ou le mot de passe est incorrect.",
	'auth.error.network': "Le serveur n'a pas répondu. Vérifiez votre connexion, puis réessayez.",
	'auth.error.configuration': "L'application n'est pas configurée pour joindre le serveur.",
	'auth.loading': 'Restauration de votre session',

	// --- Onglets ------------------------------------------------------------------------
	'tabs.aria': 'Channels du track courant',
	'tabs.empty': 'Aucun channel',
	'tabs.empty.hint': 'Les channels apparaîtront ici une fois un track ouvert.',

	// --- Tracks -------------------------------------------------------------------------
	// Les libellés des tracks eux-mêmes sont des **données** et ne passent pas par ce
	// dictionnaire (docs/DESIGN_SYSTEM.md §10). Seul le vide est un texte d'interface.
	'tracks.empty.title': 'Aucun track',

	// --- Routes -------------------------------------------------------------------------
	'route.board.title': 'Board',
	'route.board.empty.title': 'Aucun board à afficher',
	// Corrigé par `CRM-020`, sur observation d'une capture. Le texte précédent affirmait
	// « Aucun track n'est accessible » alors que la barre latérale en listait trois : l'écran se
	// contredisait lui-même. Ce qui manque réellement pour ouvrir un board, ce sont les channels.
	'route.board.empty.body':
		"Un board affiche les cards d'un channel. Aucun channel n'est disponible dans cet espace de travail.",
	'route.inbox.title': 'Inbox',
	// L'état vide « la messagerie n'est pas encore raccordée » de `CRM-007` est RETIRÉ : il ne
	// décrivait plus rien depuis que `CRM-057` livre l'écran, et une clé qui ment est pire qu'une
	// clé absente. Les états vides de l'inbox sont désormais ceux de chaque panneau.

	// --- Inbox globale — CRM-057, docs/DESIGN_SYSTEM.md §5.4 -----------------------------
	'inbox.folders.aria': 'Dossiers de la messagerie',
	'inbox.folders.title': 'Dossiers',
	'inbox.folders.unclassified': 'Non classés',
	'inbox.folders.empty.title': 'Aucun courrier rangé',
	'inbox.folders.empty.body': "Les messages classés dans une affaire apparaîtront ici, sous leur track.",
	'inbox.folders.expand': 'Déplier',
	'inbox.folders.collapse': 'Replier',
	'inbox.list.title': 'Messages',
	'inbox.list.empty.title': 'Aucun message dans ce dossier',
	'inbox.list.empty.body': 'Rien à trier ici pour le moment.',
	'inbox.list.truncated': 'Seuls les 50 messages les plus récents sont affichés.',
	'inbox.list.unselected.title': 'Choisissez un dossier',
	'inbox.list.unselected.body': 'La liste des messages apparaîtra ici.',
	// Le GROUPEMENT en fils — CRM-081 tranche 2 f, docs/SPEC-cards.md §16.16,
	// docs/DESIGN_SYSTEM.md §5.4 bis.
	// LA LISTE ÉNUMÈRE DES FILS, et son nom accessible le dit : « Messages du dossier » décrivait
	// ce qu'elle énumérait avant le groupement, et le laisser aurait fait annoncer des messages là
	// où un lecteur d'écran parcourt des fils.
	'inbox.thread.list.aria': 'Fils du dossier',
	// UNE PHRASE ENTIÈRE EN NOM ACCESSIBLE, jamais le chiffre nu : un « 2 » lu seul ne dit pas ce
	// qu'il compte (docs/DESIGN_SYSTEM.md §5.4 bis). Le badge n'apparaît qu'au-delà de un, donc ce
	// libellé ne se lit jamais au singulier.
	'inbox.thread.count': '{n} messages dans ce fil',
	'inbox.thread.picker.title': 'Messages de ce fil',
	'inbox.thread.picker.aria': 'Choisir un message du fil',
	// Le sommeil d'un FIL dans l'inbox — CRM-081 tranche 2 e, docs/SPEC-cards.md §16.15,
	// docs/DESIGN_SYSTEM.md §5.3 septies.
	// LES MENTIONS NOMMENT LE FIL, ET NON L'AFFAIRE : un même refus se formule d'une seule façon,
	// mais il ne se trompe pas de sujet (§16.15.6).
	'inbox.sleep.filter': 'Afficher les fils en sommeil',
	'inbox.sleep.empty.title': 'Tous les messages de ce dossier sont dans des fils en sommeil',
	'inbox.sleep.empty.body':
		'Cochez « Afficher les fils en sommeil » pour les retrouver, ou choisissez un autre dossier.',
	'inbox.sleep.open': 'Mettre le fil en sommeil',
	'inbox.sleep.wake': 'Réveiller le fil',
	'inbox.sleep.announce.slept': 'Fil mis en sommeil.',
	'inbox.sleep.announce.woken': 'Fil réveillé.',
	// L'issue `refus` n'existe PAS ici, et c'est mesuré : `snooze_thread` n'oppose aucun
	// `forbidden`, aucun droit d'écriture n'étant défini sur un fil (§16.14.4).
	'inbox.sleep.refus.notfound': 'Ce fil n’est plus disponible.',
	'inbox.sleep.refus.required': 'Une échéance est nécessaire.',
	'inbox.sleep.refus.past': 'L’échéance doit être future.',
	'inbox.sleep.refus.network': 'La demande n’a pas abouti : réessayez.',
	'inbox.sleep.refus.unknown': 'La demande a échoué.',
	'inbox.message.title': 'Message',
	'inbox.message.unselected.title': 'Aucun message ouvert',
	'inbox.message.unselected.body': 'Choisissez un message dans la liste pour le lire.',
	'inbox.message.from': 'De',
	'inbox.message.to': 'À',
	'inbox.message.cc': 'Copie',
	'inbox.message.received': 'Reçu le',
	'inbox.message.empty.body': 'Ce message ne comporte aucun texte.',
	// Le corps réduit depuis du HTML est ANNONCÉ : l'utilisateur doit savoir que la mise en forme
	// de l'expéditeur n'est pas affichée, et pourquoi (§18.4).
	'inbox.message.reduced': 'Mise en forme retirée : ce message est affiché en texte seul.',
	'inbox.message.card': 'Classé dans',
	'inbox.message.unclassified': 'Ce message n’est classé dans aucune affaire.',
	'inbox.attachments.title': 'Pièces jointes',
	'inbox.attachments.download': 'Télécharger',
	'inbox.attachments.status.pending': 'en cours d’analyse',
	'inbox.attachments.status.infected': 'écartée par l’antivirus',
	'inbox.attachments.status.skipped': 'non analysée',
	'inbox.attachments.status.unknown': 'statut d’analyse inconnu',
	'inbox.attachments.unavailable': 'Le lien de téléchargement n’a pas pu être obtenu.',
	'inbox.classify.open': 'Classer dans une affaire',
	'inbox.classify.label': 'Affaire de destination',
	'inbox.classify.submit': 'Classer',
	'inbox.classify.cancel': 'Annuler',
	'inbox.classify.working': 'Classement…',
	'inbox.classify.empty': 'Aucune affaire modifiable dans cet espace de travail.',
	'inbox.classify.done': 'Message classé.',
	'inbox.classify.refus.forbidden': 'Vous ne pouvez pas classer ce message dans cette affaire.',
	'inbox.classify.refus.card_indisponible': 'Cette affaire est archivée ou en corbeille : elle ne reçoit pas de courrier.',
	'inbox.classify.refus.network': "Le classement n'a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.",
	'inbox.classify.refus.unknown': "Le classement n'a pas abouti.",
	// --- La SUGGESTION de classement — CRM-060 sous-tranche 2 bis --------------------------
	// docs/SPEC-contacts.md §8.8.5, docs/DESIGN_SYSTEM.md §5.4 ter.
	// LA RÈGLE EST ÉCRITE EN TOUTES LETTRES : la colonne `suggested_card_id` n'est écrite que par
	// la règle 3, et sans cette phrase l'utilisateur lirait un nom d'affaire sans savoir d'où il
	// sort — un indice dont on ignore l'origine ne se confirme pas, il se subit.
	'inbox.suggestion.title': 'Suggestion de classement',
	'inbox.suggestion.rule': 'L’expéditeur est un contact rattaché à cette affaire.',
	'inbox.suggestion.accept': 'Classer dans cette affaire',
	// --- Composition et réponse — CRM-058, docs/SPEC-mail-subsystem.md §19.6 --------------
	'envoi.open': 'Écrire un message',
	'envoi.reply': 'Répondre',
	'envoi.identity': 'Expédier depuis',
	'envoi.identity.empty': "Aucune adresse d'expédition ne vous est attribuée.",
	'envoi.to': 'Destinataires',
	'envoi.to.placeholder': 'adresse@exemple.fr, autre@exemple.fr',
	'envoi.subject': 'Objet',
	'envoi.body': 'Message',
	'envoi.submit': 'Mettre en file',
	'envoi.sending': 'Mise en file…',
	'envoi.cancel': 'Annuler',
	// « MIS EN FILE », ET NON « ENVOYÉ » : le worker n'a pas encore parlé, et annoncer une remise
	// qui n'a pas eu lieu serait une simulation de succès.
	'envoi.file': 'Message mis en file : il partira à la prochaine passe d’envoi.',
	'envoi.file.aria': 'Confirmation d’envoi',
	'envoi.replyto.hint': "Les réponses reviendront dans cette affaire, quelle que soit l'adresse de votre correspondant.",
	'envoi.refus.forbidden': "Vous ne pouvez pas écrire au nom de cette affaire, ou emprunter cette adresse d'expédition.",
	'envoi.refus.invalide': "Cette affaire ne peut pas recevoir de réponse, ou le message n'a pas de destinataire.",
	'envoi.refus.quota': "Cette adresse d'expédition a atteint son plafond du jour.",
	'envoi.refus.network': "Le message n'a pas pu être mis en file. Vérifiez votre connexion, puis réessayez.",
	'envoi.refus.unknown': "Le message n'a pas pu être mis en file.",
	'envoi.refus.incomplet': 'Choisissez une adresse d’expédition, au moins un destinataire, et écrivez un message.',

	'inbox.error.title': 'Messagerie indisponible',
	'inbox.back.folders': 'Retour aux dossiers',
	'inbox.back.list': 'Retour aux messages',
	// --- Carnet de contacts — CRM-060, docs/SPEC-contacts.md §10 ------------------------
	'route.contacts.title': 'Contacts',
	'contacts.aria': 'Carnet de contacts',
	'contacts.table.aria': 'Contacts de l’espace de travail',
	'contacts.table.name': 'Nom',
	'contacts.table.organization': 'Organisation',
	'contacts.table.role': 'Fonction',
	'contacts.table.email': 'Email',
	'contacts.table.phone': 'Téléphone',
	'contacts.empty.title': 'Aucun contact pour le moment',
	'contacts.empty.body':
		'Les personnes avec qui vos affaires se traitent apparaîtront ici, avec leur organisation.',
	'contacts.error.title': 'Le carnet n’a pas pu être chargé',
	'contacts.error.body':
		'La lecture des contacts a échoué. Vérifiez votre connexion, puis réessayez.',
	'contacts.error.retry': 'Réessayer',
	'contacts.noWorkspace.title': 'Aucun espace de travail',
	'contacts.noWorkspace.body':
		'Connectez-vous à un espace de travail pour consulter son carnet de contacts.',

	// --- Création d'un contact — CRM-060 tranche 4e, docs/SPEC-contacts.md §14 ----------
	'contacts.creation.open': 'Nouveau contact',
	'contacts.creation.title': 'Nouveau contact',
	'contacts.creation.name': 'Nom',
	'contacts.creation.organization': 'Organisation',
	'contacts.creation.organization.none': 'Aucune organisation',
	'contacts.creation.organization.loading': 'Chargement…',
	'contacts.creation.organization.error': 'La liste des organisations n’a pas pu être lue.',
	'contacts.creation.organization.retry': 'Relire la liste',
	'contacts.creation.organization.empty':
		'Aucune organisation n’existe encore dans cet espace de travail.',
	'contacts.creation.role': 'Fonction',
	'contacts.creation.email': 'Email',
	'contacts.creation.phone': 'Téléphone',
	'contacts.creation.submit': 'Créer le contact',
	'contacts.creation.cancel': 'Annuler',
	'contacts.creation.nameRequired': 'Le nom est obligatoire.',
	'contacts.creation.refus.interdit':
		'Votre rôle ne permet pas de créer un contact dans cet espace de travail.',
	'contacts.creation.refus.doublon': 'Un contact porte déjà cette adresse email.',
	'contacts.creation.refus.organisation':
		'Cette organisation n’existe plus. Relisez la liste et choisissez-en une autre.',
	'contacts.creation.refus.saisie': 'Une des valeurs saisies n’a pas la forme attendue.',
	'contacts.creation.refus.indisponible': 'Le contact n’a pas pu être créé. Réessayez.',

	// --- Fiche d'organisation — CRM-060 tranche 4b, docs/SPEC-contacts.md §11 -----------
	'organization.route.title': 'Organisation',
	'organization.aria': 'Fiche d’organisation',
	'organization.details.aria': 'Caractéristiques de l’organisation',
	'organization.field.domain': 'Domaine',
	'organization.field.website': 'Site web',
	'organization.website.newTab': 'Ouvre un nouvel onglet',
	'organization.contacts.title': 'Contacts',
	'organization.contacts.aria': 'Contacts de cette organisation',
	'organization.contacts.empty.title': 'Aucun contact rattaché',
	'organization.contacts.empty.body':
		'Aucun contact du carnet n’est rattaché à cette organisation pour le moment.',
	'organization.notFound.title': 'Organisation introuvable',
	'organization.notFound.body':
		'Cette organisation n’existe pas, ou elle ne vous est pas accessible.',
	'organization.notFound.action': 'Revenir au carnet',
	'organization.error.title': 'La fiche n’a pas pu être chargée',
	'organization.error.body':
		'La lecture de l’organisation a échoué. Vérifiez votre connexion, puis réessayez.',
	'organization.error.retry': 'Réessayer',
	'organization.noWorkspace.title': 'Aucun espace de travail',
	'organization.noWorkspace.body':
		'Connectez-vous à un espace de travail pour consulter ses organisations.',

	// --- Fiche d'un contact — CRM-060 tranche 4f, docs/SPEC-contacts.md §15 -------------
	// Le RÔLE d'un rattachement n'est PAS traduit — c'est une valeur métier libre que la base
	// n'énumère pas (§2.3), au même titre qu'un libellé de track.
	'contact.route.title': 'Contact',
	'contact.aria': 'Fiche de contact',
	'contact.details.aria': 'Caractéristiques du contact',
	'contact.field.role': 'Fonction',
	'contact.field.organization': 'Organisation',
	'contact.field.email': 'Email',
	'contact.field.phone': 'Téléphone',
	'contact.deals.title': 'Affaires',
	'contact.deals.aria': 'Affaires de ce contact',
	'contact.deals.table.deal': 'Affaire',
	'contact.deals.table.role': 'Rôle dans l’affaire',
	'contact.deals.table.state': 'État',
	'contact.deals.archived': 'Archivée',
	'contact.deals.empty.title': 'Aucune affaire',
	'contact.deals.empty.body':
		'Ce contact n’est rattaché à aucune affaire qui vous soit accessible.',
	// Sous-tranche 4h — le rattachement d'une affaire depuis la fiche (docs/SPEC-contacts.md §17).
	'contact.attach.action': 'Rattacher à une affaire',
	'contact.attach.deal': 'Affaire',
	'contact.attach.dealPlaceholder': 'Choisir une affaire',
	// La mention d'archivage est un TEXTE dans le libellé de l'option : une `option` native
	// n'admet ni icône ni pilule, et le §1 du design system interdit qu'une couleur porte seule
	// une information (docs/SPEC-contacts.md §17.3, docs/DESIGN_SYSTEM.md §5.26).
	'contact.attach.dealArchived': '{titre} (archivée)',
	'contact.attach.role': 'Rôle dans l’affaire (facultatif)',
	'contact.attach.roleHelp':
		'Par exemple : décideur, prescripteur, contact technique. Laissez vide si vous ne savez pas.',
	'contact.attach.submit': 'Rattacher',
	'contact.attach.cancel': 'Annuler',
	'contact.attach.pending': 'Rattachement…',
	'contact.attach.loading': 'Chargement…',
	'contact.attach.noneAvailable':
		'Aucune affaire accessible à rattacher : soit cet espace de travail n’en contient aucune que vous puissiez lire, soit ce contact est déjà rattaché à toutes.',
	'contact.attach.list.error': 'La liste des affaires n’a pas pu être chargée.',
	'contact.attach.list.retry': 'Réessayer',
	'contact.attach.refus.alreadyAttached':
		'Ce contact est déjà rattaché à cette affaire. Choisissez-en une autre.',
	// Un même texte pour le droit manquant ET pour l'affaire disparue : les deux rendent 403 et
	// sont indistinguables par construction (docs/SPEC-contacts.md §17.4, mesures 9 et 12).
	'contact.attach.refus.forbidden':
		'Le rattachement a été refusé. Vous n’avez peut-être pas le droit de modifier cette affaire, ou elle n’est plus accessible. Rechargez la liste pour voir son état réel.',
	'contact.attach.refus.network':
		'Le rattachement n’a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.',
	'contact.attach.refus.unknown': 'Le rattachement a échoué. Réessayez dans un instant.',
	// Sous-tranche 4i — le détachement d'une affaire depuis la fiche (docs/SPEC-contacts.md §18).
	'contact.detach.column': 'Commandes',
	'contact.detach.action': 'Détacher',
	// LA CONFIRMATION NOMME L'AFFAIRE, ET NON LE CONTACT (docs/SPEC-contacts.md §18.6) : c'est le
	// §12.6 retourné, le contact étant ici le décor — on lit sa fiche — et l'affaire la variable.
	'contact.detach.confirm.title': 'Détacher ce contact de « {titre} » ?',
	'contact.detach.confirm.body':
		'Le rattachement sera retiré, ainsi que le rôle du contact dans cette affaire. Vous pourrez le rattacher de nouveau, mais le rôle devra être ressaisi.',
	'contact.detach.confirm.action': 'Détacher',
	'contact.detach.cancel': 'Annuler',
	'contact.detach.pending': 'Détachement…',
	// LA TROISIÈME ISSUE, QUI N'EST NI UN SUCCÈS NI UNE ERREUR (docs/SPEC-contacts.md §18.3,
	// mesures 2 et 3) : la clause `USING` rend la ligne invisible à l'écriture, et le serveur rend
	// `200` avec zéro ligne, SANS erreur. Le texte n'affirme ni le refus ni la disparition — les
	// deux causes sont indistinguables par construction —, et il dit ce qui est vrai des deux.
	'contact.detach.noeffect':
		'Aucun rattachement n’a été retiré. Vous n’avez peut-être pas le droit de modifier cette affaire, ou le rattachement avait déjà été supprimé.',
	'contact.detach.refus.forbidden':
		'Le détachement a été refusé. Rechargez la fiche pour voir son état réel.',
	'contact.detach.refus.network':
		'Le détachement n’a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.',
	'contact.detach.refus.unknown': 'Le détachement a échoué. Réessayez dans un instant.',
	// Tranche 6 — la SUPPRESSION d'un contact depuis sa fiche (docs/SPEC-contacts.md §20).
	'contact.delete.action': 'Supprimer',
	// LA CONFIRMATION NOMME LE CONTACT (docs/SPEC-contacts.md §20.6) : c'est le §18.6 retourné,
	// puisque c'est le contact lui-même que l'on retire, et non son lien avec une affaire.
	'contact.delete.confirm.title': 'Supprimer « {nom} » ?',
	// CONSÉQUENCE 1 — CE QUE LE GESTE EMPORTE, mesuré le 2026-08-26 (§20.2, mesure 7) : la
	// suppression cascade sur `card_contacts`, et le trigger de la migration 0061 écrit
	// `contact_unlinked` dans le fil de chaque affaire encore vivante. C'est la seule conséquence
	// que l'utilisateur ne peut PAS lire sur l'écran qu'il regarde. Deux clés et non une
	// concaténation (`CLAUDE.md` §23) : le moteur de traduction n'a délibérément aucune règle de
	// pluriel, et l'ordre des mots du français ne doit pas se figer dans du JSX.
	'contact.delete.confirm.deals.one':
		'Ce contact est rattaché à 1 affaire. Le rattachement sera retiré, et l’affaire gardera dans son historique la trace de ce détachement.',
	'contact.delete.confirm.deals.many':
		'Ce contact est rattaché à {compte} affaires. Les rattachements seront retirés, et chaque affaire gardera dans son historique la trace de ce détachement.',
	// CONSÉQUENCE 2 — CE QUE LE GESTE NE DÉTRUIT PAS (décision 516, §20.2 mesure 9). Propriété
	// rassurante et contre-intuitive : la taire laisserait croire à une purge.
	'contact.delete.confirm.values':
		'Les formulaires d’affaires qui désignent ce contact conservent leur valeur : ils afficheront une référence inconnue plutôt qu’un champ vidé.',
	'contact.delete.confirm.action': 'Supprimer définitivement',
	'contact.delete.cancel': 'Annuler',
	'contact.delete.pending': 'Suppression…',
	// LA TROISIÈME ISSUE, QUI N'EST NI UN SUCCÈS NI UNE ERREUR (§20.2, mesures 3 et 5) : la clause
	// `USING` rend la ligne invisible à l'écriture, et le serveur rend `200` avec zéro ligne, SANS
	// erreur. Le texte n'affirme ni le refus ni la disparition — les deux causes sont
	// indistinguables par construction —, et il dit ce qui est vrai des deux.
	'contact.delete.noeffect':
		'Aucun contact n’a été supprimé. Vous n’avez peut-être pas le droit de supprimer ce contact, ou il avait déjà été supprimé. La fiche a été relue.',
	'contact.delete.refus.forbidden':
		'La suppression a été refusée. Rechargez la fiche pour voir son état réel.',
	'contact.delete.refus.unavailable': 'La suppression a échoué. Réessayez dans un instant.',
	// Sous-tranche 4j — la modification du rôle d'un rattachement (docs/SPEC-contacts.md §19).
	'contact.role.action': 'Modifier le rôle',
	// LE FORMULAIRE NOMME L'AFFAIRE (docs/SPEC-contacts.md §19.6) : sur cette page le contact est
	// le décor et l'affaire varie, et un formulaire ouvert sous une ligne d'un tableau qui défile
	// ne dirait plus quel rattachement il modifie.
	'contact.role.title': 'Rôle dans « {titre} »',
	'contact.role.field': 'Rôle',
	// VIDER LE CHAMP EFFACE LE RÔLE, et c'est MESURÉ (§19.3, mesure 9) : la base accepte `null`.
	// Le §6 du design system exige qu'un geste dise ce qu'il fait, et celui-ci retire la seule
	// donnée du rattachement sans détruire la ligne.
	'contact.role.help':
		'Par exemple : décideur, prescripteur, contact technique. Videz le champ pour effacer le rôle : le rattachement à l’affaire est conservé.',
	'contact.role.submit': 'Enregistrer le rôle',
	'contact.role.cancel': 'Annuler',
	'contact.role.pending': 'Enregistrement…',
	// LA TROISIÈME ISSUE (docs/SPEC-contacts.md §19.3, mesures 2 et 3) : la clause `USING` de
	// `card_contacts_maj` rend la ligne invisible à l'écriture, et le serveur rend `200` avec zéro
	// ligne, SANS erreur. Le texte n'affirme ni le refus ni la disparition — les deux causes sont
	// indistinguables par construction —, et il dit ce qui est vrai des deux.
	'contact.role.noeffect':
		'Aucun rôle n’a été modifié. Vous n’avez peut-être pas le droit de modifier cette affaire, ou le rattachement n’existe plus.',
	'contact.role.refus.forbidden':
		'La modification a été refusée. Rechargez la fiche pour voir son état réel.',
	'contact.role.refus.network':
		'Le rôle n’a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.',
	// `23514` est ATTEIGNABLE EN BASE et nulle part ailleurs sur cette fiche (§19.5) : la chaîne
	// vide comme la chaîne blanche violent `card_contacts_role_check`. La fonction ne l'émet jamais
	// — elle normalise —, mais lui donner le texte fourre-tout d'`unknown` masquerait une cause
	// connue derrière une erreur générique.
	'contact.role.refus.invalid':
		'Ce rôle n’est pas accepté. Saisissez au moins un caractère, ou videz le champ pour effacer le rôle.',
	'contact.role.refus.unknown': 'La modification du rôle a échoué. Réessayez dans un instant.',
	'contact.notFound.title': 'Contact introuvable',
	'contact.notFound.body': 'Ce contact n’existe pas, ou il ne vous est pas accessible.',
	'contact.notFound.action': 'Revenir au carnet',
	'contact.error.title': 'La fiche n’a pas pu être chargée',
	'contact.error.body':
		'La lecture du contact a échoué. Vérifiez votre connexion, puis réessayez.',
	'contact.error.retry': 'Réessayer',
	'contact.noWorkspace.title': 'Aucun espace de travail',
	'contact.noWorkspace.body':
		'Connectez-vous à un espace de travail pour consulter ses contacts.',

	// --- Modification d'un contact — CRM-060 tranche 4g, docs/SPEC-contacts.md §16 -------
	// Les LIBELLÉS DES CHAMPS ne sont pas redéclarés : ce sont ceux du formulaire de création
	// (`contacts.creation.*`), partagés par `ChampsContact` (§16.2). Seuls le titre, les deux
	// commandes et les six refus appartiennent à ce formulaire-ci.
	//
	// `sansEffet` EST LA CLÉ QUI SÉPARE 4g DE 4e (§16.3, mesures 3, 12 et 19) : un refus
	// d'autorisation, un contact disparu et une ligne devenue invisible rendent tous les trois
	// `200` et zéro ligne, indistinguables par construction. Le message n'affirme donc NI le
	// refus NI la disparition — il dit ce qui est certain, que rien n'a changé, et il invite à
	// relire la fiche.
	'contact.modification.open': 'Modifier',
	'contact.modification.title': 'Modifier le contact',
	'contact.modification.submit': 'Enregistrer',
	'contact.modification.cancel': 'Annuler',
	'contact.modification.refus.sansEffet':
		'Rien n’a été modifié. Vous n’avez peut-être pas le droit de modifier ce contact, ou il n’existe plus. Rechargez la fiche pour voir son état actuel.',
	'contact.modification.refus.doublon': 'Un autre contact porte déjà cette adresse email.',
	'contact.modification.refus.organisation':
		'Cette organisation n’existe plus. Rechargez la liste, puis choisissez-en une autre.',
	'contact.modification.refus.saisie': 'Une des valeurs saisies n’a pas la forme attendue.',
	'contact.modification.refus.interdit':
		'Vous n’avez pas le droit de modifier ce contact.',
	'contact.modification.refus.indisponible':
		'Le contact n’a pas pu être modifié. Réessayez.',

	// --- Contacts d'une affaire — CRM-060 tranche 4c, docs/SPEC-contacts.md §12 ----------
	// Les refus forment un DICTIONNAIRE FERMÉ (§12.5) : le message du serveur n'atteint jamais
	// l'écran. Le rôle d'un rattachement, lui, n'est PAS traduit — c'est une valeur métier libre
	// que la base n'énumère pas (§2.3), au même titre qu'un libellé de track.
	'cardContacts.title': 'Contacts de l’affaire',
	'cardContacts.list.aria': 'Liste des contacts rattachés',
	'cardContacts.empty': 'Aucun contact n’est rattaché à cette affaire.',
	'cardContacts.error.body': 'Les contacts de l’affaire n’ont pas pu être chargés.',
	'cardContacts.error.retry': 'Réessayer',
	'cardContacts.attach.action': 'Rattacher un contact',
	'cardContacts.attach.contact': 'Contact',
	'cardContacts.attach.contactPlaceholder': 'Choisir un contact',
	'cardContacts.attach.role': 'Rôle dans l’affaire (facultatif)',
	'cardContacts.attach.roleHelp':
		'Par exemple : décideur, prescripteur, technique. Laissez vide si le rôle n’est pas connu.',
	'cardContacts.attach.submit': 'Rattacher',
	'cardContacts.attach.cancel': 'Annuler',
	'cardContacts.attach.pending': 'Rattachement…',
	'cardContacts.attach.allAttached':
		'Tous les contacts du carnet sont déjà rattachés à cette affaire.',
	'cardContacts.attach.noContact':
		'Cet espace de travail n’a encore aucun contact. Le carnet se remplira depuis une surface que le produit ne livre pas encore.',
	'cardContacts.detach.action': 'Détacher',
	'cardContacts.detach.confirm.title': 'Détacher {nom} de cette affaire ?',
	'cardContacts.detach.confirm.body':
		'Le rattachement et son rôle sont perdus. Le contact reste au carnet, et peut être rattaché de nouveau.',
	'cardContacts.detach.confirm.action': 'Détacher',
	'cardContacts.detach.cancel': 'Annuler',
	'cardContacts.detach.pending': 'Détachement…',
	'cardContacts.noeffect': 'Aucun rattachement n’a été retiré.',
	'cardContacts.refus.alreadyAttached': 'Ce contact est déjà rattaché à cette affaire.',
	'cardContacts.refus.unknownContact':
		'Ce contact n’existe pas dans cet espace de travail. La liste affichée est peut-être périmée.',
	'cardContacts.refus.forbidden': 'Vous ne pouvez pas modifier cette affaire.',
	'cardContacts.refus.network': 'La requête n’a pas abouti. Vérifiez votre connexion, puis réessayez.',
	'cardContacts.refus.unknown': 'Une erreur inattendue est survenue.',

	// --- Objectifs — CRM-083, docs/SPEC-goals.md §5 --------------------------------------
	// Le canevas ne porte AUCUN texte qui nommerait ce qu'il cache : un bloc masqué par la RLS
	// n'a ni libellé, ni infobulle, ni ligne dédiée (§4.1 et §5.4). Les clés ci-dessous sont
	// donc volontairement muettes sur l'absence — « extrémité hors de portée » ne dit pas
	// qu'un bloc existe, il dit que la flèche ne joint rien de visible.
	'route.goals.title': 'Objectifs',
	'goals.aria': 'Tableaux d’objectifs',
	'goals.list.blocks': '{compte} blocs',
	'goals.list.blocks.one': '1 bloc',
	'goals.list.blocks.none': 'Aucun bloc',
	'goals.noWorkspace.title': 'Aucun espace de travail',
	'goals.noWorkspace.body':
		'Votre compte n’appartient à aucun espace de travail, ou votre session a expiré. Reconnectez-vous pour retrouver vos tableaux d’objectifs.',
	'goals.list.empty.title': 'Aucun tableau d’objectifs',
	'goals.list.empty.body':
		'Un tableau d’objectifs est une surface libre : on y pose des blocs, on les relie, et on indique à la main où chacun en est.',
	'goals.error.title': 'Les objectifs n’ont pas pu être chargés',
	'goals.error.body': 'La requête n’a pas abouti. Vérifiez votre connexion, puis réessayez.',
	'goals.error.retry': 'Réessayer',
	'goals.board.empty.title': 'Aucun objectif sur ce tableau',
	'goals.board.empty.body': 'Posez un premier bloc pour commencer à dessiner vos objectifs.',
	'goals.board.notfound.title': 'Tableau introuvable',
	'goals.board.notfound.body':
		'Aucun tableau d’objectifs de cet espace de travail ne correspond à cette adresse, ou votre compte n’y a pas accès.',
	'goals.canvas.aria': 'Canevas des objectifs',
	'goals.block.fill': 'Remplissage {valeur} %',
	'goals.block.aria': '{titre} — remplissage {valeur} %',
	'goals.block.aria.channel': '{titre} — remplissage {valeur} %, lié à {track} › {channel}',
	'goals.block.link.lost': 'Lien perdu',
	'goals.block.link.lost.hint': 'La destination de ce bloc n’existe plus. Reposez un lien.',
	'goals.block.open': 'Ouvrir le channel lié',
	'goals.diagram.title': 'Liens du diagramme',
	'goals.diagram.aria': 'Équivalent textuel du diagramme',
	'goals.diagram.empty': 'Aucun lien entre les blocs de ce tableau.',
	'goals.diagram.unreachable': 'extrémité hors de portée',
	'goals.diagram.line': '{source} {symbole} {cible}',
	'goals.diagram.line.labelled': '{source} {symbole} {cible} ({libelle})',
	'goals.block.pill': '{track} › {channel}',
	'goals.zoom.in': 'Agrandir le canevas',
	'goals.zoom.out': 'Réduire le canevas',
	'goals.zoom.value': '{valeur} %',
	'goals.back.list': 'Retour aux tableaux',

	// --- Objectifs, tranche 2a : la géométrie — CRM-083, docs/SPEC-goals.md §3 et §5.5 ----
	// AUCUN de ces textes n'anticipe un droit : les commandes sont offertes à tous, et c'est le
	// refus du backend qui est traduit (CLAUDE.md §10, docs/DESIGN_SYSTEM.md §5.26).
	'goals.place.start': 'Poser un bloc',
	'goals.place.cancel': 'Annuler la pose',
	'goals.place.hint':
		'Cliquez sur le canevas pour poser le bloc. Au clavier, déplacez le repère avec les flèches, validez par Entrée, annulez par Échap.',
	'goals.place.marker': 'Repère de pose, position {x} sur {y}',
	'goals.place.title.default': 'Nouvel objectif',
	'goals.block.keyboard.hint':
		'Flèches pour déplacer le bloc, Maj et flèches pour l’ajuster au pixel, Alt et flèches pour le redimensionner, Entrée pour ouvrir sa fiche, Espace pour tracer une flèche vers un autre bloc.',
	'goals.write.saving': 'Enregistrement…',
	'goals.write.saved': 'Enregistré',
	'goals.write.noeffect':
		'Aucune modification n’a été enregistrée. Rechargez le tableau pour voir son état réel.',
	'goals.write.refused.forbidden': 'Vous ne pouvez pas modifier ce tableau.',
	'goals.write.refused.invalid': 'La valeur envoyée a été refusée.',
	'goals.write.refused.unavailable': 'L’enregistrement n’a pas abouti. Réessayez.',

	// --- Objectifs, tranche 2b-1 : le contenu — CRM-083, docs/SPEC-goals.md §3 et §5.5 --------
	// Chaque champ s'enregistre POUR LUI-MÊME (docs/DESIGN_SYSTEM.md §5.7 ter) : la fiche n'a donc
	// aucun libellé de bouton « Enregistrer », et il ne faut pas en ajouter un.
	'goals.edit.title': 'Fiche du bloc « {titre} »',
	'goals.edit.aria': 'Fiche d’édition du bloc',
	'goals.edit.close': 'Fermer la fiche',
	'goals.edit.hint':
		'Chaque champ s’enregistre dès que sa valeur est arrêtée. Échap ferme la fiche.',
	'goals.edit.field.title': 'Titre',
	'goals.edit.field.title.required': 'Le titre est exigé : un bloc sans titre ne se lit pas.',
	'goals.edit.field.body': 'Corps',
	'goals.edit.field.body.hint': 'Facultatif. Deux lignes en sont rendues sur le bloc.',
	'goals.edit.field.color': 'Couleur',
	'goals.edit.field.fill': 'Remplissage',
	'goals.edit.fill.slider': 'Remplissage au curseur',
	'goals.edit.fill.number': 'Remplissage en pourcentage',
	'goals.edit.fill.hint':
		'Vous décidez de ce que ce pourcentage signifie : il n’est jamais calculé à partir des affaires du channel lié.',
	'goals.edit.color.brand': 'Bleu',
	'goals.edit.color.success': 'Vert',
	'goals.edit.color.accent': 'Jaune',
	'goals.edit.color.danger': 'Rouge',
	'goals.edit.color.neutral': 'Gris',

	// --- Objectifs, tranche 2b-2a : le lien vers un channel — CRM-083, docs/SPEC-goals.md §3 ----
	// LE TEXTE N'ANNONCE AUCUN DROIT. Poser un lien exige « app.can_write_channel » et le retirer
	// non (§4.2) : le sélecteur propose donc des destinations que la base refusera parfois, et
	// « goals.edit.link.refused » traduit ce refus SANS prétendre l'avoir prévu.
	'goals.edit.field.link': 'Channel visé',
	'goals.edit.link.none': 'Aucun channel',
	'goals.edit.link.hint':
		'Facultatif. Le bloc désigne le dossier sur lequel porte cet objectif ; le remplissage reste saisi à la main.',
	'goals.edit.link.remove': 'Retirer le lien',
	'goals.edit.link.loading': 'Chargement des channels…',
	'goals.edit.link.error':
		'La liste des channels n’a pas pu être chargée. Le lien existant, lui, reste inchangé.',
	'goals.edit.link.empty': 'Aucun channel à viser.',
	'goals.edit.link.refused.forbidden':
		'Vous ne pouvez pas lier ce bloc à ce channel : lier un objectif à un dossier demande d’y écrire.',

	// --- Objectifs, tranche 2b-2b : les flèches — CRM-083, docs/SPEC-goals.md §2.3, §3 et §5.5 ---
	// LES TROIS DIRECTIONS SONT NOMMÉES EN CLAIR, jamais par le seul symbole : « → » ne se lit pas
	// à haute voix, et une flèche dont la direction ne serait qu'un caractère laisserait un
	// utilisateur au lecteur d'écran choisir entre trois options indistinctes. Les clés sont
	// écrites LITTÉRALEMENT dans le code — une clé construite survit à la suppression de son
	// appelant, et le détecteur de clés mortes a déjà eu raison sur les cinq couleurs.
	'goals.link.start': 'Tracer une flèche',
	'goals.link.cancel': 'Annuler le tracé',
	'goals.link.armed': 'Flèche en cours depuis « {titre} ».',
	'goals.link.hint.start':
		'Choisissez le bloc de départ : cliquez dessus, ou atteignez-le au clavier et appuyez sur Entrée ou Espace.',
	'goals.link.hint':
		'Choisissez un second bloc pour tracer la flèche : cliquez dessus, ou atteignez-le au clavier et appuyez sur Entrée ou Espace. Le bloc de départ, Échap, ou le bouton annulent.',
	'goals.link.direction.legend': 'Direction',
	'goals.link.direction.forward': 'Du départ vers l’arrivée (→)',
	'goals.link.direction.backward': 'De l’arrivée vers le départ (←)',
	'goals.link.direction.both': 'Dans les deux sens (↔)',
	'goals.link.direction.change': 'Direction de la flèche {source} {symbole} {cible}',
	'goals.link.traced': 'Flèche tracée',
	'goals.link.refused.duplicate':
		'Une flèche relie déjà ces deux blocs. Corrigez sa direction dans la liste des liens plutôt que d’en tracer une seconde.',
	'goals.link.refused.forbidden':
		'Vous ne pouvez pas tracer cette flèche : elle demande de pouvoir écrire les deux blocs qu’elle relie.',
	'goals.link.refused.invalid': 'Cette flèche a été refusée : elle ne relie pas deux blocs de ce tableau.',
	'goals.link.refused.unavailable': 'Le tracé n’a pas abouti. Réessayez.',

	// --- Objectifs, tranche 2b-2c : les suppressions — CRM-083, docs/SPEC-goals.md §2.3 et §3 ---
	// CHAQUE CONFIRMATION NOMME CE QU'ELLE DÉTRUIT (`docs/DESIGN_SYSTEM.md` §6), et celle du bloc
	// nomme AUSSI ce qui part avec lui : la cascade du §2.3 emporte ses flèches, et c'est la seule
	// perte que le geste cause au-delà de son objet. Les deux textes sont distincts, comme le §5.27
	// l'exige d'une confirmation qui nomme son objet : « ce bloc » et « cette flèche » n'engagent
	// pas la même chose.
	'goals.block.delete': 'Supprimer le bloc',
	'goals.block.delete.confirm.title': 'Supprimer le bloc « {titre} » ?',
	'goals.block.delete.confirm.body':
		'Le bloc est supprimé définitivement, et les flèches qui le relient à d’autres blocs partent avec lui. Un bloc ne s’archive pas : il n’y a aucune reprise.',
	'goals.block.delete.confirm.body.link':
		'Le bloc est supprimé définitivement, et la flèche qui le relie à un autre bloc part avec lui. Un bloc ne s’archive pas : il n’y a aucune reprise.',
	'goals.block.delete.confirm.body.links':
		'Le bloc est supprimé définitivement, et les {compte} flèches qui le relient à d’autres blocs partent avec lui. Un bloc ne s’archive pas : il n’y a aucune reprise.',
	'goals.block.delete.confirm.action': 'Supprimer définitivement',
	'goals.block.delete.cancel': 'Annuler la suppression',
	'goals.block.deleted': 'Bloc supprimé',
	'goals.link.delete': 'Supprimer la flèche',
	'goals.link.delete.aria': 'Supprimer la flèche {source} {symbole} {cible}',
	'goals.link.delete.confirm': 'Supprimer la flèche {source} {symbole} {cible} ? Elle ne se restaure pas.',
	'goals.link.delete.confirm.action': 'Supprimer',
	'goals.link.delete.cancel': 'Annuler',
	'goals.link.deleted': 'Flèche supprimée',
	'goals.delete.noeffect.block':
		'Aucun bloc n’a été supprimé. Il a peut-être déjà été retiré, ou vous ne pouvez pas l’écrire. Rechargez le tableau.',
	'goals.delete.noeffect.link':
		'Aucune flèche n’a été supprimée. Elle a peut-être déjà été retirée, ou vous ne pouvez pas écrire les deux blocs qu’elle relie. Rechargez le tableau.',
	'goals.delete.refused.block': 'Vous ne pouvez pas supprimer ce bloc.',
	'goals.delete.refused.link':
		'Vous ne pouvez pas supprimer cette flèche : elle demande de pouvoir écrire les deux blocs qu’elle relie.',
	'goals.delete.refused.unavailable': 'La suppression n’a pas abouti. Réessayez.',

	// --- Objectifs, tranche 2c : les tableaux — CRM-083, docs/SPEC-goals.md §2.1, §3 et §5.1 ----
	// L'ARCHIVAGE DIT SA CONSÉQUENCE, et il la dit parce que rien ne la défait : le §5.1 ne décrit
	// qu'une liste des tableaux NON archivés, et aucun écran ne rend un tableau archivé. Le refus de
	// doublon, lui, nomme un cas que seule cette table produit — l'index unique est TOTAL, si bien
	// qu'un tableau archivé retient encore son nom. Taire ce point ferait chercher, dans une liste où
	// il ne paraît plus, le tableau qui bloque.
	'goals.list.title': 'Tableaux d’objectifs',
	'goals.board.create': 'Créer un tableau',
	'goals.board.create.cancel': 'Annuler la création',
	'goals.board.create.title': 'Nouveau tableau d’objectifs',
	'goals.board.create.submit': 'Créer le tableau',
	'goals.board.field.name': 'Nom',
	'goals.board.field.description': 'Description',
	'goals.board.field.description.hint':
		'Facultative. Elle est lue sous le nom du tableau, dans cette liste.',
	'goals.board.form.cancel': 'Annuler',
	'goals.board.created': 'Tableau créé',
	'goals.board.rename': 'Renommer',
	'goals.board.rename.aria': 'Renommer le tableau {nom}',
	'goals.board.rename.title': 'Renommer « {nom} »',
	'goals.board.rename.submit': 'Enregistrer',
	'goals.board.renamed': 'Tableau enregistré',
	'goals.board.move.up': 'Monter',
	'goals.board.move.up.aria': 'Monter le tableau {nom}',
	'goals.board.move.down': 'Descendre',
	'goals.board.move.down.aria': 'Descendre le tableau {nom}',
	'goals.board.moved': 'Ordre enregistré',
	'goals.board.move.impossible':
		'L’ordre n’a pas pu être changé : les positions de ces tableaux ne se distinguent plus.',
	'goals.board.archive': 'Archiver',
	'goals.board.archive.aria': 'Archiver le tableau {nom}',
	'goals.board.archive.confirm.title': 'Archiver « {nom} » ?',
	// RÉVISÉ le 2026-08-28 (CRM-083 tranche 2 h, docs/SPEC-goals.md §5.6) : « aucun écran ne le rend
	// plus » est devenu FAUX le jour où la case « Afficher les archivés » a été posée. Le texte est
	// corrigé plutôt que conservé — une confirmation qui décrit un produit qui n'existe plus est la
	// valeur trompeuse que CLAUDE.md §18 proscrit, et elle dissuaderait d'un geste réversible.
	'goals.board.archive.confirm.body':
		'Le tableau et son travail sont conservés, mais il quitte cette liste. Vous le retrouverez en cochant « Afficher les archivés », et vous pourrez le reprendre. Son nom, lui, reste pris : un tableau archivé le retient.',
	'goals.board.archive.confirm.action': 'Archiver le tableau',
	'goals.board.archive.cancel': 'Annuler',
	'goals.board.archived': 'Tableau archivé',
	'goals.board.showArchived': 'Afficher les archivés',
	'goals.board.archived.mention': 'Archivé',
	'goals.board.unarchive': 'Désarchiver',
	'goals.board.unarchive.aria': 'Désarchiver le tableau {nom}',
	'goals.board.unarchived': 'Tableau désarchivé',
	// LE TEXTE DU SANS-EFFET LUI EST PROPRE, et ce n'est pas un doublon : celui de l'écriture
	// ordinaire invoque « le tableau a peut-être été archivé entre-temps », ce qui est absurde ici —
	// il l'EST, et c'est ce qu'on tente de défaire. Défaut vu à la capture (CLAUDE.md §16).
	'goals.board.unarchive.noeffect':
		'Le tableau n’a pas été repris. Vous ne pouvez pas l’écrire, ou quelqu’un vient de le reprendre avant vous. Rechargez la liste.',
	'goals.board.write.noeffect':
		'Rien n’a été enregistré. Le tableau a peut-être été archivé entre-temps, ou vous ne pouvez pas l’écrire. Rechargez la liste.',
	'goals.board.refused.duplicate':
		'Un tableau de cet espace de travail porte déjà ce nom. Un tableau archivé retient le sien : choisissez-en un autre.',
	'goals.board.refused.forbidden': 'Vous ne pouvez pas administrer les tableaux de cet espace de travail.',
	'goals.board.refused.invalid': 'Le nom est exigé : un tableau sans nom ne se retrouve pas.',

	'route.today.title': 'Ma journée',
	// `CRM-062` tranche 3c — docs/SPEC-relances.md §10.4.
	'route.stalled.title': 'Affaires figées',

	// « Ma journée » — CRM-061, docs/SPEC-cards.md §17, docs/DESIGN_SYSTEM.md §5.36.
	// `route.today.empty.*` a été RETIRÉ : l'écran ne rend plus un état vide inconditionnel, et ses
	// deux vides sont désormais distincts (§17.8). Une clé que rien ne rend est une clé morte.
	'today.aria': 'Ma journée',
	'today.scope.aria': 'Portée de la journée',
	'today.scope.mine': 'Mes affaires',
	'today.scope.all': 'Tout l’espace de travail',
	'today.live.aria': 'Contenu de la journée',
	'today.live.message': '{portee} : {total} affaire(s) à échéance.',
	'today.pill.open': 'Ouvrir {track} › {channel}',
	'today.section.late': 'En retard',
	'today.section.today': 'Aujourd’hui',
	'today.section.upcoming': 'À venir',
	'today.empty.mine.title': 'Aucune échéance dans votre journée',
	'today.empty.mine.body':
		'Aucune affaire dont vous êtes responsable n’a d’échéance en retard, aujourd’hui, ni dans les {jours} prochains jours.',
	'today.empty.mine.action': 'Voir tout l’espace de travail',
	'today.empty.all.title': 'Aucune échéance dans les {jours} prochains jours',
	'today.empty.all.body':
		'Aucune affaire lisible ne porte d’échéance en retard, aujourd’hui, ni dans les jours qui viennent.',
	'today.error.title': 'La journée n’a pas pu être chargée',
	'today.error.body':
		'La liste des échéances n’a pas pu être lue. Vérifiez votre connexion, puis réessayez.',
	'today.error.retry': 'Réessayer',
	// ---------------------------------------------------------------------------------------
	// Affaires figées — `CRM-062` tranche 3c, docs/SPEC-relances.md §10
	// ---------------------------------------------------------------------------------------
	'stalled.aria': 'Affaires figées',
	'stalled.live.aria': 'Contenu des affaires figées',
	'stalled.live.message': '{total} affaire(s) figée(s).',
	// L'unité occupe SON PROPRE ÉLÉMENT à côté du nombre, jamais un nœud de texte accolé (§5.18).
	'stalled.unit.days': 'j',
	'stalled.threshold': 'seuil {seuil} j',
	// Un dossier dont la seconde lecture n'a pas rapporté le nom garde son groupe : le retirer
	// ferait disparaître des affaires en retard de la liste qui existe pour les montrer (§10.5).
	'stalled.group.unknown': 'Dossier non identifié',
	'stalled.pill.open': 'Ouvrir {track} › {channel}',
	// L'ÉTAT VIDE DIT QUE L'ÉTAT EST SAIN, pas qu'il manque quelque chose, et il n'offre AUCUNE
	// action : il n'y a rien à faire d'une liste d'affaires en retard qui est vide (§10.9).
	'stalled.empty.title': 'Aucune affaire figée',
	'stalled.empty.body':
		'Aucune affaire ne dort dans son étape au-delà de son seuil de relance. C’est une bonne nouvelle.',
	'stalled.error.title': 'Les affaires figées n’ont pas pu être chargées',
	'stalled.error.body':
		'La liste n’a pas pu être lue. Réessayez ; si le problème persiste, prévenez un administrateur.',
	'stalled.error.retry': 'Réessayer',
	'stalled.noWorkspace.title': 'Aucun espace de travail',
	'stalled.noWorkspace.body':
		'Aucun espace de travail n’est configuré : il n’y a donc aucune affaire à suivre.',
	'today.noWorkspace.title': 'Aucun espace de travail',
	'today.noWorkspace.body':
		'Aucune configuration d’espace de travail n’est disponible : la journée ne peut pas être lue.',
	'route.settings.title': 'Réglages',
	'route.track.title': 'Track',
	'route.track.notfound.title': 'Track introuvable',
	'route.track.notfound.body':
		"Aucun track de cet espace de travail ne correspond à cette adresse, ou votre compte n'y a pas accès.",
	'route.track.nochannel.title': 'Aucun channel dans ce track',
	'route.track.nochannel.body':
		"Les channels d'un track s'administrent par l'API : aucun écran de création n'est encore livré.",
	'route.track.pickchannel.title': 'Choisissez un channel',
	'route.track.pickchannel.body': 'Les onglets ci-dessus ouvrent les channels de ce track.',
	'route.channel.empty.title': 'Aucune card dans ce channel',
	'route.channel.empty.body':
		"Les affaires s'y créent par l'API : aucun écran de création n'est encore livré.",
	// Le board, LUI, sait combien il en masque : il a lu toutes les cards actives du channel
	// (§16.12.3). Son état vide peut donc affirmer ce que la liste ne peut que suggérer.
	'route.channel.empty.sommeil.title': 'Toutes les affaires de ce channel sont en sommeil',
	'route.channel.empty.sommeil.body':
		'Aucune affaire éveillée ne reste à traiter ici. Affichez les affaires en sommeil pour les retrouver.',
	'route.channel.noworkflow.title': 'Aucun workflow sur ce channel',
	'route.channel.noworkflow.body':
		"Un board a besoin des étapes d'un workflow : ce channel n'en désigne aucun que votre compte puisse lire.",
	'route.channel.nostep.title': 'Ce workflow ne déclare aucune étape',
	'route.channel.nostep.body':
		"Un board sans étape n'a aucune colonne. Les étapes d'un workflow s'administrent par l'API.",
	'route.card.title': 'Card',
	'route.card.notfound.title': 'Card introuvable',
	'route.card.notfound.body':
		"Aucune card ne correspond à cette adresse, ou votre compte n'y a pas accès.",
	'route.card.nostep.title': 'Étape introuvable',
	'route.card.nostep.body':
		"Cette card désigne une étape que votre compte n'a pas le droit de lire : son formulaire ne peut pas être composé.",
	// Les champs d'en-tête de la fiche d'affaire — CRM-040, docs/SPEC-cards.md §15.
	// Les libellés d'affaire — titre, prochaine action — sont des DONNÉES, pas des traductions
	// (docs/DESIGN_SYSTEM.md §10) : seuls les termes de la liste vivent ici.
	'card.header.owner': 'Responsable',
	// « Aucun responsable » est une PHRASE et non une ligne omise (§5.3 bis) : n'avoir personne à
	// qui s'adresser est un fait de l'affaire.
	'card.header.owner.none': 'Aucun responsable',
	'card.header.amount': 'Montant',
	'card.header.nextaction': 'Prochaine action',
	'card.header.archived': 'Archivé',
	'card.header.email.copy': "Copier l'adresse",
	'card.header.email.copied': 'Copié',
	'card.header.email.copy.aria': "Copier l'adresse email de l'affaire",
	// L'explication d'usage est un TEXTE, pas seulement un `title` : une infobulle native
	// n'apparaît ni au clavier, ni au toucher (§15.5).
	'card.header.email.hint':
		"Mettez cette adresse en copie : les messages rejoignent le fil de l'affaire.",
	'card.header.email.unavailable': 'Adresse indisponible',
	// Un bouton qui ne ferait rien en silence serait une simulation de succès (CLAUDE.md §18) :
	// le refus nomme la manœuvre de remplacement.
	'card.header.email.failed':
		"La copie n'a pas abouti : sélectionnez l'adresse pour la copier à la main.",
	// L'ÉCRITURE des six champs d'en-tête — CRM-040, docs/SPEC-cards.md §15 bis,
	// docs/DESIGN_SYSTEM.md §5.3 ter.
	// Mise en sommeil d'une affaire — docs/SPEC-cards.md §16.11, docs/DESIGN_SYSTEM.md §5.3 quater.
	// La pastille porte l'échéance : « jusqu'à quand » est la moitié de l'information.
	'card.sleep.badge': 'En sommeil jusqu’au {echeance}',
	'card.sleep.open': 'Mettre en sommeil',
	'card.sleep.open.aria': 'Mettre cette affaire en sommeil',
	'card.sleep.wake': 'Réveiller',
	'card.sleep.wake.aria': 'Réveiller cette affaire',
	'card.sleep.cancel': 'Annuler',
	'card.sleep.legend': 'Jusqu’à quand ?',
	'card.sleep.preset.demain': 'Demain',
	'card.sleep.preset.troisjours': 'Dans trois jours',
	'card.sleep.preset.semaine': 'La semaine prochaine',
	'card.sleep.preset.mois': 'Le mois prochain',
	'card.sleep.custom': 'Une autre échéance',
	'card.sleep.submit': 'Mettre en sommeil',
	'card.sleep.pending': 'Enregistrement…',
	// Les huit issues du dictionnaire fermé du §16.11.4. Aucune ne prétend savoir ce que le
	// serveur n'a pas dit.
	'card.sleep.refus.required': 'Une échéance est nécessaire.',
	'card.sleep.refus.past': 'L’échéance doit être future.',
	'card.sleep.refus.notfound': 'Cette affaire n’est plus disponible.',
	'card.sleep.refus.forbidden': 'Vous ne pouvez pas modifier cette affaire.',
	'card.sleep.refus.network': 'La demande n’a pas abouti : réessayez.',
	'card.sleep.refus.unknown': 'La demande a échoué.',
	'card.header.edit.open': 'Modifier',
	// Le nom accessible nomme CE QU'ELLE MODIFIE : « Modifier » seul ne dirait pas quoi, hors
	// contexte visuel (§15 bis.9).
	'card.header.edit.open.aria': "Modifier les informations de l'affaire",
	// « Terminer » et non « Enregistrer » : chaque champ a DÉJÀ écrit sa valeur (§5.7 ter), et
	// promettre une écriture qui a eu lieu ferait croire qu'elle restait à faire.
	'card.header.edit.close': 'Terminer',
	'card.header.edit.title': 'Titre',
	'card.header.edit.currency': 'Devise',
	'card.header.edit.deadline': 'Échéance',
	'card.header.edit.owner.none': 'Aucun responsable',
	'card.header.edit.owner.loading': 'Chargement des membres…',
	// Une liste que l'on n'a pas pu lire est NOMMÉE, jamais vide en silence : un sélecteur sans
	// option se lirait comme un workspace sans membre.
	'card.header.edit.owner.failed': "La liste des membres n'a pas pu être lue.",
	'card.header.edit.saving': 'Enregistrement…',
	'card.header.edit.saved': 'Enregistré',
	// LES SIX ISSUES DE REFUS, dictionnaire fermé classé sur le code HTTP et le SQLSTATE
	// (§15 bis.7) — jamais le message du serveur, qui n'est pas un texte pour un humain.
	//
	// « Sans effet » n'est NI un succès NI une erreur : la politique a filtré la ligne avant la
	// mise à jour, et le serveur rend 200 avec zéro ligne. C'est MESURÉ avec le jeton du lecteur.
	'card.header.edit.refus.noeffect':
		"Rien n'a été enregistré : votre compte ne peut pas modifier cette affaire.",
	'card.header.edit.refus.invalid': 'Cette valeur ne convient pas à ce champ.',
	'card.header.edit.refus.notfound':
		"Cette personne n'est plus membre de l'espace de travail : rouvrez la liste.",
	'card.header.edit.refus.forbidden': "L'enregistrement a été refusé.",
	'card.header.edit.refus.network': "La connexion a échoué : réessayez.",
	'card.header.edit.refus.unknown': "L'enregistrement a échoué.",
	// Le geste de mise à la corbeille d'une affaire — CRM-077, docs/SPEC-corbeille.md §4 ter.
	// Le libellé de la commande nomme le GESTE, jamais l'objet : c'est la confirmation qui nomme
	// l'affaire (docs/DESIGN_SYSTEM.md §5.3, §6).
	'card.trash.action': 'Mettre à la corbeille',
	'card.trash.confirm.title': "Mettre l'affaire « {titre} » à la corbeille ?",
	'card.trash.confirm.body':
		"Elle sera retirée du board, de la vue liste et de la recherche sans être supprimée, et se restaure depuis la corbeille.",
	'card.trash.confirm.action': 'Mettre à la corbeille',
	'card.trash.cancel': 'Annuler',
	// « Sans effet » n'est ni un succès ni une erreur (§4 ter.3) : la politique a filtré la ligne
	// avant la mise à jour, et l'écran le dit plutôt que d'annoncer un retrait qui n'a pas eu lieu.
	'card.trash.noeffect': "Aucune modification : votre compte ne peut pas écrire dans cette affaire.",
	'card.trash.refus.forbidden': "Votre compte n'a pas le droit de retirer cette affaire.",
	'card.trash.refus.network': "La requête n'a pas abouti. Réessayer relance le retrait.",
	'card.trash.refus.unknown': "Le retrait a été refusé, sans motif exploitable.",
	'card.trashed.title': 'Affaire mise à la corbeille',
	'card.trashed.body':
		"Elle n'apparaît plus dans le channel et reste restaurable depuis la corbeille, où son nom et la date du retrait sont conservés.",
	'card.trashed.channel': 'Revenir au channel',
	'card.trashed.trash': 'Ouvrir la corbeille',

	'route.notfound.title': 'Page introuvable',
	'route.notfound.body': "Cette adresse ne correspond à aucun écran de l'application.",
	'route.notfound.action': "Revenir à l'accueil",

	// --- Formulaire conditionnel (docs/SPEC-form-composer.md §4) ---------------------------
	'form.title': 'Formulaire de la card',
	'form.step.prefix': 'Étape courante :',
	'form.empty': 'Aucun champ à afficher pour cette étape.',
	'form.required.sr': '(champ requis)',
	'form.required.reason': 'Requis pour passer à',
	'form.missing': "Ce champ est requis et n'est pas renseigné.",
	'form.select.none': '— Aucun choix —',
	'form.other.summary': "Informations d'autres étapes",
	'form.other.readonly': "Ces champs ne sont pas demandés à l'étape courante : ils sont consultables, pas modifiables.",

	// --- Reprise d'un déplacement refusé (docs/SPEC-form-composer.md §4 ter) ---------------
	// L'étape de DESTINATION n'est pas nommée : l'adresse ne la porte pas, et l'inventer serait une
	// invention (§4 ter.5, §4 ter.9).
	'form.demanded': 'Exigé par le déplacement que vous avez demandé',

	// --- Saisie depuis la fiche (docs/SPEC-form-composer.md §4 bis) ------------------------
	'form.save.saving': 'Enregistrement…',
	'form.save.saved': 'Enregistré',
	'form.save.refus.invalid': "Cette valeur ne convient pas au type de ce champ. Elle n'a pas été enregistrée.",
	'form.save.refus.forbidden':
		"Vous n'avez pas le droit d'écrire sur ce channel. La valeur n'a pas été enregistrée.",
	'form.save.refus.network': "La connexion a échoué : la valeur n'a pas été enregistrée. Réessayez.",
	'form.save.refus.unknown': "L'enregistrement a échoué. Réessayez.",

	// --- Sélecteurs de contact et de membre (docs/SPEC-contacts.md §13.5) ------------------
	// `{identifiant}` est un paramètre, jamais une concaténation (CLAUDE.md §23) : une langue qui
	// place son complément avant son verbe doit pouvoir déplacer le marqueur.
	'form.reference.loading': 'Chargement…',
	'form.reference.retry': 'Réessayer',
	'form.reference.unknown': 'Référence inconnue ({identifiant})',
	'form.reference.empty.contact': "Cet espace de travail n'a aucun contact.",
	'form.reference.empty.user': "Cet espace de travail n'a aucun membre.",
	'form.reference.error.contact': "La liste des contacts n'a pas pu être lue.",
	'form.reference.error.user': "La liste des membres n'a pas pu être lue.",

	// --- Board kanban (docs/SPEC-workflow-engine.md §7) ------------------------------------
	'board.aria': 'Board du channel',
	'board.column.empty': 'Aucune affaire à cette étape.',
	'board.age.days': 'j dans cette étape',
	// LE MENU EST CELUI DES ACTIONS DE LA CARTE, PLUS CELUI DE SES SEULS DÉPLACEMENTS
	// (docs/SPEC-cards.md §16.13.1) : il porte le sommeil, donc « Déplacer » ne le nomme plus.
	'board.menu.open': 'Actions',
	'board.menu.section.transitions': 'Déplacer vers',
	'board.menu.section.sommeil': 'Sommeil',
	'board.menu.none': 'Aucun déplacement déclaré depuis cette étape',
	// Clé **paramétrée** : le repli du libellé d'une transition nomme son étape d'arrivée sans que
	// le composant construise la phrase (docs/SPEC-workflow-engine.md §7.5, CLAUDE.md §23).
	'board.transition.fallback': 'Passer à {etape}',
	'board.comment.label': 'Motif exigé pour passer à',
	'board.comment.notstored':
		"Ce motif est exigé pour valider le déplacement. Il n'est pas encore conservé : l'historique des affaires arrive avec les commentaires.",
	'board.comment.submit': 'Déplacer',
	'board.comment.cancel': 'Annuler',
	'board.refusal.dismiss': 'Fermer',
	'board.refusal.fill': 'Renseigner ces champs',
	'board.refusal.card_not_found':
		"Cette affaire n'est plus accessible. Rechargez le board pour voir son état réel.",
	'board.refusal.forbidden': "Votre compte n'a pas le droit d'écrire dans ce channel.",
	'board.refusal.step_not_in_workflow':
		"Cette étape n'appartient pas au workflow de l'affaire.",
	'board.refusal.transition_not_allowed':
		"Ce déplacement n'est pas déclaré dans le workflow de l'affaire.",
	'board.refusal.comment_required': 'Ce déplacement exige un motif.',
	'board.refusal.missing_required_fields':
		"Ces questions doivent avoir une réponse avant d'entrer dans cette étape :",
	'board.refusal.anonyme':
		'Déplacer une affaire exige une session. Connectez-vous, puis réessayez.',
	'board.refusal.unknown': 'Le serveur a refusé ce déplacement sans motif connu de cet écran :',

	// --- Vue liste (docs/SPEC-cards.md §12) ------------------------------------------------
	'liste.aria': 'Affaires du channel',
	'liste.vue.aria': 'Vue du channel',
	'liste.vue.board': 'Tableau',
	'liste.vue.liste': 'Liste',
	'liste.filtres.aria': 'Filtres de la liste',
	'liste.filtre.etape': 'Étape',
	'liste.filtre.etape.toutes': 'Toutes les étapes',
	'liste.filtre.recherche': 'Rechercher une affaire',
	'liste.filtre.recherche.submit': 'Rechercher',
	'liste.filtre.effacer': 'Effacer les filtres',
	// UNE SEULE CLÉ POUR LA CASE ET POUR L'ACTION DES ÉTATS VIDES (§16.12.6) : c'est le même geste,
	// et deux libellés pour un geste unique se mettraient à diverger.
	'sommeil.afficher': 'Afficher les affaires en sommeil',
	'sommeil.barre.aria': 'Affichage des affaires en sommeil',
	'liste.colonne.title': 'Affaire',
	'liste.colonne.owner': 'Responsable',
	'liste.colonne.etape': 'Étape',
	'liste.colonne.amount': 'Montant',
	'liste.colonne.next_action': 'Prochaine action',
	'liste.colonne.next_action_at': 'Échéance',
	// Paramétrée, jamais construite par concaténation (CLAUDE.md §23, décision 180).
	'liste.tri.aria': 'Trier par {colonne}',
	'liste.total': 'Affaires : {total}',
	'liste.page.position': 'Page {rang} sur {pages}',
	'liste.page.precedente': 'Page précédente',
	'liste.page.suivante': 'Page suivante',
	'liste.empty.title': 'Aucune affaire dans ce channel',
	'liste.empty.body':
		"Les affaires s'y créent par l'API : aucun écran de création n'est encore livré.",
	// LE SOMMEIL A SON PROPRE ÉTAT VIDE, et ce n'est pas une nuance de rédaction (§16.12.6) : le
	// défaut masque les affaires endormies, donc « aucune affaire dans ce channel » serait FAUX sur
	// un channel dont toutes les affaires dorment. La liste ne prétend pourtant pas savoir s'il en
	// dort — « aucune affaire éveillée » est vrai dans les deux cas, et un second comptage à chaque
	// page pour les distinguer serait une requête payée sur tous les chargements pour un cas de bord.
	'liste.empty.sommeil.title': 'Aucune affaire éveillée dans ce channel',
	'liste.empty.sommeil.body':
		'Les affaires en sommeil sont masquées par défaut. Affichez-les pour voir si ce channel en porte.',
	'liste.filtered.title': 'Aucune affaire ne correspond',
	'liste.filtered.body':
		'Aucune affaire de ce channel ne répond aux filtres appliqués. Effacez-les pour revoir la liste entière.',
	'liste.gone.title': "Cette page n'existe plus",
	'liste.gone.body':
		"Le nombre d'affaires a diminué depuis l'ouverture de cette page : le rang demandé dépasse désormais la dernière page.",
	'liste.gone.action': 'Revenir à la première page',

	// --- États (docs/DESIGN_SYSTEM.md §5.8) ----------------------------------------------
	'state.loading.aria': 'Chargement en cours',
	'state.error.title': 'Chargement impossible',
	'state.error.network': "Le serveur n'a pas répondu. Vérifiez que l'instance est démarrée, puis réessayez.",
	'state.error.unknown': "Une erreur inattendue s'est produite pendant le chargement.",
	'state.error.retry': 'Réessayer',
	'state.forbidden.title': 'Accès refusé',
	'state.forbidden.body': "Votre compte n'a pas les droits nécessaires sur cette ressource. Demandez l'accès à un administrateur de l'espace de travail.",

	// --- Configuration ------------------------------------------------------------------
	'config.error.title': 'Configuration incomplète',
	'config.error.body':
		"L'application n'a pas reçu l'adresse de l'API ou sa clé publique. Elle ne peut donc joindre aucun serveur.",
	'config.error.detail': 'Variables attendues au build : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.',

	// --- Panneau de commentaires — CRM-043, docs/DESIGN_SYSTEM.md §5.10 ------------------
	'comments.title': 'Historique et discussion',
	'comments.aria': 'Fil de cette affaire',
	'comments.empty.title': 'Aucun événement pour le moment',
	'comments.empty.body': 'Cette affaire n’a encore aucune histoire à raconter.',
	'timeline.filters.aria': 'Filtres du fil',
	'timeline.filter.discussion': 'Discussion',
	'timeline.filter.etapes': 'Étapes',
	'timeline.filter.champs': 'Champs',
	'timeline.filter.organisation': 'Organisation',
	'timeline.filter.cycle': 'Cycle de vie',
	'timeline.filtered.title': 'Aucun élément pour ces filtres',
	'timeline.filtered.body': 'Réactivez une famille pour revoir le fil complet.',
	'timeline.event.created': 'Affaire créée',
	'timeline.event.moved': 'Étape franchie',
	'timeline.event.channel_changed': 'Dossier changé',
	'timeline.event.workflow_changed': 'Workflow modifié',
	'timeline.event.assigned': 'Responsable modifié',
	'timeline.event.archived': 'Affaire archivée',
	'timeline.event.unarchived': 'Affaire désarchivée',
	'timeline.event.trashed': 'Affaire mise à la corbeille',
	'timeline.event.restored': 'Affaire restaurée',
	'timeline.event.field_changed': 'Champ renseigné',
	'timeline.event.mail_received': 'Message reçu',
	// `CRM-058` §19.5 — INC-220. Le type existait en base depuis la migration `0030` et n'avait
	// jamais eu de libellé : neuf lignes du fil se lisaient « Événement ».
	'timeline.event.mail_sent': 'Message envoyé',
	'timeline.event.snoozed': 'Affaire mise en sommeil',
	'timeline.event.woken': 'Affaire réveillée',
	// `CRM-062` tranche 3b — docs/SPEC-relances.md §10.3.1. Le libellé nomme le FAIT, pas la
	// mécanique : « Affaire figée » décrirait un état, or la ligne du fil date un geste. Le mot
	// `stalled` est le vocabulaire de la base, jamais celui de l'écran.
	'timeline.event.stalled': 'Relance automatique',
	// `CRM-060` tranche 5 — docs/SPEC-contacts.md §19.5. Les libellés nomment le GESTE, et le
	// détail porte le nom du contact, résolu à la lecture : le payload n'en porte aucun (§14.6),
	// un nom recopié dans un événement immuable deviendrait faux au premier renommage.
	'timeline.event.contact_linked': 'Contact rattaché',
	'timeline.event.contact_unlinked': 'Contact détaché',
	'timeline.event.contact_role_changed': 'Rôle du contact modifié',
	// Deux formes, et l'accord est POSÉ plutôt que construit par concaténation (§10) : un
	// rattachement sans rôle est légitime — le §12 laisse le rôle libre et facultatif.
	'timeline.contact.avecRole': '{contact} ({role})',
	'timeline.contact.roleChange': '{contact} : {avant} → {apres}',
	'timeline.contact.sansRole': 'aucun rôle',
	// Trois formes, et l'accord est POSÉ plutôt que construit par concaténation (§10). La borne du
	// §2.5 étant large, un retard de zéro est légitime : il se dit autrement, sans quoi « 0 jours
	// de retard » se lirait comme une erreur de calcul.
	'timeline.stalled.days': '{retard} jours de retard, pour un seuil de {seuil} jours',
	'timeline.stalled.oneDay': '1 jour de retard, pour un seuil de {seuil} jours',
	'timeline.stalled.onThreshold': 'atteint son seuil de {seuil} jours',
	'timeline.event.unknown': 'Événement',
	// Le fil nomme le courrier qu'il annonce — un événement qui ne dit pas de quel message il
	// parle n'est pas une mémoire (docs/SPEC-mail-subsystem.md §18.6).
	'timeline.mail.summary': '{objet} — de {expediteur}',
	'comments.error.title': 'Discussion indisponible',
	'comments.deleted': 'Commentaire supprimé',
	'comments.author.deleted': 'Compte supprimé',
	'comments.author.unavailable': 'Auteur indisponible',
	'comments.edited': 'modifié',
	'comments.edited.title': 'Modifié le',
	'comments.compose.label': 'Votre commentaire',
	'comments.compose.placeholder': 'Écrire un commentaire…',
	'comments.compose.submit': 'Publier',
	'comments.compose.sending': 'Publication…',
	'comments.refus.forbidden': "Vous ne pouvez pas commenter cette affaire. Votre texte est conservé ci-dessus.",
	'comments.refus.invalide': 'Un commentaire ne peut être vide ni dépasser 10 000 caractères.',
	'comments.refus.network': "Le commentaire n'a pas pu être envoyé. Vérifiez votre connexion, puis réessayez.",
	'comments.refus.unknown': "Le commentaire n'a pas pu être publié.",
	'comments.refus.supprime': 'Ce commentaire a été supprimé : il ne peut plus être modifié.',
	// Le second `P0001` du trigger, distingué du premier (décision 376). Le message dit ce que
	// l'appelant PEUT faire, et non seulement ce qui lui est refusé : un modérateur bloqué sans
	// autre indication chercherait la panne là où il n'y en a pas.
	'comments.refus.moderation':
		"Le commentaire d'une autre personne ne peut pas être modifié. Vous pouvez seulement le retirer.",
	// Actions de l'auteur — docs/DESIGN_SYSTEM.md §5.10. Le libellé de suppression nomme le
	// caractère irréversible du geste plutôt que de le laisser à la confirmation seule.
	'comments.action.edit': 'Modifier',
	'comments.action.delete': 'Supprimer',
	'comments.edit.label': 'Corriger votre commentaire',
	'comments.edit.save': 'Enregistrer',
	'comments.edit.saving': 'Enregistrement…',
	'comments.edit.cancel': 'Annuler',
	'comments.delete.confirm.title': 'Supprimer ce commentaire ?',
	'comments.delete.confirm.body':
		'Le texte sera définitivement effacé. La place du commentaire reste visible dans le fil.',
	'comments.delete.confirm.action': 'Supprimer définitivement',
	'comments.delete.confirm.cancel': 'Conserver',
	'comments.delete.deleting': 'Suppression…',
	// Modération — docs/DESIGN_SYSTEM.md §5.10, docs/SPEC-cards.md §13.6. Le libellé de l'action est
	// celui de l'auteur : c'est le MÊME geste, et lui inventer un mot de métier — « modérer »,
	// « retirer » — obligerait l'utilisateur à deviner qu'ils désignent la même chose. La
	// confirmation, elle, est DISTINCTE : elle nomme le propriétaire du propos et la trace laissée.
	'comments.moderation.confirm.title': 'Retirer le commentaire d’une autre personne ?',
	'comments.moderation.confirm.body':
		'Le texte sera définitivement effacé et la place du commentaire restera visible dans le fil. '
		+ 'Ce retrait sera enregistré sous votre nom.',
	'comments.moderation.confirm.action': 'Retirer définitivement',
	// La pierre tombale d'un retrait par un tiers, distinguée de celle d'une suppression par
	// l'auteur. Le NOM du modérateur n'est pas nommé — docs/SPEC-cards.md §13.13, point 7.
	'comments.deleted.moderation': 'Commentaire retiré par la modération',
	'comments.geste.sans-effet':
		"Ce commentaire n'est plus le vôtre, ou vous n'écrivez plus sur cette affaire : rien n'a été modifié.",

	// --- Sélecteur de mentions du composeur — `CRM-064` sous-tranche 3b -------------------
	// docs/SPEC-notifications.md §33 à §36, docs/DESIGN_SYSTEM.md §5.44.
	//
	// LE LIBELLÉ DE LA COMMANDE PORTE LE COMPTE, et il est paramétré plutôt que concaténé
	// (`CLAUDE.md` §23) : un auteur qui replie le sélecteur ne saurait plus, sinon, qui son
	// commentaire mentionne. Deux clés et non une, parce que « Mentionner » et « Mentionner
	// (2) » ne sont pas la même phrase avec un morceau optionnel : une langue peut les
	// construire tout autrement.
	'comments.mentions.toggle': 'Mentionner',
	'comments.mentions.toggle.count': 'Mentionner ({compte})',
	'comments.mentions.legend': 'Personnes à prévenir',
	'comments.mentions.loading': 'Chargement des personnes…',
	'comments.mentions.error': 'La liste des personnes n’a pas pu être chargée.',
	'comments.mentions.retry': 'Réessayer',
	// L'ÉTAT VIDE EST UN ÉTAT SAIN, PAS UN MANQUE, et il n'offre aucune action : aucun écran du
	// produit ne donne accès à une affaire, et un bouton y serait un chemin vers nulle part.
	'comments.mentions.empty': 'Personne d’autre ne peut lire cette affaire.',
	// LE REFUS PARTIEL NOMME LES PERSONNES (§35.4). La liste des noms est une DONNÉE, composée
	// par le module et passée en paramètre ; la phrase, elle, reste dans le dictionnaire.
	'comments.mentions.partiel':
		'Votre commentaire est publié, mais {noms} n’a pas pu être mentionné : {cause}',
	'comments.mentions.partiel.pluriel':
		'Votre commentaire est publié, mais ces personnes n’ont pas pu être mentionnées : {noms} — {cause}',
	// Les causes, telles que le §35.4 les traduit. Aucune n'invente de message pour un code
	// inconnu : `unknown` dit ce qu'il sait, c'est-à-dire rien de plus que l'échec.
	'comments.mentions.refus.destinataire-sans-acces':
		'cette personne ne peut pas lire cette affaire.',
	'comments.mentions.refus.commentaire-supprime':
		'ce commentaire a été supprimé et ne reçoit plus de mention.',
	'comments.mentions.refus.commentaire-introuvable': 'ce commentaire est introuvable.',
	'comments.mentions.refus.forbidden': 'vous ne pouvez pas mentionner sur ce commentaire.',
	'comments.mentions.refus.network': 'la mention n’a pas pu être envoyée. Vérifiez votre connexion.',
	'comments.mentions.refus.unknown': 'la mention n’a pas pu être posée.',
	'timeline.actor': 'par {nom}',

	// --- Région d'annonces (docs/DESIGN_SYSTEM.md §8) ------------------------------------
	'live.aria': 'Annonces',
	'live.workspaces.loaded': 'Espaces de travail chargés',
	'live.workspaces.empty': 'Aucun espace de travail accessible',
	'live.workspaces.error': 'Le chargement des espaces de travail a échoué',
	'live.tracks.loaded': 'Tracks chargés',
	'live.tracks.empty': 'Aucun track accessible',
	'live.tracks.error': 'Le chargement des tracks a échoué',
	'live.liste.aria': 'Annonces de la liste',
	'live.liste.loaded': 'Liste des affaires mise à jour',
	'live.board.aria': 'Annonces du board',
	'live.board.moved': 'Affaire déplacée vers',
	'live.board.refused': 'Déplacement refusé',
	// UNE CARTE QUI DISPARAÎT SANS UN MOT MENT À CELUI QUI NE LA VOIT PAS (§16.13.5) : les deux
	// gestes du sommeil empruntent la région du board, ils n'en créent pas une seconde.
	'live.board.snoozed': 'Affaire mise en sommeil jusqu’au {echeance}',
	'live.board.woken': 'Affaire réveillée',
	'live.comments.aria': 'Annonces de la discussion',
	'live.comments.published': 'Commentaire publié',
	'live.comments.edited': 'Commentaire modifié',
	'live.comments.deleted': 'Commentaire supprimé',
	'live.comments.moderated': 'Commentaire retiré',

	// --- Administration de l'arborescence — CRM-075 --------------------------------------
	// docs/SPEC-administration-arborescence.md, docs/DESIGN_SYSTEM.md §5.13.
	'admin.settings.index.title': 'Sections de réglages',
	'admin.settings.index.tree': "Arborescence : tracks et channels",
	'admin.settings.index.tree.body':
		"Créer, renommer, réordonner et archiver les tracks et les channels de l'espace de travail.",
	'admin.settings.index.notifications': 'Notifications : ce que vous recevez',
	'admin.settings.index.notifications.body':
		"Choisir les notifications qui vous parviennent dans l'application. Ce réglage est le vôtre, et personne d'autre ne le voit.",

	// --- Préférences de notification — CRM-064 tranche 4 -----------------------------------
	// docs/SPEC-notifications.md §42 à §46, docs/DESIGN_SYSTEM.md §5.45.
	'settings.notifications.title': 'Notifications',
	'settings.notifications.intro':
		"Décochez ce que vous ne voulez plus voir arriver dans la cloche. Rien n'est supprimé : les notifications continuent d'être conservées, elles sont simplement masquées, et recocher les rend.",
	'settings.notifications.legend': 'Ce que vous recevez dans l\'application',
	'settings.notifications.live': 'État des préférences de notification',
	'settings.notifications.loading': 'Chargement de vos préférences',

	'settings.notifications.type.mention': 'Recevoir les mentions',
	'settings.notifications.type.mention.body':
		"Quand quelqu'un vous nomme dans le commentaire d'une affaire.",

	'settings.notifications.saving': 'Enregistrement…',
	'settings.notifications.saved': 'Enregistré',
	'settings.notifications.saved.on': 'Vous recevrez ces notifications.',
	'settings.notifications.saved.off': 'Ces notifications ne vous seront plus montrées.',

	'settings.notifications.error.title': "Vos préférences n'ont pas pu être chargées",
	'settings.notifications.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'settings.notifications.error.retry': 'Réessayer',

	'settings.notifications.refusal.unknownType':
		"Ce réglage n'existe pas encore sur ce serveur. Rechargez la page ; s'il persiste, l'application est en avance sur sa base.",
	'settings.notifications.refusal.session':
		'Votre session a expiré. Reconnectez-vous pour enregistrer ce réglage.',
	'settings.notifications.refusal.forbidden':
		"Ce réglage n'a pas été accepté. Reconnectez-vous, puis réessayez.",
	'settings.notifications.refusal.network':
		"Le serveur n'a pas répondu. Le réglage n'a pas été enregistré ; réessayez.",
	'settings.notifications.refusal.unknown':
		"Le réglage n'a pas été enregistré, et la cause n'est pas connue. Réessayez.",

	'admin.settings.instance':
		"La configuration de l'instance elle-même reste tenue par le fichier d'environnement du serveur.",

	'admin.tree.title': "Administration de l'arborescence",
	'admin.tree.aria': "Tracks et channels de l'espace de travail",
	'admin.tree.showArchived': 'Afficher les archivés',
	'admin.tree.archived': 'Archivé',
	'admin.tree.channels.aria': 'Channels du track {track}',

	'admin.tree.empty.title': 'Aucun track dans cet espace de travail',
	'admin.tree.empty.body':
		'Un track regroupe des channels, qui portent les affaires. Créez le premier pour commencer.',
	'admin.tree.error.title': "L'arborescence n'a pas pu être chargée",
	'admin.tree.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.tree.error.retry': 'Réessayer',
	'admin.tree.noWorkspace.title': 'Aucun espace de travail accessible',
	'admin.tree.noWorkspace.body':
		"Sans espace de travail, il n'y a pas d'arborescence à administrer.",

	'admin.tree.channels.empty': "Ce track n'a aucun channel.",
	'admin.tree.channels.error': 'Les channels de ce track n’ont pas pu être chargés.',

	// Commandes de ligne.
	'admin.action.expand': 'Déplier {nom}',
	'admin.action.collapse': 'Replier {nom}',
	'admin.action.up': 'Monter {nom}',
	'admin.action.down': 'Descendre {nom}',
	'admin.action.rename': 'Modifier {nom}',
	'admin.action.archive': 'Archiver {nom}',
	'admin.action.unarchive': 'Désarchiver {nom}',
	'admin.action.trash': 'Mettre {nom} à la corbeille',
	'admin.action.newTrack': 'Nouveau track',
	'admin.action.newChannel': 'Nouveau channel',
	'admin.action.save': 'Enregistrer',
	'admin.action.create': 'Créer',
	'admin.action.cancel': 'Annuler',

	'admin.move.disabled.top': 'Déjà en tête de liste',
	'admin.move.disabled.bottom': 'Déjà en fin de liste',
	'admin.move.impossible':
		"Ce déplacement n'aurait aucun effet visible : deux positions voisines sont indistinctes. Le réordonnancement demande une renumérotation, qui n'est pas encore livrée.",

	// Formulaires.
	'admin.form.track.create': 'Nouveau track',
	'admin.form.track.edit': 'Modifier le track',
	'admin.form.channel.create': 'Nouveau channel',
	'admin.form.channel.edit': 'Modifier le channel',
	'admin.form.name': 'Nom',
	'admin.form.slug': 'Slug',
	'admin.form.slug.help': "Identifiant d'URL : minuscules, chiffres et tirets.",
	'admin.form.slug.invalid':
		'Ce slug ne respecte pas la forme attendue : minuscules, chiffres et tirets simples.',
	'admin.form.slug.locked':
		"Le slug ne se modifie pas depuis cet écran : c'est l'adresse partageable du track.",
	'admin.form.color': 'Couleur',
	'admin.form.icon': 'Icône',
	'admin.form.description': 'Description',
	'admin.form.workflow': 'Workflow',
	'admin.form.workflow.choose': 'Choisir un workflow…',
	'admin.form.workflow.default': '{nom} (par défaut)',
	'admin.form.workflow.none':
		"Aucun workflow n'est affectable à ce track. Un channel doit en suivre un ; créez d'abord un workflow global ou propre à ce track.",
	'admin.form.workflow.loading': 'Chargement des workflows…',

	// Confirmation d'archivage (docs/DESIGN_SYSTEM.md §6).
	'admin.archive.confirm.track': 'Archiver le track « {nom} » ?',
	'admin.archive.confirm.channel': 'Archiver le channel « {nom} » ?',
	'admin.archive.confirm.body':
		"Il sera masqué des écrans, sans être supprimé, et pourra être désarchivé. Les channels d'un track archivé ne sont pas archivés avec lui.",
	'admin.archive.confirm.action': 'Archiver',

	// Confirmation de mise à la corbeille — CRM-077, docs/SPEC-corbeille.md §4 bis.3.
	// Elle est DISTINCTE de celle de l'archivage : les deux états sont indépendants (§3.1), et une
	// phrase partagée aurait laissé croire qu'un objet retiré est un objet archivé.
	'admin.trash.confirm.track': 'Mettre le track « {nom} » à la corbeille ?',
	'admin.trash.confirm.channel': 'Mettre le channel « {nom} » à la corbeille ?',
	'admin.trash.confirm.body':
		"Il sera retiré des écrans sans être supprimé, et se restaure depuis la corbeille. Ses enfants ne sont pas mis à la corbeille avec lui : ils deviennent inaccessibles tant qu'il y reste.",
	'admin.trash.confirm.holds': 'Deviennent inaccessibles avec lui :',
	'admin.trash.confirm.holds.none': 'Aucun objet ne devient inaccessible.',
	'admin.trash.confirm.action': 'Mettre à la corbeille',

	// Refus (docs/SPEC-administration-arborescence.md §9).
	'admin.refus.forbidden':
		"Seul un administrateur de cet espace de travail peut modifier l'arborescence.",
	'admin.refus.slug-pris': 'Ce slug est déjà utilisé.',
	'admin.refus.workflow-hors-track': "Ce workflow n'est pas affectable à ce track.",
	'admin.refus.forme-refusee': 'Cette valeur a été refusée : vérifiez le nom et le slug.',
	'admin.refus.reference-absente':
		"Ce track n'existe plus, ou n'appartient pas à cet espace de travail.",
	'admin.refus.network': "La requête n'a pas abouti. Réessayez.",
	'admin.refus.unknown': "L'enregistrement a échoué.",
	'admin.refus.sans-effet':
		"Rien n'a été modifié : vous n'avez plus le droit d'écrire sur cet objet, ou il a disparu.",

	// Administration des budgets d'un track — CRM-084 tranche 2, docs/SPEC-costs.md §4.1.
	// Le bloc vit SOUS l'administration de l'arborescence, dans la ligne du track dépliée : le §4.1
	// s'intitule « Administration des budgets — dans le track », et un budget appartient à un track.
	'admin.budgets.title': 'Budgets',
	'admin.budgets.aria': 'Budgets du track {track}',
	'admin.budgets.showClosed': 'Afficher les budgets clôturés',
	'admin.budgets.empty': 'Aucun budget.',
	'admin.budgets.error': 'Les budgets de ce track n’ont pas pu être chargés.',
	'admin.budgets.column.name': 'Nom',
	'admin.budgets.column.currency': 'Devise',
	'admin.budgets.column.planned': 'Enveloppe',
	'admin.budgets.column.recurrent': 'Récurrent',
	'admin.budgets.column.occurrences': 'Occurrences ouvertes',
	'admin.budgets.column.state': 'État',
	'admin.budgets.column.actions': 'Actions',
	// « Oui » et « non » sont des MOTS, pas une pastille de couleur : le §1 du design system interdit
	// que la couleur porte seule l'information, et une case cochée non modifiable se lirait comme un
	// contrôle éteint.
	'admin.budgets.recurrent.yes': 'Oui',
	'admin.budgets.recurrent.no': 'Non',
	// La colonne des occurrences ne s'applique pas à un budget simple : la cellule reste VIDE
	// (§5.9 — la cellule vide est réservée à une donnée qui n'existe pas pour cette ligne), là où un
	// budget récurrent sans occurrence ouverte affiche « 0 ».
	'admin.budgets.occurrences.loading': '…',
	'admin.budgets.occurrences.failed': 'non mesuré',
	'admin.budgets.state.open': 'Ouvert',
	'admin.budgets.state.closed': 'Clôturé',
	'admin.budgets.action.new': 'Nouveau budget',
	'admin.budgets.action.rename': 'Modifier le budget {nom}',
	'admin.budgets.action.close': 'Clôturer le budget {nom}',
	'admin.budgets.action.reopen': 'Rouvrir le budget {nom}',
	'admin.budgets.form.create': 'Nouveau budget',
	'admin.budgets.form.edit': 'Modifier le budget',
	'admin.budgets.form.name': 'Nom',
	'admin.budgets.form.currency': 'Devise',
	'admin.budgets.form.currency.help': 'Trois lettres majuscules — EUR, CHF, USD.',
	'admin.budgets.form.currency.invalid': 'La devise s’écrit en trois lettres majuscules.',
	'admin.budgets.form.planned': 'Enveloppe (facultative)',
	'admin.budgets.form.planned.help':
		'Laissez vide si l’enveloppe n’est pas décidée. Un montant négatif est accepté.',
	'admin.budgets.form.planned.invalid': 'Ce montant n’est pas un nombre.',
	'admin.budgets.form.recurrent': 'Budget récurrent (porte des occurrences)',
	// Clôture — §4.1. La clôture n'est PAS empêchée, c'est une décision de gestion ; elle n'est pas
	// silencieuse pour autant.
	'admin.budgets.close.confirm': 'Clôturer le budget « {nom} » ?',
	'admin.budgets.close.body':
		'Il sortira de cette table, sans être supprimé, et pourra être rouvert. Son nom redevient disponible pour un nouveau budget — s’il est repris, la réouverture sera refusée.',
	// Le décompte des lignes sans coût réel exigé par le §4.1, MESURÉ dans `card_costs` depuis
	// CRM-085 tranche 1. Quatre phrases et non une : le compte en cours, le compte à zéro, le compte
	// non nul, et l'échec de la mesure. Ranger les deux derniers sous une phrase unique dirait « rien
	// à saisir » là où la lecture a échoué — un mensonge tranquille (CLAUDE.md §18).
	'admin.budgets.close.pending.loading': 'Décompte des lignes sans coût réel en cours…',
	'admin.budgets.close.pending.none':
		'Aucune ligne de coût de ce budget n’attend son coût réel.',
	'admin.budgets.close.pending.some':
		'Ce budget porte {nombre} ligne(s) sans coût réel ; elles resteront saisissables après la clôture.',
	'admin.budgets.close.pending.failed':
		'Les lignes sans coût réel n’ont pas pu être comptées. La clôture reste possible.',
	'admin.budgets.close.action': 'Clôturer',
	// Refus propres aux budgets — ils appellent des gestes différents de ceux de l'arborescence, et
	// les ranger sous les mêmes phrases dirait « vérifiez le slug » là où aucun slug n'existe.
	'admin.budgets.refus.forbidden':
		'Seul un administrateur de cet espace de travail peut gérer les budgets.',
	'admin.budgets.refus.nom-pris':
		'Un budget ouvert de ce track porte déjà ce nom. Un budget clôturé peut l’avoir repris.',
	'admin.budgets.refus.forme-refusee':
		'Cette valeur a été refusée : vérifiez le nom et la devise.',
	'admin.budgets.refus.recurrence-occupee':
		'Ce budget porte des occurrences : supprimez-les avant de le rendre non récurrent.',
	'admin.budgets.refus.reference-absente': 'Ce track n’existe plus.',
	'admin.budgets.refus.network': 'La requête n’a pas abouti. Réessayez.',
	'admin.budgets.refus.unknown': 'L’enregistrement a échoué.',
	'admin.budgets.refus.sans-effet':
		'Rien n’a été modifié : vous n’avez pas le droit d’écrire sur ce budget, ou il a disparu.',

	// Section « Coûts » de la fiche d'affaire — CRM-085 tranche 2, docs/SPEC-costs.md §4.6.
	// Elle vit dans la colonne GAUCHE de la fiche (docs/DESIGN_SYSTEM.md §5.3), entre les contacts
	// et le geste de corbeille : une dépense appartient au dossier de l'affaire, et la colonne
	// droite raconte sans accueillir de geste.
	'card.costs.title': 'Coûts',
	'card.costs.aria': 'Lignes de coût de l’affaire {titre}',
	'card.costs.empty': 'Aucune dépense rattachée à cette affaire.',
	'card.costs.error': 'Les lignes de coût de cette affaire n’ont pas pu être chargées.',
	'card.costs.budgets.error':
		'Les budgets de ce track n’ont pas pu être chargés : le choix d’un budget n’est pas disponible.',
	// État « aucun budget » du §4.7, dit du point de vue de la fiche : ce qui manque ici n'est pas
	// une dépense, c'est l'enveloppe à laquelle la rattacher. Le geste d'en créer une appartient à
	// l'administration du track, jamais à cette section.
	'card.costs.nobudget':
		'Aucun budget ouvert sur le track de cette affaire : une dépense ne peut pas encore y être rattachée.',
	'card.costs.column.label': 'Nature',
	'card.costs.column.budget': 'Budget',
	'card.costs.column.occurrence': 'Occurrence',
	'card.costs.column.estimated': 'Estimé',
	'card.costs.column.actual': 'Réel',
	'card.costs.column.actions': 'Actions',
	'card.costs.budget.closed': 'clôturé',
	'card.costs.budget.unknown': 'Budget non lisible',
	// « Non saisi » et non « 0 » : un réel inconnu n'est PAS un réel nul (§2.3). Le tableau porte un
	// tiret cadratin pour l'œil et cette phrase pour le lecteur d'écran.
	'card.costs.actual.unknown': 'Coût réel non saisi',
	'card.costs.action.new': 'Ajouter une dépense',
	'card.costs.action.add': 'Ajouter',
	'card.costs.action.edit': 'Modifier la dépense {nom}',
	'card.costs.action.delete': 'Supprimer la dépense {nom}',
	'card.costs.form.create': 'Nouvelle dépense',
	'card.costs.form.edit': 'Modifier la dépense',
	'card.costs.form.label': 'Nature de la dépense',
	'card.costs.form.label.help': 'Par exemple « Publicité » ou « Production ».',
	'card.costs.form.budget': 'Budget',
	'card.costs.form.budget.none': 'Choisir un budget',
	'card.costs.form.budget.option': '{nom} ({devise})',
	'card.costs.form.occurrence': 'Occurrence',
	'card.costs.form.occurrence.none': 'Choisir une occurrence',
	'card.costs.form.occurrence.help':
		'Ce budget est récurrent : la dépense se rattache à l’une de ses occurrences ouvertes.',
	'card.costs.form.estimated': 'Coût estimé',
	'card.costs.form.estimated.help': 'Obligatoire. Un montant négatif est accepté — avoir, remise.',
	'card.costs.form.actual': 'Coût réel (facultatif)',
	// La distinction du §2.3 est ÉCRITE, pas supposée comprise : c'est le seul endroit où
	// l'utilisateur peut apprendre que vide et zéro ne sont pas la même chose.
	'card.costs.form.actual.help':
		'Laissez vide tant que le réel n’est pas connu. Saisir 0 signifie « rien dépensé », ce qui n’est pas la même chose.',
	'card.costs.form.amount.invalid': 'Ce montant n’est pas un nombre.',
	'card.costs.delete.confirm': 'Supprimer la dépense « {nom} » ?',
	'card.costs.delete.body':
		'La ligne est retirée de cette affaire et de son budget. Ce geste ne se défait pas.',
	'card.costs.delete.action': 'Supprimer',
	// La commande éteinte dit POURQUOI (§5.13) : c'est une propriété de l'objet, pas un droit de
	// l'utilisateur — la base refuse ce geste à tout le monde sur un rattachement clos (§2.3).
	'card.costs.delete.closed':
		'Cette dépense est rattachée à un budget ou à une occurrence clôturés : elle ne peut plus être supprimée. Son coût réel reste saisissable.',
	// Totaux — §4.6, et la mention du §4.4 sans laquelle un réel bas se lirait comme une économie.
	// Les devises ne se mélangent pas (§4.5) : un total par devise présente.
	'card.costs.total': 'Total {devise} — estimé {estime}, réel {reel}',
	'card.costs.pending':
		'{nombre} ligne(s) sans coût réel saisi, pour {estime} {devise} de prévisionnel.',
	'card.costs.refus.forbidden':
		'Vous n’avez pas le droit d’écrire sur cette affaire, ou de lire ce budget.',
	'card.costs.refus.occurrence-exigee':
		'Ce budget est récurrent : choisissez l’occurrence à laquelle rattacher la dépense.',
	'card.costs.refus.occurrence-interdite':
		'Ce budget n’est pas récurrent : une dépense ne s’y rattache à aucune occurrence.',
	'card.costs.refus.occurrence-etrangere': 'Cette occurrence appartient à un autre budget.',
	'card.costs.refus.rattachement-clos':
		'Ce budget ou cette occurrence ont été clôturés : le rattachement ne change plus. Rechargez la fiche pour voir l’état à jour.',
	'card.costs.refus.forme-refusee': 'Cette valeur a été refusée : vérifiez la nature de la dépense.',
	'card.costs.refus.reference-absente':
		'L’affaire, le budget ou l’occurrence n’existent plus. Rechargez la fiche.',
	'card.costs.refus.network': 'La requête n’a pas abouti. Réessayez.',
	'card.costs.refus.unknown': 'L’enregistrement a échoué.',
	'card.costs.refus.sans-effet':
		'Rien n’a été modifié : vous n’avez pas le droit d’écrire sur cette dépense, son budget est clôturé, ou elle a disparu.',

	'live.card.cost.created': 'Dépense ajoutée',
	'live.card.cost.updated': 'Dépense modifiée',
	'live.card.cost.deleted': 'Dépense supprimée',

	'live.admin.budget.created': 'Budget créé',
	'live.admin.budget.updated': 'Budget modifié',
	'live.admin.budget.closed': 'Budget clôturé',
	'live.admin.budget.reopened': 'Budget rouvert',

	'live.admin.aria': "Annonces de l'administration",
	'live.admin.created': 'Créé',
	'live.admin.updated': 'Modifié',
	'live.admin.moved': 'Déplacé',
	'live.admin.archived': 'Archivé',
	'live.admin.unarchived': 'Désarchivé',
	'live.admin.trashed': 'Mis à la corbeille',

	// --- Éditeur de workflows — CRM-076, docs/SPEC-workflow-engine.md §7 bis ---------------
	'admin.settings.index.workflows': 'Workflows : étapes et composition',
	'admin.settings.index.workflows.body':
		"Composer un workflow : choisir ses étapes dans le catalogue, les ordonner, surcharger leur libellé, leur probabilité et leur seuil de relance, désigner l'étape initiale, et déclarer les transitions qui relient les étapes.",
	'admin.workflows.title': 'Éditeur de workflows',
	'admin.workflows.aria': "Workflows de l'espace de travail",
	'admin.workflows.list.aria': 'Choisir un workflow',
	'admin.workflows.steps.aria': 'Étapes de {workflow}',
	'admin.workflows.default': 'Par défaut',
	'admin.workflows.scope.global': 'Global',
	'admin.workflows.scope.track': 'Propre à un track',
	'admin.workflows.empty.title': "Aucun workflow dans cet espace de travail",
	// L'état vide portait « un workflow se crée par l'API » : c'était vrai jusqu'à CRM-031, dont le
	// §3 bis livre le geste ici. Un état vide d'écran d'administration doit porter l'issue qui le
	// comble (docs/DESIGN_SYSTEM.md §5.15), et non renvoyer à un outil que l'administrateur n'a pas.
	'admin.workflows.empty.body':
		"Créez le premier workflow de cet espace de travail : il naîtra sans étape, et cet écran servira à le composer. La copie vers un track reste un geste d'API.",

	// La création d'un workflow — CRM-031, docs/SPEC-workflow-engine.md §3 bis.
	'admin.workflows.create.action': 'Nouveau workflow',
	'admin.workflows.create.title': 'Nouveau workflow',
	'admin.workflows.create.name': 'Nom',
	'admin.workflows.create.scope': 'Portée',
	'admin.workflows.create.scope.global': 'Global',
	'admin.workflows.create.scope.track': 'Propre à un track',
	'admin.workflows.create.scope.help':
		"Un workflow global est disponible pour tous les tracks ; un workflow propre à un track n'est proposé qu'aux channels de ce track.",
	'admin.workflows.create.track': 'Track',
	'admin.workflows.create.track.choose': 'Choisir un track…',
	'admin.workflows.create.track.loading': 'Chargement des tracks…',
	'admin.workflows.create.track.none':
		"Aucun track n'existe encore dans cet espace de travail. Un workflow propre à un track en demande un ; créez-le depuis l'administration de l'arborescence.",
	'admin.workflows.create.track.error': 'Les tracks n’ont pas pu être chargés.',
	'admin.workflows.create.empty':
		"Il naîtra sans étape : ajoutez-les ensuite depuis cet écran, et désignez celle par laquelle une affaire commence.",
	'admin.workflows.create.done': 'Le workflow « {nom} » est créé. Il n’a encore aucune étape.',
	'admin.workflows.refus.creation.forbidden':
		"Vous n'avez pas le droit de créer un workflow dans cet espace de travail.",
	'admin.workflows.refus.creation.forme-refusee':
		'La base a refusé ces valeurs : un nom ne peut pas être vide, et une portée propre à un track en exige un.',
	'admin.workflows.refus.creation.reference-absente':
		"Le track choisi n'existe plus, ou n'appartient pas à cet espace de travail.",
	'admin.workflows.error.title': "Les workflows n'ont pas pu être chargés",
	'admin.workflows.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.workflows.choose.title': 'Choisissez un workflow',
	'admin.workflows.choose.body': 'Ses étapes apparaîtront ici, dans leur ordre.',
	'admin.workflows.steps.empty': "Ce workflow n'a aucune étape.",
	'admin.workflows.steps.empty.hint':
		"Ajoutez une première étape depuis le catalogue : elle deviendra l'étape initiale si vous la désignez.",
	'admin.workflows.steps.error': 'Les étapes de ce workflow n’ont pas pu être chargées.',
	'admin.workflows.initial': 'Étape initiale',
	'admin.workflows.initial.none':
		"Ce workflow n'a aucune étape initiale : aucune card ne peut y entrer tant qu'elle n'est pas désignée.",
	// La mention de divergence — CRM-032, docs/SPEC-workflow-engine.md §4 bis.4. Trois phrases
	// distinctes plutôt qu'une seule construite par morceaux : le §10 du design system interdit la
	// concaténation, et « la source a changé » n'est pas une variante de « elle n'a pas changé ».
	'admin.workflows.derived.from': 'Ce workflow dérive de « {source} ».',
	'admin.workflows.derived.unchanged': "La source n'a pas changé depuis la copie du {date}.",
	'admin.workflows.derived.changed':
		'La source a changé depuis la copie du {date}. Les modifications ne sont pas reportées automatiquement.',
	'admin.workflows.derived.sourceArchived': 'Cette source est archivée.',
	'admin.workflows.derived.error': "L'origine de ce workflow n'a pas pu être lue.",

	// Le geste « comparer à la source » — CRM-032, docs/SPEC-workflow-engine.md §4 quater.
	// Le libellé du bouton ne change PAS pendant l'appel (§4 quater.4) : une commande qui se renomme
	// sous le doigt fait douter de ce qui a été pressé. C'est la phrase à côté qui porte l'attente.
	'admin.workflows.compareSource.action': 'Comparer à la source',
	'admin.workflows.compareSource.aria': 'Comparer ce workflow à sa source « {source} »',
	'admin.workflows.compareSource.running': 'Comparaison en cours',
	'admin.workflows.compareSource.title': 'Écart avec la source',
	'admin.workflows.compareSource.identical': 'Cette copie est identique à sa source.',
	'admin.workflows.compareSource.summary':
		'{ajouts} ajout(s), {retraits} retrait(s), {modifications} modification(s).',
	// Une collection vide est nommée par la clé du bloc des versions, `…versions.compare.empty` :
	// le rendu des collections est PARTAGÉ entre les deux comparaisons (`CollectionsComparees`), et
	// une seconde phrase pour dire la même chose ferait diverger deux écrans qui doivent se lire
	// pareil. C'est aussi ce qui a fait retirer d'ici une clé jumelle restée sans emploi.
	// L'en-tête non comparé est ÉCRIT, jamais tu (§4 quater.4) : rendre un intitulé « Workflow »
	// toujours vide enseignerait qu'on a regardé et que c'est identique, ce qui est faux.
	'admin.workflows.compareSource.headerExcluded':
		"Le nom, la portée et le track ne sont pas comparés : la copie ne les reprend pas de sa source.",
	'admin.workflows.compareSource.refus.authentification':
		'Cette comparaison demande une session ouverte.',
	'admin.workflows.compareSource.refus.workflow-introuvable':
		"Ce workflow n'est plus lisible. Rechargez l'écran.",
	'admin.workflows.compareSource.refus.workflow-non-derive':
		"Ce workflow n'est la copie d'aucun autre.",
	'admin.workflows.compareSource.refus.source-introuvable':
		"La source de ce workflow n'est plus lisible.",
	'admin.workflows.compareSource.refus.generique': "La comparaison n'a pas abouti.",

	'admin.workflows.overridden': 'Libellé surchargé',
	'admin.workflows.fromCatalog': 'Du catalogue : {libelle}',
	'admin.workflows.probability': 'Probabilité : {valeur} %',
	'admin.workflows.probability.default': 'Probabilité du catalogue',
	'admin.workflows.stale': 'Relance après {valeur} j',
	'admin.workflows.stale.default': 'Seuil du catalogue',

	'admin.workflows.action.add': 'Ajouter une étape',
	'admin.workflows.action.addNode': 'Ajouter {nom}',
	'admin.workflows.action.override': 'Surcharger {nom}',
	'admin.workflows.action.setInitial': 'Désigner {nom} comme étape initiale',
	'admin.workflows.action.remove': 'Retirer {nom}',
	'admin.workflows.catalogue.title': 'Nœuds ajoutables',
	'admin.workflows.catalogue.empty':
		'Tous les nœuds actifs du catalogue sont déjà des étapes de ce workflow.',
	'admin.workflows.catalogue.loading': 'Chargement du catalogue…',
	'admin.workflows.catalogue.error': 'Le catalogue n’a pas pu être chargé.',

	'admin.workflows.form.override': 'Surcharges de {nom}',
	'admin.workflows.form.label': 'Libellé surchargé',
	'admin.workflows.form.label.help':
		'Laisser vide reprend le libellé du catalogue. Une valeur blanche est refusée.',
	'admin.workflows.form.probability': 'Probabilité (%)',
	'admin.workflows.form.probability.help':
		'De 0 à 100. Laisser vide reprend la probabilité du catalogue ; 0 est une valeur, pas une absence.',
	'admin.workflows.form.probability.invalid': 'La probabilité doit être comprise entre 0 et 100.',
	'admin.workflows.form.stale': 'Seuil de relance (jours)',
	'admin.workflows.form.stale.help':
		'Nombre entier de jours, strictement positif. Laisser vide reprend le seuil du catalogue.',
	'admin.workflows.form.stale.invalid':
		'Le seuil de relance doit être un nombre entier de jours strictement positif.',

	'admin.workflows.remove.confirm': 'Retirer l’étape « {nom} » ?',
	'admin.workflows.remove.confirm.body':
		"Elle est retirée du workflow, et le nœud reste au catalogue. Une étape occupée par des cards ne peut pas être retirée : la base le refuse.",
	'admin.workflows.remove.confirm.action': 'Retirer',

	'admin.workflows.refus.forbidden':
		'Seul un administrateur de cet espace de travail peut composer un workflow.',
	'admin.workflows.refus.noeud-deja-employe': 'Ce nœud est déjà une étape de ce workflow.',
	'admin.workflows.refus.etape-occupee':
		"Cette étape porte des affaires : elle ne peut pas être retirée tant qu'elles l'occupent.",
	'admin.workflows.refus.reference-absente':
		"Ce workflow ou ce nœud n'existe plus, ou n'appartient pas à cet espace de travail.",
	'admin.workflows.refus.forme-refusee':
		'Cette valeur a été refusée : vérifiez le libellé, la probabilité et le seuil.',
	'admin.workflows.refus.network': "La requête n'a pas abouti. Réessayez.",
	'admin.workflows.refus.unknown': "L'enregistrement a échoué.",

	// --- Les arêtes du graphe — deuxième tranche, docs/SPEC-workflow-engine.md §7 bis.9 -----
	'admin.workflows.transitions.aria': 'Transitions de {workflow}',
	'admin.workflows.transitions.title': 'Transitions déclarées',
	'admin.workflows.transitions.intro':
		"Une card ne peut aller que là où une transition la mène. Une étape sans sortie est un point d'arrivée.",
	'admin.workflows.transitions.loading': 'Chargement des transitions…',
	'admin.workflows.transitions.error': 'Les transitions de ce workflow n’ont pas pu être chargées.',
	'admin.workflows.transitions.none': 'Aucune sortie : les cards s’y arrêtent.',
	'admin.workflows.transitions.toward': 'Vers {arrivee}',
	'admin.workflows.transitions.label.default': 'Libellé de l’étape d’arrivée',
	'admin.workflows.transitions.requireComment': 'Motif exigé',
	'admin.workflows.transitions.tooFewSteps':
		'Une transition relie deux étapes : ajoutez-en une seconde avant d’en déclarer une.',

	'admin.workflows.transitions.action.declare': 'Déclarer une transition',
	'admin.workflows.transitions.action.edit': 'Modifier la transition {depart} vers {arrivee}',
	'admin.workflows.transitions.action.remove': 'Retirer la transition {depart} vers {arrivee}',

	'admin.workflows.transitions.form.declare': 'Nouvelle transition',
	'admin.workflows.transitions.form.edit': 'Transition {depart} vers {arrivee}',
	'admin.workflows.transitions.form.from': 'Étape de départ',
	'admin.workflows.transitions.form.to': 'Étape d’arrivée',
	'admin.workflows.transitions.form.to.empty':
		'Toutes les arrivées possibles depuis cette étape sont déjà déclarées.',
	'admin.workflows.transitions.form.label': 'Libellé du bouton',
	'admin.workflows.transitions.form.label.help':
		'Laisser vide affiche le libellé de l’étape d’arrivée dans le menu d’une card. Une valeur blanche est refusée.',
	'admin.workflows.transitions.form.label.invalid': 'Le libellé ne peut pas être blanc.',
	'admin.workflows.transitions.form.requireComment': 'Exiger un motif',
	'admin.workflows.transitions.form.requireComment.help':
		'Le déplacement d’une card par cette transition sera refusé sans commentaire.',

	'admin.workflows.transitions.remove.confirm': 'Retirer la transition {depart} vers {arrivee} ?',
	'admin.workflows.transitions.remove.confirm.body':
		'Les cards ne pourront plus emprunter ce chemin. Les deux étapes restent dans le workflow.',
	'admin.workflows.transitions.remove.confirm.action': 'Retirer la transition',

	'admin.workflows.refus.arete-deja-declaree': 'Cette transition est déjà déclarée.',
	'admin.workflows.refus.transition.reference-absente':
		'Une des deux étapes n’existe plus dans ce workflow.',
	'admin.workflows.refus.transition.forme-refusee':
		'Cette transition a été refusée : une étape ne va pas vers elle-même, et un libellé fourni ne peut pas être blanc.',
	'admin.workflows.refus.sans-effet':
		"Rien n'a été modifié : vous n'avez plus le droit d'écrire sur ce workflow, ou l'étape a disparu.",

	'live.workflows.added': 'Étape ajoutée',
	'live.workflows.moved': 'Étape déplacée',
	'live.workflows.overridden': 'Surcharges enregistrées',
	'live.workflows.initial': 'Étape initiale désignée',
	'live.workflows.removed': 'Étape retirée',
	'live.workflows.transition.declared': 'Transition déclarée',
	'live.workflows.transition.updated': 'Transition modifiée',
	'live.workflows.transition.removed': 'Transition retirée',

	// --- Les champs du formulaire — troisième tranche, docs/SPEC-workflow-engine.md §7 bis.10 ---
	'admin.workflows.fields.aria': 'Champs du formulaire de {workflow}',
	'admin.workflows.fields.title': 'Champs du formulaire',
	'admin.workflows.fields.intro':
		'Les questions posées sur chaque affaire de ce workflow. Leur visibilité étape par étape se règle dans la grille ci-dessous.',
	'admin.workflows.fields.loading': 'Chargement des champs…',
	'admin.workflows.fields.error': 'Les champs de ce workflow n’ont pas pu être chargés.',
	'admin.workflows.fields.empty': 'Aucun champ dans ce formulaire',
	'admin.workflows.fields.empty.hint':
		'Les affaires de ce workflow n’ont aucune question à renseigner. Déclarez un premier champ pour en poser une.',
	'admin.workflows.fields.archived': 'Archivé',

	'admin.workflows.fields.action.declare': 'Déclarer un champ',
	'admin.workflows.fields.action.edit': 'Modifier le champ {nom}',
	'admin.workflows.fields.action.archive': 'Archiver le champ {nom}',
	'admin.workflows.fields.action.restore': 'Restaurer le champ {nom}',

	'admin.workflows.fields.form.declare': 'Nouveau champ',
	'admin.workflows.fields.form.edit': 'Champ « {nom} »',
	'admin.workflows.fields.form.key': 'Clé',
	'admin.workflows.fields.form.key.help':
		'Minuscules, chiffres et tirets simples. Elle identifie le champ dans les exports et les messages d’erreur, et ne se modifie plus ensuite.',
	'admin.workflows.fields.form.key.invalid':
		'La clé n’accepte que des minuscules, des chiffres et des tirets simples, sans tiret au début ni à la fin.',
	'admin.workflows.fields.form.key.frozen':
		'Clé : {cle}. Elle ne se modifie pas : les exports et les messages d’erreur la citent. Archivez ce champ et redéclarez-en un pour en changer.',
	'admin.workflows.fields.form.label': 'Libellé',
	'admin.workflows.fields.form.label.help': 'Le texte affiché au-dessus de la question, sur chaque affaire.',
	'admin.workflows.fields.form.label.invalid': 'Le libellé ne peut pas être blanc.',
	'admin.workflows.fields.form.type': 'Type',
	'admin.workflows.fields.form.type.help':
		'Il détermine ce qu’une réponse peut contenir. Il se choisit maintenant et ne se modifie plus ensuite.',
	'admin.workflows.fields.form.type.frozen':
		'Type : {type}. Il ne se modifie pas : les réponses déjà saisies resteraient dans l’ancien format, et aucune conversion n’existe encore.',
	'admin.workflows.fields.form.help': 'Texte d’aide',
	'admin.workflows.fields.form.help.help':
		'Facultatif. Affiché sous la question pour expliquer ce qui est attendu.',
	'admin.workflows.fields.form.help.invalid': 'Le texte d’aide ne peut pas être blanc : laissez-le vide.',
	'admin.workflows.fields.form.currency': 'Devise',
	'admin.workflows.fields.form.currency.help': 'Code de trois lettres, par exemple EUR.',
	'admin.workflows.fields.form.currency.invalid':
		'La devise s’écrit en trois lettres majuscules, par exemple EUR.',
	'admin.workflows.fields.form.choices': 'Choix proposés',
	'admin.workflows.fields.form.choices.help':
		'Au moins un choix. La clé identifie la réponse et ne doit apparaître qu’une fois ; le libellé est ce que l’équipe lit.',
	'admin.workflows.fields.form.choices.key': 'Clé du choix',
	'admin.workflows.fields.form.choices.label': 'Libellé du choix',
	'admin.workflows.fields.form.choices.add': 'Ajouter un choix',
	'admin.workflows.fields.form.choices.remove': 'Retirer le choix {nom}',
	'admin.workflows.fields.form.choices.invalid.aucun-choix':
		'Un champ à choix a besoin d’au moins un choix.',
	'admin.workflows.fields.form.choices.invalid.cle-vide': 'Chaque choix a besoin d’une clé.',
	'admin.workflows.fields.form.choices.invalid.libelle-vide': 'Chaque choix a besoin d’un libellé.',
	'admin.workflows.fields.form.choices.invalid.cle-dupliquee':
		'Deux choix portent la même clé : les réponses seraient impossibles à distinguer.',

	'admin.workflows.fields.archive.confirm': 'Archiver le champ « {nom} » ?',
	'admin.workflows.fields.archive.confirm.body':
		'Il disparaît des formulaires, les réponses déjà saisies sont conservées, et la restauration le remet en place. Le produit ne supprime aucun champ.',
	'admin.workflows.fields.archive.confirm.action': 'Archiver',

	// Les quinze types de docs/SPEC-form-composer.md §2.3.
	'admin.workflows.fields.type.text': 'Texte court',
	'admin.workflows.fields.type.textarea': 'Texte long',
	'admin.workflows.fields.type.number': 'Nombre',
	'admin.workflows.fields.type.money': 'Montant',
	'admin.workflows.fields.type.date': 'Date',
	'admin.workflows.fields.type.datetime': 'Date et heure',
	'admin.workflows.fields.type.select': 'Choix unique',
	'admin.workflows.fields.type.multiselect': 'Choix multiple',
	'admin.workflows.fields.type.checkbox': 'Case à cocher',
	'admin.workflows.fields.type.url': 'Adresse web',
	'admin.workflows.fields.type.email': 'Adresse email',
	'admin.workflows.fields.type.phone': 'Téléphone',
	'admin.workflows.fields.type.user': 'Membre de l’espace',
	'admin.workflows.fields.type.contact': 'Contact',
	'admin.workflows.fields.type.file': 'Fichier',

	'admin.workflows.refus.champ.cle-deja-prise': 'Cette clé est déjà prise dans ce workflow.',
	'admin.workflows.refus.champ.reference-absente':
		'Ce workflow n’existe plus, ou n’appartient pas à cet espace de travail.',
	'admin.workflows.refus.champ.forme-refusee':
		'Ce champ a été refusé : vérifiez la clé, le libellé, le texte d’aide, le type et ses options.',

	// --- La grille champ × étape — quatrième tranche, docs/SPEC-workflow-engine.md §7 bis.11 ---
	'admin.workflows.rules.aria': 'Règles de visibilité de {workflow}',
	'admin.workflows.rules.title': 'Visibilité des champs, étape par étape',
	'admin.workflows.rules.intro':
		'Ce que chaque champ devient à chaque étape. Un champ exigé doit être renseigné pour qu’une affaire entre dans l’étape.',
	'admin.workflows.rules.loading': 'Chargement des règles de visibilité…',
	'admin.workflows.rules.error': 'Les règles de visibilité n’ont pas pu être chargées.',
	'admin.workflows.rules.column.field': 'Champ',
	'admin.workflows.rules.cell.aria': 'Visibilité de « {champ} » à l’étape « {etape} »',
	'admin.workflows.rules.state.defaut': 'Par défaut',
	'admin.workflows.rules.state.hidden': 'Masqué',
	'admin.workflows.rules.state.visible': 'Affiché',
	'admin.workflows.rules.state.required': 'Exigé',
	'admin.workflows.rules.note.default':
		'« Par défaut » affiche le champ, comme « Affiché » : les deux produisent le même formulaire, le premier sans enregistrer aucune règle, le second en enregistrant une règle explicite.',
	'admin.workflows.rules.note.archived.one':
		'Un champ archivé n’apparaît pas dans cette grille : il ne figure dans aucun formulaire. Ses règles sont conservées et redeviennent effectives s’il est restauré.',
	'admin.workflows.rules.note.archived.many':
		'{nombre} champs archivés n’apparaissent pas dans cette grille : ils ne figurent dans aucun formulaire. Leurs règles sont conservées et redeviennent effectives s’ils sont restaurés.',
	'admin.workflows.rules.noFields':
		'Aucun champ actif : déclarez un champ, ou restaurez-en un, pour régler sa visibilité.',
	'admin.workflows.rules.noSteps': 'Aucune étape : ajoutez une étape pour régler la visibilité des champs.',

	'admin.workflows.refus.regle.reference-absente':
		'Ce champ ou cette étape n’existe plus, ou n’appartient pas à ce workflow.',
	'admin.workflows.refus.regle.forme-refusee':
		'Cette visibilité a été refusée : seuls « masqué », « affiché » et « exigé » existent.',

	// --- Les exigences de transition — cinquième tranche, docs/SPEC-workflow-engine.md §7 bis.12 ---
	'admin.workflows.requirements.aria': 'Exigences des transitions de {workflow}',
	'admin.workflows.requirements.title': 'Champs exigés pour franchir une transition',
	'admin.workflows.requirements.intro':
		'Ce qu’une affaire doit avoir renseigné pour emprunter chaque chemin. Une exigence vient de la règle de l’étape d’arrivée, ou de la transition elle-même.',
	'admin.workflows.requirements.loading': 'Chargement des exigences…',
	'admin.workflows.requirements.error': 'Les exigences des transitions n’ont pas pu être chargées.',
	'admin.workflows.requirements.none': 'Aucun champ exigé : ce chemin se franchit sans rien renseigner.',
	'admin.workflows.requirements.noTransitions':
		'Aucune transition déclarée : déclarez un chemin pour lui donner des exigences.',
	'admin.workflows.requirements.noFields':
		'Aucun champ actif : déclarez un champ, ou restaurez-en un, pour pouvoir l’exiger.',
	'admin.workflows.requirements.origin.regle': 'exigé par la règle de l’étape d’arrivée',
	'admin.workflows.requirements.origin.transition': 'exigé par cette transition',
	'admin.workflows.requirements.origin.les-deux':
		'exigé par la règle de l’étape d’arrivée et par cette transition',
	'admin.workflows.requirements.origin.hint':
		'Une exigence venue d’une règle se modifie dans la grille de visibilité ci-dessus.',
	'admin.workflows.requirements.remove.aria': 'Ne plus exiger « {champ} » pour « {transition} »',
	'admin.workflows.requirements.remove.confirm':
		'Ne plus exiger « {champ} » pour « {transition} » ?',
	'admin.workflows.requirements.remove.confirm.body':
		'Le champ reste dans le formulaire. Il ne sera simplement plus obligatoire pour emprunter ce chemin.',
	'admin.workflows.requirements.remove.confirm.action': 'Ne plus exiger',
	'admin.workflows.requirements.action.add': 'Exiger un champ',
	'admin.workflows.requirements.add.aria': 'Exiger un champ pour « {transition} »',
	'admin.workflows.requirements.add.field': 'Champ à exiger',
	'admin.workflows.requirements.add.submit': 'Exiger ce champ',
	'admin.workflows.requirements.add.none':
		'Tous les champs actifs sont déjà exigés pour cette transition.',
	'admin.workflows.requirements.add.alreadyByRule':
		'Ce champ est déjà exigé par la règle de l’étape d’arrivée : l’exiger ici ne change rien tant que cette règle ne change pas.',
	'admin.workflows.requirements.void.one':
		'Un champ archivé est exigé par cette transition sans effet : un champ archivé ne figure dans aucun formulaire. L’exigence est conservée et redevient effective s’il est restauré.',
	'admin.workflows.requirements.void.many':
		'{nombre} champs archivés sont exigés par cette transition sans effet : un champ archivé ne figure dans aucun formulaire. Les exigences sont conservées et redeviennent effectives s’ils sont restaurés.',

	'admin.workflows.refus.exigence.deja-exige':
		'Ce champ est déjà exigé par cette transition : quelqu’un vient probablement de le déclarer.',
	'admin.workflows.refus.exigence.reference-absente':
		'Cette transition ou ce champ n’existe plus, ou n’appartient pas à ce workflow.',
	'admin.workflows.refus.exigence.workflow-different':
		'Ce champ et cette transition n’appartiennent pas au même workflow.',

	// --- La prévisualisation des effets — sixième tranche, docs/SPEC-workflow-engine.md §7 bis.13 ---
	'admin.workflows.effets.loading': 'Mesure des effets sur les affaires en cours…',
	// « Zéro se dit en toutes lettres » (§7 bis.13.4) : un bloc muet se lirait comme un chargement
	// qui n'a pas abouti.
	'admin.workflows.effets.aucun': 'Aucune affaire en cours n’est concernée.',
	'admin.workflows.effets.indisponible':
		'Les effets sur les affaires en cours n’ont pas pu être mesurés. Le geste reste possible.',
	'admin.workflows.effets.surPlace.one':
		'1 affaire est déjà à cette étape : sa fiche signalera le manque, sans la déplacer.',
	'admin.workflows.effets.surPlace.many':
		'{nombre} affaires sont déjà à cette étape : leur fiche signalera le manque, sans les déplacer.',
	'admin.workflows.effets.aLEntree.one':
		'1 affaire ne pourra plus entrer dans cette étape tant que ce champ sera vide.',
	'admin.workflows.effets.aLEntree.many':
		'{nombre} affaires ne pourront plus entrer dans cette étape tant que ce champ sera vide.',
	'admin.workflows.effets.transition.one':
		'1 affaire ne pourra plus emprunter ce chemin tant que ce champ sera vide.',
	'admin.workflows.effets.transition.many':
		'{nombre} affaires ne pourront plus emprunter ce chemin tant que ce champ sera vide.',
	'admin.workflows.effets.confirm.title': 'Exiger « {champ} » à l’étape « {etape} » ?',
	'admin.workflows.effets.confirm.body':
		'Le champ devra être renseigné pour qu’une affaire entre dans cette étape. Les affaires déjà arrivées n’en sont jamais chassées.',
	'admin.workflows.effets.confirm.action': 'Exiger ce champ',

	'live.workflows.requirement.added': 'Champ exigé',
	'live.workflows.requirement.removed': 'Champ plus exigé',

	'live.workflows.rule.set': 'Visibilité réglée',
	'live.workflows.rule.reset': 'Visibilité rendue au défaut',

	'live.workflows.field.declared': 'Champ déclaré',
	'live.workflows.field.updated': 'Champ modifié',
	'live.workflows.field.moved': 'Champ déplacé',
	'live.workflows.field.archived': 'Champ archivé',
	'live.workflows.field.restored': 'Champ restauré',

	// --- État de la messagerie — CRM-059, docs/SPEC-mail-subsystem.md §20.11 --------------
	'admin.settings.index.mail': 'État de la messagerie',
	'admin.settings.index.mail.body':
		'Dernière relève de chaque boîte entrante, dernier incident, file sortante en attente et en échec définitif.',

	'admin.mail.title': 'État de la messagerie',
	'admin.mail.aria': 'État des comptes de messagerie et de la file sortante',
	'admin.mail.noWorkspace.title': 'Aucun espace de travail accessible',
	'admin.mail.noWorkspace.body': "Sans espace de travail, il n'y a pas de messagerie à superviser.",
	'admin.mail.empty.title': 'Aucune boîte à superviser',
	'admin.mail.empty.body':
		"Aucun compte de messagerie entrante n'est visible avec ce compte.",
	'admin.mail.error.title': "L'état de la messagerie n'a pas pu être chargé",
	'admin.mail.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.mail.error.retry': 'Réessayer',

	'admin.mail.counters.queued': "En attente d'envoi",
	'admin.mail.counters.failed': 'Échecs définitifs',

	'admin.mail.table.aria': 'Comptes de messagerie entrante',
	'admin.mail.table.label': 'Boîte',
	'admin.mail.table.lastSync': 'Dernière relève réussie',
	'admin.mail.table.incident': 'Dernier incident',
	'admin.mail.table.never': 'Jamais relevée',

	// Dictionnaire fermé des six codes de `mail_inbound_accounts_erreur_code` (migration 0022) —
	// jamais le texte du serveur distant (docs/SPEC-mail-subsystem.md §13.7, §20.11.4).
	'admin.mail.incident.auth_failed': 'Authentification refusée',
	'admin.mail.incident.host_unreachable': 'Hôte injoignable',
	'admin.mail.incident.connection_refused': 'Connexion refusée',
	'admin.mail.incident.tls_failed': 'Échec TLS',
	'admin.mail.incident.timeout': 'Délai dépassé',
	'admin.mail.incident.protocol_error': 'Erreur de protocole',

	// --- Configuration des comptes entrants — CRM-088, docs/SPEC-mail-subsystem.md §21 --------
	'admin.settings.index.mailAccounts': 'Comptes de messagerie entrante',
	'admin.settings.index.mailAccounts.body':
		"Serveur, port, sécurité, identifiant et mot de passe de chaque boîte relevée par le produit.",

	'admin.mailAccounts.title': 'Comptes de messagerie entrante',
	'admin.mailAccounts.aria': 'Configuration des comptes de messagerie entrante',
	'admin.mailAccounts.live.aria': 'Enregistrement des comptes de messagerie',
	'admin.mailAccounts.noWorkspace.title': 'Aucun espace de travail accessible',
	'admin.mailAccounts.noWorkspace.body':
		"Sans espace de travail, il n'y a aucune boîte à configurer.",
	'admin.mailAccounts.empty.title': 'Aucune boîte configurée',
	'admin.mailAccounts.empty.body':
		"Aucun compte de messagerie entrante n'est visible avec ce compte. Configurez-en un pour que le produit relève votre courrier.",
	'admin.mailAccounts.error.title': 'Les comptes de messagerie n’ont pas pu être chargés',
	'admin.mailAccounts.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.mailAccounts.error.retry': 'Réessayer',

	'admin.mailAccounts.open': 'Configurer une boîte',
	'admin.mailAccounts.configure': 'Configurer',
	'admin.mailAccounts.configure.aria': 'Configurer la boîte {boite}',
	'admin.mailAccounts.form.title': 'Configuration de la boîte',
	'admin.mailAccounts.save': 'Enregistrer',
	'admin.mailAccounts.saving': 'Enregistrement…',
	'admin.mailAccounts.saved': 'Boîte enregistrée.',
	'admin.mailAccounts.cancel': 'Annuler',

	'admin.mailAccounts.target.system': 'Boîte système de l’espace de travail',
	'admin.mailAccounts.target.mine': 'Ma boîte personnelle',

	'admin.mailAccounts.field.target': 'Boîte visée',
	'admin.mailAccounts.field.label': 'Libellé',
	'admin.mailAccounts.field.host': 'Serveur IMAP',
	'admin.mailAccounts.field.port': 'Port',
	'admin.mailAccounts.field.security': 'Sécurité',
	'admin.mailAccounts.field.username': 'Identifiant',
	'admin.mailAccounts.field.password': 'Mot de passe',
	'admin.mailAccounts.field.password.help':
		"Laissé vide, le mot de passe enregistré est conservé. Il n'est jamais affiché.",
	'admin.mailAccounts.field.password.help.new':
		"Obligatoire pour une boîte qui n'existe pas encore : sans lui, aucune connexion ne serait possible.",

	// Les quatre valeurs de `mail_inbound_accounts_statut` (migration 0022) — jamais le code brut
	// (docs/SPEC-mail-subsystem.md §21.3, docs/DESIGN_SYSTEM.md §5.34).
	'admin.mailAccounts.status.pending': 'En attente',
	'admin.mailAccounts.status.ok': 'Connectée',
	'admin.mailAccounts.status.error': 'En erreur',
	'admin.mailAccounts.status.disabled': 'Désactivée',

	// Les trois modes de `mail_inbound_accounts_securite`, en toutes lettres (§1, §5.34).
	'admin.mailAccounts.security.ssl': 'SSL',
	'admin.mailAccounts.security.starttls': 'STARTTLS',
	'admin.mailAccounts.security.none': 'Aucune',

	// Dictionnaire fermé des refus — docs/SPEC-mail-subsystem.md §21.7. Aucun corps d'erreur du
	// serveur n'est affiché : il divulguerait `secret_id` (INC-193).
	'admin.mailAccounts.refusal.forbidden':
		"Vous ne pouvez pas configurer cette boîte : seule une administratrice ou un administrateur de l'espace de travail configure la boîte système et celle d'un collègue.",
	'admin.mailAccounts.refusal.session': 'Votre session a expiré. Reconnectez-vous, puis réessayez.',
	'admin.mailAccounts.refusal.passwordRequired':
		'Un mot de passe est exigé pour créer une boîte : sans lui, aucune connexion ne serait possible.',
	'admin.mailAccounts.refusal.label': 'Le libellé est obligatoire, et ne dépasse pas 200 caractères.',
	'admin.mailAccounts.refusal.host': 'Le serveur est obligatoire, et ne dépasse pas 253 caractères.',
	'admin.mailAccounts.refusal.port': 'Le port doit être un nombre entier compris entre 1 et 65535.',
	'admin.mailAccounts.refusal.security': "Le mode de sécurité n'est pas reconnu.",
	'admin.mailAccounts.refusal.username':
		"L'identifiant est obligatoire, et ne dépasse pas 320 caractères.",
	'admin.mailAccounts.refusal.owner':
		"Le propriétaire de cette boîte n'est pas membre de l'espace de travail.",
	'admin.mailAccounts.refusal.network':
		"L'enregistrement n'a pas abouti : le serveur n'a pas répondu.",
	'admin.mailAccounts.refusal.unknown':
		"L'enregistrement a été refusé, et la cause n'est pas reconnue par le produit.",

	// --- Identités sortantes SMTP — CRM-089, docs/SPEC-mail-subsystem.md §22 -------------------
	'admin.settings.index.mailIdentities': 'Identités d’expédition',
	'admin.settings.index.mailIdentities.body':
		"Adresse d'expédition, nom affiché, serveur SMTP et mot de passe de chaque identité employée pour répondre.",

	'admin.mailIdentities.title': 'Identités d’expédition',
	'admin.mailIdentities.aria': 'Configuration des identités d’expédition SMTP',
	'admin.mailIdentities.live.aria': 'Enregistrement des identités d’expédition',
	'admin.mailIdentities.noWorkspace.title': 'Aucun espace de travail accessible',
	'admin.mailIdentities.noWorkspace.body':
		"Sans espace de travail, il n'y a aucune identité d'expédition à configurer.",
	'admin.mailIdentities.empty.title': 'Aucune identité d’expédition',
	'admin.mailIdentities.empty.body':
		"Aucune identité d'expédition n'est visible avec ce compte. Déclarez-en une pour pouvoir répondre depuis le produit.",
	'admin.mailIdentities.error.title': 'Les identités d’expédition n’ont pas pu être chargées',
	'admin.mailIdentities.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.mailIdentities.error.retry': 'Réessayer',

	'admin.mailIdentities.open': 'Déclarer une identité',
	'admin.mailIdentities.configure': 'Configurer',
	'admin.mailIdentities.configure.aria': 'Configurer l’identité {identite}',
	'admin.mailIdentities.form.title': 'Configuration de l’identité d’expédition',
	'admin.mailIdentities.save': 'Enregistrer',
	'admin.mailIdentities.saving': 'Enregistrement…',
	'admin.mailIdentities.saved': 'Identité enregistrée.',
	'admin.mailIdentities.cancel': 'Annuler',
	'admin.mailIdentities.default': 'Par défaut',

	// Les deux entrées de DÉCLARATION du sélecteur — une identité existante y est nommée par ses
	// données, libellé et adresse (docs/SPEC-mail-subsystem.md §22.5, docs/DESIGN_SYSTEM.md §5.35).
	'admin.mailIdentities.target.newMine': 'Nouvelle identité personnelle',
	'admin.mailIdentities.target.newSystem': 'Nouvelle identité de service',

	'admin.mailIdentities.field.target': 'Identité visée',
	'admin.mailIdentities.field.fromAddress': 'Adresse d’expédition',
	'admin.mailIdentities.field.fromAddress.help':
		"Changer cette adresse ne renomme pas cette identité : cela en déclare une seconde, et celle-ci demeure.",
	'admin.mailIdentities.field.fromName': 'Nom d’expéditeur',
	// La signature — CRM-063 tranche 3 (docs/SPEC-modeles-emails.md §10.6). L'aide dit ce que la
	// BASE fera, comme celle du mot de passe : elle explique, elle n'empêche pas.
	'admin.mailIdentities.field.signature': 'Signature',
	'admin.mailIdentities.field.signature.help':
		"Ajoutée à la fin de chaque message expédié depuis cette identité, après une ligne de séparation. Videz le champ pour la supprimer.",
	'admin.mailIdentities.badge.signature': 'Signature',
	'admin.mailIdentities.field.label': 'Libellé',
	'admin.mailIdentities.field.host': 'Serveur SMTP',
	'admin.mailIdentities.field.port': 'Port',
	'admin.mailIdentities.field.security': 'Sécurité',
	'admin.mailIdentities.field.username': 'Identifiant',
	'admin.mailIdentities.field.default': 'Identité par défaut pour cet expéditeur',
	'admin.mailIdentities.field.password': 'Mot de passe',
	'admin.mailIdentities.field.password.help':
		"Laissé vide, le mot de passe enregistré est conservé. Il n'est jamais affiché.",
	'admin.mailIdentities.field.password.help.new':
		"Obligatoire pour une identité qui n'existe pas encore : sans lui, aucune expédition ne serait possible.",

	// Les quatre valeurs de `mail_outbound_identities_statut` (migration 0023) — jamais le code
	// brut (docs/SPEC-mail-subsystem.md §22.3, docs/DESIGN_SYSTEM.md §5.35).
	'admin.mailIdentities.status.pending': 'En attente',
	'admin.mailIdentities.status.ok': 'Connectée',
	'admin.mailIdentities.status.error': 'En erreur',
	'admin.mailIdentities.status.disabled': 'Désactivée',

	// Les trois modes de `mail_outbound_identities_securite`, en toutes lettres (§1, §5.35).
	'admin.mailIdentities.security.ssl': 'SSL',
	'admin.mailIdentities.security.starttls': 'STARTTLS',
	'admin.mailIdentities.security.none': 'Aucune',

	// Dictionnaire fermé des refus — docs/SPEC-mail-subsystem.md §22.8. Aucun corps d'erreur du
	// serveur n'est affiché : il divulguerait `secret_id` (INC-193).
	'admin.mailIdentities.refusal.forbidden':
		"Vous ne pouvez pas configurer cette identité : seule une administratrice ou un administrateur de l'espace de travail configure l'identité de service et celle d'un collègue.",
	'admin.mailIdentities.refusal.session':
		'Votre session a expiré. Reconnectez-vous, puis réessayez.',
	'admin.mailIdentities.refusal.passwordRequired':
		"Un mot de passe est exigé pour déclarer une identité : sans lui, aucune expédition ne serait possible.",
	// LA BORNE EST 120, ET NON 200 : `mail_outbound_identities_label_borne` est une contrainte
	// DISTINCTE de celle des comptes entrants, relue en base (§22.5).
	'admin.mailIdentities.refusal.label':
		'Le libellé est obligatoire, et ne dépasse pas 120 caractères.',
	'admin.mailIdentities.refusal.host':
		'Le serveur est obligatoire, et ne dépasse pas 253 caractères.',
	'admin.mailIdentities.refusal.port':
		'Le port doit être un nombre entier compris entre 1 et 65535.',
	'admin.mailIdentities.refusal.security': "Le mode de sécurité n'est pas reconnu.",
	'admin.mailIdentities.refusal.username':
		"L'identifiant est obligatoire, et ne dépasse pas 320 caractères.",
	'admin.mailIdentities.refusal.fromAddress':
		"L'adresse d'expédition doit être une adresse électronique, de la forme nom@domaine.test.",
	'admin.mailIdentities.refusal.owner':
		"Le propriétaire de cette identité n'est pas membre de l'espace de travail.",
	'admin.mailIdentities.refusal.network':
		"L'enregistrement n'a pas abouti : le serveur n'a pas répondu.",
	'admin.mailIdentities.refusal.unknown':
		"L'enregistrement a été refusé, et la cause n'est pas reconnue par le produit.",

	// --- Corbeille — CRM-077, docs/SPEC-corbeille.md §4 ---------------------------------------
	'admin.settings.index.trash': 'Corbeille',
	'admin.settings.index.trash.body':
		'Tracks, channels et affaires retirés : qui les a retirés, quand, ce qu\'ils retiennent, et leur restauration.',

	'admin.trash.title': 'Corbeille',
	'admin.trash.aria': 'Objets mis à la corbeille',
	'admin.trash.noWorkspace.title': 'Aucun espace de travail accessible',
	'admin.trash.noWorkspace.body': "Sans espace de travail, il n'y a pas de corbeille à consulter.",

	'admin.trash.empty.title': 'La corbeille est vide',
	'admin.trash.empty.body':
		"Aucun track, channel ni affaire n'est actuellement retiré. Les objets mis à la corbeille apparaissent ici jusqu'à leur restauration.",

	'admin.trash.error.title': "La corbeille n'a pas pu être chargée",
	'admin.trash.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.trash.error.retry': 'Réessayer',

	'admin.trash.table.aria': 'Objets retirés, du plus récemment retiré au plus ancien',
	'admin.trash.table.type': 'Type',
	'admin.trash.table.name': 'Nom',
	'admin.trash.table.by': 'Retiré par',
	'admin.trash.table.at': 'Retiré le',
	'admin.trash.table.holds': 'Retient avec lui',
	'admin.trash.table.action': 'Action',

	// Le type est un MOT, jamais une icône seule (docs/DESIGN_SYSTEM.md §5.16).
	'admin.trash.type.track': 'Track',
	'admin.trash.type.channel': 'Channel',
	'admin.trash.type.card': 'Affaire',

	// L'auteur non enregistré est un FAIT à nommer, pas une cellule vide (§4.3).
	'admin.trash.author.unknown': 'Auteur inconnu',

	// Les trois états de la colonne d'énumération ne se confondent pas (docs/DESIGN_SYSTEM.md §5.16).
	'admin.trash.holds.loading': 'En cours de mesure',
	'admin.trash.holds.failed': "N'a pas pu être mesuré",
	'admin.trash.holds.none': 'Rien de plus',
	// Singulier et pluriel sont DEUX CLÉS, jamais une phrase concaténée (CLAUDE.md §23).
	'admin.trash.holds.channels.one': '{compte} channel',
	'admin.trash.holds.channels.many': '{compte} channels',
	'admin.trash.holds.cards.one': '{compte} affaire',
	'admin.trash.holds.cards.many': '{compte} affaires',

	'admin.trash.restore': 'Restaurer',
	'admin.trash.restore.aria': 'Restaurer {nom}',
	'admin.trash.restore.running': 'Restauration en cours',
	'admin.trash.restored': '{nom} a été restauré et ne figure plus dans la corbeille.',

	// Les refus, un texte par geste attendu (§4.5).
	'admin.trash.refus.parent': 'Son parent est lui-même en corbeille : restaurez-le d\'abord.',
	'admin.trash.refus.forbidden': "Votre compte n'a pas le droit de restaurer cet objet.",
	'admin.trash.refus.sansEffet':
		"Rien n'a été restauré : cet objet n'est plus modifiable avec votre compte.",
	'admin.trash.refus.network': "La requête n'a pas abouti. Réessayer relance la restauration.",
	'admin.trash.refus.unknown': "La restauration a été refusée, sans raison exploitable.",

	// --- Catalogue de nœuds — CRM-030, docs/SPEC-workflow-engine.md §2 bis ---------------------
	'admin.settings.index.catalog': 'Catalogue de nœuds',
	'admin.settings.index.catalog.body':
		"Les états qu'une affaire peut occuper dans cet espace de travail : leur nom, leur type, leur couleur et leurs valeurs par défaut.",

	'admin.catalog.title': 'Catalogue de nœuds',
	'admin.catalog.aria': 'Catalogue de nœuds du workspace',
	'admin.catalog.intro':
		"Un nœud est un état qu'une affaire peut occuper. Les workflows en composent leurs étapes ; sa clé est ce sur quoi l'analytique s'appuie, et elle ne se modifie pas.",
	'admin.catalog.noWorkspace.title': 'Aucun espace de travail accessible',
	'admin.catalog.noWorkspace.body': "Sans espace de travail, il n'y a pas de catalogue à administrer.",

	'admin.catalog.empty.title': 'Aucun nœud dans ce catalogue',
	'admin.catalog.empty.body':
		"Aucun workflow ne peut être composé tant qu'aucun état n'est déclaré. Créez le premier nœud pour commencer.",

	'admin.catalog.error.title': "Le catalogue n'a pas pu être chargé",
	'admin.catalog.error.body': "La requête n'a pas abouti. Réessayer relance le chargement.",
	'admin.catalog.error.retry': 'Réessayer',

	// Le type est un MOT, jamais une teinte (docs/DESIGN_SYSTEM.md §5.18).
	'admin.catalog.kind.open': 'Ouvert',
	'admin.catalog.kind.won': 'Gagné',
	'admin.catalog.kind.lost': 'Perdu',

	'admin.catalog.color.brand': 'Bleu',
	'admin.catalog.color.success': 'Vert',
	'admin.catalog.color.accent': 'Jaune',
	'admin.catalog.color.danger': 'Rouge',
	'admin.catalog.color.neutral': 'Neutre',

	// La valeur et son unité dans un seul texte traduit, jamais concaténées (CLAUDE.md §23).
	'admin.catalog.probability.value': '{valeur} %',
	'admin.catalog.stale.value': '{valeur} j',
	'admin.catalog.archived': 'Archivé',

	'admin.catalog.create': 'Nouveau nœud',
	'admin.catalog.edit': 'Modifier',
	'admin.catalog.edit.aria': 'Modifier le nœud {nom}',
	'admin.catalog.archive': 'Archiver',
	'admin.catalog.archive.aria': 'Archiver le nœud {nom}',
	'admin.catalog.archive.confirm':
		'Archiver « {nom} » ? Il ne sera plus proposé aux workflows, et vous pourrez le rétablir ici.',
	'admin.catalog.archive.confirmAction': 'Archiver ce nœud',
	'admin.catalog.unarchive': 'Rétablir',
	'admin.catalog.unarchive.aria': 'Rétablir le nœud {nom}',
	// Les commandes d'ordre du §2 ter : icône seule, nom accessible ici (docs/DESIGN_SYSTEM.md
	// §5.18). Les DEUX causes d'indisponibilité réemploient `admin.move.*`, déjà écrites pour
	// l'arborescence : ce sont les mêmes phrases pour la même arithmétique.
	'admin.catalog.moveUp.aria': 'Monter le nœud {nom}',
	'admin.catalog.moveDown.aria': 'Descendre le nœud {nom}',
	'admin.catalog.save': 'Enregistrer',
	'admin.catalog.cancel': 'Annuler',

	'admin.catalog.form.createTitle': 'Nouveau nœud',
	'admin.catalog.form.editTitle': 'Modifier le nœud',
	'admin.catalog.field.label': 'Libellé',
	'admin.catalog.field.key': 'Clé',
	'admin.catalog.field.keyFixed':
		'Clé : {cle}. Elle ne se modifie pas : archivez ce nœud et créez-en un autre.',
	'admin.catalog.field.kind': 'Type',
	'admin.catalog.field.color': 'Couleur',
	'admin.catalog.field.probability': 'Probabilité par défaut',
	'admin.catalog.field.stale': 'Seuil de relance',
	'admin.catalog.field.optional':
		"Probabilité et seuil de relance sont facultatifs. Laissés vides, le nœud ne se prononce pas — ce qui n'est pas la même chose que zéro.",

	'admin.catalog.created': 'Le nœud {nom} a été créé.',
	'admin.catalog.updated': 'Le nœud {nom} a été modifié.',
	'admin.catalog.archived.done': 'Le nœud {nom} a été archivé.',
	'admin.catalog.unarchived': 'Le nœud {nom} a été rétabli.',
	'admin.catalog.moved': 'Le nœud {nom} a été déplacé.',

	// Les refus mesurés du §2 bis.5. Le nœud occupé porte SON NOMBRE, et un compte absent ne
	// devient jamais zéro : deux clés, jamais une phrase concaténée (CLAUDE.md §23).
	'admin.catalog.refus.occupied.one':
		"{compte} affaire en cours se trouve encore sur ce nœud : déplacez-la avant de l'archiver.",
	'admin.catalog.refus.occupied.many':
		"{compte} affaires en cours se trouvent encore sur ce nœud : déplacez-les avant de l'archiver.",
	'admin.catalog.refus.occupied.unknown':
		"Des affaires en cours se trouvent encore sur ce nœud : déplacez-les avant de l'archiver.",
	'admin.catalog.refus.forbidden': "Votre compte n'a pas le droit de modifier le catalogue.",
	'admin.catalog.refus.keyTaken': 'Cette clé est déjà employée dans cet espace de travail.',
	'admin.catalog.refus.shape':
		'Une valeur saisie a été refusée : la clé doit être en minuscules, chiffres et tirets, la probabilité de 0 à 100 et le seuil strictement positif.',
	'admin.catalog.refus.missing': "L'espace de travail visé n'existe plus.",
	'admin.catalog.refus.sansEffet':
		"Rien n'a été modifié : ce nœud n'est pas modifiable avec votre compte.",
	'admin.catalog.refus.network': "La requête n'a pas abouti. Réessayer relance l'enregistrement.",
	'admin.catalog.refus.unknown': "L'écriture a été refusée, sans raison exploitable.",

	// --- Versions d'un workflow — CRM-078, docs/SPEC-workflow-engine.md §7 ter.14 ---------
	'admin.workflows.versions.title': 'Versions',
	'admin.workflows.versions.aria': 'Versions de {workflow}',
	'admin.workflows.versions.intro':
		'Une version photographie la composition du workflow à une date. Elle ne se modifie pas et ne se supprime pas.',
	'admin.workflows.versions.loading': 'Chargement des versions',
	'admin.workflows.versions.error': "Les versions de ce workflow n'ont pas pu être chargées.",
	'admin.workflows.versions.empty': "Ce workflow n'a encore aucune version publiée.",
	'admin.workflows.versions.column.number': 'Version',
	'admin.workflows.versions.column.published': 'Publiée le',
	'admin.workflows.versions.column.author': 'Par',
	'admin.workflows.versions.column.note': 'Note',
	'admin.workflows.versions.column.fingerprint': 'Empreinte',
	'admin.workflows.versions.number': 'Version {numero}',
	'admin.workflows.versions.author.unknown': 'Auteur inconnu',

	'admin.workflows.versions.publish.title': 'Publier la composition actuelle',
	'admin.workflows.versions.publish.note': 'Note (facultative)',
	'admin.workflows.versions.publish.note.hint':
		'Elle aide à retrouver une version ; elle ne change rien à la composition conservée.',
	'admin.workflows.versions.publish.action': 'Publier une version',

	'admin.workflows.versions.compare.title': 'Comparer deux versions',
	'admin.workflows.versions.compare.hint':
		'La comparaison dit ce que la cible ajoute, retire ou modifie par rapport à la base.',
	'admin.workflows.versions.compare.base': 'Version de base',
	'admin.workflows.versions.compare.target': 'Version cible',
	'admin.workflows.versions.compare.action': 'Comparer',
	'admin.workflows.versions.compare.running': 'Comparaison en cours',
	'admin.workflows.versions.compare.identical':
		'Les deux versions portent la même composition : rien ne les distingue.',
	'admin.workflows.versions.compare.summary':
		'{ajouts} ajout(s), {retraits} retrait(s), {modifications} modification(s).',
	'admin.workflows.versions.compare.empty': "Rien n'a changé de ce côté.",
	'admin.workflows.versions.collection.workflow': 'Workflow',
	'admin.workflows.versions.collection.steps': 'Étapes',
	'admin.workflows.versions.collection.transitions': 'Transitions',
	'admin.workflows.versions.collection.fields': 'Champs de formulaire',
	'admin.workflows.versions.collection.rules': 'Règles de visibilité',
	'admin.workflows.versions.collection.required_fields': 'Champs exigés par une transition',
	'admin.workflows.versions.change.ajout': 'Ajouté',
	'admin.workflows.versions.change.retrait': 'Retiré',
	'admin.workflows.versions.change.modification': 'Modifié',
	'admin.workflows.versions.renamed': '{avant} → {apres}',
	'admin.workflows.versions.attribute': '{attribut} : {avant} → {apres}',
	'admin.workflows.versions.value.none': 'aucune valeur',

	'admin.workflows.versions.plan.title': 'Prévoir une restauration',
	'admin.workflows.versions.plan.hint':
		'Le plan dit, affaire par affaire, où chacune atterrirait si cette version était restaurée.',
	'admin.workflows.versions.plan.version': 'Version à restaurer',
	'admin.workflows.versions.plan.action': 'Calculer le plan',
	'admin.workflows.versions.plan.running': 'Calcul du plan en cours',
	'admin.workflows.versions.plan.summary':
		'{total} affaire(s) : {inchangees} inchangée(s), {remappees} remappée(s), {nonResolues} sans instruction.',
	'admin.workflows.versions.plan.ready': 'Plus aucune affaire n’attend une décision.',
	'admin.workflows.versions.plan.notReady':
		'Des affaires attendent une instruction : la restauration sera refusée tant qu’il en reste.',
	'admin.workflows.versions.plan.removed': 'Étapes retirées par cette restauration',
	'admin.workflows.versions.plan.restored': 'Étapes rétablies par cette restauration',
	'admin.workflows.versions.plan.restored.hint':
		'Une étape rétablie revient vide : aucune affaire n’y est versée d’office.',
	'admin.workflows.versions.plan.step.cards': '{total} affaire(s), dont {bloquees} sans instruction',
	'admin.workflows.versions.plan.step.target': 'Destination des affaires de {etape}',
	'admin.workflows.versions.plan.step.none': 'Aucune instruction',
	'admin.workflows.versions.plan.cards': 'Affaires concernées',
	'admin.workflows.versions.plan.cards.truncated': '{rendues} affaire(s) listées sur {total}.',
	'admin.workflows.versions.plan.cards.all': '{total} affaire(s) listées.',
	'admin.workflows.versions.plan.column.card': 'Affaire',
	'admin.workflows.versions.plan.column.state': 'État',
	'admin.workflows.versions.plan.column.resolution': 'Issue',
	'admin.workflows.versions.plan.state.active': 'Active',
	'admin.workflows.versions.plan.state.archived': 'Archivée',
	'admin.workflows.versions.plan.state.deleted': 'En corbeille',
	'admin.workflows.versions.plan.resolution.unchanged': 'Inchangée',
	'admin.workflows.versions.plan.resolution.remapped': 'Remappée',
	'admin.workflows.versions.plan.resolution.unresolved': 'Sans instruction',

	'admin.workflows.versions.restore.action': 'Restaurer cette version',
	'admin.workflows.versions.restore.confirm':
		'Restaurer la version {numero} de ce workflow ?',
	'admin.workflows.versions.restore.confirm.body':
		'La composition actuelle est d’abord publiée comme point de retour, puis remplacée. Les affaires sont déplacées selon le plan ci-dessus.',
	'admin.workflows.versions.restore.confirm.action': 'Restaurer',
	'admin.workflows.versions.restore.running': 'Restauration en cours',
	'admin.workflows.versions.restore.done': 'Version {numero} restaurée.',
	'admin.workflows.versions.restore.rollback.published':
		'Point de retour publié : version {numero}.',
	'admin.workflows.versions.restore.rollback.existing':
		'Point de retour : la version {numero}, qui jouait déjà ce rôle.',
	'admin.workflows.versions.restore.counters':
		'{affaires} affaire(s) déplacée(s) ; étapes créées {creees}, supprimées {supprimees}, modifiées {majes} ; champs créés {champsCrees}, désarchivés {desarchives}, archivés {archives}, modifiés {champsMajes}.',
	'admin.workflows.versions.restore.matches': 'La composition obtenue est celle de la version.',
	'admin.workflows.versions.restore.differs':
		'La composition obtenue diffère de la version : le nom, la portée et les champs archivés ne sont pas restaurés.',

	// Les refus, dictionnaire fermé (§7 ter.14.7) — jamais le message brut de la base.
	'admin.workflows.versions.refus.composition-inchangee':
		"La composition n'a pas changé depuis la dernière version : il n'y a rien à publier.",
	'admin.workflows.versions.refus.workflow-archive':
		'Ce workflow est archivé : il ne peut être ni publié ni restauré.',
	'admin.workflows.versions.refus.introuvable':
		"L'objet visé n'est plus lisible avec votre compte. Rechargez l'écran.",
	'admin.workflows.versions.refus.administrateurs':
		'Ce geste est réservé aux administrateurs de cet espace de travail.',
	'admin.workflows.versions.refus.workflows-differents':
		"Ces deux versions n'appartiennent pas au même workflow.",
	'admin.workflows.versions.refus.plan-non-applicable':
		'Des affaires attendent encore une instruction : la restauration a été refusée.',
	'admin.workflows.versions.refus.structure-modifiee':
		'La structure a changé depuis le plan. Recalculez-le avant de restaurer.',
	'admin.workflows.versions.refus.remappage-refuse':
		"L'instruction de remappage a été refusée : la destination choisie n'est pas admise.",
	'admin.workflows.versions.refus.limite-invalide':
		'La borne demandée pour la liste des affaires est hors des valeurs admises.',
	'admin.workflows.versions.refus.generique':
		'Le geste a été refusé, sans raison exploitable par cet écran.',

	// --- CRM-079, guide de démarrage (docs/SPEC-onboarding.md) -----------------------------------
	//
	// Les libellés d'étape non accomplie disent ce que L'APPELANT VOIT, jamais ce qui existe : le
	// comptage est borné par les droits fins, et le `viewer` seedé compte 5 channels là où la base
	// en porte 6 (§3.1 de la spécification). Écrire « aucun channel n'existe » serait faux.
	'admin.settings.index.onboarding': 'Guide de démarrage',
	'admin.settings.index.onboarding.body':
		'Les cinq étapes du premier lancement, et où chacune se fait. Consultable à tout moment.',

	'onboarding.title': 'Guide de démarrage',
	'onboarding.intro':
		'Cinq étapes pour rendre le CRM utilisable. Chacune renvoie vers l’écran qui la réalise, et son état est mesuré à chaque affichage.',
	'onboarding.progress': '{faites} étape(s) sur {total}',
	'onboarding.progress.loading': 'Mesure des étapes en cours',
	'onboarding.hide': 'Masquer le guide',
	'onboarding.hide.help':
		'Le guide disparaît de l’accueil pour cette session. Il reste accessible depuis les réglages.',
	'onboarding.reopen': 'Rouvrir le guide de démarrage',

	'onboarding.step.loading': 'Mesure de l’étape en cours',
	'onboarding.step.done': 'Fait',
	'onboarding.step.todo': 'À faire',
	'onboarding.step.unmeasured': 'Cette étape n’a pas pu être vérifiée',

	'onboarding.step.espace.title': 'Rejoindre un espace de travail',
	'onboarding.step.espace.body':
		'Un espace de travail contient vos tracks, vos channels et vos affaires. Sans lui, rien n’est lisible.',
	'onboarding.step.espace.vide': 'Vous n’appartenez à aucun espace de travail visible.',
	'onboarding.step.track.title': 'Créer un premier track',
	'onboarding.step.track.body':
		'Un track regroupe des activités proches — un métier, un marché, une équipe.',
	'onboarding.step.track.vide': 'Vous n’en voyez aucun pour le moment.',
	'onboarding.step.track.action': 'Ouvrir l’administration de l’arborescence',
	'onboarding.step.channel.title': 'Ouvrir un channel dans ce track',
	'onboarding.step.channel.body':
		'Un channel porte un workflow et ses étapes. C’est lui qui donne son board à vos affaires.',
	'onboarding.step.channel.vide': 'Vous n’en voyez aucun pour le moment.',
	'onboarding.step.channel.action': 'Créer un channel',
	'onboarding.step.affaire.title': 'Créer une première affaire',
	'onboarding.step.affaire.body':
		'Une affaire avance d’étape en étape sur le board de son channel, et rassemble ses messages et ses commentaires.',
	'onboarding.step.affaire.vide': 'Vous n’en voyez aucune pour le moment.',
	'onboarding.step.affaire.action': 'Choisir un channel où créer l’affaire',
	'onboarding.step.messagerie.title': 'Raccorder une boîte de réception',
	'onboarding.step.messagerie.body':
		'Une boîte relevée classe le courrier entrant dans les affaires.',
	'onboarding.step.messagerie.vide': 'Vous n’en voyez aucune pour le moment.',
	'onboarding.step.messagerie.action': 'Voir l’état de la messagerie',

	'live.workflows.version.published': 'Version publiée',
	'live.workflows.version.compared': 'Comparaison rendue',
	'live.workflows.version.planned': 'Plan rendu',
	'live.workflows.version.restored': 'Version restaurée',

	// -------------------------------------------------------------------------------------------
	// Histogramme prévisionnel / réel — `CRM-086`, docs/SPEC-costs.md §4.2 et §4.4,
	// docs/DESIGN_SYSTEM.md §5.30. Ces clés sont partagées par les TROIS écrans de coûts : elles ne
	// nomment donc jamais « le track » ni « le budget », que seul l'appelant connaît — c'est
	// `legendeColonne` qui porte cette nuance, en propriété du composant.
	// -------------------------------------------------------------------------------------------
	'costs.chart.region': 'Histogramme des coûts en {devise}',
	// La légende NOMME les trois séries : le §5.30 pose que la couleur ne porte jamais seule
	// l'information, et « dépassement » est bien une série au même titre que les deux autres —
	// c'est la même barre du réel, dans un état que le seul rouge ne dirait pas à qui ne le voit pas.
	'costs.chart.legend.planned': 'Prévisionnel',
	'costs.chart.legend.actual': 'Réel',
	'costs.chart.legend.over': 'Réel dépassant le prévisionnel',
	// État vide du §4.7 : « deux barres nulles sans texte se lisent comme un défaut d'affichage ».
	'costs.chart.empty': 'Aucune dépense rattachée.',
	'costs.chart.table.caption':
		'Équivalent textuel de l’histogramme des coûts en {devise} : prévisionnel, réel et lignes en attente de leur coût réel.',
	'costs.chart.table.pending': 'Sans réel',
	'costs.chart.table.total': 'Total',
	// Le dépassement est dit en TEXTE dans le tableau, et pas seulement par la couleur de la barre.
	'costs.chart.table.over': 'dépassement',
	// La mention OBLIGATOIRE du §4.4, dans la formulation exacte de la spécification. Elle reprend
	// celle de la fiche d'affaire (`card.costs.pending`) sans la partager : la fiche compose son
	// montant et sa devise séparément, l'histogramme reçoit un montant déjà formaté par `Intl` —
	// deux contrats différents pour une même phrase, et les confondre casserait l'un des deux.
	'costs.chart.pending.notice':
		'{lignes} ligne(s) sans coût réel saisi, pour {montant} de prévisionnel.',

	// -------------------------------------------------------------------------------------------
	// Écran de coûts d'un track — `CRM-086` tranche 3, docs/SPEC-costs.md §4.0, §4.2 et §4.7.
	// Ces clés-ci nomment bien « le track », contrairement à celles de l'histogramme ci-dessus :
	// elles appartiennent à UN écran et non au composant partagé par les trois.
	// -------------------------------------------------------------------------------------------
	'route.costs.track.title': 'Coûts du track',
	// Entrée de la barre d'onglets. Le libellé est court parce qu'il vit à côté des noms de
	// channels, qui sont des données de longueur libre.
	'tabs.track.costs': 'Coûts',
	'tabs.track.aria': 'Vues du track',
	// L'en-tête de la première colonne du tableau équivalent (§5.30) : sur cet écran, une paire de
	// barres désigne un budget.
	'costs.track.column': 'Budget',
	// L'état « aucun budget sur le track » du §4.7. Il n'offre aucune action : la création vit dans
	// l'administration de l'arborescence (§4.1), et y renvoyer conditionnellement au rôle ferait
	// calculer un droit à l'interface.
	'costs.track.empty.title': 'Aucun budget sur ce track',
	'costs.track.empty.body':
		'Les budgets ouverts d’un track apparaissent ici, comparés à leurs coûts réels. Un administrateur peut en créer depuis l’administration de l’arborescence.',
	// Le nom accessible du lien qui mène au détail d'un budget depuis le tableau équivalent. Le nom
	// du budget est une DONNÉE : il est passé en paramètre, jamais concaténé (§10).
	'costs.track.detail.aria': 'Voir le détail du budget {nom}',

	// -------------------------------------------------------------------------------------------
	// Écran de détail d'un budget — `CRM-086` tranche 4, docs/SPEC-costs.md §4.0, §4.3 et §4.7.
	// Le titre de la route est le NOM DU BUDGET, une donnée ; la clé ci-dessous n'est que son repli
	// pendant le chargement, comme `route.costs.track.title` l'est du nom du track.
	// -------------------------------------------------------------------------------------------
	'route.costs.budget.title': 'Détail d’un budget',
	'costs.budget.identity.aria': 'Caractéristiques du budget',
	'costs.budget.currency': 'Devise',
	'costs.budget.planned': 'Enveloppe',
	// La pilule du §5.6 : un mot, jamais une teinte seule. Un budget clos n'est pas une erreur —
	// ses lignes restent lisibles, et leur coût réel reste saisissable (§2.3).
	'costs.budget.closed': 'Budget clôturé — ses lignes restent lisibles et leur coût réel saisissable.',
	// L'état « budget récurrent sans occurrence » du §4.7. Il nomme aussi la conséquence, faute de
	// quoi on chercherait pourquoi ce budget n'apparaît pas dans le sélecteur d'une fiche d'affaire.
	'costs.budget.nooccurrence':
		'Aucune occurrence ouverte. Tant que ce budget récurrent n’en porte aucune, aucune dépense ne peut lui être rattachée.',
	// Le groupe de barres sans occurrence : la seule paire d'un budget non récurrent, ou le reliquat
	// d'un budget récurrent dont des lignes ne relèvent d'aucune occurrence listée.
	'costs.budget.nooccurrence.group': 'Sans occurrence',
	// L'en-tête de la première colonne du tableau équivalent (§5.30) : sur cet écran, une paire de
	// barres désigne une occurrence.
	'costs.budget.column': 'Occurrence',
	// Les trois formes d'une période, composées par une CLÉ et jamais par concaténation (§10) : les
	// deux bornes sont facultatives et indépendantes (§2.2).
	'costs.budget.period.range': 'du {debut} au {fin}',
	'costs.budget.period.from': 'à partir du {debut}',
	'costs.budget.period.until': 'jusqu’au {fin}',
	'costs.budget.lines.title': 'Lignes de coût',
	'costs.budget.lines.aria': 'Lignes de coût rattachées à ce budget',
	'costs.budget.lines.caption':
		'Lignes de coût rattachées à ce budget : affaire, nature, coût estimé, coût réel et auteur de la saisie.',
	'costs.budget.lines.column.card': 'Affaire',
	'costs.budget.lines.column.label': 'Nature',
	'costs.budget.lines.column.author': 'Auteur',
	// Un profil supprimé détache son auteur (`on delete set null`) : c'est un fait à NOMMER, jamais
	// une cellule vide — la règle du §5.16 du design system.
	'costs.budget.lines.author.unknown': 'Auteur inconnu',
	'costs.budget.lines.card.unknown': 'Affaire non lisible',
	'costs.budget.lines.card.archived': 'Archivée',
	// Deux vides DISTINCTS : un budget sans aucune dépense, et un filtre qui n'en laisse aucune.
	// Les confondre ferait passer un filtre trop restrictif pour un budget sans histoire (§5.11).
	'costs.budget.lines.empty': 'Aucune dépense rattachée à ce budget.',
	'costs.budget.lines.empty.filtered': 'Aucune dépense sur cette occurrence.',
	'costs.budget.filter.label': 'Filtrer par occurrence',
	'costs.budget.filter.all': 'Toutes les occurrences',
	// Un budget inexistant, un budget fermé à l'appelant et un identifiant mal formé rendent le même
	// écran (docs/SPEC-permissions-rls.md §7) : le texte ne prétend donc rien savoir de la cause.
	'costs.budget.notfound.title': 'Budget introuvable',
	'costs.budget.notfound.body':
		'Ce budget n’existe pas, ou il ne vous est pas accessible. Les budgets ouverts de ce track sont listés sur son écran de coûts.',
	'costs.budget.notfound.action': 'Revenir aux coûts du track',

	// -------------------------------------------------------------------------------------------
	// Cumul des coûts du workspace — `CRM-086` tranche 5, docs/SPEC-costs.md §4.0, §4.5 et §4.7.
	// Ces clés-ci nomment « le track » et « l'espace de travail », contrairement à celles de
	// l'histogramme partagé : elles appartiennent à UN écran.
	// -------------------------------------------------------------------------------------------
	'route.costs.workspace.title': 'Coûts',
	// L'en-tête de la première colonne du tableau équivalent (§5.30) : sur cet écran, une paire de
	// barres désigne un track.
	'costs.workspace.column': 'Track',
	// Le titre d'un histogramme de devise, rendu UNIQUEMENT quand plusieurs devises sont présentes
	// (§4.5 : « s'il n'y en a qu'une, l'utilisateur ne voit rien de cette mécanique »). Le code de
	// devise est une DONNÉE, passée en paramètre et jamais concaténée (§10).
	'costs.workspace.currency': 'Coûts en {devise}',
	// Le nom accessible du lien qui mène aux coûts d'un track depuis le tableau équivalent. Le nom
	// du track est une DONNÉE : il est passé en paramètre, jamais concaténé (§10).
	'costs.workspace.detail.aria': 'Voir les coûts du track {nom}',
	// L'état vide du §4.7, transposé au workspace. Il n'offre AUCUNE action, pour le motif exact de
	// l'écran du track : la création d'un budget vit dans l'administration de l'arborescence (§4.1),
	// et y renvoyer conditionnellement au rôle ferait calculer un droit à l'interface.
	// Aucun client d'API : configuration absente, ou session perdue. C'est un ÉTAT, jamais une
	// attente — laisser le squelette serait la page blanche déguisée que le §5.8 refuse.
	'costs.workspace.noworkspace.title': 'Aucun espace de travail',
	'costs.workspace.noworkspace.body':
		'Votre compte n’appartient à aucun espace de travail, ou votre session a expiré. Reconnectez-vous pour retrouver le cumul des coûts.',
	'costs.workspace.empty.title': 'Aucun budget ouvert',
	'costs.workspace.empty.body':
		'Les budgets ouverts des tracks que vous pouvez lire sont cumulés ici, comparés à leurs coûts réels. Un administrateur peut en créer depuis l’administration de l’arborescence.',
	// La portée du cumul est ÉCRITE, jamais supposée comprise : le §4.5 pose que l'écran « ne montre
	// que les tracks lisibles par l'appelant », et deux profils y lisent donc deux totaux différents
	// sur les mêmes données. Sans cette phrase, l'écart se lirait comme une erreur de calcul.
	'costs.workspace.scope':
		'Ce cumul ne porte que sur les budgets ouverts des tracks que vous pouvez lire. Un track archivé ou mis à la corbeille n’y figure pas ; ses budgets restent lisibles depuis son propre écran de coûts.',

	// -------------------------------------------------------------------------------------------
	// Onglet « À saisir » — `CRM-086` tranche 6b, docs/SPEC-costs.md §4.8, §4.8.1 et §4.8.2,
	// docs/DESIGN_SYSTEM.md §5.31. Ces clés sont partagées par les DEUX écrans à onglets — celui du
	// track et celui du workspace : elles ne nomment donc ni l'un ni l'autre, la portée étant celle
	// de l'écran d'où l'onglet est ouvert.
	// -------------------------------------------------------------------------------------------
	'costs.tabs.aria': 'Vues des coûts',
	'costs.tabs.overview': 'Vue d’ensemble',
	'costs.tabs.pending': 'À saisir',
	// Le badge porte un CHIFFRE, et son nom accessible une phrase entière : un nombre nu ne dit pas
	// ce qu'il compte (docs/DESIGN_SYSTEM.md §5.4 bis). Il compte les lignes que le tableau LISTE,
	// budgets clôturés compris — l'écart avec la mention du §4.4 est consigné à INC-182 (§4.8.2).
	'costs.tabs.pending.count': '{n} ligne(s) en attente de leur coût réel',
	'costs.pending.caption':
		'Lignes de coût en attente de leur coût réel, de la plus ancienne à la plus récente : ancienneté, budget, occurrence, affaire, nature, coût estimé et saisie du coût réel.',
	'costs.pending.column.age': 'Ancienneté',
	'costs.pending.column.budget': 'Budget',
	'costs.pending.column.occurrence': 'Occurrence',
	'costs.pending.column.card': 'Affaire',
	'costs.pending.column.label': 'Nature',
	'costs.pending.column.actual': 'Réel',
	// L'ancienneté est « formulée en durée » (§5.31), et se compose par une CLÉ : « 12 jours » ne se
	// construit pas en collant un nombre à un mot (§10). Aucune variante de danger — le seuil que le
	// §5.31 suppose n'existe pour aucune ligne de coût, écart consigné à INC-183 (§4.8.1).
	'costs.pending.age.days': '{n} jour(s)',
	// La pilule du §5.31 : jetons NEUTRES, jamais `--color-danger`. Un budget clos n'est pas une
	// erreur, et sa ligne reste saisissable — c'est même la raison d'être de cet onglet.
	'costs.pending.closed': 'clôturé',
	'costs.pending.closed.aria':
		'Budget ou occurrence clôturé — cette ligne reste saisissable après la clôture.',
	'costs.pending.card.unknown': 'Affaire non lisible',
	// « C'est une bonne nouvelle, pas un état vide en défaut » (§4.8).
	'costs.pending.empty.title': 'Tous les coûts réels sont saisis',
	'costs.pending.empty.body':
		'Aucune ligne de coût n’attend son coût réel dans cette portée. Les lignes créées sans coût réel apparaîtront ici, budgets clôturés compris.',
	// L'état « aucune ligne écrivable, mais des lignes lisibles » du §4.8 : le tableau est rendu
	// ENTIER, et le dit en tête. Le masquer se lirait comme un tableau complet qui ne l'est pas.
	'costs.pending.readonly.all':
		'Aucune de ces lignes ne peut être modifiée avec vos droits : ce tableau est en lecture seule.',
	'costs.pending.readonly.line': 'Vous ne pouvez pas modifier cette affaire.',
	// « Zéro est une valeur, pas un vide » (§4.8), écrite SOUS le tableau et non supposée comprise.
	'costs.pending.zero.notice':
		'Saisir 0 signifie « finalement rien dépensé » et retire la ligne de l’attente ; laisser le champ vide la laisse en attente.',
	// La consigne clavier est la raison d'être de cet écran (§5.31) : elle est ÉCRITE, jamais
	// devinée. Un geste qui n'existe qu'au clavier doit être annoncé (§5.29).
	'costs.pending.keyboard.notice':
		'Entrée enregistre la ligne et place le curseur sur la suivante ; Échap annule la saisie en cours.',
	// Le nom accessible du champ NOMME sa ligne : « Réel » répété sur douze lignes ne dirait pas
	// laquelle on saisit (§5.29, commandes répétées d'une liste).
	'costs.pending.field.aria': 'Coût réel de la ligne {nom}',
	// Les trois mentions du §5.7 ter, sous le champ et dans la ligne, jamais deux à la fois.
	'costs.pending.saving': 'Enregistrement…',
	'costs.pending.saved': 'Enregistré',
	'costs.pending.invalid': 'Ce montant n’est pas un nombre.',
	// La troisième issue : `200` et zéro ligne, ni un succès ni une erreur (§4.8.1).
	'costs.pending.refus.sans-effet':
		'Aucune ligne n’a été enregistrée. Vos droits ont peut-être changé depuis l’ouverture : rechargez l’onglet.',
	'costs.pending.refus.forbidden': 'Vous ne pouvez pas modifier cette affaire.',
	'costs.pending.refus.montant-hors-echelle': 'Ce montant est trop grand pour être enregistré.',
	'costs.pending.refus.forme-refusee': 'Cette valeur a été refusée par la base.',
	'costs.pending.refus.reference-absente':
		'Cette ligne n’existe plus. Rechargez l’onglet pour repartir de l’état réel.',
	'costs.pending.refus.network': 'La requête n’a pas abouti. Réessayez.',
	'costs.pending.refus.unknown': 'L’enregistrement a échoué.',

	// --- CRM-063 sous-tranche 2b : l'écran des modèles d'emails ---------------------------------
	// docs/SPEC-modeles-emails.md §9, docs/DESIGN_SYSTEM.md §5.39.
	'admin.mailTemplates.title': 'Modèles d’emails',
	'admin.settings.index.mailTemplates': 'Modèles d’emails',
	'admin.settings.index.mailTemplates.body':
		'Écrire les textes réutilisables, à trous, et les prévisualiser sur une affaire réelle.',
	'admin.mailTemplates.aria': 'Administration des modèles d’emails',
	'admin.mailTemplates.live.aria': 'Modèles d’emails',
	'admin.mailTemplates.noWorkspace.title': 'Aucun espace de travail',
	'admin.mailTemplates.noWorkspace.body':
		'Les modèles d’emails appartiennent à un espace de travail, et aucun n’est accessible.',
	'admin.mailTemplates.error.title': 'Les modèles n’ont pas pu être chargés',
	'admin.mailTemplates.error.body':
		'La liste des modèles d’emails n’a pas pu être lue. Réessayez ; si le problème persiste, la pile est peut-être arrêtée.',
	'admin.mailTemplates.error.retry': 'Réessayer',
	'admin.mailTemplates.empty.title': 'Aucun modèle d’email',
	'admin.mailTemplates.empty.body':
		'Un modèle est un texte réutilisable, à trous, partagé par tout l’espace de travail.',
	'admin.mailTemplates.open': 'Nouveau modèle',
	'admin.mailTemplates.edit': 'Modifier',
	'admin.mailTemplates.edit.aria': 'Modifier le modèle {modele}',
	'admin.mailTemplates.preview': 'Prévisualiser',
	'admin.mailTemplates.preview.aria': 'Prévisualiser le modèle {modele}',
	'admin.mailTemplates.saved': 'Modèle enregistré.',
	'admin.mailTemplates.deleted': 'Modèle supprimé.',
	// La fiche — §9.3, §9.8.
	'admin.mailTemplates.form.title.new': 'Nouveau modèle',
	'admin.mailTemplates.form.title.edit': 'Modifier le modèle',
	'admin.mailTemplates.field.name': 'Nom',
	'admin.mailTemplates.field.name.help':
		'Le nom identifie le modèle dans la liste. Il est unique dans l’espace de travail.',
	'admin.mailTemplates.field.subject': 'Objet',
	'admin.mailTemplates.field.body': 'Corps du message',
	'admin.mailTemplates.save': 'Enregistrer',
	'admin.mailTemplates.saving': 'Enregistrement…',
	'admin.mailTemplates.cancel': 'Annuler',
	// La palette — §9.3. Le nom accessible dit ce que le bouton FAIT, jamais seulement la variable.
	'admin.mailTemplates.variables.title': 'Variables disponibles',
	'admin.mailTemplates.variables.body':
		'Ces trous sont remplacés à l’envoi par la valeur de l’affaire. Un clic insère la variable à l’endroit du curseur.',
	'admin.mailTemplates.variables.insert.aria': 'Insérer la variable {variable}',
	'admin.mailTemplates.variables.error':
		'La liste des variables n’a pas pu être lue. Les modèles restent modifiables, mais aucune variable n’est proposée.',
	// Les refus de la fiche — §9.8, dictionnaire fermé. Aucune phrase du serveur n'atteint l'écran.
	'admin.mailTemplates.refusal.forbidden':
		'Vous ne pouvez pas écrire de modèle : cette action est réservée à l’administration et au développement commercial.',
	'admin.mailTemplates.refusal.zeroLigne':
		'Aucun modèle n’a été enregistré. Vos droits ont peut-être changé depuis l’ouverture : rechargez l’onglet.',
	'admin.mailTemplates.refusal.subjectVariable':
		'L’objet emploie une variable qui n’existe pas. Reprenez-la dans la liste ci-dessous.',
	'admin.mailTemplates.refusal.bodyVariable':
		'Le corps emploie une variable qui n’existe pas. Reprenez-la dans la liste ci-dessous.',
	'admin.mailTemplates.refusal.name': 'Le nom doit faire de 1 à 120 caractères.',
	'admin.mailTemplates.refusal.subject': 'L’objet doit faire de 1 à 300 caractères.',
	'admin.mailTemplates.refusal.body': 'Le corps doit faire de 1 à 20 000 caractères.',
	'admin.mailTemplates.refusal.nameTaken': 'Ce nom est déjà employé par un autre modèle.',
	'admin.mailTemplates.refusal.session': 'Votre session a expiré. Reconnectez-vous, puis réessayez.',
	'admin.mailTemplates.refusal.network': 'La requête n’a pas abouti. Réessayez.',
	'admin.mailTemplates.refusal.unknown': 'L’enregistrement a échoué.',
	// La suppression — §9.7. La confirmation NOMME le modèle et n'annonce AUCUNE cascade.
	'admin.mailTemplates.delete': 'Supprimer ce modèle',
	'admin.mailTemplates.delete.confirm.title': 'Supprimer « {modele} » ?',
	'admin.mailTemplates.delete.confirm.body': 'Le texte du modèle est définitivement perdu.',
	'admin.mailTemplates.delete.confirm.action': 'Supprimer définitivement',
	'admin.mailTemplates.delete.cancel': 'Annuler',
	'admin.mailTemplates.delete.refusal.zeroLigne':
		'Aucun modèle n’a été supprimé. Vos droits ont peut-être changé depuis l’ouverture : rechargez l’onglet.',
	// La prévisualisation — §9.5, §9.6.
	'admin.mailTemplates.previewPane.title': 'Prévisualisation de « {modele} »',
	'admin.mailTemplates.previewPane.card': 'Affaire',
	'admin.mailTemplates.previewPane.card.none': 'Choisissez une affaire',
	'admin.mailTemplates.previewPane.contact': 'Contact',
	'admin.mailTemplates.previewPane.contact.none': 'Aucun contact',
	'admin.mailTemplates.previewPane.identity': 'Identité d’expédition',
	'admin.mailTemplates.previewPane.identity.none': 'Aucune identité',
	'admin.mailTemplates.previewPane.run': 'Prévisualiser',
	'admin.mailTemplates.previewPane.running': 'Rendu…',
	'admin.mailTemplates.previewPane.close': 'Fermer',
	'admin.mailTemplates.previewPane.subject': 'Objet',
	'admin.mailTemplates.previewPane.body': 'Corps',
	'admin.mailTemplates.previewPane.idle':
		'Choisissez une affaire, puis lancez le rendu pour voir le message tel qu’il partira.',
	'admin.mailTemplates.previewPane.empty':
		'Aucun rendu : choisissez une affaire, ou l’affaire choisie n’est plus lisible.',
	'admin.mailTemplates.previewPane.error':
		'Le rendu n’a pas abouti. Réessayez ; si le problème persiste, la pile est peut-être arrêtée.',
	// `variables_nulles` — §9.6. Le compte est en TOUTES LETTRES, dans son propre élément, et
	// l'accord se fait PAR CLÉ : « les 1 variables » serait faux (§10 du design system).
	'admin.mailTemplates.previewPane.nulls.one': '1 variable sans valeur',
	'admin.mailTemplates.previewPane.nulls.many': '{compte} variables sans valeur',
	'admin.mailTemplates.previewPane.nulls.body':
		'Ces variables sont rendues vides dans le message ci-dessus.',
	// LA CONFIRMATION DE SUPPRESSION, RÉVISÉE PAR LA SOUS-TRANCHE 4c — §13.9. Elle annonce la RÈGLE
	// sans compter : l'écran des modèles ne lit pas `mail_sequence_steps`, et un nombre lu pour
	// l'occasion pourrait changer entre la lecture et le geste.
	'admin.mailTemplates.delete.confirm.sequenceRule':
		'Un modèle employé par une séquence de relance ne peut pas être supprimé.',
	'admin.mailTemplates.refusal.templateUsed':
		'Ce modèle est employé par une séquence de relance et ne peut pas être supprimé. Retirez-le de ses paliers, puis réessayez.',

	// --- CRM-063 sous-tranche 4c : l'écran des séquences de relance -----------------------------
	// docs/SPEC-modeles-emails.md §13, docs/DESIGN_SYSTEM.md §5.41.
	'admin.sequences.title': 'Séquences de relance',
	'admin.settings.index.sequences': 'Séquences de relance',
	'admin.settings.index.sequences.body':
		'Enchaîner plusieurs modèles à des délais choisis, pour relancer une affaire qui ne répond plus.',
	'admin.sequences.aria': 'Administration des séquences de relance',
	'admin.sequences.live.aria': 'Séquences de relance',
	'admin.sequences.noWorkspace.title': 'Aucun espace de travail',
	'admin.sequences.noWorkspace.body':
		'Les séquences de relance appartiennent à un espace de travail, et aucun n’est accessible.',
	'admin.sequences.error.title': 'Les séquences n’ont pas pu être chargées',
	'admin.sequences.error.body':
		'La liste des séquences de relance n’a pas pu être lue. Réessayez ; si le problème persiste, la pile est peut-être arrêtée.',
	'admin.sequences.error.retry': 'Réessayer',
	'admin.sequences.empty.title': 'Aucune séquence de relance',
	'admin.sequences.empty.body':
		'Une séquence enchaîne plusieurs modèles à des délais choisis. Elle s’arme depuis une affaire qui ne répond plus.',
	'admin.sequences.open': 'Nouvelle séquence',
	'admin.sequences.edit': 'Modifier',
	'admin.sequences.edit.aria': 'Modifier la séquence {sequence}',
	'admin.sequences.saved': 'Séquence enregistrée.',
	'admin.sequences.deleted': 'Séquence supprimée.',
	'admin.sequences.reordered': 'Ordre des paliers enregistré.',
	// LE COMPTE EST EN TOUTES LETTRES, ET L'ACCORD SE FAIT PAR CLÉ (§10) : « 1 paliers » serait faux.
	'admin.sequences.steps.none': 'aucun palier',
	'admin.sequences.steps.one': '1 palier',
	'admin.sequences.steps.many': '{compte} paliers',
	// La fiche — §13.6.
	'admin.sequences.form.title.new': 'Nouvelle séquence',
	'admin.sequences.form.title.edit': 'Modifier la séquence',
	'admin.sequences.field.name': 'Nom',
	'admin.sequences.save': 'Enregistrer',
	'admin.sequences.saving': 'Enregistrement…',
	'admin.sequences.cancel': 'Annuler',
	// La zone des paliers — §13.6.
	'admin.sequences.steps.title': 'Paliers',
	'admin.sequences.steps.help':
		'Chaque palier envoie un modèle après un délai compté depuis le palier précédent — le premier depuis l’armement.',
	'admin.sequences.steps.deferred': 'Enregistrez la séquence pour lui ajouter des paliers.',
	'admin.sequences.steps.empty':
		'Aucun palier. Une séquence sans palier n’envoie rien et ne peut pas être armée.',
	'admin.sequences.steps.error':
		'Les paliers n’ont pas pu être lus. Fermez la fiche et rouvrez-la pour réessayer.',
	'admin.sequences.steps.field.template': 'Modèle',
	'admin.sequences.steps.field.template.none': 'Choisissez un modèle',
	'admin.sequences.steps.field.delay': 'Délai (jours)',
	'admin.sequences.steps.add': 'Ajouter le palier',
	'admin.sequences.steps.added': 'Palier ajouté.',
	'admin.sequences.steps.removed': 'Palier retiré.',
	// Les noms accessibles NOMMENT le palier : deux flèches identiques répétées sur trois lignes ne
	// diraient pas ce que chacune déplace (§5.41).
	'admin.sequences.steps.up.aria': 'Monter le palier {palier}',
	'admin.sequences.steps.down.aria': 'Descendre le palier {palier}',
	'admin.sequences.steps.remove.aria': 'Retirer le palier {palier}',
	// Les refus — §13.7, dictionnaire fermé. Aucune phrase du serveur n'atteint l'écran.
	'admin.sequences.refusal.forbidden':
		'Vous ne pouvez pas écrire de séquence : cette action est réservée à l’administration et au développement commercial.',
	'admin.sequences.refusal.zeroLigne':
		'Aucune séquence n’a été enregistrée. Vos droits ont peut-être changé depuis l’ouverture : rechargez l’onglet.',
	'admin.sequences.refusal.name': 'Le nom doit faire de 1 à 120 caractères.',
	'admin.sequences.refusal.nameTaken': 'Ce nom est déjà employé par une autre séquence.',
	'admin.sequences.refusal.delay': 'Le délai doit faire de 1 à 365 jours.',
	'admin.sequences.refusal.position': 'Une séquence porte au plus 50 paliers.',
	'admin.sequences.refusal.positionTaken':
		'Un palier occupe déjà ce rang. Rechargez l’onglet pour repartir de l’état réel.',
	'admin.sequences.refusal.order':
		'L’ordre envoyé ne décrit plus cette séquence. Rechargez l’onglet pour repartir de l’état réel.',
	'admin.sequences.refusal.armed':
		'Cette séquence relance actuellement une affaire et ne peut pas être supprimée. Interrompez la relance depuis l’affaire, puis réessayez.',
	'admin.sequences.refusal.templateGone':
		'Ce modèle n’existe plus. Rechargez l’onglet pour repartir de l’état réel.',
	'admin.sequences.refusal.session': 'Votre session a expiré. Reconnectez-vous, puis réessayez.',
	'admin.sequences.refusal.network': 'La requête n’a pas abouti. Réessayez.',
	'admin.sequences.refusal.unknown': 'L’enregistrement a échoué.',
	'admin.sequences.reorder.refusal.zeroLigne':
		'Aucun palier n’a été réordonné. Vos droits ont peut-être changé depuis l’ouverture : rechargez l’onglet.',
	'admin.sequences.steps.refusal.zeroLigne':
		'Aucun palier n’a été ajouté. Vos droits ont peut-être changé depuis l’ouverture : rechargez l’onglet.',
	'admin.sequences.steps.remove.refusal.zeroLigne':
		'Aucun palier n’a été retiré. Vos droits ont peut-être changé depuis l’ouverture : rechargez l’onglet.',
	// La suppression — §13.6. La confirmation NOMME la séquence, ANNONCE la cascade comptée depuis
	// la donnée déjà lue, et dit la règle qu'elle ne peut pas promettre — sans chiffre.
	'admin.sequences.delete': 'Supprimer cette séquence',
	'admin.sequences.delete.confirm.title': 'Supprimer « {sequence} » ?',
	'admin.sequences.delete.confirm.noSteps': 'Cette séquence ne porte aucun palier.',
	'admin.sequences.delete.confirm.oneStep': 'Son palier sera supprimé avec elle.',
	'admin.sequences.delete.confirm.manySteps': 'Ses {compte} paliers seront supprimés avec elle.',
	'admin.sequences.delete.confirm.armedRule':
		'Une séquence qui relance actuellement une affaire ne peut pas être supprimée.',
	'admin.sequences.delete.confirm.action': 'Supprimer définitivement',
	'admin.sequences.delete.cancel': 'Annuler',
	'admin.sequences.delete.refusal.zeroLigne':
		'Aucune séquence n’a été supprimée. Vos droits ont peut-être changé depuis l’ouverture : rechargez l’onglet.',

	// --- CRM-063 sous-tranche 4c : armer une relance depuis l'affaire ---------------------------
	// docs/SPEC-modeles-emails.md §13.8, docs/DESIGN_SYSTEM.md §5.42.
	'card.sequence.title': 'Relance automatique',
	'card.sequence.help':
		'Une séquence enchaîne plusieurs modèles à des délais choisis. Elle s’arrête dès qu’une réponse arrive.',
	'card.sequence.field.sequence': 'Séquence',
	'card.sequence.field.sequence.none': 'Choisissez une séquence',
	'card.sequence.field.identity': 'Adresse d’expédition',
	'card.sequence.field.identity.none': 'Choisissez une adresse',
	'card.sequence.arm': 'Armer la relance',
	'card.sequence.arming': 'Armement…',
	'card.sequence.armed': 'Relance armée.',
	'card.sequence.stop': 'Interrompre la relance',
	'card.sequence.stopping': 'Interruption…',
	'card.sequence.stopped': 'Relance interrompue.',
	'card.sequence.empty':
		'Aucune relance n’est armée sur cette affaire.',
	'card.sequence.noSequences':
		'Aucune séquence de relance n’est définie. Créez-en une dans les réglages.',
	'card.sequence.noIdentities':
		'Aucune adresse d’expédition ne vous est ouverte. Déclarez-en une dans les réglages.',
	'card.sequence.error':
		'L’état de la relance n’a pas pu être lu. Rechargez la page pour réessayer.',
	// L'état d'une inscription active — §13.8. AUCUNE DATE DE PROCHAIN ENVOI : la cadence glisse sur
	// l'envoi réel, et une échéance affichée serait fausse dès qu'un passage manquerait.
	'card.sequence.active.sequence': 'Séquence : {sequence}',
	'card.sequence.active.identity': 'Expédiée depuis {adresse}',
	'card.sequence.active.noStepSent': 'Aucun palier envoyé pour l’instant.',
	'card.sequence.active.lastStep': 'Palier {position} envoyé le {date}.',
	// Les refus de l'armement — §13.8, dictionnaire fermé et MESURÉ.
	'card.sequence.refusal.alreadyArmed':
		'Une relance est déjà armée sur cette affaire. Interrompez-la avant d’en armer une autre.',
	'card.sequence.refusal.notStalled':
		'Cette affaire n’a pas dépassé le seuil d’inactivité de son étape. Une relance ne s’arme que sur une affaire qui n’avance plus.',
	'card.sequence.refusal.emptySequence':
		'Cette séquence ne porte aucun palier et n’enverrait rien.',
	'card.sequence.refusal.unavailableSequence': 'Cette séquence n’est pas disponible.',
	'card.sequence.refusal.noAddress':
		'L’adresse de réponse de cette affaire ne se compose pas. Les réponses ne reviendraient nulle part.',
	'card.sequence.refusal.identity':
		'Vous ne pouvez pas expédier depuis cette adresse. Choisissez-en une autre.',
	'card.sequence.refusal.forbidden': 'Vous ne pouvez pas écrire au nom de cette affaire.',
	'card.sequence.refusal.session': 'Votre session a expiré. Reconnectez-vous, puis réessayez.',
	'card.sequence.refusal.network': 'La requête n’a pas abouti. Réessayez.',
	'card.sequence.refusal.unknown': 'L’armement a échoué.',
	'card.sequence.stop.refusal.stillActive':
		'La relance n’a pas été interrompue. Vos droits ont peut-être changé depuis l’ouverture : rechargez la page.',

	// --- Palette de recherche de l'en-tête — CRM-065 sous-tranche 2b ---------------------------
	// docs/SPEC-recherche.md §14 ; docs/DESIGN_SYSTEM.md §5.46.
	//
	// LE LIBELLÉ DU CHAMP EST VISUELLEMENT MASQUÉ, JAMAIS RETIRÉ (§12.3) : l'icône et la place
	// disent déjà ce qu'il est, et un libellé visible dans une ligne d'en-tête déjà dense
	// pousserait le titre de route hors du cadre (§12.2).
	'search.field.label': 'Rechercher dans le CRM',
	'search.field.placeholder': 'Rechercher…',
	'search.field.shortcut': 'Ctrl+K',
	'search.open': 'Ouvrir la recherche',
	'search.panel.aria': 'Résultats de la recherche',
	// AUCUNE CLÉ « Fermer » : le panneau n'a ni barre de titre ni commande de fermeture, et c'est
	// l'écart au §5.43 que le §5.46 motive — le champ reste rendu au-dessus de lui et EST son
	// ancre, là où la cloche disparaîtrait derrière son propre panneau.
	// L'ÉTAT D'ARRIVÉE N'EST PAS UN VIDE (§14.4) : la phrase dit ce que la recherche cherche,
	// plutôt que d'annoncer une absence que personne n'a demandée.
	'search.idle': 'Cherchez une affaire, un contact, une organisation, un commentaire ou un message.',
	'search.loading': 'Recherche en cours',
	'search.empty': 'Aucun résultat pour ce terme.',
	'search.error.title': 'Recherche indisponible',
	'search.error.body': 'La recherche n’a pas abouti.',
	'search.error.retry': 'Réessayer',
	// LA TRONCATURE EST ÉCRITE, jamais laissée à deviner (§14.2) — la règle du §5.43 et du §5.15.
	'search.truncated': '{compte} résultats affichés.',
	// LES CINQ FAMILLES SONT DES MOTS, jamais des icônes ni des teintes (§1, §9). Ce sont des
	// libellés de PRODUIT et non des données : la base rend un discriminant technique — `affaire`,
	// `commentaire` — que le §10 interdit de laisser atteindre l'écran.
	'search.family.affaire': 'Affaire',
	'search.family.contact': 'Contact',
	'search.family.organisation': 'Organisation',
	'search.family.commentaire': 'Commentaire',
	'search.family.message': 'Message',
	// UNE LIGNE SANS DESTINATION RESTE RENDUE, SANS LIEN (§13.4). La mention dit le fait, elle
	// n'en nomme pas la cause : les trois causes possibles sont indistinguables, et les
	// distinguer divulguerait ce que la RLS ferme.
	'search.result.unreachable': 'Objet non atteignable',
	'search.result.untitled': 'Sans titre',
} as const

export type CleTraduction = keyof typeof fr
