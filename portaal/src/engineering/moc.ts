// 113.5a: version-bound Management of Change. No review or release action.
import { h, melding } from "../../../gedeeld/ui";
import { haal, stuur, magReceptconcept } from "../basis";

interface Version {id:string;revision:number;name:string;lifecycle_status:string}
interface Request {id:string;baseline_version_id:string|null;change_kind:"initial"|"revision";reason:string;impact_description:string;created_by:string;created_at:string}
type Area="header"|"procedure"|"parameters"|"formula"|"materials"|"equipment"|"personnel"|"instructions"|"quality"|"lot"|"scaling"|"other";
interface Impact {id:string;request_id:string;area:Area;explanation:string}
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
          editable&&data.impacts.length<Object.keys(areas).length?impactForm(r):null)
          :h("div",{},h("p",{class:"leeg"},"Nog geen MOC-dossier."),
            editable&&(version.revision===1||earlier.length)?requestForm():null,
            editable&&version.revision>1&&!earlier.length?h("p",{class:"sub"},"Geen eerdere revisie van deze receptidentiteit beschikbaar."):null),
        error);
    }catch(e){if(active())pane.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
  }
  return h("section",{},h("h3",{},"Management of Change"),h("button",{type:"button",class:"knop",onclick:load},"MOC laden / vernieuwen"),pane);
}
