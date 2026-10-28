# Panasonic Aquarea

Cette intégration amène votre pompe à chaleur air-eau **Panasonic Aquarea**
dans Gladys, de l'une de ces deux façons :

- **Aquarea Smart Cloud**, le cloud Panasonic, pour une pompe à chaleur reliée
  par un adaptateur CZ-TAW1 ou CZ-TAW1B et visible dans l'application
  Panasonic Comfort Cloud ;
- **HeishaMon**, une petite carte libre branchée sur le port CN-CNT de la pompe
  à chaleur, lue en local : par votre broker MQTT, ou directement par sa page
  web.

Vous obtenez les températures et consignes des zones de chauffage, le ballon
d'eau chaude, la température extérieure, le mode, les modes silencieux et
puissance, le dégivrage, le code erreur (aussi déclencheur de scène) et
l'énergie pour les tableaux de bord énergie de Gladys. Non officiel, sans lien
avec Panasonic.

> **Version de développement (0.1).** Développée et testée sans pompe à
> chaleur : le cloud Panasonic et HeishaMon ont été simulés d'après la
> documentation des projets qui les utilisent (intégrations Home Assistant,
> HeishaMon). Vos retours sont les bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

Un appareil Gladys par pompe à chaleur, avec les fonctionnalités qu'elle
remonte :

