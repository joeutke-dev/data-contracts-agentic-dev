// Types shared by the judge server and the UI.
export type Status = 'met' | 'partial' | 'missing' | 'not_applicable';

export interface Requirement {
  id: string;
  section: string;
  requirement: string;
  /** 1-based line range in contract.yml that states the requirement */
  line: number;
  endLine: number;
}

export interface Evidence {
  file: string;
  lines: string;
  snippet: string;
  /** the snippet was found in the file near the cited lines */
  verified: boolean;
}

export interface Result extends Requirement {
  status: Status;
  evidence: Evidence[];
  explanation: string;
}

export interface JudgedFile {
  path: string;
  text: string;
}

/** GET /api/contract: the contract as text plus the requirements the judge will rule on */
export interface ContractView {
  path: string;
  text: string;
  contractName: string;
  contractVersion: string;
  requirements: Requirement[];
}

export interface JudgeReport {
  contractPath: string;
  bundlePath: string;
  contractName: string;
  contractVersion: string;
  model: string;
  rubric: string;
  summary: string;
  results: Result[];
  files: { path: string; lines: number }[];
  skipped: string[];
  elapsedMs: number;
  /** set on a saved (prerendered) report: when it was judged */
  savedAt?: string;
}

export type RunState =
  | { state: 'running'; step: string; startedAt: number; total: number; checking: string[]; results: Result[] }
  | { state: 'done'; report: JudgeReport }
  | { state: 'error'; message: string };
