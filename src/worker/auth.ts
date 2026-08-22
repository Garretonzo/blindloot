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

export const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (!(await isAdmin(c))) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

export const requireSuper: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if ((await getRole(c)) !== 'super') return c.json({ error: 'super admin required' }, 403);
  await next();
};
