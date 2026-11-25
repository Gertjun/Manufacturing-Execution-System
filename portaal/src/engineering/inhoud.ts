// 113.4b: reference formula and independent numerical parameter conditions.
import { h, melding } from "../../../gedeeld/ui";
import { haal, stuur, magReceptconcept } from "../basis";

type DataType="decimal"|"integer"|"boolean"|"text";
type Category="target"|"operating_tolerance"|"process_limit"|"specification_limit"|"statistical_control_limit";
interface Parameter {id:string;procedural_element_id:string;code:string;name:string;data_type:DataType;unit:string|null;frequency:string;required:boolean;responsible_activity:string;critical:boolean;measurement_unit_id:string|null}
interface Limit {id:string;parameter_id:string;data_type:"decimal"|"integer";category:Category;target_value:string|null;lower_value:string|null;upper_value:string|null;scaling:"fixed"|"linear"}
interface Formula {id:string;reference_quantity:string;reference_unit:string;reference_unit_id:string|null}
interface MaterialRequirement {id:string;formula_id:string;procedural_element_id:string|null;material_version_id:string;code:string;direction:"input"|"output";quantity:string;unit:string;scaling:"fixed"|"linear";measurement_unit_id:string|null}
interface MaterialReference {id:string;material_code:string;revision:number;name:string;unit:string|null;measurement_unit_id:string|null}
interface EquipmentRequirement {id:string;procedural_element_id:string;code:string;equipment_class_code:string;description:string;required_count:number;minimum_capacity:string|null;capacity_unit_id:string|null}
interface PersonnelRequirement {id:string;procedural_element_id:string;code:string;qualification_code:string;qualification_description:string;required_count:number}
interface Requirements {change_no:number;equipment_requirements:EquipmentRequirement[];personnel_requirements:PersonnelRequirement[]}
interface References {materials:MaterialReference[];qualifications:{code:string;description:string}[]}
interface Content {change_no:number;parameters:Parameter[];parameter_limits:Limit[];formulas:Formula[];material_requirements:MaterialRequirement[]}
interface Procedure {change_no:number;elements:{id:string;code:string;name:string;kind:string}[]}
interface Catalog {units:{id:string;code:string;symbol:string;name:string}[]}
const categories:Record<Category,string>={target:"Doelwaarde",operating_tolerance:"Bedrijfstolerantie",process_limit:"Procesgrens",specification_limit:"Specificatiegrens",statistical_control_limit:"Statistische beheersgrens"};
const numeric=(type:string)=>type==="decimal"||type==="integer";
type Choice={id:string;label:string};
function choice(options:Choice[],selected="",required=true) {
  return h("select",{required},h("option",{value:"",selected:!selected},required?"Maak een keuze":"Geen"),options.map(o=>h("option",{value:o.id,selected:o.id===selected},o.label)));
}
const input=(v="",max=250)=>h("input",{type:"text",required:true,maxlength:max,value:v});
const exact=(v:string|null="",required=false)=>h("input",{type:"text",inputmode:"decimal",pattern:"-?[0-9]+(\\.[0-9]+)?",maxlength:100,required,value:v??""});
const field=(name:string,control:Node)=>h("label",{},name,control);
const decimalValue=(f:HTMLInputElement)=>f.value.trim()||null;

