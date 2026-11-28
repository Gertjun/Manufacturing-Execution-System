import { h, toon, vastHouden, melding } from "../../../gedeeld/ui";
import { haal, stuur, sessie, magMiddelenbeheer, magMiddelenstatus, magWerkstationbeheer, magMiddelstilstand } from "../basis";

type Item={id:string;code:string;name:string};
type Property=Item & {quantity_kind_id:string;measurement_unit_id:string;unit:string};
type Capability={id:string;equipment_id:string;property_definition_id:string;revision:number|null;value:string|null;reason:string|null;created_at:string|null;capacity:boolean};
type Capabilities={global:boolean;equipment:Item[];properties:Property[];capabilities:Capability[]};
type References={quantity_kinds:Item[];units:(Item & {quantity_kind_id:string;symbol:string})[]};
type Status="unknown"|"blocked"|"available";
type Evidence={revision:number;status:Status;reason:string|null;created_at:string|null;created_by_name:string|null};
type StatusRow=Item & Evidence & {can_manage:boolean};
type Field={label:string;input:HTMLInputElement|HTMLSelectElement};
type Cell=string|number|Node|null;
const val=(f:Field)=>f.input.value.trim();
const text=(label:string,value="",max=2000):Field=>({label,input:h("input",{type:"text",required:true,maxlength:max,value})});
// Waarden blijven tekst, ook op mobiele toetsenborden.
function decimal(label:string,value=""):Field {
  const field=text(label,value,256);
  field.input.setAttribute("inputmode","decimal");
  field.input.setAttribute("pattern","[+\\-]?[0-9]+(?:[.][0-9]+)?");
  return field;
}
function select(label:string,items:{id:string;label:string}[]):Field {
  return {label,input:h("select",{required:true},h("option",{value:""},"Maak een keuze"),items.map(x=>h("option",{value:x.id},x.label)))};
}
const opts=(xs:Item[])=>xs.map(x=>({id:x.id,label:x.code+" — "+x.name}));
const label=(xs:Item[],id:string)=>xs.find(x=>x.id===id)?.code??"Onbekend";
const date=(v:string|null)=>v?new Date(v).toLocaleString("nl-NL"):"—";
function table(headers:string[],rows:Cell[][]){
  return rows.length?h("div",{class:"tabel-kader"},h("table",{class:"tabel compact"},
    h("thead",{},h("tr",{},headers.map(x=>h("th",{scope:"col"},x)))),
    h("tbody",{},rows.map(r=>h("tr",{},r.map(x=>h("td",{},x??"—"))))))):h("p",{class:"leeg"},"Geen zichtbare gegevens.");
}
function block(title:string,...nodes:(Node|false)[]){
  return h("section",{class:"blok mes-kaart-structuur engineering-kaart"},h("h2",{},title),nodes);
}
let generation=0;
function guard(){
  const mine=++generation,route=vastHouden(),token=sessie.token,hash=location.hash;
  return ()=>mine===generation&&route()&&token===sessie.token&&hash===location.hash;
}
function form(title:string,fields:Field[],path:string,body:()=>object,current:()=>boolean,allowed:()=>boolean,refresh:()=>Promise<void>){
  const error=h("p",{class:"foutmelding",role:"alert"});
  const submit=h("button",{class:"knop knop-hoofd",type:"submit"},"Opslaan");
  let busy=false;
  return h("details",{class:"engineering-details"},h("summary",{},title),
    h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
      e.preventDefault();if(busy||!current()||!allowed())return;
      busy=true;submit.disabled=true;error.textContent="";
      try{await stuur("POST",path,body());if(current()){melding("Wijziging opgeslagen","ok");await refresh();}}
      catch(e){if(current())error.textContent=(e as Error).message;}
      finally{busy=false;submit.disabled=false;}
    }},fields.map(f=>h("label",{},f.label,f.input)),error,submit));
}
export async function capaciteiten(){
  const current=guard();
  if(!magMiddelenbeheer()){toon(h("p",{class:"leeg",role:"alert"},"Geen actuele middelenbevoegdheid."));return;}
  toon(h("p",{class:"sub"},"Eigenschappen ophalen…"));
  try{
    const c=await haal<Capabilities>("/resources/capabilities");
    if(!current())return;
    const refs=c.global?await haal<References>("/resources/property-references"):null;
    if(!current())return;
    const edit=(title:string,fields:Field[],path:string,body:()=>object)=>form(title,fields,path,body,current,magMiddelenbeheer,capaciteiten);
    const eq=select("Middel",opts(c.equipment)),prop=select("Eigenschap",opts(c.properties)),amount=decimal("Exacte waarde"),why=text("Reden");
    let createProperty:Node|false=false;
    if(refs){
      const code=text("Code","",100),name=text("Naam","",250),kind=select("Grootheid",opts(refs.quantity_kinds)),unit=select("Eenheid",[]);
      kind.input.addEventListener("change",()=>unit.input.replaceChildren(h("option",{value:""},"Maak een keuze"),
        ...refs.units.filter(x=>x.quantity_kind_id===val(kind)).map(x=>h("option",{value:x.id},x.code+" — "+x.symbol))));
      createProperty=edit("Eigenschap definiëren",[code,name,kind,unit],"/resources/properties",()=>({code:val(code),name:val(name),quantity_kind_id:val(kind),measurement_unit_id:val(unit)}));
    }
    const rows=c.capabilities.map(x=>{
      const p=c.properties.find(p=>p.id===x.property_definition_id);
      const value=decimal("Exacte waarde",x.value??""),reason=text("Reden");
      const actions=h("div",{},
        x.revision!==null?edit("Revisie toevoegen",[value,reason],"/resources/capabilities/"+x.id+"/revisions",()=>({expected_revision:x.revision,value:val(value),reason:val(reason)})):null,
        !x.capacity&&x.revision!==null?edit("Als technische capaciteit aanwijzen",[],"/resources/capabilities/"+x.id+"/capacity",()=>({expected_revision:x.revision})):null);
      return [label(c.equipment,x.equipment_id),p?.name??"Onbekend",x.value??"Onbekend",p?.unit??"—",x.revision??"—",x.capacity?"Ja":"Nee",actions];
    });
    toon(h("div",{class:"kop"},h("div",{},h("h1",{},"Eigenschappen en capaciteit"),h("p",{class:"sub"},"Exacte waarden · geen planning of technische vrijgave")),h("button",{class:"knop",onclick:capaciteiten},"Vernieuwen")),
      block("Eigenschapsdefinities",table(["Code","Naam","Eenheid"],c.properties.map(p=>[p.code,p.name,p.unit])),createProperty),
      block("Middeleneigenschappen",table(["Middel","Eigenschap","Waarde","Eenheid","Revisie","Capaciteit","Actie"],rows),
        c.equipment.length>0&&c.properties.length>0&&edit("Eigenschap aan middel toevoegen",[eq,prop,amount,why],"/resources/capabilities",()=>({equipment_id:val(eq),property_definition_id:val(prop),value:val(amount),reason:val(why)}))));
  }catch(e){if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message),h("button",{class:"knop",onclick:capaciteiten},"Opnieuw proberen"));}
}
const statusLabel=(s:Status)=>s==="blocked"?"Geblokkeerd":s==="available"?"Beschikbaar":"Onbekend";
export async function middelenstatus(){
  const current=guard();
  if(!magMiddelenstatus()){toon(h("p",{class:"leeg",role:"alert"},"Geen actuele statusbevoegdheid."));return;}
  toon(h("p",{class:"sub"},"Technische middelenstatus ophalen…"));
  try{
    const rows=await haal<StatusRow[]>("/resources/statuses");
    if(!current())return;
    // Onafhankelijke leesprojectie; geen stilstand opvragen zonder het eigen recht.
    let stops:Downtime[]|null=null;
    let stopsError=false;
    if(magMiddelstilstand()){
      try{stops=await haal<Downtime[]>("/stilstand/middelen");}
      catch{stopsError=true;}
    }
    if(!current())return;
    const activeStops=new Set((stops??[]).map(x=>x.equipment_id));
    const statusRows=rows.map(x=>{
      const next=x.status==="blocked"?"available":x.status==="available"?"blocked":null;
      const choice=select("Nieuwe technische status",next?[{id:next,label:statusLabel(next)}]:[{id:"blocked",label:"Geblokkeerd"},{id:"available",label:"Beschikbaar"}]);
      const reason=text("Reden");
      const target=h("div",{});
      const history=h("button",{class:"knop",onclick:async()=>{
        if(!current()||!magMiddelenstatus())return;
        history.disabled=true;target.replaceChildren(h("p",{class:"sub"},"Historie ophalen…"));
        try{
          const data=await haal<Evidence[]>("/resources/equipment/"+x.id+"/status-history");
          if(current())target.replaceChildren(table(["Revisie","Status","Reden","Tijd","Medewerker"],data.map(r=>[r.revision,statusLabel(r.status),r.reason,date(r.created_at),r.created_by_name])));
        }catch(e){if(current())target.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
        finally{history.disabled=false;}
      }},"Historie ophalen");
      return [x.code,x.name,statusLabel(x.status),stops===null?"Niet beschikbaar":activeStops.has(x.id)?"Actieve melding":"Geen actieve melding",x.revision,x.reason,date(x.created_at),x.created_by_name,
        x.can_manage===true?form("Status wijzigen",[choice,reason],"/resources/equipment/"+x.id+"/status",()=>({expected_revision:x.revision,status:val(choice),reason:val(reason)}),current,()=>x.can_manage===true&&magMiddelenstatus(),middelenstatus):"Alleen lezen",
        h("details",{class:"engineering-details"},h("summary",{},"Historie"),history,target)];
    });
    toon(h("div",{class:"kop"},h("div",{},h("h1",{},"Technische middelenstatus"),h("p",{class:"sub"},"Onbekend is niet beschikbaar. Geen vervanging van veiligheidsprocedures of operationele stilstand.")),h("button",{class:"knop",onclick:middelenstatus},"Vernieuwen")),
      block("Statusoverzicht",h("p",{class:"sub"},["available","blocked","unknown"].map(s=>statusLabel(s as Status)+": "+rows.filter(x=>x.status===s).length).join(" · ")),
        stopsError?h("p",{class:"sub",role:"status"},"Operationele stilstand kon niet worden opgehaald. Vernieuw voor een nieuwe poging."):false,
        h("p",{class:"sub"},"Geen actieve melding is geen bewijs van productieactiviteit of fysieke veiligheid."),
        table(["Code","Middel","Technische status","Operationele stilstand","Revisie","Reden","Tijd","Medewerker","Actie","Historie"],statusRows)));
  }catch(e){if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message),h("button",{class:"knop",onclick:middelenstatus},"Opnieuw proberen"));}
}


