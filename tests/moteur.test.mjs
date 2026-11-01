import test from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const SITE = process.env.GUIDE_SRC || (existsSync("guide-src") ? "guide-src" : "C:/lex-v3/foyer-site/site");
const idx = "scratch/idx-test";
execFileSync("node", ["build/index.mjs", SITE, idx, "test"], { stdio: "ignore" });
const window = {};
const ctx = vm.createContext({ window, console, Intl });
for (const f of ["dico", "declare", "moteur"]) vm.runInContext(readFileSync(`src/assistant/${f}.js`, "utf8"), ctx);
const index = JSON.parse(readFileSync(`${idx}/index.json`, "utf8"));
// A stand-in for his simulator: the shape of comparatif, never his code.
const sim = { comparatif: (b, m) => [["Classe 1", "classe1"], ["Classe 1a", "classe1a"], ["Classe 2", "classe2"]].map(c => ({ label: c[0], classe: c[1], res: { netMensuel: b / m * 0.7 }, resImpatrie: { netMensuel: b / m * 0.8 } })) };
const M = window.Moteur.creer(index, { DICO: window.DICO, REFUS: window.REFUS, DECLARE: window.DECLARE, sim });
const ask = (q, page) => M.repondre(q, page ? { page: { id: page, titre: index.pages.find(p => p.id === page)?.titre } } : {});
const statut = async (q, page) => (await ask(q, page)).parts.map(p => p.statut);
const P = JSON.parse(process.env.SHOW || "false");

const CAS = [
  ["T9 plates, no figure", "combien coutent les plaques ?", "vehicule", ["NE_CHIFFRE_PAS"]],
  ["T62 nationality stated", "délai pour déclarer mon arrivée à la commune, je suis marocain", null, ["REPONSE"], r => assert.match(r.parts[0].lignes[0].t, /trois jours/)],
  ["T62 nationality unknown: both lines", "Dans quel délai faut-il se déclarer à la commune ?", null, ["REPONSE"], r => assert.strictEqual(r.parts[0].lignes.length, 2)],
  ["T6 declared conflict", "puis-je sortir d'un contrat 111bis avant 60 ans ?", null, ["DEUX_CHOSES"]],
  ["T11 independent", "combien de caution et c'est quoi le matricule ?", null, ["REPONSE", "REPONSE"]],
  ["T16 one tool, two values", "65000 brut en classe 1 et en classe 2", null, ["CALCUL"], r => assert.strictEqual(r.parts[0].calc.lignes.length, 2)],
  ["T65 digits per token", "classe 1 80 000 brut", null, ["CALCUL"], r => assert.strictEqual(r.parts[0].calc.entrees.brut_annuel, 80000)],
  ["T65 monthly", "12000 brut par mois", null, ["CALCUL"], r => assert.strictEqual(r.parts[0].calc.entrees.brut_annuel, 144000)],
  ["T65 net to gross refused", "4000 net quel brut ?", null, ["REPONSE_SANS"]],
  ["T48 his bike", "Je me fais voler mon vélo dans le local commun de l'immeuble, qui n'était pas fermé à clé. Suis-je couvert ?", null, ["VERDICTS"], r => assert.strictEqual(r.parts[0].scenario.id, "S02")],
  ["T48 his candle", "Un assuré laisse une bougie sur la table de son jardin pendant ses vacances. Avec la chaleur, la bougie fond et abîme la table. Est-ce couvert ?", null, ["RIEN"]],
  ["T8 not there", "combien d'électricité consomme l'intelligence artificielle ?", null, ["RIEN"]],
  ["T10 out of scope", "quel est le sens de la vie ?", null, ["RIEN"]],
  ["T52 several senses", "responsabilité civile, ça couvre quoi ?", null, ["CLARIFIER"]],
  ["T52 sense stated", "responsabilité civile pour ma voiture, c'est obligatoire ?", null, ["REPONSE"], r => assert.strictEqual(r.parts[0].lignes[0].p, "assurance_auto")],
  ["T7 too vague", "c'est combien ?", null, ["CLARIFIER"]],
  ["T28 count", "combien d'aides ?", null, ["LISTE"], r => assert.strictEqual(r.parts[0].complet.n, 28)],
  ["T4 list", "quelles sont les aides pour le logement ?", null, ["LISTE"]],
  ["T55 tree", "je suis marié, ma femme reste en France, quelle classe ?", null, ["REPONSE"], r => assert.strictEqual(r.parts[0].fin, "nonresident")],
  ["T55 tree asks next", "quelle classe d'impôt pour moi ?", null, ["CLARIFIER"]],
  ["T56 where am I", "il me manque quoi ?", null, ["LISTE"]],
  ["T57 announced", "bellegen akt 40 ou 45 000 ?", null, ["REPONSE"], r => assert.ok(r.parts[0].annonce)],
  ["T46 advice", "quel est le meilleur contrat d'assurance ?", null, ["REFUS"]],
  ["T44 personal data", "mon iban est LU28 0019 4006 4475 0000 que faire", null, ["PERSONNEL"]],
  ["T45 emergency", "je sens le gaz chez moi", null, ["URGENCE"]],
  ["T50 hello", "bonjour", null, ["SALUT"]],
  ["T63 FAQ opener never Oui", "Le régime des impatriés dépend-il de la classe d'impôt ?", null, ["REPONSE"], r => assert.ok(!/^Oui/.test(r.parts[0].lignes[0].t))],
  ["T54 closed pane", "le vendeur allemand doit me donner quoi ?", null, ["REPONSE"], r => assert.match(r.parts[0].lignes[0].s, /Allemagne/)],
  ["T35 typo", "c'est quoi le madricule ?", null, ["REPONSE"]],
    ["T32 summary", "résume cette page", "bail", ["REPONSE"]],
  ["T60 tip", "une astuce pour la commune ?", "arrivee", ["REPONSE"], r => assert.strictEqual(r.parts[0].registre, "communaute")],
  ["T21 complement", "qu'est-ce qui n'est pas couvert en cas de bris de glace ?", null, ["VERDICTS"]],
  ["T26 time", "que faire avant le départ ?", null, ["LISTE"]],
];
for (const [nom, q, page, attendu, plus] of CAS) {
  test(nom, async () => {
    const r = await ask(q, page);
    if (P) console.log(nom, "=>", r.parts.map(p => p.statut + ":" + (p.lignes?.[0]?.t || p.texte || "").slice(0, 80)).join(" || "));
    assert.strictEqual(JSON.stringify(r.parts.map(p => p.statut)), JSON.stringify(attendu));
    if (plus) plus(r);
  });
}

