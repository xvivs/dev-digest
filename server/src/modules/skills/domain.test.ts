/**
 * Hermetic unit tests for the pure stats/effectiveness rules in `domain.ts`
 * (plan Phase 2, [F10]): one `skillUsageStatus` shared by the run-time
 * resolver and the Stats tab, and the aggregate → `SkillStats` summary.
 */
import { describe, it, expect } from 'vitest';
import {
  isEffectiveSkill,
  promptHashInput,
  skillUsageStatus,
  summarizeSkillStats,
  type SkillRunAggregate,
} from './domain.js';

const BODY_HASH = 'a'.repeat(64);

const manual = { source: 'manual' as const, enabled: true, needsVetting: false, vettedBodyHash: null };
const importedVetted = {
  source: 'imported' as const,
  enabled: true,
  needsVetting: false,
  vettedBodyHash: BODY_HASH,
};

describe('skillUsageStatus / isEffectiveSkill', () => {
  it('a manual, enabled skill on an enabled link is effective without any vet hash', () => {
    expect(skillUsageStatus(true, manual, BODY_HASH)).toBe('effective');
    expect(isEffectiveSkill(true, manual, BODY_HASH)).toBe(true);
  });

  it('an imported skill is effective only while its vet matches the current body', () => {
    expect(skillUsageStatus(true, importedVetted, BODY_HASH)).toBe('effective');
    expect(skillUsageStatus(true, importedVetted, 'b'.repeat(64))).toBe('blocked_by_vetting');
    expect(skillUsageStatus(true, { ...importedVetted, vettedBodyHash: null }, BODY_HASH)).toBe(
      'blocked_by_vetting',
    );
  });

  it('needs_vetting blocks even a manual skill', () => {
    expect(skillUsageStatus(true, { ...manual, needsVetting: true }, BODY_HASH)).toBe('blocked_by_vetting');
  });

  it('precedence: link_disabled > skill_disabled > blocked_by_vetting', () => {
    const everythingOff = { ...importedVetted, enabled: false, needsVetting: true };
    expect(skillUsageStatus(false, everythingOff, BODY_HASH)).toBe('link_disabled');
    expect(skillUsageStatus(true, everythingOff, BODY_HASH)).toBe('skill_disabled');
    expect(isEffectiveSkill(false, manual, BODY_HASH)).toBe(false);
  });
});

describe('promptHashInput', () => {
  it('joins name and body with a newline so "ab"+"c" and "a"+"bc" differ', () => {
    expect(promptHashInput('ab', 'c')).toBe('ab\nc');
    expect(promptHashInput('ab', 'c')).not.toBe(promptHashInput('a', 'bc'));
  });
});

describe('summarizeSkillStats', () => {
  const price = (model: string, tokensIn: number, tokensOut: number) => {
    expect(tokensOut).toBe(0);
    return model === 'priced' ? tokensIn / 1000 : null;
  };

  it('sums runs and tokens across agents, versions and models; unpriced groups do not add cost', () => {
    const aggregates: SkillRunAggregate[] = [
      { agentId: 'a1', version: 1, model: 'priced', runs: 2, tokens: 200 },
      { agentId: 'a1', version: 2, model: 'priced', runs: 1, tokens: 150 },
      { agentId: 'a2', version: 2, model: 'unknown-model', runs: 3, tokens: 450 },
      { agentId: 'gone', version: 2, model: null, runs: 1, tokens: 150 },
    ];
    const stats = summarizeSkillStats({
      skillId: 's1',
      window: '30d',
      agents: [
        { agentId: 'a1', agentName: 'alpha', status: 'effective' },
        { agentId: 'a2', agentName: 'beta', status: 'link_disabled' },
        { agentId: 'a3', agentName: 'gamma', status: 'blocked_by_vetting' },
      ],
      aggregates,
      estimate: price,
    });

    expect(stats.usage.runs).toBe(7);
    expect(stats.usage.agents).toEqual([
      { agentId: 'a1', agentName: 'alpha', status: 'effective', runs: 3 },
      { agentId: 'a2', agentName: 'beta', status: 'link_disabled', runs: 3 },
      { agentId: 'a3', agentName: 'gamma', status: 'blocked_by_vetting', runs: 0 },
    ]);
    expect(stats.cost).toEqual({ tokens: 950, costUsd: 0.35, costSource: 'estimated' });
    expect(stats.byVersion).toEqual([
      { version: 2, runs: 5, tokens: 750, costUsd: 0.15, costSource: 'estimated' },
      { version: 1, runs: 2, tokens: 200, costUsd: 0.2, costSource: 'estimated' },
    ]);
    expect(stats.impact).toBeNull();
  });

  it('no priced model in the window → cost_usd and cost_source are both null', () => {
    const stats = summarizeSkillStats({
      skillId: 's1',
      window: '7d',
      agents: [],
      aggregates: [{ agentId: 'a1', version: 1, model: 'unknown-model', runs: 1, tokens: 10 }],
      estimate: price,
    });
    expect(stats.cost).toEqual({ tokens: 10, costUsd: null, costSource: null });
    expect(stats.byVersion[0]).toMatchObject({ costUsd: null, costSource: null });
  });

  it('no runs at all → zeros, empty by_version, still null cost', () => {
    const stats = summarizeSkillStats({
      skillId: 's1',
      window: '90d',
      agents: [{ agentId: 'a1', agentName: 'alpha', status: 'effective' }],
      aggregates: [],
      estimate: price,
    });
    expect(stats.usage).toEqual({
      runs: 0,
      agents: [{ agentId: 'a1', agentName: 'alpha', status: 'effective', runs: 0 }],
    });
    expect(stats.cost).toEqual({ tokens: 0, costUsd: null, costSource: null });
    expect(stats.byVersion).toEqual([]);
  });
});
