/**
 * A tiny element builder, so every piece of data from Horizon (asset codes, data entry names,
 * reasons) is written as text, never parsed as HTML. Attribute values are set with setAttribute;
 * children are nodes or strings. A framework can replace this file later.
 */

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false) continue;
    element.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

export function text(tag: keyof HTMLElementTagNameMap, content: string, className?: string) {
  return h(tag, className ? { class: className } : {}, [content]);
}
