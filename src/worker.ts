import { Hono } from "hono";
import authRoutes from "./server/routes/auth";
import accountRoutes from "./server/routes/accounts";
import jobRoutes from "./server/routes/jobs";
import runRoutes from "./server/routes/runs";
import miscRoutes from "./server/routes/misc";
import passwordRoutes from "./server/routes/password";
import notifyRoutes from "./server/routes/notify";
import githubRoutes from "./server/routes/github";
import { requireAuth } from "./server/middleware";
import { runDueJobs } from "./server/scheduler";
import { ensureMigrated } from "./server/migrations";
import type { Env } from "./server/types";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/auth", authRoutes);

const protectedApi = new Hono<{ Bindings: Env }>();
protectedApi.use("*", requireAuth);
protectedApi.route("/accounts", accountRoutes);
protectedApi.route("/jobs", jobRoutes);
protectedApi.route("/runs", runRoutes);
protectedApi.route("/password", passwordRoutes);
protectedApi.route("/notify", notifyRoutes);
protectedApi.route("/github", githubRoutes);
protectedApi.route("/", miscRoutes); // /stats 与 /cron/preview
app.route("/api", protectedApi);

app.all("/api/*", (c) => c.json({ ok: false, error: "Not Found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    ensureMigrated(env).then(() => app.fetch(req, env, ctx)),
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    await ensureMigrated(env);
    await runDueJobs(env, Date.now(), ctx);
  },
} satisfies ExportedHandler<Env>;
