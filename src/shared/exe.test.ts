import { describe, it, expect } from 'vitest';
import { normalizeExe } from './exe';

describe('normalizeExe', () => {
  it('strips path, extension, whitespace and case', () => {
    expect(normalizeExe('C:\\Apps\\DSS Client.exe')).toBe('dss client');
    expect(normalizeExe('DSSClient.EXE')).toBe('dssclient');
    expect(normalizeExe('  Spotify ')).toBe('spotify');
  });
  it('returns empty for empty input', () => {
    expect(normalizeExe('')).toBe('');
  });
});
