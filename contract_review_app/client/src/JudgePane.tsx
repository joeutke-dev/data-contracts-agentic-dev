// Right pane: one card per contract requirement, filled in batch by batch as the judge rules.
import { useEffect, useRef, useState } from 'react';
import type { Evidence } from '../../shared/judge';
import { ICON, LABEL, type Phase, type Row } from './status';

const SECTIONS = ['contract', 'table', 'columns', 'expectations', 'slo', 'access', 'changes'];
const GAP: Phase[] = ['partial', 'missing'];

// strip the indentation the snippet's lines share, so a nested YAML line reads flush left
function dedent(s: string) {
  const lines = s.replace(/\s+$/, '').split('\n');
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)?.[0].length ?? 0));
  return lines.map((l) => l.slice(pad)).join('\n');
}

function EvidenceItem({ e }: { e: Evidence }) {
  return (
    <div className="ev">
      <div className="evhead">
        <span className="file">{e.file}:{e.lines}</span>
        <span className={`chk ${e.verified ? 'ok' : 'no'}`} title={e.verified ? 'snippet found at the cited lines' : 'snippet not found at the cited lines: check by hand'}>
          {e.verified ? 'verified' : 'unverified'}
        </span>
      </div>
      {e.snippet && <pre className="snip">{dedent(e.snippet)}</pre>}
    </div>
  );
}

function Card({ r, focused, onFocus }: { r: Row; focused: boolean; onFocus: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const showEvidence = open || (r.result ? GAP.includes(r.phase) : false);
  return (
    <article className={`card ph-${r.phase} ${focused ? 'focus' : ''}`} data-req={r.id} onClick={() => onFocus(r.id)}>
      <div className="chead">
        <span className={`badge ph-${r.phase}`}>
          {r.phase === 'checking' ? <span className="spin" aria-hidden /> : <span aria-hidden>{ICON[r.phase]}</span>}
          {LABEL[r.phase]}
        </span>
        <span className="rid">{r.id}</span>
        <span className="lines">line {r.line === r.endLine ? r.line : `${r.line}–${r.endLine}`}</span>
      </div>
      <div className="rtext">{r.requirement}</div>
      {r.result && (
        <>
          <p className="expl">{r.result.explanation}</p>
          {r.result.evidence.length > 0 && (
            <div className="evidence">
              <button type="button" className="link" onClick={(ev) => { ev.stopPropagation(); setOpen(!showEvidence); }}>
                {showEvidence ? 'Hide' : 'Show'} evidence ({r.result.evidence.length})
              </button>
              {showEvidence && r.result.evidence.map((e) => <EvidenceItem key={`${e.file}:${e.lines}:${e.snippet.slice(0, 40)}`} e={e} />)}
            </div>
          )}
        </>
      )}
    </article>
  );
}

type Filter = 'all' | 'gaps';

export function JudgePane({ rows, focus, onFocus, summary }: {
  rows: Row[];
  focus: string | null;
  onFocus: (id: string) => void;
  summary: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const count = (p: Phase) => rows.filter((r) => r.phase === p).length;
  const judged = rows.filter((r) => r.result).length;
  const checkable = rows.filter((r) => r.result && r.phase !== 'not_applicable').length;
  const pct = checkable ? Math.round((count('met') / checkable) * 100) : 0;
  const shown = filter === 'gaps' ? rows.filter((r) => GAP.includes(r.phase)) : rows;
  const sections = SECTIONS.concat([...new Set(rows.map((r) => r.section))].filter((s) => !SECTIONS.includes(s)));

  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) list.current?.querySelector(`[data-req="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus]);

  return (
    <>
      <div className="tally">
        {(['met', 'partial', 'missing', 'not_applicable'] as Phase[]).map((p) => (
          <div key={p} className={`stat ph-${p}`}><span className="n">{count(p)}</span><span className="l">{LABEL[p]}</span></div>
        ))}
        <div className="stat cov">
          <span className="n">{judged ? `${pct}%` : '–'}</span><span className="l">coverage</span>
          <div className="bar" role="img" aria-label={`${pct}% of checkable requirements met`}>
            {(['met', 'partial', 'missing'] as Phase[]).map((p) => (
              <i key={p} className={`ph-${p}`} style={{ width: `${checkable ? (count(p) / checkable) * 100 : 0}%` }} />
            ))}
          </div>
        </div>
      </div>
      {summary && <div className="summary"><span className="who">Judge summary</span>{summary}</div>}
      <div className="filters">
        <div className="seg" role="group" aria-label="Filter requirements">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All {rows.length}</button>
          <button type="button" aria-pressed={filter === 'gaps'} onClick={() => setFilter('gaps')}>Gaps {count('partial') + count('missing')}</button>
        </div>
      </div>
      <div className="cards" ref={list}>
        {filter === 'gaps' && shown.length === 0 && <div className="empty">{judged ? 'No gaps: every checkable requirement is met.' : 'No verdicts yet.'}</div>}
        {sections.map((s) => {
          const rs = shown.filter((r) => r.section === s);
          if (!rs.length) return null;
          const gaps = rs.filter((r) => GAP.includes(r.phase)).length;
          return (
            <section key={s} className="group">
              <h4>{s}<span className="hint">{rs.length}</span>{gaps > 0 && <span className="gapcount">{gaps} gap{gaps === 1 ? '' : 's'}</span>}</h4>
              {rs.map((r) => <Card key={r.id} r={r} focused={focus === r.id} onFocus={onFocus} />)}
            </section>
          );
        })}
      </div>
    </>
  );
}
