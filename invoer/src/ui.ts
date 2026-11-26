// Gedeeld met de portalen-app: zie ../../gedeeld/ui.ts
export * from "../../gedeeld/ui";
import { toon as toonGedeeld } from "../../gedeeld/ui";

/** Een achtergrondverversing mag focus in het geopende mobiele menu niet stelen.
 * Bij echte navigatie is het paneel al gesloten door de route-/menuafhandeling. */
export function toon(...inhoud: (Node | null | undefined | false)[]) {
  const focus = document.activeElement;
  const openMenu = document.querySelector("#onderbalk .meer-paneel:not([hidden])");
  if (focus && openMenu?.contains(focus)) {
    document.getElementById("scherm")!.replaceChildren(...(inhoud.filter(Boolean) as Node[]));
    return;
  }
  toonGedeeld(...inhoud);
}
