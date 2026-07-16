import { WebSocketServer } from "ws";
import { pool } from "./db.js";
import { readSession } from "./auth.js";

const clients = new Set();

export function attachWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/ws")) return socket.destroy();
    // parse cookies
    const cookieHeader = req.headers.cookie || "";
    req.cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const i = c.indexOf("=");
        return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
      }),
    );
    const session = readSession(req);
    if (!session?.uid) return socket.destroy();

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = session.uid;
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.send(JSON.stringify({ type: "hello" }));
    });
  });

  // Postgres LISTEN
  pool.connect().then((client) => {
    client.on("notification", (msg) => {
      if (msg.channel !== "hyperush_changes") return;
      const data = msg.payload;
      for (const ws of clients) {
        try {
          ws.send(data);
        } catch {}
      }
    });
    client.query("LISTEN hyperush_changes").catch(console.error);
    console.log("[ws] listening on postgres NOTIFY channel");
  });
}
