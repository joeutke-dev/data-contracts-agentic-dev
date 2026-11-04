// Left pane: contract.yml with line numbers; each requirement's lines are tinted with its verdict as the judge runs.
import { useEffect, useMemo, useRef } from 'react';
import type { ContractView } from '../../shared/judge';
import { ICON, type Phase, type Row } from './status';

// several requirements can start on one line: show one marker, the one that most needs attention
const ORDER: Phase[] = ['missing', 'partial', 'checking', 'pending', 'met', 'not_applicable'];
const worst = (rows: Row[]): Phase => ORDER.find((p) => rows.some((r) => r.phase === p)) ?? 'pending';

// light YAML colouring: keys, list dashes, quoted strings, comments
function Line({ text }: { text: string }) {
  let i = 0;
  let quote = '';
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) break;
  }
  const code = text.slice(0, i);
  const comment = text.slice(i);
  const m = code.match(/^(\s*)(- )?([\w.-]+)(:)(.*)$/);
  return (
    <>
      {m ? (
        <>
          {m[1]}{m[2] && <span className="y-dash">{m[2]}</span>}<span className="y-key">{m[3]}</span>{m[4]}
          <span className="y-val">{m[5]}</span>
        </>
      ) : (
        <span className="y-val">{code}</span>
      )}
      {comment && <span className="y-cmt">{comment}</span>}
    </>
  );
}

export function ContractPane({ contract, error, loading, rowsById, focus, onFocus }: {
  contract: ContractView | null;
  error: string;
  loading: boolean;
  rowsById: Map<string, Row>;
  focus: string | null;
  onFocus: (id: string) => void;
}) {
  const lines = useMemo(() => contract?.text.replace(/\n$/, '').split('\n') ?? [], [contract]);

  // each line belongs to the narrowest requirement that covers it; markers go on a requirement's first line
  const { owner, starts } = useMemo(() => {
    const own = new Map<number, Row>();
    const st = new Map<number, Row[]>();
    const all = [...rowsById.values()].sort((a, b) => (b.endLine - b.line) - (a.endLine - a.line));
    for (const r of all) {
      for (let l = r.line; l <= r.endLine; l++) own.set(l, r);
      st.set(r.line, [...(st.get(r.line) ?? []), r]);
    }
    return { owner: own, starts: st };
  }, [rowsById]);

  const box = useRef<HTMLDivElement>(null);
  const focused = focus ? rowsById.get(focus) : undefined;
  useEffect(() => {
    if (!focused) return;
    box.current?.querySelector(`[data-line="${focused.line}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  if (error) return <div className="empty bad">{error}</div>;
  if (loading && !contract) return <div className="empty">Loading the contract…</div>;
  if (!contract) return <div className="empty">Enter the path to a contract.yml to see it here.</div>;

  return (
    <div className="yaml" ref={box}>
      {lines.map((text, n) => {
        const ln = n + 1;
        const own = owner.get(ln);
        const inFocus = focused && ln >= focused.line && ln <= focused.endLine;
        const marks = starts.get(ln) ?? [];
        return (
          <div
            key={ln}
            data-line={ln}
            className={`yl ${own ? `ph-${own.phase} has-req` : ''} ${inFocus ? 'focus' : ''}`}
            onClick={own ? () => onFocus(own.id) : undefined}
            title={own ? `${own.id}: ${own.requirement}` : undefined}
          >
            <span className="ln">{ln}</span>
            <span className="mk">
              {marks.length > 0 && (() => {
                const phase = worst(marks);
                return (
                  <span className={`dot ph-${phase}`} title={marks.map((r) => `${r.id}: ${r.phase}`).join('\n')}>
                    {ICON[phase]}
                  </span>
                );
              })()}
            </span>
            <span className="code"><Line text={text} /></span>
          </div>
        );
      })}
    </div>
  );
}
