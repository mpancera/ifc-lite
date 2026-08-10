---
"@ifc-lite/project": minor
---

An opener handshake for telling a newly opened window which project it is in.

When an application opens this one with a file rather than a folder, there is no folder to read an identity from and the opening window is the only thing that knows. `PROJECT_HELLO` / `PROJECT_OFFER` carry it back over `postMessage`.

Deliberately not a URL parameter: a link is settable by anyone, so a planted key would make an application treat a stranger's session as an existing project — with its height system, its zones, its lists. That is the inheritance a project key exists to prevent, handed in through the address bar.

`mayAcceptOffer` holds the four conditions that make the message channel different, in one testable place: same origin, from the opener itself (origin alone would let any same-origin window post), the first offer only (a window that changes project mid-session is the boundary crossing being caught), and only when an opener exists at all. `parseProjectOffer` puts the project through the same validation as one read off disk.
