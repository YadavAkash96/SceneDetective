# Scene Detective 

**Turn Passive Viewing into Interactive Discovery : Shop, Identify, and Explore with Multimodal AI**

Scene Detective transforms passive video consumption into an active, interactive experience. By embedding **Google Gemini 2.5 Flash** directly into the video player, it allows viewers to pause and ask deep, context-aware questions about the content—analyzing visuals, audio, and cultural context simultaneously.

[![Watch the Demo](https://img.youtube.com/vi/vPAYl-EVVwk/0.jpg)](https://youtu.be/vPAYl-EVVwk)

> **[🎥 Watch Video Demo](https://youtu.be/vPAYl-EVVwk)** | **[✨ Try Live App](https://ai.studio/apps/drive/1CFY5c_zBfCHhVEHUpJ_6g-MG5fXM5BxD?fullscreenApplet=true)**
---

## 🚀 Features

### 🛍️ Visual Commerce (Shop the Scene)
Instantly identify props, clothing, and gadgets on screen.
- **How it works:** The AI analyzes the frame, identifies items (e.g., "Thom's Jacket"), and uses **Google Search Grounding** to find real-world retailers.
- **Visual Tiles:** Results are presented as shoppable product cards with real images powered by the Microlink API.

### 👥 Cast Identification (AR-Style Tags)
Know who is on screen instantly.
- **Structured Data:** Uses Gemini's JSON mode to identify characters and return precise bounding box coordinates (`ymin`, `xmin`, etc.).
- **No External Models:** Does not rely on YOLO or TensorFlow.js; purely generative vision analysis.

### 🎧 Multimodal Audio Context
"What song is playing?" / "Why is the character whispering?"
- **Rolling Buffer:** Captures the last ~10 seconds of audio from the video stream using the **Web Audio API**.
- **Real-time Encoding:** Encodes raw PCM audio to WAV in the browser and sends it alongside the video frame to Gemini for true multimodal understanding.

### 🎤 Voice Interaction
- Supports **Speech-to-Text** (Web Speech API) so users can speak questions naturally while watching.

---

## 🛠️ Tech Stack

- **Framework:** React 19
- **Styling:** Tailwind CSS (Dark Mode, Glassmorphism)
- **AI Model:** Google Gemini 2.5 Flash (`gemini-2.5-flash`)
- **SDK:** `@google/genai`
- **APIs:**
  - **Web Audio API** (Audio buffering & encoding)
  - **Web Speech API** (Voice input)
  - **Fullscreen API** (App-level immersion)
  - **Microlink API** (Link previews)

---

## ⚙️ Setup & Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/scene-detective.git
   cd scene-detective
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API Key**
   Create a `.env` file in the root directory:
   ```env
   API_KEY=your_google_genai_api_key_here
   ```
   *Note: Ensure your API key has access to the Gemini 2.5 Flash model.*

4. **Run the application**
   ```bash
   npm start
   ```

---

## 📖 Usage Guide

1. **Load Media:**
   - Click "Try Demo: Tears of Steel" to load the open-source sample.
   - OR upload your own `.mp4` clip (e.g., a screen recording from Netflix/YouTube).

2. **Identify Cast:**
   - Pause the video.
   - Click **Identify Cast**.
   - Watch the tags appear over characters' heads.

3. **Ask AI:**
   - Click **Ask AI** to open the side drawer.
   - Type or Speak a question (e.g., *"Where can I buy those headphones?"* or *"What is the mood of the background music?"*).
   - The AI will analyze the current frame AND the audio buffer to answer.

---

## 💡 Technical Highlights

- **Audio encoding in browser:** The app manually constructs WAV headers to convert `Float32Array` audio buffers into a format acceptable by the Gemini API, ensuring low-latency multimodal requests without backend processing.
- **Exponential Backoff:** Implements robust error handling for API rate limits (429 errors) to ensure reliability during demos.
- **Secure Context:** Operates entirely client-side (except for the API call), processing video frames and audio locally.

---

## 📄 License

MIT License. Demo video *Tears of Steel* (CC) Blender Foundation.
