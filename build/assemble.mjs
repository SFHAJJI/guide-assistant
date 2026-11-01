// Builds the published folder: his site without what must not be republished, the small patch, our assistant.
// Usage: node build/assemble.mjs <site dir> <dist dir> <commit>
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [SITE, DIST, COMMIT] = process.argv.slice(2);
const G = join(DIST, "guide");
rmSync(DIST, { recursive: true, force: true });
mkdirSync(G, { recursive: true });

// Never republished: git history, the unlisted page, the authors' notes, generator scripts.
const EXCLUS = new Set([".git", ".gitignore", ".github", "recrutement-ia"]);
cpSync(SITE, G, {
  recursive: true,
  filter: src => {
    const b = basename(src);
    return !EXCLUS.has(b) && !/^README/i.test(b) && !/\.py$/.test(b);
  },
});

function htmlFiles(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? htmlFiles(p) : n.endsWith(".html") ? [p] : [];
  });
}
// Everything stays out of search engines. This one tag is the only change to the savings pages.
for (const f of htmlFiles(G)) {
  writeFileSync(f, readFileSync(f, "utf8").replace(/<head>/i, '<head>\n<meta name="robots" content="noindex">'));
}

// D37: the whole patch to his interface. Each replacement must find its target or the build stops.
function remplacer(file, avant, apres) {
  const p = join(G, file);
  const s = readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");
  if (!s.includes(avant)) throw new Error(`patch: not found in ${file}: ${avant.slice(0, 60)}`);
  writeFileSync(p, s.replace(avant, apres));
}

if (existsSync("src/assistant/assistant.js")) {
  // The question goes to the assistant before anything is echoed or stored.
  remplacer("app/ui.js",
    'if (!q) return;\n    bulle(q, "me");',
    'if (!q) return;\n    if (window.ASSISTANT) { window.ASSISTANT.envoyer(q); return; }\n    bulle(q, "me");');
  // The Assistant tab docks beside the page instead of hiding it.
  remplacer("app/ui.js",
    'if (PANNEAUX.indexOf(nom) === -1) nom = "accueil";\n    // Retenue',
    'if (PANNEAUX.indexOf(nom) === -1) nom = "accueil";\n    if (nom === "assistant" && window.ASSISTANT_ON) {\n      if (document.querySelector(".panel:not([hidden])")) { montrerWidget(); return; }\n      nom = "accueil";\n    }\n    // Retenue');
  // No opening survey: the profile fills only when a question needs a field. Plus the hooks the assistant needs.
  remplacer("app/ui.js",
    'function demarrerChat() {\n',
    `window.LUXUI = {
    ouvrir: ouvrir, montrerFiche: montrerFiche, montrerWidget: montrerWidget, cacherWidget: cacherWidget,
    profil: function () { return profil; },
    setProfil: function (k, v) { profil[k] = v; sauverConversation(); }
  };

  function demarrerChat() {
    if (window.ASSISTANT_ON) return;\n`);

  const idx = join(G, "index.html");
  let html = readFileSync(idx, "utf8");
  html = html.replace(/<script src="app\/bareme\.js/, '<script src="assistant/flag.js"></script>\n$&');
  html = html.replace("</head>", '<link rel="stylesheet" href="assistant/assistant.css">\n</head>');
  html = html.replace("</body>", `<script src="assistant/dico.js"></script>
<script src="assistant/declare.js"></script>
<script src="assistant/moteur.js"></script>
<script src="assistant/modele.js"></script>
<script src="assistant/assistant.js"></script>\n<p class="demo-credit">Copie de démonstration du guide public lux-guide.github.io (version ${COMMIT}). Seul l'assistant est ajouté. <a href="../machine/">Comment il fonctionne</a></p>\n</body>`);
  // The guide says nothing leaves the browser. With a model that stops being true, so the sentences change with it.
  const dire = (avant, apres) => { if (!avant.test(html)) throw new Error("privacy: " + avant); html = html.replace(avant, apres); };
  dire(/Tout est enregistré dans ce navigateur, et rien n'en sort./, "Tout est enregistré dans ce navigateur. Seules les questions posées à l'assistant en sortent, sans être enregistrées, quand le modèle est activé.");
  dire(/et rien n'est envoyé às+personne./, "et rien n'est envoyé à personne, sauf les questions posées à l'assistant quand le modèle est activé : elles passent par un service de cette démonstration, qui ne les enregistre pas. La case « Sans modèle » coupe cet envoi.");
  dire(/Les autres onglets ne font aucun appel réseau./, "Les autres onglets ne font aucun appel réseau, sauf l'assistant quand le modèle est activé.");
  writeFileSync(idx, html);
  cpSync("src/assistant", join(G, "assistant"), { recursive: true });
}

for (const [from, to] of [["src/door", DIST], ["src/machine", join(DIST, "machine")]]) {
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}
writeFileSync(join(DIST, ".nojekyll"), "");
console.log("assembled", COMMIT);
