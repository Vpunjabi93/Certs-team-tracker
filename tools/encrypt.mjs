// Encrypts private/data.json into data.enc.json with the team password.
// Usage: TEAM_PASSWORD='...' node tools/encrypt.mjs [private/data.json] [data.enc.json]
// The plaintext file is git-ignored; only the encrypted file is published.
import { readFileSync, writeFileSync } from "node:fs";

const [src = "private/data.json", dest = "data.enc.json"] = process.argv.slice(2);
const pass = process.env.TEAM_PASSWORD;
if (!pass) { console.error("Set TEAM_PASSWORD first."); process.exit(1); }

const { subtle } = globalThis.crypto;
const ITER = 310000;
const enc = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString("base64");

const plain = readFileSync(src, "utf8");
const data = JSON.parse(plain);
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
const key = await subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
  base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
);
const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data))));
writeFileSync(dest, JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }) + "\n");
console.log(`Encrypted ${data.tasks.length} tasks -> ${dest}`);
