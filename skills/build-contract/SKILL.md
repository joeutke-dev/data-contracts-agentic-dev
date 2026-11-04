---
name: build-contract
description: Build a data contract (contract.yml) for one data product from requirements notes, tickets and docs, using the team's contract template. Use when someone asks to create, draft or update a data contract, or hands you meeting notes or a ticket for a new table.
---

# Build a contract

A contract is the promise a data product makes: who owns it, its shape, its quality rules, its SLOs and who can read
it. Downstream skills (`build-prd`, `build-pipeline-from-contract`, `review-pipeline-against-contract`) read the
contract and nothing else, so everything they need must be in it.

## Inputs

- Requirements material the user points you at: meeting notes, tickets, emails, requirements docs.
- `templates/contract_template.yml` in this skill: the contract template. Always start from it. **Any adjustments to the base contract must be approved by the user.**

## Steps

1. Read every input file the user names/references as inputs. If they name a folder, read every file in it.
2. Copy the template. Keep every section and every key, in the template's order, and add none.
3. Fill each key from the inputs:
   - `contract`: name is the full three-part table name; version starts at `1.0.0`; status `draft` until the owner
     signs off; owner, support, domain, tags and description come from the notes.
   - `table`: layer, type (`materialized_view` for aggregates, `streaming_table` for incremental appends),
     primary_key, cluster_by, cdf and row_tracking.
   - `slo`: `refresh` is a Quartz cron for the job that builds the table (put its timezone in a YAML comment on the
     same line), `freshness` is the maximum age of the newest data, `completeness` is `true` when every expected
     entity (every open store, every channel) must have data, and `alert` is the comma-separated people to notify.
   - `columns`: every column consumers will read, with type, nullable and comment. Use the types the notes give;
     if the notes give none, pick the narrowest sensible type and flag it as TODO.
   - `expectations`: one entry per quality rule on this table. `expr` is a SQL boolean over one row of this table.
     `on_violation` is `warn`, `drop` or `fail`, as the stakeholders asked.
   - `access`: reader groups and whether the table holds PII.
   - `changes`: additive and breaking change policy.
4. Requirements the template has no key for stay out of the contract: rules about other tables (deduplication,
   audit copies), delivery deadlines, which entities count for completeness, source details. List them in your
   reply under **For the PRD** so `build-prd` carries them, and add any that should be standard to **Template
   suggestions**.
5. Mark anything you could not confirm from the inputs as `TODO(<question for the owner>)`. Never guess an owner,
   a reader group, a schedule or a threshold.
6. Write the file to the path the user asks for (default `contract/contract.yml` next to the inputs folder).
7. Reply with: what you filled, what is TODO and the questions for the owner, **For the PRD**, and **Template
   suggestions**. It is crucial that the user is interviewed/knows about any sections that need to be filled out, and that they approve the contract before proceeding to the next step like building a PRD.

## Rules

- One contract per data product (one table). Never add a section or key the template doesn't have.
- Quality rules that are about a set of rows (every store has a sale, no store above 1.5x its average) still go in
  `expectations`, written against columns of this table. Add the column that makes the rule checkable (for
  example `txn_count`, `avg_net_sales_28d`) to `columns` and say why in its comment.
- Expectation names are snake_case and describe what *good* looks like (`net_sales_non_negative`, not `bad_sales`).
- Keep the YAML plain: no anchors, no multi-document files, comments only where a value needs explaining.
- Do not write pipeline code. That is `build-pipeline-from-contract`.