test("T18 false split stays one question", async () => {
  const r = await ask("quels sont les droits et devoirs du locataire ?");
  assert.strictEqual(r.parts.length, 1);
});

test("T44 long number never reaches a route", async () => {
  for (const q of ["mon matricule 1985031212345, salaire 5200 net, tu verifies ?", "appelez-moi au +352 621 123 456", "mon mail est jean.dupont@example.com"]) {
    const r = await ask(q);
    assert.strictEqual(r.parts[0].statut, "PERSONNEL", q);
  }
});

test("a 111bis question is not a conflict unless it asks about leaving", async () => {
  const r = await ask("c'est quoi le 111bis ?");
  assert.notStrictEqual(r.parts[0].statut, "DEUX_CHOSES");
});

test("'ordre de grandeur' is not the vehicle order", async () => {
  const r = await ask("luxtrust en direct ca coute combien, juste un ordre de grandeur ?");
  assert.notStrictEqual(r.parts[0].statut, "DEUX_CHOSES");
});

test("T55 widowed for five years", async () => {
  const r = await ask("veuf depuis 5 ans, quelle classe ?");
  assert.strictEqual(r.parts[0].fin, "classe1a");
});

test("every declared line exists", () => {
  for (const c of window.DECLARE.conflits) for (const l of c.lignes) assert.ok(M.trouve(l.p, l.c), `${c.id}: ${l.c}`);
  for (const c of window.DECLARE.conditions) for (const k of Object.keys(c.valeurs)) assert.ok(M.trouve(c.valeurs[k].ligne.p, c.valeurs[k].ligne.c), `${c.id}: ${k}`);
});

test("each rule of the dispatcher has a route", () => {
  for (const r of M.REGLES) assert.strictEqual(r.length, 3);
});
