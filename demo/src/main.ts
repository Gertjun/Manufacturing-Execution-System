import { startDatabase, startServer, wisOpslag, type Verzoek } from "./server";
import { VERSIE } from "../../api/src/versie";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$("versie").textContent = VERSIE;

let klaar!: (f: (v: Verzoek) => Promise<{ status: number; body: string }>) => void;
const server = new Promise<(v: Verzoek) => Promise<{ status: number; body: string }>>((r) => (klaar = r));
(window as any).demoApi = async (v: Verzoek) => (await server)(v);
(window as any).demoOpen = (w: string) => kies(w);

function kies(w: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>("nav button")) b.setAttribute("aria-pressed", String(b.dataset.weergave === w));
  $("werk").classList.toggle("naast", w === "naast");
  $("paneel-invoer").classList.toggle("zichtbaar", w === "invoer" || w === "naast");
  $("paneel-portaal").classList.toggle("zichtbaar", w === "portaal" || w === "naast");
  try { localStorage.setItem("demo.weergave", w); } catch {}
}
for (const b of document.querySelectorAll<HTMLButtonElement>("nav button")) b.onclick = () => kies(b.dataset.weergave!);
try { kies(localStorage.getItem("demo.weergave") ?? "portaal"); } catch { kies("portaal"); }

const uitleg = $<HTMLDialogElement>("uitleg");
$("uitleg-knop").onclick = () => uitleg.showModal();
$("uitleg-sluit").onclick = () => uitleg.close();
const reset = $<HTMLDialogElement>("reset");
$("reset-knop").onclick = () => reset.showModal();
$("reset-nee").onclick = () => reset.close();
$("reset-ja").onclick = async () => {
  reset.close();
  $("laden").style.display = "";
  $("laden-tekst").textContent = "Demo leegmaken …";
  ($("if-invoer") as HTMLIFrameElement).src = "about:blank";
  ($("if-portaal") as HTMLIFrameElement).src = "about:blank";
  await pg?.close().catch(() => {});
  await wisOpslag();
  location.reload();
};

let pg: Awaited<ReturnType<typeof startDatabase>>["pg"] | undefined;
try {
  const r = await startDatabase((t) => ($("laden-tekst").textContent = t));
  pg = r.pg;
  $("opslag-tekst").textContent = r.bewaard
    ? "Wat je invoert blijft bewaard in deze browser, ook na herladen. Met Opnieuw beginnen zet je de demo terug."
    : "Je browser staat opslaan niet toe: wat je invoert verdwijnt na herladen.";
  klaar(await startServer(pg));
  ($("if-invoer") as HTMLIFrameElement).src = "invoer/index.html";
  ($("if-portaal") as HTMLIFrameElement).src = "portaal/index.html";
  $("laden").style.display = "none";
  try {
    if (!localStorage.getItem("demo.uitleg")) { uitleg.showModal(); localStorage.setItem("demo.uitleg", "1"); }
  } catch {}
} catch (e) {
  console.error(e);
  $("laden-tekst").textContent = "De demo kan niet starten in deze browser: " + ((e as Error).message ?? e) + ". Probeer een recente versie van Chrome, Edge of Firefox.";
}
