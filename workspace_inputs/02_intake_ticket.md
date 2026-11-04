# MKTG-4821: Daily store loyalty sales table for the 6 AM loyalty report

| Field | Value |
|---|---|
| Type | New data product |
| Requested by | Marketing Analytics lead |
| Priority | High |
| Due | 2026-11-14 (UAT), 2026-11-21 (prod) |
| Labels | loyalty, marketing, data-contract |

## Description

Marketing's morning loyalty report needs a trusted daily table of loyalty sales by store, ready before the 6 AM
Central refresh. Today the numbers come from an analyst's notebook that reads the raw POS feed, double counts
re-sent batches and breaks silently when the feed is late.

## Acceptance criteria

1. One row per store per day for every open store, including stores with no sales (shown as zero).
2. Duplicated POS records never reach the report. Raw records are kept for audit.
3. Alert when the data is more than 24 hours old, or when an open store has no sales for the latest day.
4. Store-days above 1.5x the store's 28-day average are flagged for investigation.
5. Marketing analysts (`marketing-analysts`) can query it; nobody needs member-level data.
6. Built from a data contract, reviewed against it before merge.

## Links

- Requirements interview notes: `01_requirements_meeting_notes.md`
- Contract template: the `build-contract` skill
