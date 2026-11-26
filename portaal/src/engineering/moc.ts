// 113.5a–c: MOC, comparison and confirmed review submission. No release action.
import { h, melding } from "../../../gedeeld/ui";
import { haal, stuur, magReceptconcept } from "../basis";

interface Version {id:string;revision:number;name:string;lifecycle_status:string}
interface Request {id:string;baseline_version_id:string|null;change_kind:"initial"|"revision";reason:string;impact_description:string;created_by:string;created_at:string}
type Area="header"|"procedure"|"parameters"|"formula"|"materials"|"equipment"|"personnel"|"instructions"|"quality"|"lot"|"scaling"|"other";
interface Impact {id:string;request_id:string;area:Area;explanation:string}
interface ReviewRequirements {matrix_version:number;recipe_version_id:string;change_no:number;baseline_version_id:string|null;baseline_change_no:number|null;impact_areas:string[];required_reviews:string[]}
interface ComparisonIndex {recipe_version_id:string;change_no:number;baseline_version_id:string|null;baseline_change_no:number|null;differences:{area:string;entity:string;item_key:string;change:"added"|"removed"|"changed"}[]}
const reviewDomains:Record<string,string>={engineering:"Engineering",production:"Productie",quality:"Kwaliteit"};
const changeLabels:Record<string,string>={added:"Toegevoegd",removed:"Verwijderd",changed:"Gewijzigd"};
interface Moc {change_no:number;lifecycle_status:string;request:Request|null;impacts:Impact[]}
const areas:Record<Area,string>={header:"Receptheader",procedure:"Procedure",parameters:"Procesparameters",formula:"Formule",materials:"Materialen",equipment:"Equipment",personnel:"Personeel",instructions:"Instructies",quality:"Kwaliteit",lot:"Lotregels",scaling:"Schaalregels",other:"Overig"};
const field=(name:string,control:Node)=>h("label",{},name,control);
const textarea=(value="")=>h("textarea",{required:true,maxlength:10000,rows:4},value);

