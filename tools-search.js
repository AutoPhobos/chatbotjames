// tools-search.js
// Keyless search with strict memory/context guardrails to prevent browser OOM crashes

const SEARXNG_INSTANCES = [
    'https://searx.be',
    'https://cursus.space',
    'https://search.inetwork.fr'
];

// Hard character limit to protect browser-local model context windows from OOM
const MAX_CONTENT_LENGTH = 6000;

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

    // ── 3. Safe Auto-Crawl with Strict Length Guardrails ─────────────────
    let fullPageText = searchSnippet;
    try {
        const crawlRes = await fetch(`https://r.jina.ai/${topUrl}`, {
            headers: {
                'Accept': 'text/plain',
                'X-Max-Tokens': '2000' // Instructs Jina Reader to trim response size
            }
        });

        if (crawlRes.ok) {
            let markdownText = await crawlRes.text();
            if (markdownText) {
                // Hard JavaScript safeguard: slice text if it exceeds browser safety limits
                if (markdownText.length > MAX_CONTENT_LENGTH) {
                    markdownText = markdownText.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated to protect local browser memory limits...]';
                }
                fullPageText = markdownText;
            }
        }
    } catch (e) {
        console.warn('Auto-crawl of top URL failed, using snippet fallback:', e);
    }

    return [{
        engine: 'SearXNG / Wikipedia + Guarded Crawler',
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