---
"@ifc-lite/project": minor
---

Read a project's identity out of the folder it lives in.

A folder is the one thing two applications working on the same project both hold, so it is also where they can agree on what the project IS — no message passing, no service between them, and it still works when only one of the two is running.

`readProjectDescriptor` looks for a descriptor in `dc/project.json`, falling back to `dc.project.json` at the root for folders written before the subdirectory existed. `parseProjectDescriptor` validates it: the file is written by another program and editable by a person, so adopting whatever it says would let a damaged descriptor put two different projects under one key.

`isValidProjectKey` rejects, among others, keys carrying the derived-key prefix — that prefix is how an application tells somebody its project boundary is the weaker, model-derived kind, and a stored key wearing it would explain a guarantee it does not have.
