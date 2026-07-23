// tools-search.js
// Keyless general web search using public SearXNG JSON APIs + Wikipedia + Jina Reader crawling

const SEARXNG_INSTANCES = [
    'https://searx.be',
    'https://cursus.space',
    'https://search.inetwork.fr'
];

export async function performWebSearch(query) {
    if (!query) {
        return [{ error: 'Search query cannot be empty.' }];
    }

    let topUrl = null;
    let searchTitle = '';
    let searchSnippet = '';

    // ── 1. General Web Search via Public SearXNG JSON API ────────────────
    for (const instance of SEARXNG_INSTANCES) {
        try {
            const searchUrl = `${instance}/search?q=${encodeURIComponent(query)}&format=json`;
            const res = await fetch(searchUrl, {
                headers: { 'Accept': 'application/json' }
            });

            if (res.ok) {
                const data = await res.json();
                if (data.results && data.results.length > 0) {
                    const topResult = data.results[0];
                    searchTitle = topResult.title || query;
                    topUrl = topResult.url;
                    searchSnippet = topResult.content || topResult.snippet || '';
                    break;
                }
            }
        } catch (e) {
            console.warn(`SearXNG instance ${instance} failed:`, e);
        }
    }

    // ── 2. Fallback to Wikipedia API if SearXNG instances fail ────────────
    if (!topUrl) {
        try {
            const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
            const res = await fetch(wikiUrl);
            if (res.ok) {
                const data = await res.json();
                if (data.query && data.query.search && data.query.search.length > 0) {
                    const item = data.query.search[0];
                    searchTitle = item.title;
                    topUrl = `https://en.wikipedia.org/?curid=${item.pageid}`;
                    searchSnippet = item.snippet ? item.snippet.replace(/<\/?[^>]+(>|$)/g, "") : '';
                }
            }
        } catch (e) {
            console.warn('Wikipedia search fallback failed:', e);
        }
    }

    if (!topUrl) {
        return [{ error: 'No search results found to crawl.' }];
    }

    // ── 3. Auto-Crawl the First Page (Extract Large Texts via Jina Reader) ─
    let fullPageText = searchSnippet;
    try {
        const crawlRes = await fetch(`https://r.jina.ai/${topUrl}`, {
            headers: { 'Accept': 'text/plain' }
        });
        if (crawlRes.ok) {
            const markdownText = await crawlRes.text();
            if (markdownText && markdownText.length > searchSnippet.length) {
                fullPageText = markdownText;
            }
        }
    } catch (e) {
        console.warn('Auto-crawl of top URL failed, using snippet fallback:', e);
    }

    return [{
        engine: 'SearXNG / Wikipedia + Auto-Crawler',
        title: searchTitle,
        url: topUrl,
        snippet: searchSnippet,
        fullContent: fullPageText
    }];
}

/**
 * Unified tool runner wrapper.
 */
export async function executeSearch(query) {
    try {
        const results = await performWebSearch(query);
        const hasError = results && results.length > 0 && results[0].error;
        return {
            success: !hasError,
            results: hasError ? [] : results,
            error: hasError ? results[0].error : null
        };
    } catch (error) {
        return {
            success: false,
            results: [],
            error: error.message || 'Search operation failed.'
        };
    }
}