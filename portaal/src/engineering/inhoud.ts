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
interface EquipmentRequirement {id:string;procedural_element_id:string;code:string;equipment_class_code:string;description:string;required_count:number;minimum_capacity:string|null;capacity_unit_id:string|null;equipment_class_id:string|null;capacity_property_definition_id:string|null}
interface PersonnelRequirement {id:string;procedural_element_id:string;code:string;qualification_code:string;qualification_description:string;required_count:number}
interface Instruction {id:string;procedural_element_id:string;code:string;position:number;instruction_text:string;confirmation_required:boolean}
interface SpecificationLink {id:string;parameter_limit_id:string;code:string;description:string}
interface LotRule {id:string;nominal_batch_count:number;deviation_approval_required:boolean;deviation_reason_required:true}
interface CompatibilityRule {id:string;other_recipe_version_id:string;reason:string}
type RuleKind="nonlinear"|"parameter_dependent"|"equipment_dependent";
interface ScalingRule {id:string;code:string;description:string;rule_kind:RuleKind;output_unit_id:string;source_reference:string;applicability:string}
type SourceKind="batch_quantity"|"parameter"|"equipment_property"|"constant";
interface ScalingInput {id:string;rule_id:string;code:string;source_kind:SourceKind;parameter_id:string|null;equipment_property:string|null;constant_value:string|null;unit_id:string;conversion_version_id:string|null;equipment_property_definition_id:string|null}
type Operator="add"|"subtract"|"multiply"|"divide"|"power";
type ScalingToken={op:"input";id:string}|{op:Operator};
interface ScalingExpression {id:string;rule_id:string;grammar_version:1;tokens:ScalingToken[]}
interface ScalingBinding {id:string;rule_id:string;parameter_limit_id:string|null;material_requirement_id:string|null}
interface Scaling {change_no:number;rules:ScalingRule[];inputs:ScalingInput[];expressions:ScalingExpression[];bindings:ScalingBinding[]}
const operators:Record<Operator,string>={add:"+",subtract:"−",multiply:"×",divide:"÷",power:"^"};
const sourceKinds:Record<SourceKind,string>={batch_quantity:"Batchhoeveelheid",parameter:"Procesparameter",equipment_property:"Equipmenteigenschap",constant:"Constante"};
const ruleKinds:Record<RuleKind,string>={nonlinear:"Niet-lineair",parameter_dependent:"Parameterafhankelijk",equipment_dependent:"Equipmentafhankelijk"};
interface Requirements {lot_rules:LotRule[];compatibility_rules:CompatibilityRule[];change_no:number;equipment_requirements:EquipmentRequirement[];personnel_requirements:PersonnelRequirement[];instructions:Instruction[];specification_links:SpecificationLink[]}
interface EquipmentClassReference {id:string;code:string;name:string}
interface EquipmentPropertyReference {id:string;code:string;name:string;quantity_kind_id:string;measurement_unit_id:string}
interface References {materials:MaterialReference[];qualifications:{code:string;description:string}[];equipment_classes:EquipmentClassReference[];equipment_properties:EquipmentPropertyReference[]}
interface Content {change_no:number;parameters:Parameter[];parameter_limits:Limit[];formulas:Formula[];material_requirements:MaterialRequirement[]}
interface Procedure {change_no:number;elements:{id:string;code:string;name:string;kind:string}[]}
interface Catalog {units:{id:string;code:string;symbol:string;name:string}[];conversions:{id:string;from_unit_id:string;to_unit_id:string}[];versions:{id:string;conversion_id:string;revision:number;factor_numerator:string;factor_denominator:string;additive_offset:string;source_reference:string}[]}
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

