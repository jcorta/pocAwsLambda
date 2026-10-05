// Tests de las utilidades puras de los scripts de AWS. Se corren con `node --test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inState } from "./lib.mjs";

const STATE = [
  'module.api.aws_lambda_function.fn["admin"]',
  "module.database.aws_db_subnet_group.main",
  "module.database.aws_db_instance.main",
  "module.network.aws_vpc.main",
].join("\n");

test("encuentra un recurso por su dirección exacta", () => {
  assert.equal(inState(STATE, "module.database.aws_db_instance.main"), true);
});

test("un despliegue incompleto sin RDS no la encuentra", () => {
  const partial = "module.network.aws_vpc.main\nmodule.database.aws_db_subnet_group.main";
  assert.equal(inState(partial, "module.database.aws_db_instance.main"), false);
});

test("no confunde un prefijo con otro recurso", () => {
  assert.equal(inState("module.database.aws_db_instance.main_replica", "module.database.aws_db_instance.main"), false);
});

test("un state vacío no tiene nada, y soporta saltos de línea de Windows", () => {
  assert.equal(inState("", "module.database.aws_db_instance.main"), false);
  assert.equal(inState("a\r\nmodule.database.aws_db_instance.main\r\nb", "module.database.aws_db_instance.main"), true);
});
