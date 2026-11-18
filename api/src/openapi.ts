// Schrijft openapi.json, waaruit later ook een .NET-client gegenereerd kan worden.
import { writeFileSync } from "node:fs";
import { bouwApp } from "./app.js";
import { maakPool } from "./db.js";

const app = await bouwApp({ db: maakPool("postgres://ongebruikt@localhost/x"), jwtGeheim: "x".repeat(32) });
await app.ready();
writeFileSync("openapi.json", JSON.stringify(app.swagger(), null, 2));
console.log("openapi.json geschreven");
await app.close();
process.exit(0);
