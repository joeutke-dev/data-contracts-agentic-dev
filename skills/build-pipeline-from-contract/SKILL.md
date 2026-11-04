---
name: build-pipeline-from-contract
description: Build a Declarative Automation Bundle (DAB) with a Spark Declarative Pipeline that implements a data contract (contract.yml) - explicit schemas, expectations, AUTO CDC dedupe, job schedule, data quality monitoring, freshness and completeness alerts, tags and grants. Use when someone asks to build, generate or update a pipeline, bundle or DAB from a contract.
---

# Build a pipeline from a contract

Every contract key becomes something the platform enforces. Build to the contract, not to the examples: the
examples in `examples/` are for a generic `orders` product and show syntax only.

## Inputs

- `contract.yml` (required) and `PRD.md` (read Sources, Design, Build requirements and Build notes). The contract is
  what the judge checks; the PRD's build requirements (dedupe, raw copies, deadlines) shape the pipeline around it.
- The source tables named in the PRD. Check their columns with `DESCRIBE TABLE` before writing SQL.

## Output: one bundle folder

```
<bundle>/
  databricks.yml                     bundle, variables (catalog, schema, source schema, warehouse_id, alert_email, reader_group), targets
  resources/<schema>.schema.yml      the target schema
  resources/<product>.pipeline.yml   serverless SDP pipeline
  resources/<product>.job.yml        schedule + tasks: refresh pipeline -> governance -> enable_dqm
  resources/<product>.alerts.yml     freshness and completeness SQL alerts
  src/pipeline/<table>.sql           one file per dataset (bronze, silver, gold)
  src/governance.py                  tags, comments and grants from the contract
  src/enable_dqm.py                  data quality monitoring (anomaly detection + profiling)
  README.md                          contract key -> file map
```

## Contract key -> implementation

| Contract key | Implement as | Example |
|---|---|---|
| `table.type`, `table.name` | `CREATE OR REFRESH STREAMING TABLE` / `MATERIALIZED VIEW` with the table's short name | `src/pipeline/daily_sales.sql` |
| `columns[*]` | explicit column list: name, type, `NOT NULL` when `nullable: false`, `COMMENT` | `src/pipeline/daily_sales.sql` |
| `table.primary_key` | `CONSTRAINT <t>_pk PRIMARY KEY (...)` (informational, listed after all EXPECT constraints or the parser fails) plus a `FAIL UPDATE` not-null expectation on the key columns | `src/pipeline/daily_sales.sql` |
| `table.cluster_by: auto` | `CLUSTER BY AUTO` | `src/pipeline/daily_sales.sql` |
| `table.cdf`, `table.row_tracking` | `TBLPROPERTIES ('delta.enableChangeDataFeed'='true', 'delta.enableRowTracking'='true')` | `src/pipeline/daily_sales.sql` |
| `contract.description`, `columns[*].comment` | table `COMMENT` and column comments | `src/pipeline/daily_sales.sql` |
| `expectations[*]` | `CONSTRAINT <name> EXPECT (<expr>)` + `warn` -> nothing, `drop` -> `ON VIOLATION DROP ROW`, `fail` -> `ON VIOLATION FAIL UPDATE`. Keep the name and expr exactly as written | `src/pipeline/daily_sales.sql`, `snippets/orders_expectations.py` (Python form; not part of the example pipeline) |
| `slo.completeness: true` | a row per expected entity (left join the entity list from the PRD to the facts) so a missing entity is a zero row the expectation and alert can see | `src/pipeline/daily_sales.sql` |
| PRD build requirement: keep raw records / duplicates | bronze streaming table, append only, no dedupe, warn-only expectations | `src/pipeline/orders_raw.sql` |
| PRD build requirement: dedupe on a key | silver: `CREATE OR REFRESH PRIVATE STREAMING TABLE <t>_validated` with the expectations (a LIVE VIEW can't be read as a stream), then `AUTO CDC INTO ... KEYS (<dedupe key>) SEQUENCE BY <latest-wins column> STORED AS SCD TYPE 1` | `src/pipeline/orders_clean.sql` |
| `slo.refresh` | job `schedule.quartz_cron_expression`; `timezone_id` from the comment on the key (or the PRD), else UTC | `resources/orders.job.yml` |
| `slo.freshness` | SQL alert: hours since the newest event `GREATER_THAN` the freshness hours, `empty_result_state: TRIGGERED`. Schedule it shortly after the build (refresh + 30 min), not hourly: a daily batch is always ~24h+ old just before its next build | `resources/orders.alerts.yml` |
| `slo.completeness: true` | SQL alert: count of expected entities with no data on the latest date, `GREATER_THAN 0` | `resources/orders.alerts.yml` |
| `slo.alert` | alert `notification.subscriptions` and job `email_notifications.on_failure` (variable `alert_email`; prod target = the contract emails) | `resources/orders.alerts.yml` |
| `contract.domain`, `contract.tags`, `contract.version` | job `tags` + UC table tags set by `governance.py` (keys `domain`, `data_product`, `contract_version`, `tags`; `contract.tags` joined with `\|`). If the metastore has governed tag policies on those keys, put a `tag_prefix` variable in front of them for that target | `src/governance.py` |
| `access.readers` | `GRANT SELECT` in `governance.py` (variable `reader_group`; prod target = the contract groups) | `src/governance.py` |
| data quality monitoring | `enable_dqm.py`: anomaly detection (freshness + completeness) on the schema, data profiling on the gold table | `src/enable_dqm.py` |

## Steps

1. Read the contract and PRD. List every contract key you will implement; that list becomes the bundle README.
2. `DESCRIBE TABLE` each source. Map source columns to contract columns; stop and ask if a contract column has no
   source.
3. Write the pipeline SQL, one file per dataset, bronze -> silver -> gold.
4. Write the job, alerts, `governance.py` and `enable_dqm.py` from the examples, substituting contract values.
5. Write `databricks.yml` with a `dev` target (alerts go to the current user, reader group `account users`,
   `presets.trigger_pause_status: PAUSED`) and a `prod` target (`mode: production`, contract emails and groups).
   Declare the target schema as a `schemas` resource. Don't use `mode: development` on the dev target: it renames
   schema resources to `dev_<user>_<schema>`, which breaks the table name the contract promises.
6. Run `databricks bundle validate -t dev`. Fix every error and warning.
7. Write the README: a table of contract key -> file and line.

## Rules

- Never change an expectation's name, expression or action. If an expr can't run as written, stop and ask.
- Never guess a type the contract gives. A column missing from the contract is a question, not a decision.
- Pipeline is serverless, SQL first; Python only for the job helper scripts.
- Parameterize catalog and schemas with pipeline `configuration` (`${source_catalog}.${source_schema}.table`);
  never hard-code a target.
- No `current_timestamp()` in a materialized view: it forces a full recompute. Carry event timestamps instead.
- Alerts and the job must exist in the bundle. DQM is enabled by the job, not by hand.
