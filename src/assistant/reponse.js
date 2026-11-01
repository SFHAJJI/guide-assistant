// Brick 4, generation: one handler per route. Each returns a typed answer whose sentence is the guide's, fetched by its line id.
(function () {
  const { plain, stem, content, RE_TYPE, MOTS_DE_TYPE } = window.Texte;

  window.Briques = window.Briques || {};
  window.Briques.reponse = function ({ index, opt, L, byId, pageById, inv, COEF, REFUS, DECLARE, sim, chercher, parVecteur, MIN_SCORE, MIN_MARGE, typeDe }) {
    function source(l) {
      const p = pageById.get(l.p);
      return { page: p?.titre || l.p, section: l.s && l.s !== p?.titre ? l.s : "", verifie: index.stats.verifie, ligne: l.id };
    }
    const vue = l => ({ id: l.id, t: l.t, k: l.k, p: l.p, s: l.s, a: l.a, r: l.r, row: l.row });
    const autour = l => L.filter(x => x.g === l.g).map(vue);
    const trouve = (p, c) => L.find(l => l.p === p && l.t.includes(c));

    // D21: a flagged FAQ row never shows its opener.
    function ligneFAQ(l, faq) {
      if (!faq.opener_faux) return { lignes: [vue(l)], note: null };
      const fiche = L.filter(x => x.p === faq.fiche && !["titre", "astuce"].includes(x.k));
      const st = new Set(content(l.s + " " + faq.lignes.map(i => byId.get(i).t).join(" ")).map(stem));
      let best = null, bs = 0;
      for (const x of fiche) { let s = 0; for (const t of x.st) if (st.has(t)) s++; if (s > bs) { bs = s; best = x; } }
      if (best && bs >= 4) return { lignes: [vue(best)], remplace: true };
      const suite = faq.lignes.slice(1).map(i => vue(byId.get(i)));
      return { lignes: suite.length ? suite.slice(0, 2) : [vue(l)], remplace: true };
    }

    function verifConflit(row, part) {
      const pq = row.pq;
      for (const c of DECLARE.conflits || []) {
        const a = w => new RegExp("(^|[^a-z0-9])" + plain(w) + "($|[^a-z0-9])").test(pq);
        // A shown line that belongs to a conflict raises it, unless the reader asked how to do something: that needs the steps.
        const conc = row.type !== "procedure" && part.lignes && part.lignes.some(x => c.lignes.some(y => x.p === y.p && x.t.includes(y.c)));
        if (conc || (c.sujet.some(a) && c.aspect.some(a))) {
          const ls = c.lignes.map(y => trouve(y.p, y.c)).filter(Boolean);
          if (ls.length === 2) return { statut: "DEUX_CHOSES", lignes: ls.map(vue), sources: ls.map(source), declare: c.id, nomodel: ls.some(x => x.nomodel) };
        }
      }
      return null;
    }

    function verifCondition(row, ctx) {
      for (const c of DECLARE.conditions || []) {
        const motOk = c.quand.some(w => row.pq.includes(plain(w)));
        const conceptOk = row.concepts.some(x => x.id === c.concept) || /\b(commune|arrivee|declar\w+|enregistr\w+)\b/.test(row.pq);
        if (!motOk || !conceptOk) continue;
        let v = null;
        if (/\b(hors ue|hors union|pays tiers|marocain\w*|tunisien\w*|algerien\w*|americain\w*|indien\w*|chinois\w*|bresilien\w*|turc|turque|britannique|russe|ukrainien\w*|canadien\w*|cap-verdien\w*)\b/.test(row.pq)) v = "tiers";
        if (/\b(francais\w*|belge|allemand\w*|portugais\w*|italien\w*|espagnol\w*|polonais\w*|neerlandais\w*|roumain\w*|suisse|citoyen de l'union|europeen\w*)\b/.test(row.pq)) v = "ue";
        const ids = Object.keys(c.valeurs);
        const ligne = id => trouve(c.valeurs[id].ligne.p, c.valeurs[id].ligne.c);
        if (v && ligne(v)) return { statut: "REPONSE", lignes: [vue(ligne(v))], sources: [source(ligne(v))], note: v === "tiers" ? c.note : null, condition: c.id, fait: v };
        const ls = ids.map(ligne).filter(Boolean);
        return { statut: "REPONSE", lignes: ls.map(vue), libelles: ids.map(i => c.valeurs[i].label), sources: ls.map(source), note: "Cela dépend de votre nationalité, pas du pays d'où vous arrivez.", condition: c.id };
      }
      return null;
    }

    // ---------- Handlers: <format>_<intent> ----------
    const H = {
      hors_sujet: () => ({ statut: "HORS", texte: "Cette question sort de ce que couvre le guide : l'installation au Luxembourg." }),
      urgence: () => ({ statut: "URGENCE", texte: "Appelez le 112 (urgences, gratuit, depuis tout téléphone). Je suis un guide, je ne peux pas vous aider dans l'urgence." }),
      prive: () => ({ statut: "PERSONNEL", texte: "Votre message contient ce qui ressemble à une donnée personnelle. Je ne l'ai ni répété ni envoyé. Reformulez sans ce numéro et je chercherai." }),
      salut: (row, ctx) => ({ statut: "SALUT", texte: /merci/.test(row.pq) ? "Avec plaisir." : `Bonjour. ${ctx.page ? `Vous lisez : ${ctx.page.titre}. ` : ""}Posez votre question, je réponds avec les phrases du guide.` }),
      refus: row => { const r = REFUS.find(x => x.re.test(row.pq)); return { statut: "REFUS", texte: r.texte, lien: r.route ? { route: r.route, label: r.label } : null, regle: r.id }; },

      // The reader points at the open page: it is the first scope, not a boost [6B:255-257, 6C:25-27].
      async page_qa(row, ctx, T) {
        const modele = opt.modele || null;
        const titre = ctx.page.titre;
        const onglet = ctx.page.onglet ? plain(ctx.page.onglet) : null;
        const lignes = L.filter(l => l.p === ctx.page.id && COEF[l.k] !== 0 && l.k !== "titre");
        const st = new Set(row.mots.map(stem));
        const typeRe = RE_TYPE[row.type];
        const propre = !row.concepts.length;
        T.push({ qui: "code", etape: "Portée", detail: `la page ouverte, ${lignes.length} lignes`, json: { page: ctx.page.id, onglet: ctx.page.onglet || null } });
        const demander = () => ({ statut: "CLARIFIER", champ: "sujet", libre: true, texte: `Sur cette page (${titre}), je ne trouve pas de quoi répondre. De quoi parlez-vous ?`, options: [{ label: "Chercher dans tout le guide", envoie: `${row.original} (dans tout le guide)` }] });
        const sur = ls => ({ statut: "REPONSE", lignes: ls.map(vue), sources: [source(ls[0])], portee: "page" });
        // "ce chiffre" names nothing the code can find: which one is the reader's to say.
        if (/\b(ce|cet|cette) (chiffre|montant|truc|mot|terme)\b/.test(row.pq) && row.mots.length <= 1) return demander();
        // No word of its own: the type of the question picks the lines.
        const motsUtiles = [...st].filter(x => !MOTS_DE_TYPE.has(x));
        if (!motsUtiles.length) {
          if (row.type === "montant" || row.type === "duree") {
            const avec = lignes.filter(l => typeRe.test(l.plain)).sort((a, b) => (onglet && plain(b.s).includes(onglet) ? 1 : 0) - (onglet && plain(a.s).includes(onglet) ? 1 : 0) || (b.row ? 1 : 0) - (a.row ? 1 : 0));
            const uniques = [...new Map(avec.map(l => [l.t, l])).values()].slice(0, 5);
            return uniques.length ? { ...sur(uniques), titre: `Sur cette page : ${titre}` } : demander();
          }
          const essentiel = lignes.filter(l => l.k === "chapo" || l.k === "retenir").slice(0, 4);
          return essentiel.length && row.type !== "booleen" ? { ...sur(essentiel), titre: `Ce que le guide retient de cette page : ${titre}` } : demander();
        }
        const notes = lignes.map(l => {
          let m = 0; for (const x of motsUtiles) if (l.st.has(x)) m++;
          return { l, s: m * 2 + (typeRe && typeRe.test(l.plain) ? 3 : 0) + (onglet && plain(l.s).includes(onglet) ? 1 : 0), m, sc: { mots: new Set(), dico: 0 }, couverture: motsUtiles.length ? m / motsUtiles.length : 0 };
        }).filter(x => x.m > 0).sort((a, b) => b.s - a.s);
        const vus = new Set(); const top = [];
        for (const x of notes) { if (vus.has(x.l.g)) continue; vus.add(x.l.g); top.push(x); if (top.length >= 6) break; }
        const finSansLigne = () => { row.epingle = false; return propre ? demander() : null; };
        if (!top.length) return finSansLigne();
        let c = top[0];
        const sansModele = !modele || c.l.nomodel;
        if (sansModele) {
          T.push({ qui: "code", etape: "Sans arbitre", detail: "meilleure ligne de la page" });
          return composer(c, row, ctx, T, { clair: false, audit: null, st: motsUtiles });
        }
        row.appels = (row.appels || 0) + 1;
        const rq = { ...row, original: `${row.original} (le lecteur regarde la page : ${titre})` };
        const arbitre = await modele.arbitre(rq, top.map(x => ({ id: x.l.id, section: titre + " › " + x.l.s, methods: ["mots", "page"], snippet: autour(x.l).map(y => y.t).join(" ").slice(0, 320) })), pageById.get(ctx.page.id)?.resume || "");
        if (arbitre) {
          T.push({ qui: "modèle", etape: "Arbitre", detail: arbitre.raison || "", json: arbitre });
          const pick = arbitre.choix && top.find(x => x.l.id === arbitre.choix);
          if (!pick) { T.push({ qui: "code", etape: "Arbitre écouté", detail: "aucun passage de cette page ne répond" }); return finSansLigne(); }
          c = pick;
          const v = modele.verifier ? await modele.verifier(rq, titre + " › " + c.l.s, autour(c.l).map(y => y.t).join(" ").slice(0, 700)) : null;
          if (v) T.push({ qui: "modèle", etape: "Vérification", detail: (v.repond ? "le passage répond : " : "le passage ne répond pas : ") + (v.raison || ""), json: v });
          if (v && !v.repond) return finSansLigne();
        } else T.push({ qui: "modèle", etape: "Arbitre", detail: "pas de réponse dans le temps : meilleure ligne du code, signalée" });
        return composer(c, row, ctx, T, { clair: false, arbitre, audit: null, st: motsUtiles });
      },

      // A subject and nothing else: open its page and show what the guide keeps from it.
      fiche_sujet(row, ctx) {
        const f = row.concepts.find(x => x.id.startsWith("f:")) || row.concepts.find(x => (x.c.pages || []).length);
        const id = f && f.c.pages[0];
        const ls = id ? L.filter(l => l.p === id && (l.k === "chapo" || l.k === "retenir")).slice(0, 4) : [];
        if (!ls.length) return null;
        // A word the guide never uses is not answered by the page's summary: say so, and show the page as the nearest.
        if (row.mots.some(m => !inv.has(stem(m)))) {
          row.proche = ls[0];
          row.procheRaison = `c'est la fiche sur ce sujet, mais elle n'emploie pas ce mot.`;
          return H.absence(row);
        }
        return { statut: "REPONSE", titre: `${pageById.get(id).titre} : ce que le guide retient`, lignes: ls.map(vue), sources: [source(ls[0])], ailleurs: ctx.page && id !== ctx.page.id ? pageById.get(id).titre : null };
      },

      clarifier(row, ctx) {
        const multi = row.concepts.find(c => c.c.sens && !c.c.sens.some(s => s.mots.some(m => row.pq.includes(plain(m)))));
        if (multi) {
          const defaut = ctx.page && multi.c.sens.find(s => s.mots.some(m => plain(ctx.page.titre || "").includes(plain(m))));
          return { statut: "CLARIFIER", texte: `« ${multi.mot} » peut vouloir dire plusieurs choses dans le guide. Vous parlez de quoi ?`,
            options: multi.c.sens.map(s => ({ label: s.label, envoie: `${row.original} (${s.ajoute})`, defaut: s === defaut })), champ: "sens" };
        }
        if (row.ambigu && row.ambiguOptions?.length >= 2) return { statut: "CLARIFIER", texte: "Votre question peut se comprendre de plusieurs façons. Laquelle ?", champ: "sens", options: row.ambiguOptions.slice(0, 3).map(o => ({ label: o, envoie: o })), parModele: true };
        return { statut: "CLARIFIER", texte: "C'est-à-dire ? Dites-moi de quoi vous parlez.",
          options: [{ label: "Un loyer ou une caution", envoie: "Quelle garantie locative un bailleur peut-il demander ?" }, { label: "Un salaire", envoie: "Quelle différence entre classe 1 et classe 2 ?" }, { label: "L'immatriculation", envoie: "Combien coûte l'immatriculation ?" }], champ: "sujet" };
      },

      outil_guide(row) {
        const c = row.concepts.find(x => x.c.tool);
        return { statut: "OUTIL", texte: `Cette réponse se trouve dans un outil du guide, que je ne lis pas encore : ${c.c.titre}.`, lien: { route: c.c.tool, label: `Ouvrir : ${c.c.titre}` } };
      },

      // D41: typed slots, an echo, no defaults.
      outil_qa(row) {
        if (!sim) return { statut: "OUTIL", texte: "Le simulateur du guide calcule ce net.", lien: { route: "#simulateur/salaire", label: "Ouvrir le simulateur" } };
        const sansClasse = row.pq.replace(/classe\s*(1a|1|2)/g, " ");
        const m = sansClasse.match(/(\d{1,3}(?:[ .]\d{3})+|\d{4,7}|\d+(?:[.,]\d+)?\s*k\b)/);
        // A net figure stops the calculation: the simulator goes from gross to net, and a guess here is a wrong number [8A].
        const net = /\b\d[\d .]*k?\s*(€|euros?)?\s*nets?\b|\bnet\s*(de|a|:)?\s*\d/.test(sansClasse);
        if (net) return { statut: "REPONSE_SANS", texte: "Le guide calcule du brut vers le net, pas dans l'autre sens. Je ne le fais pas à sa place.", lien: { route: "#simulateur/salaire", label: "Ouvrir le simulateur" } };
        if (!m) return { statut: "CLARIFIER", texte: "Quel est le salaire brut annuel ?", options: [], champ: "brut", libre: true };
        let v = m[1].replace(/[ .]/g, "");
        v = /k$/i.test(v) ? Math.round(parseFloat(v) * 1000) : parseInt(v, 10);
        const mensuel = /\b(par mois|mensuel\w*|\/mois|chaque mois)\b/.test(sansClasse);
        const annuel = /\b(par an|annuel\w*|\/an|a l'annee)\b/.test(sansClasse);
        // No default: a figure with no "brut", or too small for a year with no period, is asked back (D41).
        if (!/\b(bruts?|gross)\b/.test(sansClasse) || (!mensuel && !annuel && v < 15000)) {
          const chiffre = v.toLocaleString("fr-FR");
          return { statut: "CLARIFIER", champ: "brut", texte: `${chiffre} €, c'est quoi exactement ?`,
            options: [{ label: "Brut par an", envoie: `${v} brut par an` }, { label: "Brut par mois", envoie: `${v} brut par mois` }, { label: "C'est du net", envoie: `${v} net` }] };
        }
        const mois = /\b13\b.*\bmois\b|treizieme/.test(sansClasse) ? 13 : 12;
        const brut = mensuel ? v * mois : v;
        const classes = [...row.pq.matchAll(/classe\s*(1a|1|2)/g)].map(x => "classe" + x[1]);
        const impatrie = /\bimpatrie/.test(row.pq);
        const toutes = sim.comparatif(brut, mois);
        const lignes = toutes.filter(c => !classes.length || classes.includes(c.classe)).map(c => {
          const r = impatrie ? c.resImpatrie : c.res;
          return { label: c.label, netMensuel: Math.round(r.netMensuel) };
        });
        const montreNet = row.negation ? row.negation.veut === "net" : true;
        return { statut: "CALCUL", calc: { fonction: "SIM.comparatif", entrees: { brut_annuel: brut, mois, classes: classes.length ? classes : "toutes", impatrie }, lignes },
          echo: `${brut.toLocaleString("fr-FR")} € brut par an${mensuel ? ` (${v.toLocaleString("fr-FR")} € × ${mois})` : ""}, sur ${mois} mois${classes.length ? ", " + classes.map(c => c.replace("classe", "classe ")).join(" et ") : ", les trois classes"}${impatrie ? ", régime des impatriés" : ""}`,
          note: [impatrie ? "Calculé sans vérifier que vous remplissez les conditions du régime." : null, opt.paramsModifies ? "Vous avez modifié les paramètres du simulateur : ce calcul les utilise." : null, "Indicatif : retenue sur le seul salaire, pas le chiffre de votre fiche de paie.", montreNet ? null : null].filter(Boolean),
          lien: { route: "#simulateur/salaire", label: "Ouvrir le simulateur" } };
      },

      // D42: the tree is a table, walked by code from what the reader stated.
      arbre(row) {
        const { arbre, fins } = index.arbre;
        const pq = row.pq;
        const ans = pq.match(/\b(veuf|veuve)\b.*\bdepuis (\d+) ans/);
        const veufLongtemps = !!(ans && +ans[2] > 3);
        const faits = {
          depart: /\b(marie|mariee|pacse|pacsee|partenariat|ma femme|mon mari|mon epoux|mon epouse)\b/.test(pq) ? 0 : /\b(celibataire|seul|seule|union libre|divorce|divorcee|separe|separee|veuf|veuve|pas marie)\b/.test(pq) ? 1 : null,
          residence: /\b(reste|restent|encore|a l'etranger|en france|en belgique|en allemagne|au portugal)\b/.test(pq) ? 1 : /\b(tous les deux|au luxembourg|ici)\b/.test(pq) ? 0 : null,
          rupture: veufLongtemps ? 0 : /\b(veuf|veuve|deces)\b/.test(pq) ? 1 : /\b(divorce|divorcee|separe|separee)\b/.test(pq) ? 2 : /\b(celibataire|jamais marie|rien de tel)\b/.test(pq) ? 0 : null,
          moderation: veufLongtemps ? 3 : /\b(sans enfant|pas d'enfant|ni l'un ni l'autre)\b/.test(pq) ? 0 : /\b(enfant|enfants|moderation)\b/.test(pq) ? 1 : /\b(64 ans|65 ans|retraite)\b/.test(pq) ? 2 : null,
        };
        let n = "depart"; const chemin = [];
        while (arbre[n]) {
          const i = faits[n];
          if (i === null || i === undefined) {
            return { statut: "CLARIFIER", texte: arbre[n].q, chemin, champ: "arbre:" + n,
              options: arbre[n].r.map(r => ({ label: r[0], envoie: `${row.original.replace(/\s*\(.*\)$/, "")} (${r[0]})` })) };
          }
          chemin.push({ q: arbre[n].q, r: arbre[n].r[i][0] });
          n = arbre[n].r[i][1];
        }
        const f = fins[n];
        return { statut: "REPONSE", titre: f.titre, lignesLibres: [f.texte, f.alerte].filter(x => typeof x === "string"), chemin, fin: n,
          sources: [{ page: "Simulateur › Quelle classe", section: "" }], lien: { route: "#simulateur/classe", label: "Ouvrir l'arbre du guide" } };
      },

      // D43: done, left, not concerned. Nothing is guessed about the reader.
      etat(row, ctx) {
        const p = ctx.profil || {};
        const coches = ctx.coches || {};
        const concerne = it => !it.si || Object.keys(it.si).every(k => {
          const v = p[k];
          if (v === undefined) return true;
          if (k === "enfants") return v !== "Aucun";
          if (k === "vehicule") return v === "Oui";
          if (k === "logement") return v === it.si.logement || v === "Pas encore decide";
          if (k === "statut") return v === it.si.statut || v === "Les deux";
          return v === it.si[k];
        });
        const fait = [], reste = [], hors = [];
        for (const it of index.parcours) (concerne(it) ? (coches[it.t] || coches[it.id] ? fait : reste) : hors).push(it);
        const conditionnels = reste.filter(it => it.si && !Object.keys(it.si).every(k => p[k] !== undefined));
        return { statut: "LISTE", liste: reste.slice(0, /commencer/.test(row.pq) ? 6 : 14).map(it => ({ t: it.t, phase: it.phase, ligne: it.line, conditionnel: conditionnels.includes(it) })),
          complet: { n: reste.length, source: "le parcours du guide", tronque: reste.length > 14 }, etat: { fait: fait.length, reste: reste.length, hors: hors.length },
          note: [/commencer/.test(row.pq) ? "Le guide met la commune d'abord, mais la commune demande un bail, le bail une garantie, la garantie un compte, et le compte une adresse. Il ne résout pas cette boucle." : null,
            conditionnels.length ? `${conditionnels.length} étapes dépendent de votre situation, que je ne connais pas.` : null].filter(Boolean),
          lien: { route: "#parcours", label: "Ouvrir le parcours" } };
      },

      table_sinistre(row) {
        const st = new Set(row.mots.map(stem));
        const scored = index.verdicts.map(v => {
          const t = new Set(content(`${v.groupe} ${v.titre} ${v.question}`).map(stem));
          let s = 0; for (const x of st) if (t.has(x)) s++;
          const tt = new Set(content(v.titre).map(stem)); for (const x of st) if (tt.has(x)) s += 1;
          const gg = new Set(content(v.groupe).map(stem)); for (const x of st) if (gg.has(x)) s += 1.5;
          return { v, s };
        }).sort((a, b) => b.s - a.s);
        if (scored[0].s < 3) return null;
        const v = scored[0].v;
        // The scenario must carry the question's words. A candle in a garden shares "vacances" with a stolen phone; that is not this scenario.
        const texteV = new Set(content(`${v.groupe} ${v.titre} ${v.question}`).map(stem));
        const couverts = [...st].filter(x => texteV.has(x)).length;
        if (couverts / st.size < 0.4) return null;
        const ass = row.pq.match(/assureur ([abcd])\b/);
        const lignes = v.assureurs.filter(a => !ass || a.assureur.endsWith(ass[1].toUpperCase()));
        const filtre = row.complement ? lignes.filter(a => ["excluded", "not_covered"].includes(a.statut)) : lignes;
        const nf = lignes.filter(a => a.statut === "not_found").length;
        return { statut: "VERDICTS", scenario: { id: v.id, groupe: v.groupe, titre: v.titre }, lignes: [vue(byId.get(v.line))], verdicts: filtre,
          requete: `verdicts où scénario = ${v.id}${ass ? `, assureur = ${ass[1].toUpperCase()}` : ""}${row.complement ? ", statut = exclu ou non couvert" : ""}`,
          note: ["Ces verdicts portent sur des extraits de quatre contrats anonymisés. Ils ne disent rien de votre contrat.",
            nf ? `${nf} sans réponse : « non trouvé dans les extraits » ne veut pas dire non couvert.` : null].filter(Boolean),
          lien: { route: "#comparateur", label: "Ouvrir le comparateur" } };
      },

      // The table is data, so it is queried, never searched: a cell, a comparison, or a ranking computed here. The citation is the query [B4].
      table_communes(row) {
        const table = index.tableCommunes;
        const MI = opt.MOTS_INDICATEURS || window.MOTS_INDICATEURS || {};
        if (!table) return null;
        const q = row.pq.replace(/-/g, " ");
        const mot = m => new RegExp("(^|[^a-z0-9])" + m + "($|[^a-z0-9])").test(q);
        const ville = /\b(luxembourg ville|lux ville|ville de luxembourg)\b/.test(q);
        const nommees = table.lignes.filter(c => { const n = plain(c.nom).replace(/-/g, " "); return n === "luxembourg" ? ville : mot(n); });
        let id = null, long = 0;
        for (const [k, ms] of Object.entries(MI)) for (const m of ms) { const p = plain(m); if (p.length > long && mot(p)) { id = k; long = p.length; } }
        const classe = /\b(moins cher\w*|plus cher\w*|le plus|la plus|les plus|le moins|la moins|les moins|classement|top \d+)\b/.test(q);
        if (!id && /\bcher\w*\b/.test(q)) id = /\b(achet\w*|achat)\b/.test(q) ? "prix_appt_m2" : "loyer_appt";
        const ind = id && table.indicateurs.find(x => x.id === id);
        const fmt = (v, i) => `${i.fmt === "dec" ? String(v).replace(".", ",") : Number(v).toLocaleString("fr-FR")} ${i.unite}`;
        const lien = { route: "#cartes", label: "Ouvrir les cartes" };
        const sources = i => [{ page: "Cartes et communes", section: i ? i.source : "" }];
        const avertissement = i => (i.aide ? [i.aide.split(/(?<=[.!?])\s/)[0]] : []);
        if (nommees.length && ind) {
          const vides = nommees.filter(c => c.i[id] == null);
          if (vides.length === nommees.length) return { statut: "NE_CHIFFRE_PAS", texte: `Le guide n'a pas de chiffre « ${ind.nom} » pour ${vides.map(c => c.nom).join(" et ")}.`, sources: sources(ind), requete: `communes où nom = ${vides.map(c => c.nom).join(", ")} : ${id}`, lien };
          return { statut: "REPONSE", titre: ind.nom, lignesLibres: nommees.map(c => `${c.nom} : ${c.i[id] == null ? "pas de chiffre" : fmt(c.i[id], ind)}`), sources: sources(ind), requete: `communes où nom = ${nommees.map(c => c.nom).join(", ")} : ${id}`, note: avertissement(ind), lien };
        }
        if (!nommees.length && classe && ind) {
          const n = +(q.match(/\btop (\d+)\b/)?.[1] || 5);
          const asc = /\b(moins|plus bas\w*|plus faible\w*)\b/.test(q);
          const avec = table.lignes.filter(c => c.i[id] != null);
          const tri = [...avec].sort((a, b) => (asc ? a.i[id] - b.i[id] : b.i[id] - a.i[id])).slice(0, n);
          const sans = table.lignes.length - avec.length;
          return { statut: "LISTE", titre: `${ind.nom} : ${asc ? "les plus bas" : "les plus hauts"}`, liste: tri.map(c => ({ t: `${c.nom} : ${fmt(c.i[id], ind)}` })), sources: sources(ind),
            complet: { n: tri.length, source: "la table des communes", total: avec.length }, requete: `communes triées par ${id}, ordre ${asc ? "croissant" : "décroissant"}, ${tri.length} premières sur ${avec.length} avec un chiffre`,
            note: [...avertissement(ind), sans ? `${sans} communes sans chiffre : non classées, ce qui ne veut pas dire zéro.` : null].filter(Boolean), lien };
        }
        const nomsMots = new Set(nommees.flatMap(c => content(c.nom)));
        if (nommees.length === 1 && row.mots.every(m => nomsMots.has(m))) {
          const c = nommees[0];
          const cles = ["loyer_appt", "prix_appt_m2", "sal_med", "pop", "pct_etr"].map(k => table.indicateurs.find(x => x.id === k)).filter(i => i && c.i[i.id] != null);
          if (cles.length) return { statut: "REPONSE", titre: `${c.nom}, canton de ${c.canton}`, lignesLibres: cles.map(i => `${i.nom} : ${fmt(c.i[i.id], i)}`), sources: sources(null), requete: `communes où nom = ${c.nom}`, lien };
        }
        return null;
      },

      table_avantages(row) {
        let cs = index.cartes;
        const seuil = row.pq.match(/\b(au[- ]dessus de|plus de|superieure? a|moins de|sous|inferieure? a)\s+(\d[\d .]*)/);
        const moment = { salaire: /salaire|travail/, logement: /logement|achat|acheter/, famille: /famille|enfant|etude/, epargne: /epargne|declaration/, quotidien: /quotidien|revenus modestes/ };
        const cle = Object.keys(moment).find(k => moment[k].test(row.pq));
        if (cle) cs = cs.filter(c => c.moment === cle);
        let sansValeur = 0;
        if (seuil) {
          const n = parseInt(seuil[2].replace(/[ .]/g, ""), 10);
          const haut = /dessus|plus|superieur/.test(seuil[1]);
          cs = cs.filter(c => {
            const m = String(c.chiffre || "").replace(/\s/g, "").match(/(\d+)/);
            if (!m) { sansValeur++; return false; }
            return haut ? +m[1] > n : +m[1] < n;
          });
        }
        return { statut: "LISTE", liste: cs.map(c => ({ t: `${c.titre} : ${c.chiffre}${c.sous ? ", " + c.sous : ""}`, ligne: c.lignes[0] })),
          complet: { n: cs.length, source: "la table des avantages", total: index.cartes.length }, compte: row.forme === "compte",
          requete: `cartes${cle ? ` où moment = ${cle}` : ""}${seuil ? `, chiffre ${seuil[1]} ${seuil[2]}` : ""}`,
          note: sansValeur ? [`${sansValeur} cartes n'ont pas de chiffre : non comptées, ce qui ne veut pas dire zéro.`] : [], lien: { route: "#avantages", label: "Ouvrir les avantages" } };
      },

      table_parcours(row) {
        const phases = [...new Set(index.parcours.map(p => p.phase))];
        const st = new Set(row.mots.map(stem));
        const best = phases.map(ph => { let s = 0; for (const w of content(ph).map(stem)) if (st.has(w)) s++; return { ph, s }; }).sort((a, b) => b.s - a.s)[0];
        const items = best.s ? index.parcours.filter(p => p.phase === best.ph) : index.parcours;
        return { statut: "LISTE", titre: best.s ? best.ph : "Tout le parcours", liste: items.map(it => ({ t: it.t, ligne: it.line })), complet: { n: items.length, source: "le parcours du guide" }, requete: `parcours${best.s ? ` où phase = ${best.ph}` : ""}`, lien: { route: "#parcours", label: "Ouvrir le parcours" }, note: [] };
      },

      astuce(row, ctx) {
        const st = new Set(row.mots.filter(m => !/astuce|conseil/.test(m)).map(stem));
        const c = L.filter(l => l.k === "astuce").map(l => { let s = 0; for (const x of l.st) if (st.has(x)) s++; if (l.p === ctx.page?.id) s += 1; return { l, s }; }).sort((a, b) => b.s - a.s);
        if (!c[0].s) return null;
        return { statut: "REPONSE", lignes: c.slice(0, 2).map(x => vue(x.l)), sources: [source(c[0].l)], note: ["Retours d'expérience de personnes déjà installées. Ces conseils n'ont pas de valeur officielle : en cas d'enjeu, la source citée plus haut fait foi."], registre: "communaute" };
      },

      resume(row, ctx) {
        if (!ctx.page) return null;
        const ls = L.filter(l => l.p === ctx.page.id && (l.k === "retenir" || l.k === "chapo"));
        if (!ls.length) return null;
        return { statut: "REPONSE", titre: "Ce que le guide retient de cette page", lignes: ls.map(vue), sources: [source(ls[0])] };
      },

      valeur(row) {
        const v = (DECLARE.valeurs || []).find(x => x.quand.some(w => row.pq.includes(plain(w))));
        if (!v) return null;
        return { statut: "REPONSE", lignesLibres: [v.texte], annonce: { en_vigueur: v.en_vigueur, annonce: v.annonce }, sources: [{ page: v.source, section: "" }], note: ["Annoncé, pas en vigueur, selon le guide à sa date. Cela a pu changer depuis."], lien: { route: v.route, label: "Ouvrir le simulateur" } };
      },

      epargne_qa(row) {
        const st = new Set(row.mots.map(stem));
        let best = null, bs = 0;
        for (const e of index.entrees) {
          e.sts = e.sts || [e.question, ...e.variantes].map(t => new Set(content(t).map(stem)));
          for (const v of e.sts) {
            let n = 0; for (const x of st) if (v.has(x)) n++;
            const d = st.size + v.size ? 2 * n / (st.size + v.size) : 0;
            if (d > bs) { bs = d; best = e; }
          }
        }
        if (!best || bs < 0.45) return null;
        const ls = best.lignes.map(i => byId.get(i));
        return { statut: "REPONSE", titre: best.question, lignes: ls.slice(0, 3).map(vue), autour: ls.map(vue), sources: [source(ls[0])], nomodel: true, note: ["Réponse écrite à l'avance par l'auteur du guide. Aucun modèle ne lit cette section."] };
      },

      // B2: direct only if the concept and the shape match. False direct breaks trust.
      faq_cache(row) {
        const st = new Set(row.mots.map(stem));
        if (st.size < 2) return null;
        let best = null, bs = 0;
        for (const f of index.faq) {
          f.st = f.st || new Set(content(f.q).map(stem));
          let n = 0; for (const x of st) if (f.st.has(x)) n++;
          const dice = 2 * n / (st.size + f.st.size);
          if (dice > bs) { bs = dice; best = f; }
        }
        if (!best || bs < 0.72) return null;
        if (typeDe(plain(best.q), best.q) !== row.type) return null;
        const l0 = byId.get(best.lignes[0]);
        const r = ligneFAQ(l0, best);
        const full = best.opener_faux ? r.lignes : best.lignes.map(i => vue(byId.get(i)));
        return { statut: "REPONSE", lignes: full.slice(0, 3), sources: [source(byId.get(full[0].id))], faq: { id: best.id, dice: +bs.toFixed(2), remplace: !!r.remplace }, canal: "cache" };
      },

      async fiche_qa(row, ctx, T) {
        const modele = opt.modele || null;
        const f = chercher(row, ctx);
        T.push({ qui: "code", etape: "Détecteurs", detail: `${f.nb} lignes touchées · marge ${f.marge.toFixed(1)}`, json: { audit: f.audit } });
        if (!f.top.length && !(modele && opt.vecteurs)) return null;
        let c = f.top[0] || { s: 0, l: { nomodel: false, k: "" }, sc: { mots: new Set(), dico: 0 }, couverture: 0, vide: true };
        const clair = c.s >= MIN_SCORE && f.marge >= MIN_MARGE;
        // "How do I...": one passage is rarely the whole procedure. If the page is the right one, show what the guide keeps from it and open it.
        const parPage = () => {
          const id = c.l.p;
          if (row.type !== "procedure" || !id || !(id === f.pagePlan || row.concepts.some(x => (x.c.pages || []).includes(id)))) return null;
          const ls = L.filter(l => l.p === id && (l.k === "chapo" || l.k === "retenir")).slice(0, 4);
          if (!ls.length) return null;
          const p = pageById.get(id);
          T.push({ qui: "code", etape: "La fiche", detail: "une procédure : le passage seul ne suffit pas, la fiche répond" });
          return { statut: "REPONSE", titre: `${p.titre} : ce que le guide retient`, lignes: ls.map(vue), sources: [source(ls[0])], ailleurs: ctx.page && id !== ctx.page.id ? p.titre : null, lien: { route: p.route, label: `Ouvrir : ${p.titre}` } };
        };
        let arbitre = null;
        // The words must really land here. A zero on one of the reader's words is not ignored [7A:23].
        const motsAbsents = f.stems.filter(x => !inv.has(x));
        const assezFort = x => row.epingle ? x.s > 0
          : motsAbsents.length && x.couverture < 0.6 ? false
          : (x.sc.mots.size >= 2 && x.couverture >= 0.5) || ((x.sc.dico >= 1 || x.sc.dicoPage) && x.couverture >= 0.33) || (f.stems.length === 1 && x.couverture === 1);
        if (!assezFort(c) && !modele) { T.push({ qui: "code", etape: "Refus", detail: `meilleure ligne trop faible (couverture ${c.couverture.toFixed(2)}${motsAbsents.length ? ", mots absents : " + motsAbsents.join(", ") : ""})` }); return null; }
        const savingsDansMarge = f.top.slice(0, 4).some(x => x.l.nomodel && c.s - x.s < MIN_MARGE);
        if (!clair && savingsDansMarge && !c.l.nomodel) {
          const autre = f.top.find(x => x.l.nomodel);
          return { statut: "CLARIFIER", texte: "Je peux comprendre deux choses. Laquelle ?", champ: "lieu",
            options: [{ label: pageById.get(c.l.p)?.titre || c.l.p, envoie: `${row.original} (${pageById.get(c.l.p)?.titre})` }, { label: "Section épargne : " + autre.l.s, envoie: autre.l.s }] };
        }
        if ((c.vide || !clair || !assezFort(c)) && modele && !c.l.nomodel) {
          row.appels = (row.appels || 0) + 1;
          const glossaire = row.concepts.slice(0, 2).map(x => pageById.get((x.c.pages || [])[0])?.resume).filter(Boolean).join(" ");
          let cands = f.top.filter(x => !x.l.nomodel).slice(0, 5);
          if (opt.vecteurs && modele.embed) {
            const v = await modele.embed(row.corrigee || row.original);
            if (v) {
              const proches = parVecteur(v, 14).filter(i => !L[i].nomodel && COEF[L[i].k] !== 0 && !cands.some(x => x.l.g === L[i].g));
              const vus2 = new Set();
              for (const i of proches) { if (vus2.has(L[i].g) || cands.length >= 10) continue; vus2.add(L[i].g); cands.push(f.top.find(x => x.l.id === L[i].id) || { s: 0, l: L[i], sc: { mots: new Set(), dico: 0, vecteur: 1 }, couverture: 0 }); }
              T.push({ qui: "modèle", etape: "Vecteurs", detail: `${vus2.size} passages proches ajoutés au dossier` });
            }
          }
          if (!cands.length) return null;
          arbitre = await modele.arbitre(row, cands.map(x => ({ id: x.l.id, section: pageById.get(x.l.p)?.titre + " › " + x.l.s, methods: ["mots", "dico", "valeur", "titre", "page", "etiquette", "vecteur"].filter(k => k === "mots" ? x.sc.mots.size : x.sc[k]), snippet: autour(x.l).map(y => y.t).join(" ").slice(0, 320) })), glossaire);
          if (arbitre) {
            T.push({ qui: "modèle", etape: "Arbitre", detail: arbitre.raison || "", json: arbitre });
            const pick = arbitre.choix && cands.find(x => x.l.id === arbitre.choix);
            if (arbitre.conflit) {
              const prim = (arbitre.roles || []).filter(x => x.role === "primary").map(x => cands.find(y => y.l.id === x.id)).filter(Boolean);
              if (prim.length >= 2) {
                T.push({ qui: "modèle", appels: 0, etape: "Désaccord dans le guide", detail: "signalé par l'arbitre, à relire" });
                return { statut: "DEUX_CHOSES", lignes: prim.slice(0, 2).map(x => vue(x.l)), sources: prim.slice(0, 2).map(x => source(x.l)), parModele: true, note: ["Ce désaccord est signalé par le modèle, je ne l'ai pas déclaré après lecture."] };
              }
            }
            if (pick) {
              c = pick;
              // The arbiter ranked. A second model, which did not see the ranking, says whether this passage answers.
              const v = modele.verifier ? await modele.verifier(row, pageById.get(c.l.p)?.titre + " › " + c.l.s, autour(c.l).map(y => y.t).join(" ").slice(0, 700)) : null;
              if (v) T.push({ qui: "modèle", etape: "Vérification", detail: (v.repond ? "le passage répond : " : "le passage ne répond pas : ") + (v.raison || ""), json: v });
              if (v && !v.repond) {
                const fiche = parPage();
                if (fiche) return fiche;
                // A number was asked, the place was found, and it carries none: that is the guide's rule without its figure.
                const re = RE_TYPE[row.type];
                if ((row.type === "montant" || row.type === "duree") && !re.test(autour(c.l).map(y => plain(y.t)).join(" "))) {
                  T.push({ qui: "code", etape: "Sans chiffre", detail: "le passage choisi parle du sujet et ne donne pas ce chiffre" });
                  return composer(c, row, ctx, T, { clair: false, arbitre, audit: f.audit, st: f.stems });
                }
                row.proche = c.l; return null;
              }
            } else { T.push({ qui: "code", etape: "Arbitre écouté", detail: "aucun candidat ne répond" }); return null; }
          } else T.push({ qui: "modèle", etape: "Arbitre", detail: "pas de réponse dans le temps : meilleure ligne du code, signalée" });
        } else {
          T.push({ qui: clair ? "modèle" : "code", etape: clair ? "Modèle non appelé" : "Sans arbitre", detail: clair ? "marge claire" : "marge plate, pas de modèle disponible : meilleure ligne, non arbitrée" });
          // The margin is mine, not a proof. A clear winner still gets the second model's fresh read before it is called an answer.
          if (clair && modele && modele.verifier && opt.verifierTout !== false && !c.l.nomodel && !c.l.row) {
            const v = await modele.verifier(row, pageById.get(c.l.p)?.titre + " › " + c.l.s, autour(c.l).map(y => y.t).join(" ").slice(0, 700));
            if (v) T.push({ qui: "modèle", etape: "Vérification", detail: (v.repond ? "le passage répond : " : "le passage ne répond pas : ") + (v.raison || ""), json: v });
            if (v && !v.repond) { const fiche = parPage(); if (fiche) return fiche; row.proche = c.l; return null; }
          }
        }
        if (!assezFort(c) && !arbitre?.choix) { T.push({ qui: "code", etape: "Refus", detail: `meilleure ligne trop faible (couverture ${c.couverture.toFixed(2)})` }); return null; }
        return composer(c, row, ctx, T, { clair, arbitre, audit: f.audit, st: f.stems });
      },

      // B3: the words, the sweep, the nearest passage and why it does not answer.
      absence(row) {
        const parMot = {};
        const hits = new Map();
        for (const w of row.mots) {
          const s = stem(w);
          const ids = (inv.get(s) || []).filter(i => COEF[L[i].k] !== 0);
          parMot[w] = ids.length;
          for (const i of ids) hits.set(i, (hits.get(i) || 0) + 1);
        }
        const proche = [...hits.entries()].sort((a, b) => b[1] - a[1])[0];
        const ensemble = proche && proche[1] >= 2;
        const nearest = row.proche || (proche ? L[proche[0]] : null);
        const trouves = Object.entries(parMot).filter(([, n]) => n);
        const zero = Object.entries(parMot).filter(([, n]) => !n).map(([w]) => w);
        return { statut: "RIEN", mots: Object.keys(parMot), zero, parMot,
          force: zero.length === Object.keys(parMot).length ? "forte" : ensemble ? "faible" : "moyenne",
          couverture: { lignes: L.length, pages: index.pages.length, sans: "lignes de transport, écoles et aires de jeux" },
          proche: nearest ? { ...vue(nearest), source: source(nearest), pourquoi: row.procheRaison || (row.proche ? "la vérification dit que ce passage ne répond pas à la question." : null) || ensemble ? "ce passage touche à certains de ces mots mais ne répond pas à la question." : `il ne contient que « ${trouves.map(x => x[0]).filter(w => nearest.st.has(stem(w))).join(", ")} ».` } : null,
          texte: "Je n'ai rien trouvé sous ces mots. Cela ne prouve pas que le guide n'en parle pas, ni que cela n'existe pas : essayez d'autres mots." };
      },
    };

    // Brick 4: one chosen line becomes a typed answer. The sentence is the guide's; code adds the type and the label.
    async function composer(c, row, ctx, T, { clair, arbitre, audit, st }) {
      const modele = opt.modele || null;
      let lignes = ["pays", "coche"].includes(c.l.k) ? autour(c.l).slice(0, 8) : [vue(c.l)];
      // A FAQ line can be a bare "Oui.": it is shown with what follows it, and a flagged opener never alone (D21).
      const fq = c.l.k === "faq" && index.faq.find(x => x.lignes.includes(c.l.id));
      if (fq) lignes = fq.opener_faux ? ligneFAQ(c.l, fq).lignes : fq.lignes.slice(0, 3).map(i => vue(byId.get(i)));
      const typeRe = RE_TYPE[row.type];
      let manque = null;
      if (typeRe && !typeRe.test(c.l.plain)) {
        // D27: a number was asked. Is it on another line of this place, or of this page on the same words?
        const voisine = c.l.row ? null : L.filter(x => x.g === c.l.g && typeRe.test(x.plain))[0] || (c.l.p === "faq" ? null : L.filter(x => x.p === c.l.p && COEF[x.k] !== 0 && typeRe.test(x.plain) && (st || []).filter(s => !MOTS_DE_TYPE.has(s) && x.st.has(s)).length >= 2)[0]);
        if (voisine) lignes.unshift(vue(voisine));
        else if (row.type === "montant") manque = "NE_CHIFFRE_PAS";
        else if (row.type === "duree") manque = "NE_DATE_PAS";
      }
      if (row.type === "definition" || row.type === "procedure") {
        for (const x of autour(c.l)) if (!lignes.some(y => y.id === x.id) && lignes.length < 3) lignes.push(x);
      }
      // D25: for a yes/no, a label only if two separate reads agree. Never on a savings line.
      let label = null, conditions = null;
      if (row.type === "booleen" && modele && !c.l.nomodel && (row.appels || 0) <= 1) {
        const contexte = autour(c.l).slice(0, 6).map(y => ({ id: y.id, t: y.t }));
        const a = await modele.lire(row, contexte);
        const b = a && a.label !== "inconnu" ? await modele.relire(row, contexte) : null;
        T.push({ qui: "modèle", appels: (a ? 1 : 0) + (b ? 1 : 0), etape: "Lecture oui/non", detail: a ? `première lecture : ${a.label}${b ? ", seconde lecture : " + b.label : ""}` : "pas de réponse", json: { a, b } });
        if (a && b && a.label === b.label) { label = a.label; conditions = (a.conditions || []).filter(id => contexte.some(y => y.id === id)); }
        else if (a && b) T.push({ qui: "code", etape: "Désaccord", detail: "pas d'étiquette, la règle seule" });
      }
      return { label, conditions, statut: manque ? "NE_CHIFFRE_PAS" : "REPONSE", lignes, autour: autour(c.l), sources: [source(c.l)],
        ailleurs: ctx.page && c.l.p !== ctx.page.id ? pageById.get(c.l.p)?.titre : null, nomodel: !!c.l.nomodel, audit, clair, nonArbitre: !clair && !arbitre };
    }

    // D26: the validator, on what is about to be shown.
    function verifier(r) {
      const pb = [];
      for (const l of r.lignes || []) if (!byId.has(l.id)) pb.push(`ligne inconnue ${l.id}`);
      if (r.statut === "REPONSE" && !(r.lignes?.length || r.lignesLibres?.length)) pb.push("réponse sans ligne");
      if (r.statut === "DEUX_CHOSES" && r.lignes?.length !== 2) pb.push("conflit sans deux lignes");
      return pb;
    }

    return { H, verifConflit, verifCondition, verifier, trouve };
  };
})();
