# Synthetic retail loyalty sources, deterministic per day so reruns match.
#   stores                    200 stores, 8 CLOSED
#   loyalty_members           40,000 members
#   pos_loyalty_transactions  ~60 txns per open store per day, plus the problems the contract has to catch:
#     ~3% re-sent duplicates (same member_id + txn_ts + location_number, later delivered_at)
#     ~0.5% missing member_id, ~1% VOIDED, ~0.3% negative net_amount
#     latest day: stores 1007, 1042, 1133 send nothing (completeness), store 1088 sells 2.4x (outlier)
import argparse

from pyspark.sql import SparkSession

p = argparse.ArgumentParser()
p.add_argument("--catalog", required=True)
p.add_argument("--schema", required=True)
p.add_argument("--mode", choices=["reset", "append"], default="reset")
p.add_argument("--days", type=int, default=60)
a = p.parse_args()
spark = SparkSession.builder.getOrCreate()
s = f"{a.catalog}.{a.schema}"
TZ = "America/Chicago"

spark.sql(f"""
CREATE OR REPLACE TABLE {s}.stores AS
SELECT
  CAST(1000 + id AS INT) AS location_number,
  concat('Store #', 1000 + id) AS store_name,
  element_at(array('Dallas','Plano','Irving','Fort Worth','Arlington','Austin','Houston','San Antonio'), CAST(id % 8 + 1 AS INT)) AS city,
  'TX' AS state,
  element_at(array('North Texas','North Texas','North Texas','North Texas','North Texas','Central Texas','Gulf Coast','Central Texas'), CAST(id % 8 + 1 AS INT)) AS region,
  CASE WHEN id IN (13, 57, 91, 120, 144, 166, 181, 199) THEN 'CLOSED' ELSE 'OPEN' END AS store_status,
  date_sub(current_date(), 400 + CAST(id * 7 AS INT)) AS open_date
FROM range(1, 201)
""")

spark.sql(f"""
CREATE OR REPLACE TABLE {s}.loyalty_members AS
SELECT
  concat('M', lpad(CAST(id AS STRING), 7, '0')) AS member_id,
  element_at(array('Basic','Basic','Basic','Silver','Silver','Gold'), CAST(id % 6 + 1 AS INT)) AS tier,
  timestamp_seconds(1640995200 + id * 3313) AS enrolled_at
FROM range(1, 40001)
""")

yesterday = spark.sql(f"SELECT to_date(from_utc_timestamp(current_timestamp(), '{TZ}')) - 1 AS d").first().d
txn = f"{s}.pos_loyalty_transactions"
if a.mode == "append" and spark.catalog.tableExists(txn):
    last = spark.sql(f"SELECT max(to_date(txn_ts)) AS d FROM {txn}").first().d
    start = last + __import__("datetime").timedelta(days=1)
else:
    start = yesterday - __import__("datetime").timedelta(days=a.days - 1)
if start > yesterday:
    print(f"nothing to add: data already through {yesterday}")
    raise SystemExit(0)

# One row per store-day-slot, then a stable hash drives every random choice.
batch = spark.sql(f"""
WITH days AS (
  SELECT explode(sequence(DATE'{start}', DATE'{yesterday}')) AS d
),
store_days AS (
  SELECT st.location_number, days.d,
         CAST(45 + abs(hash(st.location_number)) % 30 AS INT) AS base_n,
         days.d = DATE'{yesterday}' AS is_latest
  FROM {s}.stores st CROSS JOIN days
  WHERE st.store_status = 'OPEN'
),
slots AS (
  SELECT location_number, d, n, explode(sequence(1, greatest(n, 1))) AS slot  -- sequence(1, 0) counts down, so floor at 1
  FROM (
    SELECT location_number, d,
           CASE WHEN is_latest AND location_number IN (1007, 1042, 1133) THEN 0
                WHEN is_latest AND location_number = 1088 THEN CAST(base_n * 2.4 AS INT)
                ELSE base_n + CAST(abs(hash(location_number, d)) % 15 AS INT) END AS n
    FROM store_days)
),
base AS (
  SELECT
    concat('T', date_format(d, 'yyyyMMdd'), '-', location_number, '-', lpad(CAST(slot AS STRING), 4, '0')) AS txn_id,
    abs(hash(location_number, d, slot)) AS h,
    location_number, d, slot
  FROM slots WHERE slot <= n
),
txns AS (
  SELECT
    txn_id,
    CASE WHEN h % 200 = 0 THEN NULL ELSE concat('M', lpad(CAST(h % 40000 + 1 AS STRING), 7, '0')) END AS member_id,
    location_number,
    to_utc_timestamp(timestamp_seconds(unix_timestamp(CAST(d AS TIMESTAMP)) + 18000 + h % 64800), '{TZ}') AS txn_ts,
    CAST((h % 4000) / 100.0 + 1.5 AS DECIMAL(12,2)) AS gross_amount,
    CAST(CASE WHEN h % 3 = 0 THEN ((h / 7) % 300) / 100.0 ELSE 0 END AS DECIMAL(12,2)) AS discount_amount,
    CASE WHEN h % 5 = 0 THEN 'APP' ELSE 'POS' END AS channel,
    CASE WHEN h % 100 = 7 THEN 'VOIDED' ELSE 'COMPLETED' END AS txn_status,
    h
  FROM base
),
priced AS (
  SELECT txn_id, member_id, location_number, txn_ts, gross_amount, discount_amount,
         CASE WHEN h % 333 = 5 THEN CAST(-gross_amount AS DECIMAL(12,2))
              ELSE CAST(gross_amount - discount_amount AS DECIMAL(12,2)) END AS net_amount,
         channel, txn_status, txn_ts + INTERVAL 20 MINUTES AS delivered_at, h
  FROM txns
)
SELECT txn_id, member_id, location_number, txn_ts, gross_amount, discount_amount, net_amount, channel, txn_status, delivered_at
FROM priced
UNION ALL  -- re-sent batch: same business key, new delivery time
SELECT txn_id, member_id, location_number, txn_ts, gross_amount, discount_amount, net_amount, channel, txn_status,
       delivered_at + INTERVAL 3 HOURS AS delivered_at
FROM priced WHERE h % 33 = 0
""")

if a.mode == "reset" or not spark.catalog.tableExists(txn):
    spark.sql(f"DROP TABLE IF EXISTS {txn}")
    batch.write.option("delta.enableChangeDataFeed", "true").saveAsTable(txn)
    spark.sql(f"COMMENT ON TABLE {txn} IS 'POS loyalty feed, append-only. Re-sent batches create duplicates.'")
else:
    batch.write.mode("append").saveAsTable(txn)

n = spark.sql(f"SELECT count(*) c, min(to_date(txn_ts)) lo, max(to_date(txn_ts)) hi FROM {txn}").first()
print(f"{a.mode}: added {start}..{yesterday}; table now {n.c} rows, {n.lo}..{n.hi}")
