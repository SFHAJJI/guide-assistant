# Assistant du guide

A chatbot for a newcomers' guide. It knows the page you are reading, answers with the guide's own sentence, opens the right page and highlights the passage. Under each answer it shows how it got there.

The guide itself is not in this repository. CI fetches its public repository at a pinned commit, leaves out what must not be republished, applies the small patch in `build/assemble.mjs`, adds the assistant and publishes. Guide content belongs to its author.
