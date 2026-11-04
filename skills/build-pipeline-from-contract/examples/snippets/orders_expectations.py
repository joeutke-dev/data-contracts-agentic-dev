# Python form of the same contract rules, for pipelines written in Python.
# warn -> @dp.expect, drop -> @dp.expect_or_drop, fail -> @dp.expect_or_fail. Names and exprs copied from the contract.
from pyspark import pipelines as dp


@dp.table(name="orders_checked", comment="One row per order")
@dp.expect("net_amount_non_negative", "net_amount >= 0")
@dp.expect_or_drop("valid_status", "order_status IN ('CREATED','PAID')")
@dp.expect_or_fail("order_id_present", "order_id IS NOT NULL")
def orders_checked():
    return spark.readStream.table("orders_raw")
