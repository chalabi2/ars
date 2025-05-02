export const GRAPHCACHE_PROVIDERS = [
  // { name: "bus's indexer", url: 'https://ambindexer.bus.bz/gcgo/' }, // it's like >2M RPC requests per day wtf
  {
    name: "Official",
    urls: {
      1: "https://ambindexer.net/gcgo/",
      5: "https://ambindexer.net/gcgo/",
      11155111: "https://ambindexer.net/gcgo-testnet/",
      7700: "https://ambient.plexnode.wtf/gcgo/",
      42161: "https://ambindexer.net/gcgo/",
      81457: "https://ambindexer.net/blast-gcgo/",
      421613: "https://ambindexer.net/scroll-gcgo/",
      534351: "https://ambindexer.net/gcgo/",
      534352: "https://ambindexer.net/scroll-gcgo/",
      168587773: "https://ambindexer.net/gcgo-testnet/",
      12345: "http://localhost:8080/gcgo/",
    },
  },
];

export class GraphcacheProvider {
  constructor() {
    this.selected_provider_index = 0;
  }

  async user_balance_tokens(address, chainId) {
    if (chainId === "12345") {
      return [];
    }

    const req = `user_balance_tokens?user=${address}&chainId=${chainId}`;
    return await this.sendRequest(req, chainId);
  }

  async user_positions(address, chainId) {
    const req = `user_positions?user=${address}&chainId=${chainId}&omitEmpty=true`;
    return await this.sendRequest(req, chainId);
  }

  async sendRequest(req, chainId, full = false) {
    let err = null;
    for (const i in GRAPHCACHE_PROVIDERS) {
      const provider = GRAPHCACHE_PROVIDERS[this.selected_provider_index];
      const chainUrl = provider.urls[parseInt(chainId)];
      const url = new URL(chainUrl + req);

      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 5000);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          signal: abort.signal,
        }).catch((e) => {
          throw new Error(`Network error: ${e.message}`);
        });

        clearTimeout(timeout); // Clear timeout if fetch succeeds

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const text = await response.text(); // Get response as text first
        if (!text) {
          throw new Error("Empty response received");
        }

        const resp = JSON.parse(text); // Parse the text to JSON

        if (resp.error) {
          throw resp.error;
        }
        return full ? resp : resp.data;
      } catch (e) {
        err = e;
        console.error("graphcache fetch error", e);
        this.selected_provider_index =
          (this.selected_provider_index + 1) % GRAPHCACHE_PROVIDERS.length;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    console.error("ran out of providers, throwing");
    throw err;
  }
}
