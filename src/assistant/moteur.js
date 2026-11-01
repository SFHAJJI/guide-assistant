// The engine: question row, retrieval as a filter, the dispatcher, typed answers. No DOM here.
// Code decides everything in this file. The model, when it is on, only fills the gaps named `modele.*`.
(function () {
  const plain = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").replace(/œ/g, "oe");
  const STOP = new Set(("a au aux avec ce ces cet cette c ca cela dans de des du d elle elles en est et eu il ils j je l la le les leur leurs lui m ma mais me mes moi mon n ne ni nos notre nous on ou par pas pour qu que qui quoi s sa se ses si son sont sur t ta te tes toi ton tu un une vos votre vous y " +
    "suis es sommes etes etre ai as avons avez ont avoir fait faire faut peut puis-je peux dois doit quel quelle quels quelles comment combien pourquoi quand ou est-ce esque bonjour merci svp stp alors donc aussi plus moins tres bien ici ceci " +
    "the is are what how much many do does can i my to of for in on and or if at it be have has need when where which who").split(" "));
  const stem = t => {
    if (/^\d/.test(t)) return t;
    let s = t;
    if (s.length > 6) s = s.replace(/ations?$/, "");
    if (s.length > 5) s = s.replace(/(ent|ez|er|es|e|s|x)$/, "");
    else if (s.length > 4) s = s.replace(/[sxe]$/, "");
    return s;
  };
  const words = s => plain(s).replace(/[^a-z0-9%€'\- ]/g, " ").split(/[\s']+/).filter(Boolean);
  const content = s => words(s).filter(w => !STOP.has(w) && (w.length > 1 || /\d/.test(w)));

  const RE_TYPE = {
    montant: /\d[\d\s.,]*\s*(€|eur\b|euros?\b)|\d+(,\d+)?\s*%|\bgratuit|\bsans suppl|\b(un|deux|trois) mois\b/i,
    duree: /\b(\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quinze|trente|soixante|quatre-vingt-dix)\s+(jours?|mois|ans?|annees?|semaines?|heures?)\b/,
    date: /\b(\d{1,2}(er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)|\d{4})\b/,
  };

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

  const SMS = { koi: "quoi", kwa: "quoi", pr: "pour", ds: "dans", qd: "quand", pk: "pourquoi", pq: "pourquoi", cb: "combien", cmb: "combien", jsuis: "je suis", chui: "je suis", jpeux: "je peux", jdois: "je dois", jveux: "je veux", secu: "sécurité sociale", "sécu": "sécurité sociale", proprio: "propriétaire", appart: "appartement", immat: "immatriculation", bcp: "beaucoup", mm: "même", ya: "il y a", tjrs: "toujours", auj: "aujourd'hui" };
  const MOTS_DE_TYPE = new Set(["cout", "prix", "montant", "tarif", "combien", "delai", "date", "duree", "frai", "poste"].map(stem));
  const DEMONYMES = { allemand: "allemagne", allemande: "allemagne", francais: "france", francaise: "france", belge: "belgique" };

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
  ];

  function creer(index, opt = {}) {
    const { DICO = [], REFUS = [], DECLARE = {}, sim = null } = opt;
    const L = index.lignes;
    const pageById = new Map(index.pages.map(p => [p.id, p]));
    const byId = new Map(L.map(l => [l.id, l]));
    const vocab = new Map();
    const inv = new Map();
    const COEF = { titre: 0.5, html: 0.45, chapo: 0.9, scenario: 0.2, astuce: 0, demo: 0, epargne: 0.9 };

    L.forEach((l, i) => {
      l.plain = plain(l.t);
      const ws = content(l.t);
      l.st = new Set(ws.map(stem));
      // Where the section carries the identity of the line (a FAQ question, a country, a card), it counts as text.
      if (["pays", "pli", "tableau", "faq", "carte", "etape", "epargne"].includes(l.k)) for (const w of content(l.s)) l.st.add(stem(w));
      for (const w of ws) vocab.set(w, (vocab.get(w) || 0) + 1);
      for (const s of l.st) { if (!inv.has(s)) inv.set(s, []); inv.get(s).push(i); }
    });
    const N = L.length;
    const poids = s => {
      const df = (inv.get(s) || []).length;
      return df === 0 ? 1 : df / N > 0.05 ? 0.5 : df < 8 ? 1.5 : 1;
    };

    // Concepts: the author's tags, then my rows.
    const concepts = [];
    for (const p of index.pages) {
      if (!p.type.startsWith("fiche")) continue;
      concepts.push({ id: "f:" + p.id, pages: [p.id], source: "auteur", mots: [plain(p.titre), ...(p.tags || []).map(plain)] });
    }
    for (const d of DICO) concepts.push({ ...d, source: "moi", mots: d.mots.map(plain) });
    for (const c of concepts) {
      c.cles = c.mots.map(m => ({ m, re: new RegExp("(^|[^a-z0-9])" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "s?($|[^a-z0-9])") }));
      for (const m of c.mots) for (const w of content(m)) if (!vocab.has(w)) vocab.set(w, 1);
    }

    // ---------- Brick 2: the row ----------
    function corriger(q0) {
      const corrections = [];
      const q = q0.replace(/\b(koi|kwa|pr|ds|qd|pk|pq|cb|cmb|jsuis|chui|jpeux|jdois|jveux|secu|sécu|proprio|appart|immat|bcp|mm|ya|tjrs|auj)\b/gi, m => {
        const v = SMS[m.toLowerCase()];
        corrections.push([m, v]);
        return v;
      }).replace(/\bc koi\b/gi, "c'est quoi");
      const out = q.replace(/[a-zàâäéèêëïîôöùûüçœ]{4,}/gi, w => {
        const p = plain(w);
        if (vocab.has(p) || STOP.has(p) || vocab.has(p.replace(/s$/, "")) || vocab.has(p + "s") || inv.has(stem(p))) return w;
        const max = p.length >= 8 ? 2 : 1;
        let best = null, bd = 9, bc = 0;
        for (const [v, c] of vocab) {
          // A shorter word is not a correction of an unknown word: "bougie" is not "bouge" (B1: keep the token).
          if (v.length < p.length && p.length < 8) continue;
          if (Math.abs(v.length - p.length) > max || v[0] !== p[0] && max === 1) continue;
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
        for (const k of c.cles) if (k.re.test(pq)) { found.push({ id: c.id, mot: k.m, source: c.source, c }); break; }
      }
      // A longer word beats a shorter one found inside it.
      return found.filter(f => !found.some(g => g !== f && g.mot !== f.mot && g.mot.includes(f.mot) && g.c === f.c));
    }

    function typeDe(pq, brut) {
      if (/\b(delai|combien de temps|quand|sous combien|valable combien|dans combien|duree|a quel moment|date)\b/.test(pq)) return "duree";
      if (/\b\w+-(t-)?(il|elle|ils|elles|on|je)\b/.test(String(brut).toLowerCase().replace(/’/g, "'")) && !/^(comment|combien|quel|quelle|quels|quelles|pourquoi|qui|que|ou|quand)\b/.test(pq)) return "booleen";
      if (/^(est[- ]ce|y a|peut on|puis je|dois je|faut il|suis je|ai je|is |can |do |does |am i )/.test(pq)) return "booleen";
      if (/\b(combien|prix|cout|coute|coutent|couter|tarif|montant|plafond|franchise|frais|how much)\b/.test(pq)) return "montant";
      if (/\b(c'est quoi|qu'est ce|quest ce|que veut dire|definition|what is)\b/.test(pq)) return "definition";
      if (/^(comment|how|que faire|quoi faire)\b/.test(pq)) return "procedure";
      return "texte";
    }

    function formeDe(pq) {
      if (/^combien (d'|de )(aides?|avantages?|cartes?|fiches?|etapes?|assureurs?|contrats?|scenarios?|sinistres?)\b/.test(pq)) return "compte";
      if (/\b(tableau|grille)\b/.test(pq)) return "table";
      if (/\b(quels|quelles|liste|lister|enumer\w+|tous les|toutes les|quelles sont|quels sont)\b/.test(pq)) return "liste";
      return "single";
    }

    function ligneDeQuestion(original, ctx = {}) {
      const c = corriger(original);
      const pq = plain(c.texte).replace(/[?!.]+$/g, "").trim();
      const row = {
        original, corrigee: c.texte, corrections: c.corrections, pq,
        concepts: trouverConcepts(pq), type: typeDe(pq, original), forme: formeDe(pq),
        mots: [...new Set(content(c.texte).flatMap(w => DEMONYMES[w] ? [w, DEMONYMES[w]] : [w]))], ancres: (c.texte.match(/\b[A-Z]{2,}\b|\b\d+bis\b|\bS\d{2}\b/g) || []),
        negation: null, complement: /\b(n'est pas|ne sont pas|pas couvert|non couvert|exclu|exclus|exclusions?)\b/.test(pq),
        pointe: /\b(ca|cela|ceci|ici|cette page|ce tableau|cette fiche|ce plafond|cet onglet|cette section)\b/.test(pq),
        epingle: /\b(cette page|cette fiche|cet onglet|ici)\b/.test(pq),
        notes: [],
      };
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
      const brutes = q.split(/\s*;\s*|\?\s+(?=\S)|,\s+(?=[^,]*\bet\b)|,\s+|\s+et\s+(?!si\b)/i).map(s => s.trim()).filter(Boolean);
      if (brutes.length < 2) return { pattern: "single", parts: [q] };
      const propres = brutes.map(b => ({ b, cs: trouverConcepts(plain(b)).map(x => x.id), qm: QUESTION_MOT.test(plain(b)) }));
      const utiles = propres.every(p => p.cs.length || p.qm);
      if (!utiles) return { pattern: "unifiee", parts: [q] };
      const deuxSujets = new Set(propres.flatMap(p => p.cs.slice(0, 1))).size >= 2 || propres.filter(p => p.qm).length >= 2;
      if (!deuxSujets) return { pattern: "unifiee", parts: [q] };
      return { pattern: "independantes", parts: brutes };
    }

    // ---------- Brick 3: detectors in parallel, grouped by section ----------
    function chercher(row, ctx, o = {}) {
      const stems = [...new Set(row.mots.map(stem))];
      const conceptPages = new Map();
      for (const f of row.concepts) for (const p of f.c.pages || []) conceptPages.set(p, f.id);
      const phrases = row.concepts.flatMap(f => f.c.mots).filter(m => m.includes(" "));
      const typeRe = RE_TYPE[row.type];
      const scores = new Map();
      const add = i => scores.has(i) || scores.set(i, { mots: new Set(), dico: 0, valeur: 0, titre: 0, page: 0 });
      for (const s of stems) for (const i of inv.get(s) || []) { add(i); scores.get(i).mots.add(s); }
      for (const f of row.concepts) for (const m of f.c.mots) {
        const st = stem(content(m)[0] || "");
        for (const i of inv.get(st) || []) { if (L[i].plain.includes(m)) { add(i); scores.get(i).dico += m.includes(" ") ? 2 : 1; } }
      }
      const pageCourante = ctx.page && ctx.page.id;
      if (o.page || (row.epingle && pageCourante)) {
        L.forEach((l, i) => { if (l.p === (o.page || pageCourante)) add(i); });
      }
      const cands = [];
      for (const [i, sc] of scores) {
        const l = L[i];
        if (o.page && l.p !== o.page) continue;
        if (row.epingle && pageCourante && l.p !== pageCourante) continue;
        const coef = COEF[l.k] ?? 1;
        if (!coef) continue;
        let s = 0;
        for (const m of sc.mots) s += poids(m);
        s += Math.min(sc.dico, 4);
        const motsConcept = sc.dico ? row.concepts.flatMap(f => content(f.mot).map(stem)) : [];
        const couvert = new Set([...sc.mots, ...motsConcept.filter(x => stems.includes(x))]);
        const couverture = stems.length ? couvert.size / stems.length : 0;
        if (typeRe && typeRe.test(l.plain) && (sc.mots.size || sc.dico)) { s += 3; sc.valeur = 1; }
        const titreSt = new Set(content(l.s + " " + (pageById.get(l.p)?.titre || "")).map(stem));
        if (stems.some(x => titreSt.has(x))) { s += 1.5; sc.titre = 1; }
        if (conceptPages.has(l.p)) { s += 2; sc.dicoPage = 1; }
        // Targeted lookup: the word is the row's own label [7sexies:90]. "hors plaques" in a sentence is not the Plaques row.
        if (l.row && typeof l.row[0] === "string") {
          const etiquette = new Set(content(l.row[0]).map(stem));
          if ([...etiquette].some(x => stems.includes(x) && !MOTS_DE_TYPE.has(x))) { s += 4; sc.etiquette = 1; }
        }
        s *= coef;
        // Page boost: ours, by analogy with the section-title boost of 7B:337-350. It is not a stay.
        if (pageCourante && l.p === pageCourante) { s *= 1.3; sc.page = 1; }
        cands.push({ i, l, s, sc, couverture });
      }
      cands.sort((a, b) => b.s - a.s);
      // One candidate per paragraph: the margin compares places, not sentences of one place.
      const vus = new Set(); const top = [];
      for (const c of cands) { if (vus.has(c.l.g)) continue; vus.add(c.l.g); top.push(c); if (top.length >= 12) break; }
      const marge = top.length > 1 ? top[0].s - top[1].s : (top[0]?.s || 0);
      const audit = [];
      const sec = new Map();
      for (const c of cands.slice(0, 60)) {
        const k = c.l.p + " › " + c.l.s;
        if (!sec.has(k)) { sec.set(k, { section: k, page: 0, titre: 0, mot: 0, dico: 0, valeur: 0, meilleur: +c.s.toFixed(1) }); audit.push(sec.get(k)); }
        const a = sec.get(k);
        a.page = a.page || c.sc.page; a.titre = a.titre || c.sc.titre; a.mot = Math.max(a.mot, c.sc.mots.size);
        a.dico = a.dico || (c.sc.dico || c.sc.dicoPage ? 1 : 0); a.valeur = a.valeur || c.sc.valeur;
      }
      return { top, marge, audit: audit.slice(0, 8), stems, nb: cands.length };
    }

    const MIN_SCORE = opt.minScore ?? 4, MIN_MARGE = opt.minMarge ?? 1.5;
    // Offline vectors, one per line, 256 numbers each, normalised. One vote among others [7C:252-258].
    function parVecteur(q, k) {
      const V = opt.vecteurs, d = 256, n = L.length;
      const qn = Math.hypot(...q);
      const sc = new Float32Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < d; j++) s += V[i * d + j] * q[j]; sc[i] = s / qn; }
      return [...sc.keys()].sort((a, b) => sc[b] - sc[a]).slice(0, k);
    }

    function source(l) {
      const p = pageById.get(l.p);
      return { page: p?.titre || l.p, section: l.s && l.s !== p?.titre ? l.s : "", verifie: index.stats.verifie, ligne: l.id };
    }
    const vue = l => ({ id: l.id, t: l.t, k: l.k, p: l.p, s: l.s, a: l.a, r: l.r, row: l.row });
    const autour = l => L.filter(x => x.g === l.g).map(vue);
    const trouve = (p, c) => L.find(l => l.p === p && l.t.includes(c));

    // D21: a flagged FAQ row never shows its opener.
    function ligneFAQ(l, faq) {
      if (!faq.opener_faux) return { lignes: [vue(l)], note: null };
      const fiche = L.filter(x => x.p === faq.fiche && !["titre", "astuce"].includes(x.k));
      const st = new Set(content(l.s + " " + faq.lignes.map(i => byId.get(i).t).join(" ")).map(stem));
      let best = null, bs = 0;
      for (const x of fiche) { let s = 0; for (const t of x.st) if (st.has(t)) s++; if (s > bs) { bs = s; best = x; } }
      if (best && bs >= 4) return { lignes: [vue(best)], remplace: true };
      const suite = faq.lignes.slice(1).map(i => vue(byId.get(i)));
      return { lignes: suite.length ? suite.slice(0, 2) : [vue(l)], remplace: true };
    }

    function verifConflit(row, part) {
      const pq = row.pq;
      for (const c of DECLARE.conflits || []) {
        const hit = c.quand.filter(w => pq.includes(plain(w)));
        const conc = part.lignes && part.lignes.some(x => c.lignes.some(y => x.p === y.p && x.t.includes(y.c)));
        if (conc || hit.length >= 2 || (hit.length === 1 && c.quand[0] === hit[0])) {
          const ls = c.lignes.map(y => trouve(y.p, y.c)).filter(Boolean);
          if (ls.length === 2) return { statut: "DEUX_CHOSES", lignes: ls.map(vue), sources: ls.map(source), declare: c.id, nomodel: ls.some(x => x.nomodel) };
        }
      }
      return null;
    }

    function verifCondition(row, ctx) {
      for (const c of DECLARE.conditions || []) {
        const motOk = c.quand.some(w => row.pq.includes(plain(w)));
        const conceptOk = row.concepts.some(x => x.id === c.concept) || /\b(commune|arrivee|declar\w+|enregistr\w+)\b/.test(row.pq);
        if (!motOk || !conceptOk) continue;
        let v = null;
        if (/\b(hors ue|hors union|pays tiers|marocain\w*|tunisien\w*|algerien\w*|americain\w*|indien\w*|chinois\w*|bresilien\w*|turc|turque|britannique|russe|ukrainien\w*|canadien\w*|cap-verdien\w*)\b/.test(row.pq)) v = "tiers";
        if (/\b(francais\w*|belge|allemand\w*|portugais\w*|italien\w*|espagnol\w*|polonais\w*|neerlandais\w*|roumain\w*|suisse|citoyen de l'union|europeen\w*)\b/.test(row.pq)) v = "ue";
        const ids = Object.keys(c.valeurs);
        const ligne = id => trouve(c.valeurs[id].ligne.p, c.valeurs[id].ligne.c);
        if (v && ligne(v)) return { statut: "REPONSE", lignes: [vue(ligne(v))], sources: [source(ligne(v))], note: v === "tiers" ? c.note : null, condition: c.id, fait: v };
        const ls = ids.map(ligne).filter(Boolean);
        return { statut: "REPONSE", lignes: ls.map(vue), libelles: ids.map(i => c.valeurs[i].label), sources: ls.map(source), note: "Cela dépend de votre nationalité, pas du pays d'où vous arrivez.", condition: c.id };
      }
      return null;
    }

    // ---------- Handlers: <format>_<intent> ----------
    const H = {
      hors_sujet: () => ({ statut: "HORS", texte: "Cette question sort de ce que couvre le guide : l'installation au Luxembourg." }),
      urgence: () => ({ statut: "URGENCE", texte: "Appelez le 112 (urgences, gratuit, depuis tout téléphone). Je suis un guide, je ne peux pas vous aider dans l'urgence." }),
      prive: () => ({ statut: "PERSONNEL", texte: "Votre message contient ce qui ressemble à une donnée personnelle. Je ne l'ai ni répété ni envoyé. Reformulez sans ce numéro et je chercherai." }),
      salut: (row, ctx) => ({ statut: "SALUT", texte: /merci/.test(row.pq) ? "Avec plaisir." : `Bonjour. ${ctx.page ? `Vous lisez : ${ctx.page.titre}. ` : ""}Posez votre question, je réponds avec les phrases du guide.` }),
      refus: row => { const r = REFUS.find(x => x.re.test(row.pq)); return { statut: "REFUS", texte: r.texte, lien: { route: r.route, label: r.label }, regle: r.id }; },

      clarifier(row, ctx) {
        const multi = row.concepts.find(c => c.c.sens && !c.c.sens.some(s => s.mots.some(m => row.pq.includes(plain(m)))));
        if (multi) {
          const defaut = ctx.page && multi.c.sens.find(s => s.mots.some(m => plain(ctx.page.titre || "").includes(plain(m))));
          return { statut: "CLARIFIER", texte: `« ${multi.mot} » peut vouloir dire plusieurs choses dans le guide. Vous parlez de quoi ?`,
            options: multi.c.sens.map(s => ({ label: s.label, envoie: `${row.original} (${s.ajoute})`, defaut: s === defaut })), champ: "sens" };
        }
        if (row.ambigu && row.ambiguOptions?.length >= 2) return { statut: "CLARIFIER", texte: "Votre question peut se comprendre de plusieurs façons. Laquelle ?", champ: "sens", options: row.ambiguOptions.slice(0, 3).map(o => ({ label: o, envoie: o })), parModele: true };
        return { statut: "CLARIFIER", texte: "C'est-à-dire ? Dites-moi de quoi vous parlez.",
          options: [{ label: "Un loyer ou une caution", envoie: "Quelle garantie locative un bailleur peut-il demander ?" }, { label: "Un salaire", envoie: "Quelle différence entre classe 1 et classe 2 ?" }, { label: "L'immatriculation", envoie: "Combien coûte l'immatriculation ?" }], champ: "sujet" };
      },

      outil_guide(row) {
        const c = row.concepts.find(x => x.c.tool);
        return { statut: "OUTIL", texte: `Cette réponse se trouve dans un outil du guide, que je ne lis pas encore : ${c.c.titre}.`, lien: { route: c.c.tool, label: `Ouvrir : ${c.c.titre}` } };
      },

      // D41: typed slots, an echo, no defaults.
      outil_qa(row) {
        if (!sim) return { statut: "OUTIL", texte: "Le simulateur du guide calcule ce net.", lien: { route: "#simulateur/salaire", label: "Ouvrir le simulateur" } };
        const sansClasse = row.pq.replace(/classe\s*(1a|1|2)/g, " ");
        const m = sansClasse.match(/(\d{1,3}(?:[ .]\d{3})+|\d{4,7}|\d+(?:[.,]\d+)?\s*k\b)/);
        const net = /\b(\d[\d .]*)\s*(€|euros?)?\s*net\b/.test(sansClasse);
        if (net && /\bbrut\b/.test(sansClasse) && !/\bbrut\b.*\bnet\b.*\?/.test(sansClasse) && /\bquel\b.*\bbrut\b/.test(sansClasse))
          return { statut: "REPONSE_SANS", texte: "Le guide calcule du brut vers le net, pas dans l'autre sens. Je ne le fais pas à sa place.", lien: { route: "#simulateur/salaire", label: "Ouvrir le simulateur" } };
        if (!m) return { statut: "CLARIFIER", texte: "Quel est le salaire brut annuel ?", options: [], champ: "brut", libre: true };
        let v = m[1].replace(/[ .]/g, "");
        v = /k$/i.test(v) ? Math.round(parseFloat(v) * 1000) : parseInt(v, 10);
        const mensuel = /\b(par mois|mensuel\w*|\/mois|chaque mois)\b/.test(sansClasse);
        const mois = /\b13\b.*\bmois\b|treizieme/.test(sansClasse) ? 13 : 12;
        const brut = mensuel ? v * mois : v;
        const classes = [...row.pq.matchAll(/classe\s*(1a|1|2)/g)].map(x => "classe" + x[1]);
        const impatrie = /\bimpatrie/.test(row.pq);
        const toutes = sim.comparatif(brut, mois);
        const lignes = toutes.filter(c => !classes.length || classes.includes(c.classe)).map(c => {
          const r = impatrie ? c.resImpatrie : c.res;
          return { label: c.label, netMensuel: Math.round(r.netMensuel) };
        });
        const montreNet = row.negation ? row.negation.veut === "net" : true;
        return { statut: "CALCUL", calc: { fonction: "SIM.comparatif", entrees: { brut_annuel: brut, mois, classes: classes.length ? classes : "toutes", impatrie }, lignes },
          echo: `${brut.toLocaleString("fr-FR")} € brut par an${mensuel ? ` (${v.toLocaleString("fr-FR")} € × ${mois})` : ""}, sur ${mois} mois${classes.length ? ", " + classes.map(c => c.replace("classe", "classe ")).join(" et ") : ", les trois classes"}${impatrie ? ", régime des impatriés" : ""}`,
          note: [impatrie ? "Calculé sans vérifier que vous remplissez les conditions du régime." : null, opt.paramsModifies ? "Vous avez modifié les paramètres du simulateur : ce calcul les utilise." : null, "Indicatif : retenue sur le seul salaire, pas le chiffre de votre fiche de paie.", montreNet ? null : null].filter(Boolean),
          lien: { route: "#simulateur/salaire", label: "Ouvrir le simulateur" } };
      },

      // D42: the tree is a table, walked by code from what the reader stated.
      arbre(row) {
        const { arbre, fins } = index.arbre;
        const pq = row.pq;
        const faits = {
          depart: /\b(marie|mariee|pacse|pacsee|partenariat|ma femme|mon mari|mon epoux|mon epouse)\b/.test(pq) ? 0 : /\b(celibataire|seul|seule|union libre|divorce|divorcee|separe|separee|veuf|veuve|pas marie)\b/.test(pq) ? 1 : null,
          residence: /\b(reste|restent|encore|a l'etranger|en france|en belgique|en allemagne|au portugal)\b/.test(pq) ? 1 : /\b(tous les deux|au luxembourg|ici)\b/.test(pq) ? 0 : null,
          rupture: /\bveuf|veuve\b.*\bdepuis moins|deces\b/.test(pq) ? 1 : /\b(divorce|divorcee|separe|separee)\b/.test(pq) ? 2 : /\b(celibataire|jamais marie|rien de tel)\b/.test(pq) ? 0 : null,
          moderation: /\b(enfant|enfants|moderation)\b/.test(pq) ? 1 : /\b(64 ans|65 ans|retraite)\b/.test(pq) ? 2 : /\b(sans enfant|pas d'enfant|ni l'un ni l'autre)\b/.test(pq) ? 0 : null,
        };
        let n = "depart"; const chemin = [];
        while (arbre[n]) {
          const i = faits[n];
          if (i === null || i === undefined) {
            return { statut: "CLARIFIER", texte: arbre[n].q, chemin, champ: "arbre:" + n,
              options: arbre[n].r.map(r => ({ label: r[0], envoie: `${row.original.replace(/\s*\(.*\)$/, "")} (${r[0]})` })) };
          }
          chemin.push({ q: arbre[n].q, r: arbre[n].r[i][0] });
          n = arbre[n].r[i][1];
        }
        const f = fins[n];
        return { statut: "REPONSE", titre: f.titre, lignesLibres: [f.texte, f.alerte].filter(x => typeof x === "string"), chemin, fin: n,
          sources: [{ page: "Simulateur › Quelle classe", section: "" }], lien: { route: "#simulateur/classe", label: "Ouvrir l'arbre du guide" } };
      },

      // D43: done, left, not concerned. Nothing is guessed about the reader.
      etat(row, ctx) {
        const p = ctx.profil || {};
        const coches = ctx.coches || {};
        const concerne = it => !it.si || Object.keys(it.si).every(k => {
          const v = p[k];
          if (v === undefined) return true;
          if (k === "enfants") return v !== "Aucun";
          if (k === "vehicule") return v === "Oui";
          if (k === "logement") return v === it.si.logement || v === "Pas encore decide";
          if (k === "statut") return v === it.si.statut || v === "Les deux";
          return v === it.si[k];
        });
        const fait = [], reste = [], hors = [];
        for (const it of index.parcours) (concerne(it) ? (coches[it.t] || coches[it.id] ? fait : reste) : hors).push(it);
        const conditionnels = reste.filter(it => it.si && !Object.keys(it.si).every(k => p[k] !== undefined));
        return { statut: "LISTE", liste: reste.slice(0, /commencer/.test(row.pq) ? 6 : 14).map(it => ({ t: it.t, phase: it.phase, ligne: it.line, conditionnel: conditionnels.includes(it) })),
          complet: { n: reste.length, source: "le parcours du guide", tronque: reste.length > 14 }, etat: { fait: fait.length, reste: reste.length, hors: hors.length },
          note: [/commencer/.test(row.pq) ? "Le guide met la commune d'abord, mais la commune demande un bail, le bail une garantie, la garantie un compte, et le compte une adresse. Il ne résout pas cette boucle." : null,
            conditionnels.length ? `${conditionnels.length} étapes dépendent de votre situation, que je ne connais pas.` : null].filter(Boolean),
          lien: { route: "#parcours", label: "Ouvrir le parcours" } };
      },

      table_sinistre(row) {
        const st = new Set(row.mots.map(stem));
        const scored = index.verdicts.map(v => {
          const t = new Set(content(`${v.groupe} ${v.titre} ${v.question}`).map(stem));
          let s = 0; for (const x of st) if (t.has(x)) s++;
          const tt = new Set(content(v.titre).map(stem)); for (const x of st) if (tt.has(x)) s += 1;
          const gg = new Set(content(v.groupe).map(stem)); for (const x of st) if (gg.has(x)) s += 1.5;
          return { v, s };
        }).sort((a, b) => b.s - a.s);
        if (scored[0].s < 3) return null;
        const v = scored[0].v;
        // The scenario must carry the question's words. A candle in a garden shares "vacances" with a stolen phone; that is not this scenario.
        const texteV = new Set(content(`${v.groupe} ${v.titre} ${v.question}`).map(stem));
        const couverts = [...st].filter(x => texteV.has(x)).length;
        if (couverts / st.size < 0.4) return null;
        const ass = row.pq.match(/assureur ([abcd])\b/);
        const lignes = v.assureurs.filter(a => !ass || a.assureur.endsWith(ass[1].toUpperCase()));
        const filtre = row.complement ? lignes.filter(a => ["excluded", "not_covered"].includes(a.statut)) : lignes;
        const nf = lignes.filter(a => a.statut === "not_found").length;
        return { statut: "VERDICTS", scenario: { id: v.id, groupe: v.groupe, titre: v.titre }, lignes: [vue(byId.get(v.line))], verdicts: filtre,
          requete: `verdicts où scénario = ${v.id}${ass ? `, assureur = ${ass[1].toUpperCase()}` : ""}${row.complement ? ", statut = exclu ou non couvert" : ""}`,
          note: ["Ces verdicts portent sur des extraits de quatre contrats anonymisés. Ils ne disent rien de votre contrat.",
            nf ? `${nf} sans réponse : « non trouvé dans les extraits » ne veut pas dire non couvert.` : null].filter(Boolean),
          lien: { route: "#comparateur", label: "Ouvrir le comparateur" } };
      },

      table_avantages(row) {
        let cs = index.cartes;
        const seuil = row.pq.match(/\b(au[- ]dessus de|plus de|superieure? a|moins de|sous|inferieure? a)\s+(\d[\d .]*)/);
        const moment = { salaire: /salaire|travail/, logement: /logement|achat|acheter/, famille: /famille|enfant|etude/, epargne: /epargne|declaration/, quotidien: /quotidien|revenus modestes/ };
        const cle = Object.keys(moment).find(k => moment[k].test(row.pq));
        if (cle) cs = cs.filter(c => c.moment === cle);
        let sansValeur = 0;
        if (seuil) {
          const n = parseInt(seuil[2].replace(/[ .]/g, ""), 10);
          const haut = /dessus|plus|superieur/.test(seuil[1]);
          cs = cs.filter(c => {
            const m = String(c.chiffre || "").replace(/\s/g, "").match(/(\d+)/);
            if (!m) { sansValeur++; return false; }
            return haut ? +m[1] > n : +m[1] < n;
          });
        }
        return { statut: "LISTE", liste: cs.map(c => ({ t: `${c.titre} : ${c.chiffre}${c.sous ? ", " + c.sous : ""}`, ligne: c.lignes[0] })),
          complet: { n: cs.length, source: "la table des avantages", total: index.cartes.length }, compte: row.forme === "compte",
          requete: `cartes${cle ? ` où moment = ${cle}` : ""}${seuil ? `, chiffre ${seuil[1]} ${seuil[2]}` : ""}`,
          note: sansValeur ? [`${sansValeur} cartes n'ont pas de chiffre : non comptées, ce qui ne veut pas dire zéro.`] : [], lien: { route: "#avantages", label: "Ouvrir les avantages" } };
      },

      table_parcours(row) {
        const phases = [...new Set(index.parcours.map(p => p.phase))];
        const st = new Set(row.mots.map(stem));
        const best = phases.map(ph => { let s = 0; for (const w of content(ph).map(stem)) if (st.has(w)) s++; return { ph, s }; }).sort((a, b) => b.s - a.s)[0];
        const items = best.s ? index.parcours.filter(p => p.phase === best.ph) : index.parcours;
        return { statut: "LISTE", titre: best.s ? best.ph : "Tout le parcours", liste: items.map(it => ({ t: it.t, ligne: it.line })), complet: { n: items.length, source: "le parcours du guide" }, requete: `parcours${best.s ? ` où phase = ${best.ph}` : ""}`, lien: { route: "#parcours", label: "Ouvrir le parcours" }, note: [] };
      },

      astuce(row, ctx) {
        const st = new Set(row.mots.filter(m => !/astuce|conseil/.test(m)).map(stem));
        const c = L.filter(l => l.k === "astuce").map(l => { let s = 0; for (const x of l.st) if (st.has(x)) s++; if (l.p === ctx.page?.id) s += 1; return { l, s }; }).sort((a, b) => b.s - a.s);
        if (!c[0].s) return null;
        return { statut: "REPONSE", lignes: c.slice(0, 2).map(x => vue(x.l)), sources: [source(c[0].l)], note: ["Retours d'expérience de personnes déjà installées. Ces conseils n'ont pas de valeur officielle : en cas d'enjeu, la source citée plus haut fait foi."], registre: "communaute" };
      },

      resume(row, ctx) {
        if (!ctx.page) return null;
        const ls = L.filter(l => l.p === ctx.page.id && (l.k === "retenir" || l.k === "chapo"));
        if (!ls.length) return null;
        return { statut: "REPONSE", titre: "Ce que le guide retient de cette page", lignes: ls.map(vue), sources: [source(ls[0])] };
      },

      valeur(row) {
        const v = (DECLARE.valeurs || []).find(x => x.quand.some(w => row.pq.includes(plain(w))));
        if (!v) return null;
        return { statut: "REPONSE", lignesLibres: [v.texte], annonce: { en_vigueur: v.en_vigueur, annonce: v.annonce }, sources: [{ page: v.source, section: "" }], note: ["Annoncé, pas en vigueur, selon le guide à sa date. Cela a pu changer depuis."], lien: { route: v.route, label: "Ouvrir le simulateur" } };
      },

      epargne_qa(row) {
        const st = new Set(row.mots.map(stem));
        let best = null, bs = 0;
        for (const e of index.entrees) {
          e.sts = e.sts || [e.question, ...e.variantes].map(t => new Set(content(t).map(stem)));
          for (const v of e.sts) {
            let n = 0; for (const x of st) if (v.has(x)) n++;
            const d = st.size + v.size ? 2 * n / (st.size + v.size) : 0;
            if (d > bs) { bs = d; best = e; }
          }
        }
        if (!best || bs < 0.34) return null;
        const ls = best.lignes.map(i => byId.get(i));
        return { statut: "REPONSE", titre: best.question, lignes: ls.slice(0, 3).map(vue), autour: ls.map(vue), sources: [source(ls[0])], nomodel: true, note: ["Réponse écrite à l'avance par l'auteur du guide. Aucun modèle ne lit cette section."] };
      },

      // B2: direct only if the concept and the shape match. False direct breaks trust.
      faq_cache(row) {
        const st = new Set(row.mots.map(stem));
        if (st.size < 2) return null;
        let best = null, bs = 0;
        for (const f of index.faq) {
          f.st = f.st || new Set(content(f.q).map(stem));
          let n = 0; for (const x of st) if (f.st.has(x)) n++;
          const dice = 2 * n / (st.size + f.st.size);
          if (dice > bs) { bs = dice; best = f; }
        }
        if (!best || bs < 0.72) return null;
        if (typeDe(plain(best.q), best.q) !== row.type) return null;
        const l0 = byId.get(best.lignes[0]);
        const r = ligneFAQ(l0, best);
        const full = best.opener_faux ? r.lignes : best.lignes.map(i => vue(byId.get(i)));
        return { statut: "REPONSE", lignes: full.slice(0, 3), sources: [source(byId.get(full[0].id))], faq: { id: best.id, dice: +bs.toFixed(2), remplace: !!r.remplace }, canal: "cache" };
      },

      async fiche_qa(row, ctx, T) {
        const modele = opt.modele || null;
        const f = chercher(row, ctx);
        T.push({ qui: "code", etape: "Détecteurs", detail: `${f.nb} lignes touchées · marge ${f.marge.toFixed(1)}`, json: { audit: f.audit } });
        if (!f.top.length && !(modele && opt.vecteurs)) return null;
        let c = f.top[0] || { s: 0, l: { nomodel: false, k: "" }, sc: { mots: new Set(), dico: 0 }, couverture: 0, vide: true };
        const clair = c.s >= MIN_SCORE && f.marge >= MIN_MARGE;
        let arbitre = null;
        // The words must really land here. A zero on one of the reader's words is not ignored [7A:23].
        const motsAbsents = f.stems.filter(x => !inv.has(x));
        const assezFort = x => row.epingle ? x.s > 0
          : motsAbsents.length && x.couverture < 0.6 ? false
          : (x.sc.mots.size >= 2 && x.couverture >= 0.5) || ((x.sc.dico >= 1 || x.sc.dicoPage) && x.couverture >= 0.33) || (f.stems.length === 1 && x.couverture === 1);
        if (!assezFort(c) && !modele) { T.push({ qui: "code", etape: "Refus", detail: `meilleure ligne trop faible (couverture ${c.couverture.toFixed(2)}${motsAbsents.length ? ", mots absents : " + motsAbsents.join(", ") : ""})` }); return null; }
        const savingsDansMarge = f.top.slice(0, 4).some(x => x.l.nomodel && c.s - x.s < MIN_MARGE);
        if (!clair && savingsDansMarge && !c.l.nomodel) {
          const autre = f.top.find(x => x.l.nomodel);
          return { statut: "CLARIFIER", texte: "Je peux comprendre deux choses. Laquelle ?", champ: "lieu",
            options: [{ label: pageById.get(c.l.p)?.titre || c.l.p, envoie: `${row.original} (${pageById.get(c.l.p)?.titre})` }, { label: "Section épargne : " + autre.l.s, envoie: autre.l.s }] };
        }
        if ((c.vide || !clair || !assezFort(c)) && modele && !c.l.nomodel) {
          row.appels = (row.appels || 0) + 1;
          const glossaire = row.concepts.slice(0, 2).map(x => pageById.get((x.c.pages || [])[0])?.resume).filter(Boolean).join(" ");
          let cands = f.top.filter(x => !x.l.nomodel).slice(0, 5);
          if (opt.vecteurs && modele.embed) {
            const v = await modele.embed(row.corrigee || row.original);
            if (v) {
              const proches = parVecteur(v, 14).filter(i => !L[i].nomodel && COEF[L[i].k] !== 0 && !cands.some(x => x.l.g === L[i].g));
              const vus2 = new Set();
              for (const i of proches) { if (vus2.has(L[i].g) || cands.length >= 10) continue; vus2.add(L[i].g); cands.push(f.top.find(x => x.l.id === L[i].id) || { s: 0, l: L[i], sc: { mots: new Set(), dico: 0, vecteur: 1 }, couverture: 0 }); }
              T.push({ qui: "modèle", etape: "Vecteurs", detail: `${vus2.size} passages proches ajoutés au dossier` });
            }
          }
          if (!cands.length) return null;
          arbitre = await modele.arbitre(row, cands.map(x => ({ id: x.l.id, section: pageById.get(x.l.p)?.titre + " › " + x.l.s, methods: ["mots", "dico", "valeur", "titre", "page", "etiquette", "vecteur"].filter(k => k === "mots" ? x.sc.mots.size : x.sc[k]), snippet: autour(x.l).map(y => y.t).join(" ").slice(0, 320) })), glossaire);
          if (arbitre) {
            T.push({ qui: "modèle", etape: "Arbitre", detail: arbitre.raison || "", json: arbitre });
            const pick = arbitre.choix && cands.find(x => x.l.id === arbitre.choix);
            if (arbitre.conflit) {
              const prim = (arbitre.roles || []).filter(x => x.role === "primary").map(x => cands.find(y => y.l.id === x.id)).filter(Boolean);
              if (prim.length >= 2) {
                T.push({ qui: "modèle", etape: "Désaccord dans le guide", detail: "signalé par l'arbitre, à relire" });
                return { statut: "DEUX_CHOSES", lignes: prim.slice(0, 2).map(x => vue(x.l)), sources: prim.slice(0, 2).map(x => source(x.l)), parModele: true, note: ["Ce désaccord est signalé par le modèle, je ne l'ai pas déclaré après lecture."] };
              }
            }
            if (pick) c = pick;
            else { T.push({ qui: "code", etape: "Arbitre écouté", detail: "aucun candidat ne répond" }); return null; }
          } else T.push({ qui: "modèle", etape: "Arbitre", detail: "pas de réponse dans le temps : meilleure ligne du code, signalée" });
        } else {
          T.push({ qui: clair ? "modèle" : "code", etape: clair ? "Modèle non appelé" : "Sans arbitre", detail: clair ? "marge claire" : "marge plate, pas de modèle disponible : meilleure ligne, non arbitrée" });
        }
        if (!assezFort(c) && !arbitre?.choix) { T.push({ qui: "code", etape: "Refus", detail: `meilleure ligne trop faible (couverture ${c.couverture.toFixed(2)})` }); return null; }
        const lignes = ["pays", "coche"].includes(c.l.k) ? autour(c.l).slice(0, 8) : [vue(c.l)];
        const typeRe = RE_TYPE[row.type];
        let manque = null;
        if (typeRe && !typeRe.test(c.l.plain)) {
          // D27: a number was asked. Is it on another line of this place?
          const voisine = c.l.row ? null : L.filter(x => x.g === c.l.g && typeRe.test(x.plain))[0];
          if (voisine) lignes.unshift(vue(voisine));
          else if (row.type === "montant") manque = "NE_CHIFFRE_PAS";
          else if (row.type === "duree") manque = "NE_DATE_PAS";
        }
        if (row.type === "definition" || row.type === "procedure") {
          for (const x of autour(c.l)) if (!lignes.some(y => y.id === x.id) && lignes.length < 3) lignes.push(x);
        }
        // D25: for a yes/no, a label only if two separate reads agree. Never on a savings line.
        let label = null, conditions = null;
        if (row.type === "booleen" && modele && !c.l.nomodel && (row.appels || 0) <= 1) {
          const contexte = autour(c.l).slice(0, 6).map(y => ({ id: y.id, t: y.t }));
          const a = await modele.lire(row, contexte);
          const b = a && a.label !== "inconnu" ? await modele.relire(row, contexte) : null;
          T.push({ qui: "modèle", etape: "Lecture oui/non", detail: a ? `première lecture : ${a.label}${b ? ", seconde lecture : " + b.label : ""}` : "pas de réponse", json: { a, b } });
          if (a && b && a.label === b.label) { label = a.label; conditions = (a.conditions || []).filter(id => contexte.some(y => y.id === id)); }
          else if (a && b) T.push({ qui: "code", etape: "Désaccord", detail: "pas d'étiquette, la règle seule" });
        }
        return { label, statut: manque === "NE_CHIFFRE_PAS" ? "NE_CHIFFRE_PAS" : manque === "NE_DATE_PAS" ? "NE_CHIFFRE_PAS" : "REPONSE", lignes, autour: autour(c.l), sources: [source(c.l)],
          ailleurs: ctx.page && c.l.p !== ctx.page.id ? pageById.get(c.l.p)?.titre : null, nomodel: !!c.l.nomodel, audit: f.audit, clair, nonArbitre: !clair && !arbitre };
      },

      // B3: the words, the sweep, the nearest passage and why it does not answer.
      absence(row) {
        const parMot = {};
        const hits = new Map();
        for (const w of row.mots) {
          const s = stem(w);
          const ids = (inv.get(s) || []).filter(i => COEF[L[i].k] !== 0);
          parMot[w] = ids.length;
          for (const i of ids) hits.set(i, (hits.get(i) || 0) + 1);
        }
        const proche = [...hits.entries()].sort((a, b) => b[1] - a[1])[0];
        const ensemble = proche && proche[1] >= 2;
        const nearest = proche ? L[proche[0]] : null;
        const trouves = Object.entries(parMot).filter(([, n]) => n);
        const zero = Object.entries(parMot).filter(([, n]) => !n).map(([w]) => w);
        return { statut: "RIEN", mots: Object.keys(parMot), zero, parMot,
          force: zero.length === Object.keys(parMot).length ? "forte" : ensemble ? "faible" : "moyenne",
          couverture: { lignes: L.length, pages: index.pages.length, sans: "cartes, lignes et aires de jeux" },
          proche: nearest ? { ...vue(nearest), source: source(nearest), pourquoi: ensemble ? "ce passage touche à certains de ces mots mais ne répond pas à la question." : `il ne contient que « ${trouves.map(x => x[0]).filter(w => nearest.st.has(stem(w))).join(", ")} ».` } : null,
          texte: "Je n'en déduis pas que ce n'est pas couvert ou que cela n'existe pas : je constate seulement que le guide n'en parle pas sous ces mots." };
      },
    };

    // ---------- D30: the dispatcher ----------
    function decide(row, ctx) {
      const q = row.pq, plan = [];
      const dit = (id, why) => plan.push({ id, route: REGLES.find(r => r[0] === id)[2], why });
      if (/\b(urgence|je sens le gaz|ca sent le gaz|au feu|au secours|crise cardiaque|ne respire|inconscient\w*|me suicider|emergency)\b/.test(q)) { dit("r1"); return plan; }
      if (/\b[a-z]{2}\d{2}(?:\s?[a-z0-9]{4}){3,}\b/.test(q) || /\b\d{13}\b/.test(q.replace(/\s/g, "")) && /\d{4}\s?\d{4}\s?\d{5}/.test(q)) { dit("r2"); return plan; }
      if (/^(bonjour|salut|bonsoir|hello|coucou|merci|hi|thanks)\b[ ,.!a-z]{0,14}$/.test(q) && row.mots.length <= 1) { dit("r3"); return plan; }
      if (REFUS.some(r => r.re.test(q))) { dit("r4"); return plan; }
      if (row.horsSujet) { dit("r21"); return plan; }
      if (row.ambigu && !row.concepts.length) { dit("r23"); return plan; }
      const multi = row.concepts.find(c => c.c.sens && !c.c.sens.some(s => s.mots.some(m => q.includes(plain(m)))));
      if (multi) { dit("r6", multi.mot); return plan; }
      if (!row.concepts.length && !row.herite && !row.mots.length && !ctx.page) { dit("r7"); return plan; }
      if (!row.concepts.length && !row.herite && row.mots.length === 0 && ctx.page && ctx.page.id) { /* the page is the subject */ }
      if (row.concepts.some(c => c.c.tool)) { dit("r8"); return plan; }
      if (/\b(salaire|brut|net|paie|gross|salary)\b/.test(q) && /\d/.test(q.replace(/classe\s*\d\w?/g, ""))) dit("r9");
      else if (/\b(quelle classe|ma classe|quelle est ma classe|which tax class|classe d'impots? pour|dans quelle classe)\b/.test(q) || (/\bclasse\b/.test(q) && /\b(marie|mariee|celibataire|divorce|divorcee|veuf|veuve|pacse)\b/.test(q))) dit("r10");
      else if (/\b(il me manque|me reste|par ou commencer|ou j'en suis|qu'est ce que je dois faire|que me reste|prochaine etape)\b/.test(q)) dit("r11");
      else {
        if (/\bastuce|retour d'experience\b/.test(q)) dit("r15");
        if (/\b(resume\w*|en bref|l'essentiel)\b/.test(q)) dit("r16");
        if ((DECLARE.valeurs || []).some(v => v.quand.some(w => q.includes(plain(w))))) dit("r17");
        if (ctx.page?.id === "prevoyance" || /\b(111 ?bis|prevoyance|retraite complementaire|pension privee|epargne retraite|epargne-retraite|vieillesse)\b/.test(q)) dit("r22");
        if (row.concepts.some(c => c.id === "sinistre") && /\b(couvert|couverte|indemnise\w*|assurance|assureur|garanti\w*|suis-je|vol\w*|contrat\w*|exclu\w*)\b/.test(q)) dit("r12");
        if (row.concepts.some(c => c.id === "aides") && (row.forme !== "single" || /\b(au[- ]dessus|plus de|moins de|sous)\b/.test(q))) dit("r13");
        if (/\b(que faire|quoi faire|que dois-je faire|premier mois|avant le depart|premiere semaine|etapes)\b/.test(q) && !/\bvehicule|voiture|immatricul\w*\b/.test(q)) dit("r14");
        dit("r18");
      }
      dit("r19"); dit("r20");
      return plan;
    }

    async function unePartie(original, ctx, cond) {
      const T = [];
      const row = ligneDeQuestion(cond ? `${original}` : original, ctx);
      T.push({ qui: "code", etape: "Page lue", detail: ctx.page ? `${ctx.page.id}${ctx.page.onglet ? " › " + ctx.page.onglet : ""}` : "aucune" });
      if (row.corrections.length) T.push({ qui: "code", etape: "Orthographe", detail: row.corrections.map(c => `${c[0]} → ${c[1]}`).join(", ") + " (vocabulaire du guide)" });
      if (row.herite) T.push({ qui: "code", etape: "Suite", detail: `repris de : ${row.herite}` });

      // Parse call: only behind a code gate (D31), and never for what the first rules catch.
      const modele = opt.modele || null;
      const zeros = row.mots.filter(m => !inv.has(stem(m)));
      const premiere = decide(row, ctx)[0].id;
      if (modele && row.mots.length && !["r1", "r2", "r3", "r4", "r6", "r8"].includes(premiere) && (!row.concepts.length || zeros.length || row.mots.length >= 6)) {
        row.appels = (row.appels || 0) + 1;
        const liste = concepts.filter(c => !c.tool).map(c => c.source === "auteur" ? `${c.id}: ${c.mots[0]}` : `${c.id}: ${c.mots.slice(0, 2).join(", ")}`);
        const parse = await modele.parse(row, liste, ctx.page?.titre);
        if (parse) {
          T.push({ qui: "modèle", etape: "Compréhension", detail: (parse.termes || []).join(", "), json: parse });
          if (parse.dans_le_sujet === false) row.horsSujet = true;
          const pc = plain(parse.corrigee || "").replace(/[?!.]+$/g, "").trim();
          if (pc) { row.pq = pc; row.corrigee = parse.corrigee; }
          const deja = new Set(row.concepts.map(x => x.id));
          for (const x of trouverConcepts(pc)) if (!deja.has(x.id)) { deja.add(x.id); row.concepts.push(x); }
          for (const id of parse.concepts || []) { const c = concepts.find(x => x.id === id); if (c && !deja.has(id)) { deja.add(id); row.concepts.push({ id, mot: c.mots[0], source: "modele", c }); } }
          for (const t of [...(parse.termes || []), parse.corrigee || ""]) for (const w of content(t)) if (!row.mots.includes(w)) row.mots.push(w);
          row.motsQuestion = content(parse.corrigee || row.corrigee);
          if (parse.type && row.type === "texte") row.type = parse.type;
          if (parse.forme && row.forme === "single") row.forme = parse.forme;
          row.langue = parse.langue;
          if (parse.ambigu) { row.ambigu = true; row.ambiguOptions = parse.options; }
        } else T.push({ qui: "modèle", etape: "Compréhension", detail: "pas de réponse dans le temps : je continue sans" });
      }
      T.push({ qui: "code", etape: "Question", detail: `${row.concepts.length ? "concept " + row.concepts.map(c => c.mot).join(", ") : "aucun concept"} · ${row.forme} · ${row.type}`, json: publique(row) });

      const plan = decide(row, ctx);
      T.push({ qui: "code", etape: "Aiguillage", detail: plan.map(p => `${p.id} ${p.route}`).join(" → "), json: plan });

      // D28: settled-by-a-fact and declared conflicts are checked around every route.
      const cond0 = verifCondition(row, ctx);
      if (cond0 && !["r1", "r2", "r3", "r4"].includes(plan[0].id)) return fin(cond0, row, plan[0], T);

      for (const p of plan) {
        const r = await H[p.route](row, ctx, T);
        if (!r) continue;
        const conflit = !["URGENCE", "PERSONNEL", "SALUT", "REFUS"].includes(r.statut) ? verifConflit(row, r) : null;
        if (conflit) { T.push({ qui: "code", etape: "Conflit déclaré", detail: conflit.declare }); return fin(conflit, row, p, T); }
        return fin(r, row, p, T);
      }
      return fin(H.absence(row), row, plan[plan.length - 1], T);
    }

    const publique = r => { const { concepts: c, ...o } = r; return { ...o, concepts: (c || []).map(x => ({ id: x.id, mot: x.mot, source: x.source })) }; };

    function fin(res, row, regle, T) {
      T.push({ qui: "code", etape: "Vérification", detail: verifier(res).join(" ; ") || "ok" });
      res.regle = regle; res.trace = T; res.row = publique(row); res.question = row.original;
      return res;
    }

    // D26: the validator, on what is about to be shown.
    function verifier(r) {
      const pb = [];
      for (const l of r.lignes || []) if (!byId.has(l.id)) pb.push(`ligne inconnue ${l.id}`);
      if (r.statut === "REPONSE" && !(r.lignes?.length || r.lignesLibres?.length)) pb.push("réponse sans ligne");
      if (r.statut === "DEUX_CHOSES" && r.lignes?.length !== 2) pb.push("conflit sans deux lignes");
      return pb;
    }

    async function repondre(question, ctx = {}) {
      const trim = question.trim();
      const pre = ligneDeQuestion(trim, {});
      const debut = decide(pre, ctx)[0].id;
      if (["r1", "r2", "r3", "r4"].includes(debut)) {
        const r = await unePartie(trim, ctx);
        return { parts: [r], pattern: "single", row: r.row, masque: debut === "r2" };
      }
      const d = decomposer(trim);
      if (d.pattern === "si_oui") {
        const a = await unePartie(d.parts[0], ctx);
        const non = (a.lignes || []).some(l => /^non\b/i.test(l.t)) || a.statut === "RIEN";
        const parts = [a];
        if (!non) parts.push(await unePartie(`${d.parts[1]} ${pre.mots.slice(0, 3).join(" ")}`, ctx));
        return { parts, pattern: d.pattern, row: a.row, arret: non };
      }
      if (d.pattern === "condition") {
        const r = await unePartie(trim, ctx);
        return { parts: [r], pattern: d.pattern, row: r.row };
      }
      if (d.parts.length > 1) {
        const parts = [];
        let c2 = { ...ctx };
        for (const p of d.parts) { parts.push(await unePartie(p, c2)); }
        return { parts, pattern: d.pattern, row: parts[0].row };
      }
      const r = await unePartie(trim, ctx);
      return { parts: [r], pattern: d.pattern, row: r.row };
    }

    return { repondre, ligneDeQuestion, decide, decomposer, chercher, REGLES, concepts, trouve, L, plain };
  }

  window.Moteur = { creer, plain };
})();
