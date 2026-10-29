// Usage : node --env-file=.env.local --no-warnings --import ./scripts/ts-hooks/register.mjs <script.mts>
// Hooks synchrones (module.registerHooks), sans worker de chargement.
import { registerHooks } from "node:module";
import { resolve } from "./hooks.mjs";

registerHooks({ resolve });
