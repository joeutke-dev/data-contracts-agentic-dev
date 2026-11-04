# PRD: Daily store loyalty sales

| | |
|---|---|
| Contract | `contract/contract.yml` (version 1.0.0, status draft) |
| Table | `main.dc_loyalty.daily_store_loyalty_sales` |
| Owner | marketing-analytics-lead@example.com · Support loyalty-de@example.com |
| Consumers | Marketing morning loyalty report (6 AM Central), marketing analysts in Genie |

## Summary

Marketing's morning loyalty report needs yesterday's loyalty sales for every open store, ready before the 6 AM
Central refresh. This table gives one trusted row per open store per day, with duplicates from re-sent POS batches
removed, stores with no sales shown as zero, and outlier days flagged so the numbers can be trusted in the report
and in Genie.

## Sources

| Source | Grain | Read as |
|---|---|---|
| `dc_loyalty_src.pos_loyalty_transactions` | one row per delivered POS loyalty transaction (re-sent batches repeat rows) | stream (append-only) |
| `dc_loyalty_src.stores` | one row per store | batch (store master) |
| `dc_loyalty_src.loyalty_members` | one row per member | batch (member check) |

## Design

| Order | Table | Layer | Type | What happens |
|---|---|---|---|---|
| 1 | `loyalty_txn_raw` | bronze | streaming table | every record as delivered, duplicates kept for audit |
| 2 | `loyalty_txn` | silver | streaming table (AUTO CDC, SCD 1) | drop missing members, non-COMPLETED and negative rows; one row per member_id + txn_ts + location_number, latest delivery wins |
| 3 | `daily_store_loyalty_sales` | gold | materialized view | open stores x days left-joined to silver sales; zero rows for silent stores; trailing 28-day average |

## Requirements

| ID | Requirement | Contract key |
|---|---|---|
| R1 | The table is a gold materialized view named `daily_store_loyalty_sales` in `dc_loyalty` | `table.name`, `table.type` |
| R2 | One row per sales_date and store (location_number) | `table.primary_key` |
| R3 | Auto liquid clustering, change data feed and row tracking are on | `table.cluster_by`, `table.cdf`, `table.row_tracking` |
| R4 | The table and every column carry the descriptions in the contract, so Genie answers with trusted definitions | `contract.description`, `columns[*].comment` |
| R5 | Columns, types and nullability match the contract exactly (11 columns) | `columns` |
| R6 | The load stops if sales_date or location_number is ever missing | `expectations.pk_present` |
| R7 | An open store with no sales appears with txn_count 0 and is flagged | `expectations.open_store_has_sales` |
| R8 | A store-day above 1.5x its trailing 28-day average is flagged, not dropped | `expectations.within_1_5x_avg` |
| R9 | A negative net_sales store-day is flagged, not dropped | `expectations.net_sales_non_negative` |
| R10 | The build runs at 5:00 AM Central every day | `slo.refresh` |
| R11 | Alert when the newest transaction is more than 24 hours old | `slo.freshness` |
| R12 | Every open store shows up every day (zero when it had no sales), and an alert fires when an open store has no sales for the latest day | `slo.completeness` |
| R13 | Alerts and job failures go to loyalty-data-oncall@example.com and loyalty-de@example.com | `slo.alert` |
| R14 | Data quality monitoring is on for the whole `dc_loyalty` schema | `slo` |
| R15 | The table is tagged domain marketing, data product, contract version | `contract.domain`, `contract.tags`, `contract.version` |
| R16 | `marketing-analysts` can SELECT the table; no member-level data is exposed | `access.readers`, `access.pii` |

## Build requirements (from the notes; not in the contract)

| ID | Requirement | Source |
|---|---|---|
| B1 | Bronze keeps every delivered record exactly as received, duplicates included, for audit | notes: Duplicates |
| B2 | Silver has one row per member_id + txn_ts + location_number; the latest delivered_at wins | notes: Duplicates |
| B3 | Silver drops rows with no member_id, members not in loyalty_members, non-COMPLETED status or negative net amount | notes: Duplicates |
| B4 | Data is ready before the 6:00 AM Central loyalty report | notes: What marketing needs |
| B5 | Completeness counts OPEN stores only, from their open_date; closed stores don't count | notes: Quality rules |

