import { Hono } from 'hono';
import { Env } from './env';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';

export { SessionDO } from './session-do';
export { PresenceDO } from './presence-do';

const app = new Hono<{ Bindings: Env }>();

app.route('/api/admin', adminRoutes);
app.route('/api', publicRoutes);

// Unknown API routes are 404s; anything else is a client-side route — hand it to the static
// assets binding, whose SPA fallback serves index.html (e.g. a direct visit to /admin or /s/3).
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default app;
