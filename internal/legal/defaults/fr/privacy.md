# Politique de confidentialité

Dernière mise à jour : {{EFFECTIVE_DATE}}

{{OPERATOR}} (« nous ») sait que l'usage de vos données personnelles vous
importe, et nous prenons votre vie privée au sérieux. Cette politique explique
ce que nous collectons, pourquoi, comment nous le protégeons et les droits dont
vous disposez. {{OPERATOR}} est le responsable du traitement des données
personnelles décrites ici.

## Quelles données nous collectons

**Données de compte.** Votre adresse e-mail, une empreinte de votre mot de passe
(nous ne conservons jamais le mot de passe lui-même), la vérification ou non de
l'adresse, votre qualité d'administrateur, et les dates de création et de
dernière modification du compte.

**Vos contenus.** Tout ce que vous saisissez dans le service : actions,
contextes, projets, notes, étiquettes, récurrences et fichiers joints. Nous les
traitons comme privés à votre compte.

**Réglages.** Langue, fuseau horaire, format de date, thème.

**Données de sécurité.** Les tentatives de connexion échouées sur votre adresse,
afin de verrouiller un compte attaqué ; les données nécessaires à la
vérification de l'authentification à deux facteurs ou d'une clé d'accès si vous
en activez une ; et vos sessions actives, stockées sous forme d'empreintes avec
l'adresse et le navigateur vus en dernier.

**Journaux serveur.** Les requêtes sont journalisées avec une adresse IP, un
horodatage, le chemin et le code de réponse, afin d'exploiter, déboguer et
protéger le service des abus.

**Journal d'audit.** Les événements liés à la sécurité — connexions et échecs de
connexion, réinitialisations de mot de passe, changements d'adresse et de
second facteur, créations et suppressions de comptes, et chaque action d'un
administrateur sur un compte — sont enregistrés avec l'adresse concernée,
l'heure, l'adresse IP et le navigateur. Il ne contient jamais de mot de passe,
de jeton ni aucun autre secret.

Nous n'utilisons ni analytique, ni publicité, ni pixels de suivi, ni scripts
tiers. Nous n'établissons aucun profil et ne prenons aucune décision
automatisée à votre égard.

## Comment nous collectons vos données

L'essentiel, vous nous le fournissez directement : lorsque vous vous inscrivez,
vous connectez, modifiez un réglage ou créez du contenu dans le service. Une
partie est enregistrée automatiquement à mesure que vous l'utilisez — votre
adresse IP, votre navigateur et les événements de sécurité et d'audit ci-dessus
— parce que l'exploitation et la sécurisation du service l'exigent.

## Comment nous utilisons vos données, et sur quelle base

- **Fournir le service** — exécution de notre contrat avec vous. Cela couvre
  votre compte, vos contenus et vos réglages.
- **Sécuriser le service** — notre intérêt légitime à prévenir les abus, le
  bourrage d'identifiants et la fraude, et à pouvoir rendre compte des actions
  d'administration. Cela couvre les données de sécurité, les journaux serveur et
  le journal d'audit.
- **Vous contacter à propos de votre compte** — exécution du contrat :
  vérification, réinitialisation de mot de passe, changement d'adresse et avis
  de sécurité.
- **Respecter une obligation légale**, le cas échéant.

## Qui d'autre voit vos données

**Notre fournisseur d'e-mail** traite les messages que nous vous envoyons —
votre adresse et le contenu du message — en tant que sous-traitant, sur nos
seules instructions.

**Notre hébergeur** exploite les serveurs sur lesquels le service fonctionne.

C'est la liste complète. Nous ne vendons aucune donnée personnelle et ne la
partageons avec personne pour ses propres finalités. Nous ne communiquons de
données aux autorités que lorsque la loi nous y contraint, et nous vous en
informons sauf interdiction.

## Comment nous stockons et protégeons vos données

Le service et ses données sont hébergés en {{COUNTRY}}. Si cela devait changer
pour un pays hors EEE, nous utiliserions un mécanisme de transfert licite et
mettrions cette politique à jour au préalable.

