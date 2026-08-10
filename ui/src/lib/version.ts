// The server reports whatever `git describe --tags --always --dirty` produced at
// build time, which is one of:
//   v0.4.0                     an exact tag
//   v0.4.0-3-g1e9f6ed          3 commits past the tag
//   1e9f6ed                    no tags in the history at all
//   …-dirty                    built from a tree with uncommitted changes
//   dev                        no git available
// The sidebar shows it as `v0.4.0 · g1e9f6ed`, so the tag and the commit are two
// segments rather than one long dash-joined string.

const SHA = /^[0-9a-f]{7,40}$/;
const DESCRIBE = /^(.*)-\d+-(g[0-9a-f]{7,40})$/;

export function formatVersion(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const dirty = trimmed.endsWith("-dirty");
  const described = dirty ? trimmed.slice(0, -"-dirty".length) : trimmed;

  const match = DESCRIBE.exec(described);
  const tag = match ? match[1] : described;
  const commit = match ? match[2] : null;

  const segments: string[] = [];
  // An untagged build describes as a bare sha; show it as a commit, not a tag.
  if (!commit && SHA.test(tag)) segments.push(`g${tag}`);
  else segments.push(/^\d/.test(tag) ? `v${tag}` : tag);
  if (commit) segments.push(commit);
  // Worth surfacing: a dirty build does not correspond to any commit.
  if (dirty) segments.push("dirty");

  return segments.join(" · ");
}