export function mocPane(version:Version,versions:Version[],current:()=>boolean,refresh:()=>Promise<void>) {
  const base="/recipes/versions/"+encodeURIComponent(version.id)+"/moc";
  const pane=h("div",{});
  let generation=0,busy=false;
  async function load(){
    const g=++generation,active=()=>current()&&g===generation;
    if(!active())return;
    pane.replaceChildren(h("p",{class:"sub"},"MOC-dossier ophalen…"));
    try{
      const data=await haal<Moc>(base);
      if(!active())return;
      const editable=data.lifecycle_status==="draft"&&magReceptconcept();
      const error=h("p",{class:"foutmelding",role:"alert"});
      const earlier=versions.filter(v=>v.revision<version.revision&&v.id!==version.id);
      const label=(id:string)=>{const v=versions.find(v=>v.id===id);return v?"Revisie "+v.revision+" — "+v.name:id;};
      async function mutate(method:string,path:string,body?:object){
        if(!active()||busy||!editable||!magReceptconcept())return;
        busy=true;error.textContent="";
        try{await stuur(method,path,body);}
        catch(e){if(active())error.textContent=(e as Error).message;return;}
        finally{busy=false;}
        if(!active())return;
        melding("MOC-dossier opgeslagen","ok");
        await refresh();
      }
      function form(title:string,fields:Node[],submit:()=>Promise<void>){
        return h("details",{},h("summary",{},title),h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
          e.preventDefault();if(!active()||busy||!editable)return;
          try{await submit();}catch(e){if(active())error.textContent=(e as Error).message;}
        }},fields,h("button",{class:"knop knop-hoofd",type:"submit"},"Opslaan")));
      }
      function requestForm(r?:Request){
        const reason=textarea(r?.reason),impact=textarea(r?.impact_description);
        const baseline=h("select",{required:true},h("option",{value:""},"Kies expliciet een eerdere revisie"),earlier.map(v=>h("option",{value:v.id},label(v.id))));
        const fields:Node[]=[field("Reden wijziging",reason),field("Algemene impactomschrijving",impact)];
        if(!r&&version.revision>1)fields.unshift(field("Onveranderlijke referentierevisie",baseline));
        return form(r?"MOC-omschrijving wijzigen":"MOC-dossier aanmaken",fields,async()=>{
          if(!reason.value.trim()||!impact.value.trim())throw Error("Reden en impactomschrijving zijn verplicht.");
          const common={expected_change_no:data.change_no,reason:reason.value.trim(),impact_description:impact.value.trim()};
          if(r){await mutate("PATCH",base+"/"+encodeURIComponent(r.id),common);return;}
          if(version.revision!==1&&!earlier.some(v=>v.id===baseline.value))throw Error("Kies een eerdere revisie van dezelfde receptidentiteit.");
          if(!window.confirm("MOC-dossier aanmaken? De referentierevisie kan daarna niet worden gewijzigd."))return;
          await mutate("POST",base,{...common,baseline_version_id:version.revision===1?null:baseline.value});
        });
      }
      function impactForm(r:Request,i?:Impact){
        const available=(Object.keys(areas) as Area[]).filter(a=>!data.impacts.some(x=>x.id!==i?.id&&x.area===a));
        const area=h("select",{required:true},h("option",{value:""},"Kies impactgebied"),available.map(a=>h("option",{value:a,selected:a===i?.area},areas[a])));
        const explanation=textarea(i?.explanation);
        return form(i?"Impact wijzigen":"Impact toevoegen",[field("Impactgebied",area),field("Onderbouwing",explanation)],async()=>{
          if(!available.some(a=>a===area.value)||!explanation.value.trim())throw Error("Kies een vrij impactgebied en geef een onderbouwing.");
          await mutate(i?"PATCH":"POST",base+"/impacts"+(i?"/"+encodeURIComponent(i.id):""),{expected_change_no:data.change_no,request_id:r.id,area:area.value,explanation:explanation.value.trim()});
        });
      }
      function submissionForm(matrix:ReviewRequirements){
        const password=h("input",{type:"password",required:true,maxlength:1024,autocomplete:"current-password"});
        const confirmation=h("input",{type:"checkbox",required:true});
        const button=h("button",{class:"knop knop-hoofd",type:"submit"},"Formeel indienen");
        const localError=h("p",{class:"foutmelding",role:"alert"});
        return h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
          e.preventDefault();
          if(!active()||busy||!editable||!magReceptconcept()||!confirmation.checked)return;
          const secret=password.value;password.value="";
          if(!secret)return;
          busy=true;button.disabled=true;localError.textContent="";
          try{
            await stuur("POST",base.replace(/\/moc$/,"")+"/reviews",{expected_change_no:matrix.change_no,expected_baseline_change_no:matrix.baseline_change_no,password:secret});
          }catch(e){if(active())localError.textContent=(e as Error).message;return;}
          finally{busy=false;button.disabled=false;password.value="";}
          if(active()){melding("Recept formeel ingediend ter beoordeling","ok");await refresh();}
        }},h("h5",{},"Formeel indienen ter beoordeling"),
          h("p",{class:"sub"},"Hiermee wordt de exacte receptinhoud bevroren voor een nieuwe beoordelingsronde. Een afwijzing brengt de revisie terug naar concept; goedkeuring is nog geen vrijgave."),
          field("Ik heb de vergelijking en beoordelingsvereisten gecontroleerd",confirmation),
          field("Persoonlijk wachtwoord",password),localError,button);
      }
      function comparisonPane(r:Request){
        const result=h("div",{});
        let reading=false;
        async function compare(){
          if(!active()||reading||busy)return;
          reading=true;result.replaceChildren(h("p",{class:"sub"},"Vergelijking en beoordelingsmatrix ophalen…"));
          try{
            const [raw,matrix]=await Promise.all([
              haal<{comparison_text:string}>(base+"/comparison"),
              haal<ReviewRequirements>(base.replace(/\/moc$/,"")+"/review-requirements")
            ]);
            if(!active())return;
            // Parse only the index and bounded integer counters for navigation.
            // Never render parsed numeric recipe content: the original JSON text is authoritative.
            const index=JSON.parse(raw.comparison_text) as ComparisonIndex;
            if(index.recipe_version_id!==version.id||matrix.recipe_version_id!==version.id||
              index.change_no!==data.change_no||matrix.change_no!==data.change_no||
              index.baseline_version_id!==r.baseline_version_id||matrix.baseline_version_id!==r.baseline_version_id||
              index.baseline_change_no!==matrix.baseline_change_no)throw Error("Recept of referentie is ondertussen gewijzigd. Vernieuw het MOC-dossier.");
            const areaNames=(code:string)=>areas[code as Area]??code;
            const grouped=[...new Set(index.differences.map(x=>x.area))];
            result.replaceChildren(
              h("p",{class:"sub"},"Momentopname · conceptteller "+index.change_no+" · referentieteller "+(index.baseline_change_no??"niet van toepassing")),
              h("h5",{},"Vereiste onafhankelijke beoordelingen"),
              h("p",{class:"sub"},"Matrixversie "+matrix.matrix_version+" · combinatie van opgegeven en afgeleide impactgebieden. Dit is een preview, geen vastgezette beoordelingsronde."),
              h("ul",{},...matrix.required_reviews.map(x=>h("li",{},reviewDomains[x]??x))),
              h("p",{},"Impactgebieden: "+(matrix.impact_areas.map(areaNames).join(", ")||"Geen")),
              h("h5",{},"Inhoudelijke verschillen ("+index.differences.length+")"),
              h("p",{class:"sub"},["added","removed","changed"].map(k=>changeLabels[k]+": "+index.differences.filter(x=>x.change===k).length).join(" · ")),
              ...grouped.map(a=>h("details",{},h("summary",{},areaNames(a)+" ("+index.differences.filter(x=>x.area===a).length+")"),
                h("ul",{},...index.differences.filter(x=>x.area===a).map(x=>h("li",{},(changeLabels[x.change]??x.change)+" · "+x.entity+" · "+x.item_key))))),
              ...(index.differences.length?[]:[h("p",{class:"leeg"},"Geen inhoudelijke verschillen.")]),
              h("details",{},h("summary",{},"Exacte voor-/na-gegevens (server-JSON)"),
                h("p",{class:"sub"},"Originele servertekst, zonder numerieke herinterpretatie of afronding. Bevat alle voor-/na-waarden en sleutels."),
                h("pre",{style:"white-space:pre-wrap;overflow-wrap:anywhere"},raw.comparison_text)),...(editable?[submissionForm(matrix)]:[]));
          }catch(e){if(active())result.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
          finally{reading=false;}
        }
        return h("section",{},h("h5",{},"Revisievergelijking en beoordelingsmatrix"),
          h("p",{class:"sub"},r.baseline_version_id?"Vergelijking met "+label(r.baseline_version_id):"Initiële definitie zonder referentierevisie."),
          h("button",{type:"button",class:"knop",onclick:compare},"Vergelijking en matrix laden / vernieuwen"),result);
      }
      const r=data.request;
      pane.replaceChildren(h("p",{class:"sub"},"Wijzigingsteller: "+data.change_no+(editable?" · Concept":" · Alleen lezen")),
        h("p",{class:"sub"},"Eén onverwijderbaar dossier per receptrevisie. Impactlabels beschrijven de wijziging, maar bewijzen geen volledigheid en bepalen geen autorisatie."),
        r?h("div",{},h("p",{},r.change_kind==="initial"?"Initiële receptdefinitie":"Referentie: "+label(r.baseline_version_id??"")),
          h("p",{class:"sub"},"Aangemaakt: "+r.created_at+" · Persoonlijke actor-ID: "+r.created_by),
          h("h5",{},"Reden"),h("p",{},r.reason),h("h5",{},"Algemene impact"),h("p",{},r.impact_description),
          editable?requestForm(r):null,h("h5",{},"Impactgebieden"),
          ...data.impacts.map(i=>h("details",{},h("summary",{},areas[i.area]),h("p",{},i.explanation),
            editable?impactForm(r,i):null,editable?h("button",{type:"button",class:"knop knop-klein",onclick:async()=>{
              if(active()&&window.confirm("Impactgebied uit dit concept verwijderen?"))await mutate("DELETE",base+"/impacts/"+encodeURIComponent(i.id)+"?expected_change_no="+data.change_no);
            }},"Verwijderen"):null)),
          data.impacts.length?null:h("p",{class:"leeg"},"Nog geen impactgebieden vastgelegd."),
          editable&&data.impacts.length<Object.keys(areas).length?impactForm(r):null,comparisonPane(r))
          :h("div",{},h("p",{class:"leeg"},"Nog geen MOC-dossier."),
            editable&&(version.revision===1||earlier.length)?requestForm():null,
            editable&&version.revision>1&&!earlier.length?h("p",{class:"sub"},"Geen eerdere revisie van deze receptidentiteit beschikbaar."):null),
        error);
    }catch(e){if(active())pane.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
  }
  return h("section",{},h("h3",{},"Management of Change"),h("button",{type:"button",class:"knop",onclick:load},"MOC laden / vernieuwen"),pane);
}
