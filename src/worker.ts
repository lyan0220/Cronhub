import { Hono } from "hono";
import authRoutes from "./server/routes/auth";
import accountRoutes from "./server/routes/accounts";
import jobRoutes from "./server/routes/jobs";
import runRoutes from "./server/routes/runs";
import miscRoutes from "./server/routes/misc";
import passwordRoutes from "./server/routes/password";
import { requireAuth } from "./server/middleware";
import { runDueJobs } from "./server/scheduler";
import type { Env } from "./server/types";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/auth", authRoutes);

const protectedApi = new Hono<{ Bindings: Env }>();
protectedApi.use("*", requireAuth);
protectedApi.route("/accounts", accountRoutes);
protectedApi.route("/jobs", jobRoutes);
protectedApi.route("/runs", runRoutes);
protectedApi.route("/password", passwordRoutes);
protectedApi.route("/", miscRoutes); // /stats 与 /cron/preview
app.route("/api", protectedApi);

app.all("/api/*", (c) => c.json({ ok: false, error: "Not Found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    await runDueJobs(env);
  },
} satisfies ExportedHandler<Env>;
