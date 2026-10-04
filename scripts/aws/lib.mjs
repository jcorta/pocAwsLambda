// Utilidades de los scripts de AWS (SPEC §11.1): credenciales, Terraform en contenedor y confirmaciones.
// Las credenciales salen del perfil de la AWS CLI (AWS_PROFILE, o el perfil por defecto) y se pasan como
// variables de entorno temporales: sirven igual para SSO, `aws login` o claves, sin montar ~/.aws en el contenedor.
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { compose, fail, info } from "../local/lib.mjs";

export const ENV_DIR = "infra/envs/aws";
export const BOOTSTRAP_DIR = "infra/bootstrap";

// En Windows, según cómo se instaló, `aws` puede ser un .cmd, que Node solo ejecuta a través del shell.
// Los argumentos son constantes de los scripts, salvo el perfil, que se valida.
function awsCli(args) {
  const profile = process.env["AWS_PROFILE"];
  if (profile && !/^[\w.@+-]+$/.test(profile)) fail(`AWS_PROFILE inválido: ${profile}`);
  const opts = { encoding: "utf8", env: { ...process.env, AWS_PAGER: "" } };
  const r =
    process.platform === "win32"
      ? spawnSync(["aws", ...args].join(" "), { ...opts, shell: true })
      : spawnSync("aws", args, opts);
  if (r.error || r.status === null) {
    fail(
      "No se encontró la AWS CLI v2. Instalarla: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
    );
  }
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

/**
 * Carga credenciales temporales del perfil en process.env, para Terraform (contenedor) y el AWS SDK.
 * Devuelve la identidad: cuenta y ARN.
 */
export function loadCredentials() {
  const profile = process.env["AWS_PROFILE"] ?? "default";
  // A través del shell, una CLI que no existe no da error de spawn: se detecta con --version
  const version = awsCli(["--version"]);
  if (!version.ok || !version.stdout.startsWith("aws-cli/2")) {
    fail(
      "Hace falta la AWS CLI v2 (prerequisito para AWS, SPEC §11.1). Instalarla: " +
        "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
    );
  }
  const creds = awsCli(["configure", "export-credentials", "--format", "process"]);
  if (!creds.ok) {
    fail(
      `No hay credenciales válidas para el perfil "${profile}". Iniciar sesión, por ejemplo:\n` +
        `    aws login            (o: aws sso login)\n  y volver a correr el comando. Para otro perfil: AWS_PROFILE=<perfil>.\n  ${creds.stderr}`,
    );
  }
  const c = JSON.parse(creds.stdout);
  process.env["AWS_ACCESS_KEY_ID"] = c.AccessKeyId;
  process.env["AWS_SECRET_ACCESS_KEY"] = c.SecretAccessKey;
  if (c.SessionToken) process.env["AWS_SESSION_TOKEN"] = c.SessionToken;
  else delete process.env["AWS_SESSION_TOKEN"];
  // El perfil ya no hace falta: las variables de entorno tienen prioridad, y así el contenedor no lo busca
  delete process.env["AWS_PROFILE"];
  process.env["AWS_REGION"] ??= "us-east-1";

  const id = awsCli(["sts", "get-caller-identity", "--output", "json"]);
  if (!id.ok) fail(`Las credenciales no son válidas: ${id.stderr}`);
  const { Account, Arn } = JSON.parse(id.stdout);
  info(`Cuenta ${Account} (${Arn}), región ${process.env["AWS_REGION"]}`);
  return { account: Account, arn: Arn };
}

/** Terraform en su contenedor, con las credenciales temporales por variables de entorno. */
export function terraform(dir, args, opts) {
  return compose(
    [
      "run",
      "--rm",
      "-T",
      "--no-deps",
      ...["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION"].flatMap((v) => ["-e", v]),
      "terraform",
      `-chdir=${dir}`,
      ...args,
    ],
    opts,
  );
}

/** Outputs de un root como objeto plano. */
export function outputs(dir) {
  const { stdout } = terraform(dir, ["output", "-json"], { capture: true });
  const raw = JSON.parse(stdout || "{}");
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.value]));
}

/** Pide confirmación escribiendo una palabra exacta. Sin terminal interactiva, no confirma. */
export async function confirm(question, word) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n${question}\n  Escribí "${word}" para continuar: `);
  rl.close();
  return answer.trim() === word;
}