type Workstation={id:string;name:string;location:string|null;active:boolean};
type Assignment={id:string;pc_id:string;equipment_id:string;opened_at:string;opened_by_name:string;open_reason:string;closed_at:string|null;closed_by_name:string|null;close_reason:string|null};
type Workstations={workstations:Workstation[];equipment:Item[];assignments:Assignment[]};
export async function werkstationkoppelingen(){
  const current=guard();
  if(!magWerkstationbeheer()){toon(h("p",{class:"leeg",role:"alert"},"Geen actuele globale middelenbeheerbevoegdheid."));return;}
  toon(h("p",{class:"sub"},"Werkstationkoppelingen ophalen…"));
  try{
    const c=await haal<Workstations>("/resources/workstations");
    if(!current())return;
    const active=c.workstations.filter(p=>p.active);
    const pc=select("Werkstation",active.map(p=>({id:p.id,label:p.name+(p.location?" — "+p.location:"")})));
    const eq=select("Middel",[]),reason=text("Reden");
    pc.input.addEventListener("change",()=>{
      const linked=new Set(c.assignments.filter(a=>a.pc_id===val(pc)&&a.closed_at===null).map(a=>a.equipment_id));
      eq.input.replaceChildren(h("option",{value:""},"Maak een keuze"),...opts(c.equipment.filter(e=>!linked.has(e.id))).map(e=>h("option",{value:e.id},e.label)));
    });
    const edit=(title:string,fields:Field[],path:string,body:()=>object)=>form(title,fields,path,body,current,magWerkstationbeheer,werkstationkoppelingen);
    const rows=c.assignments.map(a=>{
      const station=c.workstations.find(p=>p.id===a.pc_id);
      const why=text("Reden van ontkoppeling");
      return [station?station.name+(station.active?"":" (inactief)"):"Onbekend",label(c.equipment,a.equipment_id),
        date(a.opened_at),a.opened_by_name,a.open_reason,date(a.closed_at),a.closed_by_name,a.close_reason,
        a.closed_at?"Afgesloten":"Actief",
        a.closed_at?null:edit("Koppeling beëindigen",[why],"/resources/workstation-assignments/"+a.id+"/close",()=>({reason:val(why)}))];
    });
    toon(h("div",{class:"kop"},h("div",{},h("h1",{},"Werkstationkoppelingen"),h("p",{class:"sub"},"Expliciete koppelingen · geen technische vrijgave of productiebevoegdheid")),h("button",{class:"knop",onclick:werkstationkoppelingen},"Vernieuwen")),
      block("Koppelingen en historie",table(["Werkstation","Middel","Vanaf","Geopend door","Reden","Tot","Gesloten door","Afsluitreden","Status","Actie"],rows),
        active.length>0&&c.equipment.length>0&&edit("Middel koppelen",[pc,eq,reason],"/resources/workstation-assignments",()=>({pc_id:val(pc),equipment_id:val(eq),reason:val(reason)}))));
  }catch(e){if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message),h("button",{class:"knop",onclick:werkstationkoppelingen},"Opnieuw proberen"));}
}

