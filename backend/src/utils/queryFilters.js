'use strict';

/**
 * Helpers for turning query-string input into safe Sequelize filters.
 *
 * Express parses ?status[ne]=x into an object and ?status[]=a&status[]=b into an
 * array, so a filter written as `where.status = status` does not necessarily
 * compare a string. Sequelize v6 no longer reads string operator aliases, so the
 * object form is not an injection — it simply reaches MySQL as something it
 * cannot compare and comes back as a failed request. A filter that cannot be
 * understood should be ignored, not turn the whole list into an error.
 */

/** The value if it is a plain scalar, otherwise undefined. */
const scalar = (value) =>
  (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') ? value : undefined;

/**
 * Scalars pass through; arrays of scalars pass through as an IN list (?tag[]=a&tag[]=b
 * is a reasonable thing for a client to send). Anything else — objects, nested
 * arrays — is dropped.
 */
const scalarOrList = (value) => {
  const one = scalar(value);
  if (one !== undefined) return one;
  if (Array.isArray(value)) {
    const list = value.map(scalar).filter(v => v !== undefined);
    return list.length ? list : undefined;
  }
  return undefined;
};

/** Integer within [min, max], or the fallback when the input is not one. */
const boundedInt = (value, fallback, min, max) => {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

/** A valid Date, or null. `endOfDay` turns a bare YYYY-MM-DD into its last second. */
const validDate = (value, endOfDay = false) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T23:59:59` : value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Assigns a query-string filter to a where clause, but only when it survives
 * scalarOrList. Keeps the call sites down to one readable line each.
 *
 * An empty string is skipped rather than matched: the callers replaced here read
 * `if (status) where.status = status`, and the UI sends ?status= when a filter is
 * cleared. Filtering for the empty string would return nothing at all instead of
 * everything, which is the opposite of what clearing a filter means.
 */
const setFilter = (where, field, value) => {
  const usable = scalarOrList(value);
  if (usable === undefined || usable === '') return where;
  where[field] = usable;
  return where;
};

module.exports = { scalar, scalarOrList, boundedInt, validDate, setFilter };
