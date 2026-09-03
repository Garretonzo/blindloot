import { Hono } from 'hono';
import { AppEnv, Env } from './env';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { meteredDb, newMeter } from './d1-meter';

export { SessionDO } from './session-do';
export { PresenceDO } from './presence-do';

const app = new Hono<AppEnv>();

app.route('/api/admin', adminRoutes);
app.route('/api', publicRoutes);

// Unknown API routes are 404s; anything else is a client-side route — hand it to the static
// assets binding, whose SPA fallback serves index.html (e.g. a direct visit to /admin or /s/3).
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    if (!env.D1_METER) return app.fetch(request, env, ctx);
    // Dev-only D1 accounting: one log line and an x-d1-rows-read header per request.
    const meter = newMeter();
    return Promise.resolve(app.fetch(request, { ...env, DB: meteredDb(env.DB, meter) }, ctx)).then((res) => {
      console.log(
        `[d1] ${request.method} ${new URL(request.url).pathname} rows_read=${meter.rowsRead} rows_written=${meter.rowsWritten} queries=${meter.queries}`,
      );
      if (res.status === 101) return res; // WebSocket upgrades cannot be re-wrapped
      const out = new Response(res.body, res);
      out.headers.set('x-d1-rows-read', String(meter.rowsRead));
      return out;
    });
  },
};
