# Demo guide

A 10-minute demo: the inputs go in, the skills turn them into a contract, a PRD and a pipeline bundle, the platform
enforces the contract, and an LLM judge checks that the bundle keeps every promise.

Use case: **daily store loyalty sales for marketing, ready by 6 AM Central.**

## Settings

Every command reads three environment variables:

| Variable | Default | What it is |
|---|---|---|
| `PROFILE` | `DEFAULT` | Databricks CLI profile for the workspace |
| `CATALOG` | `main` | Catalog for the two demo schemas, `dc_loyalty_src` (sources) and `dc_loyalty` (the data product) |
| `WAREHOUSE_ID` | none | SQL warehouse for the alerts and data profiling |

The notes, contract and bundles are written against `main`. When `CATALOG` is something else, `setup.sh` uploads a
copy with your catalog filled in and passes `--var catalog=...` to each bundle, so the contract's table name and the
pipeline still match.

## Setup (once, about 15 minutes)

```bash
export PROFILE=my-profile CATALOG=my_catalog WAREHOUSE_ID=<sql-warehouse-id>
./setup.sh skills      # the four skills -> /Users/<you>/.assistant/skills/
./setup.sh inputs      # meeting notes + ticket -> /Users/<you>/data-contracts-demo/inputs/
./setup.sh source      # source-data bundle + 60 days of synthetic data in dc_loyalty_src
./setup.sh reference   # contract, PRD, pipeline + broken copy -> /Users/<you>/data-contracts-reference/
./setup.sh pipeline    # deploy + run the reference pipeline (pipeline -> governance + DQM, ~6 min)
./setup.sh app         # deploy + start Contract Review, grant its service principal CAN_READ
```

`./setup.sh all` runs all six.

**Morning of the demo:**

```bash
./setup.sh append       # adds the missing days of source data, reruns the reference pipeline
./setup.sh reset-demo   # only if Genie Code will build live: clears contract/ and the Genie-built bundle
```

## Run of show (10 minutes)

