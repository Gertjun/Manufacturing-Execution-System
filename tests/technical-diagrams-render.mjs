import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
const require=createRequire(new URL("../portaal/package.json",import.meta.url));
const {chromium}=require("playwright-core");
const folder=process.argv[2];
assert.ok(folder);
const files=(await readdir(folder)).filter(f=>f.endsWith(".svg")).sort();
assert.deepEqual(files, [
  "architecture.svg", "conceptual-erd.svg", "migration.svg", "physical-erd.svg",
  "physical-execution.svg", "physical-identity.svg", "physical-master-data.svg",
  "physical-planning.svg", "physical-quality.svg", "physical-support.svg",
  "process-chain.svg", "recipe-lifecycle.svg"
]);
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
        const flowNodes=[...svg.querySelectorAll("g.node")];
        const fixed=flowNodes.every(n=>n.querySelector("rect"));
        let textInside=true, edgeHits=0, allTextOverlap=0;
        if(fixed){
          const rects=flowNodes.map(n=>n.querySelector("rect").getBBox());
          const hit=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
          textInside=flowNodes.every((n,i)=>{
            const t=n.querySelector("text").getBBox(),r=rects[i];
            return t.x>=r.x+4&&t.y>=r.y+3&&t.x+t.width<=r.x+r.width-4&&t.y+t.height<=r.y+r.height-3;
          });
          edgeHits=[...svg.querySelectorAll("g.edge text")].flatMap(e=>rects.filter(r=>hit(e.getBBox(),r))).length;
          const all=[...svg.querySelectorAll("text")].map(n=>n.getBBox());
          allTextOverlap=all.flatMap((a,i)=>all.slice(i+1).filter(b=>hit(a,b))).length;
        }
        const clusters=[...svg.querySelectorAll("g.cluster text")].map(n=>n.textContent);
        return {clusters,fixed,textInside,edgeHits,allTextOverlap,geometry,background:getComputedStyle(background).fill,labels:labels.length,overlap,ink:labels.every(t=>["rgb(11, 46, 89)","rgb(27, 36, 48)"].includes(getComputedStyle(t).fill)),width:svg.viewBox.baseVal.width,height:svg.viewBox.baseVal.height};
      });
      assert.equal(result.background,"rgb(255, 255, 255)",file);
      assert.ok(result.labels>0&&result.ink&&result.width>0&&result.height>0,file);
      assert.deepEqual(result.overlap,[],file+" "+scheme);
      if (file === "conceptual-erd.svg") {
        assert.equal(result.labels, 20, file);
        assert.deepEqual(result.clusters.sort(), [
          "Materiaal en partijen", "Middelen en fysieke assets", "Recept, planning en productie-uitvoering"
        ], file);
        const g = result.geometry;
        const first = g.PRODUCT;
        for (const b of Object.values(g)) {
          assert.ok(Math.abs(b.w - first.w) < 1 && Math.abs(b.h - first.h) < 1, file + " uniform blocks");
        }
        for (const [a, b] of [["PRODUCT", "PRODUCTION_ORDER"], ["MASTER_RECIPE", "JOB_ORDER"],
                              ["WAARDE", "QUALITY_RELEASE"], ["EQUIPMENT", "PHYSICAL_ASSET"]]) {
          assert.ok(Math.abs(g[a].y - g[b].y) < 1, file + " parallel row " + a + " " + b);
        }
      }
      if (file.startsWith("physical-") && file !== "physical-erd.svg") {
        assert.ok(result.width < 4000, file + " domain diagram is narrower than the schema overview");
      }
      if(axes[file]){
        assert.ok(result.fixed&&result.textInside,file+" text fits blocks");
        assert.equal(result.edgeHits,0,file+" edge label hits block");
        assert.equal(result.allTextOverlap,0,file+" all text overlap");
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
