// Brick 1: reads the guide's files as data, once, and writes the tables every other brick uses.
// Usage: node build/index.mjs <site dir> <out dir> <commit>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { collect } from "./lit.mjs";

const [SITE, OUT, COMMIT] = process.argv.slice(2);
const pages = [], plan = [], lignes = [], rangees = [], faq = [], verdicts = [], parcours = [],
  cartes = [], entrees = [], renvois = [], addrs = [];
const addrIds = new Map();
let group = 0;

const ABBR = /(?:\b(?:art|p|n|cf|env|M|Mme|Dr|av|etc|ex|vol|no|nos|réf|tél))\.$/;
export function phrases(texte) {
  const brut = String(texte).split(/(?<=[.!?…»])\s+(?=[A-ZÀ-ÖØ-Þ«"(0-9])/);
  const out = [];
  for (const b of brut) {
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += " " + b;
    else out.push(b);
  }
  return out.map(s => s.trim()).filter(Boolean);
}

function addr(a) {
  const k = JSON.stringify(a);
  if (!addrIds.has(k)) { addrIds.set(k, addrs.length); addrs.push(a); }
  return addrIds.get(k);
}

function ligne(page, sec, kind, text, a, extra = {}) {
  const row = { id: `${page}:${lignes.filter(l => l.p === page).length}`, p: page, s: sec || "", k: kind, t: text,
    g: extra.g ?? ++group, a: addr(a), r: extra.r || "guide", m: extra.m || "ast" };
  for (const key of ["row", "nomodel", "fiche", "date"]) if (extra[key] !== undefined) row[key] = extra[key];
  lignes.push(row);
  return row;
}

function paragraphe(page, sec, kind, texte, a, extra = {}) {
  const g = ++group;
  for (const s of phrases(texte)) ligne(page, sec, kind, s, a, { ...extra, g });
}

function tableau(page, sec, t, a, tid, extra = {}) {
  const g = ++group;
  for (const cells of t.lignes || []) {
    const text = cells.map((c, i) => (t.colonnes?.[i] ? `${t.colonnes[i]} : ${c}` : c)).join(" | ");
    const row = ligne(page, t.titre || sec, "tableau", text, a, { ...extra, g, row: cells });
    rangees.push({ table: tid, page, titre: t.titre || sec, colonnes: t.colonnes || [], cells, line: row.id });
  }
}

const hash = o => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 10);

// ---------- Fiches ----------
const veh = collect(join(SITE, "app/fiches/vehicule.js"))["window.FICHES.vehicule"];
const KB = collect(join(SITE, "app/kb.js"), { "window.FICHES.vehicule": veh })["window.KB"];
const ASTUCES = collect(join(SITE, "app/communaute.js")).ASTUCES;
const verifie = KB.meta.verifie;

for (const f of KB.fiches) {
  const route = `#fiche/${f.id}`;
  pages.push({ id: f.id, route, titre: f.titre, type: f.guide ? "fiche_guidee" : "fiche", cat: f.cat, resume: f.resume, tags: f.tags || [],
    flags: { tableau: !!(f.tableaux || []).length, astuces: !!ASTUCES[f.id] }, hash: hash(f) });
  plan.push({ page: f.id, niveau: 1, titre: f.titre, source: "kb" });
  const A = { r: route, sc: "#fiche-detail" };
  paragraphe(f.id, f.titre, "chapo", f.resume, A);
  let sec = f.titre;
  for (const c of f.corps || []) {
    if (typeof c === "string") paragraphe(f.id, sec, "texte", c, A);
    else if (c.h) { sec = c.h; plan.push({ page: f.id, niveau: 2, titre: sec, source: "kb" }); ligne(f.id, sec, "titre", sec, A); }
  }
  (f.tableaux || []).forEach((t, i) => tableau(f.id, t.titre || sec, t, A, `${f.id}#${i}`));
  for (const r of f.aRetenir || []) ligne(f.id, "À retenir", "retenir", r, A);
  for (const s of f.sources || []) renvois.push({ de: f.id, kind: "externe", vers: s.u, titre: s.t });
  for (const t of ASTUCES[f.id] || []) ligne(f.id, "Astuces", "astuce", t, { r: route, sc: ".communaute" }, { r: "communaute" });
  if (f.guide) guidee(f);
}

function guidee(f) {
  const g = f.guide, route = `#fiche/${f.id}`;
  for (const r of g.reperes || []) ligne(f.id, "Repères", "repere", `${r.k} : ${r.v}, ${r.d}`, { r: route, sc: ".g-reperes" }, { row: [r.k, r.v, r.d] });
  for (const it of g.cas?.items || []) paragraphe(f.id, g.cas.titre, "cas", `${it.t}. ${it.d}`, { r: route, sc: ".g-cas" });
  for (const o of g.onglets) {
    plan.push({ page: f.id, niveau: 2, titre: o.titre, source: "guide", onglet: o.id });
    const base = { r: route, c: [`#g-tab-${o.id}`], sc: `#g-pan-${o.id}` };
    for (const b of o.blocs) {
      if (typeof b === "string") { paragraphe(f.id, o.titre, "texte", b, base); continue; }
      if (b.note) paragraphe(f.id, o.titre, "note", b.note, base);
      for (const e of b.etapes || []) {
        const g2 = ++group;
        ligne(f.id, o.titre, "etape", e.t, base, { g: g2 });
        if (e.d) for (const s of phrases(e.d)) ligne(f.id, o.titre, "etape", s, base, { g: g2 });
        for (const [lab, v] of [["Où", e.ou], ["Apportez", e.apportez], ["Coût", e.cout], ["Vous obtenez", e.obtenez]]) {
          for (const x of [].concat(v || [])) ligne(f.id, o.titre, "etape", x, base, { g: g2, row: [lab, x] });
        }
      }
      if (b.cocher) for (const it of b.items) ligne(f.id, o.titre, "coche", it.d ? `${it.t} : ${it.d}` : it.t, base, { row: [it.t, it.d || ""] });
      for (const p of b.pays || []) {
        const A = { ...base, c: [...base.c, { chip: p.t, sc: `#g-pan-${o.id} .g-pays .chips` }] };
        for (const c of p.colonnes) {
          const g2 = ++group;
          for (const x of c.l) ligne(f.id, `${o.titre} › ${p.t} › ${c.h}`, "pays", x, A, { g: g2 });
        }
      }
      if (b.tableau) tableau(f.id, o.titre, b.tableau, base, `${f.id}:${o.id}`);
      for (const p of b.plis || []) {
        const A = { ...base, f: p.t, fsel: "details.g-pli" };
        const g2 = ++group;
        for (const x of p.p) for (const s of phrases(x)) ligne(f.id, `${o.titre} › ${p.t}`, "pli", s, A, { g: g2 });
      }
    }
  }
  for (const s of f.sources || []) if (s.fiche) renvois.push({ de: f.id, kind: "fiche", vers: s.fiche, titre: s.t });
}

// ---------- FAQ ----------
pages.push({ id: "faq", route: "#faq", titre: "Questions fréquentes", type: "faq", flags: {}, tags: ["faq", "questions"], hash: hash(KB.faq) });
const OUINON = /^(Oui|Non)\b/;
const PAS_OUINON = /^(comment|qui|que|qu'|quel|quelle|quels|quelles|combien|où|pourquoi|quand|à quel|dans quel)/i;
const OPENER_MAIN = new Set(["Le régime des impatriés dépend-il de la classe d'impôt ?"]);
KB.faq.forEach((row, i) => {
  const opener = OUINON.test(row.a) && (PAS_OUINON.test(row.q) || OPENER_MAIN.has(row.q));
  const A = { r: "#faq", f: row.q, fsel: "details.faq-item", sc: "#panel-faq" };
  const g = ++group;
  const ids = phrases(row.a).map(s => ligne("faq", row.q, "faq", s, A, { g, fiche: row.fiche }).id);
  faq.push({ id: `faq${i}`, q: row.q, fiche: row.fiche, opener_faux: opener, lignes: ids });
  renvois.push({ de: "faq", kind: "fiche", vers: row.fiche, titre: row.q });
});

// ---------- Parcours ----------
pages.push({ id: "parcours", route: "#parcours", titre: "Parcours", type: "table", flags: {}, tags: ["parcours", "étapes", "checklist", "chronologie"], hash: hash(KB.timeline) });
KB.timeline.forEach((ph, i) => ph.items.forEach((it, j) => {
  const row = ligne("parcours", ph.phase, "parcours", it.t, { r: "#parcours", sc: "#panel-parcours" }, { fiche: it.fiche });
  parcours.push({ id: `${i}-${j}`, phase: ph.phase, t: it.t, fiche: it.fiche || null, si: it.si || null, line: row.id });
}));

// ---------- Comparateur ----------
const CK = collect(join(SITE, "comparateur/contrats_kb.js"))["window.CONTRATS_KB"];
const UI = collect(join(SITE, "app/ui.js"));
pages.push({ id: "comparateur", route: "#comparateur", titre: "Comparateur assurance habitation", type: "table", flags: { demo: true }, tags: ["assurance", "habitation", "contrat", "sinistre", "garantie"], hash: hash(CK) });
const AC = { r: "#comparateur", c: ['#mrh-tabs button[data-mrh="sinistres"]'], sc: "#panel-comparateur" };
CK.scenarios.forEach((s, i) => {
  const id = `S${String(i + 1).padStart(2, "0")}`;
  const row = ligne("comparateur", s.groupe, "scenario", `${s.groupe}. ${s.titre}. ${s.question}`, AC);
  verdicts.push({ id, groupe: s.groupe, titre: s.titre, question: s.question, line: row.id,
    assureurs: Object.entries(s.verdicts).map(([a, v]) => ({ assureur: a, statut: v.statut, statut_fr: UI.STATUTS_FR[v.statut], plafond: v.plafond, franchise: v.franchise, resume: v.cle, citation: v.citation, page: v.page, verifiee: !!v.verifiee })) });
});
const OK = collect(join(SITE, "comparateur/offres_kb.js"))["window.OFFRES_KB"];
ligne("comparateur", "Offres de démonstration", "demo", OK.avertissement, { r: "#comparateur", sc: "#panel-comparateur" }, { r: "demo" });

// ---------- Avantages ----------
const AV = collect(join(SITE, "app/avantages.js"));
pages.push({ id: "avantages", route: "#avantages", titre: "Avantages", type: "table", flags: {}, tags: ["avantages", "aides", "crédit d'impôt", "primes", "déductions"], hash: hash(AV.AVANTAGES) });
for (const c of AV.AVANTAGES) {
  const A = { r: "#avantages", c: [{ clear: "#panel-avantages" }], sc: `#avantage-${c.id}` };
  const g = ++group;
  const ids = [ligne("avantages", c.titre, "carte", `${c.titre} : ${c.chiffre}${c.sous ? ", " + c.sous : ""}`, A, { g, row: [c.titre, c.chiffre, c.sous || ""] }).id];
  for (const s of phrases(c.texte || "")) ids.push(ligne("avantages", c.titre, "carte", s, A, { g }).id);
  for (const s of phrases(c.savoir || "")) ids.push(ligne("avantages", c.titre, "carte", s, A, { g }).id);
  cartes.push({ id: c.id, titre: c.titre, chiffre: c.chiffre, sous: c.sous, moment: c.moment, mode: c.mode, verifie: c.verifie, lignes: ids });
}

// ---------- Épargne : lue, jamais donnée au modèle ----------
const Q = collect(join(SITE, "prevoyance/app/questions.js"));
const TP = collect(join(SITE, "prevoyance/app/prevoyance.js"));
const T = TP.TABLE;
const eur = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const MARQUES = {
  plafond: eur(T.prevoyance.plafond), plafondPrecedent: eur(T.prevoyance.plafondPrecedent), annee: String(T.annee), anneePrecedente: String(T.anneePrecedente),
  duree: String(T.prevoyance.dureeMinimaleAns), ageMax: String(T.prevoyance.ageMaxSouscription),
  sortieMin: String(T.prevoyance.sortieMin), sortieMax: String(T.prevoyance.sortieMax),
};
const remplir = s => String(s || "").replace(/\{(\w+)\}/g, (t, k) => (MARQUES[k] !== undefined ? MARQUES[k] : t));
for (const e of Q.ENTREES) { e.reponse = remplir(e.reponse); e.reserve = remplir(e.reserve); }
pages.push({ id: "prevoyance", route: "prevoyance/#questions", titre: "Épargne et retraite", type: "table", flags: { nomodel: true }, tags: ["épargne", "retraite", "prévoyance", "111bis"], hash: hash(Q.ENTREES) });
for (const e of Q.ENTREES) {
  const A = { ext: "prevoyance/#questions" };
  const g = ++group;
  const ids = phrases(e.reponse).map(s => ligne("prevoyance", e.question, "epargne", s, A, { g, nomodel: true }).id);
  if (e.reserve) for (const s of phrases(e.reserve)) ids.push(ligne("prevoyance", e.question, "epargne", s, A, { g, nomodel: true }).id);
  entrees.push({ id: e.id, theme: e.theme, question: e.question, variantes: e.variantes || [], lignes: ids });
}

// ---------- Panneaux écrits dans index.html ----------
const $ = cheerio.load(readFileSync(join(SITE, "index.html"), "utf8"));
const IMAGES = { total: $("img").length, utiles: 0 };
$(".panel[id^=panel-]").each((_, el) => {
  const id = $(el).attr("id").replace("panel-", "");
  if (id === "assistant") return;
  const pid = `panel_${id}`;
  const textes = [];
  pages.push({ id: pid, route: `#${id}`, titre: $(el).find("h1,h2").first().text().trim() || id, type: "panneau", flags: {}, tags: [id], hash: "" });
  let sec = "";
  $(el).find("h1,h2,h3,p,li").each((_, n) => {
    const t = $(n).text().replace(/\s+/g, " ").trim();
    if (!t || t.length < 3) return;
    if (/^h/.test(n.tagName)) { sec = t; plan.push({ page: pid, niveau: 2, titre: t, source: "html" }); }
    textes.push([sec, /^h/.test(n.tagName) ? "titre" : "html", t]);
  });
  for (const [s, k, t] of textes) paragraphe(pid, s, k, t, { r: `#${id}`, sc: `#panel-${id}` }, { m: "html" });
});

// ---------- Écriture ----------
const arbre = { arbre: UI.CL_ARBRE, fins: UI.CL_FINS };
const stats = {
  commit: COMMIT, verifie, pages: pages.length, lignes: lignes.length, rangees: rangees.length, faq: faq.length,
  faq_opener_faux: faq.filter(f => f.opener_faux).length, verdicts: verdicts.length, parcours: parcours.length,
  parcours_si: parcours.filter(p => p.si).length, cartes: cartes.length, entrees: entrees.length, addrs: addrs.length, images: IMAGES,
  par_type: lignes.reduce((a, l) => (a[l.k] = (a[l.k] || 0) + 1, a), {}),
};
mkdirSync(OUT, { recursive: true });
// Commune names, read so that a question about one goes to the maps tool instead of a wrong page.
let communes = [], tableCommunes = null;
try {
  const c = collect(join(SITE, "cartes/communes_kb.js"));
  const data = c["window.COMMUNES"] || Object.values(c)[0];
  const liste = Array.isArray(data) ? data : data?.communes || data?.liste || Object.values(data || {}).find(Array.isArray) || [];
  communes = [...new Set(liste.map(x => (x && (x.nom || x.name || x.commune)) || null).filter(n => typeof n === "string" && n.length > 3 && n !== "Luxembourg"))]
    .map(n => n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .flatMap(n => (n.includes("-") ? [n, n.replace(/-/g, " ")] : [n]));
  // The table itself: names, cantons and the 48 figures. Maps and yearly series stay out of the index.
  tableCommunes = { construit: data.meta?.construit || null, indicateurs: (data.indicateurs || []).map(({ id, nom, unite, fmt, source, aide }) => ({ id, nom, unite, fmt, source, aide })), series: Object.fromEntries(Object.entries(data.series || {}).map(([k, v]) => [k, { annees: v.annees }])), national: data.national || null, lignes: liste.map(x => ({ nom: x.nom, canton: x.canton, i: x.i, s: x.s })) };
} catch (e) { console.error("communes:", e.message); }
stats.communes = communes.length;
const index = { communes, tableCommunes, stats, pages, plan, lignes, rangees, faq, verdicts, parcours, cartes, entrees, renvois, addrs, arbre, statuts: UI.STATUTS_FR, outils: UI.OUTILS_OFFICIELS };
writeFileSync(join(OUT, "index.json"), JSON.stringify(index));

const csv = (rows, cols) => [cols.join(";"), ...rows.map(r => cols.map(c => {
  const v = r[c]; return `"${String(v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v).replace(/"/g, '""')}"`;
}).join(";"))].join("\n");
mkdirSync(join(OUT, "tables"), { recursive: true });
const BOM = "﻿";
for (const [nom, rows, cols] of [
  ["pages", pages, ["id", "route", "titre", "type", "cat", "hash"]],
  ["plan", plan, ["page", "niveau", "titre", "source"]],
  ["lignes", lignes, ["id", "p", "s", "k", "t", "r", "m"]],
  ["rangees", rangees, ["table", "page", "titre", "colonnes", "cells", "line"]],
  ["faq", faq, ["id", "q", "fiche", "opener_faux", "lignes"]],
  ["parcours", parcours, ["id", "phase", "t", "fiche", "si", "line"]],
  ["renvois", renvois, ["de", "kind", "vers", "titre"]],
]) writeFileSync(join(OUT, "tables", nom + ".csv"), BOM + csv(rows, cols));
if (tableCommunes) writeFileSync(join(OUT, "tables", "communes.csv"), BOM + csv(tableCommunes.lignes.map(c => ({ nom: c.nom, canton: c.canton, ...c.i })), ["nom", "canton", ...tableCommunes.indicateurs.map(i => i.id)]));
console.log(JSON.stringify(stats, null, 0));