export function contentPane(version:{id:string;lifecycle_status:string},productId:string,current:()=>boolean,refresh:()=>Promise<void>) {
  const prefix="/recipes/versions/"+encodeURIComponent(version.id);
  const base=prefix+"/content";
  const area=h("div",{});
  let generation=0,busy=false;
  async function load() {
    const g=++generation,active=()=>current()&&generation===g;
    if(!active())return;
    area.replaceChildren(h("p",{class:"sub"},"Formule en parameters ophalen…"));
    try {
      const [data,procedure,catalog,references,requirements]=await Promise.all([haal<Content>(base),haal<Procedure>(prefix+"/procedure"),haal<Catalog>("/units/for-product/"+encodeURIComponent(productId)),haal<References>("/recipes/references/"+encodeURIComponent(productId)),haal<Requirements>(prefix+"/requirements")]);
      if(!active())return;
      if(data.change_no!==procedure.change_no||data.change_no!==requirements.change_no)throw Error("Recept is ondertussen gewijzigd. Vernieuw het onderdeel.");
      const editable=version.lifecycle_status==="draft"&&magReceptconcept();
      const error=h("p",{class:"foutmelding",role:"alert"});
      const unitOptions=catalog.units.map(u=>({id:u.id,label:u.code+" — "+u.symbol+" ("+u.name+")"}));
      const elementOptions=procedure.elements.map(e=>({id:e.id,label:e.code+" — "+e.name+" ("+e.kind+")"}));
      const unit=(id:string)=>catalog.units.find(u=>u.id===id);
      async function mutate(method:string,path:string,body?:object) {
        if(!active()||busy||!editable)return;
        busy=true;error.textContent="";
        try{await stuur(method,path,body);}
        catch(e){if(active())error.textContent=(e as Error).message;return;}
        finally{busy=false;}
        if(!active())return;
        melding("Receptinhoud opgeslagen","ok");
        await refresh();
      }
      function save(title:string,fields:Node[],path:string,body:()=>object,id?:string,root=base) {
        return h("details",{},h("summary",{},title),h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
          e.preventDefault();
          if(!active())return;
          try{await mutate(id?"PATCH":"POST",root+"/"+path+(id?"/"+id:""),{expected_change_no:data.change_no,...body()});}
          catch(e){if(active())error.textContent=(e as Error).message;}
        }},fields,h("button",{class:"knop knop-hoofd",type:"submit"},"Opslaan")));
      }
      function remove(path:string,id:string,label:string,root=base) {
        return h("button",{class:"knop knop-klein",type:"button",onclick:async()=>{
          if(active()&&window.confirm(label+" verwijderen uit dit concept?"))await mutate("DELETE",root+"/"+path+"/"+id+"?expected_change_no="+data.change_no);
        }},"Verwijderen");
      }
      function formulaForm(f?:Formula) {
        const quantity=exact(f?.reference_quantity??"",true);
        const u=choice(unitOptions,f?.reference_unit_id??"");
        return save(f?"Referentieformule wijzigen":"Referentieformule aanmaken",[field("Referentiehoeveelheid",quantity),field("Referentie-eenheid",u)],"formulas",()=>{
          const selected=unit(u.value);
          if(!selected)throw Error("Kies een cataloguseenheid.");
          return {reference_quantity:quantity.value.trim(),reference_unit:selected.symbol,reference_unit_id:selected.id};
        },f?.id);
      }
      function parameterForm(p?:Parameter) {
        const element=choice(elementOptions,p?.procedural_element_id??"");
        const code=input(p?.code??"",100),name=input(p?.name??"");
        const type=choice([{id:"decimal",label:"Decimaal"},{id:"integer",label:"Geheel getal"},{id:"boolean",label:"Ja/nee"},{id:"text",label:"Tekst"}],p?.data_type??"decimal");
        const u=choice(unitOptions,p?.measurement_unit_id??"");
        const frequency=input(p?.frequency??"",10000),activity=input(p?.responsible_activity??"",10000);
        const required=h("input",{type:"checkbox",checked:p?.required??true}),critical=h("input",{type:"checkbox",checked:p?.critical??false});
        function sync(){u.disabled=!numeric(type.value);u.required=numeric(type.value);}
        type.addEventListener("change",sync);sync();
        return save(p?"Parameter wijzigen":"Nieuwe parameter",[
          field("Procedure-element",element),field("Code",code),field("Naam",name),field("Datatype",type),field("Cataloguseenheid (numeriek)",u),
          field("Meetfrequentie",frequency),field("Verantwoordelijke activiteit",activity),field("Verplicht",required),field("Kritisch",critical)
        ],"parameters",()=>{
          const selected=numeric(type.value)?unit(u.value):undefined;
          if(numeric(type.value)&&!selected)throw Error("Numerieke parameter vereist een cataloguseenheid.");
          return {procedural_element_id:element.value,code:code.value.trim(),name:name.value.trim(),data_type:type.value,unit:selected?.symbol??null,
            frequency:frequency.value.trim(),responsible_activity:activity.value.trim(),required:required.checked,critical:critical.checked,measurement_unit_id:selected?.id??null};
        },p?.id);
      }
      function limitForm(p:Parameter,l?:Limit) {
        const available=(Object.keys(categories) as Category[]).filter(c=>c===l?.category||!data.parameter_limits.some(x=>x.parameter_id===p.id&&x.category===c));
        const category=choice(available.map(c=>({id:c,label:categories[c]})),l?.category??"");
        const target=exact(l?.target_value),lower=exact(l?.lower_value),upper=exact(l?.upper_value);
        const scaling=choice([{id:"fixed",label:"Vast"},{id:"linear",label:"Lineair"}],l?.scaling??"fixed");
        function sync(){
          const isTarget=category.value==="target";
          target.disabled=!isTarget;target.required=isTarget;
          lower.disabled=isTarget;upper.disabled=isTarget;
          lower.required=false;upper.required=false;
        }
        category.addEventListener("change",sync);sync();
        return save(l?"Voorwaarde wijzigen":"Voorwaarde toevoegen",[
          field("Categorie",category),field("Doelwaarde",target),field("Ondergrens",lower),field("Bovengrens",upper),field("Schaling",scaling)
        ],"parameter-limits",()=>{
          const isTarget=category.value==="target";
          const lo=isTarget?null:decimalValue(lower),hi=isTarget?null:decimalValue(upper);
          if(!isTarget&&lo===null&&hi===null)throw Error("Geef ten minste één grens op.");
          return {parameter_id:p.id,data_type:p.data_type,category:category.value,target_value:isTarget?decimalValue(target):null,lower_value:lo,upper_value:hi,scaling:scaling.value};
        },l?.id);
      }
      const materialLabel=(m:MaterialReference)=>m.material_code+" — "+m.name+" · revisie "+m.revision+" ("+(m.unit??"geen eenheid")+")";
      // Only explicitly mapped, internally consistent material revisions are selectable.
      // Historical unmapped requirements remain visible, but can only be corrected
      // by an explicit selection of a mapped revision (never a guessed conversion).
      const usableMaterials=references.materials.filter(m=>m.measurement_unit_id!==null&&m.unit!==null&&unit(m.measurement_unit_id)?.symbol===m.unit);
      function materialForm(m?:MaterialRequirement) {
        const formula=choice(data.formulas.map(f=>({id:f.id,label:f.reference_quantity+" "+f.reference_unit})),m?.formula_id??data.formulas[0]?.id??"");
        const element=choice(elementOptions,m?.procedural_element_id??"",false);
        const material=choice(usableMaterials.map(r=>({id:r.id,label:materialLabel(r)})),m?.material_version_id??"");
        const code=input(m?.code??"",100);
        const direction=choice([{id:"input",label:"Input (benodigd materiaal)"},{id:"output",label:"Output (ontstaan materiaal)"}],m?.direction??"input");
        const quantity=exact(m?.quantity??"",true);
        const scaling=choice([{id:"fixed",label:"Vast"},{id:"linear",label:"Lineair"}],m?.scaling??"fixed");
        const unitText=h("p",{class:"sub","aria-live":"polite"});
        function sync(){
          const selected=usableMaterials.find(r=>r.id===material.value);
          unitText.textContent=selected?"Eenheid uit materiaalrevisie: "+selected.unit:"Kies een expliciet gekoppelde materiaalrevisie.";
        }
        material.addEventListener("change",sync);sync();
        return save(m?"Materiaalvereiste wijzigen":"Materiaalvereiste toevoegen",[
          field("Referentieformule",formula),field("Procedure-element (optioneel)",element),
          field("Materiaalrevisie",material),unitText,field("Code vereiste",code),field("Richting",direction),
          field("Hoeveelheid bij referentieformule",quantity),field("Schaling",scaling)
        ],"material-requirements",()=>{
          const selected=usableMaterials.find(r=>r.id===material.value);
          if(!selected||selected.unit===null||selected.measurement_unit_id===null)throw Error("Kies een materiaalrevisie met expliciete cataloguseenheid.");
          return {formula_id:formula.value,procedural_element_id:element.value||null,material_version_id:selected.id,
            code:code.value.trim(),direction:direction.value,quantity:quantity.value.trim(),unit:selected.unit,
            scaling:scaling.value,measurement_unit_id:selected.measurement_unit_id};
        },m?.id);
      }
      const requirementsRoot=prefix+"/requirements";
      function equipmentForm(r?:EquipmentRequirement) {
        const element=choice(elementOptions,r?.procedural_element_id??"");
        const code=input(r?.code??"",100),equipmentClass=input(r?.equipment_class_code??"",100);
        const description=input(r?.description??"",10000);
        const count=h("input",{type:"number",min:1,max:2147483647,step:1,required:true,value:String(r?.required_count??1)});
        const capacity=exact(r?.minimum_capacity??"");
        const capacityUnit=choice(unitOptions,r?.capacity_unit_id??"",false);
        function sync(){
          const hasCapacity=capacity.value.trim()!=="";
          capacityUnit.disabled=!hasCapacity;
          capacityUnit.required=hasCapacity;
        }
        capacity.addEventListener("input",sync);sync();
        return save(r?"Equipmentvereiste wijzigen":"Equipmentvereiste toevoegen",[
          field("Procedure-element",element),field("Code vereiste",code),
          field("Equipmentklassecode (voorlopig)",equipmentClass),field("Omschrijving",description),
          field("Vereist aantal",count),field("Minimumcapaciteit (optioneel)",capacity),field("Capaciteitseenheid",capacityUnit)
        ],"equipment-requirements",()=>{
          const n=Number(count.value),value=decimalValue(capacity);
          if(!Number.isInteger(n)||n<1||n>2147483647)throw Error("Geef een geldig positief geheel aantal op.");
          if(value!==null&&(!/^[0-9]+(?:\.[0-9]+)?$/.test(value)||!/[1-9]/.test(value)||!unit(capacityUnit.value)))throw Error("Minimumcapaciteit vereist een positieve waarde en cataloguseenheid.");
          return {procedural_element_id:element.value,code:code.value.trim(),equipment_class_code:equipmentClass.value.trim(),
            description:description.value.trim(),required_count:n,minimum_capacity:value,capacity_unit_id:value===null?null:capacityUnit.value};
        },r?.id,requirementsRoot);
      }
      function personnelForm(r?:PersonnelRequirement) {
        const element=choice(elementOptions,r?.procedural_element_id??"");
        const code=input(r?.code??"",100);
        const qualification=choice(references.qualifications.map(q=>({id:q.code,label:q.code+" — "+q.description})),r?.qualification_code??"");
        const count=h("input",{type:"number",min:1,max:2147483647,step:1,required:true,value:String(r?.required_count??1)});
        return save(r?"Personeelsvereiste wijzigen":"Personeelsvereiste toevoegen",[
          field("Procedure-element",element),field("Code vereiste",code),
          field("Vereiste kwalificatie",qualification),field("Vereist aantal gekwalificeerde personen",count)
        ],"personnel-requirements",()=>{
          const n=Number(count.value);
          if(!Number.isInteger(n)||n<1||n>2147483647)throw Error("Geef een geldig positief geheel aantal op.");
          if(!references.qualifications.some(q=>q.code===qualification.value))throw Error("Kies een bekende kwalificatie.");
          if(!elementOptions.some(e=>e.id===element.value))throw Error("Kies een procedure-element uit deze receptversie.");
          if(requirements.personnel_requirements.some(x=>x.id!==r?.id&&x.procedural_element_id===element.value&&x.qualification_code===qualification.value))throw Error("Deze kwalificatie is al vereist voor dit procedure-element.");
          return {procedural_element_id:element.value,code:code.value.trim(),qualification_code:qualification.value,required_count:n};
        },r?.id,requirementsRoot);
      }
      area.replaceChildren(
        h("p",{class:"sub"},"Wijzigingsteller: "+data.change_no+(editable?" · Concept":" · Alleen lezen")),
        h("h4",{},"Referentieformule"),
        ...(data.formulas.length?data.formulas.map(f=>h("div",{},h("p",{},f.reference_quantity+" "+f.reference_unit+(f.reference_unit_id?"":" — niet gekoppeld")),
          editable&&unitOptions.length?formulaForm(f):null,editable?remove("formulas",f.id,"Referentieformule"):null)):[h("p",{class:"leeg"},"Nog geen referentieformule.")]),
        ...(editable&&!data.formulas.length&&unitOptions.length?[formulaForm()]:[]),
        ...(editable&&!unitOptions.length?[h("p",{class:"sub"},"Maak eerst een cataloguseenheid aan.")]:[]),
        h("h4",{},"Materiaalvereisten"),
        h("p",{class:"sub"},"Exacte materiaalrevisie en bijbehorende eenheid. Hoeveelheden horen bij de referentieformule; er wordt hier niet gerekend of geconverteerd."),
        ...data.material_requirements.map(m=>{
          const reference=references.materials.find(r=>r.id===m.material_version_id);
          const element=procedure.elements.find(e=>e.id===m.procedural_element_id);
          return h("details",{},h("summary",{},m.code+" · "+(m.direction==="input"?"Input":"Output")+" · "+m.quantity+" "+m.unit),
            h("p",{},reference?materialLabel(reference):m.material_version_id),
            h("p",{class:"sub"},"Procedure-element: "+(element?element.code+" — "+element.name:m.procedural_element_id??"Gehele formule")+" · "+(m.scaling==="linear"?"Lineair":"Vast")),
            !m.measurement_unit_id?h("p",{class:"foutmelding"},"Nog geen expliciete cataloguseenheid gekoppeld; vrijgave geblokkeerd."):null,
            editable&&data.formulas.length&&usableMaterials.length?materialForm(m):null,
            editable?remove("material-requirements",m.id,"Materiaalvereiste "+m.code):null);
        }),
        ...(data.material_requirements.length?[]:[h("p",{class:"leeg"},"Nog geen materiaalvereisten.")]),
        ...(editable&&data.formulas.length&&usableMaterials.length?[materialForm()]:[]),
        ...(editable&&!data.formulas.length?[h("p",{class:"sub"},"Maak eerst de referentieformule aan.")]:[]),
        ...(editable&&!usableMaterials.length?[h("p",{class:"sub"},"Geen materiaalrevisies met expliciet gekoppelde cataloguseenheid beschikbaar.")]:[]),
        h("h4",{},"Equipmentvereisten"),
        h("p",{class:"sub"},"Voorlopige equipmentklasse-eisen per procedure-element; geen fysieke toewijzing. Resourcecatalogus en geschiktheidsvalidatie volgen in fase 4."),
        ...requirements.equipment_requirements.map(r=>{
          const element=procedure.elements.find(e=>e.id===r.procedural_element_id);
          const u=r.capacity_unit_id?unit(r.capacity_unit_id):undefined;
          return h("details",{},h("summary",{},r.code+" — "+r.equipment_class_code),
            h("p",{},r.description),
            h("p",{class:"sub"},"Procedure-element: "+(element?element.code+" — "+element.name:r.procedural_element_id)+" · Aantal: "+r.required_count),
            h("p",{},"Minimumcapaciteit: "+(r.minimum_capacity===null?"Niet opgegeven":r.minimum_capacity+" "+(u?.symbol??r.capacity_unit_id??"onbekende eenheid"))),
            editable&&elementOptions.length?equipmentForm(r):null,
            editable?remove("equipment-requirements",r.id,"Equipmentvereiste "+r.code,requirementsRoot):null);
        }),
        ...(requirements.equipment_requirements.length?[]:[h("p",{class:"leeg"},"Nog geen equipmentvereisten.")]),
        ...(editable&&elementOptions.length?[equipmentForm()]:[]),
        h("h4",{},"Personeelsvereisten"),
        h("p",{class:"sub"},"Kwalificatie-eisen per procedure-element. Dit kent geen kwalificaties, bevoegdheden of medewerkers toe."),
        ...requirements.personnel_requirements.map(r=>{
          const element=procedure.elements.find(e=>e.id===r.procedural_element_id);
          return h("details",{},h("summary",{},r.code+" — "+r.qualification_code),
            h("p",{},r.qualification_description),
            h("p",{class:"sub"},"Procedure-element: "+(element?element.code+" — "+element.name:r.procedural_element_id)+" · Aantal: "+r.required_count),
            editable&&elementOptions.length&&references.qualifications.length?personnelForm(r):null,
            editable?remove("personnel-requirements",r.id,"Personeelsvereiste "+r.code,requirementsRoot):null);
        }),
        ...(requirements.personnel_requirements.length?[]:[h("p",{class:"leeg"},"Nog geen personeelsvereisten.")]),
        ...(editable&&elementOptions.length&&references.qualifications.length?[personnelForm()]:[]),
        ...(editable&&!references.qualifications.length?[h("p",{class:"sub"},"Geen kwalificaties in de referentiecatalogus beschikbaar.")]:[]),
        h("h4",{},"Procesparameters"),
        ...data.parameters.map(p=>{
          const limits=data.parameter_limits.filter(l=>l.parameter_id===p.id);
          return h("details",{},h("summary",{},p.code+" — "+p.name),
            h("p",{class:"sub"},(procedure.elements.find(e=>e.id===p.procedural_element_id)?.code??p.procedural_element_id)+" · "+p.data_type+" · "+(p.unit??"geen eenheid")),
            h("p",{},"Frequentie: "+p.frequency+" · Activiteit: "+p.responsible_activity+" · "+(p.required?"Verplicht":"Optioneel")+" · "+(p.critical?"Kritisch":"Niet kritisch")),
            editable?parameterForm(p):null,editable?remove("parameters",p.id,"Parameter "+p.code):null,
            h("h5",{},"Onafhankelijke voorwaarden"),
            ...limits.map(l=>h("div",{},h("p",{},categories[l.category]+": "+(l.category==="target"?l.target_value:(l.lower_value??"—")+" tot "+(l.upper_value??"—"))+" · "+l.scaling),
              editable?limitForm(p,l):null,editable?remove("parameter-limits",l.id,categories[l.category]):null)),
            editable&&numeric(p.data_type)&&limits.length<5?limitForm(p):null);
        }),
        ...(data.parameters.length?[]:[h("p",{class:"leeg"},"Nog geen procesparameters.")]),
        ...(editable&&elementOptions.length?[parameterForm()]:[]),
        ...(editable&&!elementOptions.length?[h("p",{class:"sub"},"Maak eerst procedure-elementen aan.")]:[]),error
      );
    }catch(e){if(active())area.replaceChildren(h("p",{class:"foutmelding",role:"alert"},(e as Error).message));}
  }
  return h("section",{},h("h3",{},"Formule, middelenvereisten en procesparameters"),h("button",{type:"button",class:"knop",onclick:load},"Receptinhoud laden / vernieuwen"),area);
}
