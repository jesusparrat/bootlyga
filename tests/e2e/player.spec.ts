import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TOKEN = process.env.BOOTLYGA_TOKEN ?? "ci-bootlyga-token-018";
const ACE = "0123456789abcdef0123456789abcdef01234567";
const CHANNEL = "Señal e2e";

async function openGate(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto("/");
  await expect(page.locator("#gate")).toBeVisible();
}

async function login(page: import("@playwright/test").Page) {
  await openGate(page);
  await page.locator("#gate input[name=token]").fill(TOKEN);
  await page.locator("#gate").getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#add")).toBeVisible();
}

test("la PWA reproduce el stream del simulador a través del gateway", async ({ page }) => {
  await login(page);

  const add = page.locator("#add");
  await add.locator('input[name="name"]').fill(CHANNEL);
  await add.locator('input[name="ace"]').fill(ACE);
  await add.getByRole("button", { name: "Añadir canal" }).click();

  const play = page.locator(".channel-play", { hasText: CHANNEL });
  await expect(play).toBeVisible();
  await play.click();

  await expect(page.locator("#stage-status")).not.toHaveText("", { timeout: 5_000 });

  await page.waitForFunction(
    () => {
      const video = document.querySelector("video");
      if (!video) return false;
      return video.readyState >= 2 && !video.paused && video.currentTime > 0;
    },
    { timeout: 60_000 },
  );
});

test("accesibilidad de la pantalla de acceso y de la mesa", async ({ page }) => {
  await openGate(page);
  const gateA11y = await new AxeBuilder({ page }).include("#gate").analyze();
  expect(gateA11y.violations).toEqual([]);

  await login(page);
  const deskA11y = await new AxeBuilder({ page }).include("main").analyze();
  expect(deskA11y.violations).toEqual([]);
});