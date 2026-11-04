#!/usr/bin/env bash
# Data contracts demo setup.
#
#   PROFILE=my-profile CATALOG=my_catalog WAREHOUSE_ID=abc123 ./setup.sh <command>
#
# Settings (environment variables):
#   PROFILE       Databricks CLI profile                          (default: DEFAULT)
#   CATALOG       Unity Catalog catalog for the demo schemas      (default: main)
#   WAREHOUSE_ID  SQL warehouse for the alerts and data profiling (required for pipeline, append, all)
#
# Commands:
#   skills      upload the four skills to your Genie Code user skills folder (~/.assistant/skills)
#   inputs      create the workspace demo folder with only the inputs (meeting notes, ticket)
#   source      deploy the source-data bundle and generate 60 days of synthetic data
#   reference   upload the reference build (contract, PRD, pipeline bundle, broken copy) to a folder the app can read
#   pipeline    deploy and run the reference pipeline bundle (pipeline -> governance + DQM, about 6 minutes)
#   app         deploy and start the Contract Review app, then grant its service principal read access
#   grant-app   give the app's service principal CAN_READ on the demo, reference and skill folders,
#               plus any folders passed after it: ./setup.sh grant-app /Workspace/Users/you/other_bundle
#   append      morning of the demo: add the missing days of source data and rerun the reference pipeline
#   reset-demo  clear contract/ and the Genie-built bundle from the demo folder (keeps inputs)
#   all         skills, inputs, source, reference, pipeline, app
set -euo pipefail
PROFILE=${PROFILE:-DEFAULT}
CATALOG=${CATALOG:-main}
HERE=$(cd "$(dirname "$0")" && pwd)
SKILL_NAMES="build-contract build-prd build-pipeline-from-contract review-pipeline-against-contract"
BUNDLE_VARS=(--var "catalog=$CATALOG")

usage() { sed -n '2,22p' "$0"; exit 1; }
case "${1:-}" in
  skills|inputs|source|reference|pipeline|app|grant-app|append|reset-demo|all) ;;
  *) usage ;;
esac

ME=$(databricks current-user me -p "$PROFILE" -o json | jq -r .userName)
SKILLS=/Users/$ME/.assistant/skills
DEMO=/Users/$ME/data-contracts-demo
REF=/Users/$ME/data-contracts-reference

# The notes, contract and bundles are written against the `main` catalog. Upload a copy that uses $CATALOG instead.
rendered() {   # rendered <dir> -> path of a temp copy with main.dc_loyalty* and the catalog default rewritten
  local out
  out=$(mktemp -d)
  cp -R "$1/." "$out"
  if [[ "$CATALOG" != main ]]; then
    find "$out" -type f \( -name '*.yml' -o -name '*.md' -o -name '*.sql' \) -print0 |
      xargs -0 perl -pi -e "s/\\bmain\\.dc_loyalty/${CATALOG}.dc_loyalty/g; s/^(    default: )main\$/\${1}${CATALOG}/"
  fi
  echo "$out"
}

skills() {
  for s in $SKILL_NAMES; do
    databricks workspace import-dir "$HERE/skills/$s" "$SKILLS/$s" --overwrite -p "$PROFILE" >/dev/null
    echo "skill: $SKILLS/$s"
  done
}
inputs() {
  local src
  src=$(rendered "$HERE/workspace_inputs")
  databricks workspace mkdirs "$DEMO/inputs" -p "$PROFILE"
  databricks workspace import-dir "$src" "$DEMO/inputs" --overwrite -p "$PROFILE" >/dev/null
  echo "inputs: $DEMO/inputs"
}
source_data() {
  (cd "$HERE/source_data" &&
    databricks bundle deploy -p "$PROFILE" "${BUNDLE_VARS[@]}" &&
    databricks bundle run generate_source_data -p "$PROFILE" "${BUNDLE_VARS[@]}")
}
reference() {
  local src
  src=$(rendered "$HERE/reference_build")
  databricks workspace mkdirs "$REF" -p "$PROFILE"
  databricks workspace import-dir "$src" "$REF" --overwrite -p "$PROFILE" >/dev/null
  echo "reference: $REF/contract/contract.yml, $REF/loyalty_sales_pipeline, $REF/loyalty_sales_pipeline_broken"
}
pipeline() {
  : "${WAREHOUSE_ID:?set WAREHOUSE_ID to a SQL warehouse id}"
  (cd "$HERE/reference_build/loyalty_sales_pipeline" &&
    databricks bundle deploy -p "$PROFILE" "${BUNDLE_VARS[@]}" --var "warehouse_id=$WAREHOUSE_ID" &&
    databricks bundle run loyalty_sales_refresh -p "$PROFILE" "${BUNDLE_VARS[@]}" --var "warehouse_id=$WAREHOUSE_ID")
}
app() {
  (cd "$HERE/contract_review_app" && databricks bundle deploy -p "$PROFILE" && databricks bundle run app -p "$PROFILE")
  grant_app
}
grant_app() {   # extra args: more workspace folders the judge should be able to read
  local sp
  sp=$(databricks apps get contract-review -p "$PROFILE" -o json | jq -r .service_principal_client_id)
  databricks workspace mkdirs "$DEMO" -p "$PROFILE"
  databricks workspace mkdirs "$REF" -p "$PROFILE"
  for d in "$DEMO" "$REF" "$SKILLS/review-pipeline-against-contract" "$@"; do
    d=${d#/Workspace}
    local id
    id=$(databricks workspace get-status "$d" -p "$PROFILE" -o json | jq -r .object_id)
    databricks workspace update-permissions directories "$id" -p "$PROFILE" \
      --json "{\"access_control_list\":[{\"service_principal_name\":\"$sp\",\"permission_level\":\"CAN_READ\"}]}" >/dev/null
    echo "app SP $sp: CAN_READ on $d"
  done
}
append() {
  : "${WAREHOUSE_ID:?set WAREHOUSE_ID to a SQL warehouse id}"
  (cd "$HERE/source_data" &&
    databricks bundle run generate_source_data -p "$PROFILE" "${BUNDLE_VARS[@]}" --params mode=append)
  (cd "$HERE/reference_build/loyalty_sales_pipeline" &&
    databricks bundle run loyalty_sales_refresh -p "$PROFILE" "${BUNDLE_VARS[@]}" --var "warehouse_id=$WAREHOUSE_ID")
}
reset_demo() {
  for d in contract loyalty_sales_pipeline; do
    databricks workspace delete "$DEMO/$d" --recursive -p "$PROFILE" 2>/dev/null && echo "removed $DEMO/$d" || true
  done
}

case "$1" in
  skills) skills ;;
  inputs) inputs ;;
  source) source_data ;;
  reference) reference ;;
  pipeline) pipeline ;;
  app) app ;;
  grant-app) shift; grant_app "$@" ;;
  append) append ;;
  reset-demo) reset_demo ;;
  all) : "${WAREHOUSE_ID:?set WAREHOUSE_ID to a SQL warehouse id}"; skills; inputs; source_data; reference; pipeline; app ;;
esac
