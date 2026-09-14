// Interface strings. French by default (the REPL is written for French classrooms); ?lang=en
// switches to English.
const STRINGS = {
  fr: {
    loading: (name) => `Chargement de ${name}...`,
    hint: "Entrée pour exécuter, Maj+Entrée pour aller à la ligne, flèches haut et bas pour l'historique.",
    placeholder: "Tape ton code ici",
    clear: "Effacer",
    restart: "Redémarrer",
    stop: "Arrêter",
    stopped: "Arrêté. Les variables ont été effacées.",
    restarted: "Redémarré. Les variables ont été effacées.",
    fatal: "Impossible de démarrer le REPL :",
    noInput: "La saisie au clavier (input) n'est pas disponible dans ce REPL.",
  },
  en: {
    loading: (name) => `Loading ${name}...`,
    hint: "Enter to run, Shift+Enter for a new line, up and down arrows for history.",
    placeholder: "Type your code here",
    clear: "Clear",
    restart: "Restart",
    stop: "Stop",
    stopped: "Stopped. Variables were cleared.",
    restarted: "Restarted. Variables were cleared.",
    fatal: "The REPL could not start:",
    noInput: "Keyboard input is not available in this REPL.",
  },
};

export function strings() {
  const lang = new URLSearchParams(location.search).get("lang") || document.documentElement.lang;
  return STRINGS[lang] || STRINGS.fr;
}
