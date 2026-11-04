-- Bronze (PRD build requirement): every record as delivered, duplicates kept for audit.
-- Warn-only expectations: bronze never drops.
CREATE OR REFRESH STREAMING TABLE orders_raw (
  CONSTRAINT order_id_present EXPECT (order_id IS NOT NULL)
)
COMMENT 'Raw orders as delivered by POS. Duplicates kept for audit.'
CLUSTER BY AUTO
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true', 'delta.enableRowTracking' = 'true')
AS SELECT
  *,
  current_timestamp() AS _ingested_at
FROM STREAM(${source_catalog}.${source_schema}.orders);
