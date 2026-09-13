# Surgical changes

Touch only what the request asks for. Source: [karpathy-guidelines](https://github.com/multica-ai/andrej-karpathy-skills).

- Unrelated dead code: mention it, don't delete it.
- Orphans: remove imports / variables / functions that *your* changes made unused. Don't remove pre-existing dead code unless asked.
- When multiple interpretations of the request exist, present them and ask before editing (see *Clarify before acting* in CLAUDE.md).
- When your change makes an existing comment, doc statement, or manually-duplicated value false, updating it IS in scope — a comment that now lies about the code is a defect your change introduced, not adjacent improvement.

The test: every changed line should trace directly to the user's request.
