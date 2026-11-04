-- Silver (PRD build requirement): one row per order_id. Expectations live on a private (unpublished) streaming
-- table because AUTO CDC targets can't carry them; AUTO CDC then keeps the latest row per key (SCD 1).
CREATE OR REFRESH PRIVATE STREAMING TABLE orders_validated (
  CONSTRAINT valid_status EXPECT (order_status IN ('CREATED', 'PAID')) ON VIOLATION DROP ROW,
  CONSTRAINT net_amount_non_negative EXPECT (net_amount >= 0)
) AS SELECT * FROM STREAM(orders_raw);

CREATE OR REFRESH STREAMING TABLE orders_clean (
  order_id STRING NOT NULL COMMENT 'POS order id',
  order_status STRING NOT NULL,
  net_amount DECIMAL(12,2) COMMENT 'net of discounts and refunds',
  channel STRING,
  order_created_at TIMESTAMP NOT NULL COMMENT 'order creation time, UTC',
  _ingested_at TIMESTAMP,
  CONSTRAINT orders_clean_pk PRIMARY KEY (order_id)
)
COMMENT 'Orders deduplicated on order_id.'
CLUSTER BY AUTO
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true', 'delta.enableRowTracking' = 'true');

CREATE FLOW orders_clean_cdc AS AUTO CDC INTO orders_clean
FROM STREAM(orders_validated)
KEYS (order_id)
SEQUENCE BY _ingested_at
COLUMNS order_id, order_status, net_amount, channel, order_created_at, _ingested_at
STORED AS SCD TYPE 1;
