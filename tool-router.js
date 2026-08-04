// ─────────────────────────────────────────────────────────────────────────────
//  ToolTriggerHandler  (enhanced)
// ─────────────────────────────────────────────────────────────────────────────

// ── Currency symbol + name → ISO code ────────────────────────────────────────
const CURRENCY_MAP = {
    // Symbols
    '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₪': 'ILS',
    '₹': 'INR', '₩': 'KRW', '₺': 'TRY', '₽': 'RUB', 'R$': 'BRL',
    // Names / codes
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
    cad: 'CAD', aud: 'AUD', nzd: 'NZD', hkd: 'HKD', sgd: 'SGD',
    real: 'BRL', reais: 'BRL', brl: 'BRL',
    peso: 'MXN', mxn: 'MXN', ars: 'ARS', cop: 'COP', clp: 'CLP',
    dirham: 'AED', aed: 'AED',
    lira: 'TRY', try: 'TRY',
    krona: 'SEK', sek: 'SEK', krone: 'DKK', dkk: 'DKK', nok: 'NOK',
    zloty: 'PLN', pln: 'PLN', forint: 'HUF', huf: 'HUF',
    baht: 'THB', thb: 'THB', ringgit: 'MYR', myr: 'MYR',
    bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH',
};

/** @param {string} str @returns {string} */
function resolveCurrency(str) {
    const key = str.trim().toLowerCase();
    return CURRENCY_MAP[key] ?? CURRENCY_MAP[str.trim()] ?? str.trim().toUpperCase();
}

// ── City / region → IANA timezone ────────────────────────────────────────────
const TIMEZONE_MAP = {
    'new york': 'America/New_York', 'nyc': 'America/New_York', 'new york city': 'America/New_York',
    'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles',
    'chicago': 'America/Chicago', 'dallas': 'America/Chicago', 'houston': 'America/Chicago',
    'denver': 'America/Denver', 'phoenix': 'America/Phoenix',
    'seattle': 'America/Los_Angeles', 'portland': 'America/Los_Angeles',
    'toronto': 'America/Toronto', 'montreal': 'America/Toronto', 'canada east': 'America/Toronto',
    'vancouver': 'America/Vancouver', 'canada west': 'America/Vancouver',
    'sao paulo': 'America/Sao_Paulo', 'brazil': 'America/Sao_Paulo', 'rio': 'America/Sao_Paulo',
    'mexico city': 'America/Mexico_City', 'mexico': 'America/Mexico_City', 'cdmx': 'America/Mexico_City',
    'buenos aires': 'America/Argentina/Buenos_Aires', 'argentina': 'America/Argentina/Buenos_Aires',
    'santiago': 'America/Santiago', 'chile': 'America/Santiago',
    'bogota': 'America/Bogota', 'colombia': 'America/Bogota',
    'lima': 'America/Lima', 'peru': 'America/Lima',
    'london': 'Europe/London', 'uk': 'Europe/London', 'england': 'Europe/London',
    'paris': 'Europe/Paris', 'france': 'Europe/Paris',
    'berlin': 'Europe/Berlin', 'germany': 'Europe/Berlin', 'frankfurt': 'Europe/Berlin',
    'madrid': 'Europe/Madrid', 'spain': 'Europe/Madrid', 'barcelona': 'Europe/Madrid',
    'rome': 'Europe/Rome', 'milan': 'Europe/Rome', 'italy': 'Europe/Rome',
    'amsterdam': 'Europe/Amsterdam', 'netherlands': 'Europe/Amsterdam',
    'brussels': 'Europe/Brussels', 'belgium': 'Europe/Brussels',
    'vienna': 'Europe/Vienna', 'austria': 'Europe/Vienna',
    'zurich': 'Europe/Zurich', 'geneva': 'Europe/Zurich', 'switzerland': 'Europe/Zurich',
    'stockholm': 'Europe/Stockholm', 'sweden': 'Europe/Stockholm',
    'oslo': 'Europe/Oslo', 'norway': 'Europe/Oslo',
    'copenhagen': 'Europe/Copenhagen', 'denmark': 'Europe/Copenhagen',
    'helsinki': 'Europe/Helsinki', 'finland': 'Europe/Helsinki',
    'warsaw': 'Europe/Warsaw', 'poland': 'Europe/Warsaw',
    'prague': 'Europe/Prague', 'czech': 'Europe/Prague',
    'budapest': 'Europe/Budapest', 'hungary': 'Europe/Budapest',
    'athens': 'Europe/Athens', 'greece': 'Europe/Athens',
    'istanbul': 'Europe/Istanbul', 'turkey': 'Europe/Istanbul',
    'moscow': 'Europe/Moscow', 'russia': 'Europe/Moscow',
    'kyiv': 'Europe/Kyiv', 'ukraine': 'Europe/Kyiv',
    'dubai': 'Asia/Dubai', 'uae': 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai',
    'riyadh': 'Asia/Riyadh', 'saudi arabia': 'Asia/Riyadh',
    'tel aviv': 'Asia/Jerusalem', 'israel': 'Asia/Jerusalem', 'jerusalem': 'Asia/Jerusalem',
    'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'india': 'Asia/Kolkata', 'bangalore': 'Asia/Kolkata',
    'karachi': 'Asia/Karachi', 'pakistan': 'Asia/Karachi',
    'dhaka': 'Asia/Dhaka', 'bangladesh': 'Asia/Dhaka',
    'colombo': 'Asia/Colombo', 'sri lanka': 'Asia/Colombo',
    'kathmandu': 'Asia/Kathmandu', 'nepal': 'Asia/Kathmandu',
    'tokyo': 'Asia/Tokyo', 'japan': 'Asia/Tokyo', 'osaka': 'Asia/Tokyo',
    'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
    'hong kong': 'Asia/Hong_Kong',
    'taipei': 'Asia/Taipei', 'taiwan': 'Asia/Taipei',
    'singapore': 'Asia/Singapore',
    'kuala lumpur': 'Asia/Kuala_Lumpur', 'malaysia': 'Asia/Kuala_Lumpur',
    'jakarta': 'Asia/Jakarta', 'indonesia': 'Asia/Jakarta',
    'bangkok': 'Asia/Bangkok', 'thailand': 'Asia/Bangkok',
    'manila': 'Asia/Manila', 'philippines': 'Asia/Manila',
    'seoul': 'Asia/Seoul', 'korea': 'Asia/Seoul',
    'sydney': 'Australia/Sydney', 'australia': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne',
    'brisbane': 'Australia/Brisbane', 'perth': 'Australia/Perth',
    'auckland': 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland',
    'honolulu': 'Pacific/Honolulu', 'hawaii': 'Pacific/Honolulu',
    'cairo': 'Africa/Cairo', 'egypt': 'Africa/Cairo',
    'nairobi': 'Africa/Nairobi', 'kenya': 'Africa/Nairobi',
    'lagos': 'Africa/Lagos', 'nigeria': 'Africa/Lagos',
    'johannesburg': 'Africa/Johannesburg', 'south africa': 'Africa/Johannesburg',
    'accra': 'Africa/Accra', 'ghana': 'Africa/Accra',
    'casablanca': 'Africa/Casablanca', 'morocco': 'Africa/Casablanca',
};

