// 113.3: native MBR-identiteiten en conceptheaders. Geen impliciete
// kopie van receptinhoud, vrijgave of historische mutaties.
import { h, toon, vastHouden, melding } from "../../../gedeeld/ui";
import { haal, stuur, sessie, magReceptconcept } from "../basis";

interface Product {id:string;code:string;name:string;can_edit:boolean;can_review:boolean}
interface Version {id:string;revision:number;name:string;description:string;change_no:number;lifecycle_status:string}
interface Recipe {id:string;code:string;versions:Version[]}
const status:Record<string,string>={draft:"Concept",in_review:"Ter beoordeling",approved:"Goedgekeurd",released:"Formeel vrijgegeven",superseded:"Vervangen",withdrawn:"Ingetrokken"};

export async function recepten() {
  const validRoute=vastHouden(),token=sessie.token,hash=location.hash;
  const current=()=>validRoute()&&sessie.token===token&&location.hash===hash;
  if(!magReceptconcept())return;
  toon(h("p",{class:"sub"},"Bevoegde producten ophalen…"));
  try {
    const products=(await haal<Product[]>("/recipes/products")).filter(p=>p.can_edit);
    if(!current())return;
    const picker=h("select",{required:true},h("option",{value:""},"Kies een product"),products.map(p=>h("option",{value:p.id},p.code+" — "+p.name)));
    const content=h("div",{});
    let generation=0;
    const active=(id:string,g:number)=>current()&&picker.value===id&&generation===g;
    async function load() {
      const id=picker.value,g=++generation;
      if(!current())return;
      content.replaceChildren();
      if(!id)return;
      content.append(h("p",{class:"sub"},"Master Recipes ophalen…"));
      try {
        const recipes=await haal<Recipe[]>("/recipes/?product_id="+encodeURIComponent(id));
        if(!active(id,g))return;
        function editForm(title:string,path:string,method:string,build:(name:string,description:string,code:string)=>object,initial?:Version,withCode=false) {
          const code=h("input",{type:"text",required:withCode,maxlength:100});
          const name=h("input",{type:"text",required:true,maxlength:250,value:initial?.name??""});
          const description=h("textarea",{maxlength:10000,rows:3},initial?.description??"");
          const error=h("p",{class:"foutmelding",role:"alert"});
          return h("details",{},h("summary",{},title),h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
            e.preventDefault();
            if(!active(id,g)||!magReceptconcept())return;
            error.textContent="";
            try {
              await stuur(method,path,build(name.value.trim(),description.value,code.value.trim()));
            }catch(e){if(active(id,g))error.textContent=(e as Error).message;return;}
            if(!active(id,g))return;
            melding("Receptgegevens opgeslagen","ok");
            await load();
          }},
            withCode?h("label",{},"Receptcode",code):null,
            h("label",{},"Naam",name),h("label",{},"Beschrijving",description),error,
            h("button",{class:"knop knop-hoofd",type:"submit"},"Opslaan")));
        }
        content.replaceChildren(
          h("section",{class:"blok"},h("h2",{},"Nieuwe Master Recipe"),
            editForm("Recept aanmaken","/recipes/","POST",(name,description,code)=>({product_id:id,code,name,description}),undefined,true)),
          ...recipes.map(r=>{
            const versions=[...r.versions].sort((a,b)=>b.revision-a.revision);
            const latest=versions[0];
            return h("section",{class:"blok"},h("h2",{},r.code),
              latest?editForm("Nieuwe lege conceptrevisie","/recipes/"+r.id+"/versions","POST",(name,description)=>({expected_revision:latest.revision,name,description}),latest):null,
              latest?h("p",{class:"sub"},"Een nieuwe revisie bevat nog geen gekopieerde receptinhoud."):null,
              ...versions.map(v=>h("details",{},h("summary",{},"Revisie "+v.revision+" — "+v.name+" · "+(status[v.lifecycle_status]??v.lifecycle_status)),
                h("p",{},v.description||"Geen beschrijving"),
                h("p",{class:"sub"},"Wijzigingsteller: "+v.change_no),
                v.lifecycle_status==="draft"?editForm("Conceptheader wijzigen","/recipes/versions/"+v.id,"PATCH",(name,description)=>({expected_change_no:v.change_no,name,description}),v)
                  :h("p",{class:"sub"},"Deze revisie is niet wijzigbaar."),
              )));
          }),
          ...(recipes.length?[]:[h("p",{class:"leeg"},"Voor dit product zijn nog geen Master Recipes.")])
        );
      }catch(e){if(active(id,g))content.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
    }
    picker.addEventListener("change",()=>void load());
    toon(h("div",{class:"kop"},h("div",{},h("h1",{},"Master Recipes"),h("p",{class:"sub"},"Productgebonden receptidentiteiten en afzonderlijke revisies.")),
      h("button",{class:"knop",type:"button",onclick:load},"Vernieuwen")),
      products.length?h("label",{class:"filter"},"Product",picker):h("p",{class:"leeg"},"Geen producten met actuele receptbeheerbevoegdheid."),content);
  }catch(e){if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message),h("button",{class:"knop",onclick:recepten},"Opnieuw proberen"));}
}
