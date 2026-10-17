export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error ?? 'Could not reach PitchPrism. Please try again.');
  }
  return response.status === 204 ? undefined as T : response.json();
}
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
