// Brick 3, retrieval as a filter: the outline picks a page, parallel detectors score the lines, the trace groups them by section.
(function () {
  const { stem, content, RE_TYPE, MOTS_DE_TYPE } = window.Texte;

  window.Briques = window.Briques || {};
  window.Briques.recherche = function ({ index, opt, L, inv, COEF, poids, pageById }) {
    // The outline: what each page says it is about, from its title and tags, then its headings [14B, 7quater].
    const pageMots = new Map(index.pages.map(p => [p.id, {
      titre: new Set(content(`${p.titre} ${(p.tags || []).join(" ")}`).map(stem)),
      plan: new Set((index.plan || []).filter(x => x.page === p.id).flatMap(x => content(x.titre).map(stem))),
    }]));
    function parPlan(stems) {
      const notes = [];
      for (const [id, m] of pageMots) {
        let s = 0;
        for (const x of stems) s += m.titre.has(x) ? 2 : m.plan.has(x) ? 1 : 0;
        if (s) notes.push({ id, s });
      }
      notes.sort((a, b) => b.s - a.s);
      return notes[0] && notes[0].s >= 2 && notes[0].s - (notes[1]?.s || 0) >= 1 ? notes[0].id : null;
    }

    function chercher(row, ctx, o = {}) {
      const stems = [...new Set(row.mots.map(stem))];
      const conceptPages = new Map();
      for (const f of row.concepts) for (const p of f.c.pages || []) conceptPages.set(p, f.id);
      const phrases = row.concepts.flatMap(f => f.c.mots).filter(m => m.includes(" "));
      const typeRe = RE_TYPE[row.type];
      const pagePlan = opt.sansPlan ? null : parPlan(stems);
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
        if (typeRe && typeRe.test(l.plain) && (sc.mots.size || sc.dico)) { s += row.type === "definition" ? 5 : 3; sc.valeur = 1; }
        const titreSt = new Set(content(l.s + " " + (pageById.get(l.p)?.titre || "")).map(stem));
        if (stems.some(x => titreSt.has(x))) { s += 1.5; sc.titre = 1; }
        if (conceptPages.has(l.p)) { s += 2; sc.dicoPage = 1; }
        if (l.p === pagePlan) { s += 3; sc.plan = 1; }
        // "C'est quoi X": the page about X says it in its opening line.
        if (row.type === "definition" && l.k === "chapo" && (l.p === pagePlan || conceptPages.has(l.p))) s += 4;
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

    return { chercher, parVecteur, MIN_SCORE, MIN_MARGE };
  };
})();
