---
"@ifc-lite/mutations": patch
---

`MutablePropertyView.setProperty` no longer records a mutation when the write changes nothing.

The overlay is updated either way — only the history entry is skipped, and the mutation is still returned so callers reading it as "the write was accepted" are unaffected. A re-type or a unit change on the same value still counts as a change, since both alter what the export produces.

Without this, any caller that re-asserts a derived value on a timer grows the mutation log without bound. That is not hypothetical: a rule keeping an identifier current wrote the same value half a million times, and the autosave snapshot carrying that journal eventually exceeded what IndexedDB would store.
