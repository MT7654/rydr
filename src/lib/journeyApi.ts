import { getDemoRole } from './demoSession';
export async function mutationRole(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  if (origin && new URL(origin).host !== host) throw new Error('Cross-origin action rejected.');
  const role = await getDemoRole();
  if (!role) throw new Error('Select a role to continue.');
  return role;
}
