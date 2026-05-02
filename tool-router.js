// ── Currency name → ISO code ──────────────────────────────────────────────────
const CURRENCY_MAP = {
    dollar: 'USD', dollars: 'USD', usd: 'USD', buck: 'USD', bucks: 'USD',
    euro: 'EUR', euros: 'EUR', eur: 'EUR',
    pound: 'GBP', pounds: 'GBP', gbp: 'GBP', sterling: 'GBP',
    yen: 'JPY', jpy: 'JPY',
    shekel: 'ILS', shekels: 'ILS', ils: 'ILS', nis: 'ILS',
    franc: 'CHF', francs: 'CHF', chf: 'CHF',
    won: 'KRW', krw: 'KRW',
    ruble: 'RUB', rubles: 'RUB', rub: 'RUB',
    rupee: 'INR', rupees: 'INR', inr: 'INR',
    yuan: 'CNY', cny: 'CNY', renminbi: 'CNY',
    cad: 'CAD', aud: 'AUD',
    real: 'BRL', reais: 'BRL', brl: 'BRL',
    peso: 'MXN', mxn: 'MXN',
    dirham: 'AED', aed: 'AED',
    lira: 'TRY', try: 'TRY',
    krona: 'SEK', sek: 'SEK', krone: 'DKK', dkk: 'DKK', nok: 'NOK',
};

function resolveCurrency(str) {
    const key = str.trim().toLowerCase();
    return CURRENCY_MAP[key] || str.trim().toUpperCase();
}

// ── City → IANA timezone ──────────────────────────────────────────────────────
const TIMEZONE_MAP = {
    'new york': 'America/New_York', 'nyc': 'America/New_York',
    'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles',
    'chicago': 'America/Chicago', 'toronto': 'America/Toronto',
    'sao paulo': 'America/Sao_Paulo', 'brazil': 'America/Sao_Paulo',
    'mexico city': 'America/Mexico_City', 'mexico': 'America/Mexico_City',
    'london': 'Europe/London', 'uk': 'Europe/London',
    'paris': 'Europe/Paris', 'france': 'Europe/Paris',
    'berlin': 'Europe/Berlin', 'germany': 'Europe/Berlin',
    'madrid': 'Europe/Madrid', 'rome': 'Europe/Rome',
    'moscow': 'Europe/Moscow', 'russia': 'Europe/Moscow',
    'dubai': 'Asia/Dubai', 'uae': 'Asia/Dubai',
    'tel aviv': 'Asia/Jerusalem', 'israel': 'Asia/Jerusalem', 'jerusalem': 'Asia/Jerusalem',
    'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'india': 'Asia/Kolkata',
    'tokyo': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
    'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
    'hong kong': 'Asia/Hong_Kong', 'singapore': 'Asia/Singapore',
    'seoul': 'Asia/Seoul', 'korea': 'Asia/Seoul',
    'sydney': 'Australia/Sydney', 'australia': 'Australia/Sydney',
    'auckland': 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland',
    'cairo': 'Africa/Cairo', 'nairobi': 'Africa/Nairobi',
    'johannesburg': 'Africa/Johannesburg', 'south africa': 'Africa/Johannesburg',
};

function resolveTimezone(location) {
    return TIMEZONE_MAP[location.toLowerCase().trim()] || location.trim();
}

function cleanTail(str) {
    return str.replace(/[?!.,]+$/, '').trim();
}