| Fonctionnalité                                     | Cloud | HeishaMon | Dans Gladys                                               |
| -------------------------------------------------- | :---: | :-------: | --------------------------------------------------------- |
| Marche/arrêt de la pompe à chaleur                 |   ✓   |     ✓     | un interrupteur                                           |
| Mode de chauffage : arrêt, chauffage, froid, auto  |   ✓   |     ✓     | un mode de thermostat                                     |
| Activité : au repos, chauffe, refroidit            |   ✓   |     ✓     | l'état de fonctionnement du thermostat                    |
| Température des zones 1 et 2                       |   ✓   |     ✓     | des températures                                          |
| Consignes des zones, chauffage et refroidissement  |   ✓   |     ✓     | des consignes de thermostat (un décalage sur une courbe)  |
| Température et consigne du ballon d'eau chaude     |   ✓   |     ✓     | une température et une consigne de chauffe-eau            |
| Chauffe de l'eau chaude                            |   ✓   |     ✓     | l'état « en chauffe » du chauffe-eau                      |
| Température extérieure                             |   ✓   |     ✓     | une température (hors moyenne de la pièce)                |
| Températures de départ et de retour d'eau          |       |     ✓     | des températures (hors moyenne de la pièce)               |
| Fréquence du compresseur (Hz)                      |       |     ✓     | une valeur                                                |
| Puissance consommée (W) et énergie consommée (kWh) |       |     ✓     | puissance et index d'énergie (tableaux de bord énergie)   |
| Chaleur produite (W)                               |       |     ✓     | une valeur en W                                           |
| Consommation par jour (kWh)                        |   ✓   |           | une consommation journalière (tableaux de bord énergie)   |
| Mode silencieux (arrêt, niveaux 1 à 3)             |   ✓   |     ✓     | une liste modifiable                                      |
| Mode puissance (arrêt, 30, 60, 90 min)             |   ✓   |     ✓     | une liste (en lecture seule pour l'instant)               |
| Dégivrage                                          |   ✓   |     ✓     | marche/arrêt (lecture seule)                              |
| Code erreur (H62, F12…)                            |   ✓   |     ✓     | un texte, et le déclencheur de scène « Erreur de la PAC » |

## Prérequis

- Gladys Assistant 5.2.0 ou plus récent.
- **Cloud** : votre Panasonic ID (adresse e-mail et mot de passe), avec la
  pompe à chaleur visible dans l'application **Panasonic Comfort Cloud** ;
  Gladys doit accéder à Internet.
- **HeishaMon** : une carte HeishaMon sur la pompe à chaleur, connectée à votre
  Wi-Fi. Idéalement avec un broker MQTT (Mosquitto…) sur lequel la carte
  publie ; sans broker, Gladys lit la page web de la carte.

## Installation

### Avec Aquarea Smart Cloud

1. Vérifiez que la pompe à chaleur apparaît dans l'application Panasonic
   Comfort Cloud avec votre Panasonic ID.
2. Dans Gladys, ouvrez l'intégration, **Configuration**, section **Aquarea
   Smart Cloud** : saisissez votre **Panasonic ID** et son **mot de passe**,
   enregistrez.
3. Si votre Panasonic ID utilise la **double authentification**, le statut
   demande un code : cliquez sur **Envoyer un code de double
   authentification**, saisissez le code actuel de votre application
   d'authentification.
4. Ouvrez l'onglet **Découverte** : votre pompe à chaleur y est, ajoutez-la.

### Avec HeishaMon et un broker MQTT

1. Dans la page web de HeishaMon (**Settings**), vérifiez le **serveur MQTT**
   (votre broker) et le **topic de base MQTT** (`panasonic_heat_pump` par
   défaut).
2. Dans Gladys, section **HeishaMon** : saisissez l'adresse du broker vue
   depuis la machine Gladys (`mqtt://192.168.1.10:1883`, pas localhost), le
   topic de base, et l'utilisateur et le mot de passe du broker s'il en a.
   Plusieurs pompes à chaleur : séparez leurs topics de base par des virgules.
3. Onglet **Découverte** : la pompe à chaleur apparaît aussitôt (HeishaMon
   garde ses dernières valeurs sur le broker), ajoutez-la.

### Avec HeishaMon, sans broker

Saisissez l'adresse de la carte elle-même dans **Adresse du broker MQTT ou de
HeishaMon** : `http://192.168.1.30`. Gladys lit sa page toutes les 30 secondes
par défaut (option ci-dessous) et lui envoie les commandes.

Le bouton **Tester la connexion** lit la pompe à chaleur avec la configuration
enregistrée et résume ce qu'il a trouvé.

## Options

- **Intervalle entre deux lectures du cloud** : 2 minutes par défaut (de 1
  minute à 1 heure). Panasonic limite les appels d'un compte : n'allez pas plus
  vite que nécessaire. La consommation par jour est lue une fois par heure.
- **Version de l'application (avancé)** : laissez vide. Seulement si Panasonic
  refuse la version annoncée par l'intégration, saisissez la version de
  l'application Comfort Cloud (par exemple `4.3.0`).
- **Vérifier le certificat TLS** : à désactiver pour un broker `mqtts://` au
  certificat auto-signé.
- **Intervalle entre deux lectures de la page HeishaMon** : sans broker
  seulement.
- **Intervalle minimum entre deux mesures d'une grandeur** : 30 secondes par
  défaut. Températures et puissances changent toutes les quelques secondes sur
  une pompe à chaleur en marche : Gladys garde la dernière à ce rythme. Modes,
  consignes et marche/arrêt ne sont jamais retardés.
- **Plafond de l'eau chaude (°C)** : risque de brûlure. Gladys ne règle jamais
  l'eau chaude au-dessus de cette température : 65 °C par défaut, de 40 à
  65 °C, jamais plus de 65 °C quoi qu'on saisisse. Une limite plus basse de la
  pompe à chaleur s'applique toujours.
- **Langue des noms des fonctionnalités** : français ou anglais.
- **Préférer la connexion locale** (interrupteur de Gladys) : quand le cloud et
  HeishaMon sont tous deux renseignés, activé = HeishaMon, désactivé = le
  cloud. Une pompe à chaleur lue par le cloud et par HeishaMon fait deux
  appareils différents dans Gladys.

## Bon à savoir

- **Le mode** est celui des pièces : **Arrêt** coupe le chauffage des pièces
  mais garde l'eau chaude si la pompe à chaleur en produit (HeishaMon : « ECS
  seule » ; cloud : zones arrêtées, ballon conservé). Pour tout arrêter,
  utilisez **Marche/arrêt de la pompe à chaleur**. Choisir chauffage, froid ou
  auto garde l'eau chaude comme elle était et met la pompe à chaleur en marche
  si besoin.
