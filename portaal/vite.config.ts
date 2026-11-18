import { defineConfig } from "vite";

// De portalen-app draait op /portaal/ van de API-server.
const API = process.env.API_URL ?? "http://localhost:3000";
const apiPaden = ["/auth", "/config", "/batches", "/registraties", "/lots", "/werkvoorraad", "/beheer", "/analyse", "/gezondheid"];

export default defineConfig({
  base: "/portaal/",
  server: { proxy: Object.fromEntries(apiPaden.map((p) => [p, API])), fs: { allow: [".."] } },
  build: { target: "es2022" },
});
