import type { Requirement, Result, Status } from '../../shared/judge';

/** what the UI shows for a requirement: a verdict, or where it is in the run */
export type Phase = Status | 'pending' | 'checking';

export const LABEL: Record<Phase, string> = {
  met: 'Met', partial: 'Partial', missing: 'Missing', not_applicable: 'N/A', pending: 'Waiting', checking: 'Checking',
};
export const ICON: Record<Phase, string> = {
  met: '✓', partial: '◐', missing: '✕', not_applicable: '–', pending: '○', checking: '',
};

export interface Row extends Requirement {
  phase: Phase;
  result?: Result;
}

export function rows(reqs: Requirement[], results: Result[], checking: string[]): Row[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  const busy = new Set(checking);
  return reqs.map((r) => {
    const result = byId.get(r.id);
    return { ...r, result, phase: result ? result.status : busy.has(r.id) ? 'checking' : 'pending' };
  });
}
