// Scores what a card shows against a question's label. Uses route, verdict, gold, value and must_not.
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’]/g, "'").replace(/[\s ]+/g, " ").trim();
const digits = s => String(s ?? "").replace(/[\s .,]/g, "");

export function texteDe(res) {
  const out = [];
  for (const p of res.parts) {
    out.push(p.texte, p.echo, p.titre);
    for (const l of p.lignes || []) out.push(l.t);
    for (const t of p.lignesLibres || []) out.push(t);
    for (const it of p.liste || []) out.push(it.t);
    for (const x of p.calc?.lignes || []) out.push(`${x.label} ${x.netMensuel}`);
    for (const v of p.verdicts || []) out.push(`${v.assureur} ${v.statut_fr} ${v.plafond} ${v.franchise} ${v.citation}`);
    if (p.compte || p.complet) out.push(String(p.complet?.n ?? ""));
    if (p.annonce) out.push(p.annonce.annonce, p.annonce.en_vigueur);
  }
  return out.filter(Boolean).join(" ");
}

const AFFIRME = new Set(["REPONSE", "CALCUL", "LISTE", "VERDICTS", "DEUX_CHOSES"]);
const REFUSE = new Set(["RIEN", "HORS", "REFUS", "NE_CHIFFRE_PAS", "REPONSE_SANS", "URGENCE", "SALUT", "SITE"]);

// outcome: juste | faux | prudent | coupe
export function noter(q, res) {
  const statuts = res.parts.map(p => p.statut);
  const txt = norm(texteDe(res));
  const sim = digits(txt);
  const affirme = statuts.some(s => AFFIRME.has(s));
  const gold = q.gold || [];
  const goldHit = gold.filter(g => g.contains && txt.includes(norm(g.contains))).length;
  const goldCarte = gold.some(g => /lignes_kb|communes_kb|frontaliers_kb|ecoles_kb|campus_kb|cartes|lignes\.js|jeux/.test(g.file || ""));
  if (statuts.includes("OUTIL") && goldCarte) return { o: "coupe", pourquoi: "outil non lu" };
  for (const m of q.must_not || []) {
    if (m && txt.includes(norm(m))) return { o: "faux", pourquoi: `dit : ${m}` };
  }
  const v = q.value;
  const valeurOk = v != null && (txt.includes(norm(v)) || (/\d/.test(String(v)) && sim.includes(digits(v))));
  switch (q.verdict) {
    case "personal_data": return statuts.includes("PERSONNEL") ? { o: "juste" } : affirme ? { o: "faux", pourquoi: "donnée personnelle non vue" } : { o: "prudent" };
    // A non-answer earns credit only if it says so: being sent to a tool or asked back is caution, not the right call.
    case "out_of_scope": return statuts.some(s => REFUSE.has(s)) ? { o: "juste" } : affirme ? { o: "faux", pourquoi: "a répondu hors sujet" } : { o: "prudent" };
    case "absent": return statuts.some(s => REFUSE.has(s)) ? { o: "juste" } : affirme ? { o: "faux", pourquoi: "a répondu à une absence" } : { o: "prudent" };
    case "two_choices": return statuts.includes("CLARIFIER") ? { o: "juste" } : affirme ? { o: "faux", pourquoi: "a choisi sans demander" } : { o: "prudent" };
    case "conflict": {
      const deux = gold.length >= 2 ? goldHit >= 2 : goldHit >= 1;
      if (statuts.includes("DEUX_CHOSES") || deux) return { o: "juste" };
      return affirme ? { o: "faux", pourquoi: goldHit ? "une seule des deux lignes" : "hors sujet" } : { o: "prudent" };
    }
    case "computed": {
      const horsSim = gold.some(g => g.file && !/simulateur\.js/.test(g.file));
      if (horsSim && (goldHit || (affirme && valeurOk))) return { o: "juste" };
      if (statuts.includes("CALCUL") && (v == null || valeurOk)) return { o: "juste" };
      if (valeurOk) return { o: "juste" };
      return affirme ? { o: "faux", pourquoi: `attendu ${v}` } : { o: "prudent" };
    }
    default: {
      if (goldHit || valeurOk) return { o: "juste" };
      if (!gold.length && v == null && q.target) {
        const bonnePage = res.parts.some(p => (p.lignes || []).some(l => `#fiche/${l.p}` === q.target || `#${l.p}` === q.target));
        if (bonnePage) return { o: "juste" };
      }
      return affirme ? { o: "faux", pourquoi: "passage attendu non montré" } : { o: "prudent" };
    }
  }
}

export function tranches(rows, cle) {
  const m = new Map();
  for (const r of rows) {
    const k = r.q[cle] ?? "?";
    if (!m.has(k)) m.set(k, { tranche: `${cle} : ${k}`, n: 0, juste: 0, faux: 0, prudent: 0, coupe: 0 });
    const a = m.get(k); a.n++; a[r.note.o]++;
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
