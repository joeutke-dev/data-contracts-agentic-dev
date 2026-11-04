// Reads the contract and every text file of a bundle from the workspace (as the app's service principal).
import { getExecutionContext } from '@databricks/appkit';
import type { JudgedFile } from '../../shared/judge';

const TEXT = /\.(ya?ml|sql|py|md|json|txt|toml|cfg)$/i;
const SKIP_DIRS = new Set(['.databricks', 'node_modules', '.git', '__pycache__', '.venv', 'dist', 'build']);
const MAX_FILES = 80;
const MAX_BYTES = 200_000;
// every judge call carries the whole bundle, so cap the total (about 100k tokens)
const MAX_TOTAL = 400_000;

export const normalizePath = (p: string) => {
  const t = p.trim().replace(/\/+$/, '');
  return t.startsWith('/Workspace/') ? t.slice('/Workspace'.length) : t;
};

export async function readText(path: string): Promise<string> {
  const w = getExecutionContext().client.toLegacyWorkspaceClient();
  try {
    const r = await w.workspace.export({ path, format: 'SOURCE' });
    return Buffer.from(r.content ?? '', 'base64').toString('utf8');
  } catch (err) {
    throw unreadable(path, err);
  }
}

// The app reads as its service principal: a missing path and a folder it can't see look the same, so say both.
function unreadable(path: string, err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.match(/"message":"([^"]+)"/)?.[1] ?? raw;
  return new Error(
    `Can't read ${path}: ${msg}. Check the path, and that the app's service principal can read the folder ` +
      `(setup.sh grant-app ${path.replace(/\/[^/]*\.[a-z]+$/i, '')}).`,
  );
}

export async function isDirectory(path: string): Promise<boolean> {
  const w = getExecutionContext().client.toLegacyWorkspaceClient();
  try {
    const s = await w.workspace.getStatus({ path });
    return s.object_type === 'DIRECTORY' || s.object_type === 'REPO';
  } catch (err) {
    throw unreadable(path, err);
  }
}

export async function readBundle(root: string): Promise<{ files: JudgedFile[]; skipped: string[] }> {
  const w = getExecutionContext().client.toLegacyWorkspaceClient();
  const files: JudgedFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = [];
    try {
      for await (const o of w.workspace.list({ path: dir })) entries.push(o);
    } catch (err) {
      throw unreadable(dir, err);
    }
    for (const o of entries) {
      const p = o.path ?? '';
      const name = p.split('/').pop() ?? '';
      if (o.object_type === 'DIRECTORY') {
        if (!SKIP_DIRS.has(name)) await walk(p);
        continue;
      }
      if (o.object_type !== 'FILE' && o.object_type !== 'NOTEBOOK') continue;
      const rel = p.slice(root.length + 1);
      if (o.object_type === 'FILE' && !TEXT.test(name)) { skipped.push(rel); continue; }
      if (files.length >= MAX_FILES) { skipped.push(rel); continue; }
      const text = await readText(p);
      if (text.length > MAX_BYTES) { skipped.push(`${rel} (too large)`); continue; }
      if (total + text.length > MAX_TOTAL) { skipped.push(`${rel} (bundle over the size limit)`); continue; }
      total += text.length;
      files.push({ path: rel, text });
    }
  };
  await walk(root);
  files.sort((a, b) => order(a.path) - order(b.path) || a.path.localeCompare(b.path));
  return { files, skipped };
}

// databricks.yml first, then resources, then source: the order a reviewer reads a bundle in.
const order = (p: string) => (p === 'databricks.yml' ? 0 : p.startsWith('resources/') ? 1 : p.endsWith('.md') ? 3 : 2);
