import { describe, expect, it } from 'vitest';
import { canAccessDemoPath, demoRole } from '@/domain/demoAccess';

describe('demo role boundaries', () => {
  it('requires entry before case data and rejects unknown roles', () => {
    expect(demoRole('admin')).toBeNull();
    expect(canAccessDemoPath(null, '/cases/SYN-001/outcome')).toBe(false);
    expect(canAccessDemoPath(null, '/', true)).toBe(false);
  });
  it.each(['rider','driver'] as const)('keeps %s outside operator pages and raw APIs', role => {
    for (const path of ['/review-queue','/reviews/task','/cases/SYN-001','/cases/SYN-001/review','/api/cases/SYN-001','/api/runs/run/export']) {
      expect(canAccessDemoPath(role,path)).toBe(false);
    }
    expect(canAccessDemoPath(role,'/cases/SYN-001/outcome')).toBe(true);
    expect(canAccessDemoPath(role,'/portal')).toBe(true);
  });
  it('lets the reviewer use the workbench', () => {
    expect(canAccessDemoPath('reviewer','/reviews/task')).toBe(true);
  });
});
