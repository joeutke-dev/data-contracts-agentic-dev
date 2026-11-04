-- Gold: the contracted data product. Schema from `columns`, constraints from `expectations` and `table.primary_key`.
-- Open stores x days, left-joined to sales, so a silent store is a zero row (slo.completeness).
CREATE OR REFRESH MATERIALIZED VIEW daily_store_loyalty_sales (
  sales_date DATE NOT NULL COMMENT 'Business date of the sale, America/Chicago',
  location_number INT NOT NULL COMMENT 'Store number',
  store_name STRING NOT NULL COMMENT 'Store name from the store master',
  region STRING NOT NULL COMMENT 'Store region from the store master',
  txn_count BIGINT NOT NULL COMMENT 'Loyalty transactions after dedupe. 0 when an open store had no sales, so completeness is checkable',
  member_count BIGINT NOT NULL COMMENT 'Distinct loyalty members who bought that day. Members are counted, never exposed',
  gross_amount DECIMAL(14,2) NOT NULL COMMENT 'Sum of gross basket amount, USD',
  discount_amount DECIMAL(14,2) NOT NULL COMMENT 'Sum of loyalty discounts, USD',
  net_sales DECIMAL(14,2) NOT NULL COMMENT 'Gross amount minus loyalty discounts, USD',
  avg_net_sales_28d DECIMAL(14,2) COMMENT 'Store''s trailing 28-day average net_sales, excluding the current day. Makes the 1.5x rule checkable',
  last_txn_ts TIMESTAMP COMMENT 'Newest transaction time for the store-day, UTC. Drives the freshness check',
  CONSTRAINT pk_present EXPECT (sales_date IS NOT NULL AND location_number IS NOT NULL) ON VIOLATION FAIL UPDATE,
  CONSTRAINT open_store_has_sales EXPECT (txn_count > 0),
  CONSTRAINT net_sales_non_negative EXPECT (net_sales >= 0)
)
COMMENT 'One row per open store per day of loyalty sales, for the 6 AM Central loyalty report'
CLUSTER BY AUTO
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true', 'delta.enableRowTracking' = 'true')
AS
WITH sales AS (
  SELECT to_date(from_utc_timestamp(txn_ts, 'America/Chicago')) AS sales_date, *
  FROM loyalty_txn
),
days AS (
  SELECT explode(sequence(min(sales_date), max(sales_date))) AS sales_date FROM sales
),
expected AS (            -- every open store, every day it was open
  SELECT d.sales_date, s.location_number, s.store_name, s.region
  FROM days d
  JOIN ${source_catalog}.${source_schema}.stores s
    ON s.store_status = 'OPEN' AND s.open_date <= d.sales_date
),
daily AS (
  SELECT sales_date, location_number,
         count(*) AS txn_count,
         count(DISTINCT member_id) AS member_count,
         sum(gross_amount) AS gross_amount,
         sum(discount_amount) AS discount_amount,
         sum(net_amount) AS net_sales,
         max(txn_ts) AS last_txn_ts
  FROM sales GROUP BY sales_date, location_number
),
joined AS (
  SELECT e.sales_date, e.location_number, e.store_name, e.region,
         coalesce(d.txn_count, 0) AS txn_count,
         coalesce(d.member_count, 0) AS member_count,
         CAST(coalesce(d.gross_amount, 0) AS DECIMAL(14,2)) AS gross_amount,
         CAST(coalesce(d.discount_amount, 0) AS DECIMAL(14,2)) AS discount_amount,
         CAST(coalesce(d.net_sales, 0) AS DECIMAL(14,2)) AS net_sales,
         d.last_txn_ts
  FROM expected e LEFT JOIN daily d USING (sales_date, location_number)
)
SELECT sales_date, location_number, store_name, region, txn_count, member_count,
       gross_amount, discount_amount, net_sales,
       CAST(avg(net_sales) OVER (PARTITION BY location_number ORDER BY sales_date
            ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING) AS DECIMAL(14,2)) AS avg_net_sales_28d,
       last_txn_ts
FROM joined;
