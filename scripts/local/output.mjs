#!/usr/bin/env node
// `node scripts/local/output.mjs <nombre>`: imprime un output de Terraform del entorno local (para la CI y los E2E).
import { fail, terraformOutputs } from "./lib.mjs";

const name = process.argv[2];
if (!name) fail("Uso: node scripts/local/output.mjs <nombre-del-output>");
const value = terraformOutputs()[name];
if (value === undefined) fail(`No existe el output ${name}`);
process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
