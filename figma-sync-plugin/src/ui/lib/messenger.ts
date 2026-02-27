import type {
  PluginRequest,
  PluginRequestType,
  ResponseMap,
  RequestEnvelope,
  ResponseEnvelope,
  EventEnvelope,
  PluginEvent,
} from "../../shared/messages";

type EventHandler = (event: PluginEvent) => void;

let requestCounter = 0;
const pendingRequests = new Map<
  string,
  { resolve: (value: any) => void; reject: (reason: any) => void }
>();
const eventHandlers = new Set<EventHandler>();

// Listen for messages from sandbox
window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (!msg) return;

  if (msg.kind === "response") {
    const envelope = msg as ResponseEnvelope;
    const pending = pendingRequests.get(envelope.requestId);
    if (pending) {
      pendingRequests.delete(envelope.requestId);
      if ("error" in envelope.payload) {
        pending.reject(new Error(envelope.payload.error));
      } else {
        pending.resolve(envelope.payload);
      }
    }
  } else if (msg.kind === "event") {
    const envelope = msg as EventEnvelope;
    eventHandlers.forEach((handler) => handler(envelope.payload));
  }
});

export function requestToPlugin<T extends PluginRequestType>(
  type: T,
  params?: Omit<Extract<PluginRequest, { type: T }>, "type">
): Promise<ResponseMap[T]> {
  const requestId = `req_${++requestCounter}_${Date.now()}`;
  const payload = { type, ...params } as PluginRequest;
  const envelope: RequestEnvelope = { kind: "request", requestId, payload };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    parent.postMessage({ pluginMessage: envelope }, "*");

    // Timeout after 30s
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Request ${type} timed out`));
      }
    }, 30000);
  });
}

export function onPluginEvent(handler: EventHandler): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}