// ── Rule table ────────────────────────────────────────────────────────────────
const RULES = [

    // WEATHER
    {
        tool: 'weather',
        patterns: [
            /(?:what(?:'s| is)(?: the)?) weather(?: like)? (?:in|at|for) (.+)/i,
            /weather (?:in|at|for) (.+)/i,
            /(?:forecast|temperature|temp) (?:in|at|for) (.+)/i,
            /how(?:'s| is) (?:the )?weather (?:in|at) (.+)/i,
            /(?:is it|will it be) (?:rain|snow|cold|hot|warm)\w* (?:in|at) (.+)/i,
        ],
        params: m => ({ location: cleanTail(m[1]) }),
    },

    // TIME (with location)
    {
        tool: 'time',
        patterns: [
            /(?:what(?:'s| is)(?: the)?) (?:local )?time (?:in|at) (.+)/i,
            /what time is it (?:in|at|over in) (.+)/i,
            /current time (?:in|at) (.+)/i,
        ],
        params: m => ({ timezone: resolveTimezone(cleanTail(m[1])) }),
    },

    // DATE / current time (no location)
    {
        tool: 'date',
        patterns: [
            /^(?:what(?:'s| is)(?: the)?) (?:date|day)(?: today)?\??$/i,
            /^today(?:'s)? date\??$/i,
            /^current date\??$/i,
            /^what day is (?:it|today)\??$/i,
            /^what time is it\??$/i,
        ],
        params: () => ({ action: 'now' }),
    },

    // CURRENCY
    {
        tool: 'currency',
        patterns: [
            /(?:how much is |convert )?(\d+(?:[.,]\d+)?)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]+)?)\s+(?:in|to|into)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]+)?)/i,
        ],
        params: m => ({
            amount: parseFloat(m[1].replace(',', '.')),
            from: resolveCurrency(m[2]),
            to: resolveCurrency(m[3]),
        }),
    },

    // UUID
    {
        tool: 'uuid',
        patterns: [
            /(?:generate|create|make|give me)(?: (\d+))? uuids?/i,
            /^(\d+) uuids?$/i,
            /^random uuids?$/i,
        ],
        params: m => ({ count: Math.min(parseInt(m[1] || m[2] || '1') || 1, 10) }),
    },

    // PASSWORD
    {
        tool: 'password',
        patterns: [
            /(?:generate|create|make|give me)(?: a)? (?:secure |random )?passwords?/i,
            /^random password$/i,
        ],
        params: m => {
            const len = (m[0].match(/(\d+)\s*(?:char|character|length|long)/i) || [])[1];
            return { length: len ? parseInt(len) : 16, count: 1, symbols: !/no symbols?/i.test(m[0]) };
        },
    },

    // TIMER
    {
        tool: 'timer',
        patterns: [
            /(?:set|start|create)(?: a)? timer (?:for )?(\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min|second|sec)\b/i,
        ],
        params: m => {
            const v = parseFloat(m[1]), u = m[2].toLowerCase();
            const s = /^h/.test(u) ? v * 3600 : /^m/.test(u) ? v * 60 : v;
            return { seconds: Math.round(s), label: `Timer (${m[1]} ${m[2]})` };
        },
    },

    // LOCATION
    {
        tool: 'location',
        patterns: [
            /^(?:where am i|my location|current location|locate me|find my location)\??$/i,
        ],
        params: () => ({}),
    },

    // CLIPBOARD
    {
        tool: 'clipboard',
        patterns: [
            /^(?:read|get|check|show)(?: me)?(?: my)? clipboard\??$/i,
            /^what(?:'s| is) in(?: my)? clipboard\??$/i,
            /^clipboard\??$/i,
        ],
        params: () => ({}),
    },

    // WEB SEARCH (DuckDuckGo fallback)
    {
        tool: 'websearch',
        patterns: [
            /^(?:search for|look up|google|search) (.+)/i,
        ],
        params: m => ({ query: cleanTail(m[1]) }),
    },

    // WIKIPEDIA — last, most general
    {
        tool: 'wikipedia',
        patterns: [
            /^(?:tell me about|explain|define) (.+)/i,
            /^(?:wiki|wikipedia)(?::| for| about)? (.+)/i,
            /^(?:what|who) (?:is|are|was|were) (?!your|this|that|it\b)(.+)/i,
        ],
        params: m => ({ query: cleanTail(m[1]) }),
    },
];

export class ToolTriggerHandler {
    match(input) {
        const text = input.trim();
        for (const rule of RULES) {
            for (const pattern of rule.patterns) {
                const m = text.match(pattern);
                if (m) {
                    try {
                        return { tool: rule.tool, params: rule.params(m) };
                    } catch (e) {
                        console.warn('ToolTriggerHandler param error:', e);
                    }
                }
            }
        }
        return null;
    }
}

export const toolRouter = new ToolTriggerHandler();
