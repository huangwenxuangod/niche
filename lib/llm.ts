import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
});

// Model endpoint — set via env var or fall back to placeholder
const MODEL = process.env.ARK_MODEL_ID ?? "ep-xxxxxxxx";

interface StreamChatOptions {
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  onChunk: (text: string) => void;
}

export const llm = {
  async streamChat({ systemPrompt, messages, onChunk }: StreamChatOptions) {
    const stream = await client.chat.completions.create({
      model: MODEL,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) onChunk(text);
    }
  },

  async chat(systemPrompt: string, userContent: string): Promise<string> {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    return res.choices[0]?.message?.content ?? "";
  },
};

export { client, MODEL };
