// Currency symbol, slang, and alias -> ISO 4217 code
export const CURRENCY_MAP = {
    // Symbols (Disambiguated where possible)
    '$': 'USD', 'us$': 'USD', 'c$': 'CAD', 'a$': 'AUD', 'nz$': 'NZD', 'r$': 'BRL', 'mx$': 'MXN', 'hk$': 'HKD', 's$': 'SGD',
    '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₪': 'ILS', '₹': 'INR', '₩': 'KRW', '₺': 'TRY', '₽': 'RUB', 
    '₫': 'VND', '฿': 'THB', '₱': 'PHP', '₡': 'CRC', '₦': 'NGN', '₴': 'UAH', 'zł': 'PLN',

    // Global Slang & Names
    usd: 'USD', dollar: 'USD', dollars: 'USD', buck: 'USD', bucks: 'USD', greenback: 'USD', greenbacks: 'USD',
    eur: 'EUR', euro: 'EUR', euros: 'EUR', 
    gbp: 'GBP', pound: 'GBP', pounds: 'GBP', quid: 'GBP', sterling: 'GBP',
    cad: 'CAD', loonie: 'CAD', loonies: 'CAD', toonie: 'CAD', toonies: 'CAD',
    aud: 'AUD', dollarydoo: 'AUD', dollarydoos: 'AUD',
    nzd: 'NZD', kiwi: 'NZD', kiwis: 'NZD',
    chf: 'CHF', franc: 'CHF', francs: 'CHF', swissie: 'CHF', swissies: 'CHF',
    jpy: 'JPY', yen: 'JPY',
    cny: 'CNY', rmb: 'CNY', yuan: 'CNY', renminbi: 'CNY', kuai: 'CNY',
    inr: 'INR', rupee: 'INR', rupees: 'INR',
    rub: 'RUB', ruble: 'RUB', rubles: 'RUB',
    zar: 'ZAR', rand: 'ZAR', rands: 'ZAR',
    ils: 'ILS', shekel: 'ILS', shekels: 'ILS', nis: 'ILS',
    mxn: 'MXN', peso: 'MXN', pesos: 'MXN',
    sek: 'SEK', krona: 'SEK', krone: 'DKK', dkk: 'DKK', nok: 'NOK',
    
    // Crypto
    btc: 'BTC', bitcoin: 'BTC', sats: 'BTC', satoshis: 'BTC',
    eth: 'ETH', ethereum: 'ETH', gwei: 'ETH'
};

export function resolveCurrency(str) {
    if (!str) return null;
    
    // Lowercase everything so we don't need case-sensitive fallback maps for 'R$' etc.
    const key = str.trim().toLowerCase();
    if (CURRENCY_MAP[key]) return CURRENCY_MAP[key];
    
    // Fallback: Check if it's already a valid 3-letter ISO code
    const upper = key.toUpperCase();
    if (/^[A-Z]{3}$/.test(upper)) return upper;
    
    return null;
}

// Colloquial region / abbreviation -> IANA timezone
export const TIMEZONE_MAP = {
    // North America & Colloquial Regions
    'new york': 'America/New_York', 'nyc': 'America/New_York', 'east coast': 'America/New_York', 'est': 'America/New_York', 'edt': 'America/New_York',
    'chicago': 'America/Chicago', 'cst': 'America/Chicago', 'cdt': 'America/Chicago', 'texas': 'America/Chicago',
    'denver': 'America/Denver', 'mst': 'America/Denver', 'mdt': 'America/Denver',
    'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', 'sf': 'America/Los_Angeles', 'west coast': 'America/Los_Angeles', 'pst': 'America/Los_Angeles', 'pdt': 'America/Los_Angeles',
    'toronto': 'America/Toronto', 'vancouver': 'America/Vancouver', 'mexico city': 'America/Mexico_City', 'cdmx': 'America/Mexico_City',
    
    // Europe & Abbreviations
    'london': 'Europe/London', 'uk': 'Europe/London', 'gmt': 'Europe/London', 'bst': 'Europe/London', 'uk time': 'Europe/London',
    'paris': 'Europe/Paris', 'berlin': 'Europe/Berlin', 'rome': 'Europe/Rome', 'madrid': 'Europe/Madrid', 'amsterdam': 'Europe/Amsterdam', 
    'cet': 'Europe/Paris', 'cest': 'Europe/Paris', 'european time': 'Europe/Paris', 'central europe': 'Europe/Paris',
    'kyiv': 'Europe/Kyiv', 'kiev': 'Europe/Kyiv', 'moscow': 'Europe/Moscow',
    
    // Asia, Pacific & Middle East
    'dubai': 'Asia/Dubai', 'uae': 'Asia/Dubai', 'gulf time': 'Asia/Dubai',
    'mumbai': 'Asia/Kolkata', 'india': 'Asia/Kolkata', 'ist': 'Asia/Kolkata',
    'singapore': 'Asia/Singapore', 'sgt': 'Asia/Singapore',
    'hong kong': 'Asia/Hong_Kong', 'hk': 'Asia/Hong_Kong', 'hkt': 'Asia/Hong_Kong',
    'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'china': 'Asia/Shanghai', 'cst china': 'Asia/Shanghai',
    'tokyo': 'Asia/Tokyo', 'japan': 'Asia/Tokyo', 'jst': 'Asia/Tokyo',
    'seoul': 'Asia/Seoul', 'korea': 'Asia/Seoul', 'kst': 'Asia/Seoul',
    'sydney': 'Australia/Sydney', 'australia': 'Australia/Sydney', 'aest': 'Australia/Sydney', 'aedt': 'Australia/Sydney',
    'auckland': 'Pacific/Auckland', 'nz': 'Pacific/Auckland', 'nzt': 'Pacific/Auckland',
    
    // Global Standards
    'utc': 'UTC', 'zulu': 'UTC', 'z': 'UTC'
};

