import { readFileSync } from "node:fs";

/**
 * A small JSON Schema validator for the two published schemas (docs/plan-schema.json and
 * docs/receipt-schema.json; story E4-S1, AC-E4-S1-2), so the test needs no new dependency. It
 * implements the part of draft 2020-12 (https://json-schema.org/draft/2020-12/json-schema-core,
 * https://json-schema.org/draft/2020-12/json-schema-validation) that the schemas use: `type`,
 * `const`, `enum`, `properties`, `required`, `additionalProperties`, `items`, `minItems`,
 * `maxItems`, `minimum`, `maximum`, `pattern`, `anyOf`, `oneOf` and `$ref` (a JSON pointer in the
 * same schema or in another registered one, resolved against `$id`). `assertSupported` refuses a
 * schema that uses any other keyword, so nothing in it goes unchecked.
 *
 * In strict mode an object schema with `properties` and no `additionalProperties` refuses unknown
 * properties: the published schemas allow them for forward compatibility, and the tests use strict
 * mode so that a field the code writes and the schema does not list fails.
 */

type Schema = Record<string, unknown>;

const SUPPORTED = new Set([
  "$schema",
  "$id",
  "$defs",
  "$ref",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "pattern",
  "anyOf",
  "oneOf",
]);

export class SchemaRegistry {
  private readonly schemas = new Map<string, Schema>();

  add(schema: Schema): this {
    const id = schema.$id;
    if (typeof id !== "string") throw new Error("a registered schema needs an $id");
    this.schemas.set(id, schema);
    return this;
  }

  load(path: string): Schema {
    const schema = JSON.parse(readFileSync(path, "utf8")) as Schema;
    this.add(schema);
    return schema;
  }

