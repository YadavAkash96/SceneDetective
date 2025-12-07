
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, BoundingBox } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const modelName = "gemini-2.5-flash";

export const analyzeFrameWithQuery = async (base64Image: string, query: string, audioData?: string | null): Promise<AnalysisResult> => {
  try {
    const cleanBase64Image = base64Image.replace(/^data:image\/\w+;base64,/, "");
    
    const parts: any[] = [
      {
        inlineData: {
          data: cleanBase64Image,
          mimeType: "image/jpeg", 
        },
      }
    ];

    // If we have audio context (last ~10 seconds), add it to the prompt
    if (audioData) {
      const cleanBase64Audio = audioData.replace(/^data:audio\/\w+;base64,/, "");
      parts.push({
        inlineData: {
          data: cleanBase64Audio,
          mimeType: "audio/wav",
        }
      });
    }

    // Add the text query
    parts.push({
      text: `User Query: "${query}"
      
      Instructions:
      1. Analyze the provided image ${audioData ? 'AND the accompanying audio clip (last 10 seconds)' : ''} to answer the user's query.
      2. **Visual Matching**: If the user asks where to buy an item (fashion, props, gadgets), focus on **EXACT VISUAL MATCHES**.
         - Match the MATERIAL (e.g., if it's metal, do not suggest plastic or glass).
         - Match the COLOR and SHAPE exactly.
         - Look for specific LOGOS or BRAND MARKS in the image.
      3. **Audio Analysis**: If audio is provided, YOU MUST analyze it directly.
         - Identify songs, background scores, dialogue, or sound effects.
         - If asked about music, provide the Song Name, Artist, and Album if identifiable.
         - **STRICT RULE**: Do NOT suggest using external apps (like Shazam, SoundHound, etc.). YOU are the analyzer. If you cannot identify the song, describe the genre/instruments instead.
      4. **Conciseness**: Keep the text answer focused on *identifying* the object or scene. 
         - Do NOT list generic search terms in the text.
         - Keep the text description under 150 words.
      5. **Formatting**: Use Markdown (e.g., **bold** for key names).
      6. **Context**: If the item is a prop from a movie/show (e.g., "Dr. House's cane"), identify it as such first, then provide real-world replicas.`,
    });

    const response = await ai.models.generateContent({
      model: modelName,
      contents: { parts },
      config: {
        tools: [{ googleSearch: {} }], 
      }
    });

    const text = response.text;
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

    if (!text) {
      throw new Error("No response text received from Gemini");
    }

    return { answer: text, groundingMetadata };
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const detectCharactersInFrame = async (base64Image: string): Promise<BoundingBox[]> => {
  try {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: "image/jpeg",
            },
          },
          {
            text: "You are an expert in pop culture, movies, anime, and TV shows. Analyze this image frame and identify the specific names of the MAIN characters present. \n\nRules:\n1. Identify specific names (e.g. 'Tony Stark', 'Luffy', 'Walter White').\n2. For the demo video 'Tears of Steel', identify characters like 'Thom', 'Celia', or 'Bouke'.\n3. Do NOT use generic labels like 'man', 'woman', 'police officer'.\n4. If you don't know the exact character name, do NOT return a bounding box for them.\n5. Return their names and bounding boxes using a 0-1000 scale.",
          },
        ],
      },
      config: {
        temperature: 0, // CRITICAL: Set to 0 for deterministic, consistent results
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "The specific character name (e.g. 'Iron Man')." },
              ymin: { type: Type.INTEGER },
              xmin: { type: Type.INTEGER },
              ymax: { type: Type.INTEGER },
              xmax: { type: Type.INTEGER },
            },
            required: ["name", "ymin", "xmin", "ymax", "xmax"],
          },
        },
      },
    });

    let text = response.text;
    if (!text) {
      return [];
    }

    // Sanitize Markdown fences if present (e.g. ```json ... ```)
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    const boxes = JSON.parse(text) as BoundingBox[];
    return boxes;
  } catch (error) {
    console.error("Gemini Detection Error:", error);
    throw error;
  }
};
