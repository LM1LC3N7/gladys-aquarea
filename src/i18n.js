// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, badges) in English and
// French, and the names of the device features in the language of the
// configuration. Never put a token, a password or a code in one of them.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const deg = (value) => `${Math.round(value * 10) / 10} °C`;

const NAMES = {
  en: {
    device: 'Aquarea heat pump',
    binary: 'Heat pump on/off',
    mode: 'Heating mode',
    modes: { 0: 'Off', 1: 'Heating', 2: 'Cooling', 3: 'Auto' },
    operatingState: 'Heat pump activity',
    zoneTemperature: (id) => `Zone ${id} temperature`,
    setpoint: (id, kind, shift) =>
      `Zone ${id} ${kind === 'heat' ? 'heating' : 'cooling'} ${shift ? 'shift (curve)' : 'setpoint'}`,
    tankTemperature: 'Hot water tank temperature',
    tankSetpoint: 'Hot water setpoint',
    tankHeating: 'Heating the hot water',
    outdoor: 'Outdoor temperature',
    inlet: 'Water inlet temperature',
    outlet: 'Water outlet temperature',
    compressor: 'Compressor frequency (Hz)',
    consumedPower: 'Power consumed',
    consumedEnergy: 'Energy consumed',
    heatPower: 'Heat produced (thermal)',
    dailyConsumption: 'Consumption per day',
    quiet: 'Quiet mode',
    quietLevels: { 0: 'Off', 1: 'Level 1', 2: 'Level 2', 3: 'Level 3' },
    powerful: 'Powerful mode',
    powerfulLevels: { 0: 'Off', 1: '30 min', 2: '60 min', 3: '90 min' },
    defrost: 'Defrosting',
    error: 'Error code',
  },
  fr: {
    device: 'Pompe à chaleur Aquarea',
    binary: 'Marche/arrêt de la pompe à chaleur',
    mode: 'Mode de chauffage',
    modes: { 0: 'Arrêt', 1: 'Chauffage', 2: 'Refroidissement', 3: 'Auto' },
    operatingState: 'Activité de la pompe à chaleur',
    zoneTemperature: (id) => `Température zone ${id}`,
    setpoint: (id, kind, shift) =>
      `${shift ? 'Décalage (courbe)' : 'Consigne'} ${kind === 'heat' ? 'chauffage' : 'refroidissement'} zone ${id}`,
    tankTemperature: 'Température du ballon d’eau chaude',
    tankSetpoint: 'Consigne eau chaude',
    tankHeating: 'Chauffe de l’eau chaude',
    outdoor: 'Température extérieure',
    inlet: 'Température de retour d’eau',
    outlet: 'Température de départ d’eau',
    compressor: 'Fréquence du compresseur (Hz)',
    consumedPower: 'Puissance consommée',
    consumedEnergy: 'Énergie consommée',
    heatPower: 'Chaleur produite (thermique)',
    dailyConsumption: 'Consommation par jour',
    quiet: 'Mode silencieux',
    quietLevels: { 0: 'Arrêt', 1: 'Niveau 1', 2: 'Niveau 2', 3: 'Niveau 3' },
    powerful: 'Mode puissance',
    powerfulLevels: { 0: 'Arrêt', 1: '30 min', 2: '60 min', 3: '90 min' },
    defrost: 'Dégivrage',
    error: 'Code erreur',
  },
};

/** The feature names of a language. */
export const names = (language) => NAMES[language] ?? NAMES.en;

/** A short line about a heat pump read by a test: its main values. */
function summary(snapshot, lang) {
  const n = NAMES[lang];
  const parts = [];
  if (typeof snapshot.mode === 'number') {
    parts.push(n.modes[snapshot.mode].toLowerCase());
  }
  if (typeof snapshot.outdoor === 'number') {
    parts.push(`${lang === 'fr' ? 'extérieur' : 'outdoor'} ${deg(snapshot.outdoor)}`);
  }
  const zone = snapshot.zones?.find((z) => typeof z.temperature === 'number');
  if (zone) {
    parts.push(`zone ${zone.id} ${deg(zone.temperature)}`);
  }
  if (typeof snapshot.outlet === 'number') {
    parts.push(`${lang === 'fr' ? 'départ' : 'outlet'} ${deg(snapshot.outlet)}`);
  }
  if (typeof snapshot.tank?.temperature === 'number') {
    parts.push(`${lang === 'fr' ? 'ballon' : 'tank'} ${deg(snapshot.tank.temperature)}`);
  }
  if (snapshot.error?.code) {
    parts.push(`${lang === 'fr' ? 'erreur' : 'error'} ${snapshot.error.code}`);
  }
  const name = snapshot.name || snapshot.platformId;
  const model = snapshot.model ? ` (${snapshot.model})` : '';
  return `${name}${model}: ${parts.join(', ') || (lang === 'fr' ? 'pas encore de valeur' : 'no value yet')}`;
}

const both = (fn) => ({ en: fn('en'), fr: fn('fr') });

