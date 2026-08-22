import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run auth:hash -- 'your password'");
  process.exit(1);
}

const derive = promisify(scrypt);
const salt = randomBytes(16);
const hash = await derive(password, salt, 64);
process.stdout.write(`scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}\n`);
