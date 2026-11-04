---
name: review-pipeline-against-contract
description: Review a pipeline bundle (DAB) against its data contract (contract.yml) as an LLM judge - for every contract requirement, decide met, partial or missing and cite the file and lines that implement it. Use before merge, in UAT, or when someone asks whether a pipeline meets its contract.
---

# Review a pipeline against its contract

You are the judge between the contract and the code. The contract is the source of truth. Your job is to find,
for every promise in it, the code that keeps that promise, or to say plainly that there is none.

## Inputs

- `contract.yml`.
- Every file in the bundle: `databricks.yml`, `resources/*.yml`, pipeline SQL/Python, helper scripts.

## Requirements to check

Each item below is one requirement. Check all that are present in the contract. Use the id shown.

| id | Contract key | Met when |
|---|---|---|
| `table.name` | table.name | a dataset with this short name is defined, and the pipeline's catalog/schema resolve to the contract's catalog/schema in some target |
| `table.type` | table.type | defined as that type (`MATERIALIZED VIEW` / `STREAMING TABLE`) |
| `table.primary_key` | table.primary_key | a PRIMARY KEY constraint on exactly those columns, and those columns are NOT NULL |
| `table.scd_type` | table.scd_type, table.sequence_by | AUTO CDC into the table with `STORED AS SCD TYPE <n>` and `SEQUENCE BY` the contract column |
| `table.cluster_by` | table.cluster_by | `CLUSTER BY` matches (`auto` -> `CLUSTER BY AUTO`) |
| `table.cdf` / `table.row_tracking` | table.cdf, table.row_tracking | the matching TBLPROPERTIES are set to true |
| `contract.description` | contract.description | table COMMENT carries the description |
| `columns.<name>` | columns[*] | the column exists in the explicit schema with the same type, NOT NULL iff `nullable: false`, comment present when the contract has one |
| `expectations.<name>` | expectations[*] | a constraint with the same name and an equivalent expression on the contracted table, with the right action (warn -> no ON VIOLATION, drop -> DROP ROW, fail -> FAIL UPDATE) |
| `slo.refresh` | slo.refresh | a job schedule with that cron runs the pipeline; if the contract comments a timezone, the schedule uses it |
| `slo.freshness` | slo.freshness | a SQL alert compares data age to the freshness threshold (same unit and value). DQM anomaly detection alone doesn't notify anyone: `partial` |
| `slo.completeness` | slo.completeness: true | the table makes missing entities visible (rows with zero counts) AND a SQL alert counts them on the latest date. An expectation alone only logs, nobody is notified: `partial` |
| `slo.alert` | slo.alert | alerts and job failure notifications reach the contract emails in prod (dev may notify the developer) |
| `dqm` | slo | data quality monitoring is enabled on the table or its schema by the bundle |
| `contract.tags` | contract.domain, contract.tags, contract.version | the table gets UC tags for domain/data product/version, or the job carries them (partial if only one) |
| `access.readers` | access.readers | SELECT is granted to the reader groups in prod (dev may use a stand-in group) |
| `access.pii` | access.pii | if pii is true, masks or row filters exist; if false, met with no evidence needed |
| `changes` | changes | not checkable in code: always `not_applicable` |
| any other id | a key outside the list above | met when the code does what the key states; `not_applicable` when it describes ownership or process rather than something code can do |

Judge the contract, not the pipeline's extras: code the contract doesn't ask for (bronze/silver tables, extra
expectations) is fine and earns nothing.

## Verdicts

- `met`: implemented as written. Cite the evidence.
- `partial`: implemented with a difference (name changed, action weaker, wrong threshold, only in dev). Say exactly
  what differs.
- `missing`: no code implements it.
- `not_applicable`: can't be checked in code (process rules) or the contract leaves it blank.

Be strict. A renamed expectation is `partial`. A `warn` where the contract says `drop` is `partial`. An alert at 48h
when the contract says 24h is `partial`. Do not give credit for comments or TODOs, only for code that runs.

## Output

Return only JSON, no prose around it:

```json
{
  "summary": "one sentence: overall verdict and the biggest gap",
  "results": [
    {
      "id": "expectations.net_sales_non_negative",
      "section": "expectations",
      "requirement": "net_sales >= 0, warn on violation",
      "status": "met",
      "evidence": [{"file": "src/pipeline/daily_store_loyalty_sales.sql", "lines": "14", "snippet": "CONSTRAINT net_sales_non_negative EXPECT (net_sales >= 0)"}],
      "explanation": "Same name and expression on the gold MV; no ON VIOLATION, so it warns."
    }
  ]
}
```

`section` is the top-level contract key (`contract`, `table`, `columns`, `expectations`, `slo`, `access`,
`changes`, or the contract's own section name). `lines` is a line number or range in the file as given to you. `snippet` is copied verbatim from
the file: whole lines, at most 3, no `...`, no paraphrase, no line-number prefix. Snippets are checked against the
file, so cite the line that actually holds the code. Every requirement gets exactly one result, in contract order.
