// Windows Credential Manager, read through txiki's FFI — the one place Manapoint
// needs a Win32 call tinyjs does not wrap. (tiny.app.secrets reads only the app's OWN
// namespaced secrets; Antigravity's login belongs to the `agy` CLI.)
//
// CredReadW(target, CRED_TYPE_GENERIC, 0, &PCREDENTIALW) → BOOL. On x64 the CREDENTIALW
// fields read here sit at fixed offsets:
//   +32 CredentialBlobSize (DWORD)   +40 CredentialBlob (LPBYTE)
// The buffer is released with CredFree before returning; nothing borrows from it.

const CRED_TYPE_GENERIC = 1;
const ERROR_NOT_FOUND = 1168;
const OFFSET_BLOB_SIZE = 32;
const OFFSET_BLOB = 40;

let bound = null;

async function bind() {
  if (bound) return bound;
  const FFI = (await import("tjs:ffi")).default;
  const adv = FFI.dlopen("advapi32.dll", {
    CredReadW: { args: ["buffer", "u32", "u32", "buffer"], returns: "i32" },
    CredFree: { args: ["pointer"], returns: "void" },
  });
  const k32 = FFI.dlopen("kernel32.dll", { GetLastError: { args: [], returns: "u32" } });
  bound = { FFI, adv: adv.symbols, k32: k32.symbols };
  return bound;
}

function utf16z(text) {
  const units = new Uint16Array(text.length + 1);
  for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i);
  return new Uint8Array(units.buffer);
}

/**
 * The blob of one generic credential: bytes, or null when no such credential exists
 * (the not-signed-in case). Throws when the store itself cannot be reached.
 */
export async function readGeneric(target) {
  const { FFI, adv, k32 } = await bind();
  const out = new Uint8Array(8);
  if (!adv.CredReadW(utf16z(target), CRED_TYPE_GENERIC, 0, out)) {
    const code = k32.GetLastError();
    if (code === ERROR_NOT_FOUND) return null;
    throw new Error(`CredReadW failed (${code})`);
  }

  const cred = FFI.types.pointer.fromBuffer(out);
  if (!cred) return null;
  try {
    const size = FFI.read.u32(cred, OFFSET_BLOB_SIZE);
    const blob = FFI.types.pointer.fromBuffer(cred.toUint8Array(8, OFFSET_BLOB));
    // slice(): copy out of native memory before CredFree releases it.
    return size > 0 && blob ? blob.toUint8Array(size).slice() : null;
  } finally {
    adv.CredFree(cred);
  }
}
