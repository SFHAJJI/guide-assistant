// The engine: wires the bricks together and runs one question through them. No DOM here.
// Code decides everything. The model, when it is on, only fills the gaps named `modele.*`.
(function () {
  const { plain, stem, content } = window.Texte;
  const REGLES = window.Briques.REGLES;

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

    const e = { index, opt, L, pageById, byId, vocab, inv, COEF, poids, concepts, REFUS, DECLARE, sim };
    const { ligneDeQuestion, decomposer, trouverConcepts, typeDe } = window.Briques.question(e);
    const { chercher, parVecteur, MIN_SCORE, MIN_MARGE } = window.Briques.recherche(e);
    const { H, verifConflit, verifCondition, verifier, trouve } = window.Briques.reponse({ ...e, chercher, parVecteur, MIN_SCORE, MIN_MARGE, typeDe });
    const decide = window.Briques.decide(e);

    async function unePartie(original, ctx, cond) {
      const T = [];
      const row = ligneDeQuestion(cond ? `${original}` : original, ctx);
      T.push({ qui: "code", etape: "Page lue", detail: ctx.page ? `${ctx.page.id}${ctx.page.onglet ? " › " + ctx.page.onglet : ""}` : "aucune" });
      if (row.corrections.length) T.push({ qui: "code", etape: "Orthographe", detail: row.corrections.map(c => `${c[0]} → ${c[1]}`).join(", ") + " (vocabulaire du guide)" });
      if (row.herite) T.push({ qui: "code", etape: "Suite", detail: `repris de : ${row.herite}` });

      // The open page is the first scope when the question points at it, or names nothing of its own.
      if (ctx.page && !row.herite && !row.partout && L.some(l => l.p === ctx.page.id) && (row.epingle || (!row.concepts.length && (row.pointe || row.mots.length <= 1)))) row.portee = "page";

      // Parse call: only behind a code gate (D31), and never for what the first rules catch.
      const modele = opt.modele || null;
      const zeros = row.mots.filter(m => !/\d/.test(m) && !inv.has(stem(m)));
      const premiere = decide(row, ctx)[0].id;
      const motsAvant = [...row.mots];
      if (modele && row.mots.length && !["r1", "r2", "r3", "r4", "r6", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r25", "r26"].includes(premiere) && (!row.concepts.length || zeros.length || row.mots.length >= 6)) {
        row.appels = (row.appels || 0) + 1;
        const liste = concepts.filter(c => !c.tool).map(c => c.source === "auteur" ? `${c.id}: ${c.mots[0]}` : `${c.id}: ${c.mots.slice(0, 2).join(", ")}`);
        const parse = await modele.parse(row, liste, ctx.page?.titre);
        if (parse) {
          T.push({ qui: "modèle", etape: "Compréhension", detail: (parse.termes || []).join(", "), json: parse });
          // "Off topic" is the model's word; code keeps it only if the reader's own words are not the guide's.
          if (parse.dans_le_sujet === false && !row.portee && !row.concepts.length && motsAvant.filter(m => m !== "luxembourg" && inv.has(stem(m))).length * 2 < motsAvant.length) row.horsSujet = true;
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
          if (parse.ambigu && !row.portee) { row.ambigu = true; row.ambiguOptions = parse.options; }
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
        const parts = await Promise.all(d.parts.map(p => unePartie(p, { ...ctx })));
        return { parts, pattern: d.pattern, row: parts[0].row };
      }
      const r = await unePartie(trim, ctx);
      return { parts: [r], pattern: d.pattern, row: r.row };
    }

    return { repondre, ligneDeQuestion, decide, decomposer, chercher, REGLES, concepts, trouve, L, plain };
  }

  window.Moteur = { creer, plain };
})();
