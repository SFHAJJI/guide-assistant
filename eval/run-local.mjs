// Runs a set through the engine in Node, without his code: the simulator is a stand-in with the same shape,
// so computed values are only truly checked in CI. Usage: node eval/run-local.mjs <set.jsonl> [--echecs N] [--filtre route] [--prudents]
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { noter, tranches, texteDe } from "./score.mjs";
const [file, ...rest] = process.argv.slice(2);
const nEchecs = rest.includes("--echecs") ? +rest[rest.indexOf("--echecs") + 1] : 0;
const filtre = rest.includes("--filtre") ? rest[rest.indexOf("--filtre") + 1] : null;
const avecModele = rest.includes("--modele");
const window = {
  fetchModele: (u, o) => fetch(u, { ...o, headers: { ...o.headers, origin: "http://localhost:8080" } }),
};
const ctx = vm.createContext({ window, console, Intl, fetch, AbortController, setTimeout, clearTimeout });
for (const f of ["dico", "declare", "moteur", "modele"]) vm.runInContext(readFileSync(`src/assistant/${f}.js`, "utf8"), ctx);
const index = JSON.parse(readFileSync("scratch/idx/index.json", "utf8"));
const sim = { comparatif: (b, m) => [["Classe 1", "classe1"], ["Classe 1a", "classe1a"], ["Classe 2", "classe2"]].map(c => ({ label: c[0], classe: c[1], res: { netMensuel: b / m * 0.7 }, resImpatrie: { netMensuel: b / m * 0.8 } })) };
const M = window.Moteur.creer(index, { DICO: window.DICO, REFUS: window.REFUS, DECLARE: window.DECLARE, sim, modele: avecModele ? window.ASSISTANT_MODELE : null });
const Q = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const pageDe = p => {
  if (!p) return null;
  const id = p.startsWith("fiche/") ? p.slice(6) : p.split("/")[0];
  const pg = index.pages.find(x => x.id === id) || index.pages.find(x => x.id === "panel_" + id);
  return pg ? { id: pg.id, titre: pg.titre } : null;
};
const rows = [];
const file2 = Q.filter(q => !filtre || q.route === filtre);
let i = 0;
await Promise.all(Array.from({ length: avecModele ? 5 : 1 }, async () => {
  while (i < file2.length) {
    const q = file2[i++];
    let res;
    try { res = await M.repondre(q.q, { page: pageDe(q.page) }); } catch (e) { res = { parts: [{ statut: "ERREUR", texte: e.message }] }; }
    rows.push({ q, res, note: noter(q, res) });
  }
}));
if (avecModele) { const j = window.ASSISTANT_MODELE.journal; const ms = j.map(x => x.ms).sort((a, b) => a - b); console.log(`appels ${j.length} par question ${(j.length / rows.length).toFixed(2)} ms médian ${ms[ms.length >> 1]} p90 ${ms[Math.floor(ms.length * 0.9)]}`); }
const tot = tranches(rows.map(r => ({ ...r, q: { ...r.q, tout: "tout" } })), "tout")[0];
console.log(JSON.stringify(tot));
for (const c of ["route", "verdict"]) for (const t of tranches(rows, c)) console.log(`${t.tranche.padEnd(28)} n=${String(t.n).padStart(3)} juste=${String(t.juste).padStart(3)} faux=${String(t.faux).padStart(3)} prudent=${String(t.prudent).padStart(3)} coupe=${t.coupe}`);
if (nEchecs) {
  const pb = rows.filter(r => r.note.o === "faux" || (r.note.o === "prudent" && rest.includes("--prudents")));
  for (const r of pb.slice(0, nEchecs)) {
    console.log(`\n[${r.q.id}] ${r.q.route}/${r.q.verdict} p=${r.q.page || "-"} : ${r.q.q}`);
    console.log(`  => ${r.res.parts.map(p => p.statut + "/" + (p.regle?.id || "")).join(" + ")} | ${r.note.pourquoi || ""}`);
    console.log(`  montre: ${texteDe(r.res).slice(0, 150)}`);
    console.log(`  attendu: ${r.q.value ?? ""} ${(r.q.gold || []).map(g => (g.contains || "").slice(0, 70)).join(" / ")}`);
  }
}
