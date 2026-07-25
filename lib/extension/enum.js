/**
 * Turns an array into an immutable enum-like object
 *
 * @template {string} T
 * @param {readonly T[]} anArray
 * @returns {Readonly<Record<T, T>>}
 */
export function createEnum(anArray) {
  const enumObj = /** @type {Record<T, T>} */ ({});
  for (const val of anArray) {
    enumObj[val] = val;
  }
  return Object.freeze(enumObj);
}
