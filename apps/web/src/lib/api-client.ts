const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | string[] | undefined | null>;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

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
    throw error;
  }

  const json = await response.json().catch(() => ({ data: null }));
  // Unwrap { data: T } envelope from API
  return json?.data !== undefined ? json.data : json;
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
};
