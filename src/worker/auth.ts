import { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { Env } from './env';

const COOKIE = 'loot_admin';

export type Role = 'admin' | 'super';

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function roleToken(env: Env, role: Role): Promise<string> {
  return `${role}:${await hmac(env.ADMIN_PASSWORD, `role-v1:${role}`)}`;
}

/** Returns the role encoded in the admin cookie, or null if absent/invalid. */
export async function getRole(c: Context<{ Bindings: Env }>): Promise<Role | null> {
  const cookie = getCookie(c, COOKIE);
  if (!cookie) return null;
  const role = cookie.split(':')[0] as Role;
  if (role !== 'admin' && role !== 'super') return null;
  return cookie === (await roleToken(c.env, role)) ? role : null;
}

export async function isAdmin(c: Context<{ Bindings: Env }>): Promise<boolean> {
  return (await getRole(c)) != null;
}

/** Match a submitted password to a role; super password is optional. */
export function roleForPassword(env: Env, password: string): Role | null {
  if (env.SUPER_ADMIN_PASSWORD && password === env.SUPER_ADMIN_PASSWORD) return 'super';
  if (password === env.ADMIN_PASSWORD) return 'admin';
  return null;
}

export async function setAdminCookie(c: Context<{ Bindings: Env }>, role: Role) {
  setCookie(c, COOKIE, await roleToken(c.env, role), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearAdminCookie(c: Context<{ Bindings: Env }>) {
  setCookie(c, COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

// ---- site password: everyone (raiders) must enter it once; admins are let through ----
const SITE_COOKIE = 'loot_site';

async function siteToken(env: Env): Promise<string> {
  return hmac(env.ADMIN_PASSWORD, `site-v1:${env.SITE_PASSWORD ?? ''}`);
}

/** Site gate is active only when SITE_PASSWORD is configured. */
export const siteGateEnabled = (env: Env) => !!env.SITE_PASSWORD;

export async function hasSiteAccess(c: Context<{ Bindings: Env }>): Promise<boolean> {
  if (!siteGateEnabled(c.env)) return true;
  if (await isAdmin(c)) return true;
  const cookie = getCookie(c, SITE_COOKIE);
  return !!cookie && cookie === (await siteToken(c.env));
}

export async function setSiteCookie(c: Context<{ Bindings: Env }>) {
  setCookie(c, SITE_COOKIE, await siteToken(c.env), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export const requireSite: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (!(await hasSiteAccess(c))) return c.json({ error: 'site password required' }, 403);
  await next();
};

export const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (!(await isAdmin(c))) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

export const requireSuper: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if ((await getRole(c)) !== 'super') return c.json({ error: 'super admin required' }, 403);
  await next();
};
