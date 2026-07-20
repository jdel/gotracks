import { api } from "@/lib/api";
import type { AuthResponse } from "@/lib/types";

/**
 * WebAuthn helpers built directly on navigator.credentials — no library.
 *
 * The only real work is encoding: the browser API speaks ArrayBuffer while JSON
 * carries base64url, so each side has to be converted by hand.
 */

/** base64url → ArrayBuffer. */
function toBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** ArrayBuffer → base64url (no padding). */
function toBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** isSupported reports whether this browser can do WebAuthn at all. */
export function isPasskeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

interface BeginResponse {
  options: { publicKey: Record<string, unknown> };
  sessionId: string;
}

// The server returns the raw WebAuthn options with binary fields base64url
// encoded; these two functions decode exactly the fields the API requires.
function decodeCreationOptions(publicKey: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const user = publicKey.user as { id: string; [k: string]: unknown };
  const exclude = (publicKey.excludeCredentials as Array<Record<string, unknown>>) ?? [];
  return {
    ...publicKey,
    challenge: toBuffer(publicKey.challenge as string),
    user: { ...user, id: toBuffer(user.id) },
    excludeCredentials: exclude.map((c) => ({
      ...c,
      id: toBuffer(c.id as string),
    })),
  } as PublicKeyCredentialCreationOptions;
}

function decodeRequestOptions(publicKey: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const allow = (publicKey.allowCredentials as Array<Record<string, unknown>>) ?? [];
  return {
    ...publicKey,
    challenge: toBuffer(publicKey.challenge as string),
    allowCredentials: allow.map((c) => ({
      ...c,
      id: toBuffer(c.id as string),
    })),
  } as PublicKeyCredentialRequestOptions;
}

/** enrolPasskey runs the registration ceremony for the signed-in user. */
export async function enrolPasskey(name: string): Promise<void> {
  const begin = await api.post<BeginResponse>("/passkeys/register/begin");
  const credential = (await navigator.credentials.create({
    publicKey: decodeCreationOptions(begin.options.publicKey),
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("no passkey was created");
  const attestation = credential.response as AuthenticatorAttestationResponse;

  await api.post("/passkeys/register/finish", {
    sessionId: begin.sessionId,
    name,
    response: {
      id: credential.id,
      rawId: toBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: toBase64url(attestation.clientDataJSON),
        attestationObject: toBase64url(attestation.attestationObject),
      },
    },
  });
}

/** loginWithPasskey runs the assertion ceremony and returns the session. */
export async function loginWithPasskey(email: string): Promise<AuthResponse> {
  const begin = await api.raw("/auth/passkey/login/begin", { email }) as BeginResponse;
  const credential = (await navigator.credentials.get({
    publicKey: decodeRequestOptions(begin.options.publicKey),
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("no passkey was used");
  const assertion = credential.response as AuthenticatorAssertionResponse;

  return (await api.raw("/auth/passkey/login/finish", {
    sessionId: begin.sessionId,
    response: {
      id: credential.id,
      rawId: toBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: toBase64url(assertion.clientDataJSON),
        authenticatorData: toBase64url(assertion.authenticatorData),
        signature: toBase64url(assertion.signature),
        userHandle: assertion.userHandle ? toBase64url(assertion.userHandle) : null,
      },
    },
  })) as AuthResponse;
}

/**
 * reauthWithPasskey runs an assertion for the signed-in user and returns the
 * proof to attach to a credential change, standing in for typing the current
 * password.
 */
export async function reauthWithPasskey(): Promise<{
  passkeySessionId: string;
  passkeyResponse: unknown;
}> {
  const begin = await api.post<BeginResponse>("/me/reauth/passkey/begin");
  const credential = (await navigator.credentials.get({
    publicKey: decodeRequestOptions(begin.options.publicKey),
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("no passkey was used");
  const assertion = credential.response as AuthenticatorAssertionResponse;

  return {
    passkeySessionId: begin.sessionId,
    passkeyResponse: {
      id: credential.id,
      rawId: toBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: toBase64url(assertion.clientDataJSON),
        authenticatorData: toBase64url(assertion.authenticatorData),
        signature: toBase64url(assertion.signature),
        userHandle: assertion.userHandle ? toBase64url(assertion.userHandle) : null,
      },
    },
  };
}
