/**
 * Simple in-memory TTL cache.
 * Each namespace has its own max size to prevent unbounded growth.
 */

const stores = {};

const DEFAULTS = {
    search:   { ttl: 15 * 60 * 1000, max: 100 },  // 15 min, max 100 entries
    catalog:  { ttl: 30 * 60 * 1000, max: 50 },    // 30 min
    streams:  { ttl: 2 * 60 * 60 * 1000, max: 200 }, // 2h
    cinemeta: { ttl: 24 * 60 * 60 * 1000, max: 500 }, // 24h
    resolved: { ttl: 30 * 60 * 1000, max: 300 },      // 30 min
    meta:     { ttl: 2 * 60 * 60 * 1000, max: 200 },    // 2h
    pageurl:  { ttl: 2 * 60 * 60 * 1000, max: 200 },    // 2h
    tmdbid:   { ttl: 24 * 60 * 60 * 1000, max: 500 },   // 24h
};

function getStore(namespace) {
    if (!stores[namespace]) {
        stores[namespace] = new Map();
    }
    return stores[namespace];
}

function getConfig(namespace) {
    return DEFAULTS[namespace] || { ttl: 15 * 60 * 1000, max: 100 };
}

function get(namespace, key) {
    const store = getStore(namespace);
    const entry = store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expires) {
        store.delete(key);
        return undefined;
    }

    return entry.value;
}

function set(namespace, key, value) {
    const store = getStore(namespace);
    const config = getConfig(namespace);

    // Evict oldest entries if at capacity
    if (store.size >= config.max) {
        const firstKey = store.keys().next().value;
        store.delete(firstKey);
    }

    store.set(key, {
        value,
        expires: Date.now() + config.ttl,
    });
}

function stats() {
    const result = {};
    for (const [ns, store] of Object.entries(stores)) {
        result[ns] = store.size;
    }
    return result;
}

module.exports = { get, set, stats };
