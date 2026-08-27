import { describe, it, expect } from 'vitest';
import { sha256Hex } from './session';

describe('login token hashing', () => {
  it('produces 64 lowercase hex chars', async () => {
    expect(await sha256Hex('some-uuid-token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and input-sensitive', async () => {
    expect(await sha256Hex('a')).toBe(await sha256Hex('a'));
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });

  it('matches a known SHA-256 vector', async () => {
    // echo -n "abc" | sha256sum
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
