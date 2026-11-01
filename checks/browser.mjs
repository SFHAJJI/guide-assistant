// Runs only on the disposable CI runner. Opens the published folder in a real browser.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`); if (!ok) fails.push(name); };
page.on("pageerror", e => fails.push("pageerror: " + e.message));

await page.goto(`${BASE}/guide/`, { waitUntil: "load" });
await page.waitForTimeout(500);

// His rule: one conversation window on screen at a time (README.md:414-421).
const fenetres = () => page.evaluate(() => [...document.querySelectorAll("#widget, #panel-assistant")].filter(e => !e.hidden && e.getClientRects().length > 0).length);
check("one window at load", (await fenetres()) <= 1);
await page.click("#widget-btn").catch(() => {});
await page.waitForTimeout(200);
check("one window after opening", (await fenetres()) === 1);

// What must never be published.
for (const path of ["guide/recrutement-ia/", "guide/README.md", "guide/prevoyance/README.md"]) {
  const r = await page.request.get(`${BASE}/${path}`);
  check(`not published: ${path}`, r.status() === 404, String(r.status()));
}

// D5: every address is reached in a real browser.
const hasIndex = await page.request.get(`${BASE}/guide/assistant/index.json`);
if (hasIndex.ok()) {
  const x = await hasIndex.json();
  const parAddr = new Map();
  for (const l of x.lignes) { if (!parAddr.has(l.a)) parAddr.set(l.a, []); parAddr.get(l.a).push(l); }
  let vus = 0, trouves = 0;
  const rate = {};
  const seen = {};
  for (const [a, ls] of parAddr) {
    const ad = x.addrs[a];
    if (ad.ext) continue;
    await page.goto(`${BASE}/guide/${ad.r}`, { waitUntil: "load" }).catch(() => {});
    await page.waitForTimeout(120);
    const res = await page.evaluate(async ({ ls }) => {
      await window.ASSISTANT.pret;
      const out = [];
      for (const l of ls) out.push({ id: l.id, ok: await window.ASSISTANT.localiser(l) });
      return out;
    }, { ls: ls.map(({ plain, st, ...l }) => l) });
    for (const r of res) {
      vus++; if (r.ok) trouves++;
      const p = r.id.split(":")[0];
      rate[p] = rate[p] || [0, 0]; rate[p][0]++; if (r.ok) rate[p][1]++;
      if (!r.ok) (seen[p] = seen[p] || []).push(r.id);
    }
  }
  const macro = Object.values(rate).reduce((s, [n, k]) => s + k / n, 0) / Object.keys(rate).length;
  const rapport = { micro: trouves / vus, macro, vus, trouves, par_page: rate, manquants: seen };
  mkdirSync("dist/machine", { recursive: true });
  writeFileSync("dist/machine/adresses.json", JSON.stringify(rapport));
  console.log(`addresses: ${trouves}/${vus} micro=${rapport.micro.toFixed(3)} macro=${macro.toFixed(3)}`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.length]))));
}

