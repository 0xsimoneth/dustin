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
});
