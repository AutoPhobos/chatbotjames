# JAMES (Just A Machine, Engineered for Speech)

![JAMES AI Preview](preview.jpg)

JAMES is a fully local, browser-native AI assistant designed with privacy as the foundational principle. By leveraging WebAssembly and WebGPU, JAMES runs entirely client-side, ensuring your data never leaves your device. No cloud, no API calls, no accounts—just your machine.

## Core Features

* **100% Private & Local AI:** All processing happens directly within your browser. There is no server communication for model inference.
* **Frictionless Access:** Start chatting instantly. No sign-ups, logins, or accounts are required.
* **Browser-Powered Performance:** Utilizes WASM and WebGPU for fast, hardware-accelerated client-side model execution.
* **Integrated Python Runtime:** Powered by Pyodide, allowing JAMES to execute Python code securely within the browser environment.
* **Offline-Capable:** Once the model is cached locally, no active internet connection is needed to chat.

## Genesis AI & Living Memory

The most significant feature of JAMES is the **Persistent Personal Memory** system. While traditional local LLMs wipe their context the moment you close the tab, JAMES is designed to remember you across sessions without compromising your privacy.

* **Client-Side Encryption:** All memories, notes, and session histories are encrypted and stored exclusively on your device using IndexedDB.
* **Contextual Continuity:** JAMES seamlessly retrieves relevant past interactions to maintain a continuous, living relationship, making conversations increasingly tailored over time.
* **Zero Server Footprint:** Because the memory storage is strictly local, you get all the benefits of a personalized, long-term AI thought partner without ever creating a profile on a corporate server.

## Tech Stack

* **Frontend:** Vanilla JavaScript, HTML5, CSS3 (No heavy frameworks)
* **Compute:** WebGPU for accelerated local model execution
* **Runtime Environments:** ONNX Runtime Web & Pyodide (WASM)
* **Storage:** IndexedDB for encrypted, persistent chat history and memory

## Getting Started

Try it live at: [chatbotjames.onrender.com](https://chatbotjames.onrender.com)

*(Note: Because the model runs entirely locally, initial load times may vary based on your hardware and network speed as the browser caches the required WebAssembly files and model weights).*

---
**Author:** Andrey Lopukhov
