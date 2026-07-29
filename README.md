# JAMES 🤖💬

<div align="center">

**A lightweight, browser-native, local-first AI terminal and chat interface running entirely client-side.**

[Live Demo](https://chatbotjames.onrender.com) · [GitHub Repository](https://github.com/tripping-alien/chatbotjames)

</div>

---

## 🌟 Overview

**JAMES** is an advanced, client-side AI chat terminal designed to run machine learning models directly inside the browser by leveraging modern web APIs like **WebGPU**, **WebAssembly**, and **ONNX Runtime Web**. By executing tasks entirely on the client side, JAMES ensures complete user privacy, zero server-side model hosting costs, and ultra-low latency inference.

---

## ✨ Key Features

- **100% Client-Side Inference:** Runs locally in your browser using WebGPU and ONNX Runtime Web.
- **Worker-Based Architecture:** Utilizes dedicated web workers to handle model generation asynchronously, ensuring the main UI thread remains responsive at all times (includes a responsive stop-generation button).
- **Fast SmallTalk Handler:** Features a dedicated, non-LLM `SmallTalkHandler` for lightning-fast responses to common greetings and basic queries.
- **Sliding Window Memory:** Efficient conversation history management to maintain context without overloading token limits or browser memory.
- **Web Search Integration:** Built-in web search tool integration designed to augment local knowledge safely and cleanly.
- **File Upload Support:** Allows users to upload and query documents directly within the chat interface.
- **Progressive Web App (PWA):** Fully installable as a PWA with manifest support for seamless desktop and mobile experiences.
- **Terminal Aesthetic:** Immersive retro-futuristic terminal boot sequence and sleek command-line interface design.
- **SEO & Performance Optimized:** Lightweight architecture optimized for fast initial load times and smooth rendering.

---

## 🛠️ Tech Stack

- **Core:** Vanilla JavaScript / HTML5 / CSS3
- **AI / ML Runtime:** ONNX Runtime Web, WebGPU, WebAssembly (Wasm)
- **Architecture:** Web Workers for background inference processing
- **Deployment:** Render (`chatbotjames.onrender.com`)

---

## 🚀 Getting Started

To run JAMES locally on your machine, follow these simple steps:

### Prerequisites

A modern web browser with WebGPU support enabled (e.g., Google Chrome, Microsoft Edge, or a WebGPU-compatible browser) and a local development server (such as Python's HTTP server or VS Code's Live Server).

### Installation

1. Clone the repository:
   ```bash
   git clone [https://github.com/tripping-alien/chatbotjames.git](https://github.com/tripping-alien/chatbotjames.git)
   cd chatbotjames