export function contentPane(version:{id:string;lifecycle_status:string},productId:string,current:()=>boolean,refresh:()=>Promise<void>,productVersions:Choice[]) {
  const prefix="/recipes/versions/"+encodeURIComponent(version.id);
  const base=prefix+"/content";
  const area=h("div",{});
  let generation=0,busy=false;
  async function load() {
    const g=++generation,active=()=>current()&&generation===g;
    if(!active())return;
    area.replaceChildren(h("p",{class:"sub"},"Formule en parameters ophalen…"));
    try {
      const [data,procedure,catalog,references,requirements,scaling]=await Promise.all([haal<Content>(base),haal<Procedure>(prefix+"/procedure"),haal<Catalog>("/units/for-product/"+encodeURIComponent(productId)),haal<References>("/recipes/references/"+encodeURIComponent(productId)),haal<Requirements>(prefix+"/requirements"),haal<Scaling>(prefix+"/scaling")]);
      if(!active())return;
      if(data.change_no!==procedure.change_no||data.change_no!==requirements.change_no||data.change_no!==scaling.change_no)throw Error("Recept is ondertussen gewijzigd. Vernieuw het onderdeel.");
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
        return h("details",{class:"engineering-details"},h("summary",{},title),h("form",{class:"formulier-blok",onsubmit:async(e:Event)=>{
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
      const classReferences=references.equipment_classes??[];
      const propertyReferences=references.equipment_properties??[];
      const classOptions=classReferences.map(c=>({id:c.id,label:c.code+" — "+c.name}));
      const propertyOptions=propertyReferences.map(p=>({id:p.id,label:p.code+" — "+p.name+" ("+(unit(p.measurement_unit_id)?.symbol??p.measurement_unit_id)+")"}));
      function equipmentForm(r?:EquipmentRequirement) {
        const element=choice(elementOptions,r?.procedural_element_id??"");
        const code=input(r?.code??"",100),equipmentClass=choice(classOptions,r?.equipment_class_id??"");
        const description=input(r?.description??"",10000);
        const count=h("input",{type:"number",min:1,max:2147483647,step:1,required:true,value:String(r?.required_count??1)});
        const capacity=exact(r?.minimum_capacity??"");
        const capacityProperty=choice(propertyOptions,r?.capacity_property_definition_id??"",false);
        const capacityInfo=h("p",{class:"sub","aria-live":"polite"});
        function sync(){
          const hasCapacity=capacity.value.trim()!=="";
          capacityProperty.disabled=!hasCapacity;
          capacityProperty.required=hasCapacity;
          const p=propertyReferences.find(p=>p.id===capacityProperty.value);
          capacityInfo.textContent=!hasCapacity?"Geen capaciteitseis.":p?"Cataloguseenheid: "+(unit(p.measurement_unit_id)?.symbol??p.measurement_unit_id):"Kies expliciet een eigenschap.";
        }
        capacity.addEventListener("input",sync);capacityProperty.addEventListener("change",sync);sync();
        return save(r?"Equipmentvereiste wijzigen":"Equipmentvereiste toevoegen",[
          field("Procedure-element",element),field("Code vereiste",code),
          field("Equipmentklasse",equipmentClass),field("Omschrijving",description),
          field("Vereist aantal",count),field("Minimumcapaciteit (optioneel)",capacity),field("Capaciteitseigenschap",capacityProperty),capacityInfo
        ],"linked-equipment-requirements",()=>{
          const n=Number(count.value),value=decimalValue(capacity);
          if(!classReferences.some(c=>c.id===equipmentClass.value))throw Error("Kies een bekende middelklasse.");
          if(!Number.isInteger(n)||n<1||n>2147483647)throw Error("Geef een geldig positief geheel aantal op.");
          const p=propertyReferences.find(p=>p.id===capacityProperty.value);
          if(value!==null&&(!/^[0-9]+(?:\.[0-9]+)?$/.test(value)||!/[1-9]/.test(value)||!p||!unit(p.measurement_unit_id)))throw Error("Minimumcapaciteit vereist een positieve waarde en expliciete cataloguseigenschap.");
          if(value!==null&&r?.minimum_capacity!==null&&r?.capacity_unit_id&&p?.measurement_unit_id!==r.capacity_unit_id)throw Error("De bestaande capaciteit heeft een andere eenheid. Leg eerst een nieuwe capaciteitseis vast; geen automatische omzetting.");
          return {procedural_element_id:element.value,code:code.value.trim(),equipment_class_id:equipmentClass.value,
            description:description.value.trim(),required_count:n,minimum_capacity:value,capacity_property_definition_id:value===null?null:capacityProperty.value};
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
      function instructionForm(r?:Instruction) {
        const element=choice(elementOptions,r?.procedural_element_id??"");
        const code=input(r?.code??"",100);
        const position=h("input",{type:"number",min:1,max:2147483647,step:1,required:true,value:String(r?.position??1)});
        const instruction=h("textarea",{required:true,maxlength:10000,rows:4},r?.instruction_text??"");
        const confirmation=h("input",{type:"checkbox",checked:r?.confirmation_required??false});
        return save(r?"Instructie wijzigen":"Instructie toevoegen",[
          field("Procedure-element",element),field("Code instructie",code),field("Positie binnen element",position),
          field("Instructietekst",instruction),field("Bevestiging verplicht",confirmation)
        ],"instructions",()=>{
          const n=Number(position.value);
          if(!Number.isInteger(n)||n<1||n>2147483647)throw Error("Geef een geldige positieve positie op.");
          if(!elementOptions.some(e=>e.id===element.value))throw Error("Kies een procedure-element uit deze versie.");
          if(!instruction.value.trim())throw Error("Geef een instructietekst op.");
          if(requirements.instructions.some(x=>x.id!==r?.id&&x.procedural_element_id===element.value&&x.position===n))throw Error("Deze positie is al in gebruik binnen dit procedure-element.");
          return {procedural_element_id:element.value,code:code.value.trim(),position:n,instruction_text:instruction.value.trim(),confirmation_required:confirmation.checked};
        },r?.id,requirementsRoot);
      }
      const specificationLimits=data.parameter_limits.filter(l=>l.category==="specification_limit");
      function specificationLabel(l:Limit) {
        const p=data.parameters.find(p=>p.id===l.parameter_id);
        const e=procedure.elements.find(e=>e.id===p?.procedural_element_id);
        return (e?e.code+" · ":"")+(p?p.code+" — "+p.name:l.parameter_id)+" · "+(l.lower_value??"—")+" tot "+(l.upper_value??"—")+(p?.unit?" "+p.unit:"");
      }
      function specificationForm(r?:SpecificationLink) {
        const available=specificationLimits.filter(l=>!requirements.specification_links.some(x=>x.id!==r?.id&&x.parameter_limit_id===l.id));
        const limit=choice(available.map(l=>({id:l.id,label:specificationLabel(l)})),r?.parameter_limit_id??"");
        const code=input(r?.code??"",100),description=input(r?.description??"",10000);
        return save(r?"Specificatiekoppeling wijzigen":"Specificatiekoppeling toevoegen",[
          field("Exacte specificatiegrens binnen deze revisie",limit),field("Code koppeling",code),field("Omschrijving",description)
        ],"specification-links",()=>{
          if(!available.some(l=>l.id===limit.value))throw Error("Kies een nog niet gekoppelde specificatiegrens uit deze revisie.");
          return {parameter_limit_id:limit.value,code:code.value.trim(),description:description.value.trim()};
        },r?.id,requirementsRoot);
      }
      function lotForm(r?:LotRule) {
        const count=h("input",{type:"number",min:1,max:50,step:1,required:true,value:r?String(r.nominal_batch_count):""});
        const approval=h("input",{type:"checkbox",checked:r?.deviation_approval_required??false});
        return save(r?"Lotnorm wijzigen":"Lotnorm vastleggen",[
          field("Nominaal aantal batches per lot (1–50)",count),
          h("p",{class:"sub"},"Bij afwijking is een reden altijd verplicht."),
          field("Onafhankelijke goedkeuring bij afwijking vereist",approval)
        ],"lot-rules",()=>{
          const n=Number(count.value);
          if(!Number.isInteger(n)||n<1||n>50)throw Error("Kies een geheel aantal batches van 1 tot 50.");
          return {nominal_batch_count:n,deviation_approval_required:approval.checked};
        },r?.id,requirementsRoot);
      }
      const otherVersions=productVersions.filter(v=>v.id!==version.id);
      const availableVersions=(r?:CompatibilityRule)=>otherVersions.filter(v=>!requirements.compatibility_rules.some(x=>x.id!==r?.id&&x.other_recipe_version_id===v.id));
      function compatibilityForm(r?:CompatibilityRule) {
        const available=availableVersions(r);
        const other=choice(available,r?.other_recipe_version_id??"");
        const reason=h("textarea",{required:true,maxlength:10000,rows:3},r?.reason??"");
        return save(r?"Incompatibiliteit wijzigen":"Incompatibiliteit vastleggen",[
          field("Andere receptrevisie van hetzelfde product",other),field("Reden incompatibiliteit",reason)
        ],"compatibility-rules",()=>{
          if(!available.some(v=>v.id===other.value))throw Error("Kies een andere, nog niet uitgesloten revisie van hetzelfde product.");
          if(!reason.value.trim())throw Error("Geef een reden voor incompatibiliteit op.");
          return {other_recipe_version_id:other.value,reason:reason.value.trim()};
        },r?.id,requirementsRoot);
      }
      const scalingRoot=prefix+"/scaling";
      function scalingRuleForm(r?:ScalingRule) {
        const code=input(r?.code??"",100);
        const description=h("textarea",{required:true,maxlength:10000,rows:3},r?.description??"");
        const kind=choice(Object.entries(ruleKinds).map(([id,label])=>({id,label})),r?.rule_kind??"");
        const output=choice(unitOptions,r?.output_unit_id??"");
        const source=h("textarea",{required:true,maxlength:10000,rows:3},r?.source_reference??"");
        const applicability=h("textarea",{required:true,maxlength:10000,rows:3},r?.applicability??"");
        return save(r?"Schaalregel wijzigen":"Schaalregel definiëren",[
          field("Code schaalregel",code),field("Omschrijving",description),field("Type schaalregel",kind),
          field("Uitvoereenheid",output),field("Bronreferentie / onderbouwing",source),field("Toepassingsgebied en voorwaarden",applicability)
        ],"rules",()=>{
          if(!Object.prototype.hasOwnProperty.call(ruleKinds,kind.value)||!unit(output.value))throw Error("Kies een geldig regeltype en cataloguseenheid.");
          if(!code.value.trim()||!description.value.trim()||!source.value.trim()||!applicability.value.trim())throw Error("Vul alle verplichte gegevens in.");
          return {code:code.value.trim(),description:description.value.trim(),rule_kind:kind.value,output_unit_id:output.value,source_reference:source.value.trim(),applicability:applicability.value.trim()};
        },r?.id,scalingRoot);
      }
      const numericParameters=data.parameters.filter(p=>numeric(p.data_type)&&p.measurement_unit_id&&unit(p.measurement_unit_id));
      const batchUnit=data.formulas.length===1?data.formulas[0].reference_unit_id:null;
      function conversionChoices(from:string,to:string) {
        return catalog.versions.filter(v=>catalog.conversions.some(c=>c.id===v.conversion_id&&c.from_unit_id===from&&c.to_unit_id===to));
      }
      function conversionLabel(v:Catalog["versions"][number]) {
        const c=catalog.conversions.find(c=>c.id===v.conversion_id);
        return (c?(unit(c.from_unit_id)?.code??c.from_unit_id)+" → "+(unit(c.to_unit_id)?.code??c.to_unit_id):v.conversion_id)+" · revisie "+v.revision+" · factor "+v.factor_numerator+"/"+v.factor_denominator+" · offset "+v.additive_offset+" · "+v.source_reference;
      }
      function scalingInputForm(rule:ScalingRule,r?:ScalingInput) {
        const code=input(r?.code??"",100);
        const source=choice(Object.entries(sourceKinds).filter(([id])=>id!=="equipment_property").map(([id,label])=>({id,label})),r?.source_kind??"");
        const parameter=choice(numericParameters.map(p=>({id:p.id,label:p.code+" — "+p.name+" ("+p.unit+")"})),r?.parameter_id??"",false);
        const constant=exact(r?.constant_value??"");
        const target=choice(unitOptions,r?.unit_id??"");
        const conversion=choice([], "", false);
        const sourceInfo=h("p",{class:"sub","aria-live":"polite"});
        const fromUnit=()=>source.value==="batch_quantity"?batchUnit:source.value==="parameter"?numericParameters.find(p=>p.id===parameter.value)?.measurement_unit_id??null:null;
        function sync(initial=false) {
          const k=source.value, from=fromUnit(), to=target.value;
          parameter.disabled=k!=="parameter";parameter.required=k==="parameter";
          constant.disabled=k!=="constant";constant.required=k==="constant";
          const needs=!!from&&!!to&&from!==to;
          const old=initial?r?.conversion_version_id??"":conversion.value;
          const versions=needs?conversionChoices(from!,to):[];
          conversion.replaceChildren(h("option",{value:""},"Kies expliciet een conversierevisie"),...versions.map(v=>h("option",{value:v.id},conversionLabel(v))));
          conversion.value=versions.some(v=>v.id===old)?old:"";
          conversion.disabled=!needs;conversion.required=needs;
          sourceInfo.textContent=k==="batch_quantity"||k==="parameter"?(from?"Broneenheid: "+(unit(from)?.symbol??from)+(needs&&!versions.length?" — geen passende conversierevisie beschikbaar.":""):"Kies een bron met expliciete cataloguseenheid."):"Eenheid wordt expliciet bij deze invoer vastgelegd; geen conversie.";
        }
        for(const control of [source,parameter,target])control.addEventListener("change",()=>sync());
        sync(true);
        return save(r?"Schaalinvoer wijzigen":"Schaalinvoer toevoegen",[
          field("Code invoer",code),field("Brontype",source),field("Numerieke procesparameter",parameter),
          field("Exacte constante",constant),
          sourceInfo,field("Invoereenheid",target),field("Exacte conversierevisie indien nodig",conversion)
        ],"inputs",()=>{
          const k=source.value,from=fromUnit(),to=target.value;
          if(k==="equipment_property"||!Object.prototype.hasOwnProperty.call(sourceKinds,k)||!unit(to)||!code.value.trim())throw Error("Kies een brontype, eenheid en code.");
          const sourced=k==="batch_quantity"||k==="parameter";
          if(sourced&&(!from||!unit(from)))throw Error("Bron vereist een expliciete cataloguseenheid.");
          const needs=sourced&&from!==to;
          if(needs&&!conversionChoices(from!,to).some(v=>v.id===conversion.value))throw Error("Kies een passende exacte conversierevisie.");
          if(k==="constant"&&!constant.value.trim())throw Error("Geef een exacte constante op.");
          return {rule_id:rule.id,code:code.value.trim(),source_kind:k,parameter_id:k==="parameter"?parameter.value:null,
            equipment_property:null,constant_value:k==="constant"?constant.value.trim():null,
            unit_id:to,conversion_version_id:needs?conversion.value:null};
        },r?.id,scalingRoot);
      }
      function linkedScalingInputForm(rule:ScalingRule,r?:ScalingInput) {
        const code=input(r?.code??"",100);
        const property=choice(propertyOptions,r?.equipment_property_definition_id??"");
        const info=h("p",{class:"sub","aria-live":"polite"});
        function sync(){
          const p=propertyReferences.find(p=>p.id===property.value);
          info.textContent=p?"Cataloguseenheid: "+(unit(p.measurement_unit_id)?.symbol??p.measurement_unit_id)+" — geen conversie.":"Kies expliciet een middeleneigenschap.";
        }
        property.addEventListener("change",sync);sync();
        return save(r?"Equipmentschaalbron koppelen of wijzigen":"Equipmentschaalbron toevoegen",[
          field("Code invoer",code),field("Equipmenteigenschap",property),info
        ],"linked-equipment-inputs",()=>{
          const p=propertyReferences.find(p=>p.id===property.value);
          if(!p||!unit(p.measurement_unit_id)||!code.value.trim())throw Error("Kies een bekende eigenschap met cataloguseenheid en code.");
          if(r&&p.measurement_unit_id!==r.unit_id)throw Error("De bestaande schaalbron heeft een andere eenheid. Geen automatische omzetting; maak zo nodig een nieuwe invoer.");
          return {rule_id:rule.id,code:code.value.trim(),equipment_property_definition_id:p.id};
        },r?.id,scalingRoot);
      }
      function scalingInputView(rule:ScalingRule,r:ScalingInput) {
        const v=catalog.versions.find(v=>v.id===r.conversion_version_id);
        const p=data.parameters.find(p=>p.id===r.parameter_id);
        const value=r.source_kind==="parameter"?(p?p.code+" — "+p.name:r.parameter_id):r.source_kind==="equipment_property"?r.equipment_property:r.source_kind==="constant"?r.constant_value:"Referentieformule";
        return h("details",{},h("summary",{},r.code+" · "+sourceKinds[r.source_kind]),
          h("p",{},(value??"Onbekend")+" · "+(unit(r.unit_id)?.symbol??r.unit_id)),
          h("p",{class:"sub"},r.conversion_version_id?(v?conversionLabel(v):"Conversierevisie: "+r.conversion_version_id):"Geen conversie"),
          r.source_kind==="equipment_property"?h("p",{class:"sub"},r.equipment_property_definition_id?"Catalogusgebonden schaalbron":"Historische, ongekoppelde schaalbron; expliciete koppeling vereist."):null,
          editable&&unitOptions.length?(r.source_kind==="equipment_property"?linkedScalingInputForm(rule,r):scalingInputForm(rule,r)):null,
          editable?remove("inputs",r.id,"Schaalinvoer "+r.code,scalingRoot):null);
      }
      function expressionPane(rule:ScalingRule) {
        const inputs=scaling.inputs.filter(i=>i.rule_id===rule.id);
        const stored=scaling.expressions.find(e=>e.rule_id===rule.id);
        const tokens:ScalingToken[]=[...(stored?.tokens??[])];
        const path=scalingRoot+"/rules/"+encodeURIComponent(rule.id)+"/expression";
        function describe(items:ScalingToken[]) {
          const stack:string[]=[];
          for(const t of items) {
            if(t.op==="input") {
              const i=inputs.find(i=>i.id===t.id);
              if(!i)return {valid:false,text:"Onbekende invoer-ID: "+t.id};
              stack.push(i.code);
            } else {
              if(stack.length<2)return {valid:false,text:"Onvoldoende operanden voor "+operators[t.op]};
              const right=stack.pop()!,left=stack.pop()!;
              stack.push("("+left+" "+operators[t.op]+" "+right+")");
            }
          }
          return {valid:items.length>=1&&items.length<=128&&stack.length===1,text:stack.join(" ; ")||"Nog geen formule"};
        }
        const tokenLabel=(t:ScalingToken)=>t.op==="input"?(inputs.find(i=>i.id===t.id)?.code??t.id):operators[t.op];
        const preview=h("p",{class:"sub","aria-live":"polite"});
        const sequence=h("ol",{});
        const pick=choice(inputs.map(i=>({id:i.id,label:i.code+" ("+(unit(i.unit_id)?.symbol??i.unit_id)+")"})));
        const op=choice(Object.entries(operators).map(([id,label])=>({id,label})));
        const addInput=h("button",{type:"button",class:"knop knop-klein",onclick:()=>{
          if(!active()||busy||!editable||tokens.length>=128||!inputs.some(i=>i.id===pick.value))return;
          tokens.push({op:"input",id:pick.value});render();
        }},"Invoer toevoegen");
        const addOperator=h("button",{type:"button",class:"knop knop-klein",onclick:()=>{
          if(!active()||busy||!editable||tokens.length>=128||!Object.prototype.hasOwnProperty.call(operators,op.value))return;
          tokens.push({op:op.value as Operator});render();
        }},"Operator toevoegen");
        const undo=h("button",{type:"button",class:"knop knop-klein",onclick:()=>{
          if(!active()||busy||!editable)return;tokens.pop();render();
        }},"Laatste token verwijderen");
        const reset=h("button",{type:"button",class:"knop knop-klein",onclick:()=>{
          if(!active()||busy||!editable)return;tokens.splice(0,tokens.length,...(stored?.tokens??[]));render();
        }},"Lokale wijzigingen herstellen");
        const submit=h("button",{type:"button",class:"knop knop-hoofd",onclick:async()=>{
          if(!active()||!editable||!describe(tokens).valid)return;
          await mutate("PUT",path,{expected_change_no:data.change_no,tokens:[...tokens]});
        }},"Formule opslaan");
        function render(){
          const result=describe(tokens);
          sequence.replaceChildren(...tokens.map(t=>h("li",{},tokenLabel(t))));
          preview.textContent=tokens.length+"/128 tokens · "+(result.valid?"Structureel compleet: ":"Nog niet compleet: ")+result.text;
          addInput.disabled=tokens.length>=128||!inputs.length;
          addOperator.disabled=tokens.length>=128;
          undo.disabled=!tokens.length;submit.disabled=!result.valid;
        }
        render();
        return h("div",{},h("h5",{},"Gecontroleerde formule"),
          h("p",{class:"sub"},"Grammatica v1: voeg eerst operanden toe en daarna de operator (postfix). De voorbeeldweergave is symbolisch; de server controleert structuur, dimensies en grootheidsemantiek. Geen numerieke berekening."),
          stored?h("p",{},"Opgeslagen formule: "+describe(stored.tokens).text):h("p",{class:"leeg"},"Nog geen opgeslagen formule."),
          editable&&inputs.length?h("details",{},h("summary",{},"Formule samenstellen"),
            field("Invoer",pick),addInput,field("Operator",op),addOperator,sequence,preview,undo,reset,submit):null,
          editable&&!inputs.length?h("p",{class:"sub"},"Definieer eerst schaalinvoer."):null,
          editable&&stored?h("button",{type:"button",class:"knop knop-klein",onclick:async()=>{
            if(active()&&window.confirm("Opgeslagen schaalformule verwijderen uit dit concept?"))await mutate("DELETE",path+"?expected_change_no="+data.change_no);
          }},"Opgeslagen formule verwijderen"):null,
          stored?h("p",{class:"sub"},"Verwijder eerst de opgeslagen formule voordat invoer of uitvoereenheid wordt gewijzigd."):null);
      }
      function bindingLimitLabel(l:Limit) {
        const p=data.parameters.find(p=>p.id===l.parameter_id);
        const e=procedure.elements.find(e=>e.id===p?.procedural_element_id);
        return (e?e.code+" · ":"")+(p?p.code+" — "+p.name:l.parameter_id)+" · "+categories[l.category]+" ("+(p?.unit??"geen eenheid")+")";
      }
      function bindingMaterialLabel(m:MaterialRequirement) {
        return m.code+" · "+(m.direction==="input"?"Input":"Output")+" · "+m.quantity+" "+m.unit;
      }
      function bindingTargets(rule:ScalingRule,b?:ScalingBinding) {
        const other=scaling.bindings.filter(x=>x.id!==b?.id);
        if(!unit(rule.output_unit_id))return [];
        return [
          ...data.parameter_limits.filter(l=>data.parameters.some(p=>p.id===l.parameter_id&&p.measurement_unit_id===rule.output_unit_id)&&!other.some(x=>x.parameter_limit_id===l.id))
            .map(l=>({id:"limit:"+l.id,label:"Parametergrens · "+bindingLimitLabel(l),parameter_limit_id:l.id,material_requirement_id:null})),
          ...data.material_requirements.filter(m=>m.measurement_unit_id===rule.output_unit_id&&!other.some(x=>x.material_requirement_id===m.id))
            .map(m=>({id:"material:"+m.id,label:"Materiaalvereiste · "+bindingMaterialLabel(m),parameter_limit_id:null,material_requirement_id:m.id}))
        ];
      }
      function bindingForm(rule:ScalingRule,b?:ScalingBinding) {
        const targets=bindingTargets(rule,b);
        const selected=b?.parameter_limit_id?"limit:"+b.parameter_limit_id:b?.material_requirement_id?"material:"+b.material_requirement_id:"";
        const target=choice(targets,selected);
        return save(b?"Uitvoerkoppeling wijzigen":"Uitvoerkoppeling toevoegen",[
          field("Exact doel met dezelfde cataloguseenheid",target),
          h("p",{class:"sub"},"Deze koppeling activeert geen berekening. Complexe schaalregels blijven onder verplichte vrijgaveblokkade.")
        ],"bindings",()=>{
          const t=targets.find(t=>t.id===target.value);
          if(!t)throw Error("Kies een beschikbaar doel met exact dezelfde cataloguseenheid.");
          return {rule_id:rule.id,parameter_limit_id:t.parameter_limit_id,material_requirement_id:t.material_requirement_id};
        },b?.id,scalingRoot);
      }
      function bindingPane(rule:ScalingRule) {
        const bindings=scaling.bindings.filter(b=>b.rule_id===rule.id);
        return h("div",{},h("h5",{},"Uitvoerkoppelingen"),
          h("p",{class:"sub"},"Elke koppeling verwijst naar één materiaalvereiste of parametergrens binnen deze revisie. Geen impliciete eenheidsconversie of dubbele koppeling."),
          ...bindings.map(b=>{
            const l=data.parameter_limits.find(l=>l.id===b.parameter_limit_id);
            const m=data.material_requirements.find(m=>m.id===b.material_requirement_id);
            return h("details",{},h("summary",{},l?bindingLimitLabel(l):m?bindingMaterialLabel(m):"Onbekend doel: "+(b.parameter_limit_id??b.material_requirement_id)),
              editable&&bindingTargets(rule,b).length?bindingForm(rule,b):null,
              editable?remove("bindings",b.id,"Uitvoerkoppeling",scalingRoot):null);
          }),
          bindings.length?null:h("p",{class:"leeg"},"Nog geen uitvoerkoppelingen."),
          editable&&bindingTargets(rule).length?bindingForm(rule):null,
          editable&&!bindingTargets(rule).length?h("p",{class:"sub"},"Geen vrije doelen met exact dezelfde cataloguseenheid beschikbaar."):null);
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
        h("p",{class:"sub"},"Expliciete middelklasse en optionele capaciteitseigenschap per procedure-element. Geen fysieke toewijzing of bewijs van actuele inzetbaarheid."),
        ...requirements.equipment_requirements.map(r=>{
          const element=procedure.elements.find(e=>e.id===r.procedural_element_id);
          const u=r.capacity_unit_id?unit(r.capacity_unit_id):undefined;
          return h("details",{},h("summary",{},r.code+" — "+r.equipment_class_code),
            h("p",{},r.description),
            h("p",{class:"sub"},r.equipment_class_id?"Catalogusgebonden middelklasse":"Historische, ongekoppelde middelklasse; expliciete koppeling vereist."),
            h("p",{class:"sub"},"Procedure-element: "+(element?element.code+" — "+element.name:r.procedural_element_id)+" · Aantal: "+r.required_count),
            h("p",{},"Minimumcapaciteit: "+(r.minimum_capacity===null?"Niet opgegeven":r.minimum_capacity+" "+(u?.symbol??r.capacity_unit_id??"onbekende eenheid"))),
            r.minimum_capacity!==null?h("p",{class:"sub"},r.capacity_property_definition_id?"Capaciteitseigenschap: "+(propertyReferences.find(p=>p.id===r.capacity_property_definition_id)?.code??r.capacity_property_definition_id):"Capaciteitseigenschap nog niet gekoppeld."):null,
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
        h("h4",{},"Werkinstructies"),
        h("p",{class:"sub"},"Versiegebonden instructies per procedure-element, met expliciete volgorde en bevestigingsplicht. Geen uitvoeringsregistratie."),
        ...[...requirements.instructions].sort((a,b)=>a.procedural_element_id.localeCompare(b.procedural_element_id)||a.position-b.position).map(r=>{
          const e=procedure.elements.find(e=>e.id===r.procedural_element_id);
          return h("details",{},h("summary",{},(e?.code??r.procedural_element_id)+" · "+r.position+" · "+r.code),
            h("p",{},r.instruction_text),h("p",{class:"sub"},r.confirmation_required?"Bevestiging verplicht":"Geen bevestiging vereist"),
            editable&&elementOptions.length?instructionForm(r):null,
            editable?remove("instructions",r.id,"Instructie "+r.code,requirementsRoot):null);
        }),
        ...(requirements.instructions.length?[]:[h("p",{class:"leeg"},"Nog geen werkinstructies.")]),
        ...(editable&&elementOptions.length?[instructionForm()]:[]),
        h("h4",{},"Specificatiekoppelingen"),
        h("p",{class:"sub"},"Verwijzingen naar exacte specificatiegrenzen in deze receptrevisie, niet naar dynamische legacy-specificaties. Geen kwaliteitsvrijgave."),
        ...requirements.specification_links.map(r=>{
          const l=specificationLimits.find(l=>l.id===r.parameter_limit_id);
          return h("details",{},h("summary",{},r.code+" — "+r.description),
            h("p",{},l?specificationLabel(l):"Onbekende specificatiegrens: "+r.parameter_limit_id),
            editable&&specificationLimits.length?specificationForm(r):null,
            editable?remove("specification-links",r.id,"Specificatiekoppeling "+r.code,requirementsRoot):null);
        }),
        ...(requirements.specification_links.length?[]:[h("p",{class:"leeg"},"Nog geen specificatiekoppelingen.")]),
        ...(editable&&specificationLimits.some(l=>!requirements.specification_links.some(r=>r.parameter_limit_id===l.id))?[specificationForm()]:[]),
        ...(editable&&!specificationLimits.length?[h("p",{class:"sub"},"Maak eerst een specificatiegrens aan bij een numerieke procesparameter.")]:[]),
        h("h4",{},"Lotnorm"),
        h("p",{class:"sub"},"De norm hoort bij deze receptrevisie. Geen standaard vier batches en geen automatische lotvorming."),
        ...requirements.lot_rules.map(r=>h("div",{},h("p",{},r.nominal_batch_count+" batches per lot"),
          h("p",{class:"sub"},"Afwijkingsreden altijd verplicht · "+(r.deviation_approval_required?"Onafhankelijke goedkeuring verplicht":"Geen aanvullende goedkeuring vereist")),
          editable?lotForm(r):null,editable?remove("lot-rules",r.id,"Lotnorm",requirementsRoot):null)),
        ...(requirements.lot_rules.length?[]:[h("p",{class:"leeg"},"Nog geen lotnorm vastgelegd.")]),
        ...(editable&&!requirements.lot_rules.length?[lotForm()]:[]),
        h("h4",{},"Expliciete receptincompatibiliteit"),
        h("p",{class:"sub"},"Een verbod geldt bij latere lotvorming in beide richtingen. Geen verbod betekent niet dat een lot automatisch wordt vrijgegeven. Verschillende lotnormen vereisen later een expliciete keuze."),
        ...requirements.compatibility_rules.map(r=>h("details",{},h("summary",{},otherVersions.find(v=>v.id===r.other_recipe_version_id)?.label??r.other_recipe_version_id),
          h("p",{},r.reason),editable&&availableVersions(r).length?compatibilityForm(r):null,
          editable?remove("compatibility-rules",r.id,"Incompatibiliteitsregel",requirementsRoot):null)),
        ...(requirements.compatibility_rules.length?[]:[h("p",{class:"leeg"},"Geen uitgaande incompatibiliteitsregels vastgelegd voor deze revisie.")]),
        ...(editable&&availableVersions().length?[compatibilityForm()]:[]),
        ...(editable&&!otherVersions.length?[h("p",{class:"sub"},"Er zijn nog geen andere receptrevisies van dit product.")]:[]),
        h("h4",{},"Geavanceerde schaalregels"),
        h("p",{class:"sub"},"Uitsluitend conceptdefinities. Getypeerde invoer, exacte conversierevisies, gecontroleerde formule en expliciete uitvoerkoppelingen. Complexe regels blijven onder verplichte vrijgaveblokkade; geen berekening of impliciete terugval op vast/lineair."),
        ...scaling.rules.map(r=>h("details",{},h("summary",{},r.code+" — "+ruleKinds[r.rule_kind]),
          h("p",{},r.description),
          h("p",{class:"sub"},"Uitvoereenheid: "+(unit(r.output_unit_id)?.symbol??r.output_unit_id)),
          h("p",{},"Bronreferentie: "+r.source_reference),h("p",{},"Toepassingsgebied: "+r.applicability),
          editable&&unitOptions.length?scalingRuleForm(r):null,
          editable?remove("rules",r.id,"Schaalregel "+r.code,scalingRoot):null,
          h("h5",{},"Getypeerde invoer"),
          ...scaling.inputs.filter(i=>i.rule_id===r.id).map(i=>scalingInputView(r,i)),
          scaling.inputs.some(i=>i.rule_id===r.id)?null:h("p",{class:"leeg"},"Nog geen schaalinvoer."),
          editable&&unitOptions.length?scalingInputForm(r):null,editable&&unitOptions.length?linkedScalingInputForm(r):null,expressionPane(r),bindingPane(r))),
        ...(scaling.rules.length?[]:[h("p",{class:"leeg"},"Nog geen geavanceerde schaalregels.")]),
        ...(editable&&unitOptions.length?[scalingRuleForm()]:[]),
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
  return h("section",{class:"engineering-paneel"},h("h3",{},"Formule, vereisten, instructies en procesparameters"),h("button",{type:"button",class:"knop",onclick:load},"Receptinhoud laden / vernieuwen"),area);
}
