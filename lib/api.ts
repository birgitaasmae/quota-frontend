export function getApiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) {
    throw new Error("Missing NEXT_PUBLIC_API_BASE. Set it in .env.local and in Vercel env vars.");
  }
  return base.replace(/\/$/, "");
}

export async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const url = `${getApiBase()}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!text.trim()) {
    throw new Error("API returned empty response body.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API returned non-JSON: ${text.slice(0, 500)}`);
  }
}
