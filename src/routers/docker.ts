import { Hono } from "hono";
import { stream } from "hono/streaming";
import { readFile, mkdir, unlink } from "node:fs/promises";
import fs from "node:fs";
import { getChecksum, getRealPath, getSelfPrefix } from "../libs/utils";

const docker = new Hono();
const prefix = "/docker";

docker.get(
  "/registry-v2/docker/registry/v2/blobs/sha256/:hash_head/:hash/data",
  async (c) => {
    const hash = c.req.param("hash");

    // use cache if exists
    const fileStoragePath = `./data/storage/${hash}`;
    if (fs.existsSync(fileStoragePath)) {
      return stream(c, async (stream) => {
        stream.onAbort(async () => {
          console.log("Stream aborted");
          return;
        });
        await stream.write(new Uint8Array(await readFile(fileStoragePath)));
        await stream.close();
      });
    }

    const query = c.req.query();
    const url = `https://production.cloudflare.docker.com/registry-v2/docker/registry/v2/blobs/sha256/${c.req.param(
      "hash_head",
    )}/${c.req.param("hash")}/data${Object.entries(query)
      .map(([key, value]) => `?${key}=${value}`)
      .join("")}`;
    const headers = c.req.raw.headers;
    headers.set("host", "production.cloudflare.docker.com");
    headers.set("surge-tag", "docker-cache");
    const body = c.req.raw.body;
    const resp = await fetch(url, {
      method: "GET",
      headers: headers,
      body: body,
    });
    if (!resp.ok) {
      return resp;
    }
    if (resp.headers.get("content-type") !== "application/octet-stream") {
      return resp;
    }

    const fileCachePath = `./data/cache/${hash}`;
    await mkdir("./data/cache", { recursive: true });
    await mkdir("./data/storage", { recursive: true });
    const writer = fs.createWriteStream(fileCachePath, { flags: "w" });

    return stream(c, async (stream) => {
      const reader = resp.body!.getReader();
      stream.onAbort(async () => {
        await reader.cancel();
        writer.close();
        await unlink(fileCachePath);
        return;
      });
      while (true) {
        try {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(value);
          await stream.write(value);
        } catch (e) {
          console.error(e);
          break;
        }
      }
      writer.close();
      await stream.close();
      // check sha256 sum of the file
      const fileContent = await readFile(fileCachePath);
      getChecksum(fileCachePath)
        .then(async (sum) => {
          if (sum === hash) {
            fs.renameSync(fileCachePath, fileStoragePath);
          } else {
            console.error(`Checksum failed: ${sum} !== ${hash}`);
            await unlink(fileCachePath);
          }
        })
        .catch(async (e) => {
          console.error(e);
          await unlink(fileCachePath);
        });
    });
  },
);

docker.get("/v2/:org/:name/blobs/:hash", async (c) => {
  const org = c.req.param("org");
  const name = c.req.param("name");
  const hash = c.req.param("hash");
  const query = c.req.query();
  const url = `https://registry-1.docker.io/v2/${org}/${name}/blobs/${hash}${Object.entries(
    query,
  )
    .map(([key, value]) => `?${key}=${value}`)
    .join("")}`;
  const headers = new Headers(c.req.raw.headers);
  headers.set("host", "registry-1.docker.io");
  headers.set("surge-tag", "docker-cache");

  const resp = await fetch(url, {
    method: "GET",
    headers: headers,
    redirect: "manual",
  });

  if (resp.status >= 300 && resp.status < 400) {
    // handle redirect responses manually
    const location = resp.headers.get("location");
    if (location) {
      const locationURL = new URL(location);
      const newLocation = `${getSelfPrefix()}${prefix}${locationURL.pathname}${
        locationURL.search
      }`;
      console.log(`Redirecting to ${newLocation}`);
      const headers = new Headers(resp.headers);
      headers.set("location", newLocation);
      return new Response(null, {
        status: resp.status,
        statusText: resp.statusText,
        headers: headers,
      });
    }
  }
  console.log("Not redirecting");
  return resp;
});

docker.all("*", async (c) => {
  const realPath = getRealPath(prefix, c.req.path);
  if (!realPath) {
    return c.text("Not found", { status: 404 });
  }
  const query = c.req.query();
  const url = `https://registry-1.docker.io/${realPath}${Object.entries(query)
    .map(([key, value]) => `?${key}=${value}`)
    .join("")}`;
  const headers = c.req.raw.headers;
  headers.set("host", "registry-1.docker.io");
  headers.set("surge-tag", "docker-cache");
  const body = c.req.raw.body;
  const resp = await fetch(url, {
    method: c.req.method,
    headers: headers,
    body: body,
  });
  return resp;
});

export { docker };
