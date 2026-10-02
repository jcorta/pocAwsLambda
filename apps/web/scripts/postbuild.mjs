#!/usr/bin/env node
// config.json nunca forma parte del build (SPEC §5.2): el de public/ es solo para `pnpm dev`,
// y en cada entorno lo escribe Terraform en el bucket.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

rmSync(join(dirname(fileURLToPath(import.meta.url)), "..", "out", "config.json"), { force: true });
