import { createApp, server, serving, type ExecutionResult } from '@databricks/appkit';
import { registerJudgeRoutes } from './judge/routes';

// the serving handle is typed loosely (unknown) when the endpoint has no generated types
const isResult = (v: unknown): v is ExecutionResult<unknown> => typeof v === 'object' && v !== null && 'ok' in v;

createApp({
  plugins: [
    server(),
    // a judge run sends the whole bundle in one request and can think for a while
    serving({ timeout: 300_000 }),
  ],
  onPluginsReady(appkit) {
    const invoke = async (body: Record<string, unknown>) => {
      const r = await appkit.serving().invoke(body);
      if (!isResult(r)) return r;
      if (!r.ok) throw new Error(`serving endpoint error ${r.status}: ${r.message}`);
      return r.data;
    };
    appkit.server.extend((app) => registerJudgeRoutes(app, invoke));
  },
}).catch(console.error);
