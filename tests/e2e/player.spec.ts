import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TOKEN = process.env.BOOTLYGA_TOKEN ?? "";
if (!TOKEN) throw new Error("Falta BOOTLYGA_TOKEN");
const ACE_PRIMARY = "0123456789abcdef0123456789abcdef01234567";
const ACE_BACKUP = "abcdef0123456789abcdef0123456789abcdef01";
const CHANNEL = "Señal e2e";

async function openGate(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto("/");
  await expect(page.locator("#gate")).toBeVisible();
}

async function login(page: Page) {
  await openGate(page);
  await page.locator("#gate input[name=token]").fill(TOKEN);
  await page.locator("#gate").getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#settings-open")).toBeVisible();
}

async function addChannelViaSettings(page: Page, name: string, ace: string, quality = "FHD") {
  await page.locator("#settings-open").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  const add = page.locator("#add");
  await add.locator('input[name="name"]').fill(name);
  await add.locator('input[name="ace"]').fill(ace);
  await add.locator('select[name="quality"]').selectOption(quality);
  await add.getByRole("button", { name: "Añadir canal" }).click();
  await expect(page.locator("#add-error")).toContainText("Canal añadido");
  await page.locator("#settings-close").click();
  await expect(page.locator("#settings-dialog")).toBeHidden();
}

test("la PWA reproduce el stream, permite elegir fuente y parar", async ({ page }) => {
  await login(page);

  await expect(page.locator("#stage-overlay")).toBeVisible();
  await expect(page.locator("#overlay-settings")).toBeVisible();

  await addChannelViaSettings(page, CHANNEL, ACE_PRIMARY, "FHD");
  await addChannelViaSettings(page, CHANNEL, ACE_BACKUP, "HD");

  const play = page.locator(".channel-play", { hasText: CHANNEL });
  await expect(play).toBeVisible();
  await expect(play).toContainText("2 fuentes");
  await play.click();

  await expect(page.locator("#sources-wrap")).toBeVisible();
  await expect(page.locator(".source-chip")).toHaveCount(2);
  await expect(page.locator(".source-chip").nth(0)).toHaveAttribute("aria-pressed", "true");

  await page.waitForFunction(
    () => {
      const video = document.querySelector("video");
      if (!video) return false;
      return video.readyState >= 2 && !video.paused && video.currentTime > 0;
    },
    { timeout: 60_000 },
  );

  await expect(page.locator("#stage-overlay")).toBeHidden();
  await expect(page.locator("#stage-kicker")).toHaveText("En directo");
  await expect(page.locator("#fullscreen")).toBeVisible();

  await page.locator(".source-chip").nth(1).click();
  await expect(page.locator(".source-chip").nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.waitForFunction(
    () => {
      const video = document.querySelector("video");
      if (!video) return false;
      return video.readyState >= 2 && !video.paused && video.currentTime > 0;
    },
    { timeout: 60_000 },
  );

  await page.locator("#stop").click();
  await expect(page.locator("#stage-overlay")).toBeVisible();
  await expect(page.locator("#stop")).toBeDisabled();
});

test("accesibilidad en acceso, reproductor, ajustes, claro/oscuro y móvil 390 px", async ({ page }) => {
  await openGate(page);
  const gateA11y = await new AxeBuilder({ page }).include("#gate-panel").analyze();
  expect(gateA11y.violations).toEqual([]);

  await login(page);
  const lightA11y = await new AxeBuilder({ page }).include("main").analyze();
  expect(lightA11y.violations).toEqual([]);

  await page.locator("#settings-open").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  const settingsA11y = await new AxeBuilder({ page }).include("#settings-dialog").analyze();
  expect(settingsA11y.violations).toEqual([]);
  await page.locator("#settings-close").click();

  await page.locator("#theme").click();
  const darkA11y = await new AxeBuilder({ page }).include("main").analyze();
  expect(darkA11y.violations).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileA11y = await new AxeBuilder({ page }).include("main").analyze();
  expect(mobileA11y.violations).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
