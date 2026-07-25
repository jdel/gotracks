import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * A small renderer for the legal documents: headings, paragraphs, lists, bold
 * runs and internal links.
 *
 * It builds React elements rather than setting HTML, so administrator-written
 * text can never inject markup — "trusted author" is not a reason to open an
 * XSS sink on a page every visitor reads. A markdown dependency would buy more
 * formatting than a policy page needs.
 */
export function renderMarkdown(body: string): ReactNode[] {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((block, i) => {
      const heading = /^(#{1,3})\s+(.*)$/.exec(block);
      if (heading) {
        const text = heading[2];
        if (heading[1].length === 1) {
          return <h1 key={i} className="text-2xl font-semibold">{text}</h1>;
        }
        if (heading[1].length === 2) {
          return <h2 key={i} className="pt-2 text-lg font-semibold">{text}</h2>;
        }
        return <h3 key={i} className="font-semibold">{text}</h3>;
      }
      const lines = block.split("\n");
      if (/^\s*-\s+/.test(lines[0])) {
        // A wrapped bullet continues the previous item rather than starting one.
        const items: string[] = [];
        for (const line of lines) {
          if (/^\s*-\s+/.test(line)) items.push(line.replace(/^\s*-\s+/, ""));
          else if (items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
        }
        return (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        );
      }
      // Single newlines inside a paragraph are wrapping in the source, not
      // meaningful breaks, so they collapse to spaces.
      return <p key={i}>{renderInline(lines.join(" "))}</p>;
    });
}

/** Renders **bold** and [label](/path), the only inline markup used. */
export function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[(.+?)\]\((\/[^)]*)\)/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(<strong key={key++}>{match[1]}</strong>);
    } else {
      parts.push(
        <Link key={key++} to={match[3]} className="underline underline-offset-4">
          {match[2]}
        </Link>,
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
