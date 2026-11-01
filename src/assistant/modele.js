// The three model calls, each with its own timeout. Any failure returns null and the code answer stands.
(function () {
  const URL_PROXY = "https://ca-guide-assistant.whitemushroom-ff26ef2a.francecentral.azurecontainerapps.io";
  const DELAI = { juger: 40000, parse: 15000, arbitre: 15000, lire: 15000, relire: 25000, traduire: 8000 };
  const journal = [];
  async function appel(nom, corps) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), DELAI[nom]);
    try {
      const r = await (window.fetchModele || fetch)(`${URL_PROXY}/${nom}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps), signal: c.signal });
      if (!r.ok) return null;
      const j = await r.json();
      journal.push({ nom, ...j._meta });
      return { ...j.sortie, _meta: j._meta };
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  window.ASSISTANT_MODELE = {
    nom: "gpt-4.1-mini",
    journal,
    parse: (row, concepts, page) => appel("parse", { question: row.original, concepts, page }),
    arbitre: (row, candidats, glossaire) => appel("arbitre", { question: row.original, candidats, glossaire }),
    lire: (row, lignes) => appel("lire", { question: row.original, lignes }),
    relire: (row, lignes) => appel("relire", { question: row.original, lignes }),
    traduire: (texte, langue) => appel("traduire", { texte, langue }),
    juger: (question, attendu, montre) => appel("juger", { question, attendu, montre }),
    async embed(texte) {
      try {
        const r = await (window.fetchModele || fetch)(`${URL_PROXY}/embed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ textes: [texte] }) });
        if (!r.ok) return null;
        return (await r.json()).vecteurs[0];
      } catch (e) { return null; }
    },
  };
})();
