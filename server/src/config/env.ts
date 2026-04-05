import dotenv from "dotenv";

dotenv.config();

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  port: toNumber(process.env.PORT, 4000),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  pistonUrl: process.env.PISTON_URL ?? "https://emkc.org/api/v2/piston/execute",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini"
};

