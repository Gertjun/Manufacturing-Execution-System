// D101: echte IndexedDB in Chrome, geïsoleerde fictieve sessies en API-antwoorden.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
let browser;
try {
  await server.listen();
  const origin = "http://127.0.0.1:" + server.httpServer.address().port;
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  // Laad productiemodules via Vite in een geïsoleerde pagina met fictieve API-antwoorden.
  await page.route(origin + "/invoer/test-offline.html", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>D101 test</title><main id=scherm tabindex=-1></main>" }));
  await page.goto(origin + "/invoer/test-offline.html");
  const results = await page.evaluate(async () => {
    const { sessie } = await import("/invoer/src/sessie.ts");
    const { vernieuwRechten } = await import("/invoer/src/rechten.ts");
    const { voegToe, voegActiesToe, controleerOfflineActie, verwerk } = await import("/invoer/src/wachtrij.ts");
    const { opslag } = await import("/invoer/src/opslag.ts");
    const { registratieSleutel } = await import("/invoer/src/registratieopslag.ts");
    const { slaWaardenOp } = await import("/invoer/src/registraties.ts");
    const geslaagd = [];
    const check = (naam, ok) => { if (!ok) throw new Error(naam); geslaagd.push(naam); };
    const weigert = async (naam, fn, patroon) => {
      let fout;
      try { await fn(); } catch (e) { fout = e; }
      check(naam, !!fout && patroon.test(String(fout)));
    };
    const token = sub => "test." + btoa(JSON.stringify({ sub, operatorId: "persoon-"+sub, rol: "operator", exp: Math.floor(Date.now()/1000)+3600 })) + ".test";
    const aToken = token("a");
    sessie.token = aToken;
    let projectie = { personal: true, linkedPerson: true, global: ["handover.record"], products: [{ product: "P1", permission: "execution.record" }] };
    let synchronisatie = "offline";
    window.fetch = async (url, options) => {
      if (url === "/auth/permissions") return new Response(JSON.stringify(projectie), { status: 200 });
      if (options?.method === "POST" && synchronisatie === "weigeren")
        return new Response(JSON.stringify({ fout: "Geen actuele bevoegdheid" }), { status: 403 });
      throw new TypeError("Fictief offline");
    };
    const reg = { id: "12345678-1234-4234-8234-123456789012", product: "P1", stapcode: "PS1", velden: [
      { code: "P", gemeten_door: "productie", waarde: null },
      { code: "K", gemeten_door: "kwaliteit", waarde: null },
    ] };
    const context = { registratie: reg };
    const actie = codes => ({ methode: "POST", omschrijving: "Fictieve meting", pad: "/registraties/"+reg.id+"/waarden", registratieId: reg.id, body: { waarden: codes.map(veldcode => ({ veldcode })) } });
    const handover = { methode: "POST", omschrijving: "Fictieve overdracht", pad: "/overdracht", body: {} };
    await weigert("Geen projectie", () => voegToe(actie(["P"]), context), /MES-bevoegdheden/);
    await vernieuwRechten();
    controleerOfflineActie(actie(["P"]), context);
    check("Productgebonden productiemeting toegestaan", true);
    await weigert("Verkeerde productscope", () => voegToe(actie(["P"]), { registratie: { ...reg, product: "P2" } }), /Geen MES-bevoegdheid/);
    await weigert("Kwaliteitsveld vereist eigen permission", () => voegToe(actie(["P","K"]), context), /Geen MES-bevoegdheid/);
    await weigert("Onbekend veld", () => voegToe(actie(["X"]), context), /Onbekend meetveld/);
    await weigert("Besluit niet offline", () => voegToe({ ...handover, pad: "/keuringen/test/besluit" }), /niet in de offline/);
    await weigert("Geheim niet offline", () => voegToe({ ...handover, body: { wachtwoord: "fictief" } }), /niet in de offline/);
    await weigert("Geen gedeeltelijke wijziging bij ontbrekend meetrecht", () => slaWaardenOp(reg, [{ code: "K", setting: null, gemeten: 1 }]), /Geen MES-bevoegdheid/);
    check("Originele registratie ongewijzigd", reg.velden.every(v => v.waarde === null));
    projectie.global.push("downtime.record");
    await vernieuwRechten();
    controleerOfflineActie({...handover,pad:"/stilstand",body:{id:reg.id}});
    controleerOfflineActie({...handover,pad:"/stilstand/"+reg.id+"/einde",body:{}});
    check("Stapstilstand blijft offline toegestaan",true);
    await weigert("Middelstilstand opening nooit offline",()=>voegToe({...handover,pad:"/stilstand/middelen",body:{id:reg.id}}),/niet in de offline/);
    await weigert("Middelstilstand einde nooit offline",()=>voegToe({...handover,pad:"/stilstand/middelen/"+reg.id+"/einde",body:{}}),/niet in de offline/);
    check("Geen geweigerde acties opgeslagen", (await opslag.alle("wachtrij")).length === 0);

    // F4-115-G: echte operatorcomponent, zonder echte accounts/server.
    const { middelstilstandBlok } = await import("/invoer/src/schermen/werk.ts");
    const step={code:"PS1",naam:"Reactie",soort:"proces"};
    const eq={id:reg.id,code:"FICT-E",name:"Fictief middel",open_downtime_id:null};
    const sent=[];
    let lose=true, fresh=true, refreshes=0, choiceReads=0;
    const originalFetch=window.fetch;
    const originalOnline=Object.getOwnPropertyDescriptor(navigator,"onLine");
    Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>fresh});
    window.fetch=async(url,options)=>{
      if(url==="/auth/permissions")return originalFetch(url,options);
      if(url==="/stilstand/middelen/keuzes?stapcode=PS1"){
        choiceReads++;return new Response(JSON.stringify([eq]));
      }
      if(url==="/stilstand/oorzaken")return new Response(JSON.stringify([{code:"STOR",naam:"Storing",categorie:"storing"}]));
      if(url==="/stilstand/middelen"&&options?.method==="POST"){
        sent.push({body:JSON.parse(options.body),authorization:options.headers.authorization});
        if(lose)throw new TypeError("Antwoord verloren");
        eq.open_downtime_id=sent.at(-1).body.id;
        return new Response(JSON.stringify({id:eq.open_downtime_id}));
      }
      if(url==="/stilstand/middelen/"+eq.open_downtime_id+"/einde"&&options?.method==="POST"){
        sent.push({body:JSON.parse(options.body),authorization:options.headers.authorization,close:true});
        eq.open_downtime_id=null;
        return new Response(JSON.stringify({id:reg.id}));
      }
      return originalFetch(url,options);
    };
    const screen=document.getElementById("scherm");
    const render=async()=>{
      const node=await middelstilstandBlok(step,()=>refreshes++,()=>true);
      screen.replaceChildren(...(node?[node]:[]));
    };
    const wait=async(test)=>{
      for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setTimeout(r,20));}
      throw new Error("F4-115-G timeout");
    };
    const button=(root,name)=>[...root.querySelectorAll("button")].find(b=>b.textContent===name);
    const openDialog=async()=>{
      button(screen,"Melden").click();
      await wait(()=>document.querySelector("dialog[open]"));
      return document.querySelector("dialog[open]");
    };
    try{
      await render();
      check("F4-115-G actuele middelkeuze",!!button(screen,"Melden")&&choiceReads===1);
      const d=await openDialog();
      d.querySelector("#v-toelichting").value="Fictieve storing";
      button(d,"Melden").click();
      await wait(()=>refreshes===1);
      check("F4-115-G onzeker antwoord geen succesmelding",sent.length===1&&document.getElementById("melding").textContent.includes("Uitkomst onzeker"));
      await render();
      check("F4-115-G expliciete herhaalactie",!!button(screen,"Zelfde melding opnieuw proberen"));
      fresh=false;
      button(screen,"Zelfde melding opnieuw proberen").click();
      await wait(()=>screen.textContent.includes("Geen verbinding"));
      check("F4-115-G offline geen nieuw verzoek",sent.length===1);
      fresh=true;lose=false;
      button(screen,"Zelfde melding opnieuw proberen").click();
      await wait(()=>refreshes===2);
      check("F4-115-G identieke UUID en payload",sent.length===2&&JSON.stringify(sent[0])===JSON.stringify(sent[1]));
      await render();
      button(screen,"Beëindigen").click();
      await wait(()=>document.querySelector("dialog[open]"));
      const end=document.querySelector("dialog[open]");
      end.querySelector("#v-notitie").value="Hersteld";
      button(end,"Beëindigen").click();
      await wait(()=>refreshes===3);
      check("F4-115-G sluiting op registratie-ID",sent.length===3&&sent[2].close&&sent[2].body.notitie==="Hersteld");
      await render();
      const changed=await openDialog();
      sessie.token=token("b");
      await vernieuwRechten();
      button(changed,"Melden").click();
      await wait(()=>!document.querySelector("dialog[open]"));
      await new Promise(r=>setTimeout(r,30));
      check("F4-115-G sessiewisseling weigert oude melding",sent.length===3);
      sessie.token=aToken;await vernieuwRechten();
      fresh=false;
      await render();
      check("F4-115-G geen gecachete middelkeuze offline",!button(screen,"Melden")&&screen.textContent.includes("Geen verbinding"));
      check("F4-115-G geen middelactie in IndexedDB",(await opslag.alle("wachtrij")).length===0);
    }finally{
      window.fetch=originalFetch;
      if(originalOnline)Object.defineProperty(navigator,"onLine",originalOnline);
      else delete navigator.onLine;
      sessie.token=aToken;await vernieuwRechten();
      screen.replaceChildren();
    }

    const sleutel = registratieSleutel(reg.id, "a:persoon-a");
    check("Geen geweigerde lokale registratie", await opslag.haal("cache", sleutel) === undefined);
    await weigert("Dubbele batchactie zonder startrecht geheel geweigerd", () => voegActiesToe([
      { ...handover, pad: "/batches" },
      { ...actie(["P"]), pad: "/registraties" },
    ], { ...context, startRecht: "execution.start" }), /Geen MES-bevoegdheid/);
    sessie.token = token("b");
    await weigert("Ander token heeft geen oude projectie", () => voegToe(handover), /MES-bevoegdheden/);
    await vernieuwRechten();
    await weigert("Oorspronkelijk token niet meer geldig voor opslag", () => voegToe(handover, undefined, aToken), /Sessie gewijzigd/);
    sessie.token = aToken;
    await vernieuwRechten();
    await voegToe(actie(["P"]), context);
    check("Bevoegde invoer in wachtrij", (await opslag.alle("wachtrij")).length === 1);
    check("Registratie tegelijk opgeslagen", (await opslag.haal("cache", sleutel))?.id === reg.id);
    // Eerste add wordt teruggedraaid als cache-put niet clonebaar blijkt.
    await weigert("Opslagfout breekt transactie af", () => opslag.voegActiesToe([{ omschrijving: "rollback" }], { sleutel, waarde: () => {} }, () => {}), /clone|DataCloneError/i);
    check("Rollback bewaart vorige wachtrij", (await opslag.alle("wachtrij")).length === 1);
    check("Rollback bewaart vorige registratie", (await opslag.haal("cache", sleutel))?.id === reg.id);
    await weigert("Controle vlak voor opslag weigert sessiewisseling", () => opslag.voegActiesToe([{ omschrijving: "sessiewissel" }], undefined, () => { throw new Error("Sessie gewijzigd"); }), /Sessie gewijzigd/);
    check("Geen actie na geweigerde opslagcontrole", (await opslag.alle("wachtrij")).length === 1);
    // Wacht op de reeds gestarte offline-verwerking voordat de serverweigering wordt gesimuleerd.
    await new Promise(resolve => setTimeout(resolve, 100));
    projectie = { personal: true, linkedPerson: true, global: [], products: [] };
    await vernieuwRechten();
    synchronisatie = "weigeren";
    for (let n=0; n<20; n++) {
      await verwerk();
      const records = await opslag.alle("wachtrij");
      if (records[0]?.status === "fout") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const bewaard = await opslag.alle("wachtrij");
    check("Serverweigering bewaart oorspronkelijke invoer", bewaard.length === 1 && bewaard[0].status === "fout" && bewaard[0].body.waarden[0].veldcode === "P");
    const { wachtrijScherm } = await import("/invoer/src/schermen/zoek.ts");
    const { volgnr: _volgnr, ...eigenActie } = bewaard[0];
    await opslag.zet("wachtrij", { ...eigenActie, omschrijving: "Oudere fout voor beoordeling", fout: "Persoonlijke herkomst moet worden beoordeeld" });
    await opslag.zet("wachtrij", { ...eigenActie, omschrijving: "Andere persoon", userId: "b", operatorId: "persoon-b" });
    await wachtrijScherm();

    const review = document.querySelector(".wachtrij-beoordeling");
    check("Oude persoonsgebonden fout staat in beoordelingsgroep met beoordelingsaccent",
      review?.textContent.includes("Oudere fout voor beoordeling")
      && review.closest("ul")?.previousElementSibling?.previousElementSibling?.textContent === "Gecontroleerde beoordeling nodig"
      && !review.querySelector("button"));
    const fout = document.querySelector(".wachtrij-fout");
    check("Gewone serverfout behoudt foutaccent en verwijderactie",
      fout?.textContent.includes("Fictieve meting") && fout.querySelector("button")?.textContent === "Verwijderen");
    check("Wachtrij toont afgeschermd aantal zonder inhoud van andere persoon",
      document.querySelector("#scherm .waarschuwing")?.textContent.startsWith("1 afgeschermde acties")
      && !document.getElementById("scherm")?.textContent.includes("Andere persoon"));
    return geslaagd;
  });
  for (const naam of results) console.log("OK " + naam);
  assert.ok(results.length >= 18);
  console.log(results.length + " D101-controles geslaagd");
} finally {
  await browser?.close();
  await server.close();
}
