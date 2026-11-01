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
const fenetres = () => page.evaluate(() => [...document.querySelectorAll("#widget, #panel-assistant")].filter(e => !e.hidden && e.offsetParent !== null).length);
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
    const res = await page.evaluate(({ ad, ls }) => {
      const go = window.ASSISTANT && window.ASSISTANT.atteindre;
      if (go) { try { go(ad); } catch (e) {} }
      const scope = document.querySelector(ad.sc) || document.body;
      const norm = s => s.replace(/\s+/g, " ").trim();
      const t = norm(scope.textContent);
      return ls.map(l => {
        const needle = norm(l.row ? (Array.isArray(l.row) ? l.row[l.row.length - 1] || l.row[0] : l.t) : l.t);
        return { id: l.id, ok: t.includes(needle) };
      });
    }, { ad, ls });
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

await browser.close();
if (fails.length) { console.error("FAILED: " + fails.join(", ")); process.exit(1); }
