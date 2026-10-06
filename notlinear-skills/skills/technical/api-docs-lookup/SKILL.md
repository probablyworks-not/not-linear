---
name: api-docs-lookup
description: Pull current library/framework documentation so answers aren't based on stale training data.
layer: technical
tools: [context7_get_docs]
when_to_use: Pull current library/framework documentation so answers aren't based on stale training data.
keywords: [docs, lookup, pull, current, library, framework, documentation, answers]
---

# API/Docs Lookup

Pull current documentation rather than relying on potentially stale training-data knowledge of a fast-moving API.

## How to execute

- For any library/framework API call, especially a fast-moving one, look up current docs before asserting a method signature or default behavior.
- Note the version the docs apply to when it's relevant — APIs change between major versions.
- If current docs aren't available, say explicitly that the answer is based on general/possibly-stale knowledge rather than presenting it as verified-current.
