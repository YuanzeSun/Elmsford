// Server-sent events over POST (EventSource only does GET).

export type StreamEvent =
  | { type: "start"; conversationId: string; characterId: string; name: string }
  | { type: "text"; delta: string }
  | { type: "action"; text: string }
  | { type: "scene"; text: string }
  | { type: "end"; by: "player" | "character" | "time"; text?: string }
  | { type: "done" }
  | { type: "error"; message: string };

export async function postStream(path: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    const data: unknown = await res.json().catch(() => ({}));
    const message = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText;
    onEvent({ type: "error", message });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as StreamEvent);
    }
  }
}