/** @param {string} location @returns {string} */
function resolveTimezone(location) {
    return TIMEZONE_MAP[location.toLowerCase().trim()] ?? location.trim();
}

// ── Unit conversion table ─────────────────────────────────────────────────────
const UNIT_MAP = {
    // Length
    km: { type: 'length', toBase: v => v * 1000 },
    kilometer: { type: 'length', toBase: v => v * 1000 },
    kilometers: { type: 'length', toBase: v => v * 1000 },
    m: { type: 'length', toBase: v => v },
    meter: { type: 'length', toBase: v => v },
    meters: { type: 'length', toBase: v => v },
    cm: { type: 'length', toBase: v => v / 100 },
    centimeter: { type: 'length', toBase: v => v / 100 },
    centimeters: { type: 'length', toBase: v => v / 100 },
    mm: { type: 'length', toBase: v => v / 1000 },
    millimeter: { type: 'length', toBase: v => v / 1000 },
    millimeters: { type: 'length', toBase: v => v / 1000 },
    mile: { type: 'length', toBase: v => v * 1609.344 },
    miles: { type: 'length', toBase: v => v * 1609.344 },
    mi: { type: 'length', toBase: v => v * 1609.344 },
    yard: { type: 'length', toBase: v => v * 0.9144 },
    yards: { type: 'length', toBase: v => v * 0.9144 },
    yd: { type: 'length', toBase: v => v * 0.9144 },
    foot: { type: 'length', toBase: v => v * 0.3048 },
    feet: { type: 'length', toBase: v => v * 0.3048 },
    ft: { type: 'length', toBase: v => v * 0.3048 },
    inch: { type: 'length', toBase: v => v * 0.0254 },
    inches: { type: 'length', toBase: v => v * 0.0254 },
    in: { type: 'length', toBase: v => v * 0.0254 },
    // Weight
    kg: { type: 'weight', toBase: v => v },
    kilogram: { type: 'weight', toBase: v => v },
    kilograms: { type: 'weight', toBase: v => v },
    g: { type: 'weight', toBase: v => v / 1000 },
    gram: { type: 'weight', toBase: v => v / 1000 },
    grams: { type: 'weight', toBase: v => v / 1000 },
    lb: { type: 'weight', toBase: v => v * 0.453592 },
    lbs: { type: 'weight', toBase: v => v * 0.453592 },
    pound: { type: 'weight', toBase: v => v * 0.453592 },
    pounds: { type: 'weight', toBase: v => v * 0.453592 },
    oz: { type: 'weight', toBase: v => v * 0.0283495 },
    ounce: { type: 'weight', toBase: v => v * 0.0283495 },
    ounces: { type: 'weight', toBase: v => v * 0.0283495 },
    tonne: { type: 'weight', toBase: v => v * 1000 },
    tonnes: { type: 'weight', toBase: v => v * 1000 },
    ton: { type: 'weight', toBase: v => v * 907.185 },  // short ton
    tons: { type: 'weight', toBase: v => v * 907.185 },
    // Temperature (special-cased in params)
    celsius: { type: 'temperature', toBase: v => v },
    c: { type: 'temperature', toBase: v => v },
    fahrenheit: { type: 'temperature', toBase: v => v },
    f: { type: 'temperature', toBase: v => v },
    kelvin: { type: 'temperature', toBase: v => v },
    k: { type: 'temperature', toBase: v => v },
    // Volume
    l: { type: 'volume', toBase: v => v },
    liter: { type: 'volume', toBase: v => v },
    liters: { type: 'volume', toBase: v => v },
    litre: { type: 'volume', toBase: v => v },
    litres: { type: 'volume', toBase: v => v },
    ml: { type: 'volume', toBase: v => v / 1000 },
    milliliter: { type: 'volume', toBase: v => v / 1000 },
    milliliters: { type: 'volume', toBase: v => v / 1000 },
    gallon: { type: 'volume', toBase: v => v * 3.78541 },
    gallons: { type: 'volume', toBase: v => v * 3.78541 },
    gal: { type: 'volume', toBase: v => v * 3.78541 },
    pint: { type: 'volume', toBase: v => v * 0.473176 },
    pints: { type: 'volume', toBase: v => v * 0.473176 },
    pt: { type: 'volume', toBase: v => v * 0.473176 },
    cup: { type: 'volume', toBase: v => v * 0.236588 },
    cups: { type: 'volume', toBase: v => v * 0.236588 },
    // Speed
    'km/h': { type: 'speed', toBase: v => v },
    'kph': { type: 'speed', toBase: v => v },
    'mph': { type: 'speed', toBase: v => v * 1.60934 },
    'mps': { type: 'speed', toBase: v => v * 3.6 },
    'knot': { type: 'speed', toBase: v => v * 1.852 },
    'knots': { type: 'speed', toBase: v => v * 1.852 },
    // Digital storage
    'b': { type: 'storage', toBase: v => v },
    'byte': { type: 'storage', toBase: v => v },
    'bytes': { type: 'storage', toBase: v => v },
    'kb': { type: 'storage', toBase: v => v * 1024 },
    'kilobyte': { type: 'storage', toBase: v => v * 1024 },
    'kilobytes': { type: 'storage', toBase: v => v * 1024 },
    'mb': { type: 'storage', toBase: v => v * 1024 ** 2 },
    'megabyte': { type: 'storage', toBase: v => v * 1024 ** 2 },
    'megabytes': { type: 'storage', toBase: v => v * 1024 ** 2 },
    'gb': { type: 'storage', toBase: v => v * 1024 ** 3 },
    'gigabyte': { type: 'storage', toBase: v => v * 1024 ** 3 },
    'gigabytes': { type: 'storage', toBase: v => v * 1024 ** 3 },
    'tb': { type: 'storage', toBase: v => v * 1024 ** 4 },
    'terabyte': { type: 'storage', toBase: v => v * 1024 ** 4 },
    'terabytes': { type: 'storage', toBase: v => v * 1024 ** 4 },
};

