export type SupportedLanguage = "javascript" | "python" | "cpp";

export interface LanguageConfig {
  id: SupportedLanguage;
  label: string;
  pistonRuntime: string;
  version: string;
  extension: string;
  starter: string;
}

export const LANGUAGE_CONFIG: Record<SupportedLanguage, LanguageConfig> = {
  javascript: {
    id: "javascript",
    label: "JavaScript",
    pistonRuntime: "javascript",
    version: "18.15.0",
    extension: "js",
    starter: `function solve() {
  const greeting = "Hello from Code Sphere";
  console.log(greeting);
}

solve();
`
  },
  python: {
    id: "python",
    label: "Python",
    pistonRuntime: "python",
    version: "3.10.0",
    extension: "py",
    starter: `def solve():
    greeting = "Hello from Code Sphere"
    print(greeting)

solve()
`
  },
  cpp: {
    id: "cpp",
    label: "C++",
    pistonRuntime: "cpp",
    version: "10.2.0",
    extension: "cpp",
    starter: `#include <iostream>
using namespace std;

int main() {
  cout << "Hello from Code Sphere" << endl;
  return 0;
}
`
  }
};

export const supportedLanguages = Object.keys(LANGUAGE_CONFIG) as SupportedLanguage[];

