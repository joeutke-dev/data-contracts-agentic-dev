// Contract Review: the contract on the left, the judge on the right. The contract renders as soon as its path is
// entered; the judge then rules on each requirement (met / partial / missing) and the verdicts fill in as they land.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import type { ContractView, JudgeReport, Result, RunState } from '../../shared/judge';
import { ContractPane } from './ContractPane';
import { JudgePane } from './JudgePane';
import { Mark } from './Mark';
import { rows as toRows } from './status';

interface Preset { label: string; bundlePath: string; contractPath: string; saved?: string }
interface Defaults { bundlePath: string; contractPath: string; model: string; presets: Preset[] }

const Started = z.object({ id: z.string().optional(), error: z.string().optional() });
const ApiError = z.object({ error: z.string() });
// our own API: the shapes are the shared types, so the cast is the contract between server and UI
const readJson = async <T,>(r: Response): Promise<T> => (await r.json()) as T;

// Loads the contract (debounced) whenever its path changes. State is keyed by path, so a stale answer is never shown
// for a new path and no state is set synchronously inside the effect.
function useContract(path: string) {
  const want = path.trim();
  const [got, setGot] = useState<{ path: string; contract: ContractView | null; error: string }>({ path: '', contract: null, error: '' });
  useEffect(() => {
    if (!want) return;
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/contract?path=${encodeURIComponent(want)}`)
        .then(async (r) => {
          if (!r.ok) {
            const e = ApiError.safeParse(await r.json());
            throw new Error(e.success ? e.data.error : r.statusText);
          }
          return readJson<ContractView>(r);
        })
        .then((c) => { if (live) setGot({ path: want, contract: c, error: '' }); })
        .catch((err: unknown) => { if (live) setGot({ path: want, contract: null, error: err instanceof Error ? err.message : String(err) }); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [want]);
  const current = got.path === want;
  return {
    contract: want ? got.contract : null,
    error: want && current ? got.error : '',
    loading: !!want && !current,
  };
}

export default function App() {
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [bundlePath, setBundlePath] = useState('');
  const [contractPath, setContractPath] = useState('');
  // a run belongs to the inputs it judged; changing either path hides its verdicts
  const [runFor, setRunFor] = useState<{ key: string; run: RunState } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const { contract, error, loading } = useContract(contractPath);

  // pick an example: set both paths; a saved example also shows its prerendered verdicts straight away
  const choose = useCallback((p: Preset) => {
    setContractPath(p.contractPath);
    setBundlePath(p.bundlePath);
    setFocus(null);
    if (!p.saved) return;
    fetch(`/api/judge/saved/${p.saved}`)
      .then((r) => readJson<JudgeReport>(r))
      .then((report) => setRunFor({ key: `${p.contractPath}\n${p.bundlePath}`, run: { state: 'done', report } }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch('/api/judge/defaults').then((r) => readJson<Defaults>(r)).then((d) => {
      setDefaults(d);
      // default to the first example (Contract demo); fall back to the configured paths
      if (d.presets[0]) choose(d.presets[0]);
      else { setBundlePath(d.bundlePath); setContractPath(d.contractPath); }
    }).catch(() => undefined);
  }, [choose]);

  const key = `${contractPath}\n${bundlePath}`;
  const preset = defaults?.presets.find((p) => p.contractPath === contractPath && p.bundlePath === bundlePath);
  const run = runFor && (runFor.key === key || runFor.run.state === 'running') ? runFor.run : null;

  const start = useCallback(async () => {
    const setRun = (r: RunState) => setRunFor({ key, run: r });
    setFocus(null);
    setRun({ state: 'running', step: 'Starting', startedAt: Date.now(), total: 0, checking: [], results: [] });
    try {
      const res = await fetch('/api/judge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundlePath, contractPath }) });
      const body = Started.parse(await res.json());
      if (!res.ok || !body.id) throw new Error(body.error ?? res.statusText);
      for (;;) {
        await new Promise((r) => setTimeout(r, 1200));
        const s = await readJson<RunState>(await fetch(`/api/judge/${body.id}`));
        setRun(s);
        if (s.state !== 'running') break;
      }
    } catch (err) {
      setRun({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [bundlePath, contractPath, key]);

  const running = run?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const report: JudgeReport | null = run?.state === 'done' ? run.report : null;
  const results: Result[] = useMemo(() => (run?.state === 'done' ? run.report.results : run?.state === 'running' ? run.results : []), [run]);
  const checking = useMemo(() => (run?.state === 'running' ? run.checking : []), [run]);
  const reqs = useMemo(() => contract?.requirements ?? [], [contract]);
  const rows = useMemo(() => toRows(reqs, results, checking), [reqs, results, checking]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const judged = results.length;
  const elapsed = run?.state === 'running' ? Math.max(0, Math.round((now - run.startedAt) / 1000)) : report ? Math.round(report.elapsedMs / 1000) : 0;
  const unverified = report ? report.results.flatMap((x) => x.evidence).filter((e) => !e.verified).length : 0;

  return (
    <div className="app">
      <header>
        <div className="brand"><Mark size={30} /><span>Contract Review</span></div>
        <div className="spacer" />
        {defaults && defaults.presets.length > 0 && (
          <label className="presets">
            Examples
            <select value={preset?.label ?? ''} onChange={(e) => {
              const p = defaults.presets.find((x) => x.label === e.target.value);
              if (p) choose(p);
            }} disabled={running}>
              {!preset && <option value="">Custom paths</option>}
              {defaults.presets.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </label>
        )}
      </header>

      <main className="split">
        <section className="pane">
          <div className="phead">
            <h2>Contract</h2>
            {contract && <span className="meta">{contract.contractName} · v{contract.contractVersion} · {reqs.length} requirements</span>}
          </div>
          <input className="path" aria-label="Contract path" value={contractPath} onChange={(e) => setContractPath(e.target.value)}
            placeholder="/Workspace/Users/you/contract/contract.yml" spellCheck={false} />
          <ContractPane contract={contract} error={error} loading={loading} rowsById={rowsById} focus={focus} onFocus={setFocus} />
        </section>

        <section className="pane">
          <div className="phead">
            <h2>Judge</h2>
            {report && <span className="meta">{report.files.length} files read · {elapsed}s{unverified ? ` · ${unverified} unverified citation${unverified === 1 ? '' : 's'}` : ''}</span>}
            {report?.savedAt && <span className="saved" title="Prerendered result. Run again to re-judge live.">Saved result · {new Date(report.savedAt).toLocaleDateString()}</span>}
          </div>
          <form className="runbar" onSubmit={(e) => { e.preventDefault(); if (!running) void start(); }}>
            <input className="path" aria-label="Bundle path" value={bundlePath} onChange={(e) => setBundlePath(e.target.value)}
              placeholder="/Workspace/Users/you/my_bundle" spellCheck={false} />
            <button className="primary" type="submit" disabled={running || !bundlePath || !contract}>
              {running ? 'Judging…' : report ? 'Run again' : 'Run judge'}
            </button>
          </form>
          {run?.state === 'running' && (
            <div className="progress" aria-live="polite">
              <div className="ptext"><span>{run.step}</span><span>{judged} of {run.total || reqs.length} checked · {elapsed}s</span></div>
              <div className="pbar"><i style={{ width: `${(judged / Math.max(1, run.total || reqs.length)) * 100}%` }} /></div>
            </div>
          )}
          {run?.state === 'error' && <div className="empty bad" role="alert">Judge failed: {run.message}</div>}
          {contract ? (
            <JudgePane rows={rows} focus={focus} onFocus={setFocus} summary={report?.summary ?? ''} />
          ) : (
            <div className="empty">Load a contract to see the requirements the judge will check.</div>
          )}
          {report && (
            <details className="files">
              <summary>Files the judge read ({report.files.length}){report.skipped.length ? `, ${report.skipped.length} skipped` : ''} · rubric: {report.rubric}</summary>
              <ul>{report.files.map((f) => <li key={f.path}>{f.path} <span className="dim">({f.lines} lines)</span></li>)}</ul>
            </details>
          )}
        </section>
      </main>
    </div>
  );
}
