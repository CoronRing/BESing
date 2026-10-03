/**
 * BESing (Browser Extension Script) - Universal Runtime Adapter
 * Bridges Tampermonkey/Violentmonkey (Greasy Fork) and Chrome Manifest V3 APIs.
 */

export const BESAdapter = (() => {
  const isGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const isExtension = typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
  const isWeb = !isGM && !isExtension;

  const STORAGE_PREFIX = 'besing_';

  return {
    environment: isGM ? 'userscript' : (isExtension ? 'extension' : 'web'),

    /**
     * Retrieve a value from persistent storage.
     */
    async get(key, defaultValue = null) {
      if (isGM) {
        try {
          const val = GM_getValue(key, defaultValue);
          return val !== undefined ? val : defaultValue;
        } catch (e) {
          console.warn('[BESing Adapter] GM_getValue error:', e);
          return defaultValue;
        }
      }

      if (isExtension) {
        return new Promise((resolve) => {
          let resolved = false;
          // Guard against suspended background context / hung IPC on mobile
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try {
                const item = window.localStorage.getItem(STORAGE_PREFIX + key);
                resolve(item ? JSON.parse(item) : defaultValue);
              } catch (e) {
                resolve(defaultValue);
              }
            }
          }, 800);

          try {
            chrome.storage.local.get([key], (result) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                if (chrome.runtime && chrome.runtime.lastError) {
                  try {
                    const item = window.localStorage.getItem(STORAGE_PREFIX + key);
                    resolve(item ? JSON.parse(item) : defaultValue);
                  } catch (e) {
                    resolve(defaultValue);
                  }
                } else {
                  const val = (result && result[key] !== undefined) ? result[key] : defaultValue;
                  try {
                    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
                  } catch (e) {}
                  resolve(val);
                }
              }
            });
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              try {
                const item = window.localStorage.getItem(STORAGE_PREFIX + key);
                resolve(item ? JSON.parse(item) : defaultValue);
              } catch (err) {
                resolve(defaultValue);
              }
            }
          }
        });
      }

      // Web / LocalStorage fallback
      try {
        const item = window.localStorage.getItem(STORAGE_PREFIX + key);
        return item ? JSON.parse(item) : defaultValue;
      } catch (e) {
        console.warn('[BESing Adapter] localStorage error:', e);
        return defaultValue;
      }
    },

    /**
     * Batch retrieve multiple keys from persistent storage.
     */
    async getAll(defaults = {}) {
      const keys = Object.keys(defaults);
      const result = { ...defaults };

      // Pre-fill from localStorage synchronously
      for (const k of keys) {
        try {
          const item = window.localStorage.getItem(STORAGE_PREFIX + k);
          if (item !== null && item !== undefined) {
            result[k] = JSON.parse(item);
          }
        } catch (e) {}
      }

      if (isGM) {
        for (const k of keys) {
          try {
            const val = GM_getValue(k, undefined);
            if (val !== undefined) result[k] = val;
          } catch (e) {}
        }
        return result;
      }

      if (isExtension) {
        return new Promise((resolve) => {
          let resolved = false;
          // Guard against suspended background context / hung IPC on mobile
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve(result);
            }
          }, 350);

          try {
            chrome.storage.local.get(keys, (res) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                if (chrome.runtime && chrome.runtime.lastError) {
                  resolve(result);
                } else if (res && typeof res === 'object') {
                  for (const k of keys) {
                    if (res[k] !== undefined) {
                      result[k] = res[k];
                      try {
                        window.localStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(res[k]));
                      } catch (e) {}
                    }
                  }
                  resolve(result);
                } else {
                  resolve(result);
                }
              }
            });
          } catch (err) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(result);
            }
          }
        });
      }

      return result;
    },

    /**
     * Store a value in persistent storage.
     */
    async set(key, value) {
      if (isGM) {
        try {
          GM_setValue(key, value);
          return true;
        } catch (e) {
          console.error('[BESing Adapter] GM_setValue error:', e);
          return false;
        }
      }

      if (isExtension) {
        try {
          window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
        } catch (e) {}
        return new Promise((resolve) => {
          try {
            chrome.storage.local.set({ [key]: value }, () => {
              resolve(!chrome.runtime?.lastError);
            });
          } catch (e) {
            resolve(false);
          }
        });
      }

      // Web / LocalStorage fallback
      try {
        window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.error('[BESing Adapter] localStorage set error:', e);
        return false;
      }
    },

    /**
     * Remove a key from persistent storage.
     */
    async remove(key) {
      if (isGM) {
        try {
          if (typeof GM_deleteValue === 'function') {
            GM_deleteValue(key);
          } else {
            GM_setValue(key, undefined);
          }
          return true;
        } catch (e) {
          return false;
        }
      }

      if (isExtension) {
        return new Promise((resolve) => {
          chrome.storage.local.remove([key], () => {
            resolve(!chrome.runtime.lastError);
          });
        });
      }

      try {
        window.localStorage.removeItem(STORAGE_PREFIX + key);
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * Register a menu command (Userscript context menu or command).
     */
    registerMenuCommand(title, callback) {
      if (typeof GM_registerMenuCommand === 'function') {
        try {
          GM_registerMenuCommand(title, callback);
        } catch (e) {
          console.warn('[BESing Adapter] GM_registerMenuCommand failed:', e);
        }
      }
    }
  };
})();
