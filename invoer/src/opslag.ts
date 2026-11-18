// Kleine laag boven IndexedDB. Drie bakken:
//  wachtrij     – acties die nog naar de server moeten
//  registraties – lokale kopie van registraties (ook die offline gestart zijn)
//  cache        – laatst bekende antwoorden van de server (config, werkvoorraad)

const NAAM = "batch-invoer";
const VERSIE = 1;

let dbBelofte: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbBelofte) {
    dbBelofte = new Promise((ok, fout) => {
      const req = indexedDB.open(NAAM, VERSIE);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("wachtrij", { keyPath: "volgnr", autoIncrement: true });
        db.createObjectStore("registraties", { keyPath: "id" });
        db.createObjectStore("cache");
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fout(req.error);
    });
  }
  return dbBelofte;
}

function verzoek<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fout) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fout(r.error);
  });
}

async function bak(naam: string, modus: IDBTransactionMode = "readonly") {
  return (await open()).transaction(naam, modus).objectStore(naam);
}

export const opslag = {
  async alle<T>(naam: string): Promise<T[]> {
    return verzoek((await bak(naam)).getAll()) as Promise<T[]>;
  },
  async haal<T>(naam: string, sleutel: IDBValidKey): Promise<T | undefined> {
    return verzoek((await bak(naam)).get(sleutel)) as Promise<T | undefined>;
  },
  async zet(naam: string, waarde: unknown, sleutel?: IDBValidKey): Promise<IDBValidKey> {
    return verzoek((await bak(naam, "readwrite")).put(waarde, sleutel));
  },
  async weg(naam: string, sleutel: IDBValidKey): Promise<void> {
    await verzoek((await bak(naam, "readwrite")).delete(sleutel));
  },
};
