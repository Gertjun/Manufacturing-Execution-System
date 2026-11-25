// 113.5c: personal review inbox, immutable evidence and confirmed decisions.
import { h, toon, vastHouden, melding } from "../../../gedeeld/ui";
import { haal, stuur, sessie, magReceptbeoordeling } from "../basis";

interface Product {id:string;code:string;name:string;can_review:boolean}
interface Inbox {master_recipe_id:string;recipe_code:string;recipe_version_id:string;revision:number;lifecycle_status:string;round_id:string;round_no:number;change_no:number;name:string;required_reviews:string[];approved_domains:string[];my_pending_domains:string[]}
interface Dossier {round:{id:string;recipe_version_id:string;round_no:number;change_no:number;baseline_version_id:string|null;baseline_change_no:number|null;matrix_version:number;required_reviews:string[];contributors:string[];created_by:string;created_at:string;snapshot_text:string};lifecycle_status:string;is_current:boolean;decisions:{id:string;domain:string;decision:"approve"|"reject";reason:string;reviewer_id:string;decided_at:string}[]}
const domains:Record<string,string>={engineering:"Engineering",production:"Productie",quality:"Kwaliteit"};
const statuses:Record<string,string>={draft:"Concept",in_review:"Ter beoordeling",approved:"Goedgekeurd",released:"Vrijgegeven",superseded:"Vervangen",withdrawn:"Ingetrokken"};
const name=(s:string)=>domains[s]??s;
const field=(label:string,control:Node)=>h("label",{},label,control);

