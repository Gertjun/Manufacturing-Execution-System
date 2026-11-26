// 113.4a: versiegebonden ISA-88-procedureboom en expliciete afhankelijkheden.
import { h, melding } from "../../../gedeeld/ui";
import { haal, stuur, magReceptconcept } from "../basis";

type Kind = "procedure"|"unit_procedure"|"operation"|"phase";
interface Element {id:string;parent_id:string|null;kind:Kind;code:string;name:string;position:number;required:boolean}
interface Dependency {id:string;predecessor_id:string;successor_id:string}
interface Procedure {change_no:number;elements:Element[];dependencies:Dependency[]}
const labels:Record<Kind,string>={procedure:"Procedure",unit_procedure:"Unit procedure",operation:"Operation",phase:"Phase"};
const child:Partial<Record<Kind,Kind>>={procedure:"unit_procedure",unit_procedure:"operation",operation:"phase"};

export function procedurePane(version:{id:string;lifecycle_status:string},current:()=>boolean,refresh:()=>Promise<void>) {
  const base="/recipes/versions/"+encodeURIComponent(version.id)+"/procedure";
  const pane=h("section",{},h("h3",{},"Procedure en afhankelijkheden"));
  const area=h("div",{});
  let generation=0;
  let busy=false;
  async function load() {
    const g=++generation;
    const active=()=>current()&&g===generation;
    if(!active())return;
    area.replaceChildren(h("p",{class:"sub"},"Procedure ophalen…"));
    try {
      const data=await haal<Procedure>(base);
      if(!active())return;
      const editable=version.lifecycle_status==="draft"&&magReceptconcept();
      const error=h("p",{class:"foutmelding",role:"alert"});
      async function mutate(method:string,path:string,body?:object) {
        if(!active()||busy||!editable)return;
        busy=true;
        error.textContent="";
        try {
          await stuur(method,path,body);
        } catch(e) {
          if(active())error.textContent=(e as Error).message;
          return;
        } finally {busy=false;}
        if(!active())return;
        melding("Procedure bijgewerkt","ok");
        // De gedeelde wijzigingsteller geldt ook voor alle andere receptonderdelen.
        await refresh();
      }
      function form(title:string,fields:Node[],run:()=>Promise<void>) {
        return h("details",{class:"engineering-details"},h("summary",{},title),h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{e.preventDefault();await run();}},fields,h("button",{type:"submit",class:"knop knop-hoofd"},"Opslaan")));
      }
      function elementForm(parent:Element|null,existing?:Element) {
        const kind=existing?.kind??(parent?child[parent.kind]:"procedure");
        if(!kind)return null;
        const siblings=data.elements.filter(x=>x.parent_id===(parent?.id??null));
        const c=h("input",{type:"text",required:true,maxlength:100,value:existing?.code??""});
        const n=h("input",{type:"text",required:true,maxlength:250,value:existing?.name??""});
        const pos=h("input",{type:"number",required:true,min:1,max:2147483647,step:1,value:existing?.position??Math.max(0,...siblings.map(s=>s.position))+1});
        const required=h("input",{type:"checkbox",checked:existing?.required??true});
        return form(existing?"Element wijzigen":"Nieuwe "+labels[kind],[
          h("label",{},"Code",c),h("label",{},"Naam",n),h("label",{},"Positie",pos),h("label",{},"Verplicht",required)
        ],()=>mutate(existing?"PATCH":"POST",base+"/elements"+(existing?"/"+existing.id:""),{
          expected_change_no:data.change_no,parent_id:parent?.id??null,kind,code:c.value.trim(),name:n.value.trim(),position:Number(pos.value),required:required.checked
        }));
      }
      const sorted=(parent:string|null)=>data.elements.filter(e=>e.parent_id===parent).sort((a,b)=>a.position-b.position);
      function tree(parent:Element|null):HTMLElement {
        const nodes=sorted(parent?.id??null);
        return h("ul",{class:"engineering-boom"},nodes.map(e=>h("li",{},
          h("strong",{},labels[e.kind]+" · "+e.code+" — "+e.name),
          h("p",{class:"sub"},"Positie "+e.position+" · "+(e.required?"Verplicht":"Optioneel")),
          editable?elementForm(parent,e):null,
          editable&&child[e.kind]?elementForm(e):null,
          editable&&!data.elements.some(x=>x.parent_id===e.id)?h("button",{class:"knop knop-klein",type:"button",onclick:async()=>{
            if(!active()||!window.confirm("Element "+e.code+" verwijderen uit dit concept?"))return;
            await mutate("DELETE",base+"/elements/"+e.id+"?expected_change_no="+data.change_no);
          }},"Element verwijderen"):null,
          sorted(e.id).length?tree(e):null
        )));
      }
      const name=(id:string)=>data.elements.find(x=>x.id===id)?.code??id;
      const predecessors=data.elements.filter(a=>data.elements.some(b=>b.parent_id===a.parent_id&&b.position>a.position&&!data.dependencies.some(d=>d.predecessor_id===a.id&&d.successor_id===b.id)));
      const pred=h("select",{required:true},h("option",{value:""},"Kies voorganger"),predecessors.map(e=>h("option",{value:e.id},e.code+" — "+e.name)));
      const succ=h("select",{required:true},h("option",{value:""},"Kies opvolger"));
      pred.addEventListener("change",()=>{
        const a=data.elements.find(e=>e.id===pred.value);
        const candidates=a?data.elements.filter(b=>b.parent_id===a.parent_id&&b.position>a.position&&!data.dependencies.some(d=>d.predecessor_id===a.id&&d.successor_id===b.id)):[];
        succ.replaceChildren(h("option",{value:""},"Kies opvolger"),...candidates.map(e=>h("option",{value:e.id},e.code+" — "+e.name)));
      });
      area.replaceChildren(
        h("p",{class:"sub"},"Wijzigingsteller: "+data.change_no+(editable?" · Concept":" · Alleen lezen")),
        h("h4",{},"Procedurehiërarchie"),
        data.elements.length?tree(null):h("p",{class:"leeg"},"Nog geen procedure."),
        ...(editable&&!data.elements.length?[elementForm(null)!]:[]),
        h("h4",{},"Afhankelijkheden"),
        h("p",{class:"sub"},"Expliciete voorganger en opvolger binnen dezelfde groep; volgorde alleen is geen afhankelijkheid."),
        data.dependencies.length?h("ul",{},data.dependencies.map(d=>h("li",{},name(d.predecessor_id)+" → "+name(d.successor_id),
          editable?h("button",{type:"button",class:"knop knop-klein",onclick:async()=>{
            if(active()&&window.confirm("Deze afhankelijkheid verwijderen?"))await mutate("DELETE",base+"/dependencies/"+d.id+"?expected_change_no="+data.change_no);
          }},"Verwijderen"):null))):h("p",{class:"leeg"},"Nog geen afhankelijkheden."),
        ...(editable&&predecessors.length?[form("Afhankelijkheid toevoegen",[h("label",{},"Voorganger",pred),h("label",{},"Opvolger",succ)],()=>mutate("POST",base+"/dependencies",{expected_change_no:data.change_no,predecessor_id:pred.value,successor_id:succ.value}))]:[]),
        error);
    }catch(e){if(active())area.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
  }
  const open=h("button",{class:"knop",type:"button",onclick:load},"Procedure laden / vernieuwen");
  pane.append(open,area);
  return pane;
}
