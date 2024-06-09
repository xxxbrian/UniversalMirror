import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { docker } from "./routers/docker";

if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const app = new Hono();
app.use(logger());

app.get("/", (c) => {
  // return c.text("UniversalMirror");
  return c.redirect("https://github.com/xxxbrian/UniversalMirror");
});

// docker hub mirror
app.route("/docker", docker);

const port = 3000;
console.log(`UniversalMirror is running on port ${port}`);
serve({
  fetch: app.fetch,
  port,
});
