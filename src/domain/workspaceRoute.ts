import type { DemoRole } from './demoAccess';
export function workspaceHref(caseId: string, role: DemoRole, section?: string, context: {taskId?: string|null; runId?: string|null; requestId?: string|null; mode?: string} = {}, anchor = '') {
  const params = new URLSearchParams();
  if (role !== 'reviewer') params.set('case', caseId);
  if (section) params.set('section', section);
  if (context.taskId) params.set('task', context.taskId);
  if (context.runId) params.set('run', context.runId);
  if (context.requestId) params.set('request', context.requestId);
  if (context.mode) params.set('mode', context.mode);
  return (role === 'reviewer' ? '/cases/' + encodeURIComponent(caseId) : '/rides') + (params.size ? '?' + params.toString() : '') + anchor;
}