- **Consigne d'eau chaude** : en degrés entiers, du plancher de la pompe à
  chaleur (40 °C avec HeishaMon) au plafond des options (65 °C par défaut,
  **jamais au-dessus de 65 °C**), même si HeishaMon accepte jusqu'à 75 °C. Une
  valeur plus haute est ramenée au plafond ; une limite plus basse de la pompe
  à chaleur (le cloud en donne une) l'emporte. Une consigne déjà réglée plus
  haut sur l'appareil est affichée telle quelle, mais Gladys ne la réécrit
  jamais au-dessus du plafond. Si la pompe à chaleur ne descend pas jusqu'au
  plafond (son propre minimum est plus haut), Gladys n'écrit plus la consigne
  d'eau chaude. Un nouveau plafond s'applique aux commandes dès que la
  configuration est enregistrée ; le curseur d'un appareil déjà créé ne
  change qu'après **Mettre à jour** dans l'onglet **Découverte**.
- **Consignes sur une loi d'eau** : quand une zone suit une courbe de chauffe,
  sa consigne est un **décalage** de la courbe, de −5 à +5 °C (nommée
  « Décalage (courbe) ») ; en mode direct c'est la température de l'eau. Sur
  HeishaMon, une zone régulée par un thermostat d'ambiance en mode direct garde
  sa consigne dans les réglages de la courbe : pas encore géré.
- **Le froid** est proposé sur toute pompe à chaleur HeishaMon (HeishaMon ne
  dit pas si l'installateur l'a activé) ; sur le cloud, seulement si la pompe à
  chaleur le gère. Une pompe à chaleur sans froid ignore les commandes de
  froid.
- **Énergie** : par HeishaMon, la puissance consommée (chauffage, froid et eau
  chaude, ou les valeurs plus précises des pompes à chaleur récentes) est
  cumulée en un index d'énergie en kWh, conservé aux redémarrages : ajoutez-le
  à vos tableaux de bord énergie. Par le cloud, Panasonic donne la
  consommation par jour : chaque journée terminée est envoyée l'heure suivante
  (la journée en cours n'est pas complète).
- **Le déclencheur d'erreur** se déclenche quand la pompe à chaleur signale un
  **nouveau** code erreur, pas pour celui déjà présent au démarrage de
  l'intégration. Filtrez sur la pompe à chaleur et sur un code (H62…) dans la
  scène.
- **Badges** : un point orange quand l'adaptateur cloud ne répond pas en direct
  (les valeurs sont alors la copie gardée par le cloud), quand HeishaMon est
  hors ligne, ou quand il n'a rien envoyé depuis 15 minutes.

## Dépannage

- **« Panasonic a refusé le Panasonic ID ou le mot de passe »** : vérifiez-les
  dans l'application Comfort Cloud, puis enregistrez à nouveau la
  configuration. L'intégration ne réessaie pas seule, pour ne pas bloquer votre
  compte.
- **« nouvelles conditions d'utilisation »** : ouvrez l'application Panasonic
  Comfort Cloud et acceptez-les.
- **La pompe à chaleur manque côté cloud** : l'intégration se connecte comme
  l'application Panasonic Comfort Cloud : la pompe à chaleur doit y apparaître
  avec le même Panasonic ID.
- **HeishaMon : « aucune valeur sur panasonic_heat_pump/main/… »** : le broker
  répond, mais HeishaMon n'y publie pas : vérifiez son serveur MQTT et son
  topic de base.
- **HeishaMon est hors ligne** : la carte a envoyé son dernier message
  (alimentation, Wi-Fi).

## Vie privée

- **Cloud** : l'intégration ne parle qu'à Panasonic
  (`authglb.digital.panasonic.com`, `accsmart.panasonic.com`) et lit la version
  de l'application Comfort Cloud sur Google Play. Votre mot de passe n'est
  envoyé à Panasonic qu'à une connexion ; la session (jetons) est gardée dans
  le volume de l'intégration, jamais le mot de passe.
- **HeishaMon** : tout reste sur votre réseau local.
