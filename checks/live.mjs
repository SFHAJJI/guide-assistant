// The published site, at its real address, in a real browser: does a question reach the model?
// The other browser checks run on localhost, which the model service treats as a different origin.
import { chromium } from "playwright";

const BASE = process.argv[2] || "https://sfhajji.github.io/guide-assistant";
const QUESTIONS = ["comment ouvrir un compte en banque ?", "quelle assurance habitation choisir ?", "c'est quoi le matricule ?"];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
let total = 0;
for (const q of QUESTIONS) {
  const page = await ctx.newPage();
  const envois = [];
  page.on("response", r => { if (r.url().includes("azurecontainerapps.io") && r.request().method() === "POST") envois.push(`${r.url().split("/").pop()}:${r.status()}`); });
  page.on("requestfailed", r => { if (r.url().includes("azurecontainerapps.io")) envois.push(`${r.url().split("/").pop()}:ECHEC ${r.failure()?.errorText}`); });
  await page.goto(`${BASE}/guide/?q=${encodeURIComponent(q)}`, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => document.querySelector("#widget-log details.trace"), null, { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector("#widget-log .attente"), null, { timeout: 60000 }).catch(() => {});
  const resume = await page.evaluate(() => [...document.querySelectorAll("#widget-log details.trace summary")].map(s => s.textContent).join(" | "));
  const ok = envois.filter(e => e.endsWith(":200")).length;
  total += ok;
  console.log(`${q}\n  envoyés: ${envois.join(", ") || "aucun"}\n  affiché: ${resume}`);
  await page.close();
}
await browser.close();
console.log(`appels réussis depuis l'adresse réelle : ${total}`);
if (!total) { console.log("FAILED: no call reached the model from the published site"); process.exit(1); }
