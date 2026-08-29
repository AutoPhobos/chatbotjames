// Currency symbol + name -> ISO code
export const CURRENCY_MAP = {
    '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₪': 'ILS',
    '₹': 'INR', '₩': 'KRW', '₺': 'TRY', '₽': 'RUB', 'R$': 'BRL',
    dollar: 'USD', dollars: 'USD', usd: 'USD', buck: 'USD', bucks: 'USD', 'us dollar': 'USD', 'us dollars': 'USD',
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
    lira: 'TRY', 'try': 'TRY',
    krona: 'SEK', sek: 'SEK', krone: 'DKK', dkk: 'DKK', nok: 'NOK',
    zloty: 'PLN', pln: 'PLN', forint: 'HUF', huf: 'HUF',
    baht: 'THB', thb: 'THB', ringgit: 'MYR', myr: 'MYR',
    bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH',
};

export function resolveCurrency(str) {
    const key = str.trim().toLowerCase();
    if (CURRENCY_MAP[key]) return CURRENCY_MAP[key];
    if (CURRENCY_MAP[str.trim()]) return CURRENCY_MAP[str.trim()];
    
    // Only fallback to ISO code if it strictly looks like a 3-letter code
    const upper = str.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(upper)) return upper;
    
    return null;
}

// City / region -> IANA timezone
export const TIMEZONE_MAP = {
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
    'london': 'Europe/London', 'uk': 'Europe/London', 'england': 'Europe/London',
    'paris': 'Europe/Paris', 'france': 'Europe/Paris',
    'berlin': 'Europe/Berlin', 'germany': 'Europe/Berlin', 'munich': 'Europe/Berlin',
    'rome': 'Europe/Rome', 'italy': 'Europe/Rome',
    'madrid': 'Europe/Madrid', 'spain': 'Europe/Madrid',
    'amsterdam': 'Europe/Amsterdam', 'netherlands': 'Europe/Amsterdam',
    'moscow': 'Europe/Moscow', 'russia': 'Europe/Moscow',
    'istanbul': 'Europe/Istanbul', 'turkey': 'Europe/Istanbul',
    'dubai': 'Asia/Dubai', 'uae': 'Asia/Dubai',
    'mumbai': 'Asia/Kolkata', 'india': 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata',
    'bangkok': 'Asia/Bangkok', 'thailand': 'Asia/Bangkok',
    'singapore': 'Asia/Singapore',
    'hong kong': 'Asia/Hong_Kong', 'hk': 'Asia/Hong_Kong',
    'shanghai': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
    'tokyo': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
    'seoul': 'Asia/Seoul', 'korea': 'Asia/Seoul',
    'sydney': 'Australia/Sydney', 'australia': 'Australia/Sydney', 'melbourne': 'Australia/Sydney',
    'auckland': 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland', 'nz': 'Pacific/Auckland',
    'cape town': 'Africa/Johannesburg', 'south africa': 'Africa/Johannesburg', 'johannesburg': 'Africa/Johannesburg',
    'cairo': 'Africa/Cairo', 'egypt': 'Africa/Cairo'
};

export function resolveTimezone(location) {
    return TIMEZONE_MAP[location.toLowerCase().trim()] ?? location.trim();
}

// Unit conversion table
export const UNIT_MAP = {
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

export function resolveUnit(str) {
    return UNIT_MAP[str.trim().toLowerCase()] ?? null;
}