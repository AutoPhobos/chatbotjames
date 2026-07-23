// tools-search.js
// Handles web searching via CORS proxies with robust fallback and API logic.

const CORS_PROXIES = [
    'https://api.allorigins.win/get?url=',
    'https://corsproxy.io/?url='
];

async function fetchWithProxy(url) {
    let lastError;
    for (const proxy of CORS_PROXIES) {
        try {
            const targetUrl = encodeURIComponent(url);
            const res = await fetch(proxy + targetUrl);
            if (!res.ok) throw new Error(`Proxy error: ${res.status}`);

            if (proxy.includes('allorigins')) {
                const data = await res.json();
                if (!data.contents) throw new Error('No contents from allorigins');
                return data.contents;
            } else {
                return await res.text();
            }
        } catch (err) {
            lastError = err;
            console.warn(`Proxy ${proxy} failed for URL ${url}:`, err);
        }
    }
    throw lastError;
}

export async function performWebSearch(query) {
    const results = [];
    const maxResults = 3;

    if (!query) {
        return [{ error: 'Search query cannot be empty.' }];
    }

    // ── 1. DuckDuckGo Lite (HTML via Proxy) ───────────────────────────────
    try {
        const html = await fetchWithProxy(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const resultNodes = doc.querySelectorAll('tr');
        for (let i = 0; i < resultNodes.length; i++) {
            const row = resultNodes[i];
            const titleEl = row.querySelector('.result-title');

            if (titleEl && titleEl.href) {
                let snippet = '';
                if (i + 1 < resultNodes.length) {
                    const nextRow = resultNodes[i + 1];
                    const snippetEl = nextRow.querySelector('.result-snippet');
                    if (snippetEl) snippet = snippetEl.textContent.trim();
                }

                results.push({
                    engine: 'DuckDuckGo',
                    title: titleEl.textContent.trim(),
                    url: titleEl.href,
                    snippet: snippet
                });
                if (results.length >= maxResults) break;
            }
        }

        if (results.length > 0) return results;
    } catch (e) {
        console.warn('DuckDuckGo Lite search failed, trying API fallback', e);
    }

    // ── 2. DuckDuckGo Instant Answer API (Direct JSON, no proxy needed) ───
    try {
        const apiRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
        if (apiRes.ok) {
            const data = await apiRes.json();
            if (data.Heading && data.Abstract) {
                results.push({
                    engine: 'DuckDuckGo API',
                    title: data.Heading,
                    url: data.AbstractURL || 'https://duckduckgo.com',
                    snippet: data.Abstract
                });
            }
            if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                for (const topic of data.RelatedTopics) {
                    if (topic.Text && topic.FirstURL) {
                        results.push({
                            engine: 'DuckDuckGo API',
                            title: topic.Text.split(' - ')[0] || 'Result',
                            url: topic.FirstURL,
                            snippet: topic.Text
                        });
                        if (results.length >= maxResults) break;
                    }
                }
            }
        }
        if (results.length > 0) return results;
    } catch (e) {
        console.warn('DuckDuckGo API fallback failed', e);
    }

    // ── 3. Google Search (HTML via Proxy) ─────────────────────────────────
    try {
        const html = await fetchWithProxy(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        if (doc.body.textContent.includes('systems have detected unusual traffic')) {
            throw new Error('Google Captcha blocked the proxy');
        }

        let nodes = doc.querySelectorAll('div.g');
        if (nodes.length === 0) {
            nodes = Array.from(doc.querySelectorAll('div')).filter(el => el.querySelector('h3'));
        }

        for (const node of nodes) {
            const titleEl = node.querySelector('h3') || node.querySelector('.BNeawe.vvjwJb');
            const linkEl = node.querySelector('a');

            let snippetText = '';
            const snippetEls = node.querySelectorAll('.VwiC3b, .BNeawe.s3v9rd');
            if (snippetEls.length > 0) {
                snippetText = snippetEls[snippetEls.length - 1].textContent.trim();
            } else {
                snippetText = node.textContent.replace(titleEl?.textContent || '', '').trim().substring(0, 200);
            }

            if (titleEl && linkEl && linkEl.getAttribute('href')) {
                let url = linkEl.getAttribute('href');
                if (url.startsWith('/url?q=')) {
                    url = new URL('https://google.com' + url).searchParams.get('q') || url;
                } else if (!url.startsWith('http')) {
                    continue;
                }

                results.push({
                    engine: 'Google',
                    title: titleEl.textContent.trim(),
                    url: url,
                    snippet: snippetText
                });
                if (results.length >= maxResults) break;
            }
        }

        if (results.length > 0) return results;
    } catch (e) {
        console.warn('Google search failed', e);
    }

    return [{ error: 'All search engines failed or blocked requests.' }];
}

// Unified alias to support both executeSearch and performWebSearch calls seamlessly
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