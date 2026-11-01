# Assistant du guide

A chatbot for a newcomers' guide to living in Luxembourg. It knows the page you are reading, answers with the guide's own sentence, opens the right page and highlights the passage. Under each answer it shows how it got there.

**Try it:** [the guide with its assistant](https://sfhajji.github.io/guide-assistant/) · [nine questions to try in one click](https://sfhajji.github.io/guide-assistant/essais/) · [the machinery, live](https://sfhajji.github.io/guide-assistant/machine/)

> The model understands the question. The guide gives the answer. The code calculates and decides.

The model never writes the answer's sentence. It only writes search terms, the reason for a choice, and reformulations when a question has several meanings. All of these are marked as model output in the trace.

## The four bricks

| Brick | Job | When it runs | Code or model |
|---|---|---|---|
| 1. Document parsing | Turn the guide into tables | Once, at build time | Code only |
| 2. Question parsing | Turn the question into a row | Every question | Code; model only behind a gate |
| 3. Retrieval as a filter | Pick the route, then the passage | Every question | Code; model only when the code hesitates |
| 4. Generation | Build a typed answer from the guide's own lines | Every question | Code; model only for a yes/no label |

### 1. Document parsing

The guide is read once and becomes tables. Everything after this step works on those tables.

- The guide's JavaScript data files are read as syntax trees with acorn. Nothing from the guide is executed. Its HTML panels are read with cheerio.
- Each line is a sentence, a list item or a table row, with its section, content type, register (guide, community or demo) and parsing method.
- Each line also has an address on the page: route, clicks and selector. That address is what makes highlighting possible. CI opens the addresses in a real browser: 1,336 of 1,354 are found (98.7%).
- Data the guide already holds as rows stays as rows, such as insurance claims by contract and benefit cards.

| Table (CSV) | One row per | Rows |
|---|---|---|
| [`pages`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/pages.csv) | Page | 53 |
| [`plan`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/plan.csv) | Heading in the outline | 143 |
| [`lignes`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/lignes.csv) | Line of text | 1,464 |
| [`rangees`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/rangees.csv) | Table row, with its column names | 24 |
| [`faq`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/faq.csv) | Frequent question | 55 |
| [`parcours`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/parcours.csv) | Step of the newcomer's journey | 37 |
| [`renvois`](https://sfhajji.github.io/guide-assistant/guide/assistant/tables/renvois.csv) | Cross-reference | 119 |

Code: [`build/lit.mjs`](build/lit.mjs), [`build/index.mjs`](build/index.mjs). See it: the [Parsing tab](https://sfhajji.github.io/guide-assistant/machine/#parsing) shows a page next to its lines.

### 2. Question parsing

The question becomes a row with named fields, visible as JSON in the trace.

- **Spelling:** corrected against the guide's own vocabulary, plus a small map of texting abbreviations.
- **Concepts:** found with a dictionary that combines the guide author's tags and added synonyms ([`dico.js`](src/assistant/dico.js)).
- **Several questions at once:** split only when each part has its own subject. The patterns are independent, unified, stated condition, and "and if yes".
- **Unclear questions:** a word with several meanings gets one clarifying question. A follow-up inherits from the previous row.
- **Model:** the `parse` call runs only if no concept was found, a word is unknown to the guide, or the question has six words or more. Questions that the first rules already route never reach it.

### 3. Retrieval as a filter

Retrieval removes what cannot answer. It is not a similarity search over everything.

**One function picks the route.** `decide()` in [`moteur.js`](src/assistant/moteur.js) applies 23 readable rules, and each answer shows the rules it went through. Emergencies and personal data are caught here, before any model call. Questions about structured data go straight to that data:

| Question | Route |
|---|---|
| A salary amount | The guide's own simulator |
| "Which tax class?" | The guide's decision tree |
| "Am I covered?" | Table of 13 claims across 4 anonymised contracts |
| Lists or thresholds on benefits | Table of 28 cards |
| "What do I do, and when?" | Journey steps |
| Same form as a frequent question | FAQ, used as a cache |
| Savings and pensions | Read by code only, as the guide promises |
| Everything else | The guide's lines |

**On the lines, code filters first.** Parallel detectors score each line: words, dictionary, type of value, title, row label and current page. The trace groups the result by section.

**The model comes in only when the code hesitates.** With a clear winner there is no model call. Otherwise:

1. Line vectors (`text-embedding-3-small`, 256 dimensions) add nearby passages to the shortlist.
2. `arbitre` (`gpt-4.1-mini`) ranks up to 10 candidates and gives its reason.
3. `verifier` (`gpt-5-mini`), which does not see the ranking, says whether the chosen passage answers. If it does not, the assistant says it found nothing.

See it: the [Aiguillage tab](https://sfhajji.github.io/guide-assistant/machine/#aiguillage) lists the rules and the model calls.

### 4. Generation

Every answer has a type, and code assembles it. The sentence shown is fetched from the guide by its line id.

- **Types:** RÉPONSE, CALCUL, LISTE, LE GUIDE DIT DEUX CHOSES, RIEN DANS LE GUIDE SOUS CES MOTS, LE GUIDE NE LE CHIFFRE PAS, OUTIL DU GUIDE, CE QUE DISENT QUATRE CONTRATS, HORS DU GUIDE, JE NE RÉPONDS PAS À CELA, DONNÉE PERSONNELLE and 112.
- **Citation:** "Voir sur la page" opens the page and highlights the passage with the CSS Custom Highlight API, using the line's address.
- **Yes or no:** the label appears only if two separate reads by two models agree. Otherwise the guide's rule stands alone.
- **Conflicts:** places where the guide says two things are declared in [`declare.js`](src/assistant/declare.js) and shown side by side.
- **Nothing found:** after a sweep of all the lines, the answer shows the words searched and what was covered, without concluding that the thing does not exist.
- **Last check:** before display, code checks that every line exists, that an answer has a line and that a conflict has two.
- **Trace:** under each answer, every step is marked code or model, with its JSON and the number of model calls. A count of 0 says why.

Code: [`assistant.js`](src/assistant/assistant.js) for cards and highlighting, [`proxy/server.mjs`](proxy/server.mjs) for every prompt and schema.

## What it measures

199 questions were set aside before tuning and read only after measuring ([`eval/sealed.jsonl`](eval/sealed.jsonl)). Each row switches a piece off or replaces the system.

| Version | Right | Wrong and confident | Says not found | Sends to a tool it does not read |
|---|---|---|---|---|
| **Full assistant** | **62 (31%)** | **35 (18%)** | **86 (43%)** | **16 (8%)** |
| No model | 45 | 49 | 89 | 16 |
| No model, no dictionary | 48 | 45 | 106 | 0 |
| No model, no current page | 41 | 52 | 90 | 16 |
| Plain keywords, first line | 15 (8%) | 184 (92%) | 0 | 0 |

- 31% right is low. Many of these questions are about maps and transport lines, which the assistant does not read yet.
- Rereading the 35 wrong answers afterwards showed 6 were not real errors. They stay in the count.
- That reread also found bugs, which were fixed after this measure and are not counted in these numbers.
- Model use: 1.49 calls per question, median time 1.8 s, 90th percentile 3.2 s.

The set has now been read, so a new run on it no longer counts as unseen. Details by question type are in the [Mesures tab](https://sfhajji.github.io/guide-assistant/machine/#mesures), and known limits in the [Limites tab](https://sfhajji.github.io/guide-assistant/machine/#limites).

## How it runs

- **Site:** static, on GitHub Pages. The whole engine runs in the browser.
- **Model service:** [`proxy/server.mjs`](proxy/server.mjs), on Azure Container Apps. It holds the API key, accepts only this site's origin and has a daily cap. If a call fails, the code's answer stands and the trace says so.
- **Checks:** [`tests/`](tests/) for code, [`checks/browser.mjs`](checks/browser.mjs) for real browser journeys, [`checks/live.mjs`](checks/live.mjs) for the published address, [`eval/`](eval/) and [`checks/mesures.mjs`](checks/mesures.mjs) for scoring.
- **Guide content:** it is not in this repository and belongs to its author. CI fetches its public repository at a pinned commit, leaves out what must not be republished, applies the small patch in [`build/assemble.mjs`](build/assemble.mjs), adds the assistant and publishes.
