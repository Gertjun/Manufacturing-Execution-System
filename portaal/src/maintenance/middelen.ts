import { h, toon, vastHouden, melding } from "../../../gedeeld/ui";
import { haal, stuur, sessie, magMiddelenbeheer } from "../basis";

interface Item { id:string; code:string; name:string; change_no:number }
interface Hierarchy extends Item { level:string; parent_id:string|null }
interface Equipment extends Item { hierarchy_id:string }
interface Catalog {
  global:boolean; hierarchy:Hierarchy[]; equipment:Equipment[]; classes:Item[]; assets:Item[];
  class_assignments:{id:string;equipment_id:string;equipment_class_id:string}[];
  asset_assignments:{id:string;equipment_id:string;physical_asset_id:string;valid_from:string;valid_until:string|null}[];
}
type Field={label:string; input:HTMLInputElement|HTMLSelectElement};
type Cell=string|number|Node|null;
const text=(label:string,value="",max=250):Field=>({label,input:h("input",{type:"text",required:true,maxlength:max,value})});
function select(label:string,items:{id:string;label:string}[],optional=false):Field {
  return {label,input:h("select",{required:!optional},h("option",{value:""},optional?"Geen":"Maak een keuze"),items.map(x=>h("option",{value:x.id},x.label)))};
}
const opts=(xs:Item[])=>xs.map(x=>({id:x.id,label:x.code+" — "+x.name}));
const value=(f:Field)=>f.input.value.trim();
function table(headers:string[],rows:Cell[][]){
  if (!rows.length) return h("p",{class:"leeg"},"Geen zichtbare gegevens.");
  return h("div",{class:"tabel-kader"},h("table",{class:"tabel compact"},
    h("thead",{},h("tr",{},headers.map(x=>h("th",{scope:"col"},x)))),
    h("tbody",{},rows.map(row=>h("tr",{},row.map(x=>h("td",{},x??"—")))))));
}
function block(title:string,...nodes:(Node|false)[]){
  return h("section",{class:"blok mes-kaart-structuur engineering-kaart"},h("h2",{},title),nodes);
}
const levels=["enterprise","site","area","cell","unit"];
const label=(xs:Item[],id:string|null)=>id?xs.find(x=>x.id===id)?.code??"Buiten zichtbare scope":"—";
const time=(title:string):Field=>({label:title,input:h("input",{type:"datetime-local",required:true,step:1})});
const iso=(f:Field)=>new Date(value(f)).toISOString();
let generation=0;
export async function middelen(){
  const mine=++generation,route=vastHouden(),token=sessie.token,hash=location.hash;
  const current=()=>mine===generation&&route()&&token===sessie.token&&hash===location.hash;
  if(!magMiddelenbeheer())return toon(h("p",{class:"leeg",role:"alert"},"Geen actuele middelenbevoegdheid."));
  toon(h("p",{class:"sub"},"Middelencatalogus ophalen…"));
  try{
    const c=await haal<Catalog>("/resources/");
    if(!current())return;
    function form(title:string,fields:Field[],method:string,path:string,body:()=>object){
      const error=h("p",{class:"foutmelding",role:"alert"});
      return h("details",{class:"engineering-details"},h("summary",{},title),
        h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
          e.preventDefault();if(!current()||!magMiddelenbeheer())return;
          error.textContent="";
          try{await stuur(method,path,body());}catch(e){if(current())error.textContent=(e as Error).message;return;}
          if(!current())return;melding("Wijziging opgeslagen","ok");await middelen();
        }},fields.map(f=>h("label",{},f.label,f.input)),error,h("button",{class:"knop knop-hoofd",type:"submit"},"Opslaan")));
    }
    function rename(path:string,x:Item){const n=text("Naam",x.name);return form("Naam wijzigen",[n],"PATCH","/resources/"+path+"/"+x.id,()=>({name:value(n),expected_change_no:x.change_no}));}
    function create(path:string,title:string){const code=text("Code","",100),name=text("Naam");return form(title,[code,name],"POST","/resources/"+path,()=>({code:value(code),name:value(name)}));}
    const hc=text("Code","",100),hn=text("Naam"),level=select("Niveau",(c.global?levels:levels.slice(3)).map(x=>({id:x,label:x}))),parent=select("Bovenliggend knooppunt",[],true);
    level.input.addEventListener("change",()=>{
      const i=levels.indexOf(value(level));parent.input.replaceChildren(h("option",{value:""},i===0?"Geen":"Maak een keuze"),...opts(c.hierarchy.filter(x=>x.level===levels[i-1])).map(x=>h("option",{value:x.id},x.label)));
      parent.input.required=i!==0;
    });
    const ec=text("Code","",100),en=text("Naam"),loc=select("Locatie",opts(c.hierarchy.filter(x=>["area","cell","unit"].includes(x.level))));
    const eq=select("Middel",opts(c.equipment)),cls=select("Klasse",opts(c.classes));
    const ae=select("Middel",opts(c.equipment)),asset=select("Asset",opts(c.assets)),start=time("Begintijd (lokale tijd)");
    toon(h("div",{class:"kop"},h("div",{},h("h1",{},"Middelenbeheer"),h("p",{class:"sub"},c.global?"Globale catalogus":"Beperkte catalogus · alleen toegestane middelen en locaties")),h("button",{class:"knop",onclick:middelen},"Vernieuwen")),
      block("Middelenhiërarchie",table(["Code","Naam","Niveau","Bovenliggend","Actie"],c.hierarchy.map(x=>[x.code,x.name,x.level,label(c.hierarchy,x.parent_id),rename("hierarchy",x)])),
        (c.global||c.hierarchy.some(x=>["area","cell"].includes(x.level)))&&form("Knooppunt toevoegen",[hc,hn,level,parent],"POST","/resources/hierarchy",()=>({code:value(hc),name:value(hn),level:value(level),parent_id:value(parent)||null}))),
      block("Functionele middelen",table(["Code","Naam","Locatie","Actie"],c.equipment.map(x=>[x.code,x.name,label(c.hierarchy,x.hierarchy_id),rename("equipment",x)])),
        c.hierarchy.some(x=>["area","cell","unit"].includes(x.level))&&form("Middel toevoegen",[ec,en,loc],"POST","/resources/equipment",()=>({code:value(ec),name:value(en),hierarchy_id:value(loc)}))),
      block("Equipmentklassen",table(["Code","Naam","Actie"],c.classes.map(x=>[x.code,x.name,c.global?rename("classes",x):null])),c.global&&create("classes","Klasse toevoegen"),
        table(["Middel","Klasse"],c.class_assignments.map(x=>[label(c.equipment,x.equipment_id),label(c.classes,x.equipment_class_id)])),
        c.equipment.length>0&&c.classes.length>0&&form("Klasse koppelen",[eq,cls],"POST","/resources/class-assignments",()=>({equipment_id:value(eq),equipment_class_id:value(cls)}))),
      block("Fysieke assets",table(["Code","Naam","Actie"],c.assets.map(x=>[x.code,x.name,c.global?rename("assets",x):null])),c.global&&create("assets","Asset toevoegen")),
      block("Assettoewijzingen en historie",h("p",{class:"sub"},"Tijdstippen worden in lokale tijd ingevoerd en als absolute tijd opgeslagen. Historie blijft behouden."),
        table(["Middel","Asset","Vanaf","Tot","Actie"],c.asset_assignments.map(x=>{
          const end=time("Eindtijd (lokale tijd)");
          return [label(c.equipment,x.equipment_id),label(c.assets,x.physical_asset_id),new Date(x.valid_from).toLocaleString("nl-NL"),x.valid_until?new Date(x.valid_until).toLocaleString("nl-NL"):"Open",x.valid_until?null:form("Afsluiten",[end],"POST","/resources/asset-assignments/"+x.id+"/close",()=>({valid_until:iso(end)}))];
        })),
        c.global&&c.equipment.length>0&&c.assets.length>0&&form("Asset toewijzen",[ae,asset,start],"POST","/resources/asset-assignments",()=>({equipment_id:value(ae),physical_asset_id:value(asset),valid_from:iso(start)}))));
  }catch(e){if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message),h("button",{class:"knop",onclick:middelen},"Opnieuw proberen"));}
}
