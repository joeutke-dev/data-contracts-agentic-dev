-- Gold: the contracted table. Explicit schema from `columns`, expectations from `expectations`,
-- primary key from `table.primary_key`, completeness from `slo.completeness` (entities from the PRD).
CREATE OR REFRESH MATERIALIZED VIEW daily_sales (
  sales_date DATE NOT NULL COMMENT 'order date, UTC',
  channel STRING NOT NULL COMMENT 'POS or APP',
  order_count BIGINT NOT NULL COMMENT '0 when a channel had no orders: makes completeness checkable',
  net_sales DECIMAL(14,2) NOT NULL,
  avg_net_sales_28d DECIMAL(14,2) COMMENT 'trailing 28-day average, excludes the current day',
  last_order_ts TIMESTAMP COMMENT 'newest order in the day: drives the freshness alert',
  CONSTRAINT pk_present EXPECT (sales_date IS NOT NULL AND channel IS NOT NULL) ON VIOLATION FAIL UPDATE,
  CONSTRAINT channel_has_orders EXPECT (order_count > 0),
  CONSTRAINT within_1_5x_avg EXPECT (avg_net_sales_28d IS NULL OR net_sales <= 1.5 * avg_net_sales_28d),
  CONSTRAINT daily_sales_pk PRIMARY KEY (sales_date, channel)
)
COMMENT 'One row per day and channel, for finance.'
CLUSTER BY AUTO
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true', 'delta.enableRowTracking' = 'true')
AS
WITH days AS (
  SELECT explode(sequence(min(to_date(order_created_at)), max(to_date(order_created_at)))) AS sales_date
  FROM orders_clean
),
expected AS (                                   -- every entity that must have data, every day
  SELECT d.sales_date, c.channel FROM days d CROSS JOIN (VALUES ('POS'), ('APP')) AS c(channel)
),
daily AS (
  SELECT to_date(order_created_at) AS sales_date, channel,
         count(*) AS order_count, sum(net_amount) AS net_sales, max(order_created_at) AS last_order_ts
  FROM orders_clean GROUP BY ALL
),
joined AS (
  SELECT e.sales_date, e.channel,
         coalesce(d.order_count, 0) AS order_count,
         CAST(coalesce(d.net_sales, 0) AS DECIMAL(14,2)) AS net_sales,
         d.last_order_ts
  FROM expected e LEFT JOIN daily d USING (sales_date, channel)
)
SELECT sales_date, channel, order_count, net_sales,
       CAST(avg(net_sales) OVER (PARTITION BY channel ORDER BY sales_date
            ROWS BETWEEN 28 PRECEDING AND 1 PRECEDING) AS DECIMAL(14,2)) AS avg_net_sales_28d,
       last_order_ts
FROM joined;
