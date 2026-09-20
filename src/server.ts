import { createServer, type Server } from "node:http";
import type { Config } from "./config.ts";
import { readAsset } from "./paths.ts";
import type { WatcherState } from "./watcher.ts";

/**
 * The overlay as one self-contained page, built from the three files in overlay/
 * with the configured font size and color filled in.
 *
 * The background is transparent, which is what a browser source in OBS needs.
 * `bg` paints a background instead, for checking the page in a normal browser.
 */
export function overlayPage(cfg: Config, bg = "transparent"): string {
  const html = readAsset("overlay.html");
  const css = readAsset("overlay.css")
    .replaceAll("{{fontSize}}", cfg.overlayFontSize)
    .replaceAll("{{color}}", cfg.overlayColor);
  const js = readAsset("overlay.js");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>eAPMCounter</title>
<style>html,body{margin:0;padding:0;background:${bg};overflow:hidden;}</style>
<style>${css}</style></head>
<body>${html}<script>${js}</script></body></html>`;
}

export function startServer(cfg: Config, getState: () => WatcherState): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${cfg.port}`);
    res.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/eapm") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(getState()));
      return;
    }
    if (url.pathname === "/overlay") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(overlayPage(cfg, url.searchParams.get("bg") ?? "transparent"));
      return;
    }
    if (url.pathname === "/") {
      const s = getState();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(
        [
          "eAPMCounter is running.",
          "",
          `In game:        ${s.inGame ? "yes" : "no"}`,
          `eAPM:           ${s.eapm ?? "-"}`,
          `Game time:      ${Math.round(s.gameTimeMs / 1000)} s`,
          `File:           ${s.file ?? "-"}`,
          `Players:        ${s.players.map((p) => `${p.number}: ${p.name}`).join(", ") || "-"}`,
          `My number:      ${s.myPlayerNumber ?? "-"}`,
          `Counted total:  ${s.totalCounted}`,
          `Note:           ${s.note ?? "-"}`,
          "",
          `Browser source URL for OBS:  http://localhost:${cfg.port}/overlay`,
          "",
          "GET /overlay            the overlay page, transparent background",
          "GET /overlay?bg=green   the same page on green, to check it in a browser",
          "GET /eapm               the number as JSON",
        ].join("\n"),
      );
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(cfg.port, "127.0.0.1");
  return server;
}
