'use strict';

// Escapes special MySQL LIKE wildcard characters (%, _, \) so that user-supplied
// search strings are matched literally instead of as wildcards.
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, c => `\\${c}`);
}

module.exports = { escapeLike };
