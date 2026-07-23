// tools-search.js
// Keyless search using DuckDuckGo/Wikipedia + automatic page crawling via Jina Reader

export async function performWebSearch(query) {
    if (!query) {
        return [{ error: 'Search query cannot be empty.' }];
    }

    let topUrl = null;
    let searchTitle = '';
    let searchSnippet = '';

    // ── 1. Get Top Search Result URL (DuckDuckGo Instant Answer API) ─────
    try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
        const res = await fetch(ddgUrl);
        if (res.ok) {
            const data = await res.json();
            
            if (data.AbstractText && data.AbstractURL) {
                searchTitle = data.Heading || query;
                topUrl = data.AbstractURL;
                searchSnippet = data.AbstractText;
            } else if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                for (const topic of data.RelatedTopics) {
                    if (topic.Text && topic.FirstURL) {
                        searchTitle = topic.Text.split(' - ')[0] || 'Result';
                        topUrl = topic.FirstURL;
                        searchSnippet = topic.Text;
                        break;
                    }
                }
            }
        }
    } catch (e) {
        console.warn('DuckDuckGo API failed:', e);
    }

    // Fallback to Wikipedia search if DDG didn't yield a direct URL
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

    // ── 2. Auto-Crawl the First Page (Extract Large Texts via Jina Reader) ─
    let fullPageText = searchSnippet;
    try {
        // Prepending r.jina.ai/ bypasses browser CORS restrictions and extracts clean body text
        const crawlRes = await fetch(`https://r.jina.ai/${topUrl}`, {
            headers: {
                'Accept': 'text/plain'
            }
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
        engine: 'DuckDuckGo + Auto-Crawler',
        title: searchTitle,
        url: topUrl,
        snippet: searchSnippet,
        fullContent: fullPageText // Contains the full extracted text of the first page
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