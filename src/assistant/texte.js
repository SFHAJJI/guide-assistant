// Shared text helpers: normalising, stop words, stems, and what a value of each type looks like.
(function () {
  const plain = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").replace(/œ/g, "oe");
  const STOP = new Set(("a au aux avec ce ces cet cette c ca cela dans de des du d elle elles en est et eu il ils j je l la le les leur leurs lui m ma mais me mes moi mon n ne ni nos notre nous on ou par pas pour qu que qui quoi s sa se ses si son sont sur t ta te tes toi ton tu un une vos votre vous y " +
    "suis es sommes etes etre ai as avons avez ont avoir fait faire faut peut puis-je peux dois doit quel quelle quels quelles comment combien pourquoi quand ou est-ce esque bonjour merci svp stp alors donc aussi plus moins tres bien ici ceci " +
    "the is are what how much many do does can i my to of for in on and or if at it be have has need when where which who").split(" "));
  const stem = t => {
    if (/^\d/.test(t)) return t;
    let s = t;
    if (s.length > 6) s = s.replace(/ations?$/, "");
    if (s.length > 5) s = s.replace(/(ent|ez|er|es|e|s|x)$/, "");
    else if (s.length > 4) s = s.replace(/[sxe]$/, "");
    return s;
  };
  const words = s => plain(s).replace(/[^a-z0-9%€'\- ]/g, " ").split(/[\s']+/).filter(Boolean);
  const content = s => words(s).filter(w => !STOP.has(w) && (w.length > 1 || /\d/.test(w)));

  const RE_TYPE = {
    montant: /\d[\d\s.,]*\s*(€|eur\b|euros?\b)|\d+(,\d+)?\s*%|\bgratuit|\bsans suppl|\b(un|deux|trois) mois\b/i,
    duree: /\b(\d+|un|une|[a-z-]*(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante)[a-z-]*)\s+(jours?|mois|ans?|annees?|semaines?|heures?)\b/,
    date: /\b(\d{1,2}(er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)|\d{4})\b/,
    definition: /\b(appele\w*|designe\w*|signifie\w*|correspond\w*|c'est|est un|est une|sert a|permet de)\b/,
  };

  const MOTS_DE_TYPE = new Set(["cout", "prix", "montant", "tarif", "combien", "delai", "date", "duree", "frai", "poste"].map(stem));
  const DEMONYMES = { allemand: "allemagne", allemande: "allemagne", francais: "france", francaise: "france", belge: "belgique" };

  window.Texte = { plain, stem, words, content, STOP, RE_TYPE, MOTS_DE_TYPE, DEMONYMES };
})();
