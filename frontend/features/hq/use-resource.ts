'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../lib/api';

/** Load one API resource with loading, error and reload states. A 401 returns to sign in. */
export function useResource<T>(path: string | null) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setError('');
    api<T>(path, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401) router.replace('/');
        else setError(reason instanceof Error ? reason.message : 'Could not load this section.');
      });
    return () => controller.abort();
  }, [path, revision, router]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  return { data, error, loading: !data && !error, reload };
}

/** Send a write; callers reload the resources it changes. */
export async function mutate(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) {
  return api<unknown>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

export const label = (value: string) => value.replaceAll('_', ' ');
export const formData = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form).entries()]
  .map(([key, value]) => [key, String(value).trim()]).filter(([, value]) => value !== '')) as Record<string, string>;
export const list = (value?: string) => value ? value.split(',').map(item => item.trim()).filter(Boolean) : undefined;
