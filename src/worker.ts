import { Hono } from "hono";

type Env = { DB: D1Database; ASSETS: Fetcher; ADMIN_PASSWORD: string; TOKEN_ENC_KEY: string };

const app = new Hono<{ Bindings: Env }>();
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, _env: Env, _ctx: ExecutionContext) => {},
} satisfies ExportedHandler<Env>;
