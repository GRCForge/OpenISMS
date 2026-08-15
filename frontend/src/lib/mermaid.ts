// Shared helpers for rendering Mermaid diagrams safely.
//
// Two separate concerns, both handled here so every diagram in the app gets the
// same treatment:
//
//  1. `mermaidLabel` — asset/data-flow names come from the API and end up inside
//     a Mermaid source string. A name containing a quote or a newline can close
//     the label early and inject further diagram syntax (e.g. a `click … href`
//     directive), so labels are stripped of the characters that carry meaning in
//     Mermaid before interpolation.
//
//  2. `renderMermaidSvg` — Mermaid returns the diagram as an SVG *string*.
//     Assigning that to `innerHTML` is a classic injection sink. Instead we parse
//     the markup into a detached document, remove everything that can execute,
//     and adopt the scrubbed node into the container.

// Characters that can close a quoted label or start a new statement/directive.
// `#` is included because Mermaid resolves `#35;`-style entity escapes inside
// labels — leaving it in would allow a quote to be smuggled back in.
const LABEL_UNSAFE = /["`#<>|{}[\]\\]/g;
// Control characters (including newline and carriage return), which terminate a
// Mermaid statement and would let a label inject a new one.
const LABEL_CONTROL = /[\u0000-\u001F\u007F]+/g;

/**
 * Makes an arbitrary string safe to interpolate into a quoted Mermaid label.
 * Control and Mermaid syntax characters are dropped, and the result is
 * truncated so an overly long name cannot blow up the diagram layout.
 */
export const mermaidLabel = (value?: string | null, maxLength = 42): string =>
  String(value ?? '')
    .replace(LABEL_CONTROL, ' ')
    .replace(LABEL_UNSAFE, '')
    .trim()
    .slice(0, maxLength)
    .trim();

/** Only same-document, relative or plain http(s)/mailto targets survive scrubbing. */
const SAFE_URI = /^(?:#|\/(?!\/)|https?:\/\/|mailto:)/i;

const EXECUTABLE_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'base', 'meta', 'audio', 'video'];

const scrubElement = (el: Element): void => {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    // Inline event handlers (onclick, onload, …) — never emitted by Mermaid.
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
      continue;
    }
    // href/src/xlink:href may carry a `javascript:` or `data:` payload.
    if (name === 'href' || name === 'src' || name.endsWith(':href')) {
      if (!SAFE_URI.test(attr.value.trim())) el.removeAttribute(attr.name);
    }
  }
};

const scrub = (root: Element): void => {
  root.querySelectorAll(EXECUTABLE_TAGS.join(',')).forEach(node => node.remove());
  scrubElement(root);
  root.querySelectorAll('*').forEach(scrubElement);
};

/**
 * Replaces the container's content with the given Mermaid SVG markup without
 * ever touching `innerHTML`. Returns false when the markup could not be parsed
 * as an SVG document, in which case the container is left empty.
 */
export const renderMermaidSvg = (container: HTMLElement, svgMarkup: string): boolean => {
  const parser = new DOMParser();

  // Preferred path: parse as XML, so no HTML parsing quirks (implicit tags,
  // unquoted attributes) can change the shape of the result.
  const xmlDoc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const xmlFailed = xmlDoc.getElementsByTagName('parsererror').length > 0;
  let svg: Element | null = xmlFailed ? null : xmlDoc.documentElement;

  // Mermaid serializes its diagrams through the HTML serializer, so the markup
  // is not always well-formed XML (void elements such as <br> in labels, bare
  // ampersands in text). Fall back to the HTML parser in that case — safe here
  // because nothing is inserted into the live document before scrubbing.
  if (!svg) svg = parser.parseFromString(svgMarkup, 'text/html').body.querySelector('svg');

  if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
    container.replaceChildren();
    return false;
  }

  // Scrub *before* the node is adopted into the live document: a <script>
  // element created by DOMParser executes as soon as it is inserted.
  scrub(svg);
  container.replaceChildren(document.importNode(svg, true));
  return true;
};
