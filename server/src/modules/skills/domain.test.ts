import { describe, it, expect } from 'vitest';
import { resolveVettingOnBodyEdit } from './domain.js';

describe('resolveVettingOnBodyEdit', () => {
  const vetted = { needsVetting: false, vettedBodyHash: 'h' };

  it('edit of an extracted skill resets vetting', () => {
    expect(resolveVettingOnBodyEdit({ source: 'extracted', ...vetted }, true)).toEqual({
      needsVetting: true,
      vettedBodyHash: null,
    });
  });
  it('edit of an imported skill resets vetting', () => {
    expect(resolveVettingOnBodyEdit({ source: 'imported', ...vetted }, true)).toEqual({
      needsVetting: true,
      vettedBodyHash: null,
    });
  });
  it('manual skill is untouched; unchanged body keeps the vet', () => {
    expect(resolveVettingOnBodyEdit({ source: 'manual', ...vetted }, true)).toEqual(vetted);
    expect(resolveVettingOnBodyEdit({ source: 'extracted', ...vetted }, false)).toEqual(vetted);
  });
});
