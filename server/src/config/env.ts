import path from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(__dirname, "../../.env")
});

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  port: toNumber(process.env.PORT, 4000),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini"
};
