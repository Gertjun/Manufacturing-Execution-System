// #113.2: native materiaal- en eenhedencatalogus. Geen vrije eenheidstekst
// bij nieuwe materiaalversies, geen bewerking van historische definities.
import { h, toon, vastHouden, melding } from "../../../gedeeld/ui";
import { haal, stuur, sessie, magMateriaalstamdata } from "../basis";

type Id = string;
interface Class { id: Id; code: string; name: string }
interface Definition { id: Id; code: string; product_id: Id|null; raw_material_id: Id|null }
interface MaterialVersion { id: Id; material_definition_id: Id; revision: number; name: string; material_class_id: Id|null; unit: string|null; measurement_unit_id: Id|null; created_at: string; created_by: Id }
interface Materials { classes: Class[]; definitions: Definition[]; versions: MaterialVersion[] }
const EXP = ["length_exp","mass_exp","time_exp","current_exp","temperature_exp","amount_exp","luminous_exp"] as const;
const EXP_LABEL = ["Lengte (m)","Massa (kg)","Tijd (s)","Stroom (A)","Temperatuur (K)","Hoeveelheid stof (mol)","Lichtsterkte (cd)"];
type Dimension = {id:Id} & Record<typeof EXP[number],number>;
interface QuantityKind extends Class { dimension_id:Id; value_semantics:"ratio"|"absolute"|"difference" }
interface Unit extends Class { quantity_kind_id:Id; symbol:string }
interface Conversion { id:Id; quantity_kind_id:Id; from_unit_id:Id; to_unit_id:Id }
interface ConversionVersion { id:Id; conversion_id:Id; revision:number; factor_numerator:string; factor_denominator:string; additive_offset:string; source_reference:string; created_at:string; created_by:Id }
interface Catalog { dimensions:Dimension[]; quantity_kinds:QuantityKind[]; units:Unit[]; conversions:Conversion[]; versions:ConversionVersion[] }
type Field = {label:string; input:HTMLInputElement|HTMLSelectElement};
type Cell = string|number|Node|null;
const text = (label:string,value="",max=250):Field => ({label,input:h("input",{type:"text",required:true,maxlength:max,value})});
const decimal = (label:string,value:string):Field => ({label,input:h("input",{type:"text",inputmode:"decimal",required:true,maxlength:100,pattern:"-?[0-9]+(\\.[0-9]+)?",value})});
function select(label:string,choices:{id:string;label:string}[],value="",optional=false):Field {
  return {label,input:h("select",{required:!optional},h("option",{value:"",selected:!value},optional?"Geen":"Maak een keuze"),choices.map(x=>h("option",{value:x.id,selected:x.id===value},x.label)))};
}
function opts(xs:Class[]) { return xs.map(x=>({id:x.id,label:x.code+" — "+x.name})); }
const value = (f:Field) => f.input.value.trim();
const nullable = (f:Field) => value(f)||null;
const unitOpts = (c:Catalog) => c.units.map(u=>({id:u.id,label:u.code+" — "+u.symbol+" ("+u.name+")"}));
const dimensionLabel = (d:Dimension) => EXP.map((key,i)=>EXP_LABEL[i].split(" (")[0]+": "+d[key]).join(" · ");
const latest = <T extends {revision:number}>(xs:T[]) => [...xs].sort((a,b)=>b.revision-a.revision)[0];
function table(headers:string[],rows:Cell[][]) {
  return rows.length?h("div",{class:"tabel-kader"},h("table",{class:"tabel compact"},h("thead",{},h("tr",{},headers.map(x=>h("th",{scope:"col"},x)))),h("tbody",{},rows.map(row=>h("tr",{},row.map(x=>h("td",{},x??"—")))))))
    :h("p",{class:"leeg"},"Nog geen definities.");
}
function block(title:string,...nodes:Node[]) { return h("section",{class:"blok mes-kaart-structuur engineering-kaart"},h("h2",{},title),nodes); }
function form(title:string,fields:Field[],path:string,body:()=>object,current:()=>boolean,reload:()=>Promise<void>,button="Opslaan") {
  const error=h("p",{class:"foutmelding",role:"alert"});
  const submit=h("button",{class:"knop knop-hoofd",type:"submit"},button);
  const f=h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
    e.preventDefault();
    if(!current()||!magMateriaalstamdata())return;
    error.textContent="";
    try {
      await stuur("POST",path,body());
    } catch(e) {
      if(current())error.textContent=(e as Error).message;
      return;
    }
    if(!current())return;
    melding("Definitie opgeslagen","ok");
    await reload();
  }},fields.map(x=>h("label",{},x.label,x.input)),error,submit);
  return h("details",{class:"engineering-details"},h("summary",{},title),f);
}
function context() {
  const route=vastHouden(), token=sessie.token, hash=location.hash;
  return ()=>route()&&sessie.token===token&&location.hash===hash;
}
function heading(title:string,desc:string,reload:()=>Promise<void>) {
  return h("div",{class:"kop"},h("div",{},h("h1",{},title),h("p",{class:"sub"},desc)),h("button",{class:"knop",type:"button",onclick:reload},"Vernieuwen"));
}
function failure(e:unknown,current:()=>boolean,reload:()=>Promise<void>) {
  if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message),h("button",{class:"knop",onclick:reload},"Opnieuw proberen"));
}

