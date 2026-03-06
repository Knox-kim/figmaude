import type {
  PluginRequest,
  PluginRequestType,
  ResponseMap,
  RequestEnvelope,
  ResponseEnvelope,
  EventEnvelope,
  PluginEvent,
} from "../shared/messages";

type RequestHandler<T extends PluginRequestType> = (
  params: Omit<Extract<PluginRequest, { type: T }>, "type">
) => Promise<ResponseMap[T]>;

const handlers = new Map<string, RequestHandler<any>>();

export function onRequestFromUI<T extends PluginRequestType>(
  type: T,
  handler: RequestHandler<T>
): void {
  handlers.set(type, handler);
}

export function emitToUI(event: PluginEvent): void {
  const envelope: EventEnvelope = { kind: "event", payload: event };
  figma.ui.postMessage(envelope);
}

export function initMessenger(): void {
  figma.ui.onmessage = async (msg: any) => {
    // Handle storage messages
    if (msg.kind === "storage") {
      if (msg.action === "get") {
        const value = await figma.clientStorage.getAsync(msg.key);
        figma.ui.postMessage({
          kind: "storage-response",
          key: msg.key,
          value,
        });
        return;
      }
      if (msg.action === "set") {
        await figma.clientStorage.setAsync(msg.key, msg.value);
        return;
      }
    }

    // Handle request messages
    if (msg.kind !== "request") return;

    const envelope = msg as RequestEnvelope;
    const handler = handlers.get(envelope.payload.type);

    const response: ResponseEnvelope = {
      kind: "response",
      requestId: envelope.requestId,
      payload: { error: `No handler for ${envelope.payload.type}` },
    };

    if (handler) {
      try {
        const { type, ...params } = envelope.payload;
        const result = await handler(params as any);
        response.payload = result;
      } catch (err) {
        const errName = err instanceof Error ? err.constructor.name : "Error";
        const errMsg = err instanceof Error ? err.message : String(err);
        response.payload = {
          error: `[${envelope.payload.type}] ${errName}: ${errMsg}`,
        };
      }
    }

    figma.ui.postMessage(response);
  };
}
