
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, BoundingBox } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const modelName = "gemini-2.5-flash";

// Helper for delay
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Generic Retry Wrapper for API calls
async function retryWithBackoff<T>(operation: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Check for Rate Limit (429) or Service Overload (503)
    const isRateLimit = error?.message?.includes('429') || error?.status === 429 || error?.code === 429 || error?.message?.includes('quota');
    
    if (retries > 0 && isRateLimit) {
      console.warn(`Rate limit hit. Retrying in ${delay}ms... (${retries} attempts left)`);
      await wait(delay);
      // Exponential backoff: double the delay
      return retryWithBackoff(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

export const analyzeFrameWithQuery = async (base64Image: string, query: string, audioData?: string | null): Promise<AnalysisResult> => {
  return retryWithBackoff(async () => {
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
        
        2. **Determine User Intent**:
           - **SHOPPING** (e.g. "Where to buy", "get this jacket", "price", "shop"):
             - **Goal**: Help the user find the **actual product** to purchase.
             - **Search Strategy**: Generate queries targeting retailers (e.g. "buy [item] amazon", "[item] official store").
             - **Visual Matching**: Strict match on color/material.
             - **Constraint**: Do NOT return generic articles or "best of" lists. Find product pages.
           
           - **INFORMATIONAL / BEHIND-THE-SCENES** (e.g. "How was this made?", "Makeup process", "Trivia", "Who is this", "Meaning"):
             - **Goal**: Provide a mix of authoritative articles AND **video content**.
             - **Search Strategy**: You MUST generate multiple search queries. 
               - Query 1: Standard info (e.g., "Vecna makeup process").
               - Query 2: **VIDEO SPECIFIC** (e.g., "Vecna makeup transformation **youtube**", "how to create [prop] **video**").
             - **Sources**: Prioritize YouTube videos, official interviews, and high-quality entertainment news.
        
        3. **Audio Analysis**: If audio is provided, YOU MUST analyze it directly.
           - Identify songs, background scores, dialogue, or sound effects.
           - If asked about music, provide the Song Name, Artist, and Album if identifiable.
           - **STRICT RULE**: Do NOT suggest using external apps (like Shazam). YOU are the analyzer.
        
        4. **Conciseness & Formatting**: 
           - Keep the text answer under 150 words.
           - Use Markdown (e.g., **bold** for key names).
           - Provide the direct answer in the text. The search tool will handle the links.
        
        5. **Context**: Recognize movie props vs real items.`,
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
  });
};

export const detectCharactersInFrame = async (base64Image: string): Promise<BoundingBox[]> => {
  return retryWithBackoff(async () => {
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
  });
};
