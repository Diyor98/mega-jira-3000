const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | string[] | undefined | null>;
  suppressForbiddenEvent?: boolean;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, suppressForbiddenEvent, ...fetchOptions } = options;

  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      const joined = Array.isArray(v) ? v.filter((x) => x !== undefined && x !== null && x !== '').join(',') : v;
      if (joined === '') continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(joined)}`);
    }
    if (parts.length > 0) url += `?${parts.join('&')}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
      credentials: 'include',
    });
  } catch {
    throw { error: 'NetworkError', message: 'Unable to reach the server', code: 0 };
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'NetworkError',
      message: 'An unexpected error occurred',
      code: response.status,
    }));
    if (response.status === 403 && !suppressForbiddenEvent) {
      emitForbidden(error);
    }
    throw error;
  }

  const json = await response.json().catch(() => ({ data: null }));
  // Unwrap { data: T } envelope from API
  return json?.data !== undefined ? json.data : json;
}

/**
 * Story 8.2: dispatch a window-level `mega:forbidden` event when the API
 * returns 403. The app shell listens and shows a toast + redirects to the
 * project home. Safe in SSR (the typeof check guards against `window`).
 */
export function emitForbidden(error: unknown): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mega:forbidden', { detail: error }));
  }
}

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),

  patch: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),

  /**
   * Upload a single file via multipart/form-data. The browser sets the
   * Content-Type (including the multipart boundary) automatically — do NOT
   * pass a Content-Type header manually.
   */
  uploadFile: async <T>(
    endpoint: string,
    fieldName: string,
    file: File,
  ): Promise<T> => {
    const url = `${API_BASE_URL}${endpoint}`;
    const formData = new FormData();
    formData.append(fieldName, file);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
    } catch {
      throw { error: 'NetworkError', message: 'Unable to reach the server', code: 0 };
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: 'NetworkError',
        message: 'An unexpected error occurred',
        code: response.status,
      }));
      if (response.status === 403) emitForbidden(error);
      throw error;
    }
    const json = await response.json().catch(() => ({ data: null }));
    return json?.data !== undefined ? json.data : json;
  },
};
