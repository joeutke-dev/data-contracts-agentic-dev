// The LLM judge: contract + bundle files + review-skill rubric in, one verdict per contract requirement out.
import { z } from 'zod';
import type { ContractView, Evidence, JudgeReport, JudgedFile, Requirement, Result, Status } from '../../shared/judge';
import { readContract } from './requirements';
import { isDirectory, normalizePath, readBundle, readText } from './workspace';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Invoke = (body: Record<string, unknown>) => Promise<unknown>;

const STATUSES: Status[] = ['met', 'partial', 'missing', 'not_applicable'];
const numbered = (text: string) =>
  text.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
const stripFrontmatter = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, '');

async function loadRubric(skillPath: string | undefined): Promise<{ text: string; source: string }> {
  if (skillPath) {
    try {
      return { text: stripFrontmatter(await readText(normalizePath(skillPath))), source: skillPath };
    } catch {
      // fall through to the copy shipped with the app
    }
  }
  const bundled = await readFile(join(process.cwd(), 'server/judge/rubric.md'), 'utf8');
  return { text: stripFrontmatter(bundled), source: 'bundled copy of review-pipeline-against-contract' };
}

async function resolveContract(path: string): Promise<string> {
  const p = normalizePath(path);
  return (await isDirectory(p)) ? `${p}/contract.yml` : p;
}

export async function loadContract(path: string): Promise<ContractView> {
  const p = await resolveContract(path);
  return readContract(p, await readText(p));
}

// One batch of requirements per call: the contract and the whole bundle every time (a promise can be kept anywhere),
// but only these ids to rule on, so results stream back batch by batch.
function buildPrompt(contractText: string, batch: Requirement[], files: JudgedFile[]) {
  const reqList = batch.map((r) => `- ${r.id} [${r.section}]: ${r.requirement}`).join('\n');
  const fileBlocks = files.map((f) => `=== FILE: ${f.path} ===\n${numbered(f.text)}`).join('\n\n');
  return [
    'CONTRACT (contract.yml):',
    numbered(contractText),
    '',
    `BUNDLE FILES (${files.length}; line numbers on the left, cite them):`,
    fileBlocks,
    '',
    `RULE ON ONLY THESE ${batch.length} REQUIREMENTS (exactly one result per id, same ids, same order; ignore the rest of the contract):`,
    reqList,
    '',
    'Return only the JSON object described in the rubric. "summary" may be empty.',
  ].join('\n');
}

const BATCH = 5;
const CONCURRENCY = 4;

// batches never cross a contract section, so the UI fills in section by section
function batches(reqs: Requirement[]): Requirement[][] {
  const out: Requirement[][] = [];
  for (const r of reqs) {
    const last = out[out.length - 1];
    if (last && last.length < BATCH && last[0].section === r.section) last.push(r);
    else out.push([r]);
  }
  return out;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

// Chat completions content is a string, or (reasoning models) a list of blocks with text parts.
const Completion = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.union([z.string(), z.array(z.object({ text: z.string().optional() }).passthrough())]) }) })).min(1),
});
function messageText(resp: unknown): string {
  const c = Completion.parse(resp).choices[0].message.content;
  return typeof c === 'string' ? c : c.map((b) => b.text ?? '').join('');
}



// The judge's JSON, loosely: anything malformed becomes a "missing" verdict in merge() rather than a crash.
const Verdict = z.object({
  id: z.coerce.string(),
  status: z.string().optional(),
  evidence: z.array(z.object({ file: z.coerce.string(), lines: z.coerce.string(), snippet: z.coerce.string() }).partial()).optional(),
  explanation: z.coerce.string().optional(),
});
const JudgeOutput = z.object({ summary: z.coerce.string().optional(), results: z.array(z.unknown()).optional() });
type Verdict = z.infer<typeof Verdict>;

function parseJson(text: string): { summary: string; verdicts: Verdict[] } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('judge did not return JSON');
  const out = JudgeOutput.parse(JSON.parse(text.slice(start, end + 1)));
  const verdicts = (out.results ?? []).flatMap((r) => {
    const v = Verdict.safeParse(r);
    return v.success ? [v.data] : [];
  });
  return { summary: out.summary ?? '', verdicts };
}

