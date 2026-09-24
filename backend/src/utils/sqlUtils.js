'use strict';

// Escapes the LIKE/ILIKE wildcard characters (%, _, \) so that user-supplied
// search strings are matched literally instead of as wildcards.
//
// The backslash is the default escape character in PostgreSQL's LIKE/ILIKE just
// as it was in MySQL's LIKE, so this needed no change when the project moved to
// PostgreSQL in v3.0.0 — it is called out here because that is not obvious and
// the next reader should not have to look it up.
//
// Note that the comparison itself is case-insensitive only because the call
// sites use Op.iLike. MySQL's default collation gave that for free; PostgreSQL
// compares exactly, so a plain Op.like would silently turn every search in the
// application case-sensitive.
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, c => `\\${c}`);
}

module.exports = { escapeLike };
