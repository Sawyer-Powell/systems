---
name: jj
description: Use Jujutsu (`jj`) rather than standalone Git for version-control operations. Load when checking status, reviewing changes, managing changes or bookmarks, pushing, or undoing work.
---

# Jujutsu

- Use `jj status`, `jj diff`, `jj log`, and `jj show` to inspect work.
- The working-copy change updates automatically; do not use `jj commit`.
- Use `jj describe -m "message"` to name the current change.
- Use `jj new` to start a new change and `jj bookmark` to manage bookmarks.
- Use `jj undo` to undo the last operation and `jj git push` to publish changes.
- Never run standalone `git`; `jj git ...` is allowed for remote transport.
