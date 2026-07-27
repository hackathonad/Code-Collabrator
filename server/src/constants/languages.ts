export type SupportedLanguage = "javascript" | "python" | "cpp";

export interface LanguageConfig {
  id: SupportedLanguage;
  label: string;
  starter: string;
}

export const LANGUAGE_CONFIG: Record<SupportedLanguage, LanguageConfig> = {
  javascript: {
    id: "javascript",
    label: "JavaScript",
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
    starter: `def solve():
    greeting = "Hello from Code Sphere"
    print(greeting)

solve()
`
  },
  cpp: {
    id: "cpp",
    label: "C++",
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
