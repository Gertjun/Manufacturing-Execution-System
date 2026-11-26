import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
const require=createRequire(new URL("../portaal/package.json",import.meta.url));
const {chromium}=require("playwright-core");
const svg=await readFile(new URL("../docs/diagrams/roadmap.svg",import.meta.url),"utf8");
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
try {
  for (const scheme of ["light","dark"]) {
    const page=await browser.newPage({viewport:{width:1200,height:850},colorScheme:scheme});
    await page.setContent('<body style="background:'+(scheme==="dark"?"#0d1117":"#ffffff")+'">'+svg+'</body>');
    await page.evaluate(()=>document.fonts.ready);
    const result=await page.locator("svg").evaluate(el=>{
      const texts=[...el.querySelectorAll("text")];
      const boxes=texts.map(t=>t.getBBox());
      const overlaps=[];
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i],b=boxes[j];
        if(a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height)overlaps.push([texts[i].textContent,texts[j].textContent]);
      }
      return {count:texts.length,overlaps,inside:boxes.every(b=>b.x>=0&&b.y>=0&&b.x+b.width<=1100&&b.y+b.height<=748),background:getComputedStyle(el.querySelector("rect")).fill,ink:texts.every(t=>getComputedStyle(t).fill==="rgb(11, 46, 89)")};
    });
    assert.equal(result.count,33);
    assert.deepEqual(result.overlaps,[]);
    assert.ok(result.inside&&result.ink);
    assert.equal(result.background,"rgb(255, 255, 255)");
    await page.screenshot({path:"/tmp/roadmap-"+scheme+".png"});
    await page.close();
    console.log("Roadmap SVG: "+scheme+" — labels, achtergrond en geometrie OK");
  }
} finally {await browser.close();}
