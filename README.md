# Assistant du guide

A chatbot for a newcomers' guide to living in Luxembourg. It knows the page you are reading, answers with the guide's own sentence, opens the right page and highlights the passage. Under each answer it shows how it got there.

**Try it:** [the guide with its assistant](https://sfhajji.github.io/guide-assistant/) · [nine questions to try in one click](https://sfhajji.github.io/guide-assistant/essais/) · [the machinery, live](https://sfhajji.github.io/guide-assistant/machine/)

> The model understands the question. The guide gives the answer. The code calculates and decides.

The model never writes the answer's sentence. It only writes search terms, the reason for a choice, and reformulations when a question has several meanings. All of these are marked as model output in the trace.

## The four bricks

| Brick | Job | When it runs | Code or model | File |
|---|---|---|---|---|
| 1. Document parsing | Turn the guide into tables | Once, at build time | Code only | [`build/index.mjs`](build/index.mjs) |
| 2. Question parsing | Turn the question into a row | Every question | Code; model only behind a gate | [`question.js`](src/assistant/question.js) |
| 3. Retrieval as a filter | Pick the route, then the passage | Every question | Code picks; models rank and check | [`decide.js`](src/assistant/decide.js), [`recherche.js`](src/assistant/recherche.js) |
| 4. Generation | Build a typed answer from the guide's own lines | Every question | Code; model only for a yes/no label | [`reponse.js`](src/assistant/reponse.js) |

[`moteur.js`](src/assistant/moteur.js) wires them together in about 150 lines. [`texte.js`](src/assistant/texte.js) holds the shared text helpers.

### 1. Document parsing

The guide is read once and becomes tables. Everything after this step works on those tables.

- The guide's JavaScript data files are read as syntax trees with acorn. Nothing from the guide is executed. Its HTML panels are read with cheerio.
- Each line is a sentence, a list item or a table row, with its section, content type, register (guide, community or demo) and parsing method.
- Each line also has an address on the page: route, clicks and selector. That address is what makes highlighting possible. CI opens the addresses in a real browser: 1,336 of 1,354 are found (98.7%).
- Data the guide already holds as rows stays as rows: insurance claims by contract, benefit cards, and 48 figures for each of 100 communes.

| Table (CSV) | One row per | Rows |
|---|---|---|
| [`pages`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/pages.csv) | Page | 53 |
| [`plan`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/plan.csv) | Heading in the outline | 143 |
| [`lignes`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/lignes.csv) | Line of text | 1,464 |
| [`rangees`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/rangees.csv) | Table row, with its column names | 24 |
| [`faq`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/faq.csv) | Frequent question | 55 |
| [`parcours`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/parcours.csv) | Step of the newcomer's journey | 37 |
| [`renvois`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/renvois.csv) | Cross-reference | 119 |
| [`communes`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/communes.csv) | Commune | 100 |

See it: the [Parsing tab](https://sfhajji.github.io/guide-assistant/machine/#parsing) shows a page next to its lines.

### 2. Question parsing

The question becomes a row with named fields, visible as JSON in the trace.

- **Spelling:** corrected against the guide's own vocabulary, plus a small map of texting abbreviations. A correction never crosses the first letter, so the reader's word is not lost.
- **Concepts:** found with a dictionary that combines the guide author's tags and added synonyms ([`dico.js`](src/assistant/dico.js)).
- **The open page:** when a question points at it ("ça coûte combien ?", "c'est gratuit ?", "ici"), the page becomes the first scope, not just a boost.
- **Several questions at once:** split only when each part has its own subject. The patterns are independent, unified, stated condition, and "and if yes".
- **Unclear questions:** a word with several meanings gets one clarifying question, unless the open page already settles it. A follow-up inherits from the previous row.
- **Model:** the `parse` call runs only if no concept was found, a word is unknown to the guide, or the question has six words or more. Questions that the first rules already route never reach it.

### 3. Retrieval as a filter

Retrieval removes what cannot answer. It is not a similarity search over everything.

**One function picks the route.** `decide()` in [`decide.js`](src/assistant/decide.js) applies 26 readable rules, and each answer shows the rules it went through. Emergencies and personal data are caught here, before any model call. Questions about structured data go straight to that data:

| Question | Route |
|---|---|
| "ça coûte combien ?" with a page open | The lines of that page, and it asks back if the page has no answer |
| A gross salary amount | The guide's own simulator. A net figure stops it, and a figure with no period is asked back |
| "Which tax class?" | The guide's decision tree |
| "Am I covered?" | Table of 13 claims across 4 anonymised contracts |
| A commune and a figure, or a ranking | The commune table, queried by code. The citation is the query |
| Lists or thresholds on benefits | Table of 28 cards |
| "What do I do, and when?" | Journey steps |
| A subject and nothing else ("crèches") | That subject's page: what the guide keeps from it |
| Same form as a frequent question | FAQ, used as a cache |
| Savings and pensions | Read by code only, as the guide promises |
| Everything else | The guide's lines |

**On the lines, code filters first.** The outline picks the most likely page from its title, tags and headings. Parallel detectors then score each line: words, dictionary, type of value, title, row label and current page. The trace groups the result by section.

**The models come in to rank and to check.** With a clear winner there is no ranking. Otherwise:

1. Line vectors (`text-embedding-3-small`, 256 dimensions) add nearby passages to the shortlist.
2. `arbitre` (`gpt-4.1-mini`) ranks up to 10 candidates and gives its reason.

In both cases `verifier` (`gpt-5-mini`), which does not see the ranking, says whether the chosen passage answers. If it does not:

- a how-to question opens the right page instead, because one passage is rarely a whole procedure;
- a number the passage does not carry becomes "the guide does not give this figure";
- anything else is "not found", with that passage shown as the nearest.

See it: the [Aiguillage tab](https://sfhajji.github.io/guide-assistant/machine/#aiguillage) lists the rules and the model calls.

### 4. Generation

Every answer has a type, and code assembles it. The sentence shown is fetched from the guide by its line id.

- **Types:** RÉPONSE, CALCUL, LISTE, LE GUIDE DIT DEUX CHOSES, JE N'AI PAS TROUVÉ, LE GUIDE NE LE CHIFFRE PAS, OUTIL DU GUIDE, CE QUE DISENT QUATRE CONTRATS, HORS DU GUIDE, JE NE RÉPONDS PAS À CELA, DONNÉE PERSONNELLE and 112.
- **Citation:** "Voir sur la page" opens the page and highlights the passage with the CSS Custom Highlight API, using the line's address.
- **Yes or no:** the label appears only if two separate reads by two models agree. Otherwise the guide's rule stands alone.
- **Conflicts:** places where the guide says two things are declared in [`declare.js`](src/assistant/declare.js) and shown side by side.
- **Nothing found:** after a sweep of all the lines, the answer shows the words searched and what was covered. It never claims the guide is silent, only that nothing was found under those words.
- **Last check:** before display, code checks that every line exists, that an answer has a line and that a conflict has two.
- **Trace:** under each answer, every step is marked code or model, with its JSON and the number of model calls. A count of 0 says why.

[`assistant.js`](src/assistant/assistant.js) draws the cards and the highlight. [`proxy/server.mjs`](proxy/server.mjs) holds every prompt and schema.

## What it measures

80 new questions, written by an AI that saw neither the engine nor its rules, working only from the guide's tables, and read only after measuring ([`eval/frais.jsonl`](eval/frais.jsonl)). The code was frozen first. Each row switches a piece off or replaces the system.

| Version | Right | Wrong and confident | Says not found |
|---|---|---|---|
| **Full assistant** | **58 (73%)** | **13 (16%)** | **9 (11%)** |
| No model | 40 (50%) | 17 (21%) | 23 (29%) |
| No model, no dictionary | 35 (44%) | 19 (24%) | 26 (33%) |
| No model, no current page | 38 (48%) | 19 (24%) | 23 (29%) |
| Plain keywords, first line | 13 (16%) | 67 (84%) | 0 |

- When the guide has the answer: 39 of 58 right. When it should not answer: 19 of 22 correct refusals.
- Questions that point at the open page are the weak spot: 5 of 10 right, 3 wrong.
- These questions are direct. On 199 harder questions, full of traps and already read, the same version gets 66 right (33%), 37 wrong (19%), 83 not found and 13 sent to a tool ([`eval/sealed.jsonl`](eval/sealed.jsonl)). Real readers are probably somewhere between the two, but no real reader has been measured.
- Reading the 13 wrong answers afterwards found real bugs, such as "pas européen" being read as European. They are fixed, and those fixes are not counted in these numbers.
- Model use: 2.17 calls per question, median time 1.9 s, 90th percentile 2.9 s.

Details by question type are in the [Mesures tab](https://sfhajji.github.io/guide-assistant/machine/#mesures), and known limits in the [Limites tab](https://sfhajji.github.io/guide-assistant/machine/#limites).

## How it runs

- **Site:** static, on GitHub Pages. The whole engine runs in the browser.
- **Model service:** [`proxy/server.mjs`](proxy/server.mjs), on Azure Container Apps. It holds the API key and accepts only this site's origin. Each visitor can make 300 calls a minute, far more than a person can type. Past that limit, or if a call fails, the code's answer stands and the trace says so, so a reader is never blocked.
- **Checks:** [`tests/`](tests/) for code, [`checks/browser.mjs`](checks/browser.mjs) for real browser journeys, [`checks/live.mjs`](checks/live.mjs) for the published address, [`eval/`](eval/) and [`checks/mesures.mjs`](checks/mesures.mjs) for scoring.
- **Guide content:** it is not in this repository and belongs to its author. CI fetches its public repository at a pinned commit, leaves out what must not be republished, applies the small patch in [`build/assemble.mjs`](build/assemble.mjs), adds the assistant and publishes.
