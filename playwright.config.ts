import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 20_000,
  expect: { timeout: 6_000 },
  fullyParallel: true,
  // Jeden retry w CI, widoczny w raporcie (reporter list + html pokazują status
  // „flaky"), żeby realny flake środowiskowy nie blokował bramki, ale NIE był
  // wyciszony — wzorzec retry jest sygnałem do zbadania, nie do zamiecenia.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:8081",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx http-server docs -p 8081 -s -c-1",
    url: "http://localhost:8081",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
