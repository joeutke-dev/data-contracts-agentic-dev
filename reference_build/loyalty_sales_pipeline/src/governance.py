# contract.domain / tags / version -> UC tags; access.readers -> grants. Runs after each pipeline update.
# Catalog access (USE CATALOG) is granted by the platform team, not by a data product.
import argparse

from pyspark.sql import SparkSession

p = argparse.ArgumentParser()
p.add_argument("--table", required=True)
p.add_argument("--reader-group", required=True)
p.add_argument("--tags", required=True, help="k=v,k=v; a bare k is a key-only tag")
a = p.parse_args()
spark = SparkSession.builder.getOrCreate()

pairs = [kv.split("=", 1) if "=" in kv else [kv, ""] for kv in a.tags.split(",")]
tags = ", ".join(f"'{k}' = '{v}'" for k, v in pairs)
spark.sql(f"ALTER MATERIALIZED VIEW {a.table} SET TAGS ({tags})")
schema = a.table.rsplit(".", 1)[0]
spark.sql(f"GRANT USE SCHEMA ON SCHEMA {schema} TO `{a.reader_group}`")
spark.sql(f"GRANT SELECT ON TABLE {a.table} TO `{a.reader_group}`")
print(f"tagged {a.table} ({tags}); granted SELECT to {a.reader_group}")