type Downtime={id:string;equipment_id:string;equipment_code:string;equipment_name:string;step_code:string;step_name:string;reason_code:string;reason_name:string;category:string;note:string|null;started_at:string;workstation:string|null;operator:string|null};
export async function middelstilstand(){
  const current=guard();
  if(!magMiddelstilstand()){toon(h("p",{class:"leeg",role:"alert"},"Geen actuele stilstandleesbevoegdheid."));return;}
  toon(h("p",{class:"sub"},"Actuele middelstilstand ophalen…"));
  try{
    const rows=await haal<Downtime[]>("/stilstand/middelen");
    if(!current())return;
    toon(h("div",{class:"kop"},h("div",{},h("h1",{},"Actuele middelstilstand"),h("p",{class:"sub"},"Uitsluitend actieve middelregistraties. Geen technische status of stapbeschikbaarheidsberekening.")),h("button",{class:"knop",onclick:middelstilstand},"Vernieuwen")),
      block("Actieve meldingen ("+rows.length+")",rows.length?
        table(["Middel","Processtap","Oorzaak","Sinds","Werkstation","Gemeld door","Toelichting"],rows.map(x=>[
          x.equipment_code+" — "+x.equipment_name,x.step_code+" — "+x.step_name,x.reason_name,date(x.started_at),x.workstation,x.operator,x.note
        ])):h("p",{class:"leeg"},"Geen actieve middelstilstand geregistreerd.")));
  }catch(e){if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message),h("button",{class:"knop",onclick:middelstilstand},"Opnieuw proberen"));}
}
