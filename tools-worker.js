import { create as oramaCreate, insert as oramaInsert, search as oramaSearch } from './orama.js';

// tools-worker.js — handles all non-Python tool execution for JAMES
// Each tool is invoked via a tagged block: ```tool:run {"tool":"name","params":{...}}```

let oramaIndex = null;
const oramaSeedDocs = [
    {
        id: 'JAMES-overview',
        content: 'JAMES is a browser-native AI assistant that runs locally in the browser. It can execute tool calls, stream responses, and maintain private conversation state.'
    },
    {
        id: 'JAMES-tools',
        content: 'JAMES includes weather, wikipedia, currency, time, uuid, password, palette, date, file, location, clipboard, timer, search, and python tools.'
    },
    {
        id: 'JAMES-architecture',
        content: 'The app uses a main thread UI, a model worker for inference, a tools worker for external calls, and optional Python execution via Pyodide.'
    }
];

async function ensureOramaIndex() {
    if (oramaIndex) return;
    oramaIndex = await oramaCreate({
        schema: {
            id: 'string',
            content: 'string'
        }
    });

    for (const doc of oramaSeedDocs) {
        await oramaInsert(oramaIndex, doc);
    }
}

async function searchIndex(params) {
    await ensureOramaIndex();
    const { query, topK = 3 } = params;
    return await oramaSearch(oramaIndex, { term: query, limit: topK });
}

async function indexDocument(params) {
    await ensureOramaIndex();
    const { id, content } = params;
    if (!id || !content) throw new Error('Missing id or content');
    await oramaInsert(oramaIndex, { id, content });
    return { id, inserted: true };
}

// ── Weather (Open-Meteo, no key needed) ───────────────────────────────────
async function getWeather(params) {
    const { location } = params;

    // Geocode location name → lat/lon
    const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&format=json`
    );
    const geoData = await geoRes.json();
    if (!geoData.results?.length) throw new Error(`Location not found: ${location}`);

    const { latitude, longitude, name, country } = geoData.results[0];

    const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
        `&hourly=temperature_2m&forecast_days=1&timezone=auto`
    );
    const w = await weatherRes.json();
    const c = w.current;

    const codes = {
        0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
        45:'Foggy',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
        61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',
        80:'Rain showers',81:'Heavy showers',82:'Violent showers',95:'Thunderstorm'
    };

    return {
        location: `${name}, ${country}`,
        temperature: `${c.temperature_2m}°C`,
        humidity: `${c.relative_humidity_2m}%`,
        wind: `${c.wind_speed_10m} km/h`,
        condition: codes[c.weather_code] ?? `Code ${c.weather_code}`
    };
}

// ── Web Search (DuckDuckGo fallback) ──────────────────────────────────────
async function getWebSearch(params) {
    const { query } = params;
    return {
        query,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
    };
}

// ── Wikipedia summary ─────────────────────────────────────────────────────
async function getWikipedia(params) {
    const { query } = params;
    const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`
    );
    if (!res.ok) {
        return {
            type: 'fallback',
            query,
            url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
        };
    }
    const data = await res.json();
    return {
        type: 'wiki',
        title: data.title,
        summary: data.extract,
        url: data.content_urls?.desktop?.page ?? ''
    };
}

