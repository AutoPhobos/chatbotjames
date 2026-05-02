importScripts('https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js');

let pyodide = null;
let ready = false;

async function initPyodide() {
    pyodide = await loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/'
    });

    // Redirect stdout/stderr so we can capture print() output
    await pyodide.runPythonAsync(`
import sys
import io

class _Capture(io.StringIO):
    pass

sys.stdout = _Capture()
sys.stderr = _Capture()
`);

    ready = true;
    self.postMessage({ status: 'ready' });
}

self.onmessage = async (e) => {
    const { type, code, execId } = e.data;

    if (type === 'init') {
        self.postMessage({ status: 'loading' });
        try {
            await initPyodide();
        } catch (err) {
            self.postMessage({ status: 'error', error: `Pyodide failed to load: ${err.message}`, execId });
        }
        return;
    }

    if (type === 'run') {
        if (!ready) {
            self.postMessage({ status: 'error', error: 'Pyodide not ready yet.', execId });
            return;
        }

        try {
            // 1. Fetch any required packages (e.g., numpy, pandas) before running
            await pyodide.loadPackagesFromImports(code);

            // 2. Faster reset: just clear the existing stdout/stderr buffers
            await pyodide.runPythonAsync(`
sys.stdout.seek(0)
sys.stdout.truncate(0)
sys.stderr.seek(0)
sys.stderr.truncate(0)
`);

            let result = undefined;
            try {
                result = await pyodide.runPythonAsync(code);
            } catch (pyErr) {
                const stderr = await pyodide.runPythonAsync(`sys.stderr.getvalue()`);
                self.postMessage({
                    status: 'error',
                    error: stderr || pyErr.message,
                    execId
                });
                return;
            }

            const stdout = await pyodide.runPythonAsync(`sys.stdout.getvalue()`);

            // 3. Safer check: Python 'None' becomes JS 'undefined'
            let output = stdout || '';
            if (result !== undefined) {
                output += (output ? '\n' : '') + String(result);
            }

            self.postMessage({
                status: 'done',
                output: output.trim(),
                execId
            });

        } catch (err) {
            self.postMessage({ status: 'error', error: err.message, execId });
        }
    }
};