export function resolveTimezone(location) {
    if (!location) return null;
    
    // Strip common punctuation (e.g., U.K. -> uk, N.Y.C -> nyc) for better matching
    const key = location.trim().toLowerCase().replace(/[.,]/g, '');
    return TIMEZONE_MAP[key] ?? location.trim();
}

// Unit conversion table with international slang and mathematical fixes
export const UNIT_MAP = {
    // Length (Base: Meters)
    m: { type: 'length', toBase: v => v }, meter: { type: 'length', toBase: v => v }, meters: { type: 'length', toBase: v => v },
    km: { type: 'length', toBase: v => v * 1000 }, kilometer: { type: 'length', toBase: v => v * 1000 }, kilometers: { type: 'length', toBase: v => v * 1000 }, klicks: { type: 'length', toBase: v => v * 1000 },
    cm: { type: 'length', toBase: v => v / 100 }, centimeter: { type: 'length', toBase: v => v / 100 }, centimeters: { type: 'length', toBase: v => v / 100 },
    mm: { type: 'length', toBase: v => v / 1000 }, millimeter: { type: 'length', toBase: v => v / 1000 }, millimeters: { type: 'length', toBase: v => v / 1000 },
    mile: { type: 'length', toBase: v => v * 1609.344 }, miles: { type: 'length', toBase: v => v * 1609.344 }, mi: { type: 'length', toBase: v => v * 1609.344 },
    yard: { type: 'length', toBase: v => v * 0.9144 }, yards: { type: 'length', toBase: v => v * 0.9144 }, yd: { type: 'length', toBase: v => v * 0.9144 },
    foot: { type: 'length', toBase: v => v * 0.3048 }, feet: { type: 'length', toBase: v => v * 0.3048 }, ft: { type: 'length', toBase: v => v * 0.3048 },
    inch: { type: 'length', toBase: v => v * 0.0254 }, inches: { type: 'length', toBase: v => v * 0.0254 }, in: { type: 'length', toBase: v => v * 0.0254 },

    // Weight (Base: Kilograms)
    kg: { type: 'weight', toBase: v => v }, kilo: { type: 'weight', toBase: v => v }, kilos: { type: 'weight', toBase: v => v }, kilogram: { type: 'weight', toBase: v => v }, kilograms: { type: 'weight', toBase: v => v },
    g: { type: 'weight', toBase: v => v / 1000 }, gram: { type: 'weight', toBase: v => v / 1000 }, grams: { type: 'weight', toBase: v => v / 1000 },
    lb: { type: 'weight', toBase: v => v * 0.453592 }, lbs: { type: 'weight', toBase: v => v * 0.453592 }, pound: { type: 'weight', toBase: v => v * 0.453592 }, pounds: { type: 'weight', toBase: v => v * 0.453592 },
    oz: { type: 'weight', toBase: v => v * 0.0283495 }, ounce: { type: 'weight', toBase: v => v * 0.0283495 }, ounces: { type: 'weight', toBase: v => v * 0.0283495 },
    stone: { type: 'weight', toBase: v => v * 6.35029 }, st: { type: 'weight', toBase: v => v * 6.35029 },
    tonne: { type: 'weight', toBase: v => v * 1000 }, tonnes: { type: 'weight', toBase: v => v * 1000 }, metric_ton: { type: 'weight', toBase: v => v * 1000 },
    ton: { type: 'weight', toBase: v => v * 907.185 }, tons: { type: 'weight', toBase: v => v * 907.185 }, // short ton

    // Temperature (Base: Kelvin - requires additive offsets)
    k: { type: 'temperature', toBase: v => v }, kelvin: { type: 'temperature', toBase: v => v },
    c: { type: 'temperature', toBase: v => v + 273.15 }, celsius: { type: 'temperature', toBase: v => v + 273.15 }, centigrade: { type: 'temperature', toBase: v => v + 273.15 },
    f: { type: 'temperature', toBase: v => (v - 32) * (5/9) + 273.15 }, fahrenheit: { type: 'temperature', toBase: v => (v - 32) * (5/9) + 273.15 },

    // Area (Base: Square Meters)
    sqm: { type: 'area', toBase: v => v }, 'm2': { type: 'area', toBase: v => v },
    sqft: { type: 'area', toBase: v => v * 0.092903 }, 'ft2': { type: 'area', toBase: v => v * 0.092903 },
    acre: { type: 'area', toBase: v => v * 4046.86 }, acres: { type: 'area', toBase: v => v * 4046.86 },
    hectare: { type: 'area', toBase: v => v * 10000 }, hectares: { type: 'area', toBase: v => v * 10000 }, ha: { type: 'area', toBase: v => v * 10000 },

    // Volume (Base: Liters)
    l: { type: 'volume', toBase: v => v }, liter: { type: 'volume', toBase: v => v }, liters: { type: 'volume', toBase: v => v }, litre: { type: 'volume', toBase: v => v }, litres: { type: 'volume', toBase: v => v },
    ml: { type: 'volume', toBase: v => v / 1000 }, milliliter: { type: 'volume', toBase: v => v / 1000 }, milliliters: { type: 'volume', toBase: v => v / 1000 },
    gallon: { type: 'volume', toBase: v => v * 3.78541 }, gallons: { type: 'volume', toBase: v => v * 3.78541 }, gal: { type: 'volume', toBase: v => v * 3.78541 },
    'imperial gallon': { type: 'volume', toBase: v => v * 4.54609 }, // UK vs US difference
    pint: { type: 'volume', toBase: v => v * 0.473176 }, pints: { type: 'volume', toBase: v => v * 0.473176 }, pt: { type: 'volume', toBase: v => v * 0.473176 },
    cup: { type: 'volume', toBase: v => v * 0.236588 }, cups: { type: 'volume', toBase: v => v * 0.236588 },

    // Speed (Base: Meters per second)
    mps: { type: 'speed', toBase: v => v }, 'm/s': { type: 'speed', toBase: v => v },
    kph: { type: 'speed', toBase: v => v / 3.6 }, 'km/h': { type: 'speed', toBase: v => v / 3.6 },
    mph: { type: 'speed', toBase: v => v * 0.44704 }, 'mi/h': { type: 'speed', toBase: v => v * 0.44704 },
    knot: { type: 'speed', toBase: v => v * 0.514444 }, knots: { type: 'speed', toBase: v => v * 0.514444 },

    // Digital Storage (Base: Bytes)
    b: { type: 'storage', toBase: v => v }, byte: { type: 'storage', toBase: v => v }, bytes: { type: 'storage', toBase: v => v },
    kb: { type: 'storage', toBase: v => v * 1024 }, kilobyte: { type: 'storage', toBase: v => v * 1024 }, kilobytes: { type: 'storage', toBase: v => v * 1024 },
    mb: { type: 'storage', toBase: v => v * 1024 ** 2 }, meg: { type: 'storage', toBase: v => v * 1024 ** 2 }, megs: { type: 'storage', toBase: v => v * 1024 ** 2 }, megabyte: { type: 'storage', toBase: v => v * 1024 ** 2 },
    gb: { type: 'storage', toBase: v => v * 1024 ** 3 }, gig: { type: 'storage', toBase: v => v * 1024 ** 3 }, gigs: { type: 'storage', toBase: v => v * 1024 ** 3 }, gigabyte: { type: 'storage', toBase: v => v * 1024 ** 3 },
    tb: { type: 'storage', toBase: v => v * 1024 ** 4 }, terabyte: { type: 'storage', toBase: v => v * 1024 ** 4 },
};

export function resolveUnit(str) {
    if (!str) return null;
    return UNIT_MAP[str.trim().toLowerCase()] ?? null;
}