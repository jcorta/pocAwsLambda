// Autenticación contra Cognito desde el navegador (SPEC §5.3): pantallas propias, sin Hosted UI ni Amplify,
// para poder apuntar el endpoint a Floci. Flujo USER_PASSWORD_AUTH.
import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognitoEndpoint, type RuntimeConfig } from "./config.ts";
import { sessionFromTokens, type Session } from "./session.ts";

/** Error de autenticación con un motivo que la UI sabe mostrar. */
export class AuthError extends Error {
  constructor(
    readonly reason:
      | "INVALID_CREDENTIALS"
      | "NOT_CONFIRMED"
      | "USER_EXISTS"
      | "INVALID_PASSWORD"
      | "INVALID_CODE"
      | "EXPIRED_CODE"
      | "TOO_MANY_ATTEMPTS"
      | "UNKNOWN",
    message: string,
  ) {
    super(message);
  }
}

const REASONS: Record<string, [AuthError["reason"], string]> = {
  NotAuthorizedException: ["INVALID_CREDENTIALS", "Email o contraseña incorrectos."],
  UserNotFoundException: ["INVALID_CREDENTIALS", "Email o contraseña incorrectos."],
  UserNotConfirmedException: ["NOT_CONFIRMED", "Tenés que confirmar tu email antes de ingresar."],
  UsernameExistsException: ["USER_EXISTS", "Ya existe una cuenta con ese email."],
  AliasExistsException: ["USER_EXISTS", "Ya existe una cuenta con ese email."],
  InvalidPasswordException: [
    "INVALID_PASSWORD",
    "La contraseña debe tener al menos 8 caracteres, con mayúsculas, minúsculas y números.",
  ],
  CodeMismatchException: ["INVALID_CODE", "El código no es correcto."],
  ExpiredCodeException: ["EXPIRED_CODE", "El código venció. Pedí uno nuevo."],
  LimitExceededException: ["TOO_MANY_ATTEMPTS", "Demasiados intentos. Esperá unos minutos."],
  TooManyRequestsException: ["TOO_MANY_ATTEMPTS", "Demasiados intentos. Esperá unos minutos."],
};

function toAuthError(err: unknown): AuthError {
  const name = (err as { name?: string }).name ?? "";
  const [reason, message] = REASONS[name] ?? ["UNKNOWN", "No se pudo completar la operación. Probá de nuevo."];
  return new AuthError(reason, message);
}

export interface CognitoAuth {
  signUp(email: string, password: string): Promise<void>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendCode(email: string): Promise<void>;
  login(email: string, password: string): Promise<Session>;
  /** Pide un ID token nuevo con el refresh token. Cognito no devuelve un refresh token nuevo. */
  refresh(session: Session): Promise<Session>;
  signOut(session: Session): Promise<void>;
}

export function createCognitoAuth(config: RuntimeConfig, origin = window.location.origin): CognitoAuth {
  const endpoint = cognitoEndpoint(config, origin);
  const client = new CognitoIdentityProviderClient({
    region: config.cognito.region,
    ...(endpoint ? { endpoint } : {}),
  });
  const ClientId = config.cognito.clientId;
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw toAuthError(err);
    }
  };

  return {
    signUp: (email, password) =>
      call(async () => {
        await client.send(
          new SignUpCommand({
            ClientId,
            Username: email,
            Password: password,
            UserAttributes: [{ Name: "email", Value: email }],
          }),
        );
      }),
    confirmSignUp: (email, code) =>
      call(async () => {
        await client.send(new ConfirmSignUpCommand({ ClientId, Username: email, ConfirmationCode: code }));
      }),
    resendCode: (email) =>
      call(async () => {
        await client.send(new ResendConfirmationCodeCommand({ ClientId, Username: email }));
      }),
    login: (email, password) =>
      call(async () => {
        const r = await client.send(
          new InitiateAuthCommand({
            ClientId,
            AuthFlow: "USER_PASSWORD_AUTH",
            AuthParameters: { USERNAME: email, PASSWORD: password },
          }),
        );
        const t = r.AuthenticationResult;
        if (!t?.IdToken || !t.AccessToken || !t.RefreshToken) throw new Error("Cognito no devolvió los tokens");
        return sessionFromTokens({ idToken: t.IdToken, accessToken: t.AccessToken, refreshToken: t.RefreshToken });
      }),
    refresh: (session) =>
      call(async () => {
        const r = await client.send(
          new InitiateAuthCommand({
            ClientId,
            AuthFlow: "REFRESH_TOKEN_AUTH",
            AuthParameters: { REFRESH_TOKEN: session.refreshToken },
          }),
        );
        const t = r.AuthenticationResult;
        if (!t?.IdToken || !t.AccessToken) throw new Error("Cognito no devolvió los tokens");
        return sessionFromTokens({
          idToken: t.IdToken,
          accessToken: t.AccessToken,
          refreshToken: t.RefreshToken ?? session.refreshToken,
        });
      }),
    signOut: (session) =>
      call(async () => {
        await client.send(new GlobalSignOutCommand({ AccessToken: session.accessToken }));
      }),
  };
}