export async function materialen() {
  const current=context();
  if(!magMateriaalstamdata())return;
  toon(h("p",{class:"sub"},"Materiaalstamgegevens ophalen…"));
  try {
    const [m,c]=await Promise.all([haal<Materials>("/materials/"),haal<Catalog>("/units/")]);
    if(!current())return;
    const code=text("Klassecode","",100),name=text("Naam");
    const matCode=text("Materiaalcode","",100),matName=text("Naam");
    const cls=select("Materiaalklasse",opts(m.classes),"",true);
    const unit=select("Cataloguseenheid",unitOpts(c));
    const unitName=(v:MaterialVersion)=>v.measurement_unit_id?c.units.find(u=>u.id===v.measurement_unit_id)?.code+" ("+v.unit+")":(v.unit??"—")+" — nog niet gekoppeld";
    const className=(id:Id|null)=>m.classes.find(x=>x.id===id)?.name??"—";
    toon(heading("Materiaalstamgegevens","Stabiele materiaalidentiteiten en onveranderlijke revisies.",materialen),
      block("Materiaalklassen",table(["Code","Naam"],m.classes.map(x=>[x.code,x.name])),
        form("Nieuwe materiaalklasse",[code,name],"/materials/classes",()=>({code:value(code),name:value(name)}),current,materialen)),
      block("Nieuwe materiaaldefinitie",h("p",{class:"sub"},"Koppeling aan bestaande product- of grondstofidentiteiten wordt gecontroleerd voorbereid bij bronmigratie."),
        c.units.length?form("Materiaal aanmaken",[matCode,matName,cls,unit],"/materials/definitions/with-unit",()=>({code:value(matCode),name:value(matName),material_class_id:nullable(cls),measurement_unit_id:value(unit),product_id:null,raw_material_id:null}),current,materialen)
          :h("p",{},"Maak eerst een eenheid aan in de ",h("a",{href:"#/engineering/eenheden"},"eenhedencatalogus"),".")),
      ...m.definitions.map(d=>{
        const versions=m.versions.filter(v=>v.material_definition_id===d.id);
        const v=latest(versions);
        const n=text("Naam",v?.name??"");
        const cl=select("Materiaalklasse",opts(m.classes),v?.material_class_id??"",true);
        const u=select("Cataloguseenheid",unitOpts(c),v?.measurement_unit_id??"");
        return block(d.code+(v?" — "+v.name:""),
          h("p",{class:"sub"},"Identiteit: "+d.id+(d.product_id?" · Product: "+d.product_id:"")+(d.raw_material_id?" · Grondstof: "+d.raw_material_id:"")),
          table(["Revisie","Naam","Klasse","Eenheid","Aangemaakt"],[...versions].sort((a,b)=>b.revision-a.revision).map(x=>[x.revision,x.name,className(x.material_class_id),unitName(x),x.created_at])),
          v&&c.units.length?form("Nieuwe revisie",[n,cl,u],"/materials/definitions/"+d.id+"/versions/with-unit",()=>({expected_revision:v.revision,name:value(n),material_class_id:nullable(cl),measurement_unit_id:value(u)}),current,materialen,"Nieuwe revisie opslaan"):h("p",{class:"sub"},"Nieuwe revisie nog niet beschikbaar."));
      }));
  }catch(e){failure(e,current,materialen);}
}

