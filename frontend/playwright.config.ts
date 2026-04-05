import path from "node:path";

import { defineConfig } from "@playwright/test";

const frontendPort = process.env.PLAYWRIGHT_FRONTEND_PORT ?? "3000";
const backendPort = process.env.PLAYWRIGHT_BACKEND_PORT ?? "8000";
const frontendBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${frontendPort}`;
const apiBaseUrl =
  process.env.PLAYWRIGHT_API_BASE_URL ?? `http://127.0.0.1:${backendPort}/api`;
const wsBaseUrl =
  process.env.PLAYWRIGHT_WS_BASE_URL ?? `ws://127.0.0.1:${backendPort}/ws`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  timeout: 60_000,
  use: {
    baseURL: frontendBaseUrl,
    trace: "retain-on-failure",
  },
  outputDir: "./test-results",
  webServer: [
    {
      command: ". .venv/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 8000",
      cwd: path.join(__dirname, "../backend"),
      env: {
        ...process.env,
        LLM_MOCK: "true",
        PYTHONUNBUFFERED: "1",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: `${apiBaseUrl}/health`,
    },
    {
      command: `npm run dev -- --hostname localhost --port ${frontendPort}`,
      cwd: __dirname,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
        NEXT_PUBLIC_WS_BASE_URL: wsBaseUrl,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: frontendBaseUrl,
    },
  ],
});
