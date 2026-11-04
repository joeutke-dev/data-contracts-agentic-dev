// Turns contract.yml into the fixed list of requirements the judge must rule on, each with the line range that states
// it. The list is deterministic so a requirement can't go missing just because the LLM skipped it.
import { isMap, isScalar, LineCounter, parseDocument, type Document } from 'yaml';
import type { ContractView, Requirement } from '../../shared/judge';

type Obj = Record<string, unknown>;
type Path = (string | number)[];
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(str).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v as string | number | boolean | bigint);
};
const blank = (v: unknown) => str(v).trim() === '';

// line range of the YAML nodes at the given paths (a key whose value is blank falls back to its parent)
function linesOf(doc: Document, lc: LineCounter, paths: Path[]): { line: number; endLine: number } {
  let line = Infinity;
  let endLine = 0;
  for (const p of paths) {
    let node: unknown = doc.getIn(p, true);
    for (let up = p.length - 1; (!node || !hasRange(node)) && up > 0; up--) node = doc.getIn(p.slice(0, up), true);
    if (!hasRange(node)) continue;
    const [start, valueEnd] = node.range;
    line = Math.min(line, lc.linePos(start).line);
    endLine = Math.max(endLine, lc.linePos(Math.max(start, valueEnd - 1)).line);
  }
  return line === Infinity ? { line: 1, endLine: 1 } : { line, endLine: Math.max(line, endLine) };
}
// the line of a top-level key itself (`slo:`), for requirements about a whole section
function keyLine(doc: Document, lc: LineCounter, key: string): { line: number; endLine: number } | null {
  if (!isMap(doc.contents)) return null;
  const pair = doc.contents.items.find((it) => isScalar(it.key) && it.key.value === key);
  const r = pair && isScalar(pair.key) ? pair.key.range : undefined;
  if (!r) return null;
  const line = lc.linePos(r[0]).line;
  return { line, endLine: line };
}

const hasRange = (n: unknown): n is { range: [number, number, number] } =>
  typeof n === 'object' && n !== null && 'range' in n && Array.isArray((n as { range: unknown }).range);

// Keys of the contract template. Keys checked above, plus descriptive ones code can't implement
// (owner, status, layer...). Everything else in a contract becomes a generic requirement.
const TEMPLATE: Record<string, string[] | '*'> = {
  contract: ['name', 'version', 'status', 'owner', 'support', 'domain', 'certified', 'tags', 'description'],
  table: ['name', 'layer', 'type', 'primary_key', 'scd_type', 'sequence_by', 'cluster_by', 'cdf', 'row_tracking'],
  slo: ['refresh', 'freshness', 'completeness', 'alert'],
  columns: '*',
  expectations: '*',
  access: ['readers', 'pii'],
  changes: '*',
};

