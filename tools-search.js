// tools-search.js
// Handles web searching via CORS proxies with fallback logic.

const CORS_PROXIES = [
    'https://api.allorigins.win/get?url=',
    'https://corsproxy.io/?url='
];

async function fetchWithProxy(url) {
    let lastError;
    for (const proxy of CORS_PROXIES) {
        try {
            const targetUrl = proxy.includes('allorigins') ? encodeURIComponent(url) : encodeURIComponent(url);
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
            console.warn(`Proxy ${proxy} failed:`, err);
        }
    }
    throw lastError;
}

export async function performWebSearch(query) {
    const results = [];
    const maxResults = 3;

    // ── 1. Google Search ──────────────────────────────────────────────────
    try {
        const html = await fetchWithProxy(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // If CAPTCHA is hit, there are no search results.
        if (doc.body.textContent.includes('systems have detected unusual traffic')) {
            throw new Error('Google Captcha blocked the proxy');
        }

        // Google returns a basic mobile HTML layout to proxies usually
        let nodes = doc.querySelectorAll('div.g');
        if (nodes.length === 0) {
            nodes = Array.from(doc.querySelectorAll('div')).filter(el => el.querySelector('h3'));
        }

        for (const node of nodes) {
            const titleEl = node.querySelector('h3') || node.querySelector('.BNeawe.vvjwJb');
            const linkEl = node.querySelector('a');
            
            // Find the snippet text
            let snippetText = '';
            const snippetEls = node.querySelectorAll('.VwiC3b, .BNeawe.s3v9rd');
            if (snippetEls.length > 0) {
                snippetText = snippetEls[snippetEls.length - 1].textContent.trim();
            } else {
                // Fallback text extraction
                snippetText = node.textContent.replace(titleEl?.textContent || '', '').trim().substring(0, 200);
            }
            
            if (titleEl && linkEl && linkEl.getAttribute('href')) {
                let url = linkEl.getAttribute('href');
                if (url.startsWith('/url?q=')) {
                    url = new URL('https://google.com' + url).searchParams.get('q') || url;
                } else if (!url.startsWith('http')) {
                    continue; // Skip relative internal google links
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
        console.warn('Google search failed, falling back to DuckDuckGo', e);
    }

    // ── 2. DuckDuckGo Search (Lite) ───────────────────────────────────────
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
                    const nextRow = resultNodes[i+1];
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
        console.warn('DuckDuckGo search failed, falling back to Bing', e);
    }

    // ── 3. Bing Search ────────────────────────────────────────────────────
    try {
        const html = await fetchWithProxy(`https://www.bing.com/search?q=${encodeURIComponent(query)}`);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const nodes = doc.querySelectorAll('.b_algo');
        for (const node of nodes) {
            const titleEl = node.querySelector('h2 a');
            const snippetEl = node.querySelector('.b_caption p') || node.querySelector('.b_algoSlug');
            
            if (titleEl && titleEl.href) {
                results.push({
                    engine: 'Bing',
                    title: titleEl.textContent.trim(),
                    url: titleEl.href,
                    snippet: snippetEl ? snippetEl.textContent.trim() : ''
                });
                if (results.length >= maxResults) break;
            }
        }
        
        if (results.length > 0) return results;
    } catch (e) {
        console.warn('Bing search failed', e);
    }

    if (results.length === 0) {
        return [{ error: 'All search engines failed or blocked requests.' }];
    }
}
