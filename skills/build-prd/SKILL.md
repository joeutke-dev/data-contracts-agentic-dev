---
name: build-prd
description: Write a PRD (PRD.md) for a data product from its contract.yml plus the requirements notes. Every requirement traces to a contract key and has an acceptance test. Use when someone asks for a PRD, requirements doc, build plan or UAT checklist for a contracted table.
---

# Build a PRD

The contract is the machine-readable promise. The PRD is the same promise for people: stakeholders sign off on it
and UAT runs from it. It also carries the build context the contract leaves out (sources, transformation steps,
syntax preferences) so the agent that builds the pipeline has it.

## Inputs

- `contract.yml` (required). If there is none, stop and suggest `build-contract`.
- The requirements notes, tickets and docs the contract was built from.
- `templates/PRD_template.md` in this skill.

## Steps

1. Read the contract and the notes.
2. Fill the template:
   - **Summary**: one paragraph. Who consumes the table, what decision it supports, by when.
   - **Sources**: every input table with its full name, grain and how the pipeline reads it (stream or batch).
   - **Design**: the tables the pipeline builds in order (bronze, silver, gold), one line each on what happens there.
   - **Requirements**: one row per contract promise, numbered R1, R2, ... Walk the contract in order: table keys,
     each column group, each expectation, each slo key, access, tags. The `Contract key` column holds the exact YAML
     path (`expectations.valid_status`, `slo.freshness`, `table.primary_key`).
   - **Build requirements**: what the notes ask for that the contract template has no key for (deduplication and
     audit copies in bronze/silver, delivery deadlines, which entities count for completeness, timezones). Number
     them B1, B2, ... with the note they came from. They guide the build; the contract judge doesn't check them.
   - **Acceptance tests**: one test per requirement and build requirement (T1 tests R1, TB1 tests B1). Each test is
     something a person can run: a SQL query and the result that means pass, or a UI check.
   - **Open questions**: every `TODO(...)` in the contract, plus anything the notes leave unresolved.
   - **Build notes**: language and framework preferences from the notes (SQL vs Python, SDP, DABs), naming,
     environments.
3. Write `PRD.md` next to the contract.
4. Reply with the requirement count, open questions and a summary of the completed PRD. If possible open the PRD file to show the user what you have created and call out any areas of ambiguity or where you have questions. This is the planning step that will power development so user participation and review is essential.

## Rules

- Every R row has a contract key. Something the notes ask for that the contract can't hold is a B row, never a new
  contract key.
- No contract promise without a requirement. Count them: every expectation, every slo key, every primary key and
  every access entry gets a row.
- Write acceptance tests against the real table names in the contract, not placeholders.
- Plain language. A data analyst or business user should understand every requirement row.
- Upstream sources are described and listed by name, transformation steps are described in plain english.
