// Runs on the disposable CI runner only: the real page, the real simulator, the real model service.
// Usage: node checks/mesures.mjs <base url> <set.jsonl> <out.json> <commit>
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { noter, tranches, texteDe } from "../eval/score.mjs";

const [BASE, SET, OUT, COMMIT] = process.argv.slice(2);
const Q = readFileSync(SET, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto(`${BASE}/guide/`, { waitUntil: "load" });
await page.evaluate(() => window.ASSISTANT.pret);

const pageDe = (p, pages) => {
  if (!p) return null;
  const id = p.startsWith("fiche/") ? p.slice(6) : p.split("/")[0];
  return pages.find(x => x.id === id)?.id || pages.find(x => x.id === "panel_" + id)?.id || null;
};
const pages = await page.evaluate(() => window.ASSISTANT.pages());

async function passe(mode, concurrence) {
  const rows = [];
  for (let i = 0; i < Q.length; i += concurrence) {
    const lot = Q.slice(i, i + concurrence);
    const res = await page.evaluate(({ lot, mode }) => Promise.all(lot.map(x => window.ASSISTANT.evaluer(x.q, x.page, mode))), { lot: lot.map(q => ({ q: q.q, page: pageDe(q.page, pages) })), mode });
    lot.forEach((q, j) => rows.push({ q, res: res[j], note: noter(q, res[j]) }));
  }
  // A strict text match misses another correct sentence: a separate model reads what the card showed against the label.
  const aJuger = rows.filter(r => r.note.o === "faux" && !String(r.note.pourquoi || "").startsWith("dit") && (r.q.value || (r.q.gold || []).length));
  for (let i = 0; i < aJuger.length; i += 5) {
    const lot = aJuger.slice(i, i + 5);
    const js = await page.evaluate(lot => Promise.all(lot.map(x => window.ASSISTANT.juger(x.q, x.a, x.m))), lot.map(r => ({ q: r.q.q, a: [r.q.value, ...(r.q.gold || []).map(g => g.contains)].filter(Boolean).join(" / "), m: texteDe(r.res).slice(0, 900) })));
    lot.forEach((r, j) => { if (js[j] && js[j].meme_reponse) r.note = { o: "juste", juge: true }; });
  }
  rows.jugees = rows.filter(r => r.note.juge).length;
  return rows;
}

const MODES = [["assistant, modèle activé", "complet", 4], ["assistant, sans modèle", "sans_modele", 30], ["sans dictionnaire, sans modèle", "sans_dico", 30], ["sans la page, sans modèle", "sans_page", 30], ["naïf : mots-clés, première ligne", "naif", 30], ["assistant d'origine du guide", "origine", 30]];
const resultats = {};
const regles = {};
let appels = null;
for (const [nom, mode, c] of MODES) {
  const rows = await passe(mode, c);
  const t = tranches(rows.map(r => ({ ...r, q: { ...r.q, tout: "toutes" } })), "tout")[0];
  resultats[nom] = t;
  if (mode === "complet") {
    resultats._parRoute = tranches(rows, "route");
    resultats._parVerdict = tranches(rows, "verdict");
    resultats._parStyle = tranches(rows, "style");
    for (const r of rows) for (const p of r.res.parts) if (p.regle?.id) regles[p.regle.id] = (regles[p.regle.id] || 0) + 1;
    appels = await page.evaluate(() => window.ASSISTANT.journalModele());
    resultats._echecs = rows.filter(r => r.note.o === "faux").map(r => ({ id: r.q.id, q: r.q.q, route: r.q.route, verdict: r.q.verdict, pourquoi: r.note.pourquoi, statut: r.res.parts.map(p => p.statut).join("+"), montre: texteDe(r.res).slice(0, 200), attendu: [r.q.value, ...(r.q.gold || []).map(g => g.contains)].filter(Boolean).join(" / ").slice(0, 200) }));
  }
  t.jugees = rows.jugees;
  console.log(nom, JSON.stringify(t));
}
await browser.close();

const pct = (k, n) => (n >= 20 ? ` (${Math.round(100 * k / n)} %)` : "");
const ligne = (nom, t) => ({ tranche: nom, n: t.n, "réponses justes": t.juste + pct(t.juste, t.n), "erreurs affirmées": t.faux + pct(t.faux, t.n), "sans réponse, dit": t.prudent + pct(t.prudent, t.n), "outil non lu": t.coupe });
const ms = (appels || []).map(x => x.ms).sort((a, b) => a - b);
const sortie = {
  n: Q.length, commit: COMMIT, date: new Date().toISOString().slice(0, 10), regles,
  colonnes: ["tranche", "n", "réponses justes", "erreurs affirmées", "sans réponse, dit", "outil non lu"],
  tranches: [
    ...MODES.map(([nom]) => ligne(nom, resultats[nom])),
    ...resultats._parRoute.map(t => ligne(t.tranche, t)),
    ...resultats._parVerdict.map(t => ligne(t.tranche, t)),
    ...resultats._parStyle.map(t => ligne(t.tranche, t)),
  ],
  notes: [
    `Modèle : ${(appels || []).length} appels, soit ${((appels || []).length / Q.length).toFixed(2)} par question ; ${ms.length ? `médian ${ms[ms.length >> 1]} ms, 90e centile ${ms[Math.floor(ms.length * 0.9)]} ms` : ""}.`,
    "Une réponse est juste si la carte montre le passage ou la valeur attendus, ou si un autre modèle, relisant la carte et l'attendu, dit qu'elle donne la même information. Les questions viennent d'un autre auteur, et beaucoup portent sur des fichiers que l'assistant ne lit pas encore.",
  ],
  echecs: resultats._echecs,
};
writeFileSync(OUT, JSON.stringify(sortie, null, 1));
