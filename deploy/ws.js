import { WebSocketServer } from "ws";
import { pool } from "./db.js";
import { readSession } from "./auth.js";
import { sendNotificationEmail } from "./email.js";

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
    if (!session?.uid) {
      console.warn("[ws upgrade] rejected: session.uid is missing or invalid. Cookie header:", req.headers.cookie);
      return socket.destroy();
    }
    console.log(`[ws upgrade] accepted for user: ${session.uid}`);

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = session.uid;
      clients.add(ws);
      ws.on("close", () => {
        console.log(`[ws close] connection closed for user: ${session.uid}`);
        clients.delete(ws);
      });
      ws.send(JSON.stringify({ type: "hello" }));
    });
  });

  // Postgres LISTEN
  pool.connect().then((client) => {
    client.on("notification", async (msg) => {
      if (msg.channel !== "hyperush_changes") return;
      const data = msg.payload;
      for (const ws of clients) {
        try {
          ws.send(data);
        } catch {}
      }

      // Send email notifications asynchronously
      try {
        const payload = JSON.parse(data);
        if (payload.table === "notifications" && payload.op === "INSERT") {
          sendNotificationEmail(payload.row).catch((err) => {
            console.error("[email notification trigger error]", err);
          });
        }
      } catch (err) {
        console.error("[ws notification parse error]", err);
      }
    });
    client.query("LISTEN hyperush_changes").catch(console.error);
    console.log("[ws] listening on postgres NOTIFY channel");
  });
}