// Journeys: the button questions, from a real page, with a picture of each.
mkdirSync("shots", { recursive: true });
const J = [
  ["plaques", "?q=combien%20coutent%20les%20plaques%20%3F&p=fiche/vehicule&c=g-tab-couts", "LE GUIDE NE LE CHIFFRE PAS"],
  ["ailleurs", "?q=quel%20d%C3%A9lai%20pour%20d%C3%A9clarer%20mon%20arriv%C3%A9e%20%3F&p=fiche/vehicule", "trois jours"],
  ["deux", "?q=combien%20de%20caution%20et%20c%27est%20quoi%20le%20matricule%20%3F", "Deux questions"],
  ["calcul", "?q=65000%20brut%20en%20classe%201%20et%20en%20classe%202", "net par mois"],
  ["velo", "?q=Je%20me%20fais%20voler%20mon%20v%C3%A9lo%20dans%20le%20local%20commun%20de%20l%27immeuble%2C%20qui%20n%27%C3%A9tait%20pas%20ferm%C3%A9%20%C3%A0%20cl%C3%A9.%20Suis-je%20couvert%20%3F", "CE QUE DISENT QUATRE CONTRATS"],
  ["111bis", "?q=puis-je%20sortir%20d%27un%20contrat%20111bis%20avant%2060%20ans%20%3F", "LE GUIDE DIT DEUX CHOSES"],
  ["rc", "?q=responsabilit%C3%A9%20civile%2C%20%C3%A7a%20couvre%20quoi%20%3F", "PLUSIEURS CHOSES"],
];
for (const [nom, qs, attendu] of J) {
  const p2 = await ctx.newPage();
  p2.on("pageerror", e => fails.push(nom + " pageerror: " + e.message));
  await p2.goto(`${BASE}/guide/${qs}`, { waitUntil: "load" });
  await p2.waitForTimeout(800);
  await p2.waitForFunction(() => !document.querySelector("#widget-log .attente"), null, { timeout: 45000 }).catch(() => {});
  const txt = await p2.evaluate(() => document.querySelector("#widget-log")?.textContent || "");
  check(`journey ${nom}`, txt.includes(attendu), txt.slice(0, 80));
  await p2.screenshot({ path: `shots/${nom}.png` });
  await p2.close();
}
for (const [nom, qs, attendu] of [["bougie", "?q=Un%20assur%C3%A9%20laisse%20une%20bougie%20sur%20la%20table%20de%20son%20jardin%20pendant%20ses%20vacances.%20Avec%20la%20chaleur%2C%20la%20bougie%20fond%20et%20ab%C3%AEme%20la%20table.%20Est-ce%20couvert%20%3F", "RIEN DANS LE GUIDE SOUS CES MOTS"], ["sans-modele", "?sans=1&q=combien%20de%20caution%20et%20c%27est%20quoi%20le%20matricule%20%3F", "Deux questions"]]) {
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/guide/${qs}`, { waitUntil: "load" });
  await p2.waitForTimeout(800);
  await p2.waitForFunction(() => !document.querySelector("#widget-log .attente"), null, { timeout: 45000 }).catch(() => {});
  const txt = await p2.evaluate(() => document.querySelector("#widget-log")?.textContent || "");
  check(`journey ${nom}`, txt.includes(attendu), txt.slice(0, 70));
  await p2.close();
}
const porte = await ctx.newPage();
porte.on("pageerror", e => fails.push("door pageerror: " + e.message));
await porte.goto(`${BASE}/`, { waitUntil: "load" });
await porte.waitForTimeout(300);
check("entry page has nine buttons", (await porte.locator("a.essai").count()) === 9);
await porte.screenshot({ path: "shots/porte.png" });
await porte.close();
for (const [ancre, attendu] of [["parsing", "Une page et ses lignes"], ["aiguillage", "Les appels au modèle"], ["mesures", "erreurs affirmées"], ["limites", "Rien dans le guide"]]) {
  const pm = await ctx.newPage();
  pm.on("pageerror", e => fails.push(`machine ${ancre} pageerror: ${e.message}`));
  await pm.goto(`${BASE}/machine/#${ancre}`, { waitUntil: "load" });
  await pm.waitForTimeout(1500);
  const texte = await pm.evaluate(() => document.querySelector("#vue").textContent);
  check(`machine tab ${ancre}`, texte.includes(attendu), texte.slice(0, 60));
  await pm.screenshot({ path: `shots/machine-${ancre}.png` });
  await pm.close();
}
// "Voir sur la page" really marks the passage, and the page says where we are.
const p3 = await ctx.newPage();
await p3.goto(`${BASE}/guide/?q=combien%20coutent%20les%20plaques%20%3F&p=fiche/vehicule&c=g-tab-couts`, { waitUntil: "load" });
await p3.waitForTimeout(800);
await p3.waitForFunction(() => !document.querySelector("#widget-log .attente"), null, { timeout: 45000 }).catch(() => {});
check("page recognised", (await p3.evaluate(() => document.querySelector("#vous-lisez")?.textContent || "")).includes("Immatriculer son véhicule"));
await p3.click("#widget-log .btn-voir");
await p3.waitForTimeout(600);
check("passage highlighted", await p3.evaluate(() => CSS.highlights && CSS.highlights.has("passage")));
await p3.screenshot({ path: "shots/surligne.png" });
const tel = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
const p4 = await tel.newPage();
await p4.goto(`${BASE}/guide/?q=combien%20de%20caution%20et%20c%27est%20quoi%20le%20matricule%20%3F`, { waitUntil: "load" });
await p4.waitForTimeout(800);
await p4.waitForFunction(() => !document.querySelector("#widget-log .attente"), null, { timeout: 45000 }).catch(() => {});
await p4.screenshot({ path: "shots/telephone.png" });
await p4.click("#widget-log .btn-voir");
await p4.waitForTimeout(700);
check("phone: back to the answer offered", await p4.evaluate(() => !!document.querySelector("#revenir-reponse:not([hidden])")));
await p4.screenshot({ path: "shots/telephone-page.png" });
await browser.close();
if (fails.length) { console.error("FAILED: " + fails.join(", ")); process.exit(1); }
