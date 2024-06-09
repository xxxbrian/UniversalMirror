import crypto from "crypto";
import fs from "fs";

export function getRealPath(prefix: string, path: string): string {
  const prefixSegments = prefix.split("/");
  const pathSegments = path.split("/");
  if (prefixSegments.length >= pathSegments.length) {
    return "";
  }
  return pathSegments.slice(prefixSegments.length).join("/");
}

export function getChecksum(path: string) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(path);
    input.on("error", reject);
    input.on("data", (chunk) => {
      hash.update(chunk);
    });
    input.on("close", () => {
      resolve(hash.digest("hex"));
    });
  });
}

export function getSelfPrefix(): string {
  const protocol = process.env.PROTOCOL || "http";
  const host = process.env.HOST || "localhost:3000";
  return `${protocol}://${host}`;
}
