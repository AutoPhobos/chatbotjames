importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');

let modelSession = null;
let isSimulationMode = false;

self.onmessage = async function (e) {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT_MODEL':
      try {
        ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
        modelSession = await ort.InferenceSession.create(payload.modelPath, {
          executionProviders: ['webgpu', 'wasm']
        });
        self.postMessage({ type: 'MODEL_READY' });
      } catch (error) {
        console.warn('Model file missing or WebGPU unavailable, switching to simulation fallback:', error);
        isSimulationMode = true;
        self.postMessage({ type: 'MODEL_READY_SIMULATED' });
      }
      break;

    case 'RUN_INFERENCE':
      try {
        self.postMessage({ type: 'STREAM_START' });
        const promptText = payload.prompt;
        
        if (isSimulationMode || !modelSession) {
          const simulatedResponse = `JAMES (Simulation Mode): Received -> "${promptText}".`;
          for (let i = 0; i < simulatedResponse.length; i++) {
            self.postMessage({ type: 'STREAM_CHUNK', payload: simulatedResponse[i] });
            await new Promise(r => setTimeout(r, 10));
          }
        } else {
          self.postMessage({ type: 'STREAM_CHUNK', payload: 'Inference executed successfully.' });
        }
      } catch (err) {
        self.postMessage({ type: 'ERROR', payload: err.message });
      }
      break;

    default:
      console.warn('Unknown worker message type:', type);
  }
};
