// Server-sent event hub for GET /events.
// Trajectory steps go out as unnamed messages (so EventSource.onmessage receives them in the trajectory-step
// shape, with type: "step" added); every other event goes out as a named event, e.g. addEventListener("brain_read").

import type { Request, Response } from "express";

type Client = Response;
const clients = new Set<Client>();

export function sseHandler(req: Request, res: Response) {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write(": connected\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function emit(type: string, data: Record<string, unknown>) {
  const payload = JSON.stringify({ type, ...data });
  const frame = type === "step" ? `data: ${payload}\n\n` : `event: ${type}\ndata: ${payload}\n\n`;
  for (const c of clients) c.write(frame);
}