function factors(v?:ConversionVersion) {
  const numerator=decimal("Teller van de factor",v?.factor_numerator??"1");
  const denominator=decimal("Noemer van de factor",v?.factor_denominator??"1");
  const offset=decimal("Additieve offset",v?.additive_offset??"0");
  const source=text("Bron / onderbouwing",v?.source_reference??"",2000);
  return {fields:[numerator,denominator,offset,source],body:()=>({factor_numerator:value(numerator),factor_denominator:value(denominator),additive_offset:value(offset),source_reference:value(source)})};
}
export async function eenheden() {
  const current=context();
  if(!magMateriaalstamdata())return;
  toon(h("p",{class:"sub"},"Eenhedencatalogus ophalen…"));
  try {
    const c=await haal<Catalog>("/units/");
    if(!current())return;
    const exps=EXP.map((key,i)=>({label:EXP_LABEL[i],input:h("input",{type:"number",required:true,min:-32768,max:32767,step:1,value:0})}));
    const dim=select("SI-dimensie",c.dimensions.map(d=>({id:d.id,label:dimensionLabel(d)})));
    const kcode=text("Grootheidscode","",100),kn=text("Naam grootheid");
    const sem=select("Betekenis",[{id:"ratio",label:"Verhouding (ratio)"},{id:"absolute",label:"Absolute waarde"},{id:"difference",label:"Verschil"}]);
    const kind=select("Fysische grootheid",opts(c.quantity_kinds));
    const ucode=text("Eenheidscode","",100),symbol=text("Symbool","",40),uname=text("Naam eenheid");
    const from=select("Broneenheid",unitOpts(c));
    const to=select("Doeleenheid",[]);
    from.input.addEventListener("change",()=>{
      const source=c.units.find(u=>u.id===value(from));
      to.input.replaceChildren(h("option",{value:""},"Maak een keuze"),...unitOpts(c).filter(x=>c.units.some(u=>u.id===x.id&&u.id!==source?.id&&u.quantity_kind_id===source?.quantity_kind_id)).map(x=>h("option",{value:x.id},x.label)));
    });
    const f=factors();
    const un=(id:Id)=>c.units.find(x=>x.id===id)?.code??id;
    const qn=(id:Id)=>c.quantity_kinds.find(x=>x.id===id)?.name??id;
    toon(heading("Eenhedencatalogus","Fysische dimensies, grootheden en exacte conversieversies; geen automatische berekeningen.",eenheden),
      block("SI-dimensies",table(EXP_LABEL,c.dimensions.map(d=>EXP.map(k=>d[k]))),
        form("Nieuwe dimensie",exps,"/units/dimensions",()=>Object.fromEntries(EXP.map((k,i)=>[k,Number(value(exps[i]))])),current,eenheden)),
      block("Fysische grootheden",table(["Code","Naam","Dimensie","Betekenis"],c.quantity_kinds.map(k=>[k.code,k.name,c.dimensions.find(d=>d.id===k.dimension_id)?dimensionLabel(c.dimensions.find(d=>d.id===k.dimension_id)!):k.dimension_id,k.value_semantics])),
        c.dimensions.length?form("Nieuwe grootheid",[dim,kcode,kn,sem],"/units/quantity-kinds",()=>({dimension_id:value(dim),code:value(kcode),name:value(kn),value_semantics:value(sem)}),current,eenheden):h("p",{class:"sub"},"Maak eerst een dimensie aan.")),
      block("Eenheden",table(["Code","Symbool","Naam","Grootheid"],c.units.map(u=>[u.code,u.symbol,u.name,qn(u.quantity_kind_id)])),
        c.quantity_kinds.length?form("Nieuwe eenheid",[kind,ucode,symbol,uname],"/units/units",()=>({quantity_kind_id:value(kind),code:value(ucode),symbol:value(symbol),name:value(uname)}),current,eenheden):h("p",{class:"sub"},"Maak eerst een grootheid aan.")),
      block("Conversie definiëren",h("p",{class:"sub"},"Doelwaarde = bronwaarde × teller / noemer + offset. Alleen dezelfde fysische grootheid; de database valideert de betekenis en factoren."),
        c.units.length>=2?form("Nieuwe conversie",[from,to,...f.fields],"/units/conversions",()=>({from_unit_id:value(from),to_unit_id:value(to),...f.body()}),current,eenheden):h("p",{class:"sub"},"Minstens twee eenheden nodig.")),
      ...c.conversions.map(conv=>{
        const versions=c.versions.filter(v=>v.conversion_id===conv.id);
        const v=latest(versions),fields=factors(v);
        return block(un(conv.from_unit_id)+" → "+un(conv.to_unit_id),
          table(["Revisie","Teller","Noemer","Offset","Bron","Aangemaakt"],[...versions].sort((a,b)=>b.revision-a.revision).map(x=>[x.revision,x.factor_numerator,x.factor_denominator,x.additive_offset,x.source_reference,x.created_at])),
          v?form("Nieuwe conversierevisie",fields.fields,"/units/conversions/"+conv.id+"/versions",()=>({expected_revision:v.revision,...fields.body()}),current,eenheden,"Nieuwe revisie opslaan"):h("p",{class:"sub"},"Geen bestaande revisie."));
      }));
  }catch(e){failure(e,current,eenheden);}
}
