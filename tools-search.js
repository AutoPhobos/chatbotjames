// tools-search.js
// Keyless search implementation using public, CORS-friendly APIs (DuckDuckGo & Wikipedia)

export async function performWebSearch(query) {
    if (!query) {
        return [{ error: 'Search query cannot be empty.' }];
    }

    const results = [];
    const maxResults = 3;

    // ── 1. DuckDuckGo Instant Answer API (No key, CORS-friendly) ─────────
    try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
        const res = await fetch(ddgUrl);
        if (res.ok) {
            const data = await res.json();

            if (data.AbstractText && data.AbstractURL) {
                results.push({
                    engine: 'DuckDuckGo Instant Answer',
                    title: data.Heading || query,
                    url: data.AbstractURL,
                    snippet: data.AbstractText
                });
            }

            if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                for (const topic of data.RelatedTopics) {
                    if (topic.Text && topic.FirstURL && results.length < maxResults) {
                        results.push({
                            engine: 'DuckDuckGo Instant Answer',
                            title: topic.Text.split(' - ')[0] || 'Related Topic',
                            url: topic.FirstURL,
                            snippet: topic.Text
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.warn('DuckDuckGo Instant Answer fetch failed:', e);
    }

    if (results.length >= maxResults) {
        return results.slice(0, maxResults);
    }

    // ── 2. Wikipedia Search API (No key, completely open CORS) ───────────
    try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
        const res = await fetch(wikiUrl);
        if (res.ok) {
            const data = await res.json();
            if (data.query && data.query.search) {
                for (const item of data.query.search) {
                    if (results.length >= maxResults) break;
                    // Strip HTML formatting tags from Wikipedia snippets
                    const cleanSnippet = item.snippet ? item.snippet.replace(/<\/?[^>]+(>|$)/g, "") : '';
                    results.push({
                        engine: 'Wikipedia',
                        title: item.title,
                        url: `https://en.wikipedia.org/?curid=${item.pageid}`,
                        snippet: cleanSnippet
                    });
                }
            }
        }
    } catch (e) {
        console.warn('Wikipedia search fetch failed:', e);
    }

    if (results.length > 0) {
        return results;
    }

    return [{ error: 'No results found via keyless public APIs.' }];
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