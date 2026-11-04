# Data quality monitoring, idempotent:
#  - anomaly detection on the schema: freshness and completeness for every table in it
#  - data profiling (time series) on the contracted table: column stats and drift
# DABs have no resource for schema anomaly detection, and a quality_monitors resource fails on the
# first deploy because the table doesn't exist yet, so the job enables both after the pipeline runs.
import argparse

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import AlreadyExists, NotFound, ResourceDoesNotExist
from databricks.sdk.service import dataquality as dq

p = argparse.ArgumentParser()
p.add_argument("--schema", required=True)
p.add_argument("--profile-table", required=True)
p.add_argument("--timestamp-column", required=True)
p.add_argument("--warehouse-id", required=True)
p.add_argument("--assets-dir", required=True, help="workspace folder for the profiling dashboard")
a = p.parse_args()

w = WorkspaceClient()
schema = w.schemas.get(a.schema)
table = w.tables.get(a.profile_table)


def current(object_type, object_id):
    try:
        return w.data_quality.get_monitor(object_type, object_id)
    except (NotFound, ResourceDoesNotExist):
        return None


# Schema: anomaly detection. Tables in the schema inherit it.
if current("schema", schema.schema_id) and current("schema", schema.schema_id).anomaly_detection_config is not None:
    print(f"anomaly detection already on: {a.schema}")
else:
    w.data_quality.create_monitor(
        dq.Monitor(object_type="schema", object_id=schema.schema_id, anomaly_detection_config=dq.AnomalyDetectionConfig())
    )
    print(f"anomaly detection enabled: {a.schema}")

# Table: data profiling. get_monitor on a table also returns the inherited anomaly detection config,
# so check for the profiling config itself.
m = current("table", table.table_id)
failed = m and m.data_profiling_config and m.data_profiling_config.status == dq.DataProfilingStatus.DATA_PROFILING_STATUS_FAILED
if failed:
    print(f"profiling monitor failed earlier ({m.data_profiling_config.latest_monitor_failure_message}); recreating")
    w.data_quality.delete_monitor("table", table.table_id)
if m and m.data_profiling_config is not None and not failed:
    try:
        w.data_quality.create_refresh("table", table.table_id, dq.Refresh(object_type="table", object_id=table.table_id))
        print(f"profiling refresh started: {a.profile_table}")
    except AlreadyExists:
        print(f"profiling refresh already pending: {a.profile_table}")
else:
    profiling = dq.DataProfilingConfig(
        output_schema_id=schema.schema_id,
        warehouse_id=a.warehouse_id,
        assets_dir=a.assets_dir,
        time_series=dq.TimeSeriesConfig(
            timestamp_column=a.timestamp_column,
            granularities=[dq.AggregationGranularity.AGGREGATION_GRANULARITY_1_DAY],
        ),
    )
    # the inherited anomaly detection view isn't a real table monitor, so this is always a create
    w.data_quality.create_monitor(dq.Monitor(object_type="table", object_id=table.table_id, data_profiling_config=profiling))
    print(f"profiling enabled (first refresh runs on its own): {a.profile_table}")
