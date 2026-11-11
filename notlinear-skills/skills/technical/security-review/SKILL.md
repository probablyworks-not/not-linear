---
name: security-review
description: Threat-model a change: injection, authz, secrets, data exposure.
layer: technical
when_to_use: Threat-model a change: injection, authz, secrets, data exposure.
keywords: [security, review, threat, model, change, injection, authz, secrets]
---

# Security Review

Threat-model a change before it ships, from an adversarial rather than a functional-correctness mindset.

## How to execute

- Check for injection vectors (SQL, command, template) anywhere user input reaches an interpreter.
- Check authorization, not just authentication — can an authenticated user reach data/actions they shouldn't.
- Check for secrets in logs, URLs, or client-exposed code.
- Check what happens to the data at rest and in transit — is anything sensitive exposed unnecessarily.
- Pairs with `red-team` for an adversarial pass once the above checklist is done.

## Output

Findings ranked by severity and exploitability, each with a concrete fix, not just "this could be a risk."