| Min | Show | Say |
|---|---|---|
| 0-1 | Workspace folder `data-contracts-demo/inputs/`: the interview notes and the ticket | "This is all we start with: what we heard in the room and who asked." |
| 1-2 | `.assistant/skills/`: open `build-pipeline-from-contract/SKILL.md`, point at the contract-key -> implementation table and `examples/` | "Skills are the team's standard. Every contract key maps to one way of enforcing it." |
| 2-4 | Genie Code, prompt 1 below | It fills the template, marks what it can't confirm as `TODO(...)` and asks the owner questions. |
| 4-5 | Answer the owner questions (prompt 2), then prompt 3 | Every PRD requirement R1..Rn traces to a contract key and has an acceptance test. |
| 5-7 | Prompt 4. Open the generated gold SQL next to `contract.yml` | Explicit schema, NOT NULLs, PK, `CLUSTER BY AUTO`, one `CONSTRAINT` per expectation with the contract's action, AUTO CDC dedupe on the contract's key, job at 5:00 Central, two alerts, DQM. |
| 7-8 | The deployed reference build: pipeline graph + event-log expectations (`open_store_has_sales` 3 failed, `within_1_5x_avg` 2 failed, `pk_present` 0); Catalog Explorer `dc_loyalty` > Details > Data Quality Monitoring; the profiling dashboard; the Alerts list | "The platform enforces the promise: rows are dropped or flagged, the schema fails fast, and someone gets paged." |
| 8-10 | Contract Review app. It opens on **Contract demo** (Genie's contract and bundle): click **Run judge** (about 40s) and watch each requirement turn green / amber / red. Then pick **Mixed results** from Examples: a saved report of the broken copy with 4 gaps (missing expectation, no primary key, freshness at 48h, no completeness alert). Click a gap to jump to its contract lines | Every contract requirement with the file and line that keeps it, each citation checked against the file. |

### Genie Code prompts (copy/paste)

Replace `<you>` with your user name, `<catalog>` with your catalog, and `<warehouse-id>` with your SQL warehouse ID.

1. `Use the build-contract skill. Read every file in /Workspace/Users/<you>/data-contracts-demo/inputs/ and write the data contract to /Workspace/Users/<you>/data-contracts-demo/contract/contract.yml. Then list what is TODO and the questions for the owner.`
2. Owner answers: `support engineer = the loyalty-de@example.com list. Sales day = America/Chicago date of txn_ts. Name the store column location_number. Counts are BIGINT; money is DECIMAL(14,2). discount_amount is positive. The 28-day average excludes the current day, zero-sale days count, the 1.5x rule is on net_sales. Bronze table loyalty_txn_raw, silver table loyalty_txn. Bronze retention is a platform setting. Tie-break: latest delivered_at, then txn_id; txn_id isn't stable across re-sends. Drop members not in loyalty_members and rows missing location_number or txn_ts. Freshness: keep 24h, evaluate at 05:30 Central after the build. Stores count from open_date using current store_status. Keep all history. No spike flag column. Set status to active.`
3. `For stores open fewer than 28 days, average over the days available; update the contract. Then use the build-prd skill: write .../contract/PRD.md from contract.yml and the files in inputs/.`
4. `Use the build-pipeline-from-contract skill: build the bundle in .../data-contracts-demo/loyalty_sales_pipeline from contract.yml and PRD.md. Warehouse id <warehouse-id>. Validate it, but do not deploy or run it.`

Genie Code shows each change as a pending edit; click **Accept all** after each step. The reference build in
`reference_build/` is the fallback if Genie Code is slow on the day.

### What to expect from Genie Code

From a test run of these prompts:

- **Contract:** on the first pass, Genie Code left about 16 `TODO(...)` markers for things the notes didn't settle
  (types, timezone, table names, tie-breaks) instead of guessing. It also caught that an hourly 24h freshness alert
  would fire every morning before the 5 AM build.
- **PRD:** requirements traced to contract keys, acceptance tests, and good UAT questions (should a closed store's
  history disappear? should a fully missing feed day still produce rows?).
- **Bundle:** the skill's exact layout, and `bundle validate` passed. It checked the workspace's tag policies before
  choosing tag keys. It did not implement a `member_exists` expectation that needs a subquery (SDP expectations
  can't run one). As the skill tells it to, it stopped and proposed a fix (join `loyalty_members` and check the
  joined column) for the owner to approve.
- **Judge on Genie's bundle:** 46 met, 1 partial, 4 missing, 1 n/a out of 52, with all citations verified. The
  missing items were `member_exists` and the rules that depend on it.

Genie's bundle targets the same `dc_loyalty` tables as the reference build, so validate it but don't deploy it. To
deploy it, point its `schema` variable at another schema first.

## Deployed objects

| Object | Name |
|---|---|
| Source schema / tables | `dc_loyalty_src`: `pos_loyalty_transactions` (~790k rows, CDF on), `stores` (200, 8 closed), `loyalty_members` (40k) |
| Data product schema | `dc_loyalty` (DQM anomaly detection on) |
| Pipeline | `loyalty_sales_pipeline`: `loyalty_txn_raw` (bronze ST) -> `loyalty_txn_validated` (private ST, expectations) -> `loyalty_txn` (silver ST, AUTO CDC) -> `daily_store_loyalty_sales` (gold MV) |
| Job | `loyalty_sales_refresh`: 05:00 America/Chicago (paused in dev), refresh_pipeline -> governance + enable_dqm |
| Alerts | `[dev] daily_store_loyalty_sales freshness > 24h` (05:30), `[dev] ... completeness: open stores with no sales` (hourly at :15) |
| DQM | anomaly detection on `dc_loyalty`; time-series data profiling on the gold table |
| App | Contract Review (`contract-review`); the rubric is read live from the `review-pipeline-against-contract` skill |

## Gotchas (all handled in the skills and code)

- **`mode: development` renames schema resources** to `dev_<user>_<schema>`, which breaks a contract's table name.
  Dev targets use `presets.trigger_pause_status: PAUSED` instead.
- **SDP SQL grammar:** `EXPECT` constraints must come before the `PRIMARY KEY` table constraint. AUTO CDC can't read
  a `LIVE VIEW` with expectations as a stream, so use a `PRIVATE STREAMING TABLE`.
- **DQM:** DABs have no resource for schema anomaly detection, and a `quality_monitors` resource fails on the first
  deploy (the table doesn't exist yet), so a job task turns on both. On a table under a monitored schema,
  `get_monitor` returns the inherited anomaly-detection view, not a real table monitor. So check for
  `data_profiling_config` and always `create_monitor`. Profiling needs `assets_dir`, or creation fails with
  `parent_path cannot be empty`.
- **`system.data_quality_monitoring.table_results`** isn't readable everywhere, so the alerts query the data product
  itself. The system-table variant is kept as a comment in the skill's alert example.
- **Governed tag policies:** if the metastore has tag policies on `domain` or `data_product`, set the bundle's
  `tag_prefix` variable (dev uses `dc_`).
- **Freshness alert timing:** a daily batch is always about 24h old just before its next build, so check freshness
  right after the build, not hourly.
- **Judge:** `databricks-claude-sonnet-5-5` rejects `temperature`. The model shortens snippets with `...`, so the
  rubric asks for verbatim lines, and the app checks each citation against the file (splitting on ellipses).
