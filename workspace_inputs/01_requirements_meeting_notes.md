# Requirements interview: daily store loyalty sales

**When:** 2026-10-20, 30 min
**Who:** Marketing Analytics lead (business owner), Loyalty Program manager, Data Engineering (pipeline developer),
Data Architecture (contract review)

## What marketing needs

- Yesterday's **loyalty sales by store**, every day, for the morning loyalty report. The report refreshes at
  **6:00 AM Central**, so the table has to be ready before then. DE suggested building at 5:00 AM Central to leave
  an hour of slack. Agreed.
- Grain: **one row per store per day**. Columns they want: sales date, store number, store name, region, number of
  loyalty transactions, number of distinct members, gross amount, discount amount, net sales.
- Analysts will also ask Genie about this table, so column names and comments need to be clear ("net sales" means
  gross minus loyalty discounts, in USD).
- Money columns as DECIMAL, two decimals. Store number is an integer (`location_number` in the POS feed).

## Quality rules (business words)

- **Every open store should have at least one loyalty sale every day.** A store with zero sales almost always means
  a POS feed problem, not a quiet day. Closed stores don't count. They still want the store to *show up* with zero
  so it's visible, and they want an alert when it happens.
- **No store should be more than 1.5x its own average.** Compare each store's day to its trailing 28-day average.
  Don't drop those rows; flag them so DQ can investigate (last quarter a duplicated POS batch doubled a whole
  region's numbers and nobody noticed for a week).
- Net sales can't be negative for a store-day. Flag it, don't drop it.
- Store number and sales date must always be present. If they're not, stop the load. Something is badly wrong.

## Duplicates

- The POS system re-sends batches. **A loyalty transaction is unique on member_id + transaction timestamp +
  location number.**
- Keep the duplicates in **bronze** exactly as received, for audit.
- Remove them in **silver**: one row per member_id + txn_ts + location_number, keeping the latest delivery.
- Silver should also drop transactions without a member_id and anything not in COMPLETED status (voids and
  returns are handled by a different product). Negative net amounts at the transaction level: drop.

## Freshness and alerting

- Data older than **24 hours** is stale. Alert when the newest transaction in the table is more than 24h old.
- Alerts go to the loyalty data on-call list: `loyalty-data-oncall@example.com`, plus the support engineer.
- DE wants data quality monitoring turned on for the whole loyalty schema, not just this table.

## Ownership and access

- Business owner: Marketing Analytics lead, `marketing-analytics-lead@example.com`.
- Support: loyalty data engineering, `loyalty-de@example.com`.
- Domain: marketing. Tags: marketing, loyalty, store-sales.
- Readers: `marketing-analysts`. No PII in the gold table: member ids are counted, never exposed.
- Certification: not yet. Data Architecture will certify after the first month in prod.

## Sources (from DE)

All in `main.dc_loyalty_src` for this build:

- `pos_loyalty_transactions`: append-only POS loyalty feed. txn_id, member_id, location_number, txn_ts,
  gross_amount, discount_amount, net_amount, channel, txn_status, delivered_at. Has duplicates (re-sent batches).
- `stores`: store master. location_number, store_name, city, state, region, store_status (OPEN / CLOSED),
  open_date.
- `loyalty_members`: member_id, tier, enrolled_at. Not needed in gold; silver can use it to check the member exists.

## Build preferences (from DE and Architecture)

- Spark Declarative Pipelines, SQL. Bronze streaming table, silver streaming table with AUTO CDC for the dedupe,
  gold materialized view.
- Everything in a DAB: pipeline, the 5 AM job, alerts and the DQM setup. No hand-made resources.
- Target schema `main.dc_loyalty`. Gold table name `daily_store_loyalty_sales`.
- Change policy: additive changes are fine; breaking changes need a new major version and 30 days' notice to
  marketing.