export async function beoordelingen(){
  const route=vastHouden(),token=sessie.token,hash=location.hash;
  const current=()=>route()&&sessie.token===token&&location.hash===hash&&magReceptbeoordeling();
  if(!current())return;
  toon(h("p",{class:"sub"},"Bevoegde producten ophalen…"));
  try{
    const products=(await haal<Product[]>("/recipes/products")).filter(p=>p.can_review);
    if(!current())return;
    const picker=h("select",{},h("option",{value:""},"Kies een product"),products.map(p=>h("option",{value:p.id},p.code+" — "+p.name)));
    const area=h("div",{});
    let generation=0,busy=false;
    async function load(){
      const id=picker.value,g=++generation;
      const active=()=>current()&&generation===g&&picker.value===id;
      if(!active())return;
      area.replaceChildren();
      if(!id)return;
      area.replaceChildren(h("p",{class:"sub"},"Beoordelingsrondes ophalen…"));
      try{
        const rows=await haal<Inbox[]>("/recipes/reviews?product_id="+encodeURIComponent(id));
        if(!active())return;
        function roundPane(row:Inbox){
          const detail=h("div",{});
          let reading=false;
          async function open(){
            if(!active()||busy||reading)return;
            reading=true;detail.replaceChildren(h("p",{class:"sub"},"Vastgezet dossier ophalen…"));
            try{
              const dossier=await haal<Dossier>("/recipes/reviews/"+encodeURIComponent(row.round_id));
              if(!active())return;
              const round=dossier.round;
              if(round.id!==row.round_id||round.recipe_version_id!==row.recipe_version_id||round.change_no!==row.change_no||dossier.lifecycle_status!==row.lifecycle_status)throw Error("Beoordelingsronde gewijzigd. Vernieuw het productoverzicht.");
              const pending=dossier.is_current&&dossier.lifecycle_status==="in_review"?row.my_pending_domains.filter(d=>round.required_reviews.includes(d)&&!dossier.decisions.some(x=>x.domain===d)):[];
              function decisionForm(){
                const domain=h("select",{required:true},h("option",{value:""},"Kies bevoegd domein"),pending.map(d=>h("option",{value:d},name(d))));
                const decision=h("select",{required:true},h("option",{value:""},"Kies besluit"),h("option",{value:"approve"},"Goedkeuren"),h("option",{value:"reject"},"Afwijzen"));
                const reason=h("textarea",{required:true,maxlength:10000,rows:4});
                const password=h("input",{type:"password",required:true,maxlength:1024,autocomplete:"current-password"});
                const checked=h("input",{type:"checkbox",required:true});
                const error=h("p",{class:"foutmelding",role:"alert"});
                const submit=h("button",{type:"submit",class:"knop knop-hoofd"},"Beoordeling bevestigen");
                return h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
                  e.preventDefault();if(!active()||busy||!checked.checked||!pending.includes(domain.value)||!["approve","reject"].includes(decision.value)||!reason.value.trim())return;
                  const secret=password.value;password.value="";
                  if(!secret)return;
                  busy=true;submit.disabled=true;error.textContent="";
                  try{await stuur("POST","/recipes/reviews/"+encodeURIComponent(round.id)+"/decisions",{expected_change_no:round.change_no,domain:domain.value,decision:decision.value,reason:reason.value.trim(),password:secret});}
                  catch(e){if(active())error.textContent=(e as Error).message;return;}
                  finally{busy=false;submit.disabled=false;password.value="";}
                  if(active()){melding("Persoonlijke beoordeling geregistreerd","ok");await load();}
                }},h("h5",{},"Onafhankelijke beoordeling"),field("Beoordelingsdomein",domain),field("Besluit",decision),field("Onderbouwing",reason),
                  field("Ik heb het vastgezette dossier beoordeeld",checked),field("Persoonlijk wachtwoord",password),error,submit);
              }
              detail.replaceChildren(
                h("p",{class:"sub"},"Ronde "+round.round_no+" · teller "+round.change_no+" · matrix "+round.matrix_version+" · "+(dossier.is_current?"Actueel":"Historisch / niet actueel")),
                h("p",{},"Ingediend: "+round.created_at+" · actor "+round.created_by),
                h("p",{},"Referentie: "+(round.baseline_version_id??"Initiële definitie")+" · teller "+(round.baseline_change_no??"—")),
                h("p",{},"Vereiste domeinen: "+round.required_reviews.map(name).join(", ")),
                h("details",{},h("summary",{},"Bijdragers (persoonlijke actor-ID's)"),h("ul",{},...round.contributors.map(x=>h("li",{},x)))),
                h("details",{},h("summary",{},"Exact vastgezet dossier (server-JSON)"),h("pre",{style:"white-space:pre-wrap;overflow-wrap:anywhere"},round.snapshot_text)),
                h("h5",{},"Geregistreerde besluiten"),
                ...dossier.decisions.map(d=>h("div",{},h("p",{},name(d.domain)+" · "+(d.decision==="approve"?"Goedgekeurd":"Afgewezen")+" · "+d.decided_at),
                  h("p",{},d.reason),h("p",{class:"sub"},"Beoordelaar: "+d.reviewer_id))),
                dossier.decisions.length?null:h("p",{class:"leeg"},"Nog geen besluiten."),
                pending.length?decisionForm():h("p",{class:"sub"},"Geen actuele persoonlijke beoordelingsactie beschikbaar. Goedkeuring is geen formele vrijgave."));
            }catch(e){if(active())detail.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
            finally{reading=false;}
          }
          return h("section",{class:"blok"},h("h2",{},row.recipe_code+" · revisie "+row.revision+" — "+row.name),
            h("p",{class:"sub"},(statuses[row.lifecycle_status]??row.lifecycle_status)+" · ronde "+row.round_no),
            h("p",{},"Goedgekeurd: "+(row.approved_domains.map(name).join(", ")||"Geen")+" · Mijn openstaande domeinen: "+(row.my_pending_domains.map(name).join(", ")||"Geen")),
            h("button",{type:"button",class:"knop",onclick:open},"Vastgezet dossier laden / vernieuwen"),detail);
        }
        area.replaceChildren(...rows.map(roundPane),...(rows.length?[]:[h("p",{class:"leeg"},"Geen beoordelingsrondes voor dit product.")]));
      }catch(e){if(active())area.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
    }
    picker.addEventListener("change",()=>void load());
    toon(h("div",{class:"kop"},h("div",{},h("h1",{},"Receptbeoordelingen"),h("p",{class:"sub"},"Persoonlijke productscope, vastgezette dossiers en onafhankelijke besluiten.")),h("button",{type:"button",class:"knop",onclick:load},"Vernieuwen")),
      products.length?field("Product",picker):h("p",{class:"leeg"},"Geen producten met actuele beoordelingsleestoegang."),area);
  }catch(e){if(current())toon(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
}
