import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { guardedWriter } from "../../../src/cli/output.js";

describe("guardedWriter", () => {
  it("writes until the stream fails, then drops output instead of crashing (EPIPE)", () => {
    const stream = new PassThrough();
    const seen: string[] = [];
    stream.on("data", (chunk: Buffer) => seen.push(chunk.toString("utf8")));
    const write = guardedWriter(stream);
    write("first\n");
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    stream.emit("error", epipe);
    expect(() => write("second\n")).not.toThrow();
    expect(seen.join("")).toBe("first\n");
  });

  it("sends the rest to the fallback after a one-time notice once the stream failed", () => {
    const stream = new PassThrough();
    const seen: string[] = [];
    stream.on("data", (chunk: Buffer) => seen.push(chunk.toString("utf8")));
    const elsewhere: string[] = [];
    const write = guardedWriter(stream, {
      fallback: (text) => elsewhere.push(text),
      notice: "stdout closed\n",
    });
    write("first\n");
    stream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    write("hash 1\n");
    write("receipt\n");
    expect(seen.join("")).toBe("first\n");
    expect(elsewhere).toEqual(["stdout closed\n", "hash 1\n", "receipt\n"]);
  });

  it("falls back when a write throws, too", () => {
    const stream = new PassThrough();
    stream.write = () => {
      throw new Error("write after end");
    };
    const elsewhere: string[] = [];
    const write = guardedWriter(stream, { fallback: (text) => elsewhere.push(text) });
    expect(() => write("x\n")).not.toThrow();
    expect(elsewhere).toEqual(["x\n"]);
  });
});
