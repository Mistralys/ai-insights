/**
 * scripts/tests/insight-validation.test.js
 *
 * Fixture-based tests for the insight_agent / insight_report_target
 * build-time validation in scripts/lib/insight-validation.js.
 */

import { describe, it, expect } from 'vitest';
import { validateInsightFields } from '../lib/insight-validation.js';

describe('insight_agent validation', () => {
  it('fails when insight_agent differs from role', () => {
    const yaml = [
      'role: Developer',
      'insight_agent: Develper',
      'insight_report_target: "your comments"',
    ].join('\n');

    const errors = validateInsightFields(yaml, 'test.yaml');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('differs from role');
    expect(errors[0]).toContain('Develper');
  });

  it('fails when insight_agent is defined without insight_report_target', () => {
    const yaml = [
      'role: QA',
      'insight_agent: QA',
    ].join('\n');

    const errors = validateInsightFields(yaml, 'test.yaml');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('insight_report_target');
    expect(errors[0]).toContain('Both must be declared together');
  });

  it('fails when insight_report_target is defined without insight_agent', () => {
    const yaml = [
      'role: QA',
      'insight_report_target: "your comments"',
    ].join('\n');

    const errors = validateInsightFields(yaml, 'test.yaml');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('insight_agent');
    expect(errors[0]).toContain('Both must be declared together');
  });

  it('passes for standalone persona with insight_agent and no role', () => {
    const yaml = [
      'slug: developer-standalone',
      'insight_agent: Developer',
      'insight_report_target: "the **Code Insights** section"',
    ].join('\n');

    const errors = validateInsightFields(yaml, 'developer.yaml');
    expect(errors).toHaveLength(0);
  });

  it('passes when insight_agent matches role', () => {
    const yaml = [
      'role: Developer',
      'insight_agent: Developer',
      'insight_report_target: "your comments"',
    ].join('\n');

    const errors = validateInsightFields(yaml, '3-developer.yaml');
    expect(errors).toHaveLength(0);
  });

  it('passes when neither insight field is defined', () => {
    const yaml = [
      'role: Planner',
      'number: 1',
    ].join('\n');

    const errors = validateInsightFields(yaml, '1-planner.yaml');
    expect(errors).toHaveLength(0);
  });
});
