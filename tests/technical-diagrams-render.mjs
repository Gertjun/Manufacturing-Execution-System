import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
const require=createRequire(new URL("../portaal/package.json",import.meta.url));
const {chromium}=require("playwright-core");
const folder=process.argv[2];
assert.ok(folder);
const files=(await readdir(folder)).filter(f=>f.endsWith(".svg")).sort();
assert.equal(files.length,6);
const axes={
  "architecture.svg":[["J","C","E","B","Q"]],
  "migration.svg":[["A","B","C","D","F","G"]],
  "recipe-lifecycle.svg":[["A","B","C","D","E","G","H","I","J","K"]],
  "process-chain.svg":[["A","B","C","D","E"],["J","I","H","G","F"]]
};
const sideRows={
  "architecture.svg":[["M","O"],["B","G"]],
  "migration.svg":[["E","F"]],
  "recipe-lifecycle.svg":[["E","F"]],
  "process-chain.svg":[["A","J"],["B","I"],["C","H"],["D","G"],["E","F"]]
};
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
try {
  for(const file of files){
    const source=await readFile(path.join(folder,file),"utf8");
    const markup=source.slice(source.indexOf("<svg"));
    for(const scheme of ["light","dark"]){
      const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:scheme});
      await page.setContent('<body style="margin:0;background:'+(scheme==="dark"?"#0d1117":"#ffffff")+'">'+markup+'</body>');
      await page.evaluate(()=>document.fonts.ready);
      const result=await page.locator("svg").evaluate(svg=>{
        const graph=svg.querySelector("g.graph");
        const background=graph.querySelector(":scope > polygon");
        const labels=[...svg.querySelectorAll("g.node text")];
        const boxes=labels.map(t=>{
          const r=t.getBoundingClientRect();
          return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
        });
        const overlap=[];
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
          const a=boxes[i],b=boxes[j];
          if(a.x<b.right&&b.x<a.right&&a.y<b.bottom&&b.y<a.bottom)overlap.push([labels[i].textContent,labels[j].textContent]);
        }
        const geometry=Object.fromEntries([...svg.querySelectorAll("g.node")].map(g=>{const shape=g.querySelector("path, polygon, rect, ellipse");const b=shape.getBBox();return [g.querySelector("title").textContent,{x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height}];}));
        return {geometry,background:getComputedStyle(background).fill,labels:labels.length,overlap,ink:labels.every(t=>["rgb(11, 46, 89)","rgb(27, 36, 48)"].includes(getComputedStyle(t).fill)),width:svg.viewBox.baseVal.width,height:svg.viewBox.baseVal.height};
      });
      assert.equal(result.background,"rgb(255, 255, 255)",file);
      assert.ok(result.labels>0&&result.ink&&result.width>0&&result.height>0,file);
      assert.deepEqual(result.overlap,[],file+" "+scheme);
      if(axes[file]){
        const g=result.geometry;
        const near=(a,b)=>Math.abs(a-b)<1;
        const first=Object.values(g)[0];
        for(const b of Object.values(g))assert.ok(near(b.w,first.w)&&near(b.h,first.h),file+" uniform blocks");
        for(const axis of axes[file]){
          for(const id of axis)assert.ok(near(g[id].x,g[axis[0]].x),file+" axis "+id);
          for(let i=1;i<axis.length;i++)assert.ok(near(g[axis[i]].y-g[axis[i-1]].y,105),file+" row spacing "+axis[i]);
        }
        for(const [a,b] of sideRows[file])assert.ok(near(g[a].y,g[b].y),file+" parallel row "+a+" "+b);
      }
      console.log(file+" "+scheme+" labels="+result.labels+" geometry OK");
      await page.close();
    }
  }
} finally {await browser.close();}