export const T = {
  names,
  notConfigured: {
    en: 'Fill in your Panasonic ID (Aquarea Smart Cloud) or the address of your HeishaMon in the configuration.',
    fr: "Renseignez votre Panasonic ID (Aquarea Smart Cloud) ou l'adresse de votre HeishaMon dans la configuration.",
  },
  cloudIncomplete: {
    en: 'Aquarea Smart Cloud needs both the e-mail address and the password of your Panasonic ID.',
    fr: "Aquarea Smart Cloud a besoin de l'adresse e-mail et du mot de passe de votre Panasonic ID.",
  },
  /** The status of a configuration error (see normalizeConfig). */
  configError(error) {
    return error === 'cloud-incomplete' ? T.cloudIncomplete : T.notConfigured;
  },

  cloud: {
    connecting: {
      en: 'Connecting to Aquarea Smart Cloud…',
      fr: 'Connexion à Aquarea Smart Cloud…',
    },
    connected: (count, cached) => ({
      en: `Connected to Aquarea Smart Cloud: ${plural(count, 'heat pump', 'heat pumps')} in Discovery.${cached ? ' The adapter does not answer live: the values are the copy the cloud kept.' : ''}`,
      fr: `Connecté à Aquarea Smart Cloud : ${plural(count, 'pompe à chaleur', 'pompes à chaleur')} dans Découverte.${cached ? " L'adaptateur ne répond pas en direct : les valeurs sont la copie gardée par le cloud." : ''}`,
    }),
    noDevice: {
      en: 'Connected to Aquarea Smart Cloud, but this Panasonic ID has no Aquarea heat pump: add it in the Panasonic Comfort Cloud app first.',
      fr: "Connecté à Aquarea Smart Cloud, mais ce Panasonic ID n'a aucune pompe à chaleur Aquarea : ajoutez-la d'abord dans l'application Panasonic Comfort Cloud.",
    },
    /** The status of a failed cloud call (a PanasonicError). */
    failure(err) {
      const reason = String(err?.message ?? 'unknown error').slice(0, 200);
      switch (err?.kind) {
        case 'credentials':
          return {
            en: 'Panasonic refused the Panasonic ID or the password: check them in the Panasonic Comfort Cloud app, then save the configuration again.',
            fr: "Panasonic a refusé le Panasonic ID ou le mot de passe : vérifiez-les dans l'application Panasonic Comfort Cloud, puis enregistrez à nouveau la configuration.",
          };
        case 'mfa':
          return {
            en: `Your Panasonic ID asks for a two-factor code: type the current code of your authenticator app with the "Send a two-factor code" button (${reason}).`,
            fr: `Votre Panasonic ID demande un code de double authentification : saisissez le code actuel de votre application d'authentification avec le bouton « Envoyer un code de double authentification » (${reason}).`,
          };
        case 'agreement':
          return {
            en: 'Panasonic published new terms of use: open the Panasonic Comfort Cloud app and accept them. The integration tries again every 30 minutes.',
            fr: "Panasonic a publié de nouvelles conditions d'utilisation : ouvrez l'application Panasonic Comfort Cloud et acceptez-les. L'intégration réessaie toutes les 30 minutes.",
          };
        case 'version':
          return {
            en: 'Panasonic refuses the application version the integration announces: type the version of the Comfort Cloud app in "Application version", or update the integration.',
            fr: "Panasonic refuse la version d'application annoncée par l'intégration : saisissez la version de l'application Comfort Cloud dans « Version de l'application », ou mettez l'intégration à jour.",
          };
        case 'network':
          return {
            en: `The Panasonic cloud is unreachable: ${reason}. Retrying in a while.`,
            fr: `Le cloud Panasonic est injoignable : ${reason}. Nouvel essai dans un moment.`,
          };
        default:
          return {
            en: `Aquarea Smart Cloud error: ${reason}. Retrying in a while.`,
            fr: `Erreur Aquarea Smart Cloud : ${reason}. Nouvel essai dans un moment.`,
          };
      }
    },
    testOk: (count, snapshots) =>
      both((lang) => {
        const head =
          lang === 'fr'
            ? `Connexion à Aquarea Smart Cloud réussie : ${plural(count, 'pompe à chaleur', 'pompes à chaleur')}.`
            : `Connected to Aquarea Smart Cloud: ${plural(count, 'heat pump', 'heat pumps')}.`;
        const lines = snapshots.map((s) =>
          s.unreadable
            ? `${s.name}: ${lang === 'fr' ? 'état illisible (adaptateur hors ligne ?)' : 'status unreadable (adapter offline?)'}`
            : summary(s, lang),
        );
        return [head, ...lines].join(' ');
      }),
    codeFormat: {
      en: 'Type the 6-digit code shown by your authenticator app.',
      fr: "Saisissez le code à 6 chiffres affiché par votre application d'authentification.",
    },
    codeAccepted: {
      en: 'Code accepted: connected to Aquarea Smart Cloud.',
      fr: 'Code accepté : connecté à Aquarea Smart Cloud.',
    },
    codeNotCloud: {
      en: 'The two-factor code is for Aquarea Smart Cloud: this integration reads HeishaMon now, or is not configured.',
      fr: "Le code de double authentification sert à Aquarea Smart Cloud : l'intégration lit actuellement HeishaMon, ou n'est pas configurée.",
    },
  },

  heishamon: {
    badUrl: (reason) =>
      reason === 'credentials'
        ? {
            en: 'No user name or password in the address of HeishaMon: they have their own fields.',
            fr: "Pas d'utilisateur ni de mot de passe dans l'adresse de HeishaMon : ils ont leurs propres champs.",
          }
        : {
            en: 'The address of HeishaMon is not valid: use mqtt://192.168.1.10:1883 for your broker, or http://192.168.1.30 for the board itself.',
            fr: "L'adresse de HeishaMon n'est pas valide : utilisez mqtt://192.168.1.10:1883 pour votre broker, ou http://192.168.1.30 pour la carte elle-même.",
          },
    connecting: (kind) =>
      kind === 'http'
        ? { en: 'Reading HeishaMon…', fr: 'Lecture de HeishaMon…' }
        : { en: 'Connecting to the MQTT broker…', fr: 'Connexion au broker MQTT…' },
    connected: (kind, count) => ({
      en: `${kind === 'http' ? 'HeishaMon read' : 'Connected to the MQTT broker'}: ${plural(count, 'heat pump', 'heat pumps')} in Discovery.`,
      fr: `${kind === 'http' ? 'HeishaMon lu' : 'Connecté au broker MQTT'} : ${plural(count, 'pompe à chaleur', 'pompes à chaleur')} dans Découverte.`,
    }),
    waiting: (kind, topics) =>
      kind === 'http'
        ? { en: 'Waiting for HeishaMon…', fr: 'En attente de HeishaMon…' }
        : {
            en: `Connected to the MQTT broker, no HeishaMon value on ${topics.map((t) => `${t}/main/…`).join(', ')} yet. Check the MQTT settings of HeishaMon (server, base topic).`,
            fr: `Connecté au broker MQTT, aucune valeur HeishaMon sur ${topics.map((t) => `${t}/main/…`).join(', ')} pour l'instant. Vérifiez les réglages MQTT de HeishaMon (serveur, topic de base).`,
          },
    unreachable: (kind, reason) =>
      kind === 'http'
        ? {
            en: `HeishaMon is unreachable: ${reason}. Check its address (its web page must open from the Gladys machine).`,
            fr: `HeishaMon est injoignable : ${reason}. Vérifiez son adresse (sa page web doit s'ouvrir depuis la machine Gladys).`,
          }
        : {
            en: `The MQTT broker is unreachable: ${reason}. Use its LAN IP address (not localhost) and port.`,
            fr: `Le broker MQTT est injoignable : ${reason}. Utilisez son adresse IP sur le réseau local (pas localhost) et son port.`,
          },
    refused: (reason) => ({
      en: `The MQTT broker refused the connection: ${reason}. Check the user name and password.`,
      fr: `Le broker MQTT a refusé la connexion : ${reason}. Vérifiez l'utilisateur et le mot de passe.`,
    }),
    offline: (ids) => ({
      en: `HeishaMon ${ids.join(', ')} is offline (its last will on the broker): check its power and Wi-Fi.`,
      fr: `HeishaMon ${ids.join(', ')} est hors ligne (son dernier message sur le broker) : vérifiez son alimentation et son Wi-Fi.`,
    }),
    testOk: (kind, snapshots) =>
      both((lang) => {
        const head =
          kind === 'http'
            ? lang === 'fr'
              ? 'HeishaMon répond.'
              : 'HeishaMon answers.'
            : lang === 'fr'
              ? 'Connexion au broker réussie, HeishaMon publie.'
              : 'Connected to the broker, HeishaMon publishes.';
        return [head, ...snapshots.map((s) => summary(s, lang))].join(' ');
      }),
    testNothing: (topics, seconds) => ({
      en: `Connected to the broker, but no HeishaMon value on ${topics.map((t) => `${t}/main/…`).join(', ')} within ${seconds} s. Check the MQTT server and the base topic in the settings of HeishaMon.`,
      fr: `Connexion au broker réussie, mais aucune valeur HeishaMon sur ${topics.map((t) => `${t}/main/…`).join(', ')} en ${seconds} s. Vérifiez le serveur MQTT et le topic de base dans les réglages de HeishaMon.`,
    }),
  },

  badge: {
    gone: {
      en: 'No longer in the Panasonic account',
      fr: "N'est plus dans le compte Panasonic",
    },
    adapterOffline: {
      en: 'The adapter (CZ-TAW1) does not answer',
      fr: "L'adaptateur (CZ-TAW1) ne répond pas",
    },
    cached: {
      en: 'Values kept by the cloud: the adapter does not answer live',
      fr: "Valeurs gardées par le cloud : l'adaptateur ne répond pas en direct",
    },
    heishamonOffline: {
      en: 'HeishaMon is offline',
      fr: 'HeishaMon est hors ligne',
    },
    stale: {
      en: 'No value from HeishaMon for 15 minutes',
      fr: 'Aucune valeur de HeishaMon depuis 15 minutes',
    },
    notRead: {
      en: 'Not read by the current connection',
      fr: 'Non lue par la connexion actuelle',
    },
  },
};
