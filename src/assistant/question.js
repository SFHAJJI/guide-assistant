// Brick 2, question parsing: the question becomes a row with named fields. Code only; the model's reading is added by the engine behind a gate.
(function () {
  const { plain, stem, content, STOP, DEMONYMES, MOTS_DE_TYPE } = window.Texte;
  function damerau(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  const SMS = { koi: "quoi", kwa: "quoi", pr: "pour", ds: "dans", qd: "quand", pk: "pourquoi", pq: "pourquoi", cb: "combien", cmb: "combien", jsuis: "je suis", chui: "je suis", jpeux: "je peux", jdois: "je dois", jveux: "je veux", secu: "sécurité sociale", "sécu": "sécurité sociale", proprio: "propriétaire", appart: "appartement", immat: "immatriculation", bcp: "beaucoup", mm: "même", ya: "il y a", tjrs: "toujours", auj: "aujourd'hui", allocs: "allocations", alloc: "allocation" };

  window.Briques = window.Briques || {};
  window.Briques.question = function ({ vocab, inv, concepts }) {
    function corriger(q0) {
      const corrections = [];
      const q = q0.replace(/\b(koi|kwa|pr|ds|qd|pk|pq|cb|cmb|jsuis|chui|jpeux|jdois|jveux|secu|sécu|proprio|appart|immat|bcp|mm|ya|tjrs|auj|allocs|alloc)\b/gi, m => {
        const v = SMS[m.toLowerCase()];
        corrections.push([m, v]);
        return v;
      }).replace(/\bc koi\b/gi, "c'est quoi");
      const out = q.replace(/[a-zàâäéèêëïîôöùûüçœ]{5,}/gi, w => {
        const p = plain(w);
        if (vocab.has(p) || STOP.has(p) || DEMONYMES[p] || vocab.has(p.replace(/s$/, "")) || vocab.has(p + "s") || inv.has(stem(p))) return w;
        const max = p.length >= 10 ? 2 : 1;
        let best = null, bd = 9, bc = 0;
        for (const [v, c] of vocab) {
          // A shorter word is not a correction of an unknown word: "bougie" is not "bouge" (B1: keep the token).
          if (v.length < p.length && p.length < 8) continue;
          // Never across the first letter: "decouvert" is not "couvert", and the reader's word must not be lost.
          if (Math.abs(v.length - p.length) > max || v[0] !== p[0]) continue;
          const d = damerau(p, v, max);
          if (d <= max && (d < bd || (d === bd && c > bc))) { best = v; bd = d; bc = c; }
        }
        if (!best) return w;
        corrections.push([w, best]);
        return best;
      });
      return { texte: out, corrections };
    }

    function trouverConcepts(pq) {
      const found = [];
      for (const c of concepts) {
        // "délai" or "prix" says what kind of answer is wanted, not what the question is about, even when a page uses it as a tag.
        for (const k of c.cles) if (!(content(k.m).length === 1 && MOTS_DE_TYPE.has(stem(content(k.m)[0]))) && k.re.test(pq)) { found.push({ id: c.id, mot: k.m, source: c.source, c }); break; }
      }
      // A longer word beats a shorter one found inside it.
      return found.filter(f => !found.some(g => g !== f && g.mot !== f.mot && g.mot.includes(f.mot) && g.c === f.c));
    }

    function typeDe(pq, brut) {
      if (/\b(delai|combien de temps|quand|sous combien|valable combien|dans combien|duree|a quel moment|date)\b|\bcombien de (jours?|mois|ans?|annees?|semaines?|heures?)\b/.test(pq)) return "duree";
      if (/\b\w+-(t-)?(il|elle|ils|elles|on|je)\b/.test(String(brut).toLowerCase().replace(/’/g, "'")) && !/^(comment|combien|quel|quelle|quels|quelles|pourquoi|qui|que|ou|quand)\b/.test(pq)) return "booleen";
      if (/^(est[- ]ce|y a|peut on|puis je|dois je|faut il|suis je|ai je|is |can |do |does |am i )/.test(pq)) return "booleen";
      if (/\b(combien|prix|cout|coute|coutent|couter|tarif|montant|plafond|franchise|frais|how much)\b/.test(pq)) return "montant";
      if (/\b(c'est quoi|c quoi|qu'est ce|quest ce|que veut dire|definition|what is)\b/.test(pq)) return "definition";
      if (/^(comment|how)\b|\b(que faire|quoi faire|je fais quoi|on fait quoi)\b/.test(pq)) return "procedure";
      return "texte";
    }

    function formeDe(pq) {
      if (/^combien (d'|de )(aides?|avantages?|cartes?|fiches?|etapes?|assureurs?|contrats?|scenarios?|sinistres?)\b/.test(pq)) return "compte";
      if (/\b(tableau|grille)\b/.test(pq)) return "table";
      if (/\b(quels|quelles|liste|lister|enumer\w+|tous les|toutes les|quelles sont|quels sont)\b/.test(pq)) return "liste";
      return "single";
    }

    function ligneDeQuestion(question, ctx = {}) {
      const partout = /\(dans tout le guide\)\s*$/.test(question);
      const original = question.replace(/\s*\(dans tout le guide\)\s*$/, "");
      const c = corriger(original);
      const pq = plain(c.texte).replace(/[?!.]+$/g, "").trim();
      const row = {
        original, corrigee: c.texte, corrections: c.corrections, pq,
        concepts: trouverConcepts(pq), type: typeDe(pq, original), forme: formeDe(pq),
        mots: [...new Set(content(c.texte).flatMap(w => DEMONYMES[w] ? [w, DEMONYMES[w]] : [w]))], ancres: (c.texte.match(/\b[A-Z]{2,}\b|\b\d+bis\b|\bS\d{2}\b/g) || []),
        negation: null, complement: /\b(n'est pas|ne sont pas|pas couvert|non couvert|exclu|exclus|exclusions?)\b/.test(pq),
        pointe: /\b(ca|cela|ceci|ici|here|this page|cette page|cette fiche|cet onglet|cette section|cette ligne|cette etape|(ce|cet|cette) (tableau|plafond|chiffre|montant|prix|truc|mot|terme|delai|document|formulaire|bouton))\b/.test(pq),
        epingle: /\b(cette page|cette fiche|cet onglet|this page|ici)\b/.test(pq),
        partout, notes: [],
      };
      row.formeCode = row.forme;
      // "c'est gratuit ?": a predicate with nothing it applies to. Its subject is whatever the reader is looking at.
      row.predicat = /^(c'?est|c est|c)\s+(gratuit|payant|obligatoire|combien|cher|long|possible|normal|legal|vrai|automatique|valable)\b/.test(pq);
      if (row.predicat && !partout) row.pointe = true;
      if (partout) { row.pointe = false; row.epingle = false; }
      // A subject and nothing else: every word belongs to the concept. "luxtrust c payant" is a question, "creches" is not.
      const motsDuSujet = new Set(row.concepts.flatMap(x => x.c.mots.flatMap(m => content(m).map(stem))));
      row.sujetSeul = row.concepts.length > 0 && row.mots.length <= 2 && row.type === "texte" && row.forme === "single" && !row.pointe && row.mots.every(m => motsDuSujet.has(stem(m)));
      const neg = pq.match(/\b(?:le|la|les|l')?\s*([a-z-]+),?\s+(?:pas|non)\s+(?:le|la|les|l')?\s*([a-z-]+)\b/);
      if (neg && !row.complement) row.negation = { veut: neg[1], pas: neg[2] };
      const pageNum = pq.match(/\bpage\s+(\d+)\b/);
      if (pageNum) row.notes.push(`Ce site n'a pas de numéros de page, j'ai cherché dans tout le guide.`);
      // Follow-up: inherits concept and scope from the previous row, and the trace says so.
      if (ctx.dernier && !row.concepts.length && (/^et\b/.test(pq) || row.pointe || row.mots.length <= 2)) {
        row.concepts = ctx.dernier.concepts;
        row.mots = [...new Set([...row.mots, ...ctx.dernier.mots])];
        row.herite = ctx.dernier.original;
      }
      return row;
    }

    // ---------- Compound questions (6B §1.4, 6C:547) ----------
    const QUESTION_MOT = /\b(combien|quel|quelle|quels|quelles|comment|c'est quoi|qu'est ce|ou|quand|pourquoi|est ce|peut on|faut il|dois je)\b/;
    function decomposer(original) {
      const q = original.trim();
      if (/\bet si oui\b/i.test(plain(q))) {
        const [a, b] = q.split(/,?\s*et si oui,?\s*/i);
        return { pattern: "si_oui", parts: [a.trim(), b.trim()] };
      }
      const cond = plain(q).match(/^si (.+?), (.+)$/);
      if (cond) return { pattern: "condition", parts: [q], condition: cond[1] };
      if (!/\bet\b|;|\?.+\?|,.*\bet\b/.test(plain(q))) return { pattern: "single", parts: [q] };
      // One tool, two values: stays one question (T16).
      if (/classe\s*\w+\s+et\s+(en\s+)?classe/i.test(plain(q))) return { pattern: "single", parts: [q] };
      // "Entre A et B": one comparison, not two questions.
      if (/\bentre\b.+\bet\b/.test(plain(q))) return { pattern: "single", parts: [q] };
      const brutes = q.split(/\s*;\s*|\?\s+(?=\S)|,\s+(?=[^,]*\bet\b)|,\s+|\s+et\s+(?!si\b)/i).map(s => s.trim()).filter(Boolean);
      if (brutes.length < 2) return { pattern: "single", parts: [q] };
      const propres = brutes.map(b => ({ b, cs: trouverConcepts(plain(b)).map(x => x.id), qm: QUESTION_MOT.test(plain(b)) }));
      if (propres.filter(p => p.cs.includes("communes")).length >= 2) return { pattern: "single", parts: [q] };
      const utiles = propres.every(p => p.cs.length || p.qm);
      if (!utiles) return { pattern: "unifiee", parts: [q] };
      const deuxSujets = new Set(propres.flatMap(p => p.cs.slice(0, 1))).size >= 2 || propres.filter(p => p.qm).length >= 2;
      if (!deuxSujets) return { pattern: "unifiee", parts: [q] };
      return { pattern: "independantes", parts: brutes };
    }

    return { ligneDeQuestion, decomposer, trouverConcepts, typeDe };
  };
})();
