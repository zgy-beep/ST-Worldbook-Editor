/** Resolve helper capabilities at call time, so enabling/updating it needs no reload. */
export function createWorldbookApi(getHelper) {
  function helper() {
    const api = getHelper();
    if (!api || typeof api !== 'object') throw new Error('请安装并启用酒馆助手后重试');
    return api;
  }
  function call(api, names, ...args) {
    const name = names.find(key => typeof api[key] === 'function');
    if (!name) throw new Error(`酒馆助手缺少 ${names.join(' / ')} 接口，请启用或更新酒馆助手`);
    return api[name](...args);
  }
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function mergeEntry(current, patch) {
    const merged = { ...current, ...patch };
    if (isObject(patch.strategy)) {
      merged.strategy = { ...current.strategy, ...patch.strategy };
      if (isObject(patch.strategy.keys_secondary)) {
        merged.strategy.keys_secondary = { ...current.strategy?.keys_secondary, ...patch.strategy.keys_secondary };
      }
    }
    if (isObject(patch.position)) merged.position = { ...current.position, ...patch.position };
    return merged;
  }
  return {
    async getBooks() { const api = helper(); return call(api, ['getWorldbookNames', 'getLorebooks']); },
    async getEntries(book) {
      if (!book) return [];
      const api = helper(); return call(api, ['getWorldbook', 'getLorebookEntries'], book);
    },
    async setEntries(book, patches) {
      const api = helper();
      if (typeof api.getWorldbook === 'function') {
        return call(api, ['updateWorldbookWith'], book, current => {
          const byId = new Map(patches.map(patch => [String(patch.uid), patch]));
          for (const uid of byId.keys()) {
            if (!current.some(entry => String(entry.uid) === uid)) throw new Error(`条目 ${uid} 已不存在，请重新载入世界书`);
          }
          return current.map(entry => byId.has(String(entry.uid)) ? mergeEntry(entry, byId.get(String(entry.uid))) : entry);
        });
      }
      return call(api, ['setLorebookEntries'], book, patches);
    },
    async createEntries(book, entries) {
      const api = helper(); return call(api, ['createWorldbookEntries', 'createLorebookEntries'], book, entries);
    },
    async deleteEntries(book, uids) {
      const api = helper();
      const ids = new Set(uids.map(String));
      if (typeof api.deleteWorldbookEntries === 'function') return api.deleteWorldbookEntries(book, entry => ids.has(String(entry.uid)));
      return call(api, ['deleteLorebookEntries'], book, uids);
    },
    async createBook(name) { const api = helper(); return call(api, ['createWorldbook', 'createLorebook'], name); },
    async deleteBook(name) { const api = helper(); return call(api, ['deleteWorldbook', 'deleteLorebook'], name); },
  };
}
