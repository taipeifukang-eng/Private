const { spawn } = require("child_process");
require("@next/env").loadEnvConfig(process.cwd(), true);
const e = process.env;
const ref = new URL(
  e.NEXT_PUBLIC_SUPABASE_URL || "http://invalid",
).hostname.split(".")[0];
if (ref !== "mjpdfpxqttbhzeimmtqr" || e.EXPECTED_SUPABASE_PROJECT_REF !== ref)
  throw Error("Refusing to start outside DEV");
const build = process.argv.includes("--build");
const integrated = process.argv.includes("--integrated");
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    ...(build
      ? ["build"]
      : ["dev", "-H", "127.0.0.1", "-p", integrated ? "3002" : "3100"]),
  ],
  {
    stdio: "inherit",
    env: {
      ...e,
      NODE_ENV: build ? "production" : "development",
      NEXT_DIST_DIR: build ? ".next-workspace-build" : ".next",
      WORKSPACE_DEV_ENABLED: "true",
      WORKSPACE_ORIGIN: integrated
        ? "http://localhost:3002"
        : "http://localhost:5173",
      WORKSPACE_USE_EXISTING_SESSION: integrated ? "true" : "false",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
child.on("exit", (code) => process.exit(code || 0));
