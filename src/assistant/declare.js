// D28 and D44: pairs declared by reading both lines. `c` is a word-for-word extract used to find the line.
window.DECLARE = {
  // Real conflict: both shown, nothing decided.
  conflits: [
    { id: "sortie_111bis", sujet: ["111bis", "111 bis", "prevoyance", "prevoyance-vieillesse"], aspect: ["sortie", "sortir", "avant 60", "avant 60 ans", "remboursement anticipe", "bloque", "bloquee", "recuperer", "retirer"],
      lignes: [{ p: "conseil_fiscal", c: "épargne bloquée jusqu'à 60 ans" }, { p: "prevoyance", c: "Ce n'est donc pas interdit" }] },
    { id: "fiche_retenue", sujet: ["fiche de retenue", "carte d'impot"], aspect: ["reclamer", "demander", "obtenir", "automatique", "automatiquement", "comment"],
      lignes: [{ p: "impots_classes", c: "Réclamez enfin votre fiche de retenue" }, { p: "conseil_fiscal", c: "elle est émise automatiquement" }] },
    { id: "ordre_vehicule", sujet: ["vehicule", "voiture", "immatriculer", "immatriculation"], aspect: ["dans quel ordre", "quel ordre", "l'ordre", "par quoi commencer"],
      lignes: [{ p: "vehicule", c: "Ordre : numéro et plaques" }, { p: "faq", c: "Import : contrôle technique, assurance, puis immatriculation" }] },
    { id: "age_epargne", sujet: ["epargne-logement", "epargne logement"], aspect: ["41 ans", "40 ans", "age", "limite d'age"],
      lignes: [{ p: "conseil_fiscal", c: "lorsque le souscripteur a entre 18 et 41 ans" }, { p: "avantages", c: "de 18 à 40 ans" }] },
  ],
  // Settled by a fact about the reader. kb.js:23 and :861 turn on nationality; `origine` only proposes a default.
  conditions: [
    { id: "delai_arrivee", quand: ["delai", "huit jours", "jours", "combien de temps", "quand"], concept: "commune_declaration",
      fait: "nationalite", question: "De quelle nationalité êtes-vous ?",
      valeurs: {
        ue: { label: "Union européenne, EEE ou Suisse", ligne: { p: "faq", c: "Dans les huit jours suivant l'emménagement" } },
        tiers: { label: "Autre nationalité", ligne: { p: "arrivee", c: "non pas de huit jours mais de trois jours" } },
      },
      note: "La question fréquente et le parcours du guide disent huit jours sans préciser ce cas." },
  ],
  // Same number, different things: each meaning is named.
  homonymes: [
    { valeur: "4 500", sens: [{ p: "conseil_fiscal", c: "jusqu'à 4 500 euros par an et par contribuable" }] },
    { valeur: "672", sens: [{ p: "conseil_fiscal", c: "672 euros au-delà" }] },
  ],
  // Announced, not in force. Cited in ui.js:1816 and ui.js:1834, rendered only inside the simulator's results.
  valeurs: [
    { id: "bellegen", quand: ["bellegen", "billegen", "belle gen"], en_vigueur: "40 000 €", annonce: "45 000 €",
      texte: "Le gouvernement a annoncé le 16 juillet 2026 un passage à 45 000 € pour les actes signés depuis cette date. Tant que la loi n'est pas votée, le notaire applique 40 000 € et la différence se demande ensuite en remboursement à l'Administration de l'enregistrement.",
      route: "#simulateur/emprunt", source: "Simulateur d'emprunt, carte Bëllegen Akt" },
    { id: "tva", quand: ["tva 3", "tva a 3", "3 % de tva", "tva logement"], en_vigueur: "50 000 €", annonce: "100 000 €",
      texte: "Un doublement du plafond à 100 000 € a été annoncé en juin 2026, sous réserve de l'accord de la Commission européenne : pas encore applicable.",
      route: "#simulateur/emprunt", source: "Simulateur d'emprunt, carte TVA à 3 %" },
  ],
};
