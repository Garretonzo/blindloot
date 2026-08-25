import { describe, it, expect } from 'vitest';
import { hashPassword, roleToken, verifyPassword } from './auth';
import { Env } from './env';

describe('raider password hashing', () => {
  it('produces the versioned pbkdf2 format', async () => {
    const stored = await hashPassword('hunter2');
    expect(stored).toMatch(/^pbkdf2v1:100000:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  it('salts: hashing the same password twice differs', async () => {
    expect(await hashPassword('hunter2')).not.toBe(await hashPassword('hunter2'));
  });

  it('verifies a round-trip and rejects a wrong password', async () => {
    const stored = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', stored)).toBe(true);
    expect(await verifyPassword('hunter3', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('rejects unknown schemes and garbage', async () => {
    const stored = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', stored.replace('pbkdf2v1', 'pbkdf2v2'))).toBe(false);
    expect(await verifyPassword('hunter2', 'garbage')).toBe(false);
    expect(await verifyPassword('hunter2', 'pbkdf2v1:100000:!!!notbase64!!!:xyz')).toBe(false);
    expect(await verifyPassword('hunter2', '')).toBe(false);
  });
});

describe('admin role tokens', () => {
  const env = { ADMIN_PASSWORD: 'adminpw', SUPER_ADMIN_PASSWORD: 'superpw' } as Env;

  it('keys the super token with the super password, not the admin password', async () => {
    // A regular admin knows ADMIN_PASSWORD; the super token must not be computable from it.
    const forged = await roleToken({ ...env, SUPER_ADMIN_PASSWORD: env.ADMIN_PASSWORD } as Env, 'super');
    const real = await roleToken(env, 'super');
    expect(forged).not.toBe(real);
  });

  it('admin and super tokens differ', async () => {
    expect(await roleToken(env, 'admin')).not.toBe(await roleToken(env, 'super'));
  });
});
