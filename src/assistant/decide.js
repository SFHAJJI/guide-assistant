// The dispatcher: one readable function, in reading order, that picks the route. The model never enters it.
(function () {
  const { plain } = window.Texte;

  const REGLES = [
    ["r1", "Urgence dans le message", "urgence"],
    ["r2", "Donnée personnelle dans le message", "prive"],
    ["r3", "Salutation ou remerciement seul", "salut"],
    ["r4", "Conseil d'achat, taux deviné, projection", "refus"],
    ["r5", "Parties avec chacune leur concept ou leur question", "composee"],
    ["r6", "Mot à plusieurs sens sans précision", "clarifier"],
    ["r7", "Question sans sujet, sans page ni question précédente", "clarifier"],
    ["r8", "Sujet servi par un outil non lu", "outil_guide"],
    ["r9", "Salaire avec un montant", "outil_qa"],
    ["r10", "Quelle classe d'impôt", "arbre"],
    ["r11", "Où j'en suis, par où commencer", "etat"],
    ["r12", "Sinistre ou couverture d'assurance", "table_sinistre"],
    ["r13", "Liste, compte ou seuil sur les aides", "table_avantages"],
    ["r14", "Que faire à quel moment", "table_parcours"],
    ["r15", "Astuce demandée", "astuce"],
    ["r16", "Résumé de la page", "resume"],
    ["r17", "Valeur annoncée", "valeur"],
    ["r18", "Question fréquente de même forme", "faq_cache"],
    ["r19", "Par défaut : les lignes du guide", "fiche_qa"],
    ["r20", "Rien de plus : balayage de toutes les lignes", "absence"],
    ["r21", "Hors du sujet du guide, sans balayage", "hors_sujet"],
    ["r22", "Épargne et retraite : lue, sans modèle", "epargne_qa"],
    ["r23", "Question à plusieurs sens, dit par le modèle", "clarifier"],
    ["r24", "La question montre la page ouverte", "page_qa"],
    ["r25", "Un sujet seul, sans question", "fiche_sujet"],
    ["r26", "Une commune et un chiffre, un seuil ou un classement", "table_communes"],
    ["r27", "Une question sur l'assistant ou sur le site", "site_qa"],
  ];

  window.Briques = window.Briques || {};
  window.Briques.REGLES = REGLES;
  window.Briques.decide = function ({ REFUS, DECLARE, opt }) {
    function decide(row, ctx) {
      const q = row.pq, plan = [];
      const dit = (id, why) => plan.push({ id, route: REGLES.find(r => r[0] === id)[2], why });
      if (/\b(urgence|je sens le gaz|ca sent le gaz|au feu|au secours|crise cardiaque|ne respire|inconscient\w*|me suicider|emergency)\b/.test(q)) { dit("r1"); return plan; }
      if (/\b[a-z]{2}\d{2}(?:\s?[a-z0-9]{4}){3,}\b/.test(q) || /\b\d{4}\s?\d{4}\s?\d{5}\b/.test(q) || /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/.test(q) || /(\+|\b00)\s?\d{2,3}[\s.]?\d{2,3}[\s.]?\d{2,3}/.test(q) || /\b\d{3}[\s.-]\d{3}[\s.-]\d{3}\b/.test(q) || /\b0\d([\s.-]?\d{2}){4}\b/.test(q) || /\b\d{9,}\b/.test(q)) { dit("r2"); return plan; }
      if (/^(bonjour|salut|bonsoir|hello|coucou|merci|hi|thanks)\b[ ,.!a-z]{0,14}$/.test(q) && row.mots.length <= 1) { dit("r3"); return plan; }
      if (REFUS.some(r => r.re.test(q))) { dit("r4"); return plan; }
      if ((opt.SITE || window.SITE || []).some(r => r.re.test(q))) { dit("r27"); return plan; }
      if (row.horsSujet) { dit("r21"); return plan; }
      if (row.ambigu && !row.concepts.length) { dit("r23"); return plan; }
      // A word with several senses is asked back, unless the question or the open page already says which.
      const titrePage = plain(ctx.page?.titre || "");
      const multi = row.concepts.find(c => c.c.sens && !(c.c.seul && (row.mots.length > 1 || ctx.page)) && !c.c.sens.some(s => s.mots.some(m => q.includes(plain(m)) || titrePage.includes(plain(m)))));
      if (multi) { dit("r6", multi.mot); return plan; }
      if (!row.concepts.length && !row.herite && !row.mots.length && !ctx.page) { dit("r7"); return plan; }
      if (!row.concepts.length && !row.herite && row.mots.length === 0 && ctx.page && ctx.page.id) { /* the page is the subject */ }
      // A commune named in a question about something else is not a question for the maps: the table first, then the guide's lines, then the tool.
      const repliCartes = row.concepts.some(c => c.id === "communes");
      if (repliCartes || /\b(ou|quelle? commune|quelles? communes)\b.*\b(le plus|la plus|les plus|le moins|la moins|les moins|moins cher\w*|plus cher\w*)\b/.test(q)) dit("r26");
      if (!repliCartes && row.concepts.some(c => c.c.tool)) { dit("r8"); return plan; }
      // A salary figure is a calculation only if the question is about that salary, not about an aid, a ceiling or the screen.
      if (/\b(salaire|brut|net|paie|gross|salary|gagne|gagnons|touche|touchons)\b/.test(q) && /\d/.test(q.replace(/classe\s*\d\w?/g, "")) && !/\b(rempli|par defaut|cis|cissm|cim|abattement|plafond|logement|abordable|aides?|primes?|allocations?|droit|eligible|pourquoi|ecrit|affiche|moyen|minimum|prix|maison|appartement|loyer|vendeur|achat|acheter|immobilier|notaire|impatrie\w*)\b/.test(q)) dit("r9");
      else if (!/\b(employeur|corriger|changer|modifier|erreur|automatique\w*)\b/.test(q) && (/\b(quelle classe|ma classe|quelle est ma classe|which tax class|classe d'impots? pour|dans quelle classe)\b/.test(q) || (/\bclasse\b/.test(q) && /\b(marie|mariee|celibataire|divorce|divorcee|veuf|veuve|pacse)\b/.test(q)))) dit("r10");
      else if (/\b(il me manque|me reste|par ou commencer|ou j'en suis|qu'est ce que je dois faire|que me reste|prochaine etape)\b/.test(q)) dit("r11");
      else {
        if (/\bastuce|retour d'experience\b/.test(q)) dit("r15");
        if (/\b(resume\w*|en bref|l'essentiel)\b/.test(q)) dit("r16");
        if ((DECLARE.valeurs || []).some(v => v.quand.some(w => q.includes(plain(w))))) dit("r17");
        if (ctx.page?.id === "prevoyance" || /\b(111 ?bis|prevoyance|retraite complementaire|pension privee|epargne retraite|epargne-retraite|vieillesse)\b/.test(q)) dit("r22");
        if (row.portee === "page" && ctx.page?.id !== "prevoyance") dit("r24");
        if (row.concepts.some(c => c.id === "sinistre") && /\b(couvert|couverte|indemnise\w*|assurance|assureur|garanti\w*|suis-je|vol\w*|contrat\w*|exclu\w*)\b/.test(q)) dit("r12");
        // Code's own reading of the shape: a question about one aid must not get the whole table.
        if (row.concepts.some(c => c.id === "aides") && (row.formeCode !== "single" || /\b(au[- ]dessus|plus de|moins de|sous)\b/.test(q))) dit("r13");
        if (/\b(que faire|quoi faire|que dois-je faire|premier mois|avant le depart|premiere semaine|etapes)\b/.test(q) && !/\bvehicule|voiture|immatricul\w*\b/.test(q)) dit("r14");
        if (row.sujetSeul) dit("r25");
        dit("r18");
      }
      dit("r19"); dit(repliCartes ? "r8" : "r20");
      return plan;
    }

    return decide;
  };
})();