## Acceptance tests

| ID | Test | Pass when |
|---|---|---|
| T1 | `DESCRIBE TABLE EXTENDED dc_loyalty.daily_store_loyalty_sales` | Type is MATERIALIZED_VIEW |
| T2 | `SELECT sales_date, location_number, count(*) FROM daily_store_loyalty_sales GROUP BY ALL HAVING count(*) > 1` | 0 rows |
| T3 | `SHOW TBLPROPERTIES daily_store_loyalty_sales` | `delta.enableChangeDataFeed` and `delta.enableRowTracking` are true; clustering is auto |
| T4 | Catalog Explorer, table Overview | table comment and all 11 column comments present |
| T5 | `DESCRIBE TABLE daily_store_loyalty_sales` | 11 columns with the contract types; sales_date, location_number, store_name, region, txn_count, member_count, gross_amount, discount_amount, net_sales NOT NULL |
| T6 | Pipeline event log, gold dataset | `pk_present` listed as a FAIL UPDATE expectation with 0 failures |
| T7 | `SELECT count(*) FROM daily_store_loyalty_sales WHERE sales_date = (SELECT max(sales_date) FROM daily_store_loyalty_sales) AND txn_count = 0` | equals the number of open stores with no POS rows that day (3 in the demo data); event log shows `open_store_has_sales` failures |
| T8 | Event log, `within_1_5x_avg` | at least one flagged row (store 1088 in the demo data); row still in the table |
| T9 | Event log, `net_sales_non_negative` | listed as a warn expectation |
| T10 | Job `schedule` | `0 0 5 * * ?`, America/Chicago |
| T11 | Freshness alert on a stale copy (or after skipping a day) | alert goes TRIGGERED |
| T12 | Completeness alert on the demo data | alert goes TRIGGERED (3 silent stores) |
| T13 | Alert and job notification settings, prod target | both contract emails subscribed |
| T14 | Catalog Explorer, schema `dc_loyalty` Details | Data Quality Monitoring enabled |
| T15 | `SELECT * FROM information_schema.table_tags WHERE table_name = 'daily_store_loyalty_sales'` | domain, data_product and contract_version tags present |
| T16 | `SHOW GRANTS ON TABLE daily_store_loyalty_sales` | SELECT for the reader group; no member_id column in the table |
| TB1 | `SELECT count(*) FROM loyalty_txn_raw` vs source row count | equal |
| TB2 | `SELECT member_id, txn_ts, location_number, count(*) FROM loyalty_txn GROUP BY ALL HAVING count(*) > 1` | 0 rows |
| TB3 | `SELECT count(*) FROM loyalty_txn WHERE member_id IS NULL OR txn_status <> 'COMPLETED' OR net_amount < 0` | 0 rows; event log shows drops for each silver expectation |
| TB4 | Job run history over a week | every run finishes before 6:00 AM Central |

## Open questions

- Certification: Data Architecture certifies after the first month in prod (`contract.certified: false`).
- The completeness alert fires for the latest day only. Should a missed day be back-checked? (add to contract?)
- Reader group `marketing-analysts` doesn't exist in the dev workspace; dev grants to a stand-in group.

## Build notes

- Spark Declarative Pipelines in SQL: bronze streaming table, silver streaming table with AUTO CDC, gold
  materialized view. Serverless.
- Everything in one DAB: pipeline, the 5 AM job, both alerts and the DQM setup. No hand-made resources.
- Target schema `main.dc_loyalty`; sources in `dc_loyalty_src`.
- sales_date is the America/Chicago business date of txn_ts (the feed is UTC).
- dev target: alerts go to the developer and grants go to a stand-in group; prod target uses the contract values.
