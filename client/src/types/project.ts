export type ProjectSignalState = "passed" | "failed" | "running" | "not-run" | "ready" | "attention" | "unavailable";

export interface ProjectHealthItem {
  id: string;
  label: string;
  state: ProjectSignalState;
  detail: string;
}

export interface ProjectArea {
  path: string;
  fileCount: number;
  sampleFiles: string[];
  hasTests: boolean;
}

export interface ProjectExperience {
  workspaceId: string;
  generatedAt: number;
  snapshot: {
    name: string;
    framework: string;
    language: string;
    backend: string;
    database: string;
    ai: string;
    tests: string;
    git: string;
    activeTasks: number;
  };
  map: { areas: ProjectArea[]; importantFiles: string[]; truncated: boolean };
  health: ProjectHealthItem[];
  readiness: ProjectHealthItem[];
  onboarding: { overview: string[]; developmentGuide: string[]; riskAreas: string[] };
}