Les mots de passe sont hachés avec Argon2id et les jetons de session sont
stockés sous forme d'empreintes, jamais en clair. L'authentification à deux
facteurs et les clés d'accès sont disponibles sur chaque compte. Les tentatives
de connexion sont limitées par adresse et par source, et une adresse est
temporairement verrouillée après des échecs répétés. Le trafic est servi en
HTTPS, et chaque requête est cantonnée au compte propriétaire des données. Aucun
service n'est parfaitement sûr ; si une violation présente un risque pour vos
droits, nous vous en informerons ainsi que l'autorité de contrôle, comme
l'exige le RGPD.

Nous ne conservons vos données que le temps nécessaire :

- **Votre compte et vos contenus** — jusqu'à leur suppression par vous ;
  supprimer votre compte les efface immédiatement.
- **Tentatives de connexion échouées** — supprimées automatiquement après 24
  heures.
- **Sessions** — les jetons de rafraîchissement expirent après 30 jours et sont
  détruits à la déconnexion, au changement de mot de passe ou d'adresse.
- **Liens de vérification, d'invitation, de réinitialisation et de suppression**
  — à usage unique, expirant en quelques heures.
- **Journal d'audit** — conservé pendant la durée configurée par l'exploitant,
  puis supprimé automatiquement. Parce qu'il sert à rendre compte des actions de
  sécurité et d'administration, il n'est **pas** supprimé avec le compte, et ses
  entrées ne sont jamais modifiées ni supprimées à la main.
- **Journaux serveur** — conservés une courte durée d'exploitation, puis
  supprimés.
- **Sauvegardes** — un compte supprimé peut subsister brièvement dans une
  sauvegarde avant sa rotation ; les sauvegardes ne servent qu'à rétablir le
  service.

## Prospection

Nous n'envoyons aucune prospection et ne transmettons vos coordonnées à personne
à des fins de prospection. Il n'y a rien ici à accepter ni à refuser.

## Vos droits en matière de protection des données

Le RGPD vous confère le droit :

- d'**être informé** de l'usage de vos données — cette politique ;
- d'**accès** à vos données — les Réglages contiennent un export, une archive
  zip réunissant un JSON structuré et tous vos fichiers ;
- de **rectification** — modifiez vos contenus et changez votre adresse e-mail
  depuis les Réglages ;
- d'**effacement** — la zone de danger en bas des Réglages supprime votre compte
  après confirmation par un lien envoyé à votre adresse, effaçant compte,
  identifiants, sessions, données de double authentification, préférences,
  actions, projets, notes, étiquettes, récurrences et pièces jointes ; c'est
  irréversible ;
- de **limitation** du traitement ou d'**opposition** à celui-ci ;
- de **portabilité** — le même export y pourvoit.

Vous pouvez exercer vous-même l'accès, la rectification, la portabilité et
l'effacement depuis les Réglages, immédiatement. Pour tout le reste, écrivez à
{{CONTACT_EMAIL}} ; nous répondons sous un mois.

## Cookies

Ce service ne dépose aucun cookie. Le peu qu'il stocke dans votre navigateur, et
pourquoi cela ne requiert aucun consentement, est expliqué dans la
[politique relative aux cookies](/cookies) distincte.

## Autres sites

Le service ne renvoie qu'à ses propres pages. Lorsque nous nommons un
sous-traitant (notre fournisseur d'e-mail ou notre hébergeur), sa propre
politique régit ce qu'il fait ; la présente politique ne couvre que ce que nous
faisons.

## Mineurs

Le service ne s'adresse pas aux personnes de moins de 16 ans et nous ne
collectons pas sciemment leurs données. Si vous pensez qu'un mineur possède un
compte, signalez-le et nous le supprimerons.

## Modifications de cette politique

Cette politique peut changer. Les changements importants seront annoncés dans
l'application avant leur entrée en vigueur ; si vous n'êtes pas d'accord avec une
modification, vous pouvez supprimer votre compte à tout moment depuis les
Réglages.

## Comment nous contacter

Pour toute question sur cette politique ou toute demande relative à vos données,
écrivez à {{OPERATOR}}, {{ADDRESS}} — {{CONTACT_EMAIL}}.

## Comment contacter l'autorité

Si vous estimez que nous n'avons pas traité vos données correctement, vous avez
le droit d'introduire une réclamation auprès de votre autorité nationale de
protection des données en {{COUNTRY}}.