// ── Currency exchange (frankfurter.app, no key) ───────────────────────────
async function getCurrency(params) {
    const { from, to, amount = 1 } = params;
    const fromCode = from.toUpperCase();
    const toCode = to.toUpperCase();

    // Same-currency shortcut — frankfurter excludes the base from its rates object
    if (fromCode === toCode) {
        const amt = parseFloat(amount);
        return { from: fromCode, to: toCode, rate: 1, amount: amt, converted: amt.toFixed(2) };
    }

    const res = await fetch(
        `https://api.frankfurter.dev/v1/latest?base=${fromCode}&symbols=${toCode}`,
        { cache: 'no-store' }
    );
    if (!res.ok) {
        const text = await res.text().catch(() => String(res.status));
        throw new Error(`Currency API error (${res.status}): ${text}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(`Currency error: ${data.error}`);
    const rate = data.rates[toCode];
    if (!rate) throw new Error(`No rate found for ${fromCode} → ${toCode}`);
    return {
        from: fromCode,
        to: toCode,
        rate,
        amount: parseFloat(amount),
        converted: (parseFloat(amount) * rate).toFixed(2)
    };
}

// ── World time (Native Browser API) ───────────────────────────────────────
async function getTime(params) {
    const { timezone } = params;
    try {
        const d = new Date();
        const timeString = d.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
        const dateString = d.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        
        return {
            timezone,
            time: timeString,
            date: dateString
        };
    } catch (e) {
        throw new Error(`Unknown timezone: ${timezone}`);
    }
}

// ── UUID generator ────────────────────────────────────────────────────────
function generateUUID(params) {
    const count = Math.min(parseInt(params?.count ?? 1), 20);
    const uuids = [];
    for (let i = 0; i < count; i++) {
        uuids.push(crypto.randomUUID());
    }
    return { uuids };
}

// ── Password generator ────────────────────────────────────────────────────
function generatePassword(params) {
    const length = Math.min(parseInt(params?.length ?? 16), 128);
    const count = Math.min(parseInt(params?.count ?? 1), 10);
    const upper = params?.uppercase !== false;
    const numbers = params?.numbers !== false;
    const symbols = params?.symbols !== false;

    let chars = 'abcdefghijklmnopqrstuvwxyz';
    if (upper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (numbers) chars += '0123456789';
    if (symbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    const passwords = [];
    for (let p = 0; p < count; p++) {
        const arr = new Uint32Array(length);
        crypto.getRandomValues(arr);
        passwords.push(Array.from(arr).map(v => chars[v % chars.length]).join(''));
    }
    return { passwords, length, strength: length >= 16 && symbols ? 'Strong' : length >= 12 ? 'Medium' : 'Weak' };
}

// ── Color palette generator ───────────────────────────────────────────────
function generatePalette(params) {
    const { base = '#3498db', scheme = 'complementary', count = 5 } = params;

    function hexToHsl(hex) {
        // Ensure valid 6-char hex
        const clean = (hex || '#3498db').replace(/^#/, '');
        const full = clean.length === 3
            ? clean.split('').map(c => c + c).join('')
            : clean.padEnd(6, '0');
        let r = parseInt(full.slice(0,2),16)/255;
        let g = parseInt(full.slice(2,4),16)/255;
        let b = parseInt(full.slice(4,6),16)/255;
        const max = Math.max(r,g,b), min = Math.min(r,g,b);
        let h = 0, s = 0, l = (max+min)/2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d/(2-max-min) : d/(max+min);
            switch(max) {
                case r: h = ((g-b)/d + (g<b?6:0))/6; break;
                case g: h = ((b-r)/d + 2)/6; break;
                case b: h = ((r-g)/d + 4)/6; break;
            }
        }
        return [Math.round(h*360), Math.round(s*100), Math.round(l*100)];
    }

    function hslToHex(h, s, l) {
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1-l);
        const f = n => { const k=(n+h/30)%12; return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))); };
        return '#' + [f(0),f(8),f(4)].map(v=>v.toString(16).padStart(2,'0')).join('');
    }

    const [h, s, l] = hexToHsl(base);
    const colors = [];
    const n = Math.max(1, parseInt(count));

    if (scheme === 'analogous') {
        for (let i = 0; i < n; i++) colors.push(hslToHex((h + i*30) % 360, s, l));
    } else if (scheme === 'monochromatic') {
        // Guard divide-by-zero when n=1
        const step = n > 1 ? 60 / (n - 1) : 0;
        for (let i = 0; i < n; i++) colors.push(hslToHex(h, s, Math.max(10, Math.min(90, l - 30 + i * step))));
    } else if (scheme === 'triadic') {
        colors.push(hslToHex(h,s,l), hslToHex((h+120)%360,s,l), hslToHex((h+240)%360,s,l));
    } else {
        // complementary
        for (let i = 0; i < n; i++) {
            colors.push(i % 2 === 0 ? hslToHex(h, s, Math.max(20, l - 10 + i*5)) : hslToHex((h+180)%360, s, l));
        }
    }

    return { base, scheme, colors };
}

// ── Date/time tools ───────────────────────────────────────────────────────
function dateTool(params) {
    const { action, date, from_tz, to_tz, date2 } = params;

    if (action === 'now') {
        const now = new Date();
        return {
            iso: now.toISOString(),
            local: now.toLocaleString(),
            unix: Math.floor(now.getTime() / 1000),
            utc: now.toUTCString()
        };
    }

    if (action === 'diff') {
        const d1 = new Date(date);
        const d2 = new Date(date2);
        const diffMs = Math.abs(d2 - d1);
        const days = Math.floor(diffMs / 86400000);
        const hours = Math.floor((diffMs % 86400000) / 3600000);
        const minutes = Math.floor((diffMs % 3600000) / 60000);
        return { from: date, to: date2, days, hours, minutes, total_ms: diffMs };
    }

    if (action === 'convert') {
        const d = new Date(date);
        return {
            input: date,
            from_tz: from_tz ?? 'local',
            to_tz: to_tz ?? 'UTC',
            result: d.toLocaleString('en-US', { timeZone: to_tz ?? 'UTC' })
        };
    }

    if (action === 'parse') {
        const d = new Date(date);
        if (isNaN(d)) throw new Error(`Cannot parse date: ${date}`);
        return {
            input: date,
            iso: d.toISOString(),
            unix: Math.floor(d.getTime()/1000),
            day: d.toLocaleDateString('en-US', { weekday: 'long' }),
            formatted: d.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
        };
    }

    throw new Error(`Unknown date action: ${action}`);
}

// ── File reader (handles text passed from main thread) ────────────────────
function readFile(params) {
    // File content is passed directly as base64 or text from the main thread
    const { content, filename, encoding = 'text' } = params;
    if (!content) throw new Error('No file content provided');

    const lines = content.split('\n').length;
    const words = content.split(/\s+/).filter(Boolean).length;
    const chars = content.length;

    return {
        filename: filename ?? 'unknown',
        lines,
        words,
        characters: chars,
        preview: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
        full_content: content
    };
}

// ── Geolocation (uses coords passed from main thread) ─────────────────────
function getLocation(params) {
    // Coords are passed from the main thread since workers can't access navigator
    const { latitude, longitude, accuracy } = params;
    if (latitude == null) throw new Error('Location not available or not yet fetched');
    return { latitude, longitude, accuracy: `${Math.round(accuracy)}m` };
}

// ── Clipboard (content passed from main thread) ───────────────────────────
function readClipboard(params) {
    const { content } = params;
    if (!content) throw new Error('Clipboard is empty or access was denied');
    return { content, length: content.length };
}

// ── Timer/countdown ───────────────────────────────────────────────────────
function timerTool(params) {
    const { seconds, label } = params;
    const s = Math.max(1, parseInt(seconds ?? 0));
    // Signal the main thread to show the countdown widget via the bridge listener
    self.postMessage({ status: 'timer', seconds: s, label: label ?? 'Timer' });
    return {
        seconds: s,
        label: label ?? 'Timer',
        note: 'Timer started.'
    };
}

// ── Main message handler ──────────────────────────────────────────────────
self.onmessage = async (e) => {
    const { execId, tool, params } = e.data;

    try {
        let result;

        switch (tool) {
            case 'weather':    result = await getWeather(params); break;
            case 'websearch':  result = await getWebSearch(params); break;
            case 'wikipedia':  result = await getWikipedia(params); break;
            case 'currency':   result = await getCurrency(params); break;
            case 'time':       result = await getTime(params); break;
            case 'uuid':       result = generateUUID(params); break;
            case 'password':   result = generatePassword(params); break;
            case 'palette':    result = generatePalette(params); break;
            case 'date':       result = dateTool(params); break;
            case 'file':       result = readFile(params); break;
            case 'location':   result = getLocation(params); break;
            case 'clipboard':  result = readClipboard(params); break;
            case 'timer':      result = timerTool(params); break;
            case 'search':     result = await searchIndex(params); break;
            case 'index':      result = await indexDocument(params); break;
            default: throw new Error(`Unknown tool: ${tool}`);
        }

        self.postMessage({ status: 'done', result, execId });

    } catch (err) {
        self.postMessage({ status: 'error', error: err.message, execId });
    }
};