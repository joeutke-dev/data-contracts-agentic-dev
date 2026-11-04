-- Bronze (PRD B1): every POS record as delivered, duplicates kept for audit. No expectations, no dedupe.
CREATE OR REFRESH STREAMING TABLE loyalty_txn_raw
COMMENT 'POS loyalty transactions exactly as delivered. Re-sent batches are kept for audit.'
CLUSTER BY AUTO
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true', 'delta.enableRowTracking' = 'true')
AS SELECT
  *,
  current_timestamp() AS _ingested_at
FROM STREAM(${source_catalog}.${source_schema}.pos_loyalty_transactions);
