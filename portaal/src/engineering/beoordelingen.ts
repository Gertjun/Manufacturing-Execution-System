// 113.5c–d: personal review inbox, immutable evidence and confirmed decisions.
import { h, toon, vastHouden, melding } from "../../../gedeeld/ui";
import { haal, stuur, sessie, magReceptbeoordeling, heeftRecht, rechten } from "../basis";

interface Product {id:string;code:string;name:string;can_review:boolean}
interface Inbox {master_recipe_id:string;recipe_code:string;recipe_version_id:string;revision:number;lifecycle_status:string;round_id:string;round_no:number;change_no:number;name:string;required_reviews:string[];approved_domains:string[];my_pending_domains:string[]}
interface ReleaseRecord {id:string;master_recipe_id:string;recipe_version_id:string;round_id:string;effective_from:string;released_at:string;released_by:string;reason:string}
interface WithdrawalRecord {id:string;release_id:string;withdrawn_at:string;withdrawn_by:string;reason:string}
interface Validation {recipe_version_id:string;change_no:number;lifecycle_status:string;content_valid:boolean;blockers:{code:string;record_id:string;detail:string}[]}
interface Dossier {round:{id:string;recipe_version_id:string;round_no:number;change_no:number;baseline_version_id:string|null;baseline_change_no:number|null;matrix_version:number;required_reviews:string[];contributors:string[];created_by:string;created_at:string;snapshot_text:string};lifecycle_status:string;is_current:boolean;decisions:{id:string;domain:string;decision:"approve"|"reject";reason:string;reviewer_id:string;decided_at:string}[];release:ReleaseRecord|null;withdrawal:WithdrawalRecord|null}
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
    const picker=h("select",{"aria-label":"Product"},h("option",{value:""},"Kies een product"),products.map(p=>h("option",{value:p.id},p.code+" — "+p.name)));
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
                const domain=h("select",{required:true,"aria-label":"Beoordelingsdomein"},h("option",{value:""},"Kies bevoegd domein"),pending.map(d=>h("option",{value:d},name(d))));
                const decision=h("select",{required:true,"aria-label":"Besluit"},h("option",{value:""},"Kies besluit"),h("option",{value:"approve"},"Goedkeuren"),h("option",{value:"reject"},"Afwijzen"));
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
              function releasePane(){
                const section=h("section",{class:"engineering-paneel engineering-besluit"},h("h5",{},"Formele vrijgave en intrekking"));
                const product=products.find(p=>p.id===id);
                const permitted=(...permissions:string[])=>!!rechten()?.personal&&(heeftRecht(...permissions)||
                  !!rechten()?.products.some(p=>p.product===id&&permissions.includes(p.permission)));
                const rel=dossier.release, withdrawal=dossier.withdrawal;
                if(rel) {
                  section.append(h("p",{},"Vrijgave-ID: "+rel.id),h("p",{},"Vrijgegeven: "+rel.released_at+" · actor "+rel.released_by),
                    h("p",{},"Ingangsdatum: "+rel.effective_from),h("p",{},rel.reason),
                    h("p",{class:"sub"},"Formele vrijgave betekent niet automatisch dat deze revisie nu effectief is."));
                }
                if(withdrawal) section.append(h("p",{},"Intrekking: "+withdrawal.withdrawn_at+" · actor "+withdrawal.withdrawn_by),h("p",{},withdrawal.reason),h("p",{},"Intrekkings-ID: "+withdrawal.id));
                function action(withdraw:boolean){
                  const reason=h("textarea",{required:true,maxlength:10000,rows:4});
                  const password=h("input",{type:"password",required:true,maxlength:1024,autocomplete:"current-password"});
                  const checked=h("input",{type:"checkbox",required:true});
                  const mode=h("select",{required:true},h("option",{value:""},"Kies expliciet"),h("option",{value:"now"},"Direct bij servervrijgave"),h("option",{value:"future"},"Toekomstige ingangsdatum (UTC)"));
                  const date=h("input",{type:"datetime-local",disabled:true});
                  mode.addEventListener("change",()=>{date.disabled=mode.value!=="future";date.required=!date.disabled;date.value="";});
                  const error=h("p",{class:"foutmelding",role:"alert"});
                  const submit=h("button",{type:"submit",class:withdraw?"knop knop-gevaar":"knop knop-hoofd"},withdraw?"Intrekking bevestigen":"Formele vrijgave bevestigen");
                  return h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
                    e.preventDefault();
                    const secret=password.value;password.value="";
                    if(!active()||busy||!checked.checked||!reason.value.trim()||!secret)return;
                    if(!permitted(...(withdraw?["recipe.withdraw.engineering","recipe.withdraw.quality"]:["recipe.release"])))return;
                    let effective:string|null=null;
                    if(!withdraw){
                      if(mode.value==="future"){
                        const ms=Date.parse(date.value+"Z");
                        if(!Number.isFinite(ms)||ms<=Date.now()){error.textContent="Kies een toekomstige UTC-datum.";return;}
                        effective=new Date(ms).toISOString();
                      }else if(mode.value!=="now")return;
                    }
                    busy=true;submit.disabled=true;error.textContent="";
                    try{
                      if(withdraw&&rel)await stuur("POST","/recipes/releases/"+encodeURIComponent(rel.id)+"/withdrawals",{reason:reason.value.trim(),password:secret});
                      else if(!withdraw)await stuur("POST","/recipes/versions/"+encodeURIComponent(row.recipe_version_id)+"/releases",{round_id:round.id,expected_change_no:round.change_no,effective_from:effective,reason:reason.value.trim(),password:secret});
                    }catch(e){if(active())error.textContent=(e as Error).message;return;}
                    finally{busy=false;submit.disabled=false;password.value="";}
                    if(active()){melding(withdraw?"Intrekking geregistreerd":"Formele vrijgave geregistreerd","ok");await load();}
                  }},h("p",{class:"sub"},withdraw?"Intrekking is definitief; geen automatische terugval naar een oudere revisie.":"Goedkeuring is geen vrijgave. De server controleert alle vrijgavevoorwaarden opnieuw."),
                    withdraw?null:field("Ingangsdatum",mode),withdraw?null:field("Toekomstig tijdstip (UTC)",date),
                    field("Onderbouwing",reason),field("Ik bevestig dit formele besluit",checked),field("Persoonlijk wachtwoord",password),error,submit);
                }
                if(dossier.is_current&&dossier.lifecycle_status==="released"&&rel&&!withdrawal&&rel.round_id===round.id&&rel.recipe_version_id===row.recipe_version_id&&permitted("recipe.withdraw.engineering","recipe.withdraw.quality"))section.append(action(true));
                if(dossier.is_current&&dossier.lifecycle_status==="approved"&&!rel){
                  const result=h("div",{});
                  let checking=false;
                  const button=h("button",{type:"button",class:"knop",onclick:async()=>{
                    if(!active()||busy||checking)return;
                    checking=true;button.disabled=true;result.replaceChildren(h("p",{class:"sub"},"Vrijgavevalidatie ophalen…"));
                    try{
                      const v=await haal<Validation>("/recipes/versions/"+encodeURIComponent(row.recipe_version_id)+"/release-validation");
                      if(!active())return;
                      if(v.recipe_version_id!==row.recipe_version_id||v.change_no!==round.change_no||v.lifecycle_status!=="approved")throw Error("Revisie gewijzigd. Vernieuw het productoverzicht.");
                      result.replaceChildren(h("p",{},v.content_valid&&!v.blockers.length?"Geen inhoudelijke blokkades volgens de server. Dit is geen vrijgave.":"Inhoudelijke vrijgave geblokkeerd."),
                        ...v.blockers.map(b=>h("p",{},b.code+" · "+b.detail+" · record "+b.record_id)),
                        v.content_valid&&!v.blockers.length&&product&&permitted("recipe.release")?action(false):h("p",{class:"sub"},"Geen formele vrijgaveactie beschikbaar."));
                    }catch(e){if(active())result.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
                    finally{checking=false;button.disabled=false;}
                  }},"Vrijgavevalidatie laden / vernieuwen");
                  section.append(button,result);
                }
                return section;
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
                ...(dossier.decisions.length?[]:[h("p",{class:"leeg"},"Nog geen besluiten.")]),
                pending.length?decisionForm():h("p",{class:"sub"},"Geen actuele persoonlijke beoordelingsactie beschikbaar. Goedkeuring is geen formele vrijgave."),releasePane());
            }catch(e){if(active())detail.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
            finally{reading=false;}
          }
          return h("section",{class:"blok mes-kaart-structuur engineering-kaart"},h("h2",{},row.recipe_code+" · revisie "+row.revision+" — "+row.name),
            h("p",{class:"sub engineering-revisiestatus"},(statuses[row.lifecycle_status]??row.lifecycle_status)+" · ronde "+row.round_no),
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
