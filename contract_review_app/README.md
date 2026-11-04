# Contract Review (contract-review)

AppKit app that checks a pipeline bundle (DAB) against its data contract with an LLM judge. The contract is on the
left, the judge on the right; the icon is `client/public/favicon.svg` (the repo logo, `docs/images/logo.svg`: a contract with a signed seal
in the Databricks product-icon style; PNGs rendered with `rsvg-convert`).

1. You enter a `contract.yml` path: `GET /api/contract` returns the YAML and the requirements it implies, and the left
   pane renders it with a marker on each requirement's lines.
2. `server/judge/requirements.ts` turns the contract into a fixed list of requirements (every column, expectation,
   SLO key and access entry) with their line ranges, so the LLM can't skip one. Keys outside the template become
   generic requirements ("judged on what it states"), so any contract is judged on everything it says.
3. `server/judge/workspace.ts` reads every text file in the bundle as the app's service principal.
4. `server/judge/judge.ts` judges in batches of up to 5 requirements (never crossing a contract section), 4 batches at
   a time. Each call gets the contract and every numbered bundle file but rules only on its batch, so verdicts
   stream into the UI as batches finish (about 30-40s for 40-50 requirements). A last small call writes the summary
   from the verdicts. Model: `databricks-claude-sonnet-5-5`. The system prompt is the
   `review-pipeline-against-contract` skill, read live from the workspace (`REVIEW_SKILL_PATH`), with
   `server/judge/rubric.md` as the fallback copy.
5. Each verdict (met / partial / missing / n/a) comes back with file:line evidence. The server checks every snippet
   against the file and marks it verified or unverified.

Runs are async: `POST /api/judge` returns an id, and `GET /api/judge/:id` returns the verdicts so far plus the ids being checked.

```bash
npm run dev                                                    # local, uses .env (DATABRICKS_CONFIG_PROFILE etc.)
PROFILE=my-profile ../setup.sh app                            # bundle deploy + run, then grant the SP CAN_READ
```

Works with any bundle folder and any contract in the template's shape. The app reads as its service principal, so
grant it each folder first: `../setup.sh grant-app /Workspace/Users/you/folder`. Bundles are capped at 80 text files
and 400 KB total (the rest is listed as skipped).

Config lives in `databricks.yml` (`config.env`, so there is no `app.yaml`): `DEFAULT_BUNDLE_PATH`,
`DEFAULT_CONTRACT_PATH`, `REVIEW_SKILL_PATH`, and `JUDGE_PRESETS` (the Examples menu: **Contract demo**, the default,
and **Mixed results**). The paths default to the deploying user's `data-contracts-demo` and `data-contracts-reference`
folders; override them with the bundle variables `demo_root`, `reference_root` and `review_skill_path`. An entry with `saved: <name>` opens the
prerendered report `server/judge/saved/<name>.json` instantly; re-save it by running the judge and writing `.report`
plus a `savedAt` timestamp to that file.