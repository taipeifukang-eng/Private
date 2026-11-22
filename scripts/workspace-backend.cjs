const { spawn } = require("child_process");
const path = require("path");
const build = process.argv.includes("--build");
const integrated = process.argv.includes("--integrated");
const guard = require("../tests/support/env-guard.cjs");
// dev / --integrated 路徑：先只解析 .env.development.local（不經 Next），
// 確認必要變數都在這個檔案內，載入後再比對值，避免 Next loadEnvConfig 從 .env.local 等 fallback 檔補值。
// --build（含 production build）維持原行為，不套用嚴格檢查。
// 測試路徑（tests/support/start-test-server.cjs）以 applyDevEnv 把 DEV 值放進 process.env 再啟動本檔，
// Next 不會覆蓋已存在的 process.env，所以子程序拿到的一定是 DEV 值（T00 單元測試有驗證）。
let devFileEnv = null;
if (!build) {
  try {
    devFileEnv = guard.loadDevEnvFile(path.resolve(__dirname, ".."));
  } catch (error) {
    console.error(`Refusing to start outside DEV: ${error.message}`);
    process.exit(2);
  }
}
require("@next/env").loadEnvConfig(process.cwd(), true);
const e = process.env;
const ref = new URL(
  e.NEXT_PUBLIC_SUPABASE_URL || "http://invalid",
).hostname.split(".")[0];
if (ref !== "mjpdfpxqttbhzeimmtqr" || e.EXPECTED_SUPABASE_PROJECT_REF !== ref)
  throw Error("Refusing to start outside DEV");
if (!build) {
  try {
    guard.assertBackendDevEnv(devFileEnv, e);
  } catch (error) {
    console.error(`Refusing to start outside DEV: ${error.message}`);
    process.exit(2);
  }
}
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
