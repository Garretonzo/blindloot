import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './auth';

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