function resolveUnit(str) {
    return UNIT_MAP[str.trim().toLowerCase()] ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip trailing punctuation */
function cleanTail(str) {
    return str.replace(/[?!.,;:]+$/, '').trim();
}

/**
 * Safe parseInt with a default and optional min/max clamp.
 * @param {string|undefined} str
 * @param {number} defaultVal
 * @param {number} [min]
 * @param {number} [max]
 */
function safeInt(str, defaultVal, min, max) {
    const n = parseInt(str ?? '', 10);
    const val = isNaN(n) ? defaultVal : n;
    if (min !== undefined && val < min) return min;
    if (max !== undefined && val > max) return max;
    return val;
}

/** @param {string} expr  Sanitised arithmetic expression string */
function evalMath(expr) {
    // Only allow digits, operators, parens, dots, spaces, and common math words
    const safe = expr
        .replace(/\^/g, '**')
        .replace(/\bmod\b/gi, '%')
        .replace(/\bx\b/gi, '*')
        .replace(/[^0-9+\-*/%.() ]/g, '');
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${safe})`)();
}

// ── Rule table ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ tool: string, params: Record<string,any> }} ToolMatch
 * @typedef {{ tool: string, patterns: RegExp[], params: (m: RegExpMatchArray) => Record<string,any>, description: string, examples: string[] }} Rule
 */

/** @type {Rule[]} */
const RULES = [

    // ── HELP ──────────────────────────────────────────────────────────────────
    // Placed first so /help is never swallowed by a broader pattern below.
    {
        tool: 'help',
        description: 'Lists all available tools and their usage examples.',
        examples: ['show commands', 'show commands weather', 'list all tools', 'show me all commands'],
        patterns: [
            /^show commands?(?:\s+(\w+))?\??$/i,
            /^show (?:me )?(?:all )?commands?(?:\s+for\s+(\w+))?\??$/i,
            /^show (?:me )?(?:all )?tools?(?:\s+for\s+(\w+))?\??$/i,
            /^list (?:all )?commands?(?:\s+(\w+))?\??$/i,
        ],
        params: m => {
            const toolName = m[1]?.toLowerCase().trim() ?? null;

            if (toolName) {
                // RULES is captured by reference — fully initialised by call-time.
                const rule = RULES.find(r => r.tool === toolName);
                if (!rule) {
                    return {
                        text: `❓ Unknown tool: "${toolName}". Type /help to see all tools.`,
                        toolName,
                    };
                }
                const text =
                    `🔧 ${rule.tool}\n` +
                    `${rule.description}\n\n` +
                    `Examples:\n${rule.examples.map(e => `  • "${e}"`).join('\n')}`;
                return { text, toolName };
            }

            // Full listing — mirrors describe() but embedded in params at match-time.
            const text = RULES.map(r =>
                `🔧 ${r.tool.padEnd(12)} ${r.description}\n` +
                `   ${r.examples.map(e => `"${e}"`).join('  |  ')}`
            ).join('\n\n');
            return { text, toolName: null };
        },
    },

    // ── CALCULATOR ────────────────────────────────────────────────────────────
    {
        tool: 'calculator',
        description: 'Evaluates arithmetic expressions.',
        examples: ['what is 12 * 34', 'calculate 100 / 4 + 7', '2^10', '500 mod 3'],
        patterns: [
            /^(?:what(?:'s| is) )?(?:calculate |compute |eval(?:uate)? )?(-?[\d.]+\s*[+\-*/^%]\s*.+)$/i,
            /^(?:calculate|compute|eval(?:uate)?)\s+(.+)$/i,
            /^(-?[\d.]+\s*(?:[+\-*/^%]|mod|x)\s*[\d.].*)$/i,
        ],
        params: m => {
            const expr = cleanTail(m[1]);
            const result = evalMath(expr);
            if (typeof result !== 'number' || !isFinite(result)) throw new Error('Invalid expression');
            return { expression: expr, result };
        },
    },

    // ── WEATHER ───────────────────────────────────────────────────────────────
    {
        tool: 'weather',
        description: 'Fetches weather or forecast for a location.',
        examples: ['weather in Tokyo', "what's the forecast for Paris", 'temperature in Berlin'],
        patterns: [
            /(?:what(?:'s| is)(?: the)?) weather(?: like)? (?:in|at|for) (.+)/i,
            /weather (?:in|at|for) (.+)/i,
            /(?:forecast|temperature|temp) (?:in|at|for) (.+)/i,
            /how(?:'s| is) (?:the )?weather (?:in|at) (.+)/i,
            /(?:is it|will it be) (?:rain|snow|cold|hot|warm)\w* (?:in|at) (.+)/i,
        ],
        params: m => ({ location: cleanTail(m[1]) }),
    },

    // ── TIME (with location) ──────────────────────────────────────────────────
    {
        tool: 'time',
        description: 'Gets the current time in a specific location.',
        examples: ['what time is it in London', 'current time in Tokyo', 'time in New York'],
        patterns: [
            /(?:what(?:'s| is)(?: the)?) (?:local )?time (?:in|at) (.+)/i,
            /what time is it (?:in|at|over in) (.+)/i,
            /current time (?:in|at) (.+)/i,
        ],
        params: m => ({ timezone: resolveTimezone(cleanTail(m[1])) }),
    },

    // ── DATE / current time (no location) ────────────────────────────────────
    {
        tool: 'date',
        description: "Gets today's date or current local time.",
        examples: ["what's the date", 'what day is it', 'what time is it'],
        patterns: [
            /^(?:what(?:'s| is)(?: the)?) (?:date|day)(?: today)?\??$/i,
            /^today(?:'s)? date\??$/i,
            /^current date\??$/i,
            /^what day is (?:it|today)\??$/i,
            /^what time is it\??$/i,
        ],
        params: () => ({ action: 'now' }),
    },

    // ── CURRENCY (symbol-prefix form: $50 to EUR) ─────────────────────────────
    {
        tool: 'currency',
        description: 'Converts an amount between currencies.',
        examples: ['100 USD to EUR', 'convert $50 to pounds', '200 euros in dollars'],
        patterns: [
            // Symbol-prefixed: $50 to EUR, €20 in dollars
            /([€£¥₪₹₩₺₽$])(\d+(?:[.,]\d+)?)\s+(?:in|to|into)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]+)?)/i,
            // R$ prefix (Brazilian real)
            /(R\$)(\d+(?:[.,]\d+)?)\s+(?:in|to|into)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]+)?)/i,
            // Standard: 100 USD to EUR
            /(?:how much is |convert )?(\d+(?:[.,]\d+)?)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]+)?)\s+(?:in|to|into)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]+)?)/i,
        ],
        params: m => {
            // Symbol-prefix match has symbol in m[1], amount in m[2]
            const isSymbolForm = /^[€£¥₪₹₩₺₽$R]/.test(m[1]);
            if (isSymbolForm) {
                return {
                    amount: parseFloat(m[2].replace(',', '.')),
                    from: resolveCurrency(m[1]),
                    to: resolveCurrency(m[3]),
                };
            }
            return {
                amount: parseFloat(m[1].replace(',', '.')),
                from: resolveCurrency(m[2]),
                to: resolveCurrency(m[3]),
            };
        },
    },

    // ── UNIT CONVERSION ───────────────────────────────────────────────────────
    {
        tool: 'convert',
        description: 'Converts between physical units (length, weight, temp, volume, speed, storage).',
        examples: ['convert 5 km to miles', '100 fahrenheit to celsius', '2 GB in MB'],
        patterns: [
            /(?:convert )?(-?[\d.]+)\s+([a-z/]+)\s+(?:in|to|into)\s+([a-z/]+)/i,
            /(?:how many|how much) ([a-z/]+) (?:is|are|in) (-?[\d.]+) ([a-z/]+)/i,
        ],
        params: m => {
            // Pattern 2 has a different group order
            const [amount, fromUnit, toUnit] = m[2] && /^\d/.test(m[2])
                ? [parseFloat(m[2]), m[3], m[1]]      // "how many X is N Y"
                : [parseFloat(m[1]), m[2], m[3]];     // "convert N X to Y"

            const from = resolveUnit(fromUnit);
            const to = resolveUnit(toUnit);

            if (!from || !to) throw new Error(`Unknown unit: ${fromUnit} or ${toUnit}`);
            if (from.type !== to.type) throw new Error(`Incompatible unit types: ${from.type} ≠ ${to.type}`);

            return {
                amount,
                from: fromUnit.trim().toLowerCase(),
                to: toUnit.trim().toLowerCase(),
                fromType: from.type,
            };
        },
    },

    // ── UUID ──────────────────────────────────────────────────────────────────
    {
        tool: 'uuid',
        description: 'Generates one or more UUIDs.',
        examples: ['generate a uuid', 'create 5 uuids', 'random uuid'],
        patterns: [
            /(?:generate|create|make|give me)(?: (\d+))? uuids?/i,
            /^(\d+) uuids?$/i,
            /^random uuids?$/i,
        ],
        params: m => ({ count: safeInt(m[1] ?? m[2], 1, 1, 20) }),
    },

    // ── PASSWORD ──────────────────────────────────────────────────────────────
    {
        tool: 'password',
        description: 'Generates a random secure password.',
        examples: ['generate a password', 'create a 24-character password', 'password no symbols'],
        patterns: [
            /(?:generate|create|make|give me)(?: a)? (?:secure |random )?passwords?/i,
            /^random password$/i,
        ],
        params: m => {
            const full = m[0];
            const lenMatch = full.match(/(\d+)\s*[-\s]?(?:char|character|length|long)/i);
            const countMatch = full.match(/(\d+)\s+passwords?/i);
            return {
                length: safeInt(lenMatch?.[1], 16, 6, 128),
                count: safeInt(countMatch?.[1], 1, 1, 10),
                symbols: !/no[\s-]?symbols?/i.test(full),
                uppercase: !/no[\s-]?upper(?:case)?/i.test(full),
                digits: !/no[\s-]?(?:digit|number)s?/i.test(full),
            };
        },
    },

    // ── TIMER ─────────────────────────────────────────────────────────────────
    {
        tool: 'timer',
        description: 'Sets a countdown timer.',
        examples: ['set a timer for 10 minutes', 'start a 30-second timer', 'timer for 1.5 hours'],
        patterns: [
            /(?:set|start|create)(?: a)? timer (?:for )?(\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min|second|sec)\b/i,
            /(?:remind me in) (\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min|second|sec)\b/i,
        ],
        params: m => {
            const v = parseFloat(m[1]), u = m[2].toLowerCase();
            const seconds = /^h/.test(u) ? v * 3600 : /^m/.test(u) ? v * 60 : v;
            return { seconds: Math.round(seconds), label: `Timer (${m[1]} ${m[2]})` };
        },
    },

    // ── COUNTDOWN (to a date) ─────────────────────────────────────────────────
    {
        tool: 'countdown',
        description: 'Counts down days until a specific date or event.',
        examples: ['how many days until Christmas', 'countdown to New Year', 'days until July 4'],
        patterns: [
            /(?:how (?:many|long) (?:days? )?(?:until|till|to|before))\s+(.+)/i,
            /(?:countdown to|days? until|days? till)\s+(.+)/i,
        ],
        params: m => ({ target: cleanTail(m[1]) }),
    },

    // ── BASE64 ────────────────────────────────────────────────────────────────
    {
        tool: 'base64',
        description: 'Encodes or decodes a Base64 string.',
        examples: ['base64 encode hello world', 'decode base64 aGVsbG8=', 'base64 decode SGVsbG8gV29ybGQ='],
        patterns: [
            /^base64 (?:en)?code (.+)/i,
            /^base64 decode (.+)/i,
            /^(?:encode|decode) (?:in |to |from )?base64[:\s]+(.+)/i,
        ],
        params: m => {
            const full = m[0];
            const mode = /decode/i.test(full) ? 'decode' : 'encode';
            return { mode, value: m[1].trim() };
        },
    },

    // ── COLOR ─────────────────────────────────────────────────────────────────
    {
        tool: 'color',
        description: 'Converts between color formats (hex, rgb, hsl) or looks up a color.',
        examples: ['color #ff5733', 'rgb 255 87 51', 'what color is #00bcd4', 'convert #3498db to rgb'],
        patterns: [
            /^(?:color|colour)\s+(#[0-9a-f]{3,8})\b/i,
            /^(?:color|colour)\s+(?:rgb\s*)?\(?(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})\)?/i,
            /^(?:what (?:color|colour) is|convert color)\s+(#[0-9a-f]{3,8})\b/i,
            /^(?:convert (?:color|colour) )?#([0-9a-f]{3,6}) (?:to |in )?(rgb|hsl|hsv|cmyk)/i,
        ],
        params: m => {
            const full = m[0];
            if (/\d{1,3}[,\s]+\d{1,3}[,\s]+\d{1,3}/.test(full) && !/#/.test(m[1] ?? '')) {
                return { mode: 'rgb', r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
            }
            return { mode: 'hex', hex: (m[1] ?? '').replace('#', '') };
        },
    },

    // ── HASH ──────────────────────────────────────────────────────────────────
    {
        tool: 'hash',
        description: 'Hashes text using common algorithms.',
        examples: ['md5 hello world', 'sha256 of my text', 'sha1 hash of test string'],
        patterns: [
            /^(md5|sha1|sha256|sha512|sha-1|sha-256|sha-512)\s+(?:hash (?:of )?|of )?(.+)/i,
            /^hash\s+(?:using\s+)?(md5|sha1|sha256|sha512)\s+(?:of\s+)?(.+)/i,
        ],
        params: m => ({
            algorithm: m[1].toLowerCase().replace('-', ''),
            value: cleanTail(m[2]),
        }),
    },

    // ── DICE / COIN ───────────────────────────────────────────────────────────
    {
        tool: 'random',
        description: 'Rolls dice or flips a coin.',
        examples: ['roll a die', 'flip a coin', 'roll 2d6', 'roll d20', 'random number 1 to 100'],
        patterns: [
            /^(?:roll|throw)(?: a?n?)? ?(\d+)?d(\d+)\b/i,
            /^(?:roll|throw)(?: a)? di(?:e|ce)\b/i,
            /^flip(?: a)? coin\b/i,
            /^(?:random|rand)\s+(?:number\s+)?(?:between\s+)?(\d+)\s+(?:to|and|-)\s+(\d+)\b/i,
            /^(?:random|rand)\s+(?:number\s+)?(?:from\s+)?(\d+)\s+(?:to|and|-)\s+(\d+)\b/i,
        ],
        params: m => {
            const full = m[0];
            if (/coin/i.test(full)) return { mode: 'coin' };
            if (/random|rand/i.test(full)) {
                return { mode: 'range', min: safeInt(m[1], 1), max: safeInt(m[2], 100) };
            }
            // Dice
            const count = safeInt(m[1], 1, 1, 100);
            const sides = safeInt(m[2], 6, 2, 1000);
            return { mode: 'dice', count, sides };
        },
    },

    // ── IP LOOKUP ─────────────────────────────────────────────────────────────
    {
        tool: 'ip',
        description: "Looks up info about an IP address, or returns the user's own IP.",
        examples: ['what is my ip', 'lookup ip 8.8.8.8', 'ip info 1.1.1.1'],
        patterns: [
            /^(?:what(?:'s| is) my ip(?: address)?|my ip|show my ip)\??$/i,
            /^(?:ip|lookup ip|ip info|ip lookup|whois)\s+([\d.]{7,15}|[0-9a-f:]{3,39})\b/i,
        ],
        params: m => ({
            target: m[1]?.trim() ?? 'self',
        }),
    },

    // ── LOCATION ──────────────────────────────────────────────────────────────
    {
        tool: 'location',
        description: "Detects the user's geographic location.",
        examples: ['where am I', 'my location', 'find my location'],
        patterns: [
            /^(?:where am i|my location|current location|locate me|find my location)\??$/i,
        ],
        params: () => ({}),
    },

    // ── CLIPBOARD ─────────────────────────────────────────────────────────────
    {
        tool: 'clipboard',
        description: "Reads the user's clipboard.",
        examples: ['read clipboard', 'what is in my clipboard'],
        patterns: [
            /^(?:read|get|check|show)(?: me)?(?: my)? clipboard\??$/i,
            /^what(?:'s| is) in(?: my)? clipboard\??$/i,
            /^clipboard\??$/i,
        ],
        params: () => ({}),
    },

    // ── WEB SEARCH ────────────────────────────────────────────────────────────
    {
        tool: 'websearch',
        description: 'Searches the web (DuckDuckGo fallback).',
        examples: ['search for TypeScript tutorials', 'look up climate change', 'google best pizza NYC'],
        patterns: [
            /^(?:search for|look up|google|bing|search) (.+)/i,
        ],
        params: m => ({ query: cleanTail(m[1]) }),
    },

    // ── WIKIPEDIA ─────────────────────────────────────────────────────────────
    {
        tool: 'wikipedia',
        description: 'Fetches a Wikipedia summary for a topic.',
        examples: ['tell me about black holes', 'explain quantum entanglement', 'who is Ada Lovelace'],
        patterns: [
            /^(?:tell me about|explain|define) (.+)/i,
            /^(?:wiki|wikipedia)(?::| for| about)? (.+)/i,
            /^(?:what|who) (?:is|are|was|were) (?!your|this|that|it\b)(.+)/i,
        ],
        params: m => ({ query: cleanTail(m[1]) }),
    },

    // ── GAME ─────────────────────────────────────────────────────────────
    {
        tool: 'start_game',
        description: 'Starts a game of Chess or Checkers in the chat.',
        examples: ['let\'s play chess', 'start a game of checkers', 'play chess'],
        patterns: [
            /^(?:let'?s\s+)?(?:play|start)(?: a game of)?\s+(chess|checkers)/i
        ],
        params: m => ({ game: m[1].toLowerCase() }),
    },
];

// ─────────────────────────────────────────────────────────────────────────────
//  ToolTriggerHandler
// ─────────────────────────────────────────────────────────────────────────────

export class ToolTriggerHandler {

    /**
     * Attempt to match user input to a tool rule.
     * Returns the first match or null.
     * @param {string} input
     * @returns {ToolMatch|null}
     */
    match(input) {
        const text = (input ?? '').trim();
        if (!text) return null;

        for (const rule of RULES) {
            for (const pattern of rule.patterns) {
                const m = text.match(pattern);
                if (m) {
                    try {
                        return { tool: rule.tool, params: rule.params(m) };
                    } catch (e) {
                        // Param extraction failed for this rule — try next pattern
                        console.warn(`[ToolTriggerHandler] param error for tool "${rule.tool}":`, e.message);
                    }
                }
            }
        }
        return null;
    }

    /**
     * Match all possible rules (not just the first).
     * Useful for debugging overlapping patterns.
     * @param {string} input
     * @returns {ToolMatch[]}
     */
    matchAll(input) {
        const text = (input ?? '').trim();
        const results = [];

        for (const rule of RULES) {
            for (const pattern of rule.patterns) {
                const m = text.match(pattern);
                if (m) {
                    try {
                        results.push({ tool: rule.tool, params: rule.params(m) });
                    } catch (_) { /* skip */ }
                }
            }
        }
        return results;
    }

    /**
     * Returns a human-readable list of tools with descriptions and examples.
     * Pass a tool name to show only that tool.
     * @param {string} [toolName]
     * @returns {string}
     */
    describe(toolName) {
        const rules = toolName
            ? RULES.filter(r => r.tool === toolName.toLowerCase())
            : RULES;
        if (toolName && !rules.length) return `Unknown tool: "${toolName}"`;
        return rules.map(r =>
            `🔧 ${r.tool.padEnd(12)} ${r.description}\n` +
            `   Examples: ${r.examples.map(e => `"${e}"`).join('  |  ')}`
        ).join('\n\n');
    }

    /**
     * Returns all registered tool names.
     * @returns {string[]}
     */
    get tools() {
        return [...new Set(RULES.map(r => r.tool))];
    }
}

export const toolRouter = new ToolTriggerHandler();


// ─────────────────────────────────────────────────────────────────────────────
//  Quick self-test  (run with: node toolTriggerHandler.js)
// ─────────────────────────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('toolTriggerHandler.js')) {
    const tests = [
        'show commands',
        'show commands weather',
        'show commands convert',
        'show me all tools',
        'list all commands',
        '12 * 34',
        'calculate 100 / 4 + 7',
        '2^10',
        'weather in Tokyo',
        "what's the forecast for Paris",
        'what time is it in London',
        "what's the date",
        '$50 to EUR',
        '€200 in dollars',
        '100 USD to GBP',
        'convert 5 km to miles',
        '100 fahrenheit to celsius',
        'how many MB is 2 GB',
        'generate 3 uuids',
        'generate a 24-character password',
        'set a timer for 10 minutes',
        'how many days until Christmas',
        'base64 encode hello world',
        'base64 decode aGVsbG8=',
        'color #ff5733',
        'sha256 of my secret text',
        'roll 2d6',
        'flip a coin',
        'random number 1 to 100',
        'what is my ip',
        'ip lookup 8.8.8.8',
        'where am I',
        'search for TypeScript tutorials',
        'what is quantum computing',
        'who was Ada Lovelace',
    ];

    console.log('\n=== Registered tools ===');
    console.log(toolRouter.tools.join(', '));
    console.log('\n=== Tool descriptions ===\n');
    console.log(toolRouter.describe());
    console.log('\n=== Match tests ===\n');

    let passed = 0;
    for (const t of tests) {
        const result = toolRouter.match(t);
        const status = result ? '✅' : '❌';
        const detail = result ? `${result.tool} ${JSON.stringify(result.params)}` : 'no match';
        console.log(`${status} "${t}"\n   → ${detail}\n`);
        if (result) passed++;
    }
    console.log(`\nPassed: ${passed}/${tests.length}`);
}
