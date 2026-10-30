# Expert: architecture

Selected for a new system, a rewrite, an integration, or 8 or more files.

- Draw the layers once (UI → service → data) and keep calls one way; name the one module that talks to each external system.
- Reuse what exists. A new layer, framework or dependency needs a one-line reason and is a stop-and-ask item in a build.
- Name every integration point with its failure mode and what the user sees when it fails.
- Schema or contract changes come with a migration path and a way back.
- Decisions: one line each, with the reason and the option not taken.
- Keep it migration-ready: no logic in the data layer, no vendor calls outside their adapter.
- Review: check the diff keeps the layers and adds no hidden coupling (globals, cross-layer imports).
