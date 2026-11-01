// Offline: one vector per line of the index, written next to the assistant. Run once per guide version.
// Usage: node build/vecteurs.mjs <index.json> <out.bin> <proxy url>
import { readFileSync, writeFileSync } from "node:fs";
const [IDX, OUT, URLP] = process.argv.slice(2);
const L = JSON.parse(readFileSync(IDX, "utf8")).lignes;
const sortie = new Float32Array(L.length * 256);
for (let i = 0; i < L.length; i += 64) {
  const lot = L.slice(i, i + 64).map(l => `${l.s}. ${l.t}`.slice(0, 900));
  let r, essais = 0;
  do {
    r = await fetch(`${URLP}/embed`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:8080" }, body: JSON.stringify({ textes: lot }) });
    if (!r.ok) await new Promise(ok => setTimeout(ok, 3000));
  } while (!r.ok && ++essais < 5);
  if (!r.ok) throw new Error("embed " + r.status);
  const { vecteurs } = await r.json();
  vecteurs.forEach((v, j) => {
    const n = Math.hypot(...v);
    v.forEach((x, k) => { sortie[(i + j) * 256 + k] = x / n; });
  });
}
writeFileSync(OUT, Buffer.from(sortie.buffer));
console.log("vecteurs", L.length, Buffer.byteLength(Buffer.from(sortie.buffer)));
