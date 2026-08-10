---
"@ifc-lite/parser": minor
---

Always surface `IfcSite.RefLatitude` / `RefLongitude` / `RefElevation` as `GeoreferenceInfo.siteReference` (new exported type `SiteReferenceLocation`). These angles were previously read only on the legacy-site fallback path, i.e. only for models that carry no `IfcMapConversion` at all — so for every model that does have one, the file's second statement about where it stands was parsed and discarded. Having both lets consumers compare them: a model whose coordinate operation and site location disagree by hundreds of kilometres is contradicting itself, which is the signature of an authoring tool that wrote a coordinate operation while its default site location was never touched.
