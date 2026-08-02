---
"@ifc-lite/lens": minor
---

`evaluateAutoColorLens` accepts an optional series palette.

Auto-colour assigned colours from a generated golden-angle sequence with no way to influence it, so a deployment that follows its own design system could not make Lens agree with the rest of its charts. The new third argument supplies series colours in order; omitted, behaviour is unchanged.

A supplied palette takes over for as many distinct values as it covers and the generated sequence continues beyond it, so a finite brand palette never caps how many values a lens can show and never repeats a colour that is already taken.
