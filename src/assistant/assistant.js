// The page side: reads what the reader has open, shows typed cards, moves to the passage.
// Every text from the guide or the model goes in through textContent, never as HTML.
(function () {
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const $ = s => document.querySelector(s);
  const attendre = ms => new Promise(r => setTimeout(r, ms));
  const large = () => window.innerWidth >= 1100;
  const norm = s => String(s).replace(/\s+/g, " ").trim();

  let M = null, index = null, dernier = null, vecteurs = null;
  const session = [];
  const pret = fetch("assistant/index.json").then(r => r.json()).then(x => {
    index = x;
    const dico = window.DICO.map(d => (d.id === "communes" ? { ...d, mots: d.mots.filter(m => m !== "__COMMUNES__").concat(x.communes || []) } : d));
    window.DICO_FINAL = dico;
    M = window.Moteur.creer(x, { DICO: dico, REFUS: window.REFUS, DECLARE: window.DECLARE, sim: window.SIM,
      paramsModifies: !!localStorage.getItem("luxguide.simulateur.params.v1"), get modele() { return modeleActif(); }, get vecteurs() { return vecteurs; } });
    fetch("assistant/vecteurs.bin").then(r => (r.ok ? r.arrayBuffer() : null)).then(b => { if (b && b.byteLength === x.lignes.length * 256 * 4) vecteurs = new Float32Array(b); }).catch(() => {});
    return M;
  });
  const modeleActif = () => (window.ASSISTANT_MODELE && !sansModele() ? window.ASSISTANT_MODELE : null);
  const sansModele = () => localStorage.getItem("assistant.sansmodele") === "1" || new URLSearchParams(location.search).get("sans") === "1";

  // ---------- D7: the page, read from the DOM ----------
  function pageCourante() {
    const panel = $(".panel:not([hidden])");
    if (!panel || !index) return null;
    const id = panel.id.replace("panel-", "");
    if (id === "fiches") {
      const detail = $("#fiche-detail:not([hidden]) .detail-hero h1");
      if (detail) {
        const p = index.pages.find(x => x.titre === norm(detail.textContent));
        if (p) {
          const tab = $("#fiche-detail .g-tab.actif, #fiche-detail [id^=g-tab-][aria-selected=true]");
          return { id: p.id, titre: p.titre, onglet: tab ? norm(tab.textContent) : null };
        }
      }
      return { id: "panel_fiches", titre: "Fiches" };
    }
    const direct = index.pages.find(x => x.id === id) || index.pages.find(x => x.id === "panel_" + id);
    const actif = panel.querySelector("#sim-tabs button.actif, #mrh-tabs button.actif, .onglets-internes button.actif");
    return { id: direct ? direct.id : "panel_" + id, titre: direct ? direct.titre : id, onglet: actif ? norm(actif.textContent) : null };
  }

  function majEntete() {
    const zone = $("#vous-lisez");
    if (!zone || !index) return;
    const p = pageCourante();
    zone.textContent = "";
    if (!p || p.id === "panel_accueil") { zone.appendChild(el("span", "vl-titre", "Posez votre question, je réponds avec les phrases du guide.")); return; }
    zone.appendChild(el("span", "vl-titre", `Vous lisez : ${p.titre}${p.onglet ? " › " + p.onglet : ""}`));
    const qs = index.faq.filter(f => f.fiche === p.id).slice(0, 3).map(f => f.q);
    if (!qs.length) index.plan.filter(x => x.page === p.id && x.niveau === 2).slice(0, 3).forEach(x => qs.push(x.titre + " ?"));
    if (qs.length) {
      zone.appendChild(el("span", "vl-sous", "Cette page répond à :"));
      for (const q of qs) { const b = el("button", "chip", q); b.addEventListener("click", () => envoyer(q)); zone.appendChild(b); }
    }
  }

  // ---------- Cards ----------
  const MOTS = { REPONSE: "RÉPONSE", CALCUL: "CALCUL", LISTE: "LISTE", DEUX_CHOSES: "LE GUIDE DIT DEUX CHOSES", RIEN: "RIEN DANS LE GUIDE SOUS CES MOTS",
    NE_CHIFFRE_PAS: "LE GUIDE NE LE CHIFFRE PAS", OUTIL: "OUTIL DU GUIDE", REFUS: "JE NE RÉPONDS PAS À CELA", PERSONNEL: "DONNÉE PERSONNELLE", URGENCE: "112",
    VERDICTS: "CE QUE DISENT QUATRE CONTRATS", HORS: "HORS DU GUIDE", REPONSE_SANS: "LE GUIDE NE CALCULE PAS CELA" };

  function journal() { return $("#widget-log"); }

  function bulleMoi(q) { const n = el("div", "msg me", q); journal().appendChild(n); return n; }

  const libelleSource = s => [s.page, s.section].filter(Boolean).join(" › ") + (s.verifie ? ` · vérifié ${s.verifie}` : "");

  function boutonVoir(l) {
    const ad = index.addrs[l.a];
    if (ad.ext) {
      const a = el("a", "btn-voir", "Voir dans la section épargne (pas de surlignage là-bas)");
      a.href = ad.ext; a.target = "_blank"; a.rel = "noopener";
      return a;
    }
    const b = el("button", "btn-voir", "Voir sur la page");
    b.addEventListener("click", () => voir(l));
    return b;
  }

  function citation(l, sourceTexte) {
    const box = el("div", "citation");
    box.appendChild(el("blockquote", null, "« " + (l.row && l.k === "tableau" ? l.row.join(" : ") : l.t) + " »"));
    if (sourceTexte) box.appendChild(el("div", "source", sourceTexte));
    box.appendChild(boutonVoir(l));
    return box;
  }

  function carte(p) {
    const c = el("div", "msg bot carte statut-" + p.statut);
    const mot = p.statut === "CLARIFIER" ? (String(p.champ).startsWith("arbre") || p.champ === "brut" ? "IL ME FAUT UNE PRÉCISION" : "JE PEUX COMPRENDRE PLUSIEURS CHOSES") : MOTS[p.statut];
    if (mot) c.appendChild(el("div", "mot", mot));
    if (p.titre) c.appendChild(el("div", "titre", p.titre));
    if (p.label) c.appendChild(el("div", "etiquette", { oui: "Oui", non: "Non", ca_depend: "Ça dépend" }[p.label] + ", d'après cette règle :"));
    if (p.ailleurs) c.appendChild(el("div", "ailleurs", `Ce n'est pas sur la page que vous lisez. C'est dans : ${p.ailleurs}.`));
    if (p.texte && p.statut !== "RIEN") c.appendChild(el("p", "texte", p.texte));
    if (p.echo) { const e = el("p", "echo", "J'ai compris : " + p.echo + " "); const b = el("button", "lien", "Corriger"); b.addEventListener("click", () => { const i = $("#widget-input"); i.value = p.question; i.focus(); }); e.appendChild(b); c.appendChild(e); }
    (p.chemin || []).forEach(x => c.appendChild(el("div", "chemin", `${x.q} ${x.r}`)));

    (p.lignes || []).forEach((l, i) => {
      if (p.statut === "VERDICTS") return;
      if (p.libelles) c.appendChild(el("div", "libelle", p.libelles[i]));
      c.appendChild(citation(l, p.sources ? libelleSource(p.sources[i] || p.sources[0]) : ""));
    });
    (p.lignesLibres || []).forEach(t => { const b = el("div", "citation"); b.appendChild(el("blockquote", null, "« " + t + " »")); c.appendChild(b); });
    if (p.lignesLibres && p.sources) c.appendChild(el("div", "source", libelleSource(p.sources[0])));

    if (p.calc) {
      const t = el("table", "calc");
      p.calc.lignes.forEach(x => { const r = el("tr"); r.appendChild(el("td", null, x.label)); r.appendChild(el("td", "n", `${x.netMensuel.toLocaleString("fr-FR")} € net par mois`)); t.appendChild(r); });
      c.appendChild(t);
    }
    if (p.verdicts) {
      c.appendChild(el("div", "titre", `${p.scenario.groupe} : ${p.scenario.titre}`));
      const t = el("table", "verdicts");
      const h = el("tr"); ["Contrat", "Verdict", "Plafond", "Franchise"].forEach(x => h.appendChild(el("th", null, x))); t.appendChild(h);
      p.verdicts.forEach(v => {
        const r = el("tr");
        [v.assureur, v.statut_fr, v.plafond || "non précisé", v.franchise || "non précisé"].forEach(x => r.appendChild(el("td", null, x)));
        t.appendChild(r);
        const r2 = el("tr", "extrait"); const td = el("td", null, `Extrait, p. ${v.page}${v.verifiee ? "" : " (non revérifié)"} : « ${v.citation} »`); td.colSpan = 4; r2.appendChild(td); t.appendChild(r2);
      });
      c.appendChild(t);
      if (!p.verdicts.length) c.appendChild(el("p", "texte", "Aucun contrat n'est exclu ou non couvert pour ce sinistre dans ces extraits."));
    }
    if (p.liste) {
      if (p.compte) c.appendChild(el("p", "compte", String(p.complet.n)));
      const ul = el("ul", "liste");
      p.liste.forEach(it => {
        const li = el("li", null, it.t + (it.conditionnel ? " (selon votre situation)" : ""));
        if (it.ligne) { const l = M.L.find(x => x.id === it.ligne); if (l) { const b = el("button", "lien", "Voir"); b.addEventListener("click", () => voir(l)); li.appendChild(document.createTextNode(" ")); li.appendChild(b); } }
        ul.appendChild(li);
      });
      c.appendChild(ul);
      if (p.complet) c.appendChild(el("div", "complet", `${p.complet.n}${p.complet.total ? " sur " + p.complet.total : ""} selon ${p.complet.source}${p.complet.tronque ? " (les 14 premières affichées)" : ", liste complète"}.`));
      if (p.etat) c.appendChild(el("div", "complet", `Fait : ${p.etat.fait} · reste : ${p.etat.reste} · pas concerné : ${p.etat.hors}`));
    }
    if (p.statut === "RIEN") {
      c.appendChild(el("p", "texte", `J'ai cherché : ${p.mots.join(", ") || "rien d'exploitable"}.` + (p.zero?.length ? ` Aucun passage ne contient : ${p.zero.join(", ")}.` : "")));
      c.appendChild(el("p", "texte", `Balayage de toutes les lignes (${p.couverture.lignes}, ${p.couverture.pages} pages), hors ${p.couverture.sans}.`));
      if (p.proche) { c.appendChild(el("div", "libelle", `Le plus proche, et pourquoi ce n'est pas une réponse : ${p.proche.pourquoi}`)); c.appendChild(citation(p.proche, libelleSource(p.proche.source))); }
      c.appendChild(el("p", "texte", p.texte));
    }
    if (p.annonce) c.appendChild(el("div", "annonce", `Annoncé, pas en vigueur : ${p.annonce.annonce}. Appliqué selon le guide : ${p.annonce.en_vigueur}.`));
    [].concat(p.note || []).filter(Boolean).forEach(n => c.appendChild(el("p", "note", n)));
    (p.row?.notes || []).forEach(n => c.appendChild(el("p", "note", n)));
    if (p.requete) c.appendChild(el("div", "requete", "Filtre : " + p.requete));
    if (p.options?.length) {
      const z = el("div", "options");
      p.options.forEach(o => { const b = el("button", "chip" + (o.defaut ? " defaut" : ""), o.label + (o.defaut ? " (cette page)" : "")); b.addEventListener("click", () => envoyer(o.envoie)); z.appendChild(b); });
      c.appendChild(z);
    }
    if (p.lien) {
      const b = el("button", "btn-voir", p.lien.label);
      b.addEventListener("click", () => { if (p.lien.route.includes("/#") || !p.lien.route.startsWith("#")) window.open(p.lien.route, "_blank", "noopener"); else allerRoute(p.lien.route); });
      c.appendChild(b);
    }
    if (p.autour && p.autour.length > (p.lignes || []).length) {
      const d = el("details", "autour"); d.appendChild(el("summary", null, "Lire autour"));
      p.autour.forEach(l => d.appendChild(el("p", null, l.t)));
      c.appendChild(d);
    }
    c.appendChild(trace(p));
    return c;
  }

  function trace(p) {
    const d = el("details", "trace");
    d.open = localStorage.getItem("assistant.trace") !== "0" && large();
    const nb = p.trace.filter(t => t.qui === "modèle" && t.etape !== "Modèle non appelé").length;
    d.appendChild(el("summary", null, `Comment j'ai trouvé · ${nb ? nb + " appel" + (nb > 1 ? "s" : "") + " au modèle" : "0 appel au modèle"}`));
    const ol = el("div", "lignes-trace");
    p.trace.forEach(t => {
      const r = el("div", "tr-ligne");
      r.appendChild(el("span", "qui " + (t.qui === "modèle" && t.etape !== "Modèle non appelé" ? "qui-modele" : "qui-code"), t.etape === "Modèle non appelé" ? "modèle" : t.qui));
      r.appendChild(el("span", "etape", t.etape));
      r.appendChild(el("span", "det", t.detail || ""));
      if (t.json) { const j = el("details", "json"); j.appendChild(el("summary", null, "JSON")); j.appendChild(el("pre", null, JSON.stringify(t.json, null, 1))); r.appendChild(j); }
      ol.appendChild(r);
    });
    const { trace: _t, row: _r, ...typee } = p;
    const r = el("div", "tr-ligne");
    r.appendChild(el("span", "qui qui-code", "code"));
    r.appendChild(el("span", "etape", "Réponse typée"));
    const j = el("details", "json"); j.appendChild(el("summary", null, "JSON"));
    const meta = { guide: index.stats.commit, regle: p.regle?.id, route: p.regle?.route, modele: modeleActif() ? window.ASSISTANT_MODELE.nom : null, gabarit: "v1" };
    j.appendChild(el("pre", null, JSON.stringify({ ...typee, _meta: meta }, null, 1)));
    r.appendChild(j); ol.appendChild(r);
    d.appendChild(ol);
    return d;
  }

  // ---------- Sending ----------
  async function envoyer(q) {
    await pret;
    majEntete();
    const ctx = { page: pageCourante(), profil: window.LUXUI ? window.LUXUI.profil() : {}, coches: chargerCoches(), dernier };
    // Screen before echo: a personal number is never repeated on the page.
    const preuve = M.ligneDeQuestion(q, {});
    const masque = M.decide(preuve, ctx)[0].id === "r2";
    bulleMoi(masque ? "(message masqué : il contenait une donnée personnelle)" : q);
    const attente = el("div", "msg bot attente", "Je lis le guide…");
    journal().appendChild(attente);
    if (modeleActif()) attente.textContent = "Je lis les passages…";
    let res;
    try { res = await M.repondre(q, ctx); } catch (e) { attente.remove(); journal().appendChild(el("div", "msg bot", "Une erreur est survenue : " + e.message)); return; }
    attente.remove();
    if (res.parts.length > 1) journal().appendChild(el("div", "msg bot annonce-parties", `${res.parts.length === 2 ? "Deux" : res.parts.length === 3 ? "Trois" : res.parts.length} questions. Je réponds à chacune.`));
    res.parts.forEach((p, i) => {
      const c = carte(p);
      if (res.parts.length > 1) c.prepend(el("div", "numero", String(i + 1)));
      journal().appendChild(c);
    });
    if (res.arret) journal().appendChild(el("div", "msg bot note", "La première réponse étant non, je m'arrête là."));
    journal().scrollTop = journal().scrollHeight;
    const r0 = res.parts[0].row;
    if (r0 && r0.concepts?.length) dernier = { original: q, concepts: M.ligneDeQuestion(q, {}).concepts, mots: r0.mots };
    session.push({ quand: new Date().toISOString(), question: masque ? "(masqué)" : q, page: ctx.page?.id, statut: res.parts.map(p => p.statut).join("+"), route: res.parts.map(p => p.regle?.route).join("+"), lignes: res.parts.flatMap(p => (p.lignes || []).map(l => l.id)).join(" ") });
  }

  function chargerCoches() { try { return JSON.parse(localStorage.getItem("luxguide.parcours.v1") || "{}") || {}; } catch (e) { return {}; } }

  // ---------- D36: moving to the passage ----------
  async function allerRoute(r) {
    if (location.hash !== r) location.hash = r;
    else window.dispatchEvent(new HashChangeEvent("hashchange"));
    await attendre(180);
    majEntete();
  }

  async function atteindre(ad) {
    await allerRoute(ad.r);
    for (const c of ad.c || []) {
      if (typeof c === "string") { const b = $(c); if (b) { b.click(); await attendre(60); } }
      else if (c.chip) {
        const b = [...document.querySelectorAll(c.sc + " button")].find(x => norm(x.textContent) === c.chip);
        if (b && !b.classList.contains("actif")) { b.click(); await attendre(40); }
      } else if (c.clear) {
        document.querySelectorAll(c.clear + " button").forEach(b => { if (/^(tous|toutes|tout)\b/i.test(norm(b.textContent))) b.click(); });
        await attendre(40);
      }
    }
    if (ad.f) {
      const d = [...document.querySelectorAll(ad.fsel)].find(x => norm(x.querySelector("summary")?.textContent || "").startsWith(norm(ad.f)));
      if (d) d.open = true;
    }
    return document.querySelector(ad.sc) || $(".panel:not([hidden])");
  }

  function plage(scope, l) {
    if (l.row && l.k === "tableau") {
      const tr = [...scope.querySelectorAll("tr")].find(x => l.row.every(c => norm(x.textContent).includes(norm(c))));
      if (tr) { const r = document.createRange(); r.selectNodeContents(tr); return r; }
    }
    const aiguille = norm(l.row && l.k === "repere" ? l.row[1] : l.row && l.k === "carte" ? l.row[0] : l.row && l.row.length === 2 && l.k === "etape" ? l.row[1] : l.row && l.k === "coche" ? l.row[0] : l.t);
    const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode, t = n.nodeValue, i = t.indexOf(aiguille);
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + aiguille.length); return r; }
      if (norm(t) === aiguille) { const r = document.createRange(); r.selectNodeContents(n); return r; }
    }
    // The sentence crosses inline tags: the smallest element that holds it.
    const candidats = [...scope.querySelectorAll("p,li,td,div,summary,h2,h3,dd")].filter(e => norm(e.textContent).includes(aiguille));
    if (candidats.length) { const e = candidats.sort((a, b) => a.textContent.length - b.textContent.length)[0]; const r = document.createRange(); r.selectNodeContents(e); return r; }
    return null;
  }

  function surligner(r) {
    if (window.CSS && CSS.highlights && window.Highlight) { CSS.highlights.set("passage", new Highlight(r)); return true; }
    const e = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    document.querySelectorAll(".passage-repli").forEach(x => x.classList.remove("passage-repli"));
    e.classList.add("passage-repli");
    return true;
  }

  async function voir(l) {
    const ad = index.addrs[l.a];
    if (!large() && window.LUXUI) { window.LUXUI.cacherWidget(); montrerRetour(); }
    const scope = await atteindre(ad);
    if (!scope) return false;
    const r = plage(scope, l);
    const reussi = !!r;
    if (r) {
      surligner(r);
      const e = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      e.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    majEntete();
    return reussi;
  }

  function montrerRetour() {
    let b = $("#revenir-reponse");
    if (!b) {
      b = el("button", null, "Revenir à la réponse"); b.id = "revenir-reponse";
      b.addEventListener("click", () => { b.hidden = true; window.LUXUI.montrerWidget(); });
      document.body.appendChild(b);
    }
    b.hidden = false;
  }

  // Used by the CI check of D5: can this line really be reached and marked?
  async function localiser(l) {
    const ad = index.addrs[l.a];
    if (ad.ext) return null;
    const scope = await atteindre(ad);
    return !!(scope && plage(scope, l));
  }

  function exporterSession() {
    const cols = ["quand", "question", "page", "statut", "route", "lignes"];
    const csv = "﻿" + [cols.join(";"), ...session.map(r => cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(";"))].join("\n");
    const a = el("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "mes-questions.csv"; a.click();
  }

  // ---------- Set-up ----------
  function installer() {
    const w = $("#widget");
    const log = $("#widget-log");
    if (!w || !log) return;
    const z = el("div"); z.id = "vous-lisez"; log.parentNode.insertBefore(z, log);
    const outils = el("div", "w-outils");
    const tr = el("label", null); const ci = el("input"); ci.type = "checkbox"; ci.checked = localStorage.getItem("assistant.trace") !== "0";
    ci.addEventListener("change", () => { localStorage.setItem("assistant.trace", ci.checked ? "1" : "0"); document.querySelectorAll("#widget-log details.trace").forEach(d => { d.open = ci.checked; }); });
    tr.append(ci, " Comment j'ai trouvé");
    const sm = el("label", null); const cs = el("input"); cs.type = "checkbox"; cs.checked = sansModele();
    cs.addEventListener("change", () => localStorage.setItem("assistant.sansmodele", cs.checked ? "1" : "0"));
    sm.append(cs, " Sans modèle");
    const dl = el("button", "lien", "Mes questions (CSV)"); dl.addEventListener("click", exporterSession);
    const mach = el("a", "lien", "La mécanique"); mach.href = "../machine/";
    outils.append(tr, sm, dl, mach);
    log.parentNode.insertBefore(outils, log);
    window.addEventListener("hashchange", () => setTimeout(majEntete, 120));
    document.addEventListener("click", e => { if (e.target.closest && e.target.closest("#g-tabs, .g-tab, #mrh-tabs, #sim-tabs, #widget-btn")) setTimeout(majEntete, 80); });
    pret.then(async () => {
      majEntete();
      const u = new URLSearchParams(location.search);
      const q = u.get("q");
      if (u.get("p")) { location.hash = "#" + u.get("p"); await attendre(250); }
      if (u.get("c")) { const b = document.getElementById(u.get("c")); if (b) { b.click(); await attendre(80); } }
      if (q) { window.LUXUI.montrerWidget(); majEntete(); await envoyer(q); }
    });
  }

  // For the measurements in CI: the same engine, without drawing cards.
  const moteurs = {};
  const optionsMode = m => ({ DICO: m === "sans_dico" ? [] : window.DICO_FINAL, REFUS: window.REFUS, DECLARE: window.DECLARE, sim: window.SIM, modele: m === "complet" ? window.ASSISTANT_MODELE : null, get vecteurs() { return m === "complet" ? vecteurs : null; } });
  const propre = o => JSON.parse(JSON.stringify(o, (k, v) => (k === "trace" || k === "row" || k === "autour" ? undefined : v)));
  async function evaluer(q, pageId, mode) {
    if (mode === "origine") {
      const r = await window.CHAT.repondre(q, window.CHAT.profilVide(), []);
      const refus = /ne trouve pas|n'ai pas|pas d'information|ne sais pas|ne couvre pas|reformuler/i.test(r.texte || "");
      return { parts: [{ statut: refus ? "RIEN" : "REPONSE", lignes: [{ t: r.texte || "" }] }] };
    }
    if (mode === "naif") {
      const mots = window.Moteur.plain(q).split(/[^a-z0-9]+/).filter(w => w.length > 3);
      let best = null, bs = 0;
      for (const l of index.lignes) { const t = window.Moteur.plain(l.t); let s = 0; for (const w of mots) if (t.includes(w)) s++; if (s > bs) { bs = s; best = l; } }
      return { parts: [{ statut: "REPONSE", lignes: best ? [{ t: best.t }] : [{ t: "" }] }] };
    }
    moteurs[mode] = moteurs[mode] || window.Moteur.creer(JSON.parse(JSON.stringify(index)), optionsMode(mode));
    const p = pageId && mode !== "sans_page" ? index.pages.find(x => x.id === pageId) : null;
    try { return propre(await moteurs[mode].repondre(q, { page: p ? { id: p.id, titre: p.titre } : null })); }
    catch (e) { return { parts: [{ statut: "ERREUR", texte: e.message }] }; }
  }

  window.ASSISTANT = { envoyer, atteindre, localiser, voir, pageCourante, pret, evaluer, pages: () => index.pages.map(p => ({ id: p.id })), juger: (q, a, m) => window.ASSISTANT_MODELE.juger(q, a, m), journalModele: () => window.ASSISTANT_MODELE ? window.ASSISTANT_MODELE.journal : [] };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installer); else installer();
})();