// A citation is "verified" when every fragment of the snippet (split on ellipses, in case the model shortened
// it anyway) appears within a few lines of the cited range.
function verify(ev: { file: string; lines: string; snippet: string }, files: JudgedFile[]): boolean {
  const f = files.find((x) => x.path === ev.file || x.path.endsWith(`/${ev.file}`) || ev.file.endsWith(x.path));
  if (!f) return false;
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  const body = ev.snippet.split('\n').map((l) => l.replace(/^\s*\d+\|\s?/, '')).join(' ');
  const fragments = body.split(/\.\.\.|\u2026/).map(squash).filter((x) => x.length >= 4);
  if (!fragments.length) return false;
  const lines = f.text.split('\n');
  const m = ev.lines.match(/(\d+)(?:\s*-\s*(\d+))?/);
  const lo = m ? Math.max(0, Number(m[1]) - 4) : 0;
  const hi = m ? Math.min(lines.length, Number(m[2] ?? m[1]) + 3) : lines.length;
  const window = squash(lines.slice(lo, hi).join(' '));
  return fragments.every((x) => window.includes(x));
}

function merge(reqs: Requirement[], verdicts: Verdict[], files: JudgedFile[]): Result[] {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  return reqs.map((req) => {
    const r = byId.get(req.id);
    if (!r) return { ...req, status: 'missing', evidence: [], explanation: 'The judge returned no verdict for this requirement.' };
    const status = STATUSES.find((x) => x === r.status) ?? 'missing';
    const evidence: Evidence[] = (r.evidence ?? []).map((e) => {
      const ev = { file: e.file ?? '', lines: e.lines ?? '', snippet: e.snippet ?? '' };
      return { ...ev, verified: verify(ev, files) };
    });
    return { ...req, status, evidence, explanation: r.explanation ?? '' };
  });
}

export interface Progress {
  step: string;
  total: number;
  checking: string[];
  results: Result[];
}

export async function runJudge(
  input: { bundlePath: string; contractPath: string },
  invoke: Invoke,
  opts: { model: string; rubricPath?: string; onProgress: (p: Progress) => void },
): Promise<JudgeReport> {
  const t0 = Date.now();
  const progress: Progress = { step: 'Reading the contract', total: 0, checking: [], results: [] };
  const report = (patch: Partial<Progress>) => opts.onProgress(Object.assign(progress, patch));
  report({});

  const contract = await loadContract(input.contractPath);
  const reqs = contract.requirements;
  report({ step: 'Reading the bundle', total: reqs.length });
  const bundlePath = normalizePath(input.bundlePath);
  const { files, skipped } = await readBundle(bundlePath);
  if (!files.length) throw new Error(`no text files found under ${bundlePath}`);
  const rubric = await loadRubric(opts.rubricPath);

  // Work queue of batches, CONCURRENCY at a time, each reporting its verdicts as soon as it lands.
  const queue = batches(reqs);
  const done = new Map<string, Result>();
  const inFlight = new Set<string>();
  const publish = () =>
    report({
      step: `Checking requirements against ${files.length} files`,
      checking: [...inFlight],
      results: reqs.flatMap((r) => (done.has(r.id) ? [done.get(r.id) as Result] : [])),
    });
  const worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const batch = b;
      batch.forEach((r) => inFlight.add(r.id));
      publish();
      const verdicts = await withRetry(async () => {
        const resp = await invoke({
          messages: [
            { role: 'system', content: rubric.text },
            { role: 'user', content: buildPrompt(contract.text, batch, files) },
          ],
          max_tokens: 8000,
        });
        return parseJson(messageText(resp)).verdicts;
      });
      merge(batch, verdicts, files).forEach((r) => done.set(r.id, r));
      batch.forEach((r) => inFlight.delete(r.id));
      publish();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const results = reqs.map((r) => done.get(r.id) as Result);

  report({ step: 'Writing the summary', checking: [] });
  const summary = await summarize(results, invoke).catch(() => '');

  return {
    contractPath: contract.path,
    bundlePath,
    contractName: contract.contractName,
    contractVersion: contract.contractVersion,
    model: opts.model,
    rubric: rubric.source,
    summary,
    results,
    files: files.map((f) => ({ path: f.path, lines: f.text.split('\n').length })),
    skipped,
    elapsedMs: Date.now() - t0,
  };
}

// One sentence over the verdicts (no files), so the summary reflects every batch.
async function summarize(results: Result[], invoke: Invoke): Promise<string> {
  const lines = results.map((r) => `${r.status}\t${r.id}\t${r.explanation}`).join('\n');
  const resp = await invoke({
    messages: [
      {
        role: 'user',
        content:
          'These are an LLM judge\'s verdicts on whether a pipeline bundle meets its data contract. In one or two plain ' +
          'sentences, give the overall verdict and the most important gaps (or say none). No preamble.\n\n' + lines,
      },
    ],
    max_tokens: 1500,
  });
  return messageText(resp).trim();
}
