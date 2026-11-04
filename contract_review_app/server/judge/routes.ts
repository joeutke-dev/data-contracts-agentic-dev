// POST /api/judge starts a run and returns its id; GET /api/judge/:id polls it.
// Runs take a minute or two, longer than a proxied request should stay open.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'express';
import type { Application } from 'express';
import { z } from 'zod';
import type { Result, RunState } from '../../shared/judge';
import { loadContract, runJudge, type Invoke } from './judge';

const Body = z.object({ bundlePath: z.string().min(2), contractPath: z.string().min(2) });
const runs = new Map<string, RunState>();

export function registerJudgeRoutes(app: Application, invoke: Invoke) {
  const model = process.env.DATABRICKS_SERVING_ENDPOINT_NAME ?? 'unknown';
  // JUDGE_PRESETS: JSON list of {label, bundlePath, contractPath} shown as one-click inputs
  // a preset with `saved` opens a prerendered report (server/judge/saved/<saved>.json) instead of waiting on the judge
  const Presets = z.array(z.object({ label: z.string(), bundlePath: z.string(), contractPath: z.string(), saved: z.string().optional() }));
  const presets = Presets.safeParse(JSON.parse(process.env.JUDGE_PRESETS ?? '[]'));
  const defaults = {
    bundlePath: process.env.DEFAULT_BUNDLE_PATH ?? '',
    contractPath: process.env.DEFAULT_CONTRACT_PATH ?? '',
    model,
    presets: presets.success ? presets.data : [],
  };
  app.get('/api/judge/defaults', (_req, res) => res.json(defaults));

  app.get('/api/judge/saved/:name', (req, res) => {
    const name = req.params.name;
    if (!/^[a-z0-9-]+$/.test(name)) return void res.status(400).json({ error: 'bad name' });
    readFile(join(process.cwd(), 'server/judge/saved', `${name}.json`), 'utf8')
      .then((text) => res.type('json').send(text))
      .catch(() => res.status(404).json({ error: `no saved report ${name}` }));
  });

  // the contract as text + the requirements it implies, so the UI can show it before any judging
  app.get('/api/contract', (req, res) => {
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    if (!path) return void res.status(400).json({ error: 'path is required' });
    loadContract(path)
      .then((c) => res.json(c))
      .catch((err: unknown) => res.status(404).json({ error: err instanceof Error ? err.message : String(err) }));
  });

  app.post('/api/judge', express.json(), (req, res) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'bundlePath and contractPath are required' });
    const id = randomUUID();
    const startedAt = Date.now();
    runs.set(id, { state: 'running', step: 'Starting', startedAt, total: 0, checking: [], results: [] });
    const onProgress = (p: { step: string; total: number; checking: string[]; results: Result[] }) => {
      if (runs.get(id)?.state === 'running') runs.set(id, { state: 'running', startedAt, ...p, checking: [...p.checking], results: [...p.results] });
    };
    runJudge(body.data, invoke, { model, rubricPath: process.env.REVIEW_SKILL_PATH, onProgress })
      .then((report) => runs.set(id, { state: 'done', report }))
      .catch((err: unknown) => runs.set(id, { state: 'error', message: err instanceof Error ? err.message : String(err) }));
    res.json({ id });
  });

  app.get('/api/judge/:id', (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) return void res.status(404).json({ error: 'unknown run' });
    res.json(run);
  });
}
