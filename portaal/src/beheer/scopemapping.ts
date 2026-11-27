import { h, toon, vastHouden, melding } from "../../../gedeeld/ui";
import { haal, stuur, sessie, magScopemapping } from "../basis";

interface Target { id:string; code:string; name:string }
interface Mapping {
  areas:Target[];
  equipment:(Target & { hierarchy_id:string })[];
  area_scopes:{id:string;area_code:string;hierarchy_id:string}[];
  equipment_scopes:{id:string;equipment_code:string;equipment_id:string}[];
}
let generation=0;
function table(rows:string[][]){
  if(!rows.length)return h("p",{class:"leeg"},"Nog geen mappings.");
  return h("div",{class:"tabel-kader"},h("table",{class:"tabel compact"},
    h("thead",{},h("tr",{},["Autorisatiecode","Cataloguscode","Naam"].map(x=>h("th",{scope:"col"},x)))),
    h("tbody",{},rows.map(row=>h("tr",{},row.map(x=>h("td",{},x)))))));
}
export async function scopemapping(){
  const mine=++generation,route=vastHouden(),token=sessie.token,hash=location.hash;
  const current=()=>mine===generation&&route()&&token===sessie.token&&hash===location.hash;
  if(!magScopemapping())return toon(h("p",{class:"leeg",role:"alert"},"Geen actuele bevoegdheid voor scopemapping."));
  toon(h("p",{class:"sub"},"Scopemappings ophalen…"));
  try{
    const c=await haal<Mapping>("/resources/scopes");
    if(!current())return;
    function block(kind:"areas"|"equipment",title:string,targets:Target[],mappings:{code:string;target:string}[]){
      const available=targets.filter(t=>!mappings.some(m=>m.target===t.id));
      const code=h("input",{type:"text",required:true,maxlength:100,autocomplete:"off"});
      const target=h("select",{required:true},h("option",{value:""},"Maak een keuze"),available.map(t=>h("option",{value:t.id},t.code+" — "+t.name)));
      const error=h("p",{class:"foutmelding",role:"alert"});
      const confirmation=h("input",{type:"checkbox",required:true});
      const form=h("details",{class:"engineering-details"},h("summary",{},"Nieuwe mapping toevoegen"),
        h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
          e.preventDefault();
          if(!current()||!magScopemapping()||!confirmation.checked)return;
          error.textContent="";
          try{
            const body=kind==="areas"?{area_code:code.value.trim(),hierarchy_id:target.value}:{equipment_code:code.value.trim(),equipment_id:target.value};
            await stuur("POST","/resources/scopes/"+kind,body);
          }catch(e){if(current())error.textContent=(e as Error).message;return;}
          if(!current())return;
          melding("Scopemapping opgeslagen","ok");
          await scopemapping();
        }},h("label",{},"Exacte autorisatiecode",code),h("label",{},"Catalogusobject",target),
        h("label",{},confirmation," Ik heb de autorisatiecode en het doel gecontroleerd. Deze mapping kan niet worden gewijzigd of verwijderd."),
        error,h("button",{class:"knop knop-hoofd",type:"submit"},"Mapping vastleggen")));
      return h("section",{class:"blok mes-kaart-structuur engineering-kaart"},h("h2",{},title),
        table(mappings.map(m=>{const t=targets.find(x=>x.id===m.target);return [m.code,t?.code??"Onbekend",t?.name??"—"];})),
        available.length?form:h("p",{class:"sub"},"Geen ongemapte catalogusobjecten beschikbaar."));
    }
    toon(h("div",{class:"kop"},h("div",{},h("h1",{},"Scopemapping middelen"),h("p",{class:"sub"},"Securitybeheer · expliciete koppeling tussen autorisatiecodes en catalogusobjecten.")),h("button",{class:"knop",onclick:scopemapping},"Vernieuwen")),
      h("p",{class:"sub"},"Een mapping verleent zelf geen bevoegdheid, maar bepaalt de concrete context waarin bestaande of toekomstige begrensde grants gelden. Controleer daarom de code en het doel zorgvuldig. Geen wijziging of verwijdering beschikbaar."),
      block("areas","Gebiedsmappings",c.areas,c.area_scopes.map(m=>({code:m.area_code,target:m.hierarchy_id}))),
      block("equipment","Middelmappings",c.equipment,c.equipment_scopes.map(m=>({code:m.equipment_code,target:m.equipment_id}))));
  }catch(e){if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message),h("button",{class:"knop",onclick:scopemapping},"Opnieuw proberen"));}
}