export function readContract(path: string, text: string): ContractView {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc });
  if (doc.errors.length) throw new Error(`contract.yml is not valid YAML: ${doc.errors[0].message}`);
  const contract: unknown = doc.toJS();
  if (!isObj(contract)) throw new Error('contract.yml did not parse to a mapping');

  const out: Requirement[] = [];
  const add = (section: string, id: string, requirement: string, ...paths: Path[]) =>
    out.push({ id, section, requirement, ...linesOf(doc, lc, paths) });

  const c = isObj(contract.contract) ? contract.contract : {};
  const t = isObj(contract.table) ? contract.table : {};
  const slo = isObj(contract.slo) ? contract.slo : {};
  const access = isObj(contract.access) ? contract.access : {};

  if (!blank(c.description))
    add('contract', 'contract.description', `Table comment carries the description: "${str(c.description)}"`, ['contract', 'description']);
  if (!blank(c.domain) || list(c.tags).length)
    add('contract', 'contract.tags', `Tagged domain=${str(c.domain)}, tags [${str(c.tags)}], contract version ${str(c.version)}`,
      ['contract', 'version'], ['contract', 'domain'], ['contract', 'tags']);

  if (!blank(t.name)) add('table', 'table.name', `Dataset ${str(t.name)} is defined`, ['table', 'name']);
  if (!blank(t.type)) add('table', 'table.type', `Defined as a ${str(t.type)}`, ['table', 'type']);
  if (list(t.primary_key).length)
    add('table', 'table.primary_key', `Primary key (${str(t.primary_key)}), key columns NOT NULL`, ['table', 'primary_key']);
  if (!blank(t.scd_type))
    add('table', 'table.scd_type', `SCD type ${str(t.scd_type)} sequenced by ${str(t.sequence_by)}`, ['table', 'scd_type'], ['table', 'sequence_by']);
  if (!blank(t.cluster_by)) add('table', 'table.cluster_by', `Clustered by ${str(t.cluster_by)}`, ['table', 'cluster_by']);
  if (t.cdf === true) add('table', 'table.cdf', 'Change data feed enabled', ['table', 'cdf']);
  if (t.row_tracking === true) add('table', 'table.row_tracking', 'Row tracking enabled', ['table', 'row_tracking']);

  list(contract.columns).forEach((col, i) => {
    if (!isObj(col) || blank(col.name)) return;
    const nn = col.nullable === false ? 'NOT NULL' : 'nullable';
    add('columns', `columns.${str(col.name)}`,
      `${str(col.name)} ${str(col.type)} ${nn}${blank(col.comment) ? '' : `, comment "${str(col.comment)}"`}`, ['columns', i]);
  });

  list(contract.expectations).forEach((e, i) => {
    if (!isObj(e) || blank(e.name)) return;
    add('expectations', `expectations.${str(e.name)}`, `${str(e.expr)}, on violation ${str(e.on_violation) || 'warn'}`, ['expectations', i]);
  });

  if (!blank(slo.refresh)) add('slo', 'slo.refresh', `Job runs on "${str(slo.refresh)}"`, ['slo', 'refresh']);
  if (!blank(slo.freshness)) add('slo', 'slo.freshness', `Alert when data is older than ${str(slo.freshness)}`, ['slo', 'freshness']);
  if (slo.completeness === true || (typeof slo.completeness === 'string' && !['', 'false'].includes(slo.completeness.trim().toLowerCase())))
    add('slo', 'slo.completeness',
      `${slo.completeness === true ? 'Every expected entity has data' : str(slo.completeness)}: missing entities show as zero rows, and an alert fires on them`,
      ['slo', 'completeness']);
  if (list(slo.alert).length || !blank(slo.alert)) add('slo', 'slo.alert', `Alerts and failures notify ${str(slo.alert)}`, ['slo', 'alert']);
  if (!blank(slo.freshness) || slo.completeness === true)
    out.push({ id: 'dqm', section: 'slo', requirement: 'Data quality monitoring enabled on the table or its schema',
      ...(keyLine(doc, lc, 'slo') ?? linesOf(doc, lc, [['slo']])) });

  if (list(access.readers).length) add('access', 'access.readers', `SELECT granted to ${str(access.readers)}`, ['access', 'readers']);
  if (access.pii !== undefined && access.pii !== null)
    add('access', 'access.pii', access.pii ? 'PII is masked or filtered' : 'No PII exposed', ['access', 'pii']);

  if (contract.changes !== undefined) add('changes', 'changes', 'Change policy (process rule, not checkable in code)', ['changes']);

  // Anything outside the template is still a promise: one generic requirement per extra key, so a contract with its
  // own sections is judged on all of them rather than silently skipped.
  for (const section of Object.keys(contract)) {
    const known = TEMPLATE[section];
    if (known === '*') continue;
    const v = contract[section];
    if (isObj(v)) {
      for (const [k, val] of Object.entries(v)) {
        if (known?.includes(k) || blank(val)) continue;
        add(section, `${section}.${k}`, `${k}: ${str(val)} (not a template key; judged on what it states)`, [section, k]);
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const name = isObj(item) && !blank(item.name) ? str(item.name) : String(i);
        add(section, `${section}.${name}`, `${str(item)} (not a template section; judged on what it states)`, [section, i]);
      });
    } else if (!blank(v)) {
      add(section, section, `${section}: ${str(v)} (not a template key; judged on what it states)`, [section]);
    }
  }

  const header = isObj(contract.contract) ? contract.contract : {};
  return {
    path,
    text,
    contractName: str(header.name) || str(t.name),
    contractVersion: str(header.version),
    requirements: out,
  };
}
