#!/usr/bin/env node
// `pnpm aws:admin <email>`: suma un usuario ya registrado al grupo admin de Cognito en AWS.
// En AWS no corre el seed (SPEC §10.2): el usuario se registra desde el sitio y después se lo hace admin.
import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { fail, info, step } from "../local/lib.mjs";
import { ENV_DIR, loadCredentials, outputs } from "./lib.mjs";

const email = process.argv[2];
if (!email || !email.includes("@")) fail("Uso: pnpm aws:admin <email-del-usuario-registrado>");

step("Credenciales de AWS");
loadCredentials();

const { user_pool_id: UserPoolId } = outputs(ENV_DIR);
if (!UserPoolId) fail("No hay un entorno desplegado en AWS. Ejecutar primero: pnpm aws:deploy");

step(`Grupo admin para ${email}`);
const cognito = new CognitoIdentityProviderClient({ region: process.env["AWS_REGION"] });
try {
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: email, GroupName: "admin" }));
} catch (err) {
  if (err.name === "UserNotFoundException") fail(`${email} no está registrado: registrarse primero en el sitio.`);
  throw err;
}
info("Listo. Cerrá sesión en el sitio y volvé a entrar: el rol viaja en el token.");
