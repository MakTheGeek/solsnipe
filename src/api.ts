/**
 * Authenticated API Fetcher for Solsnipe Dashboard
 * Automatically includes session token in Authorization header and credentials for cookies.
 */

export const getAuthToken = (): string | null => {
  try {
    return (
      localStorage.getItem('solana_sniper_auth_token') ||
      sessionStorage.getItem('solana_sniper_auth_token') ||
      null
    );
  } catch {
    return null;
  }
};

export const setAuthToken = (token: string, remember: boolean = true): void => {
  try {
    if (remember) {
      localStorage.setItem('solana_sniper_auth_token', token);
    } else {
      sessionStorage.setItem('solana_sniper_auth_token', token);
    }
  } catch {}
};

export const clearAuthToken = (): void => {
  try {
    localStorage.removeItem('solana_sniper_auth_token');
    sessionStorage.removeItem('solana_sniper_auth_token');
  } catch {}
};

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    // Dispatch custom event to lock dashboard
    window.dispatchEvent(new CustomEvent('solsnipe:unauthorized'));
  }

  return res;
}

/**
 * Safely parses response as JSON, preventing SyntaxError: Unexpected token '<'
 * if an HTML error page (e.g. 403 / 502 / reverse proxy) is returned.
 */
export async function safeJson<T = any>(res: Response): Promise<{ ok: boolean; status: number; data: T }> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(text);
      return { ok: res.ok, status: res.status, data: parsed };
    } catch {}
  }

  // Handle HTML or non-JSON response gracefully
  if (text.trim().startsWith('<')) {
    const msg =
      res.status === 403
        ? 'Accès refusé ou session expirée. Veuillez actualiser la page.'
        : res.status === 401
        ? 'Authentification requise.'
        : `Erreur serveur (HTTP ${res.status}). Veuillez vérifier votre connexion.`;
    return {
      ok: false,
      status: res.status,
      data: { success: false, error: msg, message: msg } as any,
    };
  }

  try {
    const parsed = JSON.parse(text);
    return { ok: res.ok, status: res.status, data: parsed };
  } catch {
    return {
      ok: false,
      status: res.status,
      data: { success: false, error: text || `Erreur HTTP ${res.status}`, message: text } as any,
    };
  }
}
