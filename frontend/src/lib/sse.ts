'use client';

/**
 * subscribeToSse
 *
 * A minimal Server-Sent-Events client built on `fetch` + a streaming
 * `ReadableStream` reader, instead of the native `EventSource` API.
 *
 * Why not `EventSource`: the browser's native EventSource cannot send custom
 * headers, so the only way to authenticate it is via a token in the URL query
 * string — which API_GUIDELINES.md §15 and SECURITY.md explicitly forbid
 * ("Never accept authentication in query parameters"), since URLs end up in
 * server access logs, browser history, and proxy logs.
 *
 * This client sends the JWT the same way every other API call does — as an
 * `Authorization: Bearer <token>` header — and manually parses the
 * `text/event-stream` wire format (`data: <json>\n\n` frames).
 *
 * Returns an `unsubscribe` function; call it (e.g. on unmount) to abort the
 * underlying connection.
 */
export function subscribeToSse(
  url: string,
  token: string,
  onMessage: (data: string) => void,
  onError?: (error: unknown) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed: HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; each frame may contain
        // multiple `data:` lines, which we join per the spec.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const dataLines = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length > 0) {
            onMessage(dataLines.join('\n'));
          }
        }
      }
    } catch (error) {
      // A deliberate unsubscribe() aborts the fetch — that's not a real error.
      if (controller.signal.aborted) return;
      onError?.(error);
    }
  })();

  return () => controller.abort();
}
