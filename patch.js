const fs = require('fs');
const path = 'app.js';
let content = fs.readFileSync(path, 'utf8');

const safeStorageCode = `
// Safe LocalStorage wrapper to prevent UI crash in strict privacy modes
const safeLocalStorage = {
    getItem: (key) => { try { return localStorage.getItem(key); } catch(e) { return null; } },
    setItem: (key, val) => { try { localStorage.setItem(key, val); } catch(e) {} },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch(e) {} }
};
`;

// Insert the wrapper at the top, just below imports
content = content.replace(/(import .*;\n)+/, match => match + '\n' + safeStorageCode.trim() + '\n\n');

// Replace all occurrences of localStorage
content = content.replace(/\blocalStorage\b/g, 'safeLocalStorage');

fs.writeFileSync(path, content, 'utf8');