  /** Every keyword the schemas use is one this validator implements. */
  assertSupported(): void {
    const walk = (node: unknown, at: string, schemaPosition: boolean): void => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${at}/${i}`, schemaPosition));
        return;
      }
      if (node === null || typeof node !== "object") return;
      const obj = node as Schema;
      if (!schemaPosition) {
        for (const [k, v] of Object.entries(obj)) walk(v, `${at}/${k}`, true);
        return;
      }
      for (const [key, value] of Object.entries(obj)) {
        if (!SUPPORTED.has(key)) throw new Error(`unsupported keyword ${key} at ${at}`);
        if (key === "properties" || key === "$defs") walk(value, `${at}/${key}`, false);
        else if (key === "items" || key === "additionalProperties") {
          walk(value, `${at}/${key}`, true);
        } else if (key === "anyOf" || key === "oneOf") walk(value, `${at}/${key}`, true);
      }
    };
    for (const [id, schema] of this.schemas) walk(schema, id, true);
  }

  /** The errors of `value` against the schema registered as `id`; empty means valid. */
  validate(id: string, value: unknown, options: { strict?: boolean } = {}): string[] {
    const root = this.schemas.get(id);
    if (!root) throw new Error(`no schema ${id}`);
    const errors: string[] = [];
    this.check(root, root, value, "", options.strict === true, errors);
    return errors;
  }

  private resolve(ref: string, base: Schema): { schema: Schema; root: Schema } {
    const baseId = base.$id as string;
    const url = new URL(ref, baseId);
    const pointer = url.hash.replace(/^#/, "");
    url.hash = "";
    const root = this.schemas.get(url.toString());
    if (!root) throw new Error(`unresolved $ref ${ref} from ${baseId}`);
    let node: unknown = root;
    for (const part of pointer.split("/").filter(Boolean)) {
      node = (node as Schema)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
    }
    return { schema: node as Schema, root };
  }

  private check(
    schema: Schema,
    root: Schema,
    value: unknown,
    at: string,
    strict: boolean,
    errors: string[],
  ): void {
    const fail = (message: string) => errors.push(`${at || "/"}: ${message}`);
    if (typeof schema.$ref === "string") {
      const target = this.resolve(schema.$ref, root);
      this.check(target.schema, target.root, value, at, strict, errors);
    }
    if ("const" in schema && !deepEqual(schema.const, value)) {
      fail(`expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
      fail(`${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type)
        ? (schema.type as string[])
        : [schema.type as string];
      if (!types.some((t) => hasType(value, t))) {
        fail(`expected type ${types.join(" or ")}, got ${describe(value)}`);
        return;
      }
    }
    if (Array.isArray(schema.anyOf)) {
      const passes = (schema.anyOf as Schema[]).filter((s) => this.passes(s, root, value, strict));
      if (passes.length === 0) fail("matches none of anyOf");
    }
    if (Array.isArray(schema.oneOf)) {
      const passes = (schema.oneOf as Schema[]).filter((s) => this.passes(s, root, value, strict));
      if (passes.length !== 1) {
        fail(`matches ${passes.length} of oneOf, not exactly one`);
        // Say why for the branch whose const `type` matches, to make a failure readable.
        for (const branch of schema.oneOf as Schema[]) {
          const props = branch.properties as Record<string, Schema> | undefined;
          const discriminant = props?.type?.const;
          if (discriminant !== undefined && (value as Schema | null)?.type === discriminant) {
            this.check(branch, root, value, at, strict, errors);
          }
        }
      }
    }
    if (typeof value === "string" && typeof schema.pattern === "string") {
      if (!new RegExp(schema.pattern, "u").test(value))
        fail(`"${value}" does not match ${schema.pattern}`);
    }
    if (typeof value === "number") {
      if (typeof schema.minimum === "number" && value < schema.minimum)
        fail(`${value} < ${schema.minimum}`);
      if (typeof schema.maximum === "number" && value > schema.maximum)
        fail(`${value} > ${schema.maximum}`);
    }
    if (Array.isArray(value)) {
      if (typeof schema.minItems === "number" && value.length < schema.minItems)
        fail("too few items");
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
        fail("too many items");
      if (schema.items && typeof schema.items === "object") {
        value.forEach((item, i) =>
          this.check(schema.items as Schema, root, item, `${at}/${i}`, strict, errors),
        );
      }
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      for (const key of (schema.required as string[] | undefined) ?? []) {
        if (!(key in obj)) fail(`missing required property ${key}`);
      }
      const props = (schema.properties as Record<string, Schema> | undefined) ?? {};
      for (const [key, item] of Object.entries(obj)) {
        const sub = props[key];
        if (sub) {
          this.check(sub, root, item, `${at}/${key}`, strict, errors);
        } else if (schema.additionalProperties === false) {
          fail(`unknown property ${key}`);
        } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
          this.check(
            schema.additionalProperties as Schema,
            root,
            item,
            `${at}/${key}`,
            strict,
            errors,
          );
        } else if (
          strict &&
          schema.properties !== undefined &&
          schema.additionalProperties === undefined
        ) {
          fail(`property ${key} is not in the schema (strict mode)`);
        }
      }
    }
  }

  private passes(schema: Schema, root: Schema, value: unknown, strict: boolean): boolean {
    const errors: string[] = [];
    this.check(schema, root, value, "", strict, errors);
    return errors.length === 0;
  }
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    default:
      throw new Error(`unknown type ${type}`);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const PLAN_SCHEMA_ID =
  "https://github.com/0xsimoneth/dustin/blob/main/docs/plan-schema.json";
export const REPORT_SCHEMA_ID =
  "https://github.com/0xsimoneth/dustin/blob/main/docs/receipt-schema.json";

/** The two published schemas, loaded and checked for unsupported keywords. */
export function publishedSchemas(): SchemaRegistry {
  const registry = new SchemaRegistry();
  registry.load("docs/plan-schema.json");
  registry.load("docs/receipt-schema.json");
  registry.assertSupported();
  return registry;
}
