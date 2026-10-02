// An end-to-end walk of the whole product in a real browser.
//
//   npm run dev -- --port 3210   (in one terminal)
//   npm run walk                 (in another)
//
// It drives the installed Microsoft Edge through every mode, asserts what
// should be on screen at each step, fails on any console error, and saves a
// screenshot of each moment to docs/screens. Nothing is downloaded: it uses
// the browser already on the machine.

import { mkdir, readdir, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const BASE = process.env.WALK_URL ?? "http://localhost:3210";
const OUT = new URL("../docs/screens/", import.meta.url);
const path = (name) => decodeURIComponent(new URL(name, OUT).pathname).replace(/^\/([A-Za-z]:)/, "$1");

await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith(".png")) await rm(path(f));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`page: ${e.message}`));

let passed = 0;
async function step(name, run) {
  try {
    await run();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${String(err.message).split("\n")[0]}`);
    await page.screenshot({ path: path(`fail-${passed + 1}.png`) });
    await browser.close();
    process.exit(1);
  }
}

const see = (text, options) => page.getByText(text, options).first().waitFor({ timeout: 20000 });
const button = (name, options) => page.getByRole("button", { name, ...options });
const mode = (name) => page.getByRole("navigation", { name: "Modes" }).getByRole("button", { name }).click();
const shot = (name, options) => page.screenshot({ path: path(name), ...options });
const tab = (name) => page.getByRole("tab", { name }).click();

await step("entry: tonight looks like the plan", async () => {
  await page.goto(BASE);
  await see("Tonight looks like the plan.");
  await page.waitForTimeout(3200);
  await shot("01-entry.png");
});

await step("signals arrive; nothing has been connected yet", async () => {
  await button("Open tonight").click();
  await see("Savy hasn't read them yet.");
  await see("Today is tracking near plan.");
  await page.waitForTimeout(500);
  await shot("02-signals-waiting.png");
});

await step("Run Savy: events travel through the engines one at a time", async () => {
  await button("Run Savy").click();
  await see("Reading what arrived, in the order it arrived.");
  await page.waitForTimeout(4600);
  await shot("03-savy-reading.png");
});

await step("tonight changed: three decisions, one missing fact, two that can wait", async () => {
  await see("Tonight changed.", { exact: true });
  await see("I found 3 decisions, 1 missing fact and 2 things that can wait.", { exact: false });
  await page.locator('[data-savy-moment="synthesis"]').first().waitFor({ state: "attached", timeout: 8000 });
  await page.waitForTimeout(1600);
  await shot("04-tonight-changed.png");
});

await step("the floor at the peak: one call-out, two servers drowning", async () => {
  await page.getByRole("button", { name: /The floor at 7:00 PM/ }).click();
  await page.locator("svg[aria-label^='Tonight at the peak']").waitFor({ timeout: 5000 });
  await see("Split: Priya + Dee");
  const floor = page.getByRole("button", { name: /The floor at 7:00 PM/ });
  await floor.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await shot("04b-peak-floor.png");
  await floor.click();
  await page.evaluate(() => window.scrollTo(0, 0));
});

await step("the attention budget shows what was kept out of the way", async () => {
  await button("What did you hide?").click();
  await see("Routine sync. Nothing changed.", { exact: false });
  await see("Duplicate of a fact already counted.", { exact: false });
  await button("What did you hide?").click();
});

await step("the decision room: what changed, who decides, what Savy may and may not do", async () => {
  await page.getByRole("button", { name: /Cover the 7 PM peak/ }).first().click();
  await see("What would change Savy's mind");
  await see("external_action_allowed = false", { exact: false });
  await see("Execute within policy");
  await page.getByRole("group", { name: "Explain it for" }).getByRole("button", { name: "On the floor" }).click();
  await see("give them section 4", { exact: false });
  await page.locator("svg[aria-label^='The floor at the peak']").waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  await shot("05-decision-room.png");
});

await step("what if I do nothing: the night runs forward, then Savy's plan beside it", async () => {
  await button("Run the night both ways").click();
  await see("This is the branch where nothing changed.");
  await button(/Show me Savy/).waitFor({ timeout: 15000 });
  await shot("06-do-nothing.png");
  await button(/Show me Savy/).click();
  await button("Compare").waitFor({ timeout: 15000 });
  await button("Compare").click();
  await see("Worst ticket time");
  await page.locator("svg[aria-label^='No change']").first().waitFor({ timeout: 5000 });
  await page.locator("svg[aria-label^=\"Savy's plan\"]").first().waitFor({ timeout: 5000 });
  await page.evaluate(() => document.querySelector("[aria-label='What happens if you do nothing']")?.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await shot("07-two-branches.png");
});

await step("approve from the simulator: the receipt is written", async () => {
  await button(/^Approve: Offer/).click();
  await see("Decision receipt");
  await see("Approved as drafted");
  await page.waitForTimeout(500);
  await shot("08-receipt.png");
  await page.keyboard.press("Escape");
});

await step("one approval ripples: the floor, labor and cash all move", async () => {
  await tab("Staff");
  await see("Added · draft");
  await tab("Cash");
  await page.locator("aside[aria-label='Operating surfaces']").getByText("Approved").first().waitFor({ timeout: 5000 });
  await tab("Staff");
});

await step("the lineup card follows the decision: Sam has the patio", async () => {
  await button("Lineup card").click();
  const card = page.getByRole("dialog", { name: "Pre-shift lineup" });
  await card.waitFor({ timeout: 5000 });
  await card.getByText("Sam", { exact: true }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  await shot("08b-lineup-card.png");
  await page.keyboard.press("Escape");
});

await step("a missing fact is asked of the floor, and the answer closes it", async () => {
  await button("Ask manager to check stock").first().click();
  await page.getByRole("status", { name: "The manager's phone" }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await shot("09-manager-phone.png");
  await see("8 burrata", { exact: false });
  await see("Closed by evidence");
  await tab("Orders");
  await page.locator("aside[aria-label='Operating surfaces']").getByText("+12").first().waitFor({ timeout: 5000 });
});

await step("fork this night: one assumption, only the dependents move", async () => {
  await mode(/Try it/);
  const slider = page.getByLabel("Covers booked");
  await slider.focus();
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowLeft");
  await see("decision", { exact: false });
  await see("stayed exactly as they were", { exact: false });
  await page.waitForTimeout(500);
  await shot("10-fork.png", { fullPage: true });
  await mode(/Live/);
});

await step("pressure test: a vendor timeout is reconciled, never retried blindly", async () => {
  await button("Approve", { exact: true }).first().click();
  await button("Pressure test").click();
  await page.getByRole("switch", { name: "Vendor system times out" }).click();
  await page.keyboard.press("Escape");
  await tab("Orders");
  await button("Submit to vendor").first().click();
  await see("Not retrying: a blind retry could create a second order.");
  await see("Existing order found. No second order created.");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await shot("11-vendor-timeout.png");
});

await step("pressure test: stale sales withdraw only what needed them", async () => {
  await button("Pressure test").click();
  await page.getByRole("switch", { name: "POS sync delayed" }).click();
  await see("Labor: unknown.", { exact: false });
  await page.waitForTimeout(500);
  await shot("12-pressure-test.png");
  await page.getByRole("switch", { name: "POS sync delayed" }).click();
  await page.keyboard.press("Escape");
});

let link = "";
await step("engineering view: the live runtime behind the screen", async () => {
  await button("Engineering").click();
  await see("The UI is a projection of an event-driven restaurant model.");
  await page.getByRole("button", { name: /Event ledger/ }).click();
  await see("duplicate", { exact: true });
  await page.getByRole("button", { name: /Decision ledger/ }).click();
  await see("reservations.updated @ 5:38 PM", { exact: false });
  await page.waitForTimeout(500);
  await shot("13-engineering.png");
  link = await page.evaluate(() => [...document.querySelectorAll("p")].find((p) => p.textContent?.startsWith("#s="))?.textContent ?? "");
  if (!link.startsWith("#s=o0.")) throw new Error(`no session token on screen: "${link}"`);
  await button("Operator").click();
});

await step("fast forward: the close, the receipts, and memory", async () => {
  await mode(/Live/);
  await button("Fast forward to close").click();
  await see("What was expected, and what happened");
  await see("Written to decision memory");
  await see("Monday briefing · drafted at close");
  await see("Greenline Produce invoice 12% over contract");
  await page.waitForTimeout(800);
  await shot("14-close.png");
});

await step("memory: tonight strengthens a pattern; a stale one is flagged", async () => {
  await button("See what Savy learned").click();
  await see("Updated tonight");
  await see("This pattern may no longer hold.", { exact: false });
  await page.waitForTimeout(1300);
  await shot("15-memory.png");
});

await step("a session link reopens the same night", async () => {
  const second = await context.newPage();
  await second.goto(`${BASE}/${link}`);
  await second.getByText("Closed by evidence").first().waitFor({ timeout: 20000 });
  const lit = await second.locator("[data-savy-moment]").count();
  await second.close();
  if (lit !== 0) throw new Error(`a restored session raised ${lit} moment(s)`);
});

await step("lab: every night under every combination of faults", async () => {
  await mode(/Lab/);
  await tab("Every combination");
  await button(/Run all 192/).click();
  await button(/Run all 192 again/).waitFor({ timeout: 90000 });
  const broken = await page.getByText("Promises broken").locator("xpath=preceding-sibling::dd").innerText();
  if (broken.trim() !== "0") throw new Error(`promises broken: ${broken}`);
  await page.waitForTimeout(400);
  await shot("16-stress-lab.png", { fullPage: true });
});

await step("ask: a question answered from the same twin, every figure grounded", async () => {
  await mode(/Ask/);
  await button(/What can wait until Monday/).click();
  await see("figures found in tool results", { exact: false });
  await page.waitForTimeout(500);
  await shot("17-ask.png");
});

await step("another night: the same product reconfigures", async () => {
  await mode(/Try it/);
  await button("Run this night").last().click();
  await see("Savy hasn't read them yet.");
  await button("Run Savy").click();
  await button("Skip to the plan").click();
  await see("Offer Dee an early out at 8:00 PM");
  await see("Weekly cash may dip under your floor");
  await page.waitForTimeout(1200);
  await shot("18-slow-night.png");
});

await step("future: the path, marked as exploration", async () => {
  await mode(/Future/);
  await see("Product exploration", { exact: false });
  await see("Multi-location intelligence");
  await page.waitForTimeout(1400);
  await shot("19-future.png", { fullPage: true });
});

await step("present mode drives the real product, with captions", async () => {
  const p = await context.newPage();
  p.on("pageerror", (e) => problems.push(`present: ${e.message}`));
  await p.goto(BASE);
  await p.getByRole("button", { name: "Watch the three-minute story" }).click();
  const caption = p.getByRole("status", { name: "Present mode" });
  await caption.getByText("Friday, 5:12 PM.").waitFor({ timeout: 8000 });
  await caption.getByText("Run Savy.").waitFor({ timeout: 20000 });
  await p.waitForTimeout(4500);
  await p.screenshot({ path: path("20-present.png") });
  await caption.getByText("Tonight changed.").waitFor({ timeout: 20000 });
  await p.keyboard.press("Escape");
  await caption.waitFor({ state: "detached", timeout: 5000 });
  await p.close();
});

await browser.close();

if (problems.length > 0) {
  console.log(`\n${problems.length} browser error(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`\n${passed} steps passed. No browser errors. Screenshots in docs/screens.`);
