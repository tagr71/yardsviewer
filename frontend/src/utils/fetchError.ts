/** Shared fetch-error helpers.
 *
 * Upstream 5xx responses (e.g. openresty's `502 Bad Gateway` HTML page)
 * used to be dumped verbatim into the dashboard error banner, which
 * filled the UI with raw markup. `friendlyFetchError` turns a non-OK
 * `Response` into a short, human-readable string. */

const UPSTREAM_STATUS_LABELS: Record<number, string> = {
  502: "Backend temporarily unavailable (502 Bad Gateway)",
  503: "Backend temporarily unavailable (503 Service Unavailable)",
  504: "Backend timed out (504 Gateway Timeout)",
};

export async function friendlyFetchError(
  res: Response,
  prefix?: string,
): Promise<Error> {
  const tag = prefix ? `${prefix}: ` : "";
  const known = UPSTREAM_STATUS_LABELS[res.status];
  if (known) return new Error(`${tag}${known}`);

  let body = "";
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  // Strip HTML tags and collapse whitespace, then cap length so a giant
  // error page can't blow up the UI.
  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return new Error(`${tag}HTTP ${res.status}${text ? `: ${text}` : ""}`);
}
