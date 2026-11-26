// Geïsoleerde browserregressie: gebruik de werkelijk gebouwde CSS van beide frontendonderdelen.
// Geen API, database, sessie of service worker nodig. Geen productiedata.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../portaal/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
try {
  for (const frontend of ["portaal", "invoer"]) {
    const dir = new URL("../" + frontend + "/dist/assets/", import.meta.url);
    const files = (await readdir(dir)).filter(f => f.endsWith(".css"));
    assert.ok(files.length, frontend + ": geen gebouwde CSS");
    const css = (await Promise.all(files.map(f => readFile(new URL(f, dir), "utf8")))).join("\n");
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.setContent('<main id="scherm"><h1>Test</h1><button id="primary" class="knop knop-hoofd">Opslaan</button> <button id="secondary" class="knop">Bekijken</button> <button id="danger" class="knop knop-gevaar">Intrekken</button> <button id="disabled" class="knop knop-hoofd" disabled>Niet mogelijk</button><section class="mes-kaart mes-kaart-uitvoering">Uitvoering</section><span class="label label-ok">Binnen grenzen</span><span class="label label-buiten_grens">Buiten grens</span><dialog class="venster"><h2>Invoer</h2><form class="vraag"><label>Waarde<input type="text"></label></form></dialog></main>');
        await page.addStyleTag({ content: css });
        const style = (selector, prop) => page.locator(selector).evaluate((el, p) => getComputedStyle(el)[p], prop);
        const eq = async (selector, prop, expected) => assert.equal(await style(selector, prop), expected, frontend + " " + width + " " + selector + " " + prop);
        await eq("#primary", "backgroundColor", "rgb(255, 255, 255)");
        await eq("#primary", "color", "rgb(180, 83, 9)");
        await eq("#primary", "borderTopColor", "rgb(180, 83, 9)");
        await eq("#secondary", "color", "rgb(11, 46, 89)");
        await eq("#danger", "color", "rgb(179, 38, 30)");
        await eq("#primary", "borderTopLeftRadius", "4px");
        assert.ok(await page.locator("#primary").evaluate(e => e.getBoundingClientRect().height >= 44));
        await page.locator("#primary").hover();
        await eq("#primary", "backgroundColor", "rgb(253, 235, 217)");
        await eq("#primary", "color", "rgb(147, 65, 11)");
        await page.locator("#disabled").hover();
        await eq("#disabled", "backgroundColor", "rgb(255, 255, 255)");
        await page.mouse.move(0, 0);
        await page.keyboard.press("Tab");
        assert.ok(await page.locator("#primary").evaluate(e => e.matches(":focus-visible")));
        await eq("#primary", "outlineColor", "rgb(23, 74, 149)");
        await eq(".mes-kaart", "borderTopColor", "rgb(242, 140, 40)");
        await eq(".mes-kaart", "backgroundColor", "rgb(255, 255, 255)");
        await eq(".label-ok", "color", "rgb(46, 125, 79)");
        await eq(".label-buiten_grens", "backgroundColor", "rgb(251, 236, 235)");
        await page.locator("dialog").evaluate(e => e.showModal());
        await eq(".venster", "borderTopLeftRadius", "8px");
        await eq(".vraag input", "borderTopLeftRadius", "4px");
        console.log("OK B+ componenten", frontend, width);
      } finally { await page.close(); }
    }
  }
} finally { await browser.close(); }
