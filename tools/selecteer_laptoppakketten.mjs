// D115: selecteer alleen ontbrekende, ondersteunde Windows-pakketten.
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
export function selectPackages(rows,requested=""){
 const valid=v=>/^\d+\.\d+\.\d+$/.test(v);
 const wanted=new Set(requested.trim().split(/\s+/).filter(Boolean));
 if([...wanted].some(v=>!valid(v)))throw Error("Ongeldig versienummer");
 const blocked=new Set(["0.14.0","0.15.0"]);
 const known=new Set(),result=new Set();
 for(const row of rows){
  const v=row.tag_name?.replace(/^v/,"");
  if(!valid(v)||row.tag_name!==`v${v}`||row.draft!==false||row.prerelease!==false)continue;
  known.add(v);
  if(wanted.size&&!wanted.has(v))continue;
  const [major,minor]=v.split(".").map(Number);
  if((major===0&&minor<7)||blocked.has(v))continue;
  if(!Array.isArray(row.assets))throw Error("Assetinformatie ontbreekt");
  if(row.assets.some(a=>a.name===`batch-gui-laptop-${v}-windows.zip`||/^batch-gui-laptop-.*-windows\.zip$/.test(a.name)))continue;
  result.add(v);
 }
 for(const v of wanted)if(!known.has(v))throw Error(`Onbekende officiële release: ${v}`);
 return [...result].sort((a,b)=>{const x=a.split(".").map(Number),y=b.split(".").map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2]});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pages=JSON.parse(readFileSync(process.argv[2],"utf8"));
 if(!Array.isArray(pages)||pages.some(p=>!Array.isArray(p)))throw Error("Ongeldige releasepagina's");
 console.log("versies="+JSON.stringify(selectPackages(pages.flat(),process.env.GEVRAAGD??"")));
}
