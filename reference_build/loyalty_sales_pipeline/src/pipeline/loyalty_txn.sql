-- Silver (PRD B2, B3): validated, then one row per member_id + txn_ts + location_number, latest delivery wins.
-- Expectations sit on a private (unpublished) streaming table because AUTO CDC targets can't carry them.
CREATE OR REFRESH PRIVATE STREAMING TABLE loyalty_txn_validated (
  CONSTRAINT member_id_present EXPECT (member_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT completed_only EXPECT (txn_status = 'COMPLETED') ON VIOLATION DROP ROW,
  CONSTRAINT net_amount_non_negative EXPECT (net_amount >= 0) ON VIOLATION DROP ROW,
  CONSTRAINT known_member EXPECT (member_tier IS NOT NULL) ON VIOLATION DROP ROW
) AS SELECT
  r.txn_id, r.member_id, r.location_number, r.txn_ts, r.gross_amount, r.discount_amount, r.net_amount,
  r.channel, r.txn_status, m.tier AS member_tier, r.delivered_at, r._ingested_at
FROM STREAM(loyalty_txn_raw) r
LEFT JOIN ${source_catalog}.${source_schema}.loyalty_members m ON r.member_id = m.member_id;

CREATE OR REFRESH STREAMING TABLE loyalty_txn (
  member_id STRING NOT NULL COMMENT 'Loyalty member id',
  txn_ts TIMESTAMP NOT NULL COMMENT 'Transaction time, UTC',
  location_number INT NOT NULL COMMENT 'Store number',
  txn_id STRING COMMENT 'POS transaction id',
  gross_amount DECIMAL(12,2) COMMENT 'Gross basket amount, USD',
  discount_amount DECIMAL(12,2) COMMENT 'Loyalty discount, USD',
  net_amount DECIMAL(12,2) COMMENT 'Gross minus discount, USD',
  channel STRING COMMENT 'POS or APP',
  txn_status STRING COMMENT 'Always COMPLETED here',
  member_tier STRING COMMENT 'Member tier at load time',
  delivered_at TIMESTAMP COMMENT 'When POS delivered the record; latest delivery wins',
  _ingested_at TIMESTAMP,
  CONSTRAINT loyalty_txn_pk PRIMARY KEY (member_id, txn_ts, location_number)
)
COMMENT 'Loyalty transactions, one row per member_id + txn_ts + location_number.'
CLUSTER BY AUTO
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true', 'delta.enableRowTracking' = 'true');

CREATE FLOW loyalty_txn_dedupe AS AUTO CDC INTO loyalty_txn
FROM STREAM(loyalty_txn_validated)
KEYS (member_id, txn_ts, location_number)
SEQUENCE BY delivered_at
STORED AS SCD TYPE 1;
