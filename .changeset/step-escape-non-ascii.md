---
"@ifc-lite/encoding": minor
"@ifc-lite/data": patch
"@ifc-lite/export": patch
"@ifc-lite/parser": patch
---

Encode non-ASCII characters when writing STEP string literals.

ISO-10303-21 string literals are ASCII-only, but both STEP escapers passed
anything outside that range through unchanged, so an authored name or property
value like `Löschung` or `Automation Primäranlagen` — and any umlaut arriving
via CSV import — landed in the exported `.ifc` as raw UTF-8 bytes rather than a
conforming literal. Both escapers (`@ifc-lite/data`'s private one behind
`serializeValue`/`generateHeader`, and `@ifc-lite/export`'s exported
`escapeStepString`) now route through `encodeIfcString`, emitting `\X\F6`,
`\X2\03A9\X0\` and `\X4\0001F600\X0\`.

`encodeIfcString` escapes the literal backslash itself (`\` -> `\X\5C`), so the
old `\` -> `\\` doubling is gone — keeping it would have double-escaped. One
visible consequence: a literal backslash is now written `\X\5C` instead of the
`\\` pair. Both read back as a single backslash, and the write/read round trip
stays byte-stable. Control characters are still collapsed to a space so a value
can never split a STEP record across two physical lines, and `''` quote doubling
is unchanged.

`@ifc-lite/data`'s `parseStepValue` used to unescape only `''` and `\\`, which
would no longer have inverted its own serializer. It now shares the canonical
reader with `parseSourceHeader`, newly exported from `@ifc-lite/encoding` as
`decodeStepStringLiteral` (moved out of `@ifc-lite/parser`, where it was
private): it collapses `''`, resolves `\X\`, `\X2\`, `\X4\`, `\S\` and `\Px\`,
and handles the `\\` pair third-party writers emit, giving directive spans
precedence so a directive followed by an escaped backslash still decodes.
`@ifc-lite/data` gains a dependency on `@ifc-lite/encoding`.
