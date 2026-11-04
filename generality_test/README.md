# Judge on an unrelated contract

`contract.yml` is an orders contract (deck template keys only) with two promises the bundle doesn't keep:
a `refund_amount` column and a `net_sales_non_negative` expectation. The bundle is the `build-pipeline-from-contract`
skill's example (`../skills/build-pipeline-from-contract/examples`), which was never written against this contract.

```bash
T=/Users/<you>/data-contracts-test
databricks workspace import-dir ../skills/build-pipeline-from-contract/examples $T/orders_pipeline --overwrite
databricks workspace import $T/contract.yml --file contract.yml --format AUTO --overwrite
../setup.sh grant-app $T
```

Result on 2026-10-27: 25 requirements, 21 met, 1 partial, 2 missing, 1 n/a in 25s; all 39 citations verified. The
2 missing are the planted ones. The judge also caught two real problems in the skill example (SQL outside the
pipeline's glob, contract tags not applied), both since fixed.
