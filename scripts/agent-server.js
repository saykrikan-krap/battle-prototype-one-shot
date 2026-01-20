import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number.parseInt(process.env.AGENT_PORT ?? "5174", 10);
const BACKLOG_LIMIT = 100;

const clients = new Set();
const backlog = [];

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
};

const addToBacklog = (command) => {
  backlog.push(command);
  while (backlog.length > BACKLOG_LIMIT) {
    backlog.shift();
  }
};

const broadcast = (command) => {
  for (const client of clients) {
    try {
      client.write(`data: ${JSON.stringify(command)}\n\n`);
    } catch (error) {
      clients.delete(client);
    }
  }
};

const server = http.createServer((req, res) => {
  const originHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, originHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/agent/events") {
    res.writeHead(200, {
      ...originHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write(": connected\n\n");
    for (const command of backlog) {
      res.write(`data: ${JSON.stringify(command)}\n\n`);
    }
    clients.add(res);
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/agent/command") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (error) {
        sendJson(res, 400, { ok: false, reason: "Invalid JSON." });
        return;
      }
      if (!payload || typeof payload.action !== "string") {
        sendJson(res, 400, { ok: false, reason: "Missing action." });
        return;
      }
      const command = {
        id: randomUUID(),
        action: payload.action,
        payload: payload.payload ?? {},
        ts: Date.now()
      };
      addToBacklog(command);
      broadcast(command);
      sendJson(res, 200, { ok: true, id: command.id });
    });
    return;
  }

  sendJson(res, 404, { ok: false, reason: "Not found." });
});

server.listen(PORT, () => {
  console.log(`[agent-server] listening on http://localhost:${PORT}`);
});
