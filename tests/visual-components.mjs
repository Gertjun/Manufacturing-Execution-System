// Geïsoleerde browserregressie: gebruik de werkelijk gebouwde CSS van beide frontendonderdelen.
// Geen API, database, sessie of service worker nodig. Geen productiedata.
import assert from "node:assert/strict";
import { FORMATEN } from "./screen-formats.mjs";
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
    for (const { width, height } of FORMATEN) {
      const page = await browser.newPage({ viewport: { width, height } });
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
        if (frontend === "portaal") {
          await page.locator("dialog").evaluate(e => e.close());
          await page.locator("#scherm").evaluate(el => { el.innerHTML = '<section class="blok operations-kaart"><div class="tegel operations-cijfer"><span class="tegel-getal">12</span></div><a class="staptegel open-acties">1 bezig</a><a class="staptegel knelpunt open-acties">5 klaar</a><a class="staptegel leeg-stap">Niets klaar</a></section>'; });
          await eq(".operations-kaart", "borderTopColor", "rgb(242, 140, 40)");
          await eq(".operations-cijfer", "borderTopWidth", "3px");
          await eq(".operations-cijfer .tegel-getal", "color", "rgb(11, 46, 89)");
          await eq(".staptegel.open-acties:not(.knelpunt)", "borderLeftWidth", "6px");
          await eq(".staptegel.open-acties:not(.knelpunt)", "borderLeftColor", "rgb(31, 95, 191)");
          await eq(".staptegel.knelpunt", "borderTopColor", "rgb(242, 140, 40)");
          assert.match(await style(".staptegel.knelpunt","boxShadow"), /rgb\(242, 194, 0\) 6px 0px 0px 0px inset/);
          await eq(".staptegel.leeg-stap", "backgroundColor", "rgba(0, 0, 0, 0)");
          console.log("OK 139.3e: operationele kaarten en knelpunten", width);
          await page.locator("#scherm").evaluate(el => { el.innerHTML = '<section class="blok kwaliteit-kaart kwaliteit-open">Wacht op meting</section><section class="blok kwaliteit-definitie">Specificatie</section><div class="tegel kwaliteit-cijfer let-op"><span class="tegel-getal">2</span></div><div class="regelkaart"><svg xmlns="http://www.w3.org/2000/svg"><line class="rk-spec"/><line class="rk-grens"/></svg></div>'; });
          await eq(".kwaliteit-open", "borderTopColor", "rgb(242, 140, 40)");
          await eq(".kwaliteit-open", "borderLeftWidth", "6px");
          await eq(".kwaliteit-open", "borderLeftColor", "rgb(31, 95, 191)");
          await eq(".kwaliteit-definitie", "borderTopColor", "rgb(11, 46, 89)");
          await eq(".kwaliteit-cijfer .tegel-getal", "color", "rgb(163, 95, 0)");
          await eq(".rk-spec", "stroke", "rgb(179, 38, 30)");
          await eq(".rk-grens", "strokeDasharray", "6px, 4px");
          console.log("OK 139.3f: kwaliteitskaarten, specificaties en regelgrenzen", width);
          await page.locator("#scherm").evaluate(el => { el.innerHTML = '<section class="blok planning-kaart planning-open">Lotvoorstel</section><section class="blok planning-definitie">Capaciteit</section><section class="dagkaart te-vol">Te vol</section><div class="legenda"><i class="blokje reeks-tol"></i></div><svg class="regelkaart" xmlns="http://www.w3.org/2000/svg"><rect class="rk-zone-1"/><rect class="rk-zone-2"/><rect class="rk-zone-3"/><path class="reeks-1"/><path class="tolerantielijn"/></svg><i class="leg-lijn leg-tol"></i><i class="leg-lijn leg-setting"></i>'; });
          await eq(".planning-open", "borderLeftWidth", "6px");
          await eq(".planning-open", "borderTopColor", "rgb(242, 140, 40)");
          await eq(".planning-definitie", "borderTopColor", "rgb(11, 46, 89)");
          await eq(".dagkaart.te-vol", "borderLeftWidth", "6px");
          await eq(".blokje.reeks-tol", "backgroundColor", "rgb(212, 154, 69)");
          await eq(".rk-zone-1", "fill", "rgb(241, 248, 244)");
          await eq(".rk-zone-2", "fill", "rgb(252, 241, 223)");
          await eq(".rk-zone-3", "fill", "rgb(251, 236, 236)");
          await eq(".reeks-1", "fill", "rgb(101, 136, 178)");
          await eq(".tolerantielijn", "stroke", "rgb(163, 95, 0)");
          await eq(".leg-lijn.leg-tol", "borderTopColor", "rgb(163, 95, 0)");
          await eq(".leg-lijn.leg-setting", "borderTopColor", "rgb(107, 119, 133)");
          console.log("OK 139.3g: planning en grafiekpalet C", width);
          await page.locator("#scherm").evaluate(el => { el.innerHTML = '<div class="beheer-indeling"><nav class="stappenlijst"><a aria-current="page">Stap</a></nav><section class="blok formulier-blok beheer-definitie"><label>Naam<input type="text"></label></section></div><div class="tegel beheer-gebeurtenis nadruk"><span class="tegel-getal">Back-up</span></div><ul class="serverstatus"><li class="status-fout">Actie nodig</li><li class="status-let_op">Let op</li></ul>'; });
          await eq(".beheer-definitie", "borderTopColor", "rgb(11, 46, 89)");
          await eq(".beheer-gebeurtenis", "borderTopColor", "rgb(242, 140, 40)");
          await eq(".beheer-definitie input", "borderTopLeftRadius", "4px");
          assert.ok(await page.locator(".beheer-definitie input").evaluate(e => e.getBoundingClientRect().height >= 44));
          await eq(".serverstatus .status-fout", "borderLeftWidth", "6px");
          await eq(".serverstatus .status-let_op", "borderLeftWidth", "6px");
          await eq(".serverstatus .status-fout", "borderTopLeftRadius", "8px");
          assert.match(await style(".stappenlijst a","boxShadow"), /rgb\(242, 140, 40\) 6px 0px 0px 0px inset/);
          console.log("OK 139.3h: beheerdefinities, serverstatus en navigatie", width);
        }
        if (frontend === "invoer") {
          await page.locator("dialog").evaluate(e => e.close());
          await page.locator("#scherm").evaluate(el => { el.innerHTML = '<a class="tegel bezig">Stap 1 · bezig</a><a class="tegel leeg">Stap 2 · niets klaar</a><div class="veld" data-markering="buiten_tolerantie"><div class="veld-code">Temperatuur</div><div class="veld-invoer"><label>Gemeten<input type="text"></label></div><span class="label label-buiten_tolerantie">Buiten tolerantie</span></div><div class="veld" data-markering="buiten_grens">Buiten grens</div><div class="rij wachtrij-fout">Geweigerd</div>'; });
          await eq(".tegel.bezig", "borderTopColor", "rgb(242, 140, 40)");
          await eq(".tegel.bezig", "borderLeftColor", "rgb(31, 95, 191)");
          await eq(".tegel.bezig", "borderLeftWidth", "6px");
          await eq(".tegel.bezig", "borderTopWidth", "3px");
          await eq(".tegel.bezig", "borderTopLeftRadius", "8px");
          await eq('.veld[data-markering="buiten_tolerantie"]', "borderTopStyle", "dashed");
          await eq('.veld[data-markering="buiten_grens"]', "borderTopStyle", "solid");
          await eq('.veld[data-markering="buiten_grens"]', "borderTopColor", "rgb(179, 38, 30)");
          await eq(".veld-invoer input", "borderTopLeftRadius", "4px");
          assert.ok(await page.locator(".veld-invoer input").evaluate(e => e.getBoundingClientRect().height >= 52));
          await eq(".rij.wachtrij-fout", "borderLeftColor", "rgb(179, 38, 30)");
          await eq(".rij.wachtrij-fout", "borderLeftWidth", "6px");
          console.log("OK 139.3d: uitvoering, meetstatus en wachtrij", width);
        }
        console.log("OK B+ componenten", frontend, width);
      } finally { await page.close(); }
    }
  }
} finally { await browser.close(); }